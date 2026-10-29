const { Queue } = require('bullmq');
const { getRedis } = require('../config/redis');

// Queue names — one per job family (see FACE-PIPELINE-PLAN.md §1).
const QUEUE = {
  DERIVATIVES: 'derivatives',
  FACE_INDEX: 'face-index',
  FACE_SEARCH: 'face-search',
  FACE_DELETE: 'face-delete',
  CLEANUP: 'cleanup',
};

const defaultJobOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 2000 },
  removeOnComplete: 1000,
  removeOnFail: 5000,
};

const connection = getRedis();

const queues = {
  [QUEUE.DERIVATIVES]: new Queue(QUEUE.DERIVATIVES, { connection, defaultJobOptions }),
  [QUEUE.FACE_INDEX]: new Queue(QUEUE.FACE_INDEX, { connection, defaultJobOptions }),
  [QUEUE.FACE_SEARCH]: new Queue(QUEUE.FACE_SEARCH, { connection, defaultJobOptions }),
  [QUEUE.FACE_DELETE]: new Queue(QUEUE.FACE_DELETE, { connection, defaultJobOptions }),
  [QUEUE.CLEANUP]: new Queue(QUEUE.CLEANUP, { connection, defaultJobOptions }),
};

module.exports = { QUEUE, queues, connection, defaultJobOptions };
