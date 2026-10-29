/**
 * Gallery share links (QR) for relatives/friends — no primary client login.
 * Guest: name + phone + face → photos of them in that gallery + studio marketing.
 * Optional full-access code unlocks the entire gallery.
 */
const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const QRCode = require('qrcode');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { body } = require('express-validator');
const { prisma } = require('../config/prisma');
const { authenticateCustomer, authenticateAdmin } = require('../middleware/auth');
const { ok, fail } = require('../lib/envelope');
const { CODES } = require('../lib/errors');
const { getSignedPhotoUrl, signOriginalDownload } = require('../services/s3');
const { signCmsUrl } = require('../services/cmsImages');

const router = express.Router();
const adminRouter = express.Router();
adminRouter.use(authenticateAdmin);

const fullAccessLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many full-access attempts' } },
});

async function buildSharePayload(link) {
  const url = `${publicBase()}/${link.token}`;
  let qrDataUrl = null;
  try {
    qrDataUrl = await QRCode.toDataURL(url, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 512,
      color: { dark: '#1A1917', light: '#FBFAF8' },
    });
  } catch (_) { /* ignore */ }
  return {
    id: link.id,
    token: link.token,
    url,
    label: link.label,
    expiresAt: link.expiresAt,
    visitCount: link.visitCount ?? 0,
    guestCount: link._count?.guests ?? link.guestCount ?? 0,
    active: link.active !== false,
    createdAt: link.createdAt,
    qrDataUrl,
    hasFullAccessCode: !!link.fullAccessCodeHash,
  };
}

async function createShareLinkForGallery({
  galleryId,
  studioId,
  createdByCustomerId = null,
  label = null,
  expiresAt = null,
  fullAccessCode = null,
}) {
  const gallery = await prisma.eventGallery.findFirst({
    where: { id: galleryId, studioId, deletedAt: null,
      status: { in: ['DRAFT', 'PUBLISHED'] }, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
  });
  if (!gallery) return null;

  // Publish so guests can open the link — never auto-enable face search (costs money).
  if (gallery.status !== 'PUBLISHED') {
    await prisma.eventGallery.update({
      where: { id: gallery.id },
      data: { status: 'PUBLISHED' },
    }).catch(() => {});
  }

  let fullAccessCodeHash = null;
  if (fullAccessCode && String(fullAccessCode).trim()) {
    fullAccessCodeHash = await bcrypt.hash(String(fullAccessCode).trim(), 10);
  }

  const token = crypto.randomBytes(24).toString('base64url');
  const exp = expiresAt ? new Date(expiresAt) : null;
  const link = await prisma.galleryShareLink.create({
    data: {
      token,
      galleryId,
      studioId,
      createdByCustomerId,
      label: (label || '').trim() || `Share — ${gallery.name}`,
      expiresAt: exp && !Number.isNaN(exp.getTime()) ? exp : null,
      fullAccessCodeHash,
    },
    include: { _count: { select: { guests: true } } },
  });
  return buildSharePayload(link);
}

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const APP_URL = (process.env.CUSTOMER_APP_URL || process.env.FRONTEND_URL || 'https://app.warmkelvin.com').replace(/\/$/, '');

const guestRegisterLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30 });

const publicBase = () => `${APP_URL}/s`;

/**
 * Reuse an active share link for a gallery, or create one (for client WhatsApp links).
 * Returns public URL string or null.
 */
async function ensureGalleryShareUrl(galleryId, studioId, { label = null } = {}) {
  if (!galleryId || !studioId) return null;
  const existing = await prisma.galleryShareLink.findFirst({
    where: {
      galleryId,
      studioId,
      active: true,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    orderBy: { createdAt: 'desc' },
  });
  if (existing?.token) return `${publicBase()}/${existing.token}`;
  const created = await createShareLinkForGallery({
    galleryId,
    studioId,
    label: label || 'Client gallery link',
  });
  return created?.url || null;
}

function signGuestToken(payload) {
  return jwt.sign({ ...payload, type: 'gallery_guest' }, JWT_SECRET, { expiresIn: '7d' });
}

async function loadActiveShare(token) {
  if (!token) return null;
  return prisma.galleryShareLink.findFirst({
    where: {
      token,
      active: true,
      gallery: { status: 'PUBLISHED', deletedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    include: {
      gallery: {
        include: {
          studio: { select: { id: true, name: true, logoUrl: true } },
          clientType: true,
          _count: { select: { photos: { where: { isVisibleToCustomers: true } } } },
        },
      },
    },
  });
}

async function authenticateGuest(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const raw = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!raw) return fail(res, CODES.UNAUTHORIZED, 'Guest session required', { status: 401 });
    let decoded;
    try {
      decoded = jwt.verify(raw, JWT_SECRET);
    } catch {
      return fail(res, CODES.UNAUTHORIZED, 'Invalid or expired guest session', { status: 401 });
    }
    if (decoded.type !== 'gallery_guest' || !decoded.guestId) {
      return fail(res, CODES.UNAUTHORIZED, 'Invalid guest token', { status: 401 });
    }
    const guest = await prisma.galleryGuest.findFirst({ where: { id: decoded.guestId,
      shareLink: { active: true, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        gallery: { status: 'PUBLISHED', deletedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } } } });
    if (!guest || guest.sessionToken !== decoded.sid) {
      return fail(res, CODES.UNAUTHORIZED, 'Guest session revoked', { status: 401 });
    }
    req.guest = guest;
    req.guestJwt = decoded;
    await prisma.galleryGuest.update({
      where: { id: guest.id },
      data: { lastSeenAt: new Date() },
    }).catch(() => {});
    next();
  } catch (err) {
    return fail(res, CODES.INTERNAL, err.message, { status: 500 });
  }
}

function downloadsAllowedForGallery(gallery) {
  // Admin "Downloads on" is the grant (payment is tracked separately).
  return !!(gallery && gallery.downloadEnabled);
}

// ── Customer: create / list share links for a gallery they own ─────────────

router.post('/my/:galleryId/share-links', authenticateCustomer, async (req, res) => {
  try {
    const grant = await prisma.accessGrant.findFirst({
      where: {
        customerId: req.customer.id,
        galleryId: req.params.galleryId,
        gallery: { status: 'PUBLISHED', studioId: req.customer.studioId, deletedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
        OR: [{ expiresAt: null }, { expiresAt: { gte: new Date() } }],
      },
      include: { gallery: true },
    });
    if (!grant) return fail(res, CODES.FORBIDDEN, 'You do not have access to this gallery', { status: 403 });

    const token = crypto.randomBytes(24).toString('base64url');
    const expiresAt = req.body?.expiresAt ? new Date(req.body.expiresAt) : null;
    const link = await prisma.galleryShareLink.create({
      data: {
        token,
        galleryId: grant.galleryId,
        studioId: req.customer.studioId,
        createdByCustomerId: req.customer.id,
        label: (req.body?.label || '').trim() || 'Family & friends',
        expiresAt: expiresAt && !Number.isNaN(expiresAt.getTime()) ? expiresAt : null,
      },
    });

    const url = `${publicBase()}/${link.token}`;
    const qrDataUrl = await QRCode.toDataURL(url, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 512,
      color: { dark: '#1A1917', light: '#FBFAF8' },
    });

    return ok(res, {
      link: {
        id: link.id,
        token: link.token,
        url,
        label: link.label,
        expiresAt: link.expiresAt,
        createdAt: link.createdAt,
        qrDataUrl,
      },
    });
  } catch (err) {
    return fail(res, CODES.INTERNAL, err.message, { status: 500 });
  }
});

router.get('/my/:galleryId/share-links', authenticateCustomer, async (req, res) => {
  try {
    const grant = await prisma.accessGrant.findFirst({
      where: {
        customerId: req.customer.id,
        galleryId: req.params.galleryId,
        gallery: { studioId: req.customer.studioId, status: 'PUBLISHED', deletedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    });
    if (!grant) return fail(res, CODES.FORBIDDEN, 'Access denied', { status: 403 });

    const links = await prisma.galleryShareLink.findMany({
      where: { galleryId: req.params.galleryId, studioId: req.customer.studioId, active: true },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { guests: true } } },
    });

    const mapped = await Promise.all(links.map(async (l) => {
      const url = `${publicBase()}/${l.token}`;
      let qrDataUrl = null;
      try {
        qrDataUrl = await QRCode.toDataURL(url, { width: 320, margin: 2 });
      } catch (_) { /* ignore */ }
      return {
        id: l.id,
        token: l.token,
        url,
        label: l.label,
        expiresAt: l.expiresAt,
        visitCount: l.visitCount,
        guestCount: l._count.guests,
        createdAt: l.createdAt,
        qrDataUrl,
      };
    }));

    return ok(res, { links: mapped });
  } catch (err) {
    return fail(res, CODES.INTERNAL, err.message, { status: 500 });
  }
});

router.delete('/my/share-links/:linkId', authenticateCustomer, async (req, res) => {
  const link = await prisma.galleryShareLink.findFirst({
    where: {
      id: req.params.linkId,
      studioId: req.customer.studioId,
      createdByCustomerId: req.customer.id,
    },
  });
  if (!link) return fail(res, CODES.NOT_FOUND, 'Link not found', { status: 404 });
  await prisma.galleryShareLink.update({ where: { id: link.id }, data: { active: false } });
  return ok(res, { revoked: true });
});

// ── Public: preview share (no auth) ────────────────────────────────────────

router.get('/public/:token', async (req, res) => {
  try {
    const share = await loadActiveShare(req.params.token);
    if (!share) return fail(res, CODES.NOT_FOUND, 'This share link is invalid or expired', { status: 404 });

    await prisma.galleryShareLink.update({
      where: { id: share.id },
      data: { visitCount: { increment: 1 } },
    }).catch(() => {});

    const studioId = share.studioId;
    const [profile, packages, portfolio] = await Promise.all([
      prisma.studioProfile.findUnique({ where: { studioId } }),
      prisma.servicePackage.findMany({
        where: { studioId, active: true },
        orderBy: [{ isFeatured: 'desc' }, { displayOrder: 'asc' }],
        take: 6,
        include: { features: true },
      }),
      prisma.portfolioItem.findMany({
        where: { studioId, active: true },
        orderBy: { displayOrder: 'asc' },
        take: 8,
        // Cover only on public share marketing — full media on demand is app-side
        include: { media: { orderBy: { sortOrder: 'asc' }, take: 1 } },
      }),
    ]);

    // CMS marketing images: thumb WebP (not multi‑MB masters)
    const signKey = async (key) => (key ? signCmsUrl(key, 'thumb') : null);

    // Gallery cover: stored as S3 key or full URL; fall back to first visible photo.
    let coverPhotoUrl = share.gallery.coverPhotoUrl || null;
    if (coverPhotoUrl && !String(coverPhotoUrl).startsWith('http')) {
      coverPhotoUrl = await getSignedPhotoUrl(coverPhotoUrl, 3600);
    }
    if (!coverPhotoUrl) {
      const first = await prisma.photo.findFirst({
        where: {
          galleryId: share.gallery.id,
          isVisibleToCustomers: true,
          OR: [
            { thumbnailKey: { not: null } },
            { previewKey: { not: null } },
          ],
        },
        orderBy: { sortOrder: 'asc' },
        select: { thumbnailKey: true, previewKey: true },
      });
      const k = first?.previewKey || first?.thumbnailKey;
      if (k) coverPhotoUrl = await getSignedPhotoUrl(k, 3600);
    }

    return ok(res, {
      share: {
        token: share.token,
        label: share.label,
        requiresFace: !!share.gallery.faceSearchEnabled,
        hasFullAccessCode: !!share.fullAccessCodeHash,
        gallery: {
          id: share.gallery.id,
          name: share.gallery.name,
          description: share.gallery.description,
          eventDate: share.gallery.eventDate,
          photoCount: share.gallery._count?.photos ?? 0,
          faceSearchEnabled: share.gallery.faceSearchEnabled,
          downloadEnabled: !!share.gallery.downloadEnabled,
          downloadsAllowed: downloadsAllowedForGallery(share.gallery),
          coverPhotoUrl,
        },
        downloadsAllowed: downloadsAllowedForGallery(share.gallery),
        studio: {
          id: share.gallery.studio.id,
          name: profile?.displayName || share.gallery.studio.name,
          tagline: profile?.tagline || null,
          about: profile?.about || null,
          logoUrl: (await signKey(profile?.logoKey)) || share.gallery.studio.logoUrl || null,
          coverUrl: await signKey(profile?.coverKey),
          phone: profile?.phone || null,
          whatsapp: profile?.whatsapp || null,
          instagram: profile?.instagram || null,
          website: profile?.website || null,
        },
        packages: await Promise.all(packages.map(async (p) => {
          const price = Number(p.price || 0);
          const discountPrice = p.discountPrice == null ? null : Number(p.discountPrice);
          const displayAmount = discountPrice != null ? discountPrice : price;
          return {
            id: p.id,
            title: p.title,
            description: p.description,
            price,
            discountPrice,
            priceSuffix: 'onwards',
            priceLabel: displayAmount > 0
              ? `₹${displayAmount.toLocaleString('en-IN')} onwards`
              : 'Contact for price',
            isFeatured: p.isFeatured,
            coverUrl: await signKey(p.coverKey),
            features: (p.features || []).map((f) => ({ title: f.title })),
          };
        })),
        portfolio: await Promise.all(portfolio.map(async (p) => {
          const mediaRows = Array.isArray(p.media) ? p.media : [];
          const coverKey = p.coverKey || p.mediaKey || mediaRows[0]?.mediaKey;
          const coverUrl = await signKey(coverKey);
          const externalUrl = p.externalUrl || null;
          const rawType = p.mediaType || mediaRows[0]?.mediaType || 'IMAGE';
          const isReel = String(rawType).toUpperCase() === 'REEL'
            || !!(externalUrl && /instagram\.com\/(reel|reels|p|tv)\//i.test(String(externalUrl)));
          return {
            id: p.id,
            title: p.title,
            description: p.description || null,
            category: p.category,
            mediaType: isReel ? 'REEL' : rawType,
            isReel,
            externalUrl,
            coverUrl,
            mediaCount: mediaRows.length || (coverKey ? 1 : 0),
            // Cover only on share landing — keeps QR marketing strip fast
            media: coverUrl
              ? [{ id: mediaRows[0]?.id || null, mediaType: isReel ? 'REEL' : (p.mediaType || 'IMAGE'), url: coverUrl }]
              : [],
          };
        })),
      },
    });
  } catch (err) {
    return fail(res, CODES.INTERNAL, err.message, { status: 500 });
  }
});

// ── Public: guest register (name + phone) ──────────────────────────────────

router.post(
  '/public/:token/register',
  guestRegisterLimiter,
  body('name').isString().trim().isLength({ min: 2, max: 80 }),
  body('phone').isString().trim().isLength({ min: 8, max: 20 }),
  async (req, res) => {
    try {
      const share = await loadActiveShare(req.params.token);
      if (!share) return fail(res, CODES.NOT_FOUND, 'Share link invalid or expired', { status: 404 });

      const name = String(req.body.name || '').trim();
      let phone = String(req.body.phone || '').trim().replace(/\s+/g, '');
      if (!name || !phone) {
        return fail(res, CODES.VALIDATION, 'Name and phone are required', { status: 400 });
      }

      // Shadow customer for face search reuse + admin visibility
      const guestEmail = `guest+${uuidv4().slice(0, 12)}@share.local`;
      let customer;
      try {
        customer = await prisma.customer.create({
          data: {
            studioId: share.studioId,
            name,
            phone,
            email: guestEmail,
            isGuest: true,
            notes: `Guest via share link ${share.token.slice(0, 8)}…`,
            status: 'Gallery guest',
            accountStatus: 'ACTIVE',
          },
        });
      } catch (e) {
        // phone unique — attach random suffix
        customer = await prisma.customer.create({
          data: {
            studioId: share.studioId,
            name,
            phone: `${phone}#g${Date.now().toString(36).slice(-4)}`,
            email: guestEmail,
            isGuest: true,
            notes: `Guest via share (${phone})`,
            status: 'Gallery guest',
            accountStatus: 'ACTIVE',
          },
        });
      }

      await prisma.accessGrant.upsert({
        where: {
          customerId_galleryId: { customerId: customer.id, galleryId: share.galleryId },
        },
        create: { customerId: customer.id, galleryId: share.galleryId },
        update: {},
      });

      // Notify studio as lead
      await prisma.lead.create({
        data: {
          studioId: share.studioId,
          customerId: customer.id,
          name,
          phone,
          message: `Opened shared gallery "${share.gallery.name}" via QR/link`,
          source: 'GALLERY_SHARE',
          status: 'NEW',
        },
      }).catch(() => {});

      const sessionToken = crypto.randomBytes(32).toString('hex');
      const guest = await prisma.galleryGuest.create({
        data: {
          shareLinkId: share.id,
          galleryId: share.galleryId,
          studioId: share.studioId,
          name,
          phone,
          sessionToken,
          customerId: customer.id,
        },
      });

      // WhatsApp auto-greeting + gallery QR link (Baileys) — fire-and-forget
      try {
        const { triggerAuto } = require('../services/whatsapp');
        const galleryLink = `${publicBase()}/${share.token}`;
        triggerAuto(share.studioId, 'GUEST_REGISTERED', {
          phone,
          toName: name,
          vars: {
            name,
            phone,
            galleryName: share.gallery.name,
            galleryLink,
          },
          meta: { guestId: guest.id, galleryId: share.galleryId, galleryLink },
        });
      } catch (_) { /* optional */ }

      const accessToken = signGuestToken({
        guestId: guest.id,
        customerId: customer.id,
        galleryId: share.galleryId,
        studioId: share.studioId,
        sid: sessionToken,
      });

      // Also issue a short-lived customer JWT so existing face/gallery routes work
      const customerToken = jwt.sign(
        { id: customer.id, studioId: share.studioId, type: 'customer', guest: true, galleryId: share.galleryId },
        JWT_SECRET,
        { expiresIn: '7d' },
      );

      return ok(res, {
        guest: { id: guest.id, name: guest.name, phone: guest.phone },
        accessToken,
        customerToken,
        galleryId: share.galleryId,
        faceSearchEnabled: share.gallery.faceSearchEnabled,
        downloadsAllowed: downloadsAllowedForGallery(share.gallery),
        next: share.gallery.faceSearchEnabled ? 'face' : 'gallery',
      });
    } catch (err) {
      return fail(res, CODES.INTERNAL, err.message, { status: 500 });
    }
  },
);

// ── Guest: photos (face matches by default; full-access code unlocks all) ──

router.get('/guest/photos', authenticateGuest, async (req, res) => {
  try {
    const gallery = await prisma.eventGallery.findFirst({
      where: { id: req.guest.galleryId, status: 'PUBLISHED' },
      include: { clientType: true },
    });
    if (!gallery) return fail(res, CODES.NOT_FOUND, 'Gallery not found', { status: 404 });

    const shareLink = await prisma.galleryShareLink.findUnique({
      where: { id: req.guest.shareLinkId },
      select: { fullAccessCodeHash: true },
    });
    const hasFullAccessCode = !!shareLink?.fullAccessCodeHash;
    const fullAccess = !!req.guest.fullAccess;
    // Same rule as the client app: admin "Downloads on" is the only grant.
    const downloadsAllowed = downloadsAllowedForGallery(gallery);
    const mediaType = (req.query.mediaType || '').toString().toUpperCase();

    let photoIds = null;
    let scope = 'all';

    if (fullAccess || !gallery.faceSearchEnabled) {
      photoIds = null;
      scope = fullAccess ? 'full_access' : 'all';
    } else if (req.guest.faceSessionId) {
      const matches = await prisma.faceSearchMatch.findMany({
        where: {
          sessionId: req.guest.faceSessionId,
          includedInResult: true,
        },
        select: { photoId: true },
      });
      photoIds = [...new Set(matches.map((m) => m.photoId))];
      scope = 'face';
    } else {
      return ok(res, {
        photos: [],
        total: 0,
        needsFace: true,
        fullAccess: false,
        hasFullAccessCode,
        downloadsAllowed: false,
        scope: 'needs_face',
        gallery: {
          id: gallery.id,
          name: gallery.name,
          faceSearchEnabled: gallery.faceSearchEnabled,
          downloadEnabled: !!gallery.downloadEnabled,
          downloadsAllowed: false,
        },
      });
    }

    const where = {
      galleryId: gallery.id,
      isVisibleToCustomers: true,
      ...(photoIds ? { id: { in: photoIds.length ? photoIds : ['__none__'] } } : {}),
      ...(mediaType === 'IMAGE' || mediaType === 'VIDEO' ? { mediaType } : {}),
    };

    const photos = await prisma.photo.findMany({
      where,
      orderBy: { sortOrder: 'asc' },
      take: 500,
    });

    // Sign only thumb + preview for the list (fast first paint). Original download
    // URLs are issued on demand via GET /guest/photos/:photoId/download-url so we
    // do not block the grid on hundreds of S3 presigns.
    const mapped = await Promise.all(photos.map(async (p) => {
      const thumbKey = p.thumbnailKey || p.posterKey;
      const previewKey = p.previewKey || p.posterKey;
      const isVideo = (p.mediaType || 'IMAGE') === 'VIDEO';
      const [thumbnailUrl, previewUrl, streamUrl] = await Promise.all([
        thumbKey ? getSignedPhotoUrl(thumbKey, 3600) : null,
        previewKey ? getSignedPhotoUrl(previewKey, 3600) : null,
        // Videos need stream on list so playback can start without a second round-trip.
        (isVideo && p.originalKey) ? getSignedPhotoUrl(p.originalKey, 3600) : null,
      ]);
      return {
        id: p.id,
        filename: p.filename,
        mediaType: p.mediaType || 'IMAGE',
        width: p.width,
        height: p.height,
        durationMs: p.durationMs,
        fileSize: p.fileSize != null ? Number(p.fileSize) : null,
        mimeType: p.mimeType || null,
        thumbnailUrl,
        previewUrl,
        // null on list — clients call /guest/photos/:id/download-url when tapping Download
        downloadUrl: null,
        downloadAvailable: !!downloadsAllowed && !!p.originalKey,
        streamUrl,
        isFavorite: false,
      };
    }));

    return ok(res, {
      photos: mapped,
      total: mapped.length,
      needsFace: false,
      fullAccess,
      hasFullAccessCode,
      downloadsAllowed,
      scope,
      gallery: {
        id: gallery.id,
        name: gallery.name,
        faceSearchEnabled: gallery.faceSearchEnabled,
        downloadEnabled: !!gallery.downloadEnabled,
        downloadsAllowed,
      },
    });
  } catch (err) {
    return fail(res, CODES.INTERNAL, err.message, { status: 500 });
  }
});

// ── Guest: on-demand original download URL (keeps photo list light) ─────────

router.get('/guest/photos/:photoId/download-url', authenticateGuest, async (req, res) => {
  try {
    const photo = await prisma.photo.findFirst({
      where: {
        id: req.params.photoId,
        galleryId: req.guest.galleryId,
        isVisibleToCustomers: true,
      },
    });
    if (!photo) return fail(res, CODES.NOT_FOUND, 'Photo not found', { status: 404 });

    const gallery = await prisma.eventGallery.findFirst({
      where: { id: req.guest.galleryId, status: 'PUBLISHED' },
      select: { faceSearchEnabled: true, downloadEnabled: true },
    });
    if (!downloadsAllowedForGallery(gallery)) {
      return fail(res, CODES.FORBIDDEN, 'Downloads are locked for this gallery', { status: 403 });
    }
    // Face-scoped guests may only download matched photos (unless full access).
    if (gallery?.faceSearchEnabled && !req.guest.fullAccess) {
      if (!req.guest.faceSessionId) {
        return fail(res, CODES.FORBIDDEN, 'Face scan required', { status: 403 });
      }
      const match = await prisma.faceSearchMatch.findFirst({
        where: {
          sessionId: req.guest.faceSessionId,
          photoId: photo.id,
          includedInResult: true,
        },
        select: { id: true },
      });
      if (!match) return fail(res, CODES.FORBIDDEN, 'Photo not in your results', { status: 403 });
    }

    // Masters only — never preview/display WebP (preview compression is view-only).
    const downloadUrl = await signOriginalDownload(photo, 3600);
    if (!downloadUrl) {
      return fail(res, CODES.NOT_FOUND, 'Original not available', { status: 404 });
    }
    return ok(res, {
      photoId: photo.id,
      downloadUrl,
      filename: photo.filename,
      fileSize: photo.fileSize != null ? Number(photo.fileSize) : null,
      mimeType: photo.mimeType || null,
      // Explicit contract for clients: pure original, not a compressed preview.
      quality: 'ORIGINAL',
      isOriginal: true,
    });
  } catch (err) {
    return fail(res, CODES.INTERNAL, err.message, { status: 500 });
  }
});

// ── Guest: unlock full gallery with share code ─────────────────────────────

router.post('/guest/full-access', fullAccessLimiter, authenticateGuest, async (req, res) => {
  try {
    const code = (req.body?.code || '').toString().trim();
    if (!code) return fail(res, CODES.VALIDATION, 'Access code required', { status: 400 });

    const link = await prisma.galleryShareLink.findFirst({
      where: { id: req.guest.shareLinkId, active: true },
    });
    if (!link || !link.fullAccessCodeHash) {
      return fail(res, CODES.VALIDATION, 'Full access is not configured for this share link', { status: 400 });
    }

    const okCode = await bcrypt.compare(code, link.fullAccessCodeHash);
    if (!okCode) {
      return fail(res, CODES.UNAUTHORIZED, 'Incorrect access code', { status: 401 });
    }

    await prisma.galleryGuest.update({
      where: { id: req.guest.id },
      data: { fullAccess: true, lastSeenAt: new Date() },
    });

    try {
      const { triggerAuto } = require('../services/whatsapp');
      const gal = await prisma.eventGallery.findUnique({
        where: { id: req.guest.galleryId },
        select: { name: true },
      });
      triggerAuto(req.guest.studioId, 'GUEST_FULL_ACCESS', {
        phone: req.guest.phone,
        toName: req.guest.name,
        vars: {
          name: req.guest.name,
          phone: req.guest.phone,
          galleryName: gal?.name || 'Gallery',
        },
        meta: { guestId: req.guest.id },
      });
    } catch (_) { /* optional */ }

    return ok(res, { fullAccess: true });
  } catch (err) {
    return fail(res, CODES.INTERNAL, err.message, { status: 500 });
  }
});

// ── Guest: bind completed face session ─────────────────────────────────────

router.post('/guest/face-session', authenticateGuest, async (req, res) => {
  try {
    const sessionId = (req.body?.sessionId || '').trim();
    if (!sessionId) return fail(res, CODES.VALIDATION, 'sessionId required', { status: 400 });
    const session = await prisma.faceSearchSession.findFirst({
      where: {
        id: sessionId,
        customerId: req.guest.customerId,
        galleryId: req.guest.galleryId,
      },
    });
    if (!session) return fail(res, CODES.NOT_FOUND, 'Face session not found', { status: 404 });
    await prisma.galleryGuest.update({
      where: { id: req.guest.id },
      data: { faceSessionId: sessionId },
    });
    return ok(res, { bound: true, status: session.status, matchCount: session.matchCount });
  } catch (err) {
    return fail(res, CODES.INTERNAL, err.message, { status: 500 });
  }
});

// ── Admin: create / list / revoke share links + guests ─────────────────────

adminRouter.post('/galleries/:galleryId/share-links', async (req, res) => {
  try {
    const link = await createShareLinkForGallery({
      galleryId: req.params.galleryId,
      studioId: req.studioId,
      label: req.body?.label,
      expiresAt: req.body?.expiresAt,
      fullAccessCode: req.body?.fullAccessCode || null,
    });
    if (!link) return fail(res, CODES.NOT_FOUND, 'Gallery not found', { status: 404 });
    return ok(res, { link });
  } catch (err) {
    return fail(res, CODES.INTERNAL, err.message, { status: 500 });
  }
});

/** Set / rotate / clear full-access code on an existing share link. */
adminRouter.patch('/share-links/:linkId/full-access-code', async (req, res) => {
  try {
    const link = await prisma.galleryShareLink.findFirst({
      where: { id: req.params.linkId, studioId: req.studioId },
    });
    if (!link) return fail(res, CODES.NOT_FOUND, 'Link not found', { status: 404 });

    const clear = req.body?.clear === true;
    const code = (req.body?.fullAccessCode || '').toString().trim();
    let fullAccessCodeHash = null;
    if (!clear) {
      if (!code || code.length < 4) {
        return fail(res, CODES.VALIDATION, 'Full access code must be at least 4 characters', { status: 400 });
      }
      fullAccessCodeHash = await bcrypt.hash(code, 10);
    }

    const updated = await prisma.galleryShareLink.update({
      where: { id: link.id },
      data: { fullAccessCodeHash },
      include: { _count: { select: { guests: true } } },
    });
    // Revoke existing guest full-access when code changes/cleared
    if (clear || fullAccessCodeHash) {
      await prisma.galleryGuest.updateMany({
        where: { shareLinkId: link.id },
        data: { fullAccess: false },
      });
    }
    return ok(res, { link: await buildSharePayload(updated) });
  } catch (err) {
    return fail(res, CODES.INTERNAL, err.message, { status: 500 });
  }
});

adminRouter.get('/galleries/:galleryId/share-links', async (req, res) => {
  try {
    const gallery = await prisma.eventGallery.findFirst({
      where: { id: req.params.galleryId, studioId: req.studioId },
    });
    if (!gallery) return fail(res, CODES.NOT_FOUND, 'Gallery not found', { status: 404 });

    const links = await prisma.galleryShareLink.findMany({
      where: { galleryId: gallery.id, studioId: req.studioId },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { guests: true } } },
    });
    const mapped = await Promise.all(links.map(buildSharePayload));
    return ok(res, { links: mapped, gallery: { id: gallery.id, name: gallery.name, status: gallery.status } });
  } catch (err) {
    return fail(res, CODES.INTERNAL, err.message, { status: 500 });
  }
});

adminRouter.delete('/share-links/:linkId', async (req, res) => {
  try {
    const link = await prisma.galleryShareLink.findFirst({
      where: { id: req.params.linkId, studioId: req.studioId },
    });
    if (!link) return fail(res, CODES.NOT_FOUND, 'Link not found', { status: 404 });
    await prisma.galleryShareLink.update({ where: { id: link.id }, data: { active: false } });
    return ok(res, { revoked: true });
  } catch (err) {
    return fail(res, CODES.INTERNAL, err.message, { status: 500 });
  }
});

adminRouter.get('/galleries/:galleryId/share-guests', async (req, res) => {
  try {
    const gallery = await prisma.eventGallery.findFirst({
      where: { id: req.params.galleryId, studioId: req.studioId },
    });
    if (!gallery) return fail(res, CODES.NOT_FOUND, 'Gallery not found', { status: 404 });

    const guests = await prisma.galleryGuest.findMany({
      where: { galleryId: gallery.id, studioId: req.studioId },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        shareLink: { select: { id: true, label: true, token: true } },
      },
    });
    return ok(res, {
      guests: guests.map((g) => ({
        id: g.id,
        name: g.name,
        phone: g.phone,
        createdAt: g.createdAt,
        lastSeenAt: g.lastSeenAt,
        faceSessionId: g.faceSessionId,
        shareLabel: g.shareLink?.label || null,
      })),
    });
  } catch (err) {
    return fail(res, CODES.INTERNAL, err.message, { status: 500 });
  }
});

module.exports = {
  router,
  adminRouter,
  downloadsAllowedForGallery,
  loadActiveShare,
  createShareLinkForGallery,
  buildSharePayload,
  ensureGalleryShareUrl,
  publicBase,
};
