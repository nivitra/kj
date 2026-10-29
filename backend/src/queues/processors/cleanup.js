const { prisma } = require('../../config/prisma');
const { deletePrefix } = require('../../services/s3');
const { counters } = require('../../services/metrics');
const { logger } = require('../../utils/logger');
const { hardPurgeGallery, sweepExpiredTrash } = require('../../services/galleryTrash');

// Backstop selfie/session cleanup (FACE-PIPELINE-PLAN.md §5, §10, §11).
// faceSearch deletes the selfie inline on every path; this queue is the
// belt-and-suspenders layer behind that (and the S3 lifecycle rule):
//   - selfie_cleanup {sessionId}: remove one session's lingering selfie objects.
//   - session_sweep (no sessionId): expire stale in-flight sessions and delete
//     any selfie still sitting in S3 past its retention window.
//   - gallery_trash_sweep: hard-purge soft-deleted galleries past purgeAt (30d).
//   - gallery_purge {galleryId}: hard-purge one gallery now.
// Both paths are idempotent and safe to replay.

const purgeSelfie = async (sessionId) => {
  try {
    await deletePrefix(`temporary-face-search/${sessionId}/`);
    await prisma.faceSearchSession.updateMany({ where: { id: sessionId }, data: { selfieKey: null } });
    counters.selfieCleanups.inc({ outcome: 'ok' });
    return true;
  } catch (e) {
    counters.selfieCleanups.inc({ outcome: 'error' });
    logger.error(`Selfie cleanup failed for ${sessionId}: ${e.message}`);
    throw e;
  }
};

const IN_FLIGHT = ['CREATED', 'VALIDATING', 'SEARCHING'];

const sweepExpired = async () => {
  const now = new Date();
  // Sessions whose retention window has passed but that are still in-flight or
  // still hold a selfie key → expire them and purge the selfie.
  const stale = await prisma.faceSearchSession.findMany({
    where: {
      expiresAt: { lt: now },
      OR: [{ status: { in: IN_FLIGHT } }, { selfieKey: { not: null } }],
    },
    select: { id: true, status: true },
    take: 1000,
  });

  let expired = 0;
  let purged = 0;
  for (const s of stale) {
    if (IN_FLIGHT.includes(s.status)) {
      await prisma.faceSearchSession.update({
        where: { id: s.id },
        data: { status: 'EXPIRED', completedAt: now },
      });
      expired++;
    }
    try {
      if (await purgeSelfie(s.id)) purged++;
    } catch (_) { /* counted in purgeSelfie; keep sweeping the rest */ }
  }

  if (stale.length) logger.info(`Session sweep: expired ${expired}, purged ${purged} selfie(s)`);
  return { expired, purged };
};

module.exports = async (job) => {
  const name = job.name || '';
  const data = job.data || {};

  if (name === 'pipeline_recovery') {
    await require('../../services/jobs').recoverStuck();
    return { recovered: true };
  }

  if (name === 'gallery_trash_sweep' || data.galleryTrashSweep) {
    return sweepExpiredTrash({ limit: data.limit || 20 });
  }
  if (name === 'gallery_purge' || data.galleryId) {
    const galleryId = data.galleryId;
    if (!galleryId) return { skipped: true };
    return hardPurgeGallery(galleryId, data.studioId);
  }
  if (data.sessionId) {
    await purgeSelfie(data.sessionId);
    return { cleaned: data.sessionId };
  }
  // Default: selfie session sweep
  const selfie = await sweepExpired();
  // Also run a trash sweep on the same cadence (cheap no-op when empty)
  const trash = await sweepExpiredTrash({ limit: 10 });
  return { ...selfie, trash };
};

module.exports.sweepExpired = sweepExpired;
module.exports.purgeSelfie = purgeSelfie;
module.exports.sweepExpiredTrash = sweepExpiredTrash;
