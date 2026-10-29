const { prisma } = require('../../config/prisma');
const rekognition = require('../../services/rekognition');
const { deletePrefix } = require('../../services/s3');
const { AppError, CODES, isRetryable } = require('../../lib/errors');
const { tierFor, AUTO_THRESHOLD, BROADER_THRESHOLD } = require('../../services/threshold');
const { counters } = require('../../services/metrics');
const { logger } = require('../../utils/logger');

const MIN_FACE_RATIO = 0.06; // face must occupy at least this fraction of the frame
// AWS MaxFaces max is 4096 — previous default 100 caused truncated results (~32).
const SEARCH_MAX_FACES = Math.min(
  4096,
  Math.max(100, parseInt(process.env.FACE_SEARCH_MAX_FACES || '2000', 10) || 2000),
);
const EXPAND_ANCHORS = Math.min(5, Math.max(1, parseInt(process.env.FACE_SEARCH_EXPAND_ANCHORS || '3', 10) || 3));

// Validate the selfie has exactly one usable face, else throw a permanent,
// human-friendly error the customer can act on (FACE-PIPELINE-PLAN.md §6–7).
const validateSelfie = async (selfieKey) => {
  const faces = await rekognition.detectFaces({ key: selfieKey });
  if (faces.length === 0) {
    throw new AppError(CODES.NO_FACE_DETECTED, "We couldn't find a clear face. Try a brighter selfie with only you in frame.", { status: 422 });
  }
  if (faces.length > 1) {
    throw new AppError(CODES.MULTIPLE_FACES, 'We found more than one face. Please upload a selfie with only you in it.', { status: 422 });
  }
  const f = faces[0];
  const size = (f.boundingBox?.Width || 0) * (f.boundingBox?.Height || 0);
  if (size < MIN_FACE_RATIO * MIN_FACE_RATIO * 4) {
    throw new AppError(CODES.FACE_TOO_SMALL, 'Your face is too small in the photo. Move closer and try again.', { status: 422 });
  }
  const q = f.quality || {};
  if ((q.Sharpness != null && q.Sharpness < 10) || (q.Brightness != null && q.Brightness < 10)) {
    throw new AppError(CODES.LOW_QUALITY_SELFIE, 'The selfie is too blurry or dark. Try again in better light.', { status: 422 });
  }
  return f;
};

// Deterministic rank: similarity desc → sharpness desc → oldest photo → id.
const rankPhotos = (rows) => rows.sort((a, b) => {
  if (b.similarity !== a.similarity) return b.similarity - a.similarity;
  const bq = b.quality?.Sharpness || 0, aq = a.quality?.Sharpness || 0;
  if (bq !== aq) return bq - aq;
  if (a.capturedAt && b.capturedAt) {
    const dt = new Date(a.capturedAt) - new Date(b.capturedAt);
    if (dt !== 0) return dt;
  }
  return a.photoId.localeCompare(b.photoId);
});

/**
 * Merge face matches by faceId, keeping highest similarity.
 */
const mergeMatches = (lists) => {
  const byId = new Map();
  for (const list of lists) {
    for (const m of list || []) {
      if (!m?.faceId) continue;
      const prev = byId.get(m.faceId);
      if (!prev || (m.similarity || 0) > (prev.similarity || 0)) {
        byId.set(m.faceId, m);
      }
    }
  }
  return [...byId.values()];
};

/**
 * SearchFacesByImage alone often under-returns when a person appears in many
 * photos. Expand using SearchFaces on the strongest anchor FaceIds.
 */
const searchAndExpand = async ({ selfieKey, threshold }) => {
  const primary = await rekognition.searchFacesByImage({
    key: selfieKey,
    threshold,
    maxFaces: SEARCH_MAX_FACES,
  });
  counters.rekognitionCalls.inc({ op: 'search', outcome: 'ok' });

  if (!primary.length) return primary;

  // Anchors: highest-similarity faces (likely the subject)
  const anchors = [...primary]
    .sort((a, b) => (b.similarity || 0) - (a.similarity || 0))
    .slice(0, EXPAND_ANCHORS)
    .map((m) => m.faceId)
    .filter(Boolean);

  const expanded = [primary];
  for (const faceId of anchors) {
    try {
      const more = await rekognition.searchFaces({
        faceId,
        threshold,
        maxFaces: SEARCH_MAX_FACES,
      });
      counters.rekognitionCalls.inc({ op: 'search_faces', outcome: 'ok' });
      expanded.push(more);
    } catch (err) {
      counters.rekognitionCalls.inc({ op: 'search_faces', outcome: 'error' });
      logger.warn(`SearchFaces expand failed for ${faceId}: ${err.message}`);
    }
  }

  const merged = mergeMatches(expanded);
  logger.info(
    `Face search expand: primary=${primary.length} anchors=${anchors.length} merged=${merged.length}`,
  );
  return merged;
};

// Apply access + visibility filters; return included photos + audit exclusions.
const filterAndGroup = async ({ matches, session, minSimilarity }) => {
  // Gallery-scoped sessions (QR guest / gallery find-me) only need that gallery.
  let allowedGalleries;
  if (session.galleryId) {
    const grant = await prisma.accessGrant.findFirst({
      where: {
        customerId: session.customerId,
        galleryId: session.galleryId,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        AND: [{ OR: [{ faceSearchEnabled: null }, { faceSearchEnabled: true }] }],
        gallery: {
          status: 'PUBLISHED',
          studioId: session.studioId,
          faceSearchEnabled: true,
          deletedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
      },
      select: { galleryId: true },
    });
    allowedGalleries = new Set(grant ? [grant.galleryId] : []);
  } else {
    const grants = await prisma.accessGrant.findMany({
      where: {
        customerId: session.customerId,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        AND: [{ OR: [{ faceSearchEnabled: null }, { faceSearchEnabled: true }] }],
        gallery: {
          status: 'PUBLISHED',
          studioId: session.studioId,
          faceSearchEnabled: true,
          deletedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
      },
      select: { galleryId: true },
    });
    allowedGalleries = new Set(grants.map((g) => g.galleryId));
  }

  const faceIds = matches.map((m) => m.faceId);
  // Chunk large IN lists for safety
  const faces = [];
  for (let i = 0; i < faceIds.length; i += 500) {
    const chunk = faceIds.slice(i, i + 500);
    if (!chunk.length) continue;
    const rows = await prisma.photoFace.findMany({
      where: {
        rekognitionFaceId: { in: chunk },
        faceStatus: 'ACTIVE',
        studioId: session.studioId,
        ...(session.galleryId ? { galleryId: session.galleryId } : {}),
      },
      include: {
        photo: {
          select: {
            id: true, galleryId: true, isVisibleToCustomers: true, capturedAt: true,
          },
        },
      },
    });
    faces.push(...rows);
  }

  const simByFace = Object.fromEntries(matches.map((m) => [m.faceId, m.similarity]));
  const byPhoto = new Map();
  const auditRows = [];

  for (const face of faces) {
    const photo = face.photo;
    const similarity = simByFace[face.rekognitionFaceId] || 0;
    let exclusion = null;
    if (!photo || !photo.isVisibleToCustomers) exclusion = 'photo_not_visible';
    else if (!allowedGalleries.has(photo.galleryId)) exclusion = 'no_access';
    else if (similarity < minSimilarity) exclusion = 'below_threshold';

    if (exclusion) {
      auditRows.push({
        photoId: face.photoId,
        photoFaceId: face.id,
        similarity,
        included: false,
        exclusion,
        tier: tierFor(similarity),
      });
      continue;
    }

    const prev = byPhoto.get(photo.id);
    if (!prev || similarity > prev.similarity) {
      byPhoto.set(photo.id, {
        photoId: photo.id,
        photoFaceId: face.id,
        similarity,
        quality: face.quality,
        capturedAt: photo.capturedAt,
        tier: tierFor(similarity),
      });
    }
  }

  return { byPhoto, auditRows, facesCount: faces.length };
};

/** Persist matches in batches (large result sets). */
async function persistMatches(sessionId, ranked, auditRows, broader) {
  await prisma.faceSearchMatch.deleteMany({ where: { sessionId } });

  const includeRows = ranked.map((r, i) => ({
    sessionId,
    photoId: r.photoId,
    photoFaceId: r.photoFaceId,
    similarity: r.similarity,
    rank: i + 1,
    includedInResult: true,
    exclusionReason: broader && r.similarity < AUTO_THRESHOLD ? 'broader_search' : null,
  }));
  const excludeRows = auditRows.map((r) => ({
    sessionId,
    photoId: r.photoId,
    photoFaceId: r.photoFaceId,
    similarity: r.similarity,
    rank: 0,
    includedInResult: false,
    exclusionReason: r.exclusion,
  }));

  const all = [...includeRows, ...excludeRows];
  for (let i = 0; i < all.length; i += 100) {
    await prisma.faceSearchMatch.createMany({ data: all.slice(i, i + 100) });
  }
}

const processor = async (job) => {
  const { sessionId, broader = false } = job.data;
  const session = await prisma.faceSearchSession.findUnique({ where: { id: sessionId } });
  if (!session) return { skipped: true };
  if (!session.selfieKey && !broader) return { skipped: true };
  if (!broader && ['COMPLETED', 'NO_MATCH', 'REJECTED', 'EXPIRED'].includes(session.status)) {
    return { skipped: true };
  }

  const finish = async (status, data = {}) => {
    await prisma.faceSearchSession.update({
      where: { id: sessionId },
      data: { status, completedAt: new Date(), ...data },
    });
  };

  const minSimilarity = broader ? BROADER_THRESHOLD : (session.threshold || AUTO_THRESHOLD);
  const searchThreshold = broader ? BROADER_THRESHOLD : (session.threshold || AUTO_THRESHOLD);

  try {
    let matches = [];

    if (session.selfieKey) {
      await prisma.faceSearchSession.update({ where: { id: sessionId }, data: { status: 'VALIDATING' } });
      await validateSelfie(session.selfieKey);

      await prisma.faceSearchSession.update({ where: { id: sessionId }, data: { status: 'SEARCHING' } });
      matches = await searchAndExpand({
        selfieKey: session.selfieKey,
        threshold: searchThreshold,
      });
    } else if (broader) {
      await prisma.faceSearchSession.update({ where: { id: sessionId }, data: { status: 'SEARCHING' } });
      const prior = await prisma.faceSearchMatch.findMany({ where: { sessionId } });
      const promoted = prior.filter((r) => r.similarity >= BROADER_THRESHOLD);
      const rankedPrior = rankPhotos(promoted.map((r) => ({
        photoId: r.photoId,
        photoFaceId: r.photoFaceId,
        similarity: r.similarity,
      })));
      await persistMatches(sessionId, rankedPrior, [], true);
      await finish(rankedPrior.length ? 'COMPLETED' : 'NO_MATCH', {
        matchCount: rankedPrior.length,
        threshold: BROADER_THRESHOLD,
      });
      counters.faceSearches.inc({ outcome: rankedPrior.length ? 'broader_match' : 'no_match' });
      return { matches: rankedPrior.length, broader: true };
    } else {
      return { skipped: true };
    }

    const { byPhoto, auditRows, facesCount } = await filterAndGroup({
      matches, session, minSimilarity,
    });

    const ranked = rankPhotos([...byPhoto.values()]);
    await persistMatches(sessionId, ranked, auditRows, broader);

    await finish(ranked.length ? 'COMPLETED' : 'NO_MATCH', {
      searchedFaceCount: facesCount,
      matchCount: ranked.length,
      threshold: searchThreshold,
    });
    counters.faceSearches.inc({ outcome: ranked.length ? (broader ? 'broader_match' : 'match') : 'no_match' });
    logger.info(
      `Face search ${sessionId}: ${ranked.length} photo(s) from ${matches.length} face hit(s) `
      + `(threshold=${searchThreshold}, gallery=${session.galleryId || 'all'})`,
    );
    return { matches: ranked.length, faceHits: matches.length, broader: !!broader };
  } catch (err) {
    if (err instanceof AppError && !err.retryable) {
      await finish('REJECTED', { safeFailureCode: err.code });
      counters.faceSearches.inc({ outcome: 'rejected' });
      return { rejected: err.code };
    }
    if (!isRetryable(err) && !(err instanceof AppError)) {
      await finish('FAILED', { safeFailureCode: CODES.SEARCH_FAILED });
      counters.faceSearches.inc({ outcome: 'failed' });
      throw new AppError(CODES.SEARCH_FAILED, 'Search failed', { status: 500, retryable: false });
    }
    counters.rekognitionCalls.inc({ op: 'search', outcome: 'error' });
    throw err;
  } finally {
    try {
      await deletePrefix(`temporary-face-search/${sessionId}/`);
      await prisma.faceSearchSession.update({ where: { id: sessionId }, data: { selfieKey: null } });
      counters.selfieCleanups.inc({ outcome: 'ok' });
    } catch (e) {
      counters.selfieCleanups.inc({ outcome: 'error' });
      logger.error(`Selfie cleanup failed for ${sessionId}: ${e.message}`);
    }
  }
};

module.exports = processor;
module.exports.rankPhotos = rankPhotos;
module.exports.validateSelfie = validateSelfie;
module.exports.filterAndGroup = filterAndGroup;
module.exports.searchAndExpand = searchAndExpand;
