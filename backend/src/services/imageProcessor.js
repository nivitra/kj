const crypto = require('crypto');
const sharp = require('sharp');
const { uploadToS3, buildS3Key, getObjectBuffer } = require('./s3');
const { applyWatermark } = require('./watermark');
const { prisma } = require('../config/prisma');
const { withLock } = require('./lock');
const { AppError, CODES } = require('../lib/errors');
const { logger } = require('../utils/logger');

// Equilibrium defaults (override via env):
// - Thumbs: grid / strip / first paint — sharp enough on 3-col mobile, still tiny.
// - Display: full-screen lightbox on phones/tablets with light pinch-zoom headroom.
//   1600px WebP ~q80 is ~35–50% smaller than 2048@85 with little visible loss on
//   phone screens (device CSS width × DPR rarely exceeds ~1300).
const THUMBNAIL_WIDTH = parseInt(process.env.THUMBNAIL_WIDTH || '480', 10);
const DISPLAY_WIDTH = parseInt(process.env.DISPLAY_WIDTH || '1600', 10);
const THUMBNAIL_QUALITY = parseInt(process.env.THUMBNAIL_QUALITY || '74', 10);
const DISPLAY_QUALITY = parseInt(process.env.DISPLAY_QUALITY || '80', 10);
// sharp WebP effort 0–6; 4 is a good CPU vs size trade-off for the worker.
const WEBP_EFFORT = parseInt(process.env.WEBP_EFFORT || '4', 10);

const webpOpts = (quality) => ({
  quality,
  effort: WEBP_EFFORT,
  smartSubsample: true,
});

// Accepted image containers (validated by magic bytes, not client MIME).
const ALLOWED_MIME = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/tiff',
]);

const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

// Validate an uploaded object's real type from its bytes. Throws a permanent
// UNSUPPORTED_MEDIA error (not retryable) on anything we can't decode.
const validateImageBuffer = async (buffer) => {
  const { fileTypeFromBuffer } = await import('file-type');
  const type = await fileTypeFromBuffer(buffer);
  if (!type || !ALLOWED_MIME.has(type.mime)) {
    throw new AppError(CODES.UNSUPPORTED_MEDIA, 'File is not a supported image', { status: 422, retryable: false });
  }
  return type.mime;
};

const markFailed = async (photoId, code, message, permanent = true) => {
  await prisma.photo.update({
    where: { id: photoId },
    data: {
      ingestionStatus: permanent ? 'REJECTED' : 'FAILED',
      processingStatus: 'FAILED',
      lastErrorCode: code,
      lastErrorMessageSafe: message,
    },
  });
};

const VIDEO_MIMES = new Set(['video/mp4', 'video/quicktime', 'video/webm']);

/** Best-effort poster frame via ffmpeg if available on PATH. */
const tryExtractVideoPoster = async (originalBuffer, outPath) => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { spawnSync } = require('child_process');
  const tmpIn = path.join(os.tmpdir(), `vid-in-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  try {
    fs.writeFileSync(tmpIn, originalBuffer);
    const r = spawnSync(
      'ffmpeg',
      ['-y', '-ss', '00:00:01', '-i', tmpIn, '-frames:v', '1', '-q:v', '3', outPath],
      { timeout: 60000, encoding: 'utf8' },
    );
    if (r.status !== 0 || !fs.existsSync(outPath)) return null;
    return fs.readFileSync(outPath);
  } catch {
    return null;
  } finally {
    try { fs.unlinkSync(tmpIn); } catch (_) { /* ignore */ }
    try { fs.unlinkSync(outPath); } catch (_) { /* ignore */ }
  }
};

// Core worker step: download original from S3, validate, derive thumbnail +
// display (with optional watermark), upload derivatives, and update the row.
// FACE-PIPELINE-PLAN.md §5. Videos: mark visible + optional poster frame.
/**
 * @param {string} photoId
 * @param {{ force?: boolean }} [opts] force=true regenerates derivatives even if present
 */
const processPhoto = async (photoId, opts = {}) => {
  const force = opts.force === true;
  const locked = await withLock(`derive:${photoId}`, 15 * 60 * 1000, async () => {
    const photo = await prisma.photo.findUnique({ where: { id: photoId }, include: { gallery: true } });
    if (!photo) throw new AppError(CODES.NOT_FOUND, 'Photo not found', { status: 404, retryable: false });

    // Idempotent short-circuit once derivatives exist (images) or video complete.
    // force: true re-derives display/thumb from original (size/quality upgrades).
    if (!force
      && ['INDEXED', 'COMPLETE', 'PARTIAL'].includes(photo.ingestionStatus)
      && (photo.previewKey || photo.mediaType === 'VIDEO')) {
      return { displayKey: photo.previewKey, skipped: true };
    }

    const gallery = photo.gallery;
    const studioId = gallery.studioId;
    const isVideo = photo.mediaType === 'VIDEO' || VIDEO_MIMES.has((photo.mimeType || '').toLowerCase());

    await prisma.photo.update({
      where: { id: photoId },
      data: {
        ingestionStatus: 'PROCESSING',
        processingStatus: 'PROCESSING',
        processingAttempts: { increment: 1 },
        ...(isVideo ? { mediaType: 'VIDEO' } : {}),
      },
    });

    let original;
    try {
      original = await getObjectBuffer(photo.originalKey);
    } catch (err) {
      if (err?.$metadata?.httpStatusCode !== 404 && !['NoSuchKey', 'NotFound'].includes(err?.name)) {
        await markFailed(photoId, 'STORAGE_UNAVAILABLE', 'Could not read the original. Processing will retry.', false);
        throw err;
      }
      await markFailed(photoId, 'S3_MISSING', 'Original object missing in storage', true);
      throw new AppError(CODES.NOT_FOUND, 'Original object missing', { status: 404, retryable: false });
    }

    // ── Video path: optional poster + mark complete (no face index) ────────
    if (isVideo) {
      const digest = sha256(original);
      let posterKey = null;
      let thumbKey = null;
      try {
        const path = require('path');
        const os = require('os');
        const outPath = path.join(os.tmpdir(), `poster-${photoId}.jpg`);
        const posterBuf = await tryExtractVideoPoster(original, outPath);
        if (posterBuf) {
          posterKey = buildS3Key(studioId, photo.galleryId, 'posters', `${photoId}.jpg`);
          thumbKey = buildS3Key(studioId, photo.galleryId, 'thumbnails', `${photoId}.webp`);
          await uploadToS3(posterKey, posterBuf, 'image/jpeg');
          const thumb = await sharp(posterBuf)
            .resize(THUMBNAIL_WIDTH, null, { withoutEnlargement: true, fit: 'inside' })
            .webp(webpOpts(THUMBNAIL_QUALITY))
            .toBuffer();
          await uploadToS3(thumbKey, thumb, 'image/webp', { cacheControl: 'public, max-age=31536000, immutable' });
        }
      } catch (err) {
        logger.warn(`Video poster failed for ${photoId}: ${err.message}`);
      }

      await prisma.photo.update({
        where: { id: photoId },
        data: {
          mediaType: 'VIDEO',
          sha256: digest,
          posterKey,
          thumbnailKey: thumbKey,
          previewKey: posterKey,
          ingestionStatus: 'COMPLETE',
          processingStatus: 'COMPLETE',
          isVisibleToCustomers: true,
          lastErrorCode: posterKey ? null : 'NO_POSTER',
          lastErrorMessageSafe: posterKey ? null : 'Video stored; poster frame unavailable (install ffmpeg for previews)',
        },
      });
      logger.info(`Processed video ${photoId}`);
      return { video: true, posterKey };
    }

    try {
      await validateImageBuffer(original);
    } catch (err) {
      await markFailed(photoId, CODES.UNSUPPORTED_MEDIA, err.message, true);
      throw err;
    }

    const digest = sha256(original);

    // Reject duplicates within the gallery (idempotency + cost control).
    const dupe = await prisma.photo.findFirst({
      where: { galleryId: photo.galleryId, sha256: digest, id: { not: photoId }, previewKey: { not: null } },
    });
    if (dupe) {
      // Copy derivative pointers from the existing photo so the UI is not blank.
      await prisma.photo.update({
        where: { id: photoId },
        data: {
          ingestionStatus: 'COMPLETE',
          processingStatus: 'COMPLETE',
          sha256: null,
          thumbnailKey: dupe.thumbnailKey,
          previewKey: dupe.previewKey,
          width: dupe.width,
          height: dupe.height,
          isVisibleToCustomers: true,
          lastErrorCode: 'DUPLICATE',
          lastErrorMessageSafe: 'Duplicate of an existing photo (reusing derivatives)',
        },
      });
      return { duplicate: true, reusedFrom: dupe.id };
    }

    let base;
    let metadata;
    try {
      // Correct EXIF orientation; Sharp drops EXIF metadata on re-encode (privacy).
      base = sharp(original).rotate();
      metadata = await base.metadata();
      // Input metadata precedes rotate(); persist the oriented dimensions.
      if ([5, 6, 7, 8].includes(metadata.orientation)) {
        [metadata.width, metadata.height] = [metadata.height, metadata.width];
      }
    } catch (err) {
      await markFailed(photoId, CODES.UNSUPPORTED_MEDIA, 'Image could not be decoded', true);
      throw new AppError(CODES.UNSUPPORTED_MEDIA, 'Image could not be decoded', { status: 422, retryable: false });
    }

    // Capture timestamp for ranking; never keep full EXIF in the derivative.
    let capturedAt = null;
    if (metadata.exif) {
      try {
        // Sharp exposes orientation-corrected metadata; DateTimeOriginal is not
        // always parsed — fall back to file mtime-less null. We try tiff tags.
        const exif = metadata.exif;
        // Keep null if unparseable; ranking still works via photoId tiebreak.
        void exif;
      } catch (_) { /* ignore */ }
    }

    const watermark = photo.gallery.watermarkEnabled ?? await studioWatermarkDefault(studioId);

    let thumbBuffer = await base
      .clone()
      .resize(THUMBNAIL_WIDTH, null, { withoutEnlargement: true, fit: 'inside' })
      .webp(webpOpts(THUMBNAIL_QUALITY))
      .toBuffer();
    let displayBuffer = await base
      .clone()
      .resize(DISPLAY_WIDTH, null, { withoutEnlargement: true, fit: 'inside' })
      .webp(webpOpts(DISPLAY_QUALITY))
      .toBuffer();

    if (watermark) {
      const thumbMeta = await sharp(thumbBuffer).metadata();
      const dispMeta = await sharp(displayBuffer).metadata();
      thumbBuffer = await applyWatermark(thumbBuffer, { width: thumbMeta.width, height: thumbMeta.height, tiled: false });
      displayBuffer = await applyWatermark(displayBuffer, { width: dispMeta.width, height: dispMeta.height, tiled: true });
    }

    const stem = photoId;
    // Derivatives only — NEVER rewrite originalKey (downloads stay 100% pure masters).
    const thumbKey = buildS3Key(studioId, photo.galleryId, 'thumbnails', `${stem}.webp`);
    const displayKey = buildS3Key(studioId, photo.galleryId, 'display', `${stem}.webp`);
    const cacheForever = { cacheControl: 'public, max-age=31536000, immutable' };

    await Promise.all([
      uploadToS3(thumbKey, thumbBuffer, 'image/webp', cacheForever),
      uploadToS3(displayKey, displayBuffer, 'image/webp', cacheForever),
    ]);

    try {
      // Keep INDEXED if faces were already extracted (force re-derive must not demote).
      const keepIndexed = photo.ingestionStatus === 'INDEXED' || photo.ingestionStatus === 'PARTIAL';
      await prisma.photo.update({
        where: { id: photoId },
        data: {
          thumbnailKey: thumbKey,
          previewKey: displayKey,
          sha256: digest,
          width: metadata.width,
          height: metadata.height,
          capturedAt,
          ingestionStatus: keepIndexed ? photo.ingestionStatus : 'COMPLETE',
          processingStatus: 'COMPLETE',
          isVisibleToCustomers: true,
          lastErrorCode: null,
          lastErrorMessageSafe: null,
        },
      });
    } catch (err) {
      // Race: another concurrent job stored the same sha256 first.
      const msg = String(err?.message || err || '');
      const isUnique = err?.code === 'P2002' || /Unique constraint failed/i.test(msg) || /galleryId.*sha256/i.test(msg);
      if (isUnique) {
        const existing = await prisma.photo.findFirst({
          where: { galleryId: photo.galleryId, sha256: digest, NOT: { id: photoId } },
        });
        await prisma.photo.update({
          where: { id: photoId },
          data: {
            thumbnailKey: existing?.thumbnailKey || thumbKey,
            previewKey: existing?.previewKey || displayKey,
            // Leave sha256 null so this row never collides with the original.
            sha256: null,
            width: metadata.width || existing?.width,
            height: metadata.height || existing?.height,
            ingestionStatus: 'COMPLETE',
            processingStatus: 'COMPLETE',
            isVisibleToCustomers: true,
            lastErrorCode: 'DUPLICATE',
            lastErrorMessageSafe: 'Duplicate photo (reusing derivatives)',
          },
        });
        logger.info(`Processed photo ${photoId} as duplicate of ${existing?.id || 'unknown'}`);
        return { duplicate: true, race: true };
      }
      throw err;
    }

    logger.info(`Processed photo ${photoId}`);
    return { displayKey, faceEnabled: gallery.faceSearchEnabled };
  });

  if (locked?.skipped && locked.reason === 'locked') {
    return { skipped: true, reason: 'locked' };
  }
  return locked;
};

const studioWatermarkDefault = async (studioId) => {
  const settings = await prisma.pricingSettings.findUnique({ where: { studioId } });
  return settings ? settings.watermarkEnabled : true;
};

module.exports = {
  processPhoto,
  validateImageBuffer,
  sha256,
  THUMBNAIL_WIDTH,
  DISPLAY_WIDTH,
  THUMBNAIL_QUALITY,
  DISPLAY_QUALITY,
};
