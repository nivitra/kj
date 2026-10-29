/**
 * Dedicated Amazon Rekognition service.
 *
 * Auth: default AWS credential provider chain (EC2 instance role in production).
 * Do NOT inject static AWS access keys.
 *
 * Collection is auto-created on first use / worker boot (idempotent).
 */
const {
  CreateCollectionCommand,
  DescribeCollectionCommand,
  ListCollectionsCommand,
  IndexFacesCommand,
  SearchFacesByImageCommand,
  SearchFacesCommand,
  DetectFacesCommand,
  DeleteFacesCommand,
} = require('@aws-sdk/client-rekognition');
const { rekognitionClient, S3_BUCKET } = require('../config/aws');
const { logger } = require('../utils/logger');
const mock = require('./rekognition.mock');

// Production defaults per ops requirements.
const MODE = process.env.REKOGNITION_MODE
  || (process.env.NODE_ENV === 'production' ? 'live' : (process.env.AWS_ACCESS_KEY_ID ? 'live' : 'mock'));
const COLLECTION_ID = process.env.REKOGNITION_COLLECTION_ID || 'sj-studio-prod-faces-v1';
const REGION = process.env.AWS_REGION || 'ap-south-1';

const RETRYABLE_NAMES = new Set([
  'ThrottlingException',
  'ProvisionedThroughputExceededException',
  'InternalServerError',
  'ServiceUnavailable',
  'RequestTimeout',
  'TimeoutError',
  'TooManyRequestsException',
  'PriorRequestNotComplete',
]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isAwsRetryable(err) {
  if (!err) return false;
  if (RETRYABLE_NAMES.has(err.name)) return true;
  const status = err?.$metadata?.httpStatusCode;
  if (status === 429 || (status && status >= 500)) return true;
  if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT' || err.code === 'EAI_AGAIN') return true;
  return false;
}

/**
 * Retry transient Rekognition / network failures with exponential backoff.
 * Permanent errors bubble up immediately.
 */
async function withRetry(fn, { label = 'rekognition', maxAttempts = 5, baseMs = 200 } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isAwsRetryable(err) || attempt === maxAttempts) throw err;
      const delay = baseMs * (2 ** (attempt - 1)) + Math.floor(Math.random() * 100);
      logger.warn(`${label} attempt ${attempt}/${maxAttempts} failed (${err.name || err.code}): ${err.message}; retry in ${delay}ms`);
      await sleep(delay);
    }
  }
  throw lastErr;
}

/** Sanitize ExternalImageId for Rekognition ([a-zA-Z0-9_.\-:]+, max 255). */
function sanitizeExternalImageId(value) {
  return String(value || 'unknown')
    .replace(/[^a-zA-Z0-9_.\-:]/g, '_')
    .slice(0, 255);
}

/** Build Image payload from S3 key and/or raw bytes. */
function buildImage({ key, bytes }) {
  if (bytes) {
    const body = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    return { Bytes: body };
  }
  if (!key) throw new Error('Rekognition image requires key or bytes');
  if (!S3_BUCKET) throw new Error('AWS_S3_BUCKET is not configured');
  return { S3Object: { Bucket: S3_BUCKET, Name: key } };
}

// --- live implementation -----------------------------------------------------

const live = {
  /**
   * Idempotent: describe → create if missing.
   * Never throws when the collection already exists.
   * @returns {{ collectionId: string, created: boolean, faceCount?: number }}
   */
  async ensureCollection(collectionId = COLLECTION_ID) {
    try {
      const desc = await withRetry(
        () => rekognitionClient.send(new DescribeCollectionCommand({ CollectionId: collectionId })),
        { label: 'DescribeCollection' },
      );
      logger.info(`Rekognition collection exists: ${collectionId} (faces=${desc.FaceCount ?? '?'})`);
      return { collectionId, created: false, faceCount: desc.FaceCount };
    } catch (err) {
      const missing = err.name === 'ResourceNotFoundException'
        || err.Code === 'ResourceNotFoundException'
        || /not found|does not exist/i.test(err.message || '');
      if (!missing) throw err;
    }

    try {
      await withRetry(
        () => rekognitionClient.send(new CreateCollectionCommand({ CollectionId: collectionId })),
        { label: 'CreateCollection' },
      );
      logger.info(`Rekognition collection created: ${collectionId}`);
      return { collectionId, created: true, faceCount: 0 };
    } catch (err) {
      if (
        err.name === 'ResourceAlreadyExistsException'
        || err.Code === 'ResourceAlreadyExistsException'
        || /already exists/i.test(err.message || '')
      ) {
        logger.info(`Rekognition collection already exists (race): ${collectionId}`);
        return { collectionId, created: false };
      }
      throw err;
    }
  },

  async listCollections() {
    const ids = [];
    let token;
    do {
      const out = await withRetry(
        () => rekognitionClient.send(new ListCollectionsCommand({
          NextToken: token,
          MaxResults: 100,
        })),
        { label: 'ListCollections' },
      );
      ids.push(...(out.CollectionIds || []));
      token = out.NextToken;
    } while (token);
    return ids;
  },

  /**
   * Index faces from an S3 object (or raw bytes) into the collection.
   * externalImageId should be the photo UUID (used to resolve search hits).
   */
  async indexFaces({
    key, bytes, externalImageId, maxFaces = 35, collectionId = COLLECTION_ID,
  }) {
    const extId = sanitizeExternalImageId(externalImageId || key);

    const out = await withRetry(
      () => rekognitionClient.send(new IndexFacesCommand({
        CollectionId: collectionId,
        Image: buildImage({ key, bytes }),
        ExternalImageId: extId,
        MaxFaces: maxFaces,
        QualityFilter: 'AUTO',
        DetectionAttributes: ['DEFAULT'],
      })),
      { label: 'IndexFaces' },
    );

    return (out.FaceRecords || []).map((r) => ({
      faceId: r.Face.FaceId,
      externalImageId: r.Face.ExternalImageId,
      boundingBox: r.Face.BoundingBox,
      confidence: r.Face.Confidence,
      pose: r.FaceDetail?.Pose || null,
      quality: r.FaceDetail?.Quality || null,
    }));
  },

  async detectFaces({ key, bytes }) {
    const out = await withRetry(
      () => rekognitionClient.send(new DetectFacesCommand({
        Image: buildImage({ key, bytes }),
        Attributes: ['DEFAULT'],
      })),
      { label: 'DetectFaces' },
    );
    return (out.FaceDetails || []).map((f) => ({
      boundingBox: f.BoundingBox,
      confidence: f.Confidence,
      quality: f.Quality,
      pose: f.Pose,
    }));
  },

  /**
   * Search the collection with a selfie (S3 key or bytes).
   * Returns FaceId matches for resolution against PhotoFace rows.
   * MaxFaces default 1000 (AWS max 4096) — low caps caused “only 32 results”.
   */
  async searchFacesByImage({
    key, bytes, threshold = 95, maxFaces = 1000, collectionId = COLLECTION_ID,
  }) {
    const capped = Math.min(4096, Math.max(1, maxFaces));
    const out = await withRetry(
      () => rekognitionClient.send(new SearchFacesByImageCommand({
        CollectionId: collectionId,
        Image: buildImage({ key, bytes }),
        FaceMatchThreshold: threshold,
        MaxFaces: capped,
      })),
      { label: 'SearchFacesByImage' },
    );
    return (out.FaceMatches || []).map((m) => ({
      faceId: m.Face.FaceId,
      externalImageId: m.Face.ExternalImageId,
      similarity: m.Similarity,
    }));
  },

  /**
   * Expand coverage: given a FaceId already in the collection, find more
   * similar faces (same person across many photos). Use after SearchFacesByImage.
   */
  async searchFaces({
    faceId, threshold = 95, maxFaces = 1000, collectionId = COLLECTION_ID,
  }) {
    if (!faceId) return [];
    const capped = Math.min(4096, Math.max(1, maxFaces));
    const out = await withRetry(
      () => rekognitionClient.send(new SearchFacesCommand({
        CollectionId: collectionId,
        FaceId: faceId,
        FaceMatchThreshold: threshold,
        MaxFaces: capped,
      })),
      { label: 'SearchFaces' },
    );
    return (out.FaceMatches || []).map((m) => ({
      faceId: m.Face.FaceId,
      externalImageId: m.Face.ExternalImageId,
      similarity: m.Similarity,
    }));
  },

  async deleteFaces(faceIds, collectionId = COLLECTION_ID) {
    if (!faceIds?.length) return { deleted: [] };
    const deleted = [];
    for (let i = 0; i < faceIds.length; i += 4096) {
      const batch = faceIds.slice(i, i + 4096);
      try {
        const out = await withRetry(
          () => rekognitionClient.send(new DeleteFacesCommand({
            CollectionId: collectionId,
            FaceIds: batch,
          })),
          { label: 'DeleteFaces' },
        );
        deleted.push(...(out.DeletedFaces || batch));
      } catch (err) {
        // Collection missing mid-delete — treat as already gone (idempotent cleanup).
        if (err.name === 'ResourceNotFoundException') {
          logger.warn(`DeleteFaces: collection missing, treating as deleted (${batch.length} ids)`);
          deleted.push(...batch);
          continue;
        }
        throw err;
      }
    }
    return { deleted };
  },
};

const impl = MODE === 'mock' ? mock : live;
logger.info(`Rekognition adapter mode=${MODE} collection=${COLLECTION_ID} region=${REGION}`);

module.exports = {
  ...impl,
  COLLECTION_ID,
  MODE,
  REGION,
  isAwsRetryable,
  withRetry,
  sanitizeExternalImageId,
};
