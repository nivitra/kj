const express = require('express');
const { prisma } = require('../config/prisma');
const { authenticateAdmin, authenticateCustomer } = require('../middleware/auth');
const { deleteFromS3, getSignedPhotoUrl, signOriginalDownload } = require('../services/s3');
const { enqueueFaceDelete } = require('../services/jobs');
const { activeGrantWhere } = require('../services/galleryAccess');
const {
  resolveSelectionPhase,
  lockedIncludedIds,
  billedExtraIds,
  extraRateOf,
} = require('../services/selectionPhase');

const router = express.Router();

// Explicit desired state is retry-safe; legacy toggle clients remain supported.
router.post('/:id/favorite', authenticateCustomer, async (req, res) => {
  try {
    const { setSelected } = require('../services/selectionWorkflow');
    res.json(await setSelected({ photoId: req.params.id, customerId: req.customer.id, studioId: req.customer.studioId, selected: req.body?.selected }));
  } catch (e) { res.status(e.status || 400).json({ error: e.message }); }
});

// Admin: delete photo
router.delete('/:id', authenticateAdmin, async (req, res) => {
  try {
    const photo = await prisma.photo.findFirst({
      where: { id: req.params.id, gallery: { studioId: req.studioId } },
      include: { _count: { select: { photoFaces: true } } },
    });
    if (!photo) return res.status(404).json({ error: 'Photo not found' });

    if (photo._count.photoFaces > 0) {
      // Cascade through the worker: DeleteFaces → S3 objects → DB row.
      await enqueueFaceDelete(photo.id, { studioId: req.studioId });
      return res.json({ success: true, queued: true });
    }

    await Promise.all([
      photo.originalKey && deleteFromS3(photo.originalKey),
      photo.thumbnailKey && deleteFromS3(photo.thumbnailKey),
      photo.previewKey && deleteFromS3(photo.previewKey),
      photo.posterKey && deleteFromS3(photo.posterKey),
    ].filter(Boolean));

    await prisma.photo.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: list gallery photos with pagination
router.get('/gallery/:galleryId', authenticateAdmin, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = Math.min(Math.max(parseInt(String(req.query.limit || '100'), 10) || 100, 1), 500);
    const skip = (page - 1) * limit;
    const { status, mediaType } = req.query;
    const where = {
      galleryId: req.params.galleryId,
      gallery: { studioId: req.studioId },
      ...(status ? { processingStatus: String(status) } : {}),
      ...(mediaType === 'IMAGE' || mediaType === 'VIDEO' ? { mediaType: String(mediaType) } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.photo.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ processingStatus: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'desc' }],
      }),
      prisma.photo.count({ where }),
    ]);
    const photos = await Promise.all(rows.map(async (photo) => {
      const thumbKey = photo.thumbnailKey || photo.posterKey;
      const previewKey = photo.previewKey || photo.posterKey;
      return {
        ...photo,
        mediaType: photo.mediaType || 'IMAGE',
        thumbnailUrl: thumbKey ? await getSignedPhotoUrl(thumbKey, 3600) : null,
        previewUrl: previewKey ? await getSignedPhotoUrl(previewKey, 3600) : null,
        downloadUrl: await signOriginalDownload(photo, 3600),
        fileSize: photo.fileSize != null ? Number(photo.fileSize) : null,
        streamUrl: photo.mediaType === 'VIDEO' && photo.originalKey
          ? await getSignedPhotoUrl(photo.originalKey, 3600)
          : null,
      };
    }));
    res.json({ photos, total, page, pages: Math.ceil(total / limit) || 1, limit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Customer: my favorites (with signed URLs for the app grid)
router.get('/my/favorites', authenticateCustomer, async (req, res) => {
  try {
    const { galleryId } = req.query;
    const favorites = await prisma.favorite.findMany({
      where: {
        customerId: req.customer.id,
        photo: {
          isVisibleToCustomers: true,
          gallery: { studioId: req.customer.studioId, accessGrants: { some: activeGrantWhere(req.customer.id, req.customer.studioId) } },
          ...(galleryId ? { galleryId: String(galleryId) } : {}),
        },
      },
      include: { photo: true },
      orderBy: { createdAt: 'desc' },
    });
    const favoritesWithUrls = await Promise.all(favorites.map(async (f) => ({
      id: f.photo.id,
      galleryId: f.photo.galleryId,
      filename: f.photo.filename,
      width: f.photo.width,
      height: f.photo.height,
      isFavorite: true,
      thumbnailUrl: f.photo.thumbnailKey ? await getSignedPhotoUrl(f.photo.thumbnailKey) : null,
      previewUrl: f.photo.previewKey ? await getSignedPhotoUrl(f.photo.previewKey) : null,
    })));
    res.json({ favorites: favoritesWithUrls });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
