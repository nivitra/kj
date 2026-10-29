const { prisma } = require('../../config/prisma');
const rekognition = require('../../services/rekognition');
const { deleteFromS3 } = require('../../services/s3');
const { isRetryable } = require('../../lib/errors');
const { logger } = require('../../utils/logger');

// Cascade: DeleteFaces (Rekognition) → S3 objects → PostgreSQL metadata.
// Idempotent and safe to replay (FACE-PIPELINE-PLAN.md §10).
// Rekognition throttling is retryable; does not leave partial silent failures.
module.exports = async (job) => {
  const { photoId } = job.data;
  const photo = await prisma.photo.findUnique({ where: { id: photoId }, include: { photoFaces: true } });
  if (!photo) return { skipped: true };

  const activeFaces = photo.photoFaces.filter((f) => f.faceStatus === 'ACTIVE');
  const faceIds = activeFaces.map((f) => f.rekognitionFaceId);

  if (faceIds.length) {
    try {
      await rekognition.deleteFaces(faceIds);
    } catch (err) {
      if (isRetryable(err)) {
        logger.warn(`Rekognition deleteFaces retryable for ${photoId}: ${err.message}`);
        throw err;
      }
      // Permanent Rekognition error — still clean S3/DB so gallery isn't stuck,
      // but log loudly for ops reconciliation.
      logger.error(`Rekognition deleteFaces permanent failure for ${photoId}: ${err.message}`);
    }
    await prisma.photoFace.updateMany({
      where: { photoId, faceStatus: 'ACTIVE' },
      data: { faceStatus: 'DELETED', deletedAt: new Date() },
    });
  }

  await Promise.all([
    photo.originalKey && deleteFromS3(photo.originalKey),
    photo.thumbnailKey && deleteFromS3(photo.thumbnailKey),
    photo.previewKey && deleteFromS3(photo.previewKey),
  ].filter(Boolean));

  // Hard-delete row (cascades PhotoFace / favorites / selection items).
  await prisma.photo.delete({ where: { id: photoId } });
  logger.info(`Deleted photo ${photoId} and ${faceIds.length} face(s)`);
  return { deletedFaces: faceIds.length };
};
