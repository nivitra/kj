const express = require('express');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { body } = require('express-validator');
const rateLimit = require('express-rate-limit');
const { prisma } = require('../config/prisma');
const { authenticateCustomer } = require('../middleware/auth');
const { getSignedUploadUrl, getSignedPhotoUrl, buildSelfieKey, deletePrefix } = require('../services/s3');
const { enqueueFaceSearch, enqueueBroaderSearch } = require('../services/jobs');
const { resolveThreshold, BROADER_THRESHOLD } = require('../services/threshold');
const { ok, fail } = require('../lib/envelope');
const { CODES } = require('../lib/errors');
const { validate } = require('../lib/validate');

const router = express.Router();
router.use(authenticateCustomer);

const POLICY_VERSION = process.env.CONSENT_POLICY_VERSION || '1.0';
const SEARCH_TTL_MIN = parseInt(process.env.FACE_SEARCH_SESSION_TTL_MIN || '30', 10);
const SELFIE_MAX_MB = parseInt(process.env.SELFIE_MAX_MB || '8', 10);
const hash = (v) => (v ? crypto.createHash('sha256').update(String(v)).digest('hex').slice(0, 32) : null);

// Rate-limit selfie searches per customer (FACE-PIPELINE-PLAN.md §6).
const searchLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: parseInt(process.env.FACE_SEARCH_RATE_PER_HOUR || '5', 10),
  keyGenerator: (req) => req.customer.id,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => fail(res, CODES.RATE_LIMITED, 'Too many searches. Please try again later.', { status: 429, retryable: true }),
});

// Record consent before any selfie upload.
router.post('/consent', async (req, res) => {
  const consent = await prisma.consentRecord.create({
    data: {
      studioId: req.customer.studioId,
      customerId: req.customer.id,
      consentType: 'face_search',
      policyVersion: POLICY_VERSION,
      ipHash: hash(req.ip),
      userAgentHash: hash(req.headers['user-agent']),
    },
  });
  return ok(res, {
    consentId: consent.id,
    policyVersion: POLICY_VERSION,
    retentionNote: 'Selfies are deleted immediately after search. Face vectors are only stored for studio photos you have access to.',
    message: 'Photos that may include you — never an identity claim.',
  });
});

// Get a presigned selfie upload URL bound to a new search session.
router.post('/search/upload-url',
  body('consentId').isString().notEmpty(),
  body('contentType').isIn(['image/jpeg', 'image/png', 'image/webp']),
  body('galleryId').optional().isString(),
  validate,
  async (req, res) => {
    const consent = await prisma.consentRecord.findFirst({
      where: { id: req.body.consentId, customerId: req.customer.id, withdrawnAt: null },
    });
    if (!consent) return fail(res, CODES.CONSENT_REQUIRED, 'Consent is required before searching.', { status: 403 });

    // Optional gallery scope: customer must hold an active grant.
    let galleryId = req.guestGalleryId || req.body.galleryId || null;
    if (galleryId) {
      const grant = await prisma.accessGrant.findFirst({
        where: {
          customerId: req.customer.id,
          galleryId,
          gallery: { status: 'PUBLISHED', studioId: req.customer.studioId, faceSearchEnabled: true, deletedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
          AND: [{ OR: [{ faceSearchEnabled: null }, { faceSearchEnabled: true }] }],
        },
      });
      if (!grant) {
        return fail(res, CODES.GALLERY_NOT_ACCESSIBLE, 'This gallery is not available for face search.', { status: 403 });
      }
    }

    const { threshold } = await resolveThreshold({
      studioId: req.customer.studioId,
      galleryId: galleryId || undefined,
    });

    const sessionId = uuidv4();
    const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }[req.body.contentType] || '.jpg';
    const selfieKey = buildSelfieKey(sessionId, `${uuidv4()}${ext}`);
    const uploadUrl = await getSignedUploadUrl(selfieKey, req.body.contentType, 600);

    await prisma.faceSearchSession.create({
      data: {
        id: sessionId,
        studioId: req.customer.studioId,
        galleryId,
        customerId: req.customer.id,
        consentId: consent.id,
        selfieKey,
        status: 'CREATED',
        threshold,
        expiresAt: new Date(Date.now() + SEARCH_TTL_MIN * 60 * 1000),
      },
    });

    return ok(res, {
      sessionId,
      uploadUrl,
      maxBytes: SELFIE_MAX_MB * 1024 * 1024,
      threshold,
      expiresInSeconds: 600,
    });
  });

// Submit: selfie is uploaded → enqueue async search, return 202.
router.post('/search/submit',
  searchLimiter,
  body('sessionId').isString().notEmpty(),
  validate,
  async (req, res) => {
    const session = await prisma.faceSearchSession.findFirst({
      where: { id: req.body.sessionId, customerId: req.customer.id },
    });
    if (!session) return fail(res, CODES.NOT_FOUND, 'Search session not found', { status: 404 });
    if (!session.selfieKey) {
      return fail(res, CODES.VALIDATION, 'Selfie not uploaded for this session', { status: 400 });
    }
    if (session.expiresAt < new Date()) {
      return fail(res, CODES.VALIDATION, 'Search session expired. Start a new search.', { status: 410 });
    }

    await prisma.faceSearchSession.update({
      where: { id: session.id },
      data: { status: 'SEARCHING' },
    });
    await enqueueFaceSearch(session.id, {
      studioId: req.customer.studioId,
      customerId: req.customer.id,
    });
    return ok(res, { sessionId: session.id, status: 'SEARCHING' }, 202);
  });

// Poll session status.
router.get('/search/:sessionId', async (req, res) => {
  const session = await prisma.faceSearchSession.findFirst({
    where: { id: req.params.sessionId, customerId: req.customer.id },
    select: {
      id: true,
      status: true,
      matchCount: true,
      safeFailureCode: true,
      threshold: true,
      completedAt: true,
    },
  });
  if (!session) return fail(res, CODES.NOT_FOUND, 'Search session not found', { status: 404 });

  // Surface human-friendly copy for terminal states (never leak internals).
  const messages = {
    COMPLETED: 'Photos that may include you are ready.',
    NO_MATCH: 'We couldn\'t find matching photos. Try another selfie, or ask your studio.',
    REJECTED: 'We couldn\'t use that selfie. Please try again with a clearer photo of only you.',
    RATE_LIMITED: 'Too many searches. Please try again later.',
    FAILED: 'Something went wrong. Please try again.',
    EXPIRED: 'This search expired. Start a new one.',
  };

  return ok(res, {
    ...session,
    message: messages[session.status] || null,
    broaderAvailable: session.status === 'NO_MATCH' || (session.status === 'COMPLETED' && session.matchCount === 0),
    broaderThreshold: BROADER_THRESHOLD,
  });
});

// Paginated results with signed thumbnail/display URLs (no similarity shown).
router.get('/search/:sessionId/results', async (req, res) => {
  const session = await prisma.faceSearchSession.findFirst({
    where: { id: req.params.sessionId, customerId: req.customer.id },
  });
  if (!session) return fail(res, CODES.NOT_FOUND, 'Search session not found', { status: 404 });

  if (session.expiresAt <= new Date()) return fail(res, CODES.GALLERY_NOT_ACCESSIBLE, 'This search has expired. Start a new search.', { status: 410 });
  // Recheck access when results are read; a completed session must not keep
  // exposing photos after a gallery is unpublished, expired, or unassigned.
  const candidates = await prisma.faceSearchMatch.findMany({ where: { sessionId: session.id, includedInResult: true }, select: { photoId: true } });
  const allowed = await prisma.photo.findMany({ where: { id: { in: candidates.map(m => m.photoId) },
    gallery: { studioId: req.customer.studioId, status: 'PUBLISHED', deletedAt: null, faceSearchEnabled: true,
      ...(req.guestGalleryId && { id: req.guestGalleryId }),
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      accessGrants: { some: { customerId: req.customer.id,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        AND: [{ OR: [{ faceSearchEnabled: null }, { faceSearchEnabled: true }] }] } } } }, select: { id: true } });
  const matchWhere = { sessionId: session.id, includedInResult: true, photoId: { in: allowed.map(p => p.id) } };
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const limit = Math.min(100, parseInt(req.query.limit || '50', 10));
  const [matches, total] = await Promise.all([
    prisma.faceSearchMatch.findMany({
      where: matchWhere,
      orderBy: { rank: 'asc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.faceSearchMatch.count({
      where: matchWhere,
    }),
  ]);

  const photos = await prisma.photo.findMany({
    where: { id: { in: matches.map((m) => m.photoId) } },
  });
  const byId = Object.fromEntries(photos.map((p) => [p.id, p]));

  // Favorites for heart state in results UI.
  const favs = await prisma.favorite.findMany({
    where: {
      customerId: req.customer.id,
      photoId: { in: matches.map((m) => m.photoId) },
    },
    select: { photoId: true },
  });
  const favSet = new Set(favs.map((f) => f.photoId));

  const results = [];
  for (const m of matches) {
    const p = byId[m.photoId];
    if (!p) continue;
    results.push({
      id: p.id,
      galleryId: p.galleryId,
      filename: p.filename,
      thumbnailUrl: await getSignedPhotoUrl(p.thumbnailKey),
      previewUrl: await getSignedPhotoUrl(p.previewKey),
      isFavorite: favSet.has(p.id),
      // similarity intentionally omitted from customer payload
    });
  }

  return ok(res, {
    status: session.status,
    page,
    limit,
    total,
    disclaimer: 'Photos that may include you.',
    results,
  });
});

// Explicit "broader search" opt-in after NO_MATCH / low results (plan §6 tiers).
router.post('/search/:sessionId/broader',
  searchLimiter,
  body('confirm').custom((v) => v === true || v === 'true').withMessage('confirm must be true'),
  validate,
  async (req, res) => {
    const session = await prisma.faceSearchSession.findFirst({
      where: { id: req.params.sessionId, customerId: req.customer.id },
    });
    if (!session) return fail(res, CODES.NOT_FOUND, 'Search session not found', { status: 404 });
    if (!['NO_MATCH', 'COMPLETED'].includes(session.status)) {
      return fail(res, CODES.VALIDATION, 'Broader search is only available after a completed search.', { status: 400 });
    }

    await prisma.faceSearchSession.update({
      where: { id: session.id },
      data: { status: 'SEARCHING', threshold: BROADER_THRESHOLD },
    });
    await enqueueBroaderSearch(session.id, { studioId: req.customer.studioId });
    return ok(res, { sessionId: session.id, status: 'SEARCHING', threshold: BROADER_THRESHOLD }, 202);
  });

// Explicit early selfie delete.
router.post('/search/:sessionId/delete-selfie', async (req, res) => {
  const session = await prisma.faceSearchSession.findFirst({
    where: { id: req.params.sessionId, customerId: req.customer.id },
  });
  if (!session) return fail(res, CODES.NOT_FOUND, 'Search session not found', { status: 404 });
  await deletePrefix(`temporary-face-search/${session.id}/`);
  await prisma.faceSearchSession.update({ where: { id: session.id }, data: { selfieKey: null } });
  return ok(res, { deleted: true });
});

// Customer data deletion (face search data) — plan §10.
router.post('/data/delete', async (req, res) => {
  const sessions = await prisma.faceSearchSession.findMany({
    where: { customerId: req.customer.id },
    select: { id: true },
  });
  for (const s of sessions) {
    try { await deletePrefix(`temporary-face-search/${s.id}/`); } catch (_) { /* best effort */ }
  }
  await prisma.faceSearchMatch.deleteMany({ where: { sessionId: { in: sessions.map((s) => s.id) } } });
  await prisma.faceSearchSession.deleteMany({ where: { customerId: req.customer.id } });
  await prisma.consentRecord.updateMany({
    where: { customerId: req.customer.id, withdrawnAt: null },
    data: { withdrawnAt: new Date() },
  });
  return ok(res, { deleted: true });
});

module.exports = router;
