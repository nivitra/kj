const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { prisma } = require('../config/prisma');
const { authenticateAdmin, authenticateCustomer, requireRole, assertSameStudio } = require('../middleware/auth');
const { getSignedPhotoUrl, signOriginalDownload, uploadToS3, getObjectBuffer } = require('../services/s3');
const { hardPurgeGallery } = require('../services/galleryTrash');
const { cropBuffer, normalizeCrop } = require('../services/cropImage');
const { buildOfferPayload, requestRawDump } = require('../services/rawDump');
const { resolveEntitlements, grantWriteFromMode, publicGrantFields, normalizeMode, galleryAvailability, activeGrantWhere } = require('../services/galleryAccess');

const { assignGalleries } = require('../services/galleryAssignment');

const coverUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024 } });

const router = express.Router();
router.use((req,res,next)=>{
  for(const key of ['selectionLimit','extraPhotoPrice']) {
    const raw=req.body?.[key]; if(raw==null||raw==='')continue;
    const value=Number(raw);
    if(!Number.isFinite(value)||value<0||(key==='selectionLimit'&&!Number.isSafeInteger(value)))return res.status(400).json({error:key==='selectionLimit'?'Included allowance must be a non-negative whole number':'Extra-photo price must be a non-negative amount'});
  }
  next();
});

const TRASH_RETENTION_DAYS = parseInt(process.env.GALLERY_TRASH_DAYS || '30', 10);

function relativeAge(date) {
  if (!date) return null;
  const ms = Date.now() - new Date(date).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 'just now';
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days} day${days === 1 ? '' : 's'} ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 8) return `${weeks} week${weeks === 1 ? '' : 's'} ago`;
  const months = Math.floor(days / 30);
  if (months < 18) return `${months} month${months === 1 ? '' : 's'} ago`;
  const years = Math.floor(days / 365);
  return `${years} year${years === 1 ? '' : 's'} ago`;
}

const activeGallery = { deletedAt: null };
const trashGallery = { deletedAt: { not: null } };

// Admin: list galleries (default: active only; ?trash=1 for recycle bin)
router.get('/', authenticateAdmin, async (req, res) => {
  try {
    const { status, search, page = 1, limit = 20, trash } = req.query;
    const skip = (page - 1) * limit;
    const inTrash = trash === '1' || trash === 'true' || status === 'TRASH';
    const where = {
      studioId: req.studioId,
      ...(inTrash ? trashGallery : activeGallery),
      ...(status && status !== 'TRASH' && !inTrash ? { status } : {}),
      ...(search && { name: { contains: search, mode: 'insensitive' } }),
    };
    const [galleries, total] = await Promise.all([
      prisma.eventGallery.findMany({
        where,
        skip: Number(skip),
        take: Number(limit),
        orderBy: inTrash ? { deletedAt: 'desc' } : { createdAt: 'desc' },
        include: {
          clientType: true,
          _count: { select: { photos: true, accessGrants: true } },
          accessGrants: {
            where: { customer: { isGuest: false } },
            orderBy: { grantedAt: 'asc' },
            include: {
              customer: { select: { id: true, name: true, phone: true, loginId: true } },
            },
          },
        },
      }),
      prisma.eventGallery.count({ where }),
    ]);

    const now = Date.now();
    const mapped = galleries.map((g) => {
      let daysLeft = null;
      if (g.purgeAt) {
        daysLeft = Math.max(0, Math.ceil((new Date(g.purgeAt).getTime() - now) / 86400000));
      }
      const assignedClients = (g.accessGrants || [])
        .filter((ag) => ag.customer)
        .map((ag) => ({
          id: ag.customer.id,
          name: ag.customer.name,
          phone: ag.customer.phone || null,
          loginId: ag.customer.loginId || null,
          rawAccess: !!ag.rawAccess,
        }));
      const { accessGrants: _grants, ...rest } = g;
      return {
        ...rest,
        inTrash: !!g.deletedAt,
        daysUntilPurge: daysLeft,
        assignedClients,
        assignedClientCount: assignedClients.length,
        createdAt: g.createdAt,
        ageLabel: relativeAge(g.createdAt),
        expiresAt: g.expiresAt,
        packageName: g.clientType?.name || null,
        clientTypeId: g.clientTypeId || null,
        bulkRawEnabled: !!g.bulkRawEnabled,
        bulkRawPrice: g.bulkRawPrice != null ? Number(g.bulkRawPrice) : null,
      };
    });

    // Sign cover for list (may be raw key)
    const withCovers = await Promise.all(mapped.map(async (g) => {
      let cover = g.coverPhotoUrl;
      if (cover && !String(cover).startsWith('http')) {
        try { cover = await getSignedPhotoUrl(cover, 3600); } catch { cover = null; }
      }
      return { ...g, coverPhotoUrl: cover };
    }));

    res.json({
      galleries: withCovers,
      total,
      page: Number(page),
      pages: Math.ceil(total / limit),
      trash: inTrash,
      retentionDays: TRASH_RETENTION_DAYS,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: create gallery
router.post('/', authenticateAdmin, async (req, res) => {
  try {
    const {
      name, description, eventDate, downloadEnabled, paymentComplete, clientTypeId, servicePackageId,
      watermarkEnabled, faceSearchEnabled, selectionLimit, extraPhotoPrice, selectionEnabled,
      expiresAt, bulkRawEnabled, bulkRawPrice, bulkRawWindowDays,
    } = req.body;
    if (!name) return res.status(400).json({ error: 'Name required' });
    let resolvedTypeId = clientTypeId || null;
    if (servicePackageId) {
      const { syncSelectionTierFromServicePackage } = require('../services/packageSync');
      const pkg = await prisma.servicePackage.findFirst({
        where: { id: servicePackageId, studioId: req.studioId },
      });
      if (pkg) {
        const tier = await syncSelectionTierFromServicePackage(pkg);
        resolvedTypeId = tier?.id || resolvedTypeId;
      }
    }
    const gallery = await prisma.eventGallery.create({
      data: {
        studioId: req.studioId,
        name,
        description: description || null,
        eventDate: eventDate ? new Date(eventDate) : null,
        // Downloads stay off until admin explicitly enables "Downloads on"
        downloadEnabled: downloadEnabled === true,
        paymentComplete: paymentComplete || false,
        clientTypeId: resolvedTypeId,
        watermarkEnabled: watermarkEnabled ?? null,
        faceSearchEnabled: faceSearchEnabled || false,
        selectionEnabled: selectionEnabled !== false,
        selectionLimit: selectionLimit === '' || selectionLimit == null ? null : Math.max(0, parseInt(selectionLimit, 10) || 0),
        extraPhotoPrice: extraPhotoPrice === '' || extraPhotoPrice == null ? null : Number(extraPhotoPrice),
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        bulkRawEnabled: bulkRawEnabled === true || bulkRawEnabled === 'true',
        bulkRawPrice: bulkRawPrice === '' || bulkRawPrice == null ? null : Number(bulkRawPrice),
        bulkRawWindowDays: bulkRawWindowDays != null && bulkRawWindowDays !== ''
          ? Math.max(1, parseInt(bulkRawWindowDays, 10) || 14)
          : 14,
      },
    });
    await prisma.auditLog.create({ data: { adminId: req.admin.id, galleryId: gallery.id, action: 'GALLERY_CREATED', entityType: 'gallery', entityId: gallery.id } });
    res.json(gallery);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: update gallery
router.patch('/:id', authenticateAdmin, async (req, res) => {
  try {
    const {
      name, description, eventDate, status, downloadEnabled, paymentComplete,
      faceSearchEnabled, faceSearchThreshold, clientTypeId, servicePackageId, watermarkEnabled, expiresAt,
      coverPhotoId, coverPhotoUrl, purpose, selectionLimit, extraPhotoPrice, selectionEnabled,
      coverCrop, bulkRawEnabled, bulkRawPrice, bulkRawWindowDays,
    } = req.body;

    const existing = await prisma.eventGallery.findFirst({
      where: { id: req.params.id, studioId: req.studioId },
    });
    if (!existing) return res.status(404).json({ error: 'Gallery not found' });
    if (existing.deletedAt) {
      return res.status(400).json({ error: 'Gallery is in the recycle bin — restore it first' });
    }

    // Set cover from an existing photo in this gallery (stores S3 key; signed on read).
    let coverKey;
    let coverPhotoIdSet;
    let coverCropSet;
    if (coverPhotoId) {
      const photo = await prisma.photo.findFirst({
        where: { id: coverPhotoId, galleryId: req.params.id, gallery: { studioId: req.studioId } },
      });
      if (!photo) return res.status(404).json({ error: 'Photo not found in this gallery' });
      coverPhotoIdSet = photo.id;
      const crop = normalizeCrop(coverCrop);
      if (crop) {
        const srcKey = photo.originalKey || photo.previewKey || photo.thumbnailKey;
        const buf = await getObjectBuffer(srcKey);
        const cropped = await cropBuffer(buf, crop, { maxWidth: 1600, quality: 82 });
        coverKey = `studios/${req.studioId}/galleries/${req.params.id}/cover-${uuidv4()}.webp`;
        await uploadToS3(coverKey, cropped, 'image/webp');
        coverCropSet = crop;
      } else {
        coverKey = photo.previewKey || photo.thumbnailKey || photo.originalKey || null;
      }
    } else if (coverPhotoUrl !== undefined) {
      coverKey = coverPhotoUrl; // may be null to clear
      if (coverPhotoUrl === null) {
        coverPhotoIdSet = null;
        coverCropSet = null;
      }
    }

    let resolvedTypeId;
    if (servicePackageId !== undefined) {
      if (!servicePackageId) {
        resolvedTypeId = null;
      } else {
        const { syncSelectionTierFromServicePackage } = require('../services/packageSync');
        const pkg = await prisma.servicePackage.findFirst({
          where: { id: servicePackageId, studioId: req.studioId },
        });
        if (!pkg) return res.status(404).json({ error: 'Package not found' });
        const tier = await syncSelectionTierFromServicePackage(pkg);
        resolvedTypeId = tier?.id || null;
      }
    }

    const gallery = await prisma.eventGallery.update({
      where: { id: req.params.id },
      data: {
        ...(name && { name }),
        ...(description !== undefined && { description }),
        ...(eventDate !== undefined && { eventDate: eventDate ? new Date(eventDate) : null }),
        ...(status && { status }),
        ...(downloadEnabled !== undefined && { downloadEnabled }),
        ...(paymentComplete !== undefined && { paymentComplete }),
        ...(faceSearchEnabled !== undefined && { faceSearchEnabled }),
        ...(faceSearchThreshold !== undefined && { faceSearchThreshold }),
        ...(clientTypeId !== undefined && { clientTypeId }),
        ...(resolvedTypeId !== undefined && { clientTypeId: resolvedTypeId }),
        ...(watermarkEnabled !== undefined && { watermarkEnabled }),
        ...(expiresAt !== undefined && { expiresAt: expiresAt ? new Date(expiresAt) : null }),
        ...(purpose !== undefined && { purpose: purpose || 'GENERAL' }),
        ...(coverKey !== undefined && { coverPhotoUrl: coverKey }),
        ...(coverPhotoIdSet !== undefined && { coverPhotoId: coverPhotoIdSet }),
        ...(coverCropSet !== undefined && { coverCrop: coverCropSet }),
        ...(selectionEnabled !== undefined && { selectionEnabled: !!selectionEnabled }),
        ...(selectionLimit !== undefined && {
          selectionLimit: selectionLimit === '' || selectionLimit == null
            ? null
            : Math.max(0, parseInt(selectionLimit, 10) || 0),
        }),
        ...(extraPhotoPrice !== undefined && {
          extraPhotoPrice: extraPhotoPrice === '' || extraPhotoPrice == null
            ? null
            : Number(extraPhotoPrice),
        }),
        ...(bulkRawEnabled !== undefined && { bulkRawEnabled: bulkRawEnabled === true || bulkRawEnabled === 'true' }),
        ...(bulkRawPrice !== undefined && {
          bulkRawPrice: bulkRawPrice === '' || bulkRawPrice == null ? null : Number(bulkRawPrice),
        }),
        ...(bulkRawWindowDays !== undefined && {
          bulkRawWindowDays: Math.max(1, parseInt(bulkRawWindowDays, 10) || 14),
        }),
      },
    });
    if (status) await prisma.auditLog.create({ data: { adminId: req.admin.id, galleryId: gallery.id, action: `GALLERY_${status}`, entityType: 'gallery', entityId: gallery.id } });

    // WhatsApp when gallery is published — client app link (not QR/full-access share)
    if (status === 'PUBLISHED') {
      try {
        const { triggerAuto, clientGalleryAppUrl } = require('../services/whatsapp');
        const appUrl = await clientGalleryAppUrl(gallery.id, req.studioId);
        const grants = await prisma.accessGrant.findMany({
          where: { galleryId: gallery.id },
          include: { customer: { select: { name: true, phone: true, isGuest: true } } },
          take: 99,
        });
        for (const g of grants) {
          if (g.customer?.isGuest || !g.customer?.phone) continue;
          triggerAuto(req.studioId, 'GALLERY_PUBLISHED', {
            phone: g.customer.phone,
            toName: g.customer.name,
            vars: {
              name: g.customer.name,
              galleryName: gallery.name,
              appUrl,
              galleryLink: appUrl, // legacy placeholder
            },
            meta: { customerId: g.customerId, galleryId: gallery.id, appUrl, linkType: 'CLIENT_APP' },
          });
        }
      } catch (_) { /* optional */ }
    }

    // Return signed cover for admin UI
    let signedCover = gallery.coverPhotoUrl;
    if (signedCover && !String(signedCover).startsWith('http')) {
      signedCover = await getSignedPhotoUrl(signedCover, 3600);
    }
    res.json({ ...gallery, coverPhotoUrl: signedCover });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: soft-delete → recycle bin (S3 purged after 30 days)
router.delete('/:id', authenticateAdmin, async (req, res) => {
  try {
    const gallery = await prisma.eventGallery.findFirst({
      where: { id: req.params.id, studioId: req.studioId, deletedAt: null },
      include: { _count: { select: { photos: true } } },
    });
    if (!gallery) return res.status(404).json({ error: 'Gallery not found' });

    const deletedAt = new Date();
    const purgeAt = new Date(deletedAt.getTime() + TRASH_RETENTION_DAYS * 86400000);

    const updated = await prisma.eventGallery.update({
      where: { id: gallery.id },
      data: {
        deletedAt,
        purgeAt,
        deletedByAdminId: req.admin?.id || null,
        // Unpublish so client apps cannot see it while in trash
        status: gallery.status === 'PUBLISHED' ? 'ARCHIVED' : gallery.status,
      },
    });

    // Deactivate share links immediately
    await prisma.galleryShareLink.updateMany({
      where: { galleryId: gallery.id },
      data: { active: false },
    });

    await prisma.auditLog.create({
      data: {
        adminId: req.admin.id,
        galleryId: gallery.id,
        action: 'GALLERY_SOFT_DELETE',
        entityType: 'gallery',
        entityId: gallery.id,
        details: {
          purgeAt: purgeAt.toISOString(),
          photoCount: gallery._count.photos,
          previousStatus: gallery.status,
        },
      },
    });

    res.json({
      success: true,
      gallery: updated,
      message: `Moved to recycle bin. Photos permanently deleted from storage after ${TRASH_RETENTION_DAYS} days.`,
      purgeAt,
      retentionDays: TRASH_RETENTION_DAYS,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: restore from recycle bin
router.post('/:id/restore', authenticateAdmin, async (req, res) => {
  try {
    const gallery = await prisma.eventGallery.findFirst({
      where: { id: req.params.id, studioId: req.studioId, deletedAt: { not: null } },
    });
    if (!gallery) return res.status(404).json({ error: 'Gallery not in recycle bin' });

    const updated = await prisma.eventGallery.update({
      where: { id: gallery.id },
      data: {
        deletedAt: null,
        purgeAt: null,
        deletedByAdminId: null,
      },
    });

    await prisma.auditLog.create({
      data: {
        adminId: req.admin.id,
        galleryId: gallery.id,
        action: 'GALLERY_RESTORE',
        entityType: 'gallery',
        entityId: gallery.id,
      },
    });

    res.json({ success: true, gallery: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: permanent delete now (skips remaining retention)
router.delete('/:id/purge', authenticateAdmin, async (req, res) => {
  try {
    const gallery = await prisma.eventGallery.findFirst({
      where: { id: req.params.id, studioId: req.studioId, deletedAt: { not: null } },
      include: { _count: { select: { photos: true } } },
    });
    if (!gallery) {
      return res.status(404).json({ error: 'Gallery not in recycle bin (delete first, or already purged)' });
    }

    const result = await hardPurgeGallery(gallery.id, req.studioId);

    await prisma.auditLog.create({
      data: {
        adminId: req.admin.id,
        action: 'GALLERY_HARD_PURGE',
        entityType: 'gallery',
        entityId: gallery.id,
        details: { photoCount: gallery._count.photos, ...result },
      },
    }).catch(() => {});

    res.json({ success: true, purged: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: get gallery detail
router.get('/:id', authenticateAdmin, async (req, res) => {
  try {
    const gallery = await prisma.eventGallery.findFirst({
      where: { id: req.params.id, studioId: req.studioId },
      include: {
        clientType: true,
        // Prefer completed photos first so the grid shows previews, not only pending rows.
        // Cap is high so large event galleries (500–2k) still render; use ?limit= for override.
        photos: {
          orderBy: [{ processingStatus: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'desc' }],
          take: Math.min(Math.max(parseInt(String(req.query.limit || '2000'), 10) || 2000, 50), 5000),
        },
        accessGrants: {
          include: {
            customer: {
              select: {
                id: true, name: true, email: true, phone: true,
                loginId: true, isGuest: true, accountStatus: true,
              },
            },
          },
          orderBy: { grantedAt: 'asc' },
        },
        _count: { select: { photos: true } },
      },
    });
    if (!gallery) return res.status(404).json({ error: 'Gallery not found' });

    // Browser cannot load private S3 keys — attach short-lived signed URLs for the admin grid.
    // Admin always gets full original downloadUrl (studio staff).
    const photos = await Promise.all(gallery.photos.map(async (photo) => {
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

    let coverPhotoUrl = gallery.coverPhotoUrl;
    if (coverPhotoUrl && !String(coverPhotoUrl).startsWith('http')) {
      coverPhotoUrl = await getSignedPhotoUrl(coverPhotoUrl, 3600);
    }

    const photoTotal = gallery._count?.photos ?? photos.length;
    const assignedClients = (gallery.accessGrants || [])
      .filter((ag) => ag.customer && !ag.customer.isGuest)
      .map((ag) => {
        const ent = resolveEntitlements(gallery, ag);
        return {
          id: ag.customer.id,
          name: ag.customer.name,
          phone: ag.customer.phone || null,
          loginId: ag.customer.loginId || null,
          accountStatus: ag.customer.accountStatus || 'ACTIVE',
          rawAccess: ent.rawAccess,
          accessMode: ent.accessMode,
          accessLabel: ent.label,
          selectionLimit: ag.selectionLimit ?? null,
          extraPhotoPrice: ag.extraPhotoPrice != null ? Number(ag.extraPhotoPrice) : null,
          downloadsAllowed: ent.downloadsAllowed,
          faceSearchEnabled: ag.faceSearchEnabled != null ? !!ag.faceSearchEnabled : (ent.accessMode === 'RAW' || gallery.faceSearchEnabled),
          availability: galleryAvailability(gallery, ag),
          selectionEnabled: ent.selectionEnabled,
        };
      });
    let servicePackage = null;
    if (gallery.clientTypeId) {
      servicePackage = await prisma.servicePackage.findFirst({
        where: {
          studioId: req.studioId,
          OR: [
            { selectionTierId: gallery.clientTypeId },
            ...(gallery.clientType?.name ? [{ title: gallery.clientType.name }] : []),
          ],
        },
        select: {
          id: true, title: true, includedPhotos: true,
          pricePerExtraPhoto: true, pricePerExtraRaw: true, pricePerExtraEdited: true,
          workflowMode: true, active: true,
        },
      });
    }
    res.json({
      ...gallery,
      coverPhotoUrl,
      photos,
      photoTotal,
      photoLimitApplied: photos.length < photoTotal,
      assignedClients,
      assignedClientCount: assignedClients.length,
      createdAt: gallery.createdAt,
      ageLabel: relativeAge(gallery.createdAt),
      servicePackageId: servicePackage?.id || null,
      servicePackage,
      bulkRawPrice: gallery.bulkRawPrice != null ? Number(gallery.bulkRawPrice) : null,
      bulkRawOffer: buildOfferPayload(gallery, { photoCount: photoTotal }),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: upload a cropped cover blob (from ImageCropModal).
router.post('/:id/cover', authenticateAdmin, coverUpload.single('cover'), async (req, res) => {
  try {
    const gallery = await prisma.eventGallery.findFirst({
      where: { id: req.params.id, studioId: req.studioId, deletedAt: null },
    });
    if (!gallery) return res.status(404).json({ error: 'Gallery not found' });
    if (!req.file?.buffer) return res.status(400).json({ error: 'Cropped image required' });
    const photoId = req.body?.photoId || null;
    let crop = null;
    try { crop = req.body?.crop ? JSON.parse(req.body.crop) : null; } catch { crop = null; }
    crop = normalizeCrop(crop);
    const key = `studios/${req.studioId}/galleries/${gallery.id}/cover-${uuidv4()}.webp`;
    // Admin modal already framed the pixels; transcode only (do not crop again).
    const cropped = await cropBuffer(req.file.buffer, { x: 0, y: 0, width: 1, height: 1 }, {
      maxWidth: 1600,
      quality: 82,
    });
    await uploadToS3(key, cropped, 'image/webp');
    const updated = await prisma.eventGallery.update({
      where: { id: gallery.id },
      data: {
        coverPhotoUrl: key,
        ...(photoId ? { coverPhotoId: photoId } : {}),
        ...(crop ? { coverCrop: crop } : {}),
      },
    });
    const url = await getSignedPhotoUrl(key, 3600);
    res.json({ id: updated.id, coverPhotoUrl: url, coverPhotoId: updated.coverPhotoId, coverCrop: updated.coverCrop });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function notifyGalleryAssigned({ studioId, customer, gallery }) {
  if (!customer?.phone || customer.isGuest) return;
  try {
    const { triggerAuto, clientGalleryAppUrl } = require('../services/whatsapp');
    const appUrl = await clientGalleryAppUrl(gallery.id, studioId);
    triggerAuto(studioId, 'GALLERY_ASSIGNED', {
      phone: customer.phone,
      toName: customer.name,
      vars: {
        name: customer.name || 'there',
        galleryName: gallery.name || 'your gallery',
        appUrl,
        galleryLink: appUrl,
      },
      meta: {
        customerId: customer.id,
        galleryId: gallery.id,
        appUrl,
        source: 'ADMIN_GALLERY_GRANT',
        linkType: 'CLIENT_APP',
      },
    });
  } catch (_) { /* optional */ }
}

// Admin: assign this gallery to one or more clients
router.post('/:id/access', authenticateAdmin, async (req, res) => {
  try {
    const { customerId, customerIds, expiresAt, publish } = req.body || {};
    const ids = Array.isArray(customerIds) && customerIds.length ? customerIds.filter(Boolean) : (customerId ? [customerId] : []);
    const result = await assignGalleries(prisma, { studioId: req.studioId, customerIds: ids,
      galleryIds: [req.params.id], expiresAt, publish: publish === true });
    for (const customer of result.customers) await notifyGalleryAssigned({ studioId: req.studioId, customer, gallery: result.galleries[0] });
    await prisma.auditLog.create({ data: { adminId: req.admin.id, galleryId: req.params.id,
      action: 'GALLERY_ASSIGNED', entityType: 'gallery', entityId: req.params.id,
      details: { customerIds: result.customers.map(c => c.id), count: result.granted, published: publish === true } } });
    res.json({ grants: result.grants, granted: result.granted, availability: result.availability });
  } catch (err) { res.status(err.status || 500).json({ error: err.message, code: err.code }); }
});

// Admin: give a client full RAW/master access to this gallery (bypass selection).
router.post('/:id/raw-access', authenticateAdmin, requireRole('OWNER', 'MANAGER'), async (req, res) => {
  try {
    const gallery = await prisma.eventGallery.findFirst({
      where: { id: req.params.id, studioId: req.studioId },
      select: { id: true, name: true, deletedAt: true },
    });
    if (!gallery) return res.status(404).json({ error: 'Gallery not found' });

    const customerId = req.body?.customerId;
    if (!customerId) return res.status(400).json({ error: 'customerId required' });

    const customer = await prisma.customer.findFirst({
      where: { id: customerId, studioId: req.studioId, isGuest: false },
      select: { id: true, name: true, phone: true, isGuest: true },
    });
    if (!customer) return res.status(400).json({ error: 'Client not found' });

    const faceSearchEnabled = req.body?.faceSearchEnabled;
    if (faceSearchEnabled !== undefined && typeof faceSearchEnabled !== 'boolean') {
      return res.status(400).json({ error: 'faceSearchEnabled must be a boolean' });
    }
    const faceSettings = faceSearchEnabled !== undefined ? { faceSearchEnabled } : {};

    const now = new Date();
    const grant = await prisma.accessGrant.upsert({
      where: { customerId_galleryId: { customerId: customer.id, galleryId: gallery.id } },
      create: {
        customerId: customer.id,
        galleryId: gallery.id,
        ...faceSettings,
        accessMode: 'RAW', rawAccess: true, rawGrantedAt: now, rawGrantedByAdminId: req.admin.id,
      },
      update: { ...faceSettings, accessMode: 'RAW', rawAccess: true, rawGrantedAt: now, rawGrantedByAdminId: req.admin.id },
    });
    await notifyGalleryAssigned({ studioId: req.studioId, customer, gallery });
    await prisma.auditLog.create({
      data: {
        adminId: req.admin.id,
        galleryId: gallery.id,
        action: 'GALLERY_RAW_ACCESS',
        entityType: 'gallery',
        entityId: gallery.id,
        details: { customerId: customer.id },
      },
    }).catch(() => {});

    res.json({
      grant: { ...grant, rawAccess: true },
      customer: { id: customer.id, name: customer.name },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id/raw-access/:customerId', authenticateAdmin, requireRole('OWNER', 'MANAGER'), async (req, res) => {
  try {
    const gallery = await prisma.eventGallery.findFirst({
      where: { id: req.params.id, studioId: req.studioId },
      select: { id: true },
    });
    if (!gallery) return res.status(404).json({ error: 'Gallery not found' });
    await prisma.accessGrant.updateMany({
      where: { galleryId: gallery.id, customerId: req.params.customerId },
      data: { ...grantWriteFromMode('SELECTION', { now: new Date(), adminId: req.admin.id }), rawGrantedByAdminId: req.admin.id },
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: per-client access mode + extras pricing for this gallery.
router.patch('/:id/access/:customerId', authenticateAdmin, async (req, res) => {
  try {
    const gallery = await prisma.eventGallery.findFirst({
      where: { id: req.params.id, studioId: req.studioId, deletedAt: null },
    });
    if (!gallery) return res.status(404).json({ error: 'Gallery not found' });
    const existing = await prisma.accessGrant.findFirst({
      where: { galleryId: gallery.id, customerId: req.params.customerId },
    });
    if (!existing) return res.status(404).json({ error: 'Client is not assigned to this gallery' });
    const {
      accessMode, selectionLimit, extraPhotoPrice, downloadEnabled, faceSearchEnabled,
    } = req.body || {};
    if (faceSearchEnabled !== undefined && faceSearchEnabled !== null && typeof faceSearchEnabled !== 'boolean') {
      return res.status(400).json({ error: 'faceSearchEnabled must be a boolean or null' });
    }
    const mode = accessMode != null ? normalizeMode(accessMode, existing.accessMode || 'SELECTION') : (existing.accessMode || 'SELECTION');
    const data = grantWriteFromMode(mode, {
      now: new Date(),
      adminId: req.admin.id,
      selectionLimit: selectionLimit !== undefined ? selectionLimit : existing.selectionLimit,
      extraPhotoPrice: extraPhotoPrice !== undefined ? extraPhotoPrice : existing.extraPhotoPrice,
      downloadEnabled: downloadEnabled !== undefined ? downloadEnabled : existing.downloadEnabled,
      faceSearchEnabled: faceSearchEnabled !== undefined ? faceSearchEnabled : existing.faceSearchEnabled,
    });
    if (selectionLimit === null || selectionLimit === '') data.selectionLimit = null;
    if (extraPhotoPrice === null || extraPhotoPrice === '') data.extraPhotoPrice = null;
    const grant = await prisma.accessGrant.update({
      where: { id: existing.id },
      data,
    });
    const ent = resolveEntitlements(gallery, grant);
    await prisma.auditLog.create({
      data: {
        adminId: req.admin.id,
        galleryId: gallery.id,
        action: 'GALLERY_ACCESS_UPDATED',
        entityType: 'gallery',
        entityId: gallery.id,
        details: { customerId: req.params.customerId, accessMode: ent.accessMode },
      },
    }).catch(() => {});
    res.json({
      grant: {
        ...grant,
        extraPhotoPrice: grant.extraPhotoPrice != null ? Number(grant.extraPhotoPrice) : null,
      },
      entitlements: publicGrantFields(ent),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: unassign a client from this gallery
router.delete('/:id/access/:customerId', authenticateAdmin, async (req, res) => {
  try {
    const gallery = await prisma.eventGallery.findFirst({
      where: { id: req.params.id, studioId: req.studioId },
      select: { id: true },
    });
    if (!gallery) return res.status(404).json({ error: 'Gallery not found' });

    await prisma.accessGrant.deleteMany({
      where: { galleryId: gallery.id, customerId: req.params.customerId },
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Customer: list my galleries (only access grants — never auto-open a gallery).
router.get('/my/galleries', authenticateCustomer, async (req, res) => {
  try {
    const grants = await prisma.accessGrant.findMany({
      where: activeGrantWhere(req.customer.id, req.customer.studioId),
      include: {
        gallery: {
          // Include studioId for tenant isolation check
          include: {
            clientType: true,
            _count: { select: { photos: true } },
            photos: {
              where: { isVisibleToCustomers: true, thumbnailKey: { not: null } },
              orderBy: { sortOrder: 'asc' },
              take: 1,
              select: { thumbnailKey: true },
            },
          },
        },
      },
      orderBy: { grantedAt: 'desc' },
    });

    const galleries = [];
    for (const g of grants) {
      const gal = g.gallery;
      // Hard tenant isolation: grant.gallery must belong to the customer's studio.
      if (gal.studioId && gal.studioId !== req.customer.studioId) continue;
      if (gal.status !== 'PUBLISHED' && !g.rawAccess && g.accessMode !== 'RAW') continue;
      let coverPhotoUrl = gal.coverPhotoUrl || null;
      if (coverPhotoUrl && !String(coverPhotoUrl).startsWith('http')) {
        coverPhotoUrl = await getSignedPhotoUrl(coverPhotoUrl, 3600);
      }
      if (!coverPhotoUrl && gal.photos?.[0]?.thumbnailKey) {
        coverPhotoUrl = await getSignedPhotoUrl(gal.photos[0].thumbnailKey, 3600);
      }
      const workflow = gal.clientType?.workflowMode
        || (gal.purpose === 'DELIVERY' ? 'DOWNLOAD_ONLY' : 'SELECT_ONLY');
      const purpose = gal.purpose || 'GENERAL';
      const ent = resolveEntitlements(gal, g, gal.clientType);
      galleries.push({
        id: gal.id,
        name: gal.name,
        description: gal.description,
        status: gal.status,
        eventDate: gal.eventDate,
        createdAt: gal.createdAt,
        ageLabel: relativeAge(gal.createdAt),
        expiresAt: gal.expiresAt,
        coverPhotoUrl,
        downloadEnabled: ent.downloadsAllowed,
        paymentComplete: gal.paymentComplete,
        faceSearchEnabled: ent.faceSearchEnabled,
        purpose,
        workflowMode: workflow,
        ...publicGrantFields(ent),
        photoCount: gal._count?.photos ?? 0,
        _count: { photos: gal._count?.photos ?? 0 },
        packageName: gal.clientType?.name || null,
        bulkRawOffer: buildOfferPayload(gal, {
          rawAccess: ent.rawAccess,
          photoCount: gal._count?.photos ?? 0,
        }),
      });
    }
    res.json({ galleries });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Customer: get gallery photos (paginated, with signed URLs)
router.get('/my/:id/photos', authenticateCustomer, async (req, res) => {
  try {
    const page = Math.max(1, Math.floor(Number(req.query.page) || 1));
    const limit = Math.max(1, Math.min(100, Math.floor(Number(req.query.limit) || 50)));
    const skip = (page - 1) * limit;

    const grant = await prisma.accessGrant.findFirst({
      where: { customerId: req.customer.id, galleryId: req.params.id,
        gallery: { studioId: req.customer.studioId } },
      include: { gallery: { include: { clientType: true } } },
    });
    if (!grant) return res.status(403).json({ code: 'NOT_ASSIGNED', error: 'This gallery is not assigned to your signed-in account. Ask the studio to assign it to this account.' });
    const availability = galleryAvailability(grant.gallery, grant);
    if (!availability.accessible) return res.status(403).json({ code: availability.reason, error: availability.message });
    if (grant.gallery.status !== 'PUBLISHED' && grant.accessMode !== 'RAW' && !grant.rawAccess) {
      return res.status(403).json({ error: 'This gallery is unavailable for this account. Sign in with the client account invited by the studio, or ask the studio for a guest share link.' });
    }
    try {
      assertSameStudio(req.customer.studioId, grant.gallery.studioId);
    } catch {
      return res.status(403).json({ error: 'This gallery is unavailable for this account. Sign in with the client account invited by the studio, or ask the studio for a guest share link.' });
    }

    // Per-client entitlements (SELECTION / RAW / VIEW) — never leak originals unless allowed.
    const workflow = grant.gallery.clientType?.workflowMode
      || (grant.gallery.purpose === 'DELIVERY' ? 'DOWNLOAD_ONLY' : 'SELECT_ONLY');
    const purpose = grant.gallery.purpose || 'GENERAL';
    const ent = resolveEntitlements(grant.gallery, grant, grant.gallery.clientType);
    const rawAccess = ent.rawAccess;
    const downloadsAllowed = ent.downloadsAllowed;
    let selectionEnabled = ent.selectionEnabled;
    let selectionBlockedReason = null;
    let selectionEstimate = null;
    if (!ent.selectionEnabled) {
      selectionBlockedReason = ent.accessMode === 'RAW'
        ? (ent.faceSearchEnabled ? 'Full originals are unlocked. Use Face search to find yourself — no selection needed.' : 'Full originals are unlocked. No selection is needed.')
        : ent.accessMode === 'VIEW'
          ? 'This gallery is preview-only. Downloads and selection are off.'
          : 'Photo selection is turned off for this gallery.';
    }
    if (selectionEnabled) {
      try {
        const favCount = await prisma.favorite.count({
          where: { customerId: req.customer.id, photo: { galleryId: req.params.id } },
        });
        const { estimateSelection } = require('../services/pricing');
        const state = await require('../services/selectionWorkflow').getSelection({ studioId: req.customer.studioId, customerId: req.customer.id, galleryId: grant.galleryId });
        selectionEstimate = state.estimate;
        if (selectionEstimate && selectionEstimate.pricingReady === false) {
          // Picking remains unlimited; confirmation waits for an agreed rate.
          selectionBlockedReason = selectionEstimate.pricingClientMessage
            || "Studio hasn't finished pricing this gallery yet — contact support.";
        }
      } catch (_) { /* non-fatal */ }
    }

    const visibleWhere = rawAccess
      ? { galleryId: req.params.id }
      : { galleryId: req.params.id, isVisibleToCustomers: true };
    if (req.query.photoId) visibleWhere.id = String(req.query.photoId);
    const [photos, total] = await Promise.all([
      prisma.photo.findMany({
        where: visibleWhere,
        skip: Number(skip), take: Number(limit),
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      }),
      prisma.photo.count({ where: visibleWhere }),
    ]);

    const favorites = await prisma.favorite.findMany({
      where: { customerId: req.customer.id, photoId: { in: photos.map(p => p.id) } },
      select: { photoId: true },
    });
    const favSet = new Set(favorites.map(f => f.photoId));
    try {
      const sel = await prisma.selection.findUnique({
        where: { customerId_galleryId: { customerId: req.customer.id, galleryId: req.params.id } },
        include: { items: { select: { photoId: true, deliveryType: true } } },
      });
      for (const it of sel?.items || []) {
        const t = String(it.deliveryType || '').toUpperCase();
        if (t === 'INCLUDED' || t === 'PACKAGE' || t === 'RAW' || t === 'EDITED') {
          favSet.add(it.photoId);
        }
      }
    } catch (_) { /* non-fatal */ }

    // Sign view URLs in parallel per photo. Defer original download signing to
    // GET /galleries/my/:id/photos/:photoId/download-url so list TTFB stays low.
    const photosWithUrls = await Promise.all(photos.map(async (photo) => {
      const thumbKey = photo.thumbnailKey || photo.posterKey;
      const previewKey = photo.previewKey || photo.posterKey;
      const isVideo = (photo.mediaType || 'IMAGE') === 'VIDEO';
      const [thumbnailUrl, previewUrl, streamUrl] = await Promise.all([
        thumbKey ? getSignedPhotoUrl(thumbKey, 3600) : null,
        previewKey ? getSignedPhotoUrl(previewKey, 3600) : null,
        (isVideo && photo.originalKey) ? getSignedPhotoUrl(photo.originalKey, 3600) : null,
      ]);
      return {
        id: photo.id,
        filename: photo.filename,
        mediaType: photo.mediaType || 'IMAGE',
        width: photo.width,
        height: photo.height,
        durationMs: photo.durationMs,
        capturedAt: photo.capturedAt,
        isFavorite: favSet.has(photo.id),
        thumbnailUrl,
        previewUrl,
        // Lazy: resolved on download tap (see download-url route below)
        downloadUrl: null,
        downloadAvailable: ent.originalsAllowed && !!photo.originalKey,
        fileSize: photo.fileSize != null ? Number(photo.fileSize) : null,
        streamUrl,
      };
    }));

    const dumpInvoice = await prisma.invoice.findFirst({
      where: { customerId: req.customer.id, studioId: req.customer.studioId, status: { not: 'VOID' }, lineItems: { some: { description: { contains: `[RAW_DUMP:${grant.gallery.id}]` } } } },
      select: { id: true, invoiceNumber: true, status: true }, orderBy: { createdAt: 'desc' },
    });
    res.json({
      photos: photosWithUrls, total, page: Number(page), pages: Math.ceil(total / limit),
      gallery: {
        ...grant.gallery,
        createdAt: grant.gallery.createdAt,
        ageLabel: relativeAge(grant.gallery.createdAt),
      },
      workflowMode: workflow,
      purpose,
      ...publicGrantFields(ent),
      rawAccess,
      downloadsAllowed,
      selectionEnabled,
      selectionBlockedReason,
      selectionEstimate,
      downloadBlockedReason: !downloadsAllowed
        ? 'Studio is still finishing your gallery — downloads unlock when it\'s ready.'
        : null,
      bulkRawOffer: buildOfferPayload(grant.gallery, {
        rawAccess,
        photoCount: total,
        invoice: dumpInvoice,
      }),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Customer: request the near-expiry “all originals” offer.
router.post('/my/:id/raw-dump', authenticateCustomer, async (req, res) => {
  try {
    const grant = await prisma.accessGrant.findFirst({
      where: { customerId: req.customer.id, galleryId: req.params.id,
        gallery: { studioId: req.customer.studioId } },
      include: { gallery: true },
    });
    if (!grant) return res.status(403).json({ code: 'NOT_ASSIGNED', error: 'This gallery is not assigned to your signed-in account. Ask the studio to assign it to this account.' });
    const availability = galleryAvailability(grant.gallery, grant);
    if (!availability.accessible) return res.status(403).json({ code: availability.reason, error: availability.message });
    const result = await requestRawDump({
      studioId: req.customer.studioId,
      customerId: req.customer.id,
      gallery: grant.gallery,
      grant,
    });
    const photoCount = await prisma.photo.count({
      where: { galleryId: grant.gallery.id, isVisibleToCustomers: true },
    });
    res.json({
      invoice: {
        id: result.invoice.id,
        invoiceNumber: result.invoice.invoiceNumber,
        status: result.invoice.status,
        totalAmount: Number(result.invoice.totalAmount || 0),
      },
      created: result.created,
      bulkRawOffer: buildOfferPayload(grant.gallery, {
        rawAccess: !!grant.rawAccess,
        photoCount,
        invoice: result.invoice,
      }),
      message: result.created
        ? `Invoice ${result.invoice.invoiceNumber} is ready. Pay the studio to unlock every original.`
        : `You already have invoice ${result.invoice.invoiceNumber} for this offer.`,
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message, code: err.code });
  }
});

// Customer: on-demand original download URL (list no longer bulk-presigns originals)
router.get('/my/:id/photos/:photoId/download-url', authenticateCustomer, async (req, res) => {
  try {
    const grant = await prisma.accessGrant.findFirst({
      where: { customerId: req.customer.id, galleryId: req.params.id,
        gallery: { studioId: req.customer.studioId } },
      include: { gallery: true },
    });
    if (!grant) return res.status(403).json({ code: 'NOT_ASSIGNED', error: 'This gallery is not assigned to your signed-in account. Ask the studio to assign it to this account.' });
    const availability = galleryAvailability(grant.gallery, grant);
    if (!availability.accessible) return res.status(403).json({ code: availability.reason, error: availability.message });
    if (grant.gallery.status !== 'PUBLISHED' && grant.accessMode !== 'RAW' && !grant.rawAccess) {
      return res.status(403).json({ error: 'This gallery is unavailable for this account. Sign in with the client account invited by the studio, or ask the studio for a guest share link.' });
    }
    try {
      assertSameStudio(req.customer.studioId, grant.gallery.studioId);
    } catch {
      return res.status(403).json({ error: 'This gallery is unavailable for this account. Sign in with the client account invited by the studio, or ask the studio for a guest share link.' });
    }
    const ent = resolveEntitlements(grant.gallery, grant);
    if (!ent.originalsAllowed) {
      return res.status(403).json({ error: 'Originals are not released for your access to this gallery' });
    }

    const photo = await prisma.photo.findFirst({
      where: {
        id: req.params.photoId,
        galleryId: req.params.id,
        ...(grant.rawAccess ? {} : { isVisibleToCustomers: true }),
      },
    });
    if (!photo) return res.status(404).json({ error: 'Photo not found' });

    // Masters only — never preview/display WebP (preview compression is view-only).
    const downloadUrl = await signOriginalDownload(photo, 3600);
    if (!downloadUrl) return res.status(404).json({ error: 'Original not available' });

    res.json({
      photoId: photo.id,
      downloadUrl,
      filename: photo.filename,
      fileSize: photo.fileSize != null ? Number(photo.fileSize) : null,
      mimeType: photo.mimeType || null,
      quality: 'ORIGINAL',
      isOriginal: true,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
