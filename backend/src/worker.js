require('dotenv').config();
const { Worker, UnrecoverableError } = require('bullmq');
const { QUEUE, queues, connection } = require('./queues');
const { markJob, recoverStuck } = require('./services/jobs');
const { counters } = require('./services/metrics');
const { AppError, isRetryable } = require('./lib/errors');
const { logger } = require('./utils/logger');
const rekognition = require('./services/rekognition');

const derivatives = require('./queues/processors/derivatives');
const faceIndex = require('./queues/processors/faceIndex');
const faceSearch = require('./queues/processors/faceSearch');
const faceDelete = require('./queues/processors/faceDelete');
const cleanup = require('./queues/processors/cleanup');

const CONCURRENCY_DERIV = parseInt(process.env.WORKER_CONCURRENCY_DERIVATIVES || '4', 10);
const CONCURRENCY_FACE = parseInt(process.env.WORKER_CONCURRENCY_FACE || '5', 10);

// Wrap a processor so the ProcessingJob mirror tracks running state, and
// permanent errors become UnrecoverableError (no infinite retries).
const withMirror = (queueName, fn) => async (job) => {
  const key = job.data.idempotencyKey;
  if (key) await markJob(key, 'RUNNING', { attempts: job.attemptsMade + 1, startedAt: new Date() });
  try {
    const result = await fn(job);
    if (key) await markJob(key, 'COMPLETED', { completedAt: new Date() });
    return result;
  } catch (err) {
    const permanent = (err instanceof AppError && !err.retryable)
      || err.name === 'UnrecoverableError'
      || (!isRetryable(err) && err.name !== 'Error'); // plain lock-retry Errors stay retryable

    // Lock-contention and generic Errors remain retryable.
    const isLockRetry = err.message && err.message.includes('lock held');
    const treatPermanent = permanent && !isLockRetry;

    const isLast = treatPermanent || job.attemptsMade + 1 >= (job.opts.attempts || 1);
    counters.jobsFailed.inc({ queue: queueName });

    if (isLast) {
      counters.deadLetter.inc({ queue: queueName });
      if (key) {
        await markJob(key, treatPermanent ? 'FAILED' : 'DEAD_LETTER', {
          lastErrorCode: err.code || err.name,
          lastErrorMessageSafe: safeMessage(err),
          completedAt: new Date(),
        });
      }
      logger.error(`${treatPermanent ? 'FAILED' : 'DEAD_LETTER'} ${queueName} ${key}: ${err.message}`);
    } else {
      if (key) {
        await markJob(key, 'RETRYING', {
          lastErrorCode: err.code || err.name,
          lastErrorMessageSafe: safeMessage(err),
        });
      }
      logger.warn(`Retry ${queueName} ${key} (attempt ${job.attemptsMade + 1}): ${err.message}`);
    }

    if (treatPermanent) {
      throw new UnrecoverableError(err.message);
    }
    throw err;
  }
};

const safeMessage = (err) => {
  if (err instanceof AppError) return err.message;
  if (err.status && err.status < 500) return err.message;
  return 'Processing error';
};

// Keep Rekognition calls under the regional TPS quota.
function rekLimiter(op) {
  const tps = parseInt(process.env[`REKOGNITION_${op}_TPS`] || '5', 10);
  return { max: tps, duration: 1000 };
}

const workers = [
  new Worker(QUEUE.DERIVATIVES, withMirror(QUEUE.DERIVATIVES, derivatives), { connection, concurrency: CONCURRENCY_DERIV }),
  new Worker(QUEUE.FACE_INDEX, withMirror(QUEUE.FACE_INDEX, faceIndex), { connection, concurrency: CONCURRENCY_FACE, limiter: rekLimiter('INDEX') }),
  new Worker(QUEUE.FACE_SEARCH, withMirror(QUEUE.FACE_SEARCH, faceSearch), { connection, concurrency: CONCURRENCY_FACE, limiter: rekLimiter('SEARCH') }),
  new Worker(QUEUE.FACE_DELETE, withMirror(QUEUE.FACE_DELETE, faceDelete), { connection, concurrency: 2 }),
  new Worker(QUEUE.CLEANUP, withMirror(QUEUE.CLEANUP, cleanup), { connection, concurrency: 2 }),
];

for (const w of workers) {
  w.on('failed', (job, err) => logger.warn(`${w.name} job ${job?.id} failed: ${err.message}`));
  w.on('error', (err) => logger.error(`${w.name} worker error: ${err.message}`));
}

const SWEEP_INTERVAL_MS = parseInt(process.env.SELFIE_SWEEP_INTERVAL_MS || '900000', 10); // 15 min

(async () => {
  // Ensure face collection exists before processing any index/search jobs.
  // Idempotent: creates sj-studio-prod-faces-v1 (or REKOGNITION_COLLECTION_ID) if missing.
  // Never crashes the worker if the collection already exists; creation failure is non-fatal
  // so the derivatives pipeline keeps running while Rekognition is provisioned.
  if (rekognition.MODE !== 'mock') {
    try {
      const info = await rekognition.ensureCollection(rekognition.COLLECTION_ID);
      logger.info(
        `Rekognition collection ready: ${info.collectionId} (created=${!!info.created}, faces=${info.faceCount ?? '?'}, region=${rekognition.REGION})`,
      );
    } catch (err) {
      logger.error(`Rekognition ensureCollection failed (non-fatal — face jobs will retry): ${err.message}`);
    }
  } else {
    logger.warn('REKOGNITION_MODE=mock — face indexing/search will not call AWS');
  }

  await recoverStuck().catch(err => logger.warn(`Initial pipeline recovery deferred: ${err.message}`));
  await queues[QUEUE.CLEANUP].add('pipeline_recovery', {}, {
    repeat: { every: SWEEP_INTERVAL_MS },
    jobId: 'pipeline-recovery',
    removeOnComplete: true,
    removeOnFail: true,
  });
  // Repeatable backstop sweep: expire stale sessions and purge lingering selfies.
  await queues[QUEUE.CLEANUP].add('session_sweep', {}, {
    repeat: { every: SWEEP_INTERVAL_MS },
    jobId: 'session-sweep',
    removeOnComplete: true,
    removeOnFail: true,
  });
  // Soft-deleted galleries past purgeAt (default 30d) → S3 + DB hard purge
  const TRASH_SWEEP_MS = parseInt(process.env.GALLERY_TRASH_SWEEP_MS || '3600000', 10); // 1h
  await queues[QUEUE.CLEANUP].add('gallery_trash_sweep', { galleryTrashSweep: true }, {
    repeat: { every: TRASH_SWEEP_MS },
    jobId: 'gallery-trash-sweep',
    removeOnComplete: true,
    removeOnFail: true,
  });
  logger.info(
    `Worker up: derivatives x${CONCURRENCY_DERIV}, face x${CONCURRENCY_FACE}, cleanup every ${SWEEP_INTERVAL_MS}ms, gallery trash every ${TRASH_SWEEP_MS}ms`,
  );
})();

const shutdown = async () => {
  logger.info('Worker shutting down...');
  try {
    await Promise.all(workers.map((w) => w.close()));
  } catch (err) {
    logger.error(`Worker close error: ${err.message}`);
  }
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
