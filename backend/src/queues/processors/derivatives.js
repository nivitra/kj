const { prisma } = require('../../config/prisma');
const { processPhoto } = require('../../services/imageProcessor');
const { enqueueFaceIndex } = require('../../services/jobs');
const { AppError, CODES, isRetryable } = require('../../lib/errors');
const { counters } = require('../../services/metrics');
const { logger } = require('../../utils/logger');

// Generate thumbnail + display derivatives; on success, enqueue face indexing
// when the gallery has face search enabled (FACE-PIPELINE-PLAN.md §5).
module.exports = async (job) => {
  const { photoId } = job.data;

  let result;
  try {
    result = await processPhoto(photoId);
  } catch (err) {
    // Permanent validation failures are already marked REJECTED on the photo.
    if (err instanceof AppError && !err.retryable) {
      counters.photosProcessed.inc({ outcome: 'rejected' });
      // Re-throw as non-retryable so BullMQ does not burn attempts forever.
      const e = new Error(err.message);
      e.name = 'UnrecoverableError';
      e.code = err.code;
      throw e;
    }
    if (!isRetryable(err) && err instanceof AppError) {
      counters.photosProcessed.inc({ outcome: 'failed' });
    }
    throw err;
  }

  if (result?.skipped && result.reason === 'locked') {
    // Another worker holds the lock — retry after backoff.
    throw new Error('Photo processing lock held; will retry');
  }

  if (result.skipped || result.duplicate) {
    counters.photosProcessed.inc({ outcome: result.duplicate ? 'duplicate' : 'skipped' });
    return result;
  }

  counters.photosProcessed.inc({ outcome: 'complete' });

  // After derivatives succeed, enqueue face indexing. Failures here must NEVER
  // fail the upload/derivatives job — Rekognition is best-effort relative to delivery.
  try {
    const photo = await prisma.photo.findUnique({
      where: { id: photoId },
      include: { gallery: { select: { studioId: true, faceSearchEnabled: true } } },
    });
    if (!photo) return result;

    // Never face-index videos.
    if (photo.mediaType === 'VIDEO') return result;

    // OFF by default on bulk upload. Only index when the studio has explicitly
    // enabled face search on this gallery (avoids surprise Rekognition cost).
    // Enabling face search / Reindex in admin still enqueues indexing separately.
    if (!photo.gallery?.faceSearchEnabled) {
      logger.debug(`Skip face index for ${photoId} (gallery face search off)`);
      return result;
    }

    await enqueueFaceIndex(photoId, { studioId: photo.gallery.studioId, galleryId: photo.galleryId });
    logger.debug(`Queued face indexing for ${photoId}`);
  } catch (err) {
    logger.error(`Failed to enqueue face index for ${photoId} (non-fatal): ${err.message}`);
  }
  return result;
};
