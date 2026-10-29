const { prisma } = require('../config/prisma');
const { deletePrefix, deleteManyFromS3 } = require('./s3');
const rekognition = require('./rekognition');
const { logger } = require('../utils/logger');

/**
 * Permanently remove a gallery: Rekognition faces → S3 objects under the
 * gallery prefix → PostgreSQL row (cascades photos, grants, share links, …).
 */
async function hardPurgeGallery(galleryId, studioId) {
  // Lock the gallery while removing media so a restore or second sweep cannot race.
  return prisma.$transaction(async (db) => {
    await db.$queryRaw`SELECT id FROM "EventGallery" WHERE id = ${galleryId} FOR UPDATE`;

    const gallery = await db.eventGallery.findFirst({
      where: {
        id: galleryId,
        deletedAt: { not: null },
        ...(studioId ? { studioId } : {}),
      },
      select: { id: true, studioId: true, name: true },
    });
    if (!gallery) return { skipped: true, reason: 'not_found' };

    const photos = await db.photo.findMany({
      where: { galleryId },
      select: {
        id: true,
        originalKey: true,
        thumbnailKey: true,
        previewKey: true,
        posterKey: true,
        photoFaces: {
          where: { faceStatus: 'ACTIVE' },
          select: { rekognitionFaceId: true },
        },
      },
    });

    // Batch Rekognition face deletes
    const faceIds = [];
    for (const p of photos) {
      for (const f of p.photoFaces || []) {
        if (f.rekognitionFaceId) faceIds.push(f.rekognitionFaceId);
      }
    }
    let facesDeleted = 0;
    if (faceIds.length && rekognition.MODE !== 'mock') {
      // Rekognition DeleteFaces max 4096; batch 100 for safety
      for (let i = 0; i < faceIds.length; i += 100) {
        const batch = faceIds.slice(i, i + 100);
        await rekognition.deleteFaces(batch);
        facesDeleted += batch.length;
      }
    } else if (faceIds.length) {
      facesDeleted = faceIds.length;
    }

    // Explicit keys + prefix wipe (covers any orphan derivatives)
    const keys = [];
    for (const p of photos) {
      if (p.originalKey) keys.push(p.originalKey);
      if (p.thumbnailKey) keys.push(p.thumbnailKey);
      if (p.previewKey) keys.push(p.previewKey);
      if (p.posterKey) keys.push(p.posterKey);
    }
    await deleteManyFromS3(keys);
    await deletePrefix(`studios/${gallery.studioId}/galleries/${galleryId}/`);

    // Preserve contracts, order lines, invoices and audit records. Required gallery
    // relations do not cascade in historical schemas, so remove them explicitly.
    const selections = await db.selection.findMany({ where: { galleryId }, include: { items: true } });
    if (selections.length) await db.auditLog.create({ data: {
      action: 'GALLERY_SELECTIONS_ARCHIVED', entityType: 'gallery', entityId: galleryId,
      details: { selections: JSON.parse(JSON.stringify(selections)) },
    } });
    await db.contract.updateMany({ where: { galleryId }, data: { galleryId: null } });
    await db.auditLog.updateMany({ where: { galleryId }, data: { galleryId: null } });
    await db.orderItem.updateMany({ where: { photo: { galleryId } }, data: { photoId: null } });
    await db.selection.deleteMany({ where: { galleryId } });
    await db.accessGrant.deleteMany({ where: { galleryId } });
    await db.eventGallery.delete({ where: { id: galleryId } });

    logger.info(
      `Hard-purged gallery ${galleryId} (${gallery.name}): ${photos.length} media, ${facesDeleted} faces`,
    );
    return {
      galleryId,
      photosDeleted: photos.length,
      facesDeleted,
    };
  }, { timeout: 120000, maxWait: 5000 });
}

/**
 * Sweep recycle bin: permanently delete galleries whose purgeAt has passed.
 */
async function sweepExpiredTrash({ limit = 20 } = {}) {
  const now = new Date();
  const due = await prisma.eventGallery.findMany({
    where: {
      deletedAt: { not: null },
      purgeAt: { lte: now },
    },
    select: { id: true, studioId: true, name: true },
    take: limit,
    orderBy: { purgeAt: 'asc' },
  });

  const results = [];
  for (const g of due) {
    try {
      const r = await hardPurgeGallery(g.id, g.studioId);
      results.push({ id: g.id, ok: true, ...r });
    } catch (err) {
      logger.error(`Trash sweep failed for ${g.id}: ${err.message}`);
      results.push({ id: g.id, ok: false, error: err.message });
    }
  }
  if (due.length) {
    logger.info(`Gallery trash sweep: ${due.length} due, ${results.filter((r) => r.ok).length} purged`);
  }
  return { due: due.length, results };
}

module.exports = { hardPurgeGallery, sweepExpiredTrash };
