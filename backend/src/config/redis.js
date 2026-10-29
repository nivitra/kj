const IORedis = require('ioredis');

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// BullMQ requires maxRetriesPerRequest: null on its connection.
const connectionOptions = {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
};

let sharedConnection;
const getRedis = () => {
  if (!sharedConnection) {
    sharedConnection = new IORedis(REDIS_URL, connectionOptions);
  }
  return sharedConnection;
};

module.exports = { getRedis, REDIS_URL, connectionOptions };
