const { QUEUE, queues } = require('../queues');
const { prisma } = require('../config/prisma');
const { logger } = require('../utils/logger');
const { headObject } = require('./s3');

// Idempotency-key schemes (see FACE-PIPELINE-PLAN.md §9). BullMQ jobId is set to
// the key so a duplicate enqueue is a no-op; a ProcessingJob row mirrors state
// for audit, the DLQ/replay UI, and the boot recovery sweep.
// NOTE: BullMQ custom jobIds MUST NOT contain ":" (throws "Custom Id cannot contain :").
const { keys } = require('./jobKeys');

const mirror = async (idempotencyKey, jobType, data) => {
  await prisma.processingJob.createMany({
    data: [{ idempotencyKey, jobType, status: 'QUEUED', ...data }],
    skipDuplicates: true,
  });
  // Another enqueuer/worker can advance this row while Redis is being checked.
  // Reset only terminal rows; never overwrite live RUNNING/RETRYING progress.
  await prisma.processingJob.updateMany({
    where: { idempotencyKey, status: { in: ['FAILED', 'DEAD_LETTER', 'COMPLETED'] } },
    data: {
      status: 'QUEUED',
      attempts: 0,
      lastErrorCode: null,
      lastErrorMessageSafe: null,
      completedAt: null,
      startedAt: null,
    },
  });
};

const enqueue = async (queueName, idempotencyKey, jobType, payload, mirrorData = {}, { retryCompleted = false } = {}) => {
  const queue = queues[queueName];
  const existing = await queue.getJob(idempotencyKey);
  if (existing) {
    const state = await existing.getState();
    if (state !== 'failed' && !(state === 'completed' && retryCompleted)) {
      // A duplicate add does not enqueue an existing BullMQ job. In particular,
      // do not reset a completed/running mirror to QUEUED and strand it there.
      if (state === 'completed') await markJob(idempotencyKey, 'COMPLETED', { completedAt: new Date(existing.finishedOn || Date.now()) });
      return;
    }
    await mirror(idempotencyKey, jobType, { payload, ...mirrorData });
    try {
      await existing.retry(state, { resetAttemptsMade: true, resetAttemptsStarted: true });
    } catch (err) {
      // Two recovery requests may race. The first retry already made it live.
      if (['failed', 'unknown'].includes(await existing.getState())) throw err;
    }
    return;
  }
  await mirror(idempotencyKey, jobType, { payload, ...mirrorData });
  try {
    const added = await queue.add(jobType, { ...payload, idempotencyKey }, { jobId: idempotencyKey });
    // Another request may have added and finished this ID after our initial read.
    const state = await added.getState();
    if (state === 'completed') await markJob(idempotencyKey, 'COMPLETED', { completedAt: new Date() });
    else if (state === 'active' || state === 'failed') await prisma.processingJob.updateMany({
      where: { idempotencyKey, status: 'QUEUED' },
      data: { status: state === 'active' ? 'RUNNING' : 'FAILED' },
    });
  } catch (err) {
    // BullMQ throws if jobId already exists and is not completed — treat as no-op.
    if (err?.message?.includes('Job') && err?.message?.includes('exists')) {
      logger.debug(`Job already queued ${idempotencyKey}`);
      return;
    }
    throw err;
  }
  logger.debug(`Enqueued ${jobType} ${idempotencyKey}`);
};

const enqueueDerivatives = (photoId, { studioId, galleryId, retryCompleted = false }) =>
  enqueue(QUEUE.DERIVATIVES, keys.derive(photoId), 'generate_derivatives', { photoId }, { studioId, galleryId, photoId }, { retryCompleted });

const enqueueFaceIndex = (photoId, { studioId, galleryId, retryCompleted = false }) =>
  enqueue(QUEUE.FACE_INDEX, keys.index(photoId), 'index_photo_faces', { photoId }, { studioId, galleryId, photoId }, { retryCompleted });

const enqueueFaceSearch = (sessionId, { studioId, customerId }) =>
  enqueue(QUEUE.FACE_SEARCH, keys.search(sessionId), 'face_search', { sessionId }, { studioId, sessionId });

const enqueueBroaderSearch = (sessionId, { studioId }) =>
  enqueue(QUEUE.FACE_SEARCH, keys.broader(sessionId), 'face_search', { sessionId, broader: true }, { studioId, sessionId });

const enqueueFaceDelete = (photoId, { studioId }) =>
  enqueue(QUEUE.FACE_DELETE, keys.del(photoId), 'delete_photo_faces', { photoId }, { studioId, photoId });

const enqueueCleanup = (sessionId) =>
  enqueue(QUEUE.CLEANUP, keys.cleanup(sessionId), 'selfie_cleanup', { sessionId }, { sessionId });

// Re-index every completed photo in a gallery (admin action).
const enqueueGalleryReindex = async (galleryId, { studioId }) => {
  const photos = await prisma.photo.findMany({
    where: {
      galleryId,
      previewKey: { not: null },
      processingStatus: 'COMPLETE',
    },
    select: { id: true },
    take: 10000,
  });

  // Clear indexed flags so the processor doesn't short-circuit.
  await prisma.photo.updateMany({
    where: { id: { in: photos.map((p) => p.id) } },
    data: { faceIndexed: false, rekognitionIndexedAt: null },
  });
  await prisma.eventGallery.update({
    where: { id: galleryId },
    data: { faceIndexStatus: 'RUNNING' },
  });

  for (const p of photos) {
    // Unique job id per reindex wave so prior completed index jobs don't block.
    const key = `index-${p.id}-reindex-${Date.now()}`;
    await mirror(key, 'index_photo_faces', { studioId, galleryId, photoId: p.id, payload: { photoId: p.id } });
    await queues[QUEUE.FACE_INDEX].add('index_photo_faces', { photoId: p.id, idempotencyKey: key }, { jobId: key });
  }
  logger.info(`Reindex enqueued ${photos.length} photos for gallery ${galleryId}`);
  return { enqueued: photos.length };
};

// Mark job state from a processor. Terminal failure after retries → DEAD_LETTER.
const markJob = async (idempotencyKey, status, extra = {}) => {
  await prisma.processingJob.updateMany({ where: { idempotencyKey }, data: { status, ...extra } });
};

// On worker boot, re-enqueue anything left mid-flight so a restart loses nothing.
const recoverStuck = async () => {
  // A browser may upload successfully and disappear before calling /complete.
  // Recover only old registrations with a complete object of the declared size.
  const registrations = await prisma.photo.findMany({
    where: { ingestionStatus: 'REGISTERED', processingStatus: 'PENDING',
      createdAt: { lt: new Date(Date.now() - 15 * 60 * 1000) }, gallery: { deletedAt: null } },
    select: { id: true, originalKey: true, fileSize: true }, take: 5000,
  });
  for (const photo of registrations) {
    try {
      const object = await headObject(photo.originalKey);
      if (object.exists && object.size > 0 && object.size === photo.fileSize) {
        await prisma.photo.updateMany({ where: { id: photo.id, ingestionStatus: 'REGISTERED' }, data: { ingestionStatus: 'UPLOADED' } });
      }
    } catch (err) { logger.warn(`Upload recovery deferred for ${photo.id}: ${err.name || 'storage unavailable'}`); }
  }
  // 1) Photos stuck mid-ingestion.
  const stuckPhotos = await prisma.photo.findMany({
    where: { gallery: { deletedAt: null }, OR: [
      { ingestionStatus: { in: ['UPLOADED', 'QUEUED', 'PROCESSING'] } },
      { ingestionStatus: 'FAILED', lastErrorCode: 'STORAGE_UNAVAILABLE' },
    ] },
    include: { gallery: { select: { studioId: true, faceSearchEnabled: true } } },
    take: 5000,
  });
  for (const p of stuckPhotos) {
    await enqueueDerivatives(p.id, { studioId: p.gallery.studioId, galleryId: p.galleryId, retryCompleted: true });
  }

  // 2) COMPLETE photos that should have been indexed but never were.
  const needIndex = await prisma.photo.findMany({
    where: {
      processingStatus: 'COMPLETE',
      previewKey: { not: null },
      rekognitionIndexedAt: null,
      mediaType: 'IMAGE',
      gallery: { faceSearchEnabled: true, deletedAt: null },
    },
    include: { gallery: { select: { studioId: true } } },
    take: 5000,
  });
  for (const p of needIndex) {
    await enqueueFaceIndex(p.id, { studioId: p.gallery.studioId, galleryId: p.galleryId, retryCompleted: true });
  }

  // 3) ProcessingJob rows left RUNNING/QUEUED (mirror of BullMQ).
  const stuckJobs = await prisma.processingJob.findMany({
    where: { status: { in: ['QUEUED', 'RUNNING', 'RETRYING'] } },
    take: 2000,
  });
  for (const j of stuckJobs) {
    try {
      if (['generate_derivatives', 'index_photo_faces'].includes(j.jobType) && j.photoId) {
        const photo = await prisma.photo.findUnique({ where: { id: j.photoId }, include: { gallery: true } });
        if (!photo || photo.gallery.deletedAt || ['REGISTERED', 'REJECTED', 'DELETED'].includes(photo.ingestionStatus)
          || (j.jobType === 'index_photo_faces' && (!photo.gallery.faceSearchEnabled || photo.mediaType === 'VIDEO'))) {
          await markJob(j.idempotencyKey, 'FAILED', { lastErrorCode: 'RESOURCE_UNAVAILABLE', lastErrorMessageSafe: 'Resource is unavailable or not ready for processing', completedAt: new Date() });
          continue;
        }
        if ((j.jobType === 'generate_derivatives' && photo.processingStatus === 'COMPLETE')
          || (j.jobType === 'index_photo_faces' && photo.rekognitionIndexedAt)) {
          await markJob(j.idempotencyKey, 'COMPLETED', { completedAt: new Date() });
          continue;
        }
      }
      if (j.jobType === 'generate_derivatives' && j.photoId) {
        await enqueue(QUEUE.DERIVATIVES, j.idempotencyKey, j.jobType, { photoId: j.photoId }, { studioId: j.studioId, galleryId: j.galleryId, photoId: j.photoId }, { retryCompleted: true });
      } else if (j.jobType === 'index_photo_faces' && j.photoId) {
        await enqueue(QUEUE.FACE_INDEX, j.idempotencyKey, j.jobType, { photoId: j.photoId }, { studioId: j.studioId, galleryId: j.galleryId, photoId: j.photoId }, { retryCompleted: true });
      } else if (j.jobType === 'face_search' && j.sessionId) {
        await enqueueFaceSearch(j.sessionId, { studioId: j.studioId });
      } else if (j.jobType === 'delete_photo_faces' && j.photoId) {
        await enqueueFaceDelete(j.photoId, { studioId: j.studioId });
      }
    } catch (err) {
      logger.warn(`Recovery skip ${j.idempotencyKey}: ${err.message}`);
    }
  }

  if (stuckPhotos.length || needIndex.length || stuckJobs.length) {
    logger.info(`Recovery sweep: photos=${stuckPhotos.length} needIndex=${needIndex.length} jobs=${stuckJobs.length}`);
  }
};

module.exports = {
  keys,
  enqueueDerivatives,
  enqueueFaceIndex,
  enqueueFaceSearch,
  enqueueBroaderSearch,
  enqueueFaceDelete,
  enqueueCleanup,
  enqueueGalleryReindex,
  markJob,
  recoverStuck,
};
