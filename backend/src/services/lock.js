const { getRedis } = require('../config/redis');
const { logger } = require('../utils/logger');

// Distributed idempotency lock (FACE-PIPELINE-PLAN.md §5).
// A re-run job cannot double-process the same photo while another worker holds it.
const acquireLock = async (key, ttlMs = 10 * 60 * 1000) => {
  const redis = getRedis();
  const token = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  const ok = await redis.set(`lock:${key}`, token, 'PX', ttlMs, 'NX');
  if (ok !== 'OK') return null;
  return token;
};

const releaseLock = async (key, token) => {
  if (!token) return;
  const redis = getRedis();
  // Release only if we still own the lock (Lua compare-and-del).
  const script = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("del", KEYS[1])
    else
      return 0
    end`;
  try {
    await redis.eval(script, 1, `lock:${key}`, token);
  } catch (err) {
    logger.warn(`lock release failed for ${key}: ${err.message}`);
  }
};

const withLock = async (key, ttlMs, fn) => {
  const token = await acquireLock(key, ttlMs);
  if (!token) return { skipped: true, reason: 'locked' };
  try {
    return await fn();
  } finally {
    await releaseLock(key, token);
  }
};

module.exports = { acquireLock, releaseLock, withLock };
