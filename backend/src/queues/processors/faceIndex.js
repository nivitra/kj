const sharp = require('sharp');
const { prisma } = require('../../config/prisma');
const rekognition = require('../../services/rekognition');
const { getObjectBuffer } = require('../../services/s3');
const { withLock } = require('../../services/lock');
const { counters } = require('../../services/metrics');
const { AppError, CODES, isRetryable } = require('../../lib/errors');
const { logger } = require('../../utils/logger');

/**
 * Rekognition IndexFaces:
 *  - only accepts JPEG/PNG
 *  - max image size 15 MB (ImageTooLargeException for wedding camera originals 20–45MB)
 * Always load bytes and re-encode a resized JPEG when needed so indexing succeeds.
 */
async function loadRekognitionImage(photo) {
  const key = photo.originalKey || photo.previewKey;
  if (!key) throw new AppError(CODES.NOT_FOUND, 'No image key for face index', { status: 404, retryable: false });

  const mime = (photo.mimeType || '').toLowerCase();
  const size = Number(photo.fileSize || 0);
  // Safe path: small JPEG/PNG originals can be referenced by S3 key.
  const smallEnough = size > 0 && size < 4.5 * 1024 * 1024;
  const isJpegPng = mime === 'image/jpeg' || mime === 'image/jpg' || mime === 'image/png';
  if (isJpegPng && photo.originalKey && smallEnough) {
    return { key: photo.originalKey };
  }

  // Large / WebP / HEIC / unknown size: download, downscale, JPEG for Rekognition.
  const sourceKey = photo.originalKey || photo.previewKey;
  const buf = await getObjectBuffer(sourceKey);
  let jpeg = await sharp(buf)
    .rotate()
    .resize(2048, 2048, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();

  // Hard cap under Rekognition 15MB (and keep headroom)
  if (jpeg.length > 12 * 1024 * 1024) {
    jpeg = await sharp(buf)
      .rotate()
      .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80, mozjpeg: true })
      .toBuffer();
  }
  return { bytes: jpeg };
}

// Index every face in a photo into the collection, and persist PhotoFace rows.
// Idempotent: already-indexed photos short-circuit; Redis lock prevents races.
module.exports = async (job) => {
  const { photoId } = job.data;

  const outcome = await withLock(`index:${photoId}`, 10 * 60 * 1000, async () => {
    const photo = await prisma.photo.findUnique({
      where: { id: photoId },
      include: { gallery: { select: { studioId: true, faceSearchEnabled: true } } },
    });
    if (!photo || (!photo.previewKey && !photo.originalKey)) return { skipped: true };
    if (photo.rekognitionIndexedAt && photo.faceIndexed) return { skipped: true };
    // Safety: never index while gallery face search is off (stale jobs from old uploads).
    if (!photo.gallery?.faceSearchEnabled) {
      logger.info(`Skip face index job for ${photoId} — gallery face search disabled`);
      return { skipped: true, reason: 'face_search_off' };
    }
    // Videos have no faces to index
    if (photo.mediaType === 'VIDEO') {
      return { skipped: true, reason: 'video' };
    }

    await rekognition.ensureCollection();

    let faces;
    try {
      const image = await loadRekognitionImage(photo);
      faces = await rekognition.indexFaces({
        ...image,
        externalImageId: photoId,
        maxFaces: 35,
      });
      counters.rekognitionCalls.inc({ op: 'index', outcome: 'ok' });
    } catch (err) {
      counters.rekognitionCalls.inc({ op: 'index', outcome: 'error' });
      if (isRetryable(err)) {
        logger.warn(`Face index retryable failure for ${photoId}: ${err.name || err.message}`);
        throw err;
      }
      // Permanent: keep gallery delivery intact.
      // Allow reindex later if we improve pipeline (clear rekognitionIndexedAt only on explicit reindex jobs).
      await prisma.photo.update({
        where: { id: photoId },
        data: {
          lastErrorCode: err.name || CODES.SEARCH_FAILED,
          lastErrorMessageSafe: String(err.message || 'Face indexing failed').slice(0, 200),
          processingStatus: 'COMPLETE',
          isVisibleToCustomers: true,
          // Do NOT set faceIndexed true; leave indexedAt so UI can show failure, but reindex can reset
          rekognitionIndexedAt: new Date(),
          faceIndexed: false,
        },
      });
      logger.error(`Face index permanent failure for ${photoId}: ${err.name} ${err.message}`);
      throw new AppError(CODES.SEARCH_FAILED, 'Face indexing failed permanently', { status: 422, retryable: false });
    }

    const collectionId = rekognition.COLLECTION_ID;

    await prisma.$transaction([
      ...faces.map((f) => prisma.photoFace.upsert({
        where: { rekognitionFaceId: f.faceId },
        create: {
          photoId,
          studioId: photo.gallery.studioId,
          galleryId: photo.galleryId,
          collectionId,
          rekognitionFaceId: f.faceId,
          externalImageId: photoId,
          boundingBox: f.boundingBox,
          confidence: f.confidence,
          pose: f.pose,
          quality: f.quality,
          faceStatus: 'ACTIVE',
        },
        update: {
          faceStatus: 'ACTIVE',
          boundingBox: f.boundingBox,
          confidence: f.confidence,
          pose: f.pose,
          quality: f.quality,
        },
      })),
      prisma.photo.update({
        where: { id: photoId },
        data: {
          faceIndexed: faces.length > 0,
          rekognitionIndexedAt: new Date(),
          ingestionStatus: faces.length > 0 ? 'INDEXED' : 'COMPLETE',
          lastErrorCode: faces.length ? null : 'NO_FACE_INDEXED',
          lastErrorMessageSafe: faces.length ? null : 'No faces detected for search indexing',
        },
      }),
    ]);

    try {
      await refreshGalleryFaceStatus(photo.galleryId);
    } catch (_) { /* non-fatal */ }

    counters.facesIndexed.inc(faces.length || 0);
    logger.info(`Indexed ${faces.length} face(s) for photo ${photoId}`);
    return { faces: faces.length };
  });

  if (outcome?.skipped && outcome.reason === 'locked') {
    throw new Error('Face index lock held; will retry');
  }
  return outcome;
};

async function refreshGalleryFaceStatus(galleryId) {
  const total = await prisma.photo.count({
    where: { galleryId, processingStatus: 'COMPLETE', isVisibleToCustomers: true },
  });
  const indexed = await prisma.photo.count({
    where: { galleryId, faceIndexed: true },
  });
  let faceIndexStatus = 'NOT_STARTED';
  if (total === 0) faceIndexStatus = 'NOT_STARTED';
  else if (indexed === 0) faceIndexStatus = 'PENDING';
  else if (indexed < total) faceIndexStatus = 'RUNNING';
  else faceIndexStatus = 'COMPLETE';

  await prisma.eventGallery.update({
    where: { id: galleryId },
    data: { faceIndexStatus },
  });
  return { total, indexed };
}

module.exports.refreshGalleryFaceStatus = refreshGalleryFaceStatus;
