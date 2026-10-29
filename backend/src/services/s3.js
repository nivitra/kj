const {
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { s3Client, S3_BUCKET, CLOUDFRONT_DOMAIN } = require('../config/aws');

const uploadToS3 = async (key, buffer, contentType, opts = {}) => {
  const params = {
    Bucket: S3_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType,
    ServerSideEncryption: 'AES256',
  };
  if (opts.contentDisposition) {
    params.ContentDisposition = opts.contentDisposition;
  }
  if (opts.cacheControl) {
    params.CacheControl = opts.cacheControl;
  }
  await s3Client.send(new PutObjectCommand(params));
  return key;
};

// In-process cache for S3 presigns (no CloudFront). Cuts crypto cost when portal
// home/portfolio/packages re-sign the same CMS keys on every request.
const _signCache = new Map(); // key -> { url, expMs }
const SIGN_CACHE_MAX = 4000;

// Signed GET. Prefer CloudFront when configured (public CDN edge over a private
// origin); otherwise a time-limited S3 signed URL.
const getSignedPhotoUrl = async (key, expiresInSeconds = 3600) => {
  if (!key) return null;
  const now = Date.now();
  // Refresh 5 min before expiry so clients never hit a near-dead URL.
  const cacheTtlMs = Math.max(0, (expiresInSeconds - Math.min(300, expiresInSeconds / 2)) * 1000);
  const cacheKey = `${expiresInSeconds}:${key}`;
  const cached = _signCache.get(cacheKey);
  if (cached && cached.expMs > now) return cached.url;

  const command = new GetObjectCommand({ Bucket: S3_BUCKET, Key: key });
  const url = await getSignedUrl(s3Client, command, { expiresIn: expiresInSeconds });
  if (_signCache.size >= SIGN_CACHE_MAX) {
    // Drop oldest ~10%
    let i = 0;
    for (const k of _signCache.keys()) {
      _signCache.delete(k);
      if (++i > SIGN_CACHE_MAX / 10) break;
    }
  }
  _signCache.set(cacheKey, { url, expMs: now + cacheTtlMs });
  return url;
};

/**
 * Always return a true S3 pre-signed GET URL (never bare CloudFront).
 * Required for private objects like invoice PDFs that are not publicly readable
 * through the CDN distribution.
 */
const getSignedDownloadUrl = async (key, expiresInSeconds = 900, opts = {}) => {
  if (!key) return null;
  const command = new GetObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
    ...(opts.contentType ? { ResponseContentType: opts.contentType } : {}),
    ...(opts.contentDisposition
      ? { ResponseContentDisposition: opts.contentDisposition }
      : {}),
  });
  return getSignedUrl(s3Client, command, { expiresIn: expiresInSeconds });
};

/**
 * True only for camera/upload masters.
 * STRICT: must live under /originals/ or /videos/.
 * Never treat display WebP, thumbnails, or video posters as downloadable originals.
 * Preview reprocess (imageProcessor) only rewrites display/ + thumbnails/ — not these.
 */
const isOriginalMediaKey = (key) => {
  if (!key || typeof key !== 'string') return false;
  const k = key.replace(/\\/g, '/');
  // Explicit rejects first (compressed / derived assets)
  if (/\/(display|thumbnails|posters)\//i.test(k)) return false;
  if (/\.webp$/i.test(k) && !/\/(originals|videos)\//i.test(k)) return false;
  // Upload pipeline always stores masters here (see upload.js buildS3Key … 'originals'|'videos')
  return /\/(originals|videos)\//i.test(k);
};

/**
 * Signed download for gallery masters only — 100% pure original bytes.
 * Never signs preview/thumbnail/poster keys. Compression settings for display
 * WebP do not apply to this path; the S3 object under originalKey is returned
 * unchanged (same bytes the camera/studio uploaded).
 */
const signOriginalDownload = async (photo, expiresInSeconds = 3600) => {
  const key = photo?.originalKey;
  if (!key || !isOriginalMediaKey(key)) return null;

  // Belt-and-suspenders: never allow a derivative key even if originalKey were mis-set.
  if (photo.previewKey && key === photo.previewKey) return null;
  if (photo.thumbnailKey && key === photo.thumbnailKey) return null;
  if (photo.posterKey && key === photo.posterKey) return null;

  const rawName = String(photo.filename || 'photo.jpg').trim() || 'photo.jpg';
  // ASCII fallback for Content-Disposition filename=
  const ascii = rawName.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_').slice(0, 160);
  const utf8 = encodeURIComponent(rawName).replace(/['()]/g, escape);
  const disposition = `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`;

  // Prefer original upload MIME (image/jpeg, image/png, video/mp4, …) — not image/webp.
  const contentType = photo.mimeType && !/^image\/webp$/i.test(photo.mimeType)
    ? photo.mimeType
    : undefined;

  return getSignedDownloadUrl(key, expiresInSeconds, {
    contentType,
    contentDisposition: disposition,
  });
};

// Signed PUT for browser / mobile direct-to-S3 upload.
//
// Signature contract (must match every client PUT exactly):
//   - Bound: ContentType only
//   - Client MUST send: Content-Type (same value used at presign)
//   - Client MUST NOT send: x-amz-server-side-encryption (or any other
//     x-amz-* header). Unsigned amz headers → 403 HeadersNotSigned.
//
// Server-side encryption is applied by the bucket default encryption rule
// (AES256 in infra/aws/setup.sh). Do NOT add ServerSideEncryption here
// unless every client (admin-dashboard, Flutter customer-app, etc.) also
// sends x-amz-server-side-encryption: AES256 on the PUT.
const getSignedUploadUrl = async (key, contentType, expiresInSeconds = 900) => {
  const command = new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(s3Client, command, { expiresIn: expiresInSeconds });
};

// Confirm an object exists (used at upload "complete" to verify the browser PUT).
const headObject = async (key) => {
  try {
    const out = await s3Client.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: key }));
    return { exists: true, size: out.ContentLength, contentType: out.ContentType };
  } catch (err) {
    if (err?.$metadata?.httpStatusCode === 404 || err?.name === 'NotFound') {
      return { exists: false };
    }
    throw err;
  }
};

// Download an object into a Buffer (worker-side, for image processing / hashing).
const getObjectBuffer = async (key) => {
  const out = await s3Client.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }));
  const chunks = [];
  for await (const chunk of out.Body) chunks.push(chunk);
  return Buffer.concat(chunks);
};

const deleteFromS3 = async (key) => {
  if (!key) return;
  await s3Client.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: key }));
};

const deleteManyFromS3 = async (keys) => {
  const valid = (keys || []).filter(Boolean);
  if (!valid.length) return;
  // S3 DeleteObjects caps at 1000 keys per call.
  for (let i = 0; i < valid.length; i += 1000) {
    const batch = valid.slice(i, i + 1000).map((Key) => ({ Key }));
    const result = await s3Client.send(new DeleteObjectsCommand({ Bucket: S3_BUCKET, Delete: { Objects: batch } }));
    if (result.Errors?.length) throw new Error(`Storage could not delete ${result.Errors.length} objects; cleanup will retry`);
  }
};

// Delete every object under a prefix (e.g. a temporary selfie folder).
const deletePrefix = async (prefix) => {
  let token;
  do {
    const listed = await s3Client.send(new ListObjectsV2Command({
      Bucket: S3_BUCKET, Prefix: prefix, ContinuationToken: token,
    }));
    const keys = (listed.Contents || []).map((o) => o.Key);
    await deleteManyFromS3(keys);
    token = listed.IsTruncated ? listed.NextContinuationToken : undefined;
  } while (token);
};

const buildS3Key = (studioId, galleryId, type, filename) =>
  `studios/${studioId}/galleries/${galleryId}/${type}/${filename}`;

const buildSelfieKey = (sessionId, filename) =>
  `temporary-face-search/${sessionId}/${filename}`;

const buildContractKey = (studioId, contractId, ext) =>
  `studios/${studioId}/contracts/${contractId}${ext}`;

module.exports = {
  S3_BUCKET,
  uploadToS3,
  getSignedPhotoUrl,
  getSignedDownloadUrl,
  signOriginalDownload,
  isOriginalMediaKey,
  getSignedUploadUrl,
  headObject,
  getObjectBuffer,
  deleteFromS3,
  deleteManyFromS3,
  deletePrefix,
  buildS3Key,
  buildSelfieKey,
  buildContractKey,
};
