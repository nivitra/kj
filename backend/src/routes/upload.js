const express = require('express');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { body } = require('express-validator');
const { prisma } = require('../config/prisma');
const { authenticateAdmin } = require('../middleware/auth');
const { getSignedUploadUrl, headObject, buildS3Key, deleteFromS3 } = require('../services/s3');
const { enqueueDerivatives, enqueueFaceDelete } = require('../services/jobs');
const { ok, fail } = require('../lib/envelope');
const { CODES } = require('../lib/errors');
const { validate } = require('../lib/validate');

const router = express.Router();
router.use(authenticateAdmin);

const EXT_BY_MIME = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/heic': '.heic',
  'image/heif': '.heif',
  'image/tiff': '.tiff',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/webm': '.webm',
};

const VIDEO_MIMES = new Set(['video/mp4', 'video/quicktime', 'video/webm']);
const IMAGE_MIMES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/tiff',
]);

const MAX_UPLOAD_MB = parseInt(process.env.MAX_UPLOAD_MB || '200', 10);
const MAX_VIDEO_UPLOAD_MB = parseInt(process.env.MAX_VIDEO_UPLOAD_MB || '500', 10);
const PRESIGN_TTL = parseInt(process.env.PRESIGN_UPLOAD_TTL || '900', 10);

const ownGallery = async (req, res) => {
  const gallery = await prisma.eventGallery.findFirst({
    where: { id: req.params.galleryId, studioId: req.studioId },
  });
  if (!gallery) fail(res, CODES.NOT_FOUND, 'Gallery not found', { status: 404 });
  return gallery;
};

function mediaTypeForMime(mime) {
  if (VIDEO_MIMES.has(mime)) return 'VIDEO';
  return 'IMAGE';
}

async function deletePhotoHard(photo, studioId) {
  if (photo.faceIndexed || (photo.photoFaces && photo.photoFaces.length)) {
    await enqueueFaceDelete(photo.id, { studioId });
    // Wait a tick is not possible; worker deletes. For replace we mark invisible + soft-replace via new row.
    await prisma.photo.update({
      where: { id: photo.id },
      data: { isVisibleToCustomers: false, ingestionStatus: 'DELETED', processingStatus: 'FAILED' },
    }).catch(() => {});
    return;
  }
  await Promise.all([
    photo.originalKey && deleteFromS3(photo.originalKey),
    photo.thumbnailKey && deleteFromS3(photo.thumbnailKey),
    photo.previewKey && deleteFromS3(photo.previewKey),
    photo.posterKey && deleteFromS3(photo.posterKey),
  ].filter(Boolean)).catch(() => {});
  await prisma.photo.delete({ where: { id: photo.id } }).catch(() => {});
}

// Check filename collisions before register (large bulk uploads OK).
router.post(
  '/gallery/:galleryId/check-duplicates',
  body('names').isArray({ min: 1, max: 2000 }),
  validate,
  async (req, res) => {
    const gallery = await ownGallery(req, res);
    if (!gallery) return;
    const names = (req.body.names || []).map((n) => String(n || '').trim()).filter(Boolean);
    // Prefer live / complete rows over FAILED ghosts when names collide
    const existing = await prisma.photo.findMany({
      where: {
        galleryId: gallery.id,
        filename: { in: names },
        ingestionStatus: { notIn: ['DELETED', 'REJECTED'] },
      },
      select: {
        id: true,
        filename: true,
        mediaType: true,
        fileSize: true,
        createdAt: true,
        ingestionStatus: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    const byName = new Map();
    for (const p of existing) {
      if (!byName.has(p.filename)) byName.set(p.filename, p);
      else if (p.ingestionStatus !== 'FAILED' && byName.get(p.filename).ingestionStatus === 'FAILED') {
        byName.set(p.filename, p);
      }
    }
    return ok(res, {
      conflicts: names.map((name) => ({
        name,
        existing: byName.get(name)
          ? {
              id: byName.get(name).id,
              filename: byName.get(name).filename,
              mediaType: byName.get(name).mediaType,
              fileSize: byName.get(name).fileSize,
              createdAt: byName.get(name).createdAt,
              ingestionStatus: byName.get(name).ingestionStatus,
            }
          : null,
      })),
    });
  },
);

// 1) Register a manifest batch → create REGISTERED photo rows + presigned PUT URLs.
// Optional per-file: { name, type, size, onDuplicate: 'replace'|'keep_both', replacePhotoId? }
router.post(
  '/gallery/:galleryId/register',
  body('files').isArray({ min: 1, max: 500 }),
  body('uploadQuality').optional().isInt({ min: 40, max: 100 }),
  validate,
  async (req, res) => {
    const gallery = await ownGallery(req, res);
    if (!gallery) return;
    const { files, uploadQuality } = req.body;

    if (uploadQuality != null) {
      await prisma.eventGallery.update({ where: { id: gallery.id }, data: { uploadQuality } });
    }

    const items = [];
    for (const f of files) {
      const mime = (f.type || '').toLowerCase() || 'image/jpeg';
      const isVideo = VIDEO_MIMES.has(mime);
      const isImage = IMAGE_MIMES.has(mime);
      const ext = EXT_BY_MIME[mime] || (f.name ? path.extname(f.name).toLowerCase() : isVideo ? '.mp4' : '.jpg');

      if (!isVideo && !isImage) {
        items.push({ clientRef: f.name, error: 'unsupported_type' });
        continue;
      }

      const maxMb = isVideo ? MAX_VIDEO_UPLOAD_MB : MAX_UPLOAD_MB;
      if (f.size && f.size > maxMb * 1024 * 1024) {
        items.push({ clientRef: f.name, error: 'too_large' });
        continue;
      }

      let filename = f.name || `${uuidv4()}${ext}`;
      const onDuplicate = (f.onDuplicate || 'keep_both').toString();
      const mediaType = mediaTypeForMime(mime);

      if (onDuplicate === 'replace') {
        const existing = f.replacePhotoId
          ? await prisma.photo.findFirst({
              where: { id: f.replacePhotoId, galleryId: gallery.id },
              include: { photoFaces: { take: 1 } },
            })
          : await prisma.photo.findFirst({
              where: {
                galleryId: gallery.id,
                filename,
                ingestionStatus: { notIn: ['DELETED', 'REJECTED'] },
              },
              include: { photoFaces: { take: 1 } },
            });
        if (existing) {
          await deletePhotoHard(existing, req.studioId);
        }
      } else if (onDuplicate === 'keep_both') {
        const clash = await prisma.photo.findFirst({
          where: {
            galleryId: gallery.id,
            filename,
            ingestionStatus: { notIn: ['DELETED', 'REJECTED'] },
          },
          select: { id: true },
        });
        if (clash) {
          const base = path.basename(filename, path.extname(filename));
          const e = path.extname(filename) || ext;
          let n = 2;
          // Find free name
          // eslint-disable-next-line no-constant-condition
          while (true) {
            const candidate = `${base} (${n})${e}`;
            const hit = await prisma.photo.findFirst({
              where: {
                galleryId: gallery.id,
                filename: candidate,
                ingestionStatus: { notIn: ['DELETED', 'REJECTED'] },
              },
              select: { id: true },
            });
            if (!hit) {
              filename = candidate;
              break;
            }
            n += 1;
            if (n > 999) break;
          }
        }
      }

      const photoId = uuidv4();
      const folder = isVideo ? 'videos' : 'originals';
      const originalKey = buildS3Key(req.studioId, gallery.id, folder, `${photoId}${ext}`);
      await prisma.photo.create({
        data: {
          id: photoId,
          galleryId: gallery.id,
          originalKey,
          filename,
          fileSize: f.size || 0,
          mimeType: mime,
          mediaType,
          ingestionStatus: 'REGISTERED',
          processingStatus: 'PENDING',
        },
      });
      const uploadUrl = await getSignedUploadUrl(originalKey, mime, PRESIGN_TTL);
      items.push({
        photoId,
        clientRef: f.name,
        filename,
        mediaType,
        uploadUrl,
      });
    }
    return ok(res, { items });
  },
);

// 2) Confirm uploaded objects exist → flip to UPLOADED and enqueue processing.
router.post(
  '/gallery/:galleryId/complete',
  body('photoIds').isArray({ min: 1, max: 500 }),
  validate,
  async (req, res) => {
    const gallery = await ownGallery(req, res);
    if (!gallery) return;

    const confirmed = [];
    const missing = [];
    const photos = await prisma.photo.findMany({
      where: { id: { in: req.body.photoIds }, galleryId: gallery.id },
    });
    for (const photo of photos) {
      const head = await headObject(photo.originalKey);
      if (!head.exists) {
        missing.push(photo.id);
        continue;
      }
      await prisma.photo.update({
        where: { id: photo.id },
        data: { ingestionStatus: 'UPLOADED', fileSize: head.size || photo.fileSize },
      });
      await enqueueDerivatives(photo.id, { studioId: req.studioId, galleryId: gallery.id });
      confirmed.push(photo.id);
    }

    await prisma.auditLog.create({
      data: {
        adminId: req.admin.id,
        galleryId: gallery.id,
        action: 'PHOTO_UPLOADED',
        entityType: 'photo',
        details: { confirmed: confirmed.length, missing: missing.length },
      },
    });
    return ok(res, { confirmed, missing });
  },
);

// 3) Live processing status (per-state counts + a failed list for the UI).
router.get('/gallery/:galleryId/status', async (req, res) => {
  const gallery = await ownGallery(req, res);
  if (!gallery) return;

  const counts = await prisma.photo.groupBy({
    by: ['ingestionStatus'],
    where: { galleryId: gallery.id },
    _count: true,
  });
  const map = Object.fromEntries(counts.map((c) => [c.ingestionStatus, c._count]));
  const mediaCounts = await prisma.photo.groupBy({
    by: ['mediaType'],
    where: {
      galleryId: gallery.id,
      ingestionStatus: { notIn: ['DELETED', 'REJECTED'] },
    },
    _count: true,
  });
  const mediaMap = Object.fromEntries(mediaCounts.map((c) => [c.mediaType || 'IMAGE', c._count]));
  const failed = await prisma.photo.findMany({
    where: { galleryId: gallery.id, ingestionStatus: { in: ['FAILED', 'REJECTED'] } },
    select: { id: true, filename: true, lastErrorCode: true, lastErrorMessageSafe: true, mediaType: true },
    take: 200,
  });
  return ok(res, {
    total: Object.values(map).reduce((a, b) => a + b, 0),
    registered: map.REGISTERED || 0,
    uploaded: map.UPLOADED || 0,
    processing: map.PROCESSING || 0,
    complete: (map.COMPLETE || 0) + (map.INDEXED || 0) + (map.PARTIAL || 0),
    failed: (map.FAILED || 0) + (map.REJECTED || 0),
    failedList: failed,
    images: mediaMap.IMAGE || 0,
    videos: mediaMap.VIDEO || 0,
  });
});

// 4) One-click re-enqueue of failed photos.
router.post('/gallery/:galleryId/retry-failed', async (req, res) => {
  const gallery = await ownGallery(req, res);
  if (!gallery) return;
  const failed = await prisma.photo.findMany({
    where: { galleryId: gallery.id, ingestionStatus: 'FAILED' },
    select: { id: true },
  });
  for (const p of failed) {
    await prisma.photo.update({
      where: { id: p.id },
      data: { ingestionStatus: 'UPLOADED', lastErrorCode: null, lastErrorMessageSafe: null },
    });
    await enqueueDerivatives(p.id, { studioId: req.studioId, galleryId: gallery.id });
  }
  return ok(res, { requeued: failed.length });
});

module.exports = router;
