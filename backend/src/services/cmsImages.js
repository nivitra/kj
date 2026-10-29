/**
 * Production CMS image pipeline (portfolio / packages / announcements / profile).
 *
 * Gallery photos already get thumb+display WebP via imageProcessor.
 * CMS uploads were serving multi‑MB camera masters for 140px cards — unusable on mobile.
 *
 * Convention (no schema change):
 *   studios/{id}/portfolio/foo.jpeg
 *     → studios/{id}/cms/thumb/portfolio/foo.webp
 *     → studios/{id}/cms/display/portfolio/foo.webp
 */
const sharp = require('sharp');
const {
  uploadToS3,
  getObjectBuffer,
  getSignedPhotoUrl,
  headObject,
} = require('./s3');
const { logger } = require('../utils/logger');

const THUMB_W = parseInt(process.env.CMS_THUMB_WIDTH || '720', 10);
const DISPLAY_W = parseInt(process.env.CMS_DISPLAY_WIDTH || '1600', 10);
const THUMB_Q = parseInt(process.env.CMS_THUMB_QUALITY || '72', 10);
const DISPLAY_Q = parseInt(process.env.CMS_DISPLAY_QUALITY || '80', 10);

const VIDEO_RE = /\.(mp4|mov|webm|m4v)$/i;
const IMAGE_RE = /\.(jpe?g|png|webp|heic|heif|tiff?|gif)$/i;

/** Map original key → derivative key */
function cmsDerivKey(originalKey, variant /* thumb | display */) {
  if (!originalKey || typeof originalKey !== 'string') return null;
  if (originalKey.includes('/cms/thumb/') || originalKey.includes('/cms/display/')) {
    return originalKey; // already a derivative
  }
  const m = originalKey.match(/^(studios\/[^/]+)\/(.+)$/);
  if (!m) return null;
  const studioPrefix = m[1];
  const rest = m[2].replace(/\.[^.]+$/, ''); // strip extension
  return `${studioPrefix}/cms/${variant}/${rest}.webp`;
}

function isVideoKey(key) {
  return VIDEO_RE.test(key || '');
}

function isProbablyImageKey(key) {
  if (!key) return false;
  if (isVideoKey(key)) return false;
  if (IMAGE_RE.test(key)) return true;
  // Keys without extension still may be images
  return !/\/videos\//i.test(key);
}

/**
 * Create thumb + display WebP from a buffer; upload next to CMS path.
 * @returns {{ thumbKey: string, displayKey: string }}
 */
async function processCmsBuffer(buffer, originalKey) {
  if (!buffer?.length || !originalKey || isVideoKey(originalKey)) {
    return { thumbKey: null, displayKey: null };
  }
  const thumbKey = cmsDerivKey(originalKey, 'thumb');
  const displayKey = cmsDerivKey(originalKey, 'display');
  if (!thumbKey || !displayKey) return { thumbKey: null, displayKey: null };

  const base = sharp(buffer).rotate();
  const cache = { cacheControl: 'public, max-age=31536000, immutable' };

  const [thumbBuf, displayBuf] = await Promise.all([
    base
      .clone()
      .resize(THUMB_W, null, { withoutEnlargement: true, fit: 'inside' })
      .webp({ quality: THUMB_Q, effort: 4, smartSubsample: true })
      .toBuffer(),
    base
      .clone()
      .resize(DISPLAY_W, null, { withoutEnlargement: true, fit: 'inside' })
      .webp({ quality: DISPLAY_Q, effort: 4, smartSubsample: true })
      .toBuffer(),
  ]);

  await Promise.all([
    uploadToS3(thumbKey, thumbBuf, 'image/webp', cache),
    uploadToS3(displayKey, displayBuf, 'image/webp', cache),
  ]);

  return { thumbKey, displayKey, thumbBytes: thumbBuf.length, displayBytes: displayBuf.length };
}

/** Process image already on S3 (backfill / lazy ensure). */
async function ensureCmsDerivatives(originalKey, { force = false } = {}) {
  if (!originalKey || isVideoKey(originalKey) || !isProbablyImageKey(originalKey)) {
    return { skipped: true };
  }
  const thumbKey = cmsDerivKey(originalKey, 'thumb');
  const displayKey = cmsDerivKey(originalKey, 'display');
  if (!force) {
    const [t, d] = await Promise.all([headObject(thumbKey), headObject(displayKey)]);
    if (t.exists && d.exists) return { thumbKey, displayKey, cached: true };
  }
  try {
    const buf = await getObjectBuffer(originalKey);
    const out = await processCmsBuffer(buf, originalKey);
    return { ...out, cached: false };
  } catch (err) {
    logger.warn(`[cmsImages] ensure failed ${originalKey}: ${err.message}`);
    return { error: err.message };
  }
}

// Fire-and-forget set so we don't hammer S3 for the same missing key
const _pendingEnsure = new Set();

/**
 * Signed URL for CMS assets.
 * @param {'thumb'|'display'|'original'} variant
 * list/grid → thumb; lightbox → display; never use original for UI cards
 */
async function signCmsUrl(originalKey, variant = 'thumb') {
  if (!originalKey) return null;
  if (isVideoKey(originalKey)) {
    return getSignedPhotoUrl(originalKey, 3600);
  }
  if (variant === 'original') {
    return getSignedPhotoUrl(originalKey, 3600);
  }

  const derivKey = cmsDerivKey(originalKey, variant === 'display' ? 'display' : 'thumb');
  if (derivKey) {
    const head = await headObject(derivKey);
    if (head.exists) {
      return getSignedPhotoUrl(derivKey, 3600);
    }
    // Lazy ensure once (non-blocking) so next request is fast
    if (!_pendingEnsure.has(originalKey)) {
      _pendingEnsure.add(originalKey);
      ensureCmsDerivatives(originalKey)
        .catch(() => {})
        .finally(() => _pendingEnsure.delete(originalKey));
    }
  }
  // Fallback: original (slow) until backfill catches up
  return getSignedPhotoUrl(originalKey, 3600);
}

/** Batch sign many keys as thumbs (parallel, capped). */
async function signCmsUrls(keys, variant = 'thumb') {
  const unique = [...new Set((keys || []).filter(Boolean))];
  const out = new Map();
  const concurrency = 8;
  let i = 0;
  async function worker() {
    while (i < unique.length) {
      const idx = i++;
      const k = unique[idx];
      out.set(k, await signCmsUrl(k, variant));
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, unique.length || 1) }, () => worker()));
  return out;
}

module.exports = {
  cmsDerivKey,
  processCmsBuffer,
  ensureCmsDerivatives,
  signCmsUrl,
  signCmsUrls,
  isVideoKey,
  THUMB_W,
  DISPLAY_W,
};
