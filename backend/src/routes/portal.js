/**
 * Customer Portal V2 — public-ish + authenticated CMS read APIs
 * and enquiry/lead writes. Tenant-scoped by customer.studioId.
 */
const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const { prisma } = require('../config/prisma');
const { authenticateCustomer, authenticateAdmin } = require('../middleware/auth');
const { uploadToS3, getSignedPhotoUrl } = require('../services/s3');
const { signCmsUrl, processCmsBuffer, isVideoKey } = require('../services/cmsImages');
const { ok, fail } = require('../lib/envelope');
const { CODES } = require('../lib/errors');
const { accountSummary } = require('../services/billing/accountSummary');
const { projectInvoice } = require('../services/billing/projectInvoice');
const { logger } = require('../utils/logger');
const weddingInquiry = require('../services/weddingInquiry');
const { withBooking, updateStage, updateSlot } = require('../services/bookingMutation');
const { activeGrantWhere } = require('../services/galleryAccess');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const { BOOKING_STATUSES, humanizeStatus, normalizeStatusKey, parseBookingSteps, mergeBookingFlow, indexInBookingFlow, serializeJob, jobsFromBooking, isPlaceholderJobList } = require('../services/bookingJobs');
const num = (v) => (v == null || v === '' ? null : Number(v));

/**
 * Normalize Instagram Reel / post / TV URLs for portfolio.
 * Accepts full URLs or bare instagram.com paths.
 */
const normalizeExternalUrl = (raw) => {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = `https://${s.replace(/^\/+/, '')}`;
  let u;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  const host = (u.hostname || '').toLowerCase().replace(/^www\./, '');
  if (host !== 'instagram.com' && host !== 'instagr.am') {
    // Allow other share links only if clearly http(s)
    if (!/^https?:$/i.test(u.protocol)) return null;
    return u.toString();
  }
  // Prefer canonical host
  u.hostname = 'www.instagram.com';
  // Strip tracking query for cleaner share
  u.search = '';
  u.hash = '';
  const pathOk = /\/(reel|reels|p|tv)\//i.test(u.pathname);
  if (!pathOk) {
    // Still allow profile/highlights if studio pastes a broader link
    if (!u.pathname || u.pathname === '/') return null;
  }
  return u.toString();
};

const isReelType = (mediaType, externalUrl) => {
  const t = String(mediaType || '').toUpperCase();
  if (t === 'REEL' || t === 'INSTAGRAM' || t === 'IG') return true;
  return !!(externalUrl && /instagram\.com\/(reel|reels|p|tv)\//i.test(String(externalUrl)));
};

/** Legacy generic sign (non-CMS). Prefer signCms for marketing images. */
const signKey = async (key) => (key ? getSignedPhotoUrl(key, 3600) : null);
/** Grid/list → thumb WebP; lightbox → display WebP (falls back until backfill). */
const signCms = async (key, variant = 'thumb') => (key ? signCmsUrl(key, variant) : null);

/** Upload original + generate CMS derivatives (non-blocking failure). */
async function uploadCmsImage(studioId, folder, file) {
  const ext = path.extname(file.originalname) || '.jpg';
  const key = `studios/${studioId}/${folder}/${uuidv4()}${ext}`;
  await uploadToS3(key, file.buffer, file.mimetype || 'image/jpeg');
  if (!(file.mimetype || '').startsWith('video') && !isVideoKey(key)) {
    try {
      await processCmsBuffer(file.buffer, key);
    } catch (err) {
      console.warn('[cms] derivative failed', key, err.message);
    }
  }
  return key;
}

// Short TTL response cache for CMS lists (signed URLs valid 1h; refresh often enough).
const _cmsCache = new Map(); // key -> { exp, body }
const cmsGet = (k) => {
  const hit = _cmsCache.get(k);
  if (!hit) return null;
  if (hit.exp < Date.now()) { _cmsCache.delete(k); return null; }
  return hit.body;
};
const cmsSet = (k, body, ttlMs = 90_000) => {
  if (_cmsCache.size > 200) {
    let n = 0;
    for (const key of _cmsCache.keys()) {
      _cmsCache.delete(key);
      if (++n > 40) break;
    }
  }
  _cmsCache.set(k, { exp: Date.now() + ttlMs, body });
};

/** Drop portfolio list cache for a studio (create/update/delete). */
const bustPortfolioCache = (studioId) => {
  for (const k of [..._cmsCache.keys()]) {
    if (k.startsWith(`portfolio:${studioId}:`)) _cmsCache.delete(k);
  }
};

/**
 * Map portfolio item.
 * @param {'list'|'full'} mode list = cover only (fast grids); full = all media signed
 */
const mapPortfolioItem = async (p, mode = 'full') => {
  const mediaRows = Array.isArray(p.media) ? p.media : [];
  const sorted = mediaRows.slice().sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  // List queries use take:1 on media — true total comes from _count.media
  const counted = p._count?.media;
  const mediaCount = (typeof counted === 'number' && counted > 0)
    ? counted
    : (sorted.length || ((p.mediaKey || p.coverKey) ? 1 : 0));
  const coverKey = p.coverKey || p.mediaKey || sorted[0]?.mediaKey || null;
  // List uses small thumb WebP (~30–80KB); never multi‑MB masters
  const coverUrl = await signCms(coverKey, 'thumb');

  const externalUrl = p.externalUrl || null;
  const rawType = p.mediaType || sorted[0]?.mediaType || 'IMAGE';
  const mediaType = isReelType(rawType, externalUrl) ? 'REEL' : rawType;
  const isReel = mediaType === 'REEL';

  // List mode: one signed URL for grid — do not presign entire multi-media set.
  if (mode === 'list') {
    return {
      id: p.id,
      title: p.title,
      description: p.description,
      category: p.category,
      mediaType,
      isReel,
      externalUrl,
      displayOrder: p.displayOrder,
      active: p.active,
      coverKey,
      coverUrl,
      mediaUrl: coverUrl,
      media: coverUrl
        ? [{
            id: sorted[0]?.id || null,
            mediaType: mediaType === 'REEL' ? 'REEL' : (p.mediaType || sorted[0]?.mediaType || 'IMAGE'),
            caption: null,
            sortOrder: 0,
            url: coverUrl,
          }]
        : [],
      mediaCount,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    };
  }

  // Full detail: display-sized WebP (~100–350KB), not camera originals
  let media = await Promise.all(
    sorted.map(async (m) => ({
      id: m.id,
      mediaType: m.mediaType || 'IMAGE',
      caption: m.caption || null,
      sortOrder: m.sortOrder || 0,
      mediaKey: m.mediaKey,
      url: await signCms(
        m.mediaKey,
        (m.mediaType || '').toUpperCase() === 'VIDEO' || isVideoKey(m.mediaKey) ? 'original' : 'display',
      ),
    })),
  );
  if (!media.length && (p.mediaKey || p.coverKey)) {
    const k = p.mediaKey || p.coverKey;
    media = [{
      id: null,
      mediaType: p.mediaType || 'IMAGE',
      caption: null,
      sortOrder: 0,
      mediaKey: k,
      url: await signCms(k, 'display'),
    }];
  }
  const displayCover = await signCms(coverKey, 'display');
  return {
    id: p.id,
    title: p.title,
    description: p.description,
    category: p.category,
    mediaType,
    isReel,
    externalUrl,
    displayOrder: p.displayOrder,
    active: p.active,
    coverKey,
    coverUrl: displayCover || coverUrl || media[0]?.url || null,
    mediaUrl: media[0]?.url || displayCover || coverUrl,
    media,
    mediaCount: media.length,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
};

const ensureProfile = async (studioId) => {
  const studio = await prisma.studio.findUnique({ where: { id: studioId } });
  if (!studio) return null;
  return prisma.studioProfile.upsert({
    where: { studioId },
    create: {
      studioId,
      displayName: studio.name,
      email: studio.email,
      phone: studio.phone,
      welcomeMessage: `Welcome to ${studio.name}`,
    },
    update: {},
  }).catch(async (e) => {
    if (e.code === 'P2002') return prisma.studioProfile.findUnique({ where: { studioId } });
    throw e;
  });
};

const mapProfile = async (p, studio) => {
  if (!p) return null;
  return {
    id: p.id,
    studioId: p.studioId,
    displayName: p.displayName || studio?.name || 'Studio',
    tagline: p.tagline,
    about: p.about,
    welcomeMessage: p.welcomeMessage,
    phone: p.phone || studio?.phone,
    whatsapp: p.whatsapp,
    email: p.email || studio?.email,
    website: p.website,
    instagram: p.instagram,
    facebook: p.facebook,
    youtube: p.youtube,
    address: p.address,
    mapsUrl: p.mapsUrl,
    workingHours: p.workingHours,
    themeColor: p.themeColor || '#1A1917',
    secondaryColor: p.secondaryColor || '#9A7B4F',
    appTheme: normalizeAppTheme(p.appTheme),
    appThemeMode: normalizeAppThemeMode(p.appThemeMode),
    termsHtml: p.termsHtml,
    privacyHtml: p.privacyHtml,
    refundHtml: p.refundHtml,
    logoUrl: await signCms(p.logoKey, 'thumb') || studio?.logoUrl || null,
    coverUrl: await signCms(p.coverKey, 'display'),
    paymentQrUrl: p.paymentQrKey ? await signKey(p.paymentQrKey) : null,
    upiId: p.upiId,
  };
};

const APP_THEMES = new Set(['warm', 'zinc', 'stone', 'slate']);
const APP_THEME_MODES = new Set(['light', 'dark', 'system']);
function normalizeAppTheme(raw) {
  const s = String(raw || 'warm').toLowerCase().trim();
  return APP_THEMES.has(s) ? s : 'warm';
}
function normalizeAppThemeMode(raw) {
  const s = String(raw || 'system').toLowerCase().trim();
  return APP_THEME_MODES.has(s) ? s : 'system';
}


async function upsertCustomerJob({ studioId, customerId, pkg, newJob }) {
  return withBooking(prisma, studioId, customerId, async (tx, existing) => {
    const pointer = { status: newJob.status, label: newJob.packageTitle, at: new Date().toISOString(),
      note: newJob.history?.[0]?.note || newJob.packageTitle, jobId: newJob.id };
    const currentJobs = jobsFromBooking(existing);
    const placeholder = isPlaceholderJobList(existing, currentJobs);
    const index = currentJobs.findIndex(j => j.id === newJob.id || j.leadId === newJob.id);
    const nextJobs = placeholder ? [newJob] : index >= 0
      ? currentJobs.map((j, i) => i === index ? newJob : j) : [...currentJobs, newJob];
    const data = { jobs: nextJobs, history: [...(Array.isArray(existing?.history) ? existing.history : []), pointer],
      status: nextJobs[0].status, servicePackageId: nextJobs[0].packageId || pkg?.id || null };
    return existing ? tx.customerBooking.update({ where: { id: existing.id }, data })
      : tx.customerBooking.create({ data: { studioId, customerId, ...data } });
  });
}

function makeWeddingInquiryJob({ lead, pkg, form }) {
  const steps = weddingInquiry.WEDDING_STEPS.map((s) => ({ key: s.key, label: s.label }));
  const first = steps[0];
  const title = pkg?.title || 'Wedding services';
  const venue = form ? weddingInquiry.venueLine(form) : '';
  return serializeJob({
    id: lead.id,
    leadId: lead.id,
    packageId: pkg?.id || null,
    packageTitle: title,
    source: 'WEDDING',
    kind: 'WEDDING',
    status: first.key,
    inquiryStatus: 'PENDING',
    steps,
    history: [{
      status: first.key,
      label: first.label,
      at: new Date().toISOString(),
      note: venue ? `Wedding inquiry received · ${venue}` : 'Wedding inquiry received',
    }],
    slotStatus: lead.slotStatus || 'NONE',
    requestedDate: lead.requestedDate || null,
    requestedTime: lead.requestedTime || null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

async function patchJobInquiryStatus(customerId, leadId, inquiryStatus, note) {
  const original = await prisma.customerBooking.findUnique({ where: { customerId } });
  if (!original) return null;
  return withBooking(prisma, original.studioId, customerId, async (tx, booking) => {
  if (!booking) return null;
  const jobs = jobsFromBooking(booking);
  const step = weddingInquiry.stepForStatus(inquiryStatus);
  const nextJobs = jobs.map((j) => {
    if (j.id !== leadId && j.leadId !== leadId) return j;
    const hist = Array.isArray(j.history) ? [...j.history] : [];
    hist.push({
      status: step.key,
      label: step.label,
      at: new Date().toISOString(),
      note: note || step.label,
    });
    return {
      ...j,
      status: step.key,
      inquiryStatus,
      history: hist,
      updatedAt: new Date().toISOString(),
    };
  });
  const pointer = {
    status: step.key,
    label: step.label,
    at: new Date().toISOString(),
    note: note || step.label,
    jobId: leadId,
  };
  const history = Array.isArray(booking.history) ? [...booking.history, pointer] : [pointer];
  return tx.customerBooking.update({
    where: { id: booking.id },
    data: {
      jobs: nextJobs,
      history,
      status: nextJobs[0]?.status || booking.status,
    },
  });
  });
}

function makeEnquiryJob({ lead, pkg, isBook, slotDate, slotTime, slotLabel, hasSlot }) {
  const steps = pkg ? parseBookingSteps(pkg.bookingSteps) : parseBookingSteps([]);
  const first = steps[0] || { key: 'ENQUIRY_RECEIVED', label: 'Enquiry received' };
  const title = pkg?.title || (isBook ? 'Booking' : 'Enquiry');
  return serializeJob({
    id: lead.id,
    leadId: lead.id,
    packageId: pkg?.id || null,
    packageTitle: title,
    source: isBook ? 'BOOK' : 'ENQUIRE',
    status: first.key,
    steps,
    history: [{
      status: first.key,
      label: first.label,
      at: new Date().toISOString(),
      note: isBook
        ? `Book request: ${title}${slotLabel ? ` · ${slotLabel}` : ''} — studio will confirm`
        : `Enquiry received: ${title}`,
    }],
    slotStatus: hasSlot ? 'REQUESTED' : 'NONE',
    requestedDate: slotDate || null,
    requestedTime: slotTime || null,
    slotLabel: slotLabel || null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

const mapPackage = async (pkg) => {
  const price = Number(pkg.price || 0);
  const discountPrice = pkg.discountPrice == null ? null : Number(pkg.discountPrice);
  const displayAmount = discountPrice != null ? discountPrice : price;
  return {
    id: pkg.id,
    title: pkg.title,
    eventType: pkg.eventType,
    details: pkg.details || {},
    name: pkg.title, // alias so admin/client UIs can use either
    description: pkg.description,
    price,
    discountPrice,
    basePrice: displayAmount,
    /** Starting price — always show as “onwards” in client UIs */
    priceSuffix: 'onwards',
    priceLabel: displayAmount > 0
      ? `₹${displayAmount.toLocaleString('en-IN')} onwards`
      : 'Contact for price',
    /** Never render a literal ₹0 in client UIs */
    priceIsZero: !(displayAmount > 0),
    isFeatured: !!pkg.isFeatured,
    displayOrder: pkg.displayOrder,
    active: pkg.active,
    coverUrl: await signCms(pkg.coverKey, 'thumb'),
    bookingSteps: parseBookingSteps(pkg.bookingSteps),
    includedPhotos: pkg.includedPhotos ?? null,
    pricePerExtraPhoto: pkg.pricePerExtraPhoto == null ? null : Number(pkg.pricePerExtraPhoto),
    pricePerExtraRaw: pkg.pricePerExtraRaw == null
      ? (pkg.pricePerExtraPhoto == null ? null : Number(pkg.pricePerExtraPhoto))
      : Number(pkg.pricePerExtraRaw),
    pricePerExtraEdited: pkg.pricePerExtraEdited == null
      ? (pkg.pricePerExtraPhoto == null ? null : Number(pkg.pricePerExtraPhoto))
      : Number(pkg.pricePerExtraEdited),
    workflowMode: pkg.workflowMode || 'SELECT_ONLY',
    selectionTierId: pkg.selectionTierId || null,
    features: (pkg.features || [])
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map((f) => ({ id: f.id, title: f.title, displayOrder: f.displayOrder })),
  };
};

// ═══════════════════════════════════════════════════════════════════════════
// CUSTOMER (authenticated)
// ═══════════════════════════════════════════════════════════════════════════

const customerRouter = express.Router();
customerRouter.use(authenticateCustomer);

customerRouter.get('/studio', async (req, res) => {
  const studio = await prisma.studio.findUnique({ where: { id: req.customer.studioId } });
  const profile = await ensureProfile(req.customer.studioId);
  return ok(res, { profile: await mapProfile(profile, studio), studio: { id: studio.id, name: studio.name } });
});

customerRouter.get('/announcements', async (req, res) => {
  const rows = await prisma.announcement.findMany({ where: {
    studioId: req.customer.studioId, active: true,
    ...(req.query.id ? { id: String(req.query.id) } : {}),
    OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
  }, orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }], take: 100 });
  return ok(res, { announcements: await Promise.all(rows.map(async (a) => ({
    id: a.id, title: a.title, description: a.description, ctaLabel: a.ctaLabel,
    ctaUrl: a.ctaUrl, imageUrl: await signCms(a.imageKey, 'display'),
  }))) });
});

customerRouter.get('/home', async (req, res) => {
  const studioId = req.customer.studioId;
  const customerId = req.customer.id;
  // Booking and gallery access can change while this client remains signed in.
  // Cache CMS lists separately; always read current private access for home.

  const studio = await prisma.studio.findUnique({ where: { id: studioId } });
  const profile = await ensureProfile(studioId);

  const [packages, announcements, portfolio, booking, grants] = await Promise.all([
    prisma.servicePackage.findMany({
      where: { studioId, active: true },
      orderBy: [{ isFeatured: 'desc' }, { displayOrder: 'asc' }],
      take: 6,
      include: { features: { orderBy: { displayOrder: 'asc' }, take: 8 } },
    }),
    prisma.announcement.findMany({
      where: {
        studioId, active: true,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
      take: 5,
    }),
    prisma.portfolioItem.findMany({
      where: { studioId, active: true },
      orderBy: { displayOrder: 'asc' },
      take: 8,
      // Cover only — skip loading full multi-media; still need accurate count
      include: {
        media: { orderBy: { sortOrder: 'asc' }, take: 1 },
        _count: { select: { media: true } },
      },
    }),
    prisma.customerBooking.findUnique({
      where: { customerId },
      include: { servicePackage: { select: { id: true, title: true, bookingSteps: true } } },
    }),
    prisma.accessGrant.findMany({
      where: activeGrantWhere(customerId, studioId),
      include: {
        gallery: {
          include: {
            _count: { select: { photos: true } },
            photos: {
              where: { isVisibleToCustomers: true, thumbnailKey: { not: null } },
              take: 1,
              orderBy: { sortOrder: 'asc' },
              select: { thumbnailKey: true },
            },
          },
        },
      },
      orderBy: { grantedAt: 'desc' },
      take: 6,
    }),
  ]);

  const galleries = await Promise.all(grants.map(async (g) => {
    const gal = g.gallery;
    let cover = gal.coverPhotoUrl;
    if (cover && !String(cover).startsWith('http')) cover = await signKey(cover);
    if (!cover && gal.photos?.[0]?.thumbnailKey) cover = await signKey(gal.photos[0].thumbnailKey);
    return {
      id: gal.id,
      name: gal.name,
      photoCount: gal._count?.photos ?? 0,
      coverPhotoUrl: cover,
      faceSearchEnabled: gal.faceSearchEnabled,
    };
  }));

  const featured = packages.find((p) => p.isFeatured) || packages[0] || null;

  // Sign in parallel: covers only for portfolio (list mode)
  const [profileMapped, annMapped, pkgsMapped, featuredMapped, portMapped] = await Promise.all([
    mapProfile(profile, studio),
    Promise.all(announcements.map(async (a) => ({
      id: a.id,
      title: a.title,
      description: a.description,
      priority: a.priority,
      style: a.style || 'FEED',
      ctaLabel: a.ctaLabel || null,
      ctaUrl: a.ctaUrl || null,
      imageUrl: await signCms(a.imageKey, 'display'),
      expiresAt: a.expiresAt,
      createdAt: a.createdAt,
    }))),
    Promise.all(packages.map(mapPackage)),
    featured ? mapPackage(featured) : null,
    Promise.all(portfolio.map(async (p) => {
      const mapped = await mapPortfolioItem(p, 'list');
      return {
        id: mapped.id,
        title: mapped.title,
        category: mapped.category,
        mediaType: mapped.mediaType,
        coverUrl: mapped.coverUrl,
        mediaCount: mapped.mediaCount,
        // Home never needs full media array
      };
    })),
  ]);

  const body = {
    profile: profileMapped,
    announcements: annMapped,
    packages: pkgsMapped,
    featuredPackage: featuredMapped,
    portfolio: portMapped,
    booking: (() => {
      if (!booking) return null;
      const jobs = jobsFromBooking(booking);
      if (isPlaceholderJobList(booking, jobs)) return null;
      const currentJob = jobs[0] || null;
      const base = booking.servicePackage
        ? parseBookingSteps(booking.servicePackage.bookingSteps)
        : parseBookingSteps([]);
      const flow = currentJob?.steps?.length
        ? currentJob.steps
        : mergeBookingFlow(base, booking.history, booking.status);
      return {
        status: currentJob?.status || booking.status,
        notes: booking.notes,
        estimatedCompletion: booking.estimatedCompletion,
        history: currentJob?.history || booking.history || [],
        jobs,
        updatedAt: booking.updatedAt,
        steps: flow,
        stepIndex: currentJob?.stepIndex ?? indexInBookingFlow(flow, currentJob?.status || booking.status),
        package: currentJob
          ? { id: currentJob.packageId, title: currentJob.packageTitle }
          : (booking.servicePackage
            ? { id: booking.servicePackage.id, title: booking.servicePackage.title }
            : null),
        slotStatus: booking.slotStatus || 'NONE',
        confirmedSlot: booking.confirmedDate
          ? {
              date: booking.confirmedDate,
              time: booking.confirmedTime,
              label: formatSlotLabel(booking.confirmedDate, booking.confirmedTime),
            }
          : null,
      };
    })(),
    galleries,
    customer: await (async () => {
      const full = await prisma.customer.findUnique({ where: { id: customerId } });
      let couplePhotoUrl = null;
      let weddingCoverUrl = null;
      let bookingPhotoUrl = null;
      try {
        if (full?.couplePhotoKey) couplePhotoUrl = await signKey(full.couplePhotoKey);
        if (full?.weddingCoverKey) weddingCoverUrl = await signKey(full.weddingCoverKey);
        if (full?.bookingPhotoKey) bookingPhotoUrl = await signKey(full.bookingPhotoKey);
      } catch (_) { /* ignore */ }
      return {
      id: req.customer.id,
      name: req.customer.name,
      status: req.customer.status,
      weddingExperience: !!full?.weddingExperience,
      brideName: full?.brideName || null,
      groomName: full?.groomName || null,
      weddingDate: full?.weddingDate || null,
      weddingVenue: full?.weddingVenue || null,
      couplePhotoUrl,
      weddingCoverUrl,
      bookingPhotoUrl,
      albumStatus: full?.albumStatus || null,
      deliveryStatus: full?.deliveryStatus || null,
      photographerName: full?.photographerName || null,
      cinematographerName: full?.cinematographerName || null,
      weddingNotes: full?.weddingNotes || null,
      };
    })(),
  };
  return ok(res, body);
});

customerRouter.get('/packages', async (req, res) => {
  const studioId = req.customer.studioId;
  const cacheKey = `packages:${studioId}`;
  const cached = cmsGet(cacheKey);
  if (cached) return ok(res, cached);

  const list = await prisma.servicePackage.findMany({
    where: { studioId, active: true },
    orderBy: [{ isFeatured: 'desc' }, { displayOrder: 'asc' }],
    include: { features: { orderBy: { displayOrder: 'asc' } } },
  });
  const body = { packages: await Promise.all(list.map(mapPackage)) };
  cmsSet(cacheKey, body, 120_000);
  return ok(res, body);
});

customerRouter.get('/packages/:id', async (req, res) => {
  const pkg = await prisma.servicePackage.findFirst({
    where: { id: req.params.id, studioId: req.customer.studioId, active: true },
    include: { features: true },
  });
  if (!pkg) return fail(res, CODES.NOT_FOUND, 'Package not found', { status: 404 });
  return ok(res, { package: await mapPackage(pkg) });
});

// Portfolio grid — cover only (was signing ~100 full media URLs)
customerRouter.get('/portfolio', async (req, res) => {
  const studioId = req.customer.studioId;
  const full = String(req.query.full || '') === '1';
  const cacheKey = `portfolio:${studioId}:${full ? 'full' : 'list'}`;
  const cached = cmsGet(cacheKey);
  if (cached) return ok(res, cached);

  const items = await prisma.portfolioItem.findMany({
    where: { studioId, active: true },
    orderBy: { displayOrder: 'asc' },
    include: full
      ? { media: { orderBy: { sortOrder: 'asc' } } }
      : {
          media: { orderBy: { sortOrder: 'asc' }, take: 1 },
          // True multi-photo count even when we only load 1 media row for the grid
          _count: { select: { media: true } },
        },
  });
  const mapped = await Promise.all(items.map((p) => mapPortfolioItem(p, full ? 'full' : 'list')));
  const categories = [...new Set(mapped.map((m) => m.category).filter(Boolean))];
  const body = { items: mapped, categories };
  cmsSet(cacheKey, body, full ? 60_000 : 90_000);
  return ok(res, body);
});

// Full multi-media for one work (on open / lightbox)
customerRouter.get('/portfolio/:id', async (req, res) => {
  const item = await prisma.portfolioItem.findFirst({
    where: { id: req.params.id, studioId: req.customer.studioId, active: true },
    include: { media: { orderBy: { sortOrder: 'asc' } } },
  });
  if (!item) return fail(res, CODES.NOT_FOUND, 'Not found', { status: 404 });
  return ok(res, { item: await mapPortfolioItem(item, 'full') });
});

customerRouter.get('/announcements', async (req, res) => {
  const list = await prisma.announcement.findMany({
    where: {
      studioId: req.customer.studioId,
      active: true,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
  });
  return ok(res, {
    announcements: await Promise.all(list.map(async (a) => ({
      id: a.id,
      title: a.title,
      description: a.description,
      priority: a.priority,
      style: a.style || 'FEED',
      ctaLabel: a.ctaLabel || null,
      ctaUrl: a.ctaUrl || null,
      imageUrl: await signCms(a.imageKey, 'display'),
      expiresAt: a.expiresAt,
      createdAt: a.createdAt,
    }))),
  });
});

customerRouter.get('/booking-status', async (req, res) => {
  const booking = await prisma.customerBooking.findUnique({
    where: { customerId: req.customer.id },
    include: { servicePackage: { include: { features: true } } },
  });
  if (!booking) {
    return ok(res, { booking: null, jobs: [] });
  }
  const earlyJobs = jobsFromBooking(booking);
  if (isPlaceholderJobList(booking, earlyJobs)) {
    return ok(res, { booking: null, jobs: [] });
  }
  const baseSteps = booking.servicePackage
    ? parseBookingSteps(booking.servicePackage.bookingSteps)
    : parseBookingSteps([]);
  // Custom stages from history fold into the same flow (not a parallel track)
  const steps = mergeBookingFlow(baseSteps, booking.history, booking.status);
  const statusKeys = steps.map((s) => s.key);
  const statusLabels = Object.fromEntries(steps.map((s) => [s.key, s.label]));
  const stepIndex = indexInBookingFlow(steps, booking.status);
  const pendingSlot = await prisma.lead.findFirst({
    where: {
      customerId: req.customer.id,
      studioId: req.customer.studioId,
      slotStatus: 'REQUESTED',
    },
    orderBy: { createdAt: 'desc' },
    include: { package: { select: { id: true, title: true } } },
  });

  const jobs = jobsFromBooking(booking);
  const currentJob = jobs[0] || null;

  return ok(res, {
    booking: {
      status: currentJob?.status || booking.status,
      notes: booking.notes,
      estimatedCompletion: booking.estimatedCompletion,
      history: currentJob?.history || booking.history || [],
      jobs,
      updatedAt: booking.updatedAt,
      statuses: (currentJob?.steps || steps).map((s) => s.key),
      statusLabels: Object.fromEntries((currentJob?.steps || steps).map((s) => [s.key, s.label])),
      steps: currentJob?.steps || steps,
      stepIndex: currentJob?.stepIndex ?? stepIndex,
      package: currentJob
        ? { id: currentJob.packageId, title: currentJob.packageTitle }
        : (booking.servicePackage
          ? {
            id: booking.servicePackage.id,
            title: booking.servicePackage.title,
          }
          : null),
      slotStatus: booking.slotStatus || 'NONE',
      requestedDate: booking.requestedDate,
      requestedTime: booking.requestedTime,
      rescheduleNote: booking.rescheduleNote || null,
      rescheduleRequestedAt: booking.rescheduleRequestedAt || null,
      confirmedSlot: booking.confirmedDate
        ? {
            date: booking.confirmedDate,
            time: booking.confirmedTime,
            label: formatSlotLabel(booking.confirmedDate, booking.confirmedTime),
          }
        : null,
      pendingSlot: pendingSlot
        ? {
            id: pendingSlot.id,
            date: pendingSlot.requestedDate,
            time: pendingSlot.requestedTime,
            label: formatSlotLabel(pendingSlot.requestedDate, pendingSlot.requestedTime),
            packageTitle: pendingSlot.package?.title || null,
            createdAt: pendingSlot.createdAt,
          }
        : null,
    },
  });
});

/**
 * Wedding client hub: day-wise plan, deliverables, delivery timeline, booking progress.
 * Simple plain-language payload for the exclusive wedding home UI.
 */
customerRouter.get('/wedding-plan', async (req, res) => {
  try {
    const customerId = req.customer.id;
    const studioId = req.customer.studioId;

    const [customer, booking, agreementFinal, inquiry] = await Promise.all([
      prisma.customer.findUnique({ where: { id: customerId } }),
      prisma.customerBooking.findUnique({
        where: { customerId },
        include: {
          servicePackage: {
            include: { features: { orderBy: { displayOrder: 'asc' }, take: 20 } },
          },
        },
      }),
      prisma.weddingAgreement.findFirst({
        where: { customerId, studioId, status: 'FINALIZED' },
        orderBy: { finalizedAt: 'desc' },
      }),
      prisma.lead.findFirst({
        where: {
          customerId,
          studioId,
          OR: [{ inquiryKind: 'WEDDING' }, { source: 'WEDDING' }],
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true, inquiryStatus: true, createdAt: true, adminNote: true },
      }),
    ]);

    const quotationSent = !!agreementFinal;
    const inquiryStatus = inquiry?.inquiryStatus || null;
    const inquiryApproved = !inquiry || ['APPROVED', 'BOOKED'].includes(String(inquiryStatus || ''));
    const planUnlocked = quotationSent && inquiryApproved;
    const agreement = planUnlocked ? agreementFinal : null;
    const form = (agreement?.formData && typeof agreement.formData === 'object')
      ? agreement.formData
      : {};

    let SCOPE_LABELS = {};
    let DELIVERABLE_CATALOG = [];
    let TIMELINE_CATALOG = [];
    try {
      const wa = require('../services/weddingAgreementPdf');
      SCOPE_LABELS = wa.SCOPE_LABELS || {};
      DELIVERABLE_CATALOG = wa.DELIVERABLE_CATALOG || [];
      TIMELINE_CATALOG = wa.TIMELINE_CATALOG || [];
    } catch (_) { /* optional */ }

    const deliverableById = Object.fromEntries(
      (DELIVERABLE_CATALOG || []).map((d) => [d.id, d]),
    );
    const timelineById = Object.fromEntries(
      (TIMELINE_CATALOG || []).map((t) => [t.id, t]),
    );

    // ── Days (coverage plan) ───────────────────────────────────────────────
    const rawDays = Array.isArray(form.days) ? form.days : [];
    const days = rawDays.map((day, idx) => {
      const services = (Array.isArray(day.services) ? day.services : [])
        .map((s) => {
          if (!s) return null;
          if (typeof s === 'string') {
            return { id: s, label: SCOPE_LABELS[s] || s, count: 1 };
          }
          const id = s.id || s.key || '';
          if (!id) return null;
          const count = Math.max(1, Number(s.count) || 1);
          const label = s.label || SCOPE_LABELS[id] || id.replace(/_/g, ' ');
          return { id, label, count };
        })
        .filter(Boolean);
      if (day.customService && String(day.customService).trim()) {
        services.push({
          id: 'custom',
          label: String(day.customService).trim(),
          count: 1,
        });
      }
      const dayNum = day.dayNumber != null ? Number(day.dayNumber) : idx + 1;
      return {
        id: day.id || `day-${dayNum}`,
        dayNumber: dayNum,
        label: (day.label && String(day.label).trim()) || `Day ${dayNum}`,
        date: day.date || null,
        venue: day.venue || form.primaryVenue || null,
        startTime: day.startTime || null,
        endTime: day.endTime || null,
        notes: day.notes || null,
        services,
      };
    });

    // ── Deliverables ───────────────────────────────────────────────────────
    const rawDeliverables = Array.isArray(form.deliverables) ? form.deliverables : [];
    let deliverables = rawDeliverables.map((d) => {
      if (!d) return null;
      if (typeof d === 'string') {
        const cat = deliverableById[d];
        return {
          id: d,
          title: cat?.title || d.replace(/_/g, ' '),
          description: cat?.description || null,
          qty: null,
        };
      }
      const id = d.id || d.key || '';
      const cat = deliverableById[id];
      return {
        id: id || `d-${Math.random().toString(36).slice(2, 7)}`,
        title: d.title || cat?.title || id.replace(/_/g, ' '),
        description: d.description || cat?.description || null,
        qty: d.qty != null && String(d.qty).trim() !== '' ? String(d.qty) : null,
      };
    }).filter(Boolean);

    if (!planUnlocked) deliverables = [];

    // ── Delivery timeline ──────────────────────────────────────────────────
    const rawTimeline = Array.isArray(form.timelineItems) ? form.timelineItems : [];
    let timeline = rawTimeline.map((t, i) => {
      if (!t) return null;
      if (typeof t === 'string') {
        const cat = timelineById[t];
        return {
          id: t,
          title: cat?.title || t.replace(/_/g, ' '),
          timeframe: cat?.defaultTimeframe || null,
          description: cat?.description || null,
          order: i,
        };
      }
      const id = t.id || `t-${i}`;
      const cat = timelineById[id];
      return {
        id,
        title: t.title || cat?.title || id.replace(/_/g, ' '),
        timeframe: t.timeframe || cat?.defaultTimeframe || null,
        description: t.description || cat?.description || null,
        order: i,
      };
    }).filter(Boolean);

    if (!planUnlocked) timeline = [];

    // ── Booking progress ───────────────────────────────────────────────────
    let progress = null;
    const planJobs = jobsFromBooking(booking);
    const realBooking = planUnlocked && booking && !isPlaceholderJobList(booking, planJobs);
    if (realBooking) {
      const currentJob = planJobs[0] || null;
      const base = booking.servicePackage
        ? parseBookingSteps(booking.servicePackage.bookingSteps)
        : parseBookingSteps([]);
      const steps = currentJob?.steps?.length
        ? currentJob.steps
        : mergeBookingFlow(base, booking.history, booking.status);
      const currentStatus = currentJob?.status || booking.status;
      const stepIndex = currentJob?.stepIndex ?? indexInBookingFlow(steps, currentStatus);
      progress = {
        status: currentStatus,
        statusLabel: steps[stepIndex]?.label
          || steps.find((s) => s.key === currentStatus)?.label
          || String(currentStatus || '').replace(/_/g, ' '),
        stepIndex,
        totalSteps: steps.length,
        notes: booking.notes || null,
        estimatedCompletion: booking.estimatedCompletion || null,
        packageTitle: currentJob?.packageTitle || booking.servicePackage?.title || form.packageName || null,
        steps: steps.map((s, i) => ({
          key: s.key,
          label: s.label,
          // done | current | upcoming
          state: i < stepIndex ? 'done' : i === stepIndex ? 'current' : 'upcoming',
        })),
      };
    }

    // ── Status snapshot (admin wedding fields) ─────────────────────────────
    const snapshot = {
      albumStatus: customer?.albumStatus || null,
      deliveryStatus: customer?.deliveryStatus || form.fullFilm || null,
      photographerName: customer?.photographerName || null,
      cinematographerName: customer?.cinematographerName || null,
      weddingNotes: customer?.weddingNotes || null,
      weddingDate: customer?.weddingDate || form.eventDate || null,
      weddingVenue: customer?.weddingVenue || form.primaryVenue || form.eventCity || null,
      brideName: customer?.brideName || form.partnerName || null,
      groomName: customer?.groomName || form.clientName || null,
    };

    let emptyHint = null;
    if (!planUnlocked) {
      if (inquiryStatus === 'REJECTED') {
        emptyHint = 'This inquiry was closed. Message the studio if you have questions.';
      } else if (inquiry && !inquiryApproved) {
        emptyHint = 'Your inquiry is with the studio. The day plan and deliverables appear here after they approve it and send your quotation.';
      } else if (!quotationSent) {
        emptyHint = 'Your quotation is being prepared. Deliverables and the day plan will show here once it is sent.';
      }
    } else if (!days.length && !deliverables.length) {
      emptyHint = 'Your quotation is in. The studio will add the day plan and deliverables here.';
    }

    return ok(res, {
      plan: {
        hasAgreement: !!agreementFinal,
        agreementStatus: agreementFinal?.status || null,
        agreementTitle: agreementFinal?.title || null,
        quotationSent,
        inquiryStatus,
        inquiryApproved,
        planUnlocked,
        packageName: planUnlocked
          ? (form.packageName || booking?.servicePackage?.title || null)
          : null,
        eventType: form.eventType || 'Wedding',
        days: planUnlocked ? days : [],
        deliverables,
        timeline,
        progress,
        snapshot,
        emptyHint,
      },
    });
  } catch (err) {
    return fail(res, CODES.INTERNAL, err.message || 'Could not load wedding plan', { status: 500 });
  }
});

customerRouter.get('/contact', async (req, res) => {
  const studio = await prisma.studio.findUnique({ where: { id: req.customer.studioId } });
  const profile = await ensureProfile(req.customer.studioId);
  return ok(res, { contact: await mapProfile(profile, studio) });
});

customerRouter.get('/profile', async (req, res) => {
  const c = await prisma.customer.findUnique({
    where: { id: req.customer.id },
    include: {
      _count: { select: { accessGrants: true, favorites: true } },
      booking: { include: { servicePackage: true } },
      package: true,
      contracts: {
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true, title: true, status: true, createdAt: true, acceptedAt: true, viewedAt: true, source: true,
        },
      },
      weddingAgreements: {
        where: { status: 'FINALIZED' },
        orderBy: { finalizedAt: 'desc' },
        take: 10,
        select: {
          id: true, title: true, status: true, finalizedAt: true, contractId: true,
        },
      },
      payments: {
        orderBy: { receivedAt: 'desc' },
        take: 20,
      },
      invoices: {
        where: { kind: 'INVOICE', status: { not: 'DRAFT' } },
        orderBy: { createdAt: 'desc' },
        include: {
          package: { select: { id: true, title: true } },
          installments: { orderBy: { sortOrder: 'asc' } },
          payments: { orderBy: { paidAt: 'desc' } },
        },
      },
    },
  });
  if (!c) return fail(res, CODES.NOT_FOUND, 'Customer not found', { status: 404 });

  const mappedInvoices = (c.invoices || []).map((inv) => projectInvoice(inv));
  const billing = accountSummary(mappedInvoices);

  // Studio branding for profile screen (logo, about, contact)
  const studio = await prisma.studio.findUnique({ where: { id: req.customer.studioId } });
  const studioProfile = await ensureProfile(req.customer.studioId);
  const studioMapped = await mapProfile(studioProfile, studio);

  return ok(res, {
    studio: studioMapped,
    profile: {
      id: c.id,
      name: c.name,
      email: c.email,
      phone: c.phone,
      status: c.status,
      emailVerified: c.emailVerified,
      joinedAt: c.createdAt,
      lastLoginAt: c.lastLoginAt,
      storageUsedBytes: Number(c.storageUsedBytes || 0),
      galleryCount: c._count.accessGrants,
      favoriteCount: c._count.favorites,
      bookingStatus: c.booking?.status || null,
      bookingNotes: c.booking?.notes || null,
      bookingPackage: c.booking?.servicePackage
        ? { id: c.booking.servicePackage.id, title: c.booking.servicePackage.title }
        : null,
      packageName: c.package?.name || c.booking?.servicePackage?.title || null,
      package: c.package
        ? {
          id: c.package.id,
          name: c.package.name,
          description: c.package.description,
          basePrice: Number(c.package.basePrice || 0),
          includedPhotos: c.package.includedPhotos,
          pricePerExtraPhoto: c.package.pricePerExtraPhoto == null
            ? null
            : Number(c.package.pricePerExtraPhoto),
          workflowMode: c.package.workflowMode,
        }
        : null,
      payment: {
        terms: c.paymentTerms || null,
        currency: billing.currency,
        totalDue: billing.billed,
        amountPaid: billing.paid,
        adjusted: billing.adjusted,
        balance: billing.balance,
        credit: billing.credit,
      },
      contracts: (c.contracts || []).map((x) => ({
        id: x.id,
        title: x.title,
        status: x.status,
        createdAt: x.createdAt,
        acceptedAt: x.acceptedAt,
        viewedAt: x.viewedAt,
        source: x.source,
      })),
      weddingAgreements: (c.weddingAgreements || []).map((a) => ({
        id: a.id,
        title: a.title,
        status: a.status,
        finalizedAt: a.finalizedAt,
        contractId: a.contractId,
      })),
      invoices: mappedInvoices.map((inv) => ({
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        title: inv.title,
        status: inv.status,
        currency: inv.currency,
        totalAmount: inv.totalAmount,
        amountPaid: inv.cashPaid,
        adjusted: inv.adjusted,
        balance: inv.balance,
        packageTitle: inv.package?.title || null,
        installmentCount: (inv.installments || []).length,
        sentAt: inv.sentAt,
        createdAt: inv.createdAt,
      })),
      payments: mappedInvoices.flatMap(inv => inv.payments.map(p => ({ ...p, invoiceNumber: inv.invoiceNumber })))
        .sort((a, b) => new Date(b.paidAt) - new Date(a.paidAt)),
    },
  });
});

customerRouter.patch('/profile', async (req, res) => {
  const { name, phone } = req.body || {};
  const data = {};
  if (name != null && String(name).trim()) data.name = String(name).trim().slice(0, 120);
  if (phone !== undefined) data.phone = phone ? String(phone).trim().slice(0, 40) : null;
  const c = await prisma.customer.update({ where: { id: req.customer.id }, data });
  return ok(res, { id: c.id, name: c.name, phone: c.phone, email: c.email });
});

function parseSlotTime(raw) {
  if (raw == null || raw === '') return null;
  const s = String(raw).trim();
  // Accept "10:00", "10:00 AM", "10am"
  const m24 = s.match(/^(\d{1,2}):(\d{2})$/);
  if (m24) {
    const h = Number(m24[1]);
    const min = Number(m24[2]);
    if (h >= 0 && h <= 23 && min >= 0 && min <= 59) {
      return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
    }
  }
  const m12 = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
  if (m12) {
    let h = Number(m12[1]);
    const min = Number(m12[2] || 0);
    const ap = m12[3].toLowerCase();
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    if (h >= 0 && h <= 23 && min >= 0 && min <= 59) {
      return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
    }
  }
  return s.slice(0, 20);
}

function formatSlotLabel(date, time) {
  if (!date && !time) return '';
  let dPart = '';
  if (date) {
    const d = date instanceof Date ? date : new Date(date);
    if (!Number.isNaN(d.getTime())) {
      dPart = d.toLocaleDateString('en-IN', {
        weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
      });
    }
  }
  let tPart = time || '';
  if (tPart && /^\d{2}:\d{2}$/.test(tPart)) {
    const [hh, mm] = tPart.split(':').map(Number);
    const ap = hh >= 12 ? 'PM' : 'AM';
    const h12 = ((hh + 11) % 12) + 1;
    tPart = `${h12}:${String(mm).padStart(2, '0')} ${ap}`;
  }
  if (dPart && tPart) return `${dPart} · ${tPart}`;
  return dPart || tPart;
}

customerRouter.post('/lead', async (req, res) => {
  const {
    packageId, message, source, name, phone, email, couponCode,
    requestedDate, requestedTime, formData,
  } = req.body || {};
  let pkg = null;
  if (packageId) {
    pkg = await prisma.servicePackage.findFirst({
      where: { id: packageId, studioId: req.customer.studioId },
    });
    if (!pkg) return fail(res, CODES.NOT_FOUND, 'Package not found', { status: 404 });
  }

  const src = String(source || 'ENQUIRE').toUpperCase();
  const isBook = src === 'BOOK';
  const slotTime = parseSlotTime(requestedTime);
  let slotDate = null;
  if (requestedDate) {
    const d = new Date(requestedDate);
    if (!Number.isNaN(d.getTime())) {
      // Normalize to date-only UTC noon to avoid TZ day shifts in display
      slotDate = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0));
    }
  }

  // Book Now requires package + preferred date + time
  if (isBook) {
    if (!pkg) {
      return fail(res, CODES.VALIDATION, 'Choose a package to book', { status: 400 });
    }
    if (!slotDate || !slotTime) {
      return fail(
        res,
        CODES.VALIDATION,
        'Pick a preferred date and time for your session',
        { status: 400 },
      );
    }
    // Disallow past dates
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const check = new Date(slotDate);
    check.setHours(0, 0, 0, 0);
    if (check < today) {
      return fail(res, CODES.VALIDATION, 'Please choose a future date', { status: 400 });
    }
  }

  const slotLabel = formatSlotLabel(slotDate, slotTime);
  const leadMsg = [
    message || null,
    isBook && pkg ? `Book request: ${pkg.title}` : null,
    !isBook && pkg ? `Enquiry: ${pkg.title}` : null,
    slotLabel ? `Preferred slot: ${slotLabel}` : null,
    couponCode ? `Coupon: ${String(couponCode).toUpperCase()}` : null,
  ].filter(Boolean).join('\n');

  const hasSlot = !!(slotDate && slotTime);

  const lead = await prisma.lead.create({
    data: {
      studioId: req.customer.studioId,
      customerId: req.customer.id,
      packageId: packageId || null,
      message: leadMsg || null,
      source: src,
      name: name || req.customer.name,
      email: email || req.customer.email,
      phone: phone || req.customer.phone,
      status: 'NEW',
      requestedDate: slotDate,
      requestedTime: slotTime,
      slotStatus: hasSlot ? 'REQUESTED' : 'NONE',
      formData: formData && typeof formData === 'object' ? formData : undefined,
      inquiryKind: src === 'WEDDING' ? 'WEDDING' : 'GENERAL',
      inquiryStatus: 'PENDING',
    },
    include: { package: { select: { id: true, title: true, price: true, discountPrice: true } } },
  });

  // Book: assign package + pricing to the client. Enquire: request only.
  if (pkg && isBook) {
    try {
      const fresh = await prisma.customer.findUnique({
        where: { id: req.customer.id },
        select: { packageId: true },
      });
      if (!fresh?.packageId) {
        const { assignServicePackageToCustomer } = require('../services/packageSync');
        await assignServicePackageToCustomer({
          studioId: req.customer.studioId,
          customerId: req.customer.id,
          servicePackageId: pkg.id,
          // The enquiry below creates this shoot; pricing must not add a second job.
          syncBooking: false,
        });
      }
      // Do not auto-enable the wedding app theme on book/enquire.
      // Admin turns wedding experience on from the client page.
    } catch (err) {
      logger.warn(`[portal] assign package on book skipped: ${err.message}`);
    }
  } else if (pkg && src === 'ENQUIRE') {
    await prisma.customer.update({
      where: { id: req.customer.id },
      data: { requestedPackageId: pkg.selectionTierId || undefined },
    }).catch(() => {});
  }

  // Each enquiry/book is its own job. Never wipe an earlier package timeline.
  if (pkg && (isBook || src === 'ENQUIRE' || src === 'WEDDING')) {
    const newJob = makeEnquiryJob({
      lead, pkg, isBook, slotDate, slotTime, slotLabel, hasSlot,
    });
    await upsertCustomerJob({
      studioId: req.customer.studioId,
      customerId: req.customer.id,
      pkg,
      newJob,
    });
  }

  try {
    const { triggerAuto } = require('../services/whatsapp');
    const toPhone = lead.phone || req.customer.phone;
    if (toPhone) {
      triggerAuto(req.customer.studioId, 'LEAD_RECEIVED', {
        phone: toPhone,
        toName: lead.name || req.customer.name,
        vars: {
          name: lead.name || req.customer.name,
          packageTitle: pkg?.title ? ` for ${pkg.title}` : '',
          message: hasSlot
            ? `We received your preferred slot (${slotLabel}). The studio will confirm shortly.`
            : (leadMsg || ''),
        },
        meta: { leadId: lead.id, slotStatus: lead.slotStatus },
      });
    }
  } catch (_) { /* optional */ }

  return ok(res, {
    lead: {
      id: lead.id,
      status: lead.status,
      source: lead.source,
      slotStatus: lead.slotStatus,
      requestedDate: lead.requestedDate,
      requestedTime: lead.requestedTime,
      slotLabel: formatSlotLabel(lead.requestedDate, lead.requestedTime),
      package: lead.package
        ? {
            id: lead.package.id,
            title: lead.package.title,
            price: Number(lead.package.discountPrice ?? lead.package.price ?? 0),
          }
        : null,
      createdAt: lead.createdAt,
    },
    message: hasSlot
      ? 'Request sent — studio will confirm your time slot'
      : 'Enquiry sent to the studio',
  }, 201);
});

customerRouter.get('/wedding-inquiry/catalog', async (req, res) => {
  return ok(res, await require('../services/inquiryCatalog').getCatalog(req.customer.studioId));
});

customerRouter.get('/wedding-inquiry', async (req, res) => {
  const lead = await prisma.lead.findFirst({
    where: {
      customerId: req.customer.id,
      studioId: req.customer.studioId,
      OR: [{ inquiryKind: 'WEDDING' }, { source: 'WEDDING' }],
    },
    orderBy: { createdAt: 'desc' },
    include: { package: { select: { id: true, title: true } } },
  });
  if (!lead) return ok(res, { inquiry: null, catalog: weddingInquiry.catalogs() });
  return ok(res, {
    inquiry: weddingInquiry.serializeInquiry(lead),
    catalog: weddingInquiry.catalogs(),
  });
});

customerRouter.post('/wedding-inquiry', async (req, res) => {
  const configured = await require('../services/inquiryCatalog').getCatalog(req.customer.studioId);
  const form = weddingInquiry.normalizeForm(req.body || {}, req.customer, configured);
  const errors = weddingInquiry.validateWeddingForm(form);
  if (Object.keys(errors).length) {
    return fail(res, CODES.VALIDATION, Object.values(errors)[0], {
      status: 400,
      details: { errors },
    });
  }

  // An enquiry has no agreed package until the client chooses a quotation.
  const pkg = null;

  const slotDate = weddingInquiry.primaryDate(form);
  const slotTime = form.schedule === 'EVENING' ? '16:00' : form.schedule === 'MORNING' ? '09:00' : '10:00';
  const hasSlot = !!slotDate;
  const slotLabel = formatSlotLabel(slotDate, hasSlot ? slotTime : null);

  const lead = await prisma.lead.create({
    data: {
      studioId: req.customer.studioId,
      customerId: req.customer.id,
      packageId: pkg?.id || null,
      source: 'WEDDING',
      inquiryKind: 'WEDDING',
      inquiryStatus: 'PENDING',
      status: 'NEW',
      name: form.contact.name,
      email: form.contact.email,
      phone: form.contact.phone,
      message: weddingInquiry.leadMessage(form),
      formData: form,
      requestedDate: slotDate,
      requestedTime: hasSlot ? slotTime : null,
      slotStatus: hasSlot ? 'REQUESTED' : 'NONE',
    },
    include: { package: { select: { id: true, title: true, price: true, discountPrice: true } } },
  });

  // Save contact / venue on the client. Do NOT flip weddingExperience —
  // that luxury home is admin-only, not a side-effect of sending an inquiry.
  await prisma.customer.update({
    where: { id: req.customer.id },
    data: {
      name: form.contact.name || undefined,
      weddingVenue: weddingInquiry.venueLine(form) || undefined,
      weddingDate: slotDate || undefined,
    },
  }).catch(() => {});
  await prisma.customer.update({
    where: { id: req.customer.id },
    data: {
      ...(form.contact.email ? { email: form.contact.email } : {}),
      ...(!req.customer.phone && form.contact.phone ? { phone: form.contact.phone } : {}),
    },
  }).catch(() => {});

  const newJob = null;

  try {
    const { triggerAuto } = require('../services/whatsapp');
    if (form.contact.phone) {
      triggerAuto(req.customer.studioId, 'LEAD_RECEIVED', {
        phone: form.contact.phone,
        toName: form.contact.name,
        vars: {
          name: form.contact.name,
          packageTitle: ' for wedding coverage',
          message: `We received your wedding inquiry${slotLabel ? ` (${slotLabel})` : ''}. The studio will review and reply shortly.`,
        },
        meta: { leadId: lead.id, inquiryKind: 'WEDDING' },
      });
    }
  } catch (_) { /* optional */ }

  return ok(res, {
    inquiry: weddingInquiry.serializeInquiry(lead, { job: newJob }),
    weddingExperience: false,
    message: 'Inquiry sent — the studio will review and get back to you',
  }, 201);
});

/** Customer's open booking/slot requests + confirmed slot. */
customerRouter.get('/my-requests', async (req, res) => {
  const leads = await prisma.lead.findMany({
    where: {
      customerId: req.customer.id,
      studioId: req.customer.studioId,
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
    include: { package: { select: { id: true, title: true, price: true, discountPrice: true } } },
  });
  const booking = await prisma.customerBooking.findUnique({
    where: { customerId: req.customer.id },
    include: { servicePackage: { select: { id: true, title: true } } },
  });

  return ok(res, {
    requests: leads.map((l) => ({
      id: l.id,
      source: l.source,
      status: l.status,
      slotStatus: l.slotStatus || 'NONE',
      requestedDate: l.requestedDate,
      requestedTime: l.requestedTime,
      confirmedDate: l.confirmedDate,
      confirmedTime: l.confirmedTime,
      slotLabel: formatSlotLabel(
        l.confirmedDate || l.requestedDate,
        l.confirmedTime || l.requestedTime,
      ),
      adminNote: l.adminNote || null,
      message: l.message,
      package: l.package
        ? {
            id: l.package.id,
            title: l.package.title,
            price: Number(l.package.discountPrice ?? l.package.price ?? 0),
          }
        : null,
      createdAt: l.createdAt,
      decidedAt: l.decidedAt,
    })),
    confirmedSlot: booking?.confirmedDate
      ? {
          date: booking.confirmedDate,
          time: booking.confirmedTime,
          label: formatSlotLabel(booking.confirmedDate, booking.confirmedTime),
          packageTitle: booking.servicePackage?.title || null,
        }
      : null,
    booking: booking
      ? {
          id: booking.id,
          status: booking.status,
          slotStatus: booking.slotStatus || 'NONE',
          requestedDate: booking.requestedDate,
          requestedTime: booking.requestedTime,
          confirmedDate: booking.confirmedDate,
          confirmedTime: booking.confirmedTime,
          rescheduleNote: booking.rescheduleNote,
          rescheduleRequestedAt: booking.rescheduleRequestedAt,
          history: booking.history,
        }
      : null,
  });
});

/** Customer request to edit/reschedule shoot timeslot */
customerRouter.post('/reschedule', async (req, res) => {
  const { requestedDate, requestedTime, note } = req.body || {};
  if (!requestedDate) {
    return fail(res, CODES.VALIDATION, 'Requested date is required', { status: 400 });
  }
  const d = new Date(requestedDate);
  if (Number.isNaN(d.getTime())) {
    return fail(res, CODES.VALIDATION, 'Invalid requested date', { status: 400 });
  }
  const reqDate = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0));
  const reqTime = parseSlotTime(requestedTime) || (typeof requestedTime === 'string' ? requestedTime.trim() : '10:00');
  const now = new Date();

  const slotLabel = formatSlotLabel(reqDate, reqTime);
  let result;
  try {
    result = await updateSlot(prisma, { studioId: req.customer.studioId, customerId: req.customer.id,
      jobId: req.body.jobId, date: reqDate.toISOString(), time: reqTime, label: slotLabel, note, reschedule: true });
  } catch (err) { return fail(res, err.code || CODES.VALIDATION, err.message, { status: err.status || 500 }); }
  const { booking } = result;

  try {
    const { notifyShootSchedule } = require('../services/whatsapp');
    if (req.customer.phone) {
      await notifyShootSchedule(req.customer.studioId, {
        phone: req.customer.phone,
        name: req.customer.name,
        customerId: req.customer.id,
        kind: 'reschedule_requested',
        date: reqDate,
        time: reqTime,
        clientNote: note ? String(note).slice(0, 500) : '',
      });
    }
  } catch (e) {
    logger.warn(`[reschedule] WhatsApp notify error: ${e.message}`);
  }

  return ok(res, {
    success: true,
    slotStatus: 'RESCHEDULE_REQUESTED',
    requestedDate: reqDate,
    requestedTime: reqTime,
    slotLabel,
    booking,
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ADMIN CMS
// ═══════════════════════════════════════════════════════════════════════════

const adminRouter = express.Router();
adminRouter.use(authenticateAdmin);

// —— Profile ——
adminRouter.get('/profile', async (req, res) => {
  const studio = await prisma.studio.findUnique({ where: { id: req.studioId } });
  const profile = await ensureProfile(req.studioId);
  return ok(res, { profile: await mapProfile(profile, studio), raw: profile });
});

adminRouter.put('/profile', upload.fields([
  { name: 'logo', maxCount: 1 },
  { name: 'paymentQr', maxCount: 1 },
  { name: 'cover', maxCount: 1 },
]), async (req, res) => {
  const body = req.body || {};
  const data = {};
  const fields = [
    'displayName', 'tagline', 'about', 'welcomeMessage', 'phone', 'whatsapp',
    'email', 'website', 'instagram', 'facebook', 'youtube', 'address', 'mapsUrl',
    'upiId', 'workingHours', 'themeColor', 'secondaryColor', 'termsHtml', 'privacyHtml', 'refundHtml',
  ];
  for (const f of fields) {
    if (body[f] !== undefined) data[f] = body[f] === '' ? null : body[f];
  }
  if (body.appTheme !== undefined) data.appTheme = normalizeAppTheme(body.appTheme);
  if (body.appThemeMode !== undefined) data.appThemeMode = normalizeAppThemeMode(body.appThemeMode);
  if (req.files?.paymentQr?.[0]) {
    const file = req.files.paymentQr[0];
    const buffer = await require('sharp')(file.buffer).rotate().png().toBuffer();
    data.paymentQrKey = `studios/${req.studioId}/payment-qr/${uuidv4()}.png`;
    await uploadToS3(data.paymentQrKey, buffer, 'image/png');
  }
  if (req.files?.logo?.[0]) {
    data.logoKey = await uploadCmsImage(req.studioId, 'profile', req.files.logo[0]);
  }
  if (req.files?.cover?.[0]) {
    data.coverKey = await uploadCmsImage(req.studioId, 'profile', req.files.cover[0]);
  }
  await ensureProfile(req.studioId);
  const profile = await prisma.studioProfile.update({ where: { studioId: req.studioId }, data });
  const studio = await prisma.studio.findUnique({ where: { id: req.studioId } });
  // Keep Studio.logoUrl in sync when possible
  if (data.logoKey) {
    const url = await signCms(data.logoKey, 'thumb');
    await prisma.studio.update({ where: { id: req.studioId }, data: { logoUrl: url } });
  }
  return ok(res, { profile: await mapProfile(profile, studio) });
});

// —— Service packages ——
adminRouter.get('/packages', async (req, res) => {
  const list = await prisma.servicePackage.findMany({
    where: { studioId: req.studioId },
    orderBy: [{ displayOrder: 'asc' }, { createdAt: 'desc' }],
    include: { features: true, _count: { select: { leads: true } } },
  });
  return ok(res, {
    packages: await Promise.all(list.map(async (p) => ({
      ...(await mapPackage(p)),
      leadsCount: p._count.leads,
    }))),
  });
});

adminRouter.post('/packages', upload.single('cover'), async (req, res) => {
  const {
    title, description, price, discountPrice, isFeatured, displayOrder, active, features, bookingSteps, eventType, details,
    includedPhotos, pricePerExtraPhoto, pricePerExtraRaw, pricePerExtraEdited, workflowMode,
  } = req.body;
  if (!title) return fail(res, CODES.VALIDATION, 'Title required', { status: 400 });
  let coverKey = null;
  if (req.file) {
    coverKey = await uploadCmsImage(req.studioId, 'packages', req.file);
  } else if (req.body.coverKey) {
    const key = String(req.body.coverKey).trim();
    if (!key.startsWith(`studios/${req.studioId}/`)) return fail(res,CODES.VALIDATION,'Invalid cover key for this studio',{status:400});
    coverKey = key;
  }
  let featureList = [];
  if (features) {
    try { featureList = typeof features === 'string' ? JSON.parse(features) : features; } catch { /* ignore */ }
  }
  let steps = [];
  if (bookingSteps) {
    try { steps = typeof bookingSteps === 'string' ? JSON.parse(bookingSteps) : bookingSteps; } catch { /* */ }
  }
  const pkg = await prisma.servicePackage.create({
    data: {
      studioId: req.studioId,
      title,
      eventType: String(eventType || 'GENERAL').toUpperCase(),
      details: details ? (typeof details === 'string' ? JSON.parse(details) : details) : {},
      description: description || null,
      price: num(price) || 0,
      discountPrice: num(discountPrice),
      isFeatured: isFeatured === true || isFeatured === 'true',
      displayOrder: parseInt(displayOrder || 0, 10),
      active: active !== false && active !== 'false',
      coverKey,
      bookingSteps: parseBookingSteps(steps),
      includedPhotos: includedPhotos === '' || includedPhotos == null
        ? null
        : Math.max(0, parseInt(includedPhotos, 10) || 0),
      pricePerExtraPhoto: pricePerExtraEdited === '' || pricePerExtraEdited == null
        ? (pricePerExtraPhoto === '' || pricePerExtraPhoto == null ? null : Number(pricePerExtraPhoto))
        : Number(pricePerExtraEdited),
      pricePerExtraRaw: pricePerExtraRaw === '' || pricePerExtraRaw == null
        ? null
        : Number(pricePerExtraRaw),
      pricePerExtraEdited: pricePerExtraEdited === '' || pricePerExtraEdited == null
        ? (pricePerExtraPhoto === '' || pricePerExtraPhoto == null ? null : Number(pricePerExtraPhoto))
        : Number(pricePerExtraEdited),
      workflowMode: workflowMode || 'SELECT_ONLY',
      features: {
        create: (Array.isArray(featureList) ? featureList : []).map((t, i) => ({
          title: typeof t === 'string' ? t : t.title,
          displayOrder: i,
        })),
      },
    },
    include: { features: true },
  });
  try {
    const { syncSelectionTierFromServicePackage } = require('../services/packageSync');
    await syncSelectionTierFromServicePackage(pkg);
  } catch (_) { /* non-fatal */ }
  const fresh = await prisma.servicePackage.findUnique({
    where: { id: pkg.id },
    include: { features: true },
  });
  return ok(res, { package: await mapPackage(fresh) }, 201);
});

adminRouter.patch('/packages/:id', upload.single('cover'), async (req, res) => {
  const existing = await prisma.servicePackage.findFirst({
    where: { id: req.params.id, studioId: req.studioId },
  });
  if (!existing) return fail(res, CODES.NOT_FOUND, 'Package not found', { status: 404 });
  const {
    title, description, price, discountPrice, isFeatured, displayOrder, active, features, bookingSteps, eventType, details,
    includedPhotos, pricePerExtraPhoto, pricePerExtraRaw, pricePerExtraEdited, workflowMode,
  } = req.body;
  const data = {
    ...(title && { title }),
    ...(eventType !== undefined && { eventType: String(eventType).toUpperCase() }),
    ...(details !== undefined && { details: typeof details === 'string' ? JSON.parse(details) : details }),
    ...(description !== undefined && { description }),
    ...(price !== undefined && { price: num(price) || 0 }),
    ...(discountPrice !== undefined && { discountPrice: num(discountPrice) }),
    ...(isFeatured !== undefined && { isFeatured: isFeatured === true || isFeatured === 'true' }),
    ...(displayOrder != null && { displayOrder: parseInt(displayOrder, 10) }),
    ...(active !== undefined && { active: active === true || active === 'true' }),
    ...(includedPhotos !== undefined && {
      includedPhotos: includedPhotos === '' || includedPhotos == null
        ? null
        : Math.max(0, parseInt(includedPhotos, 10) || 0),
    }),
    ...(pricePerExtraPhoto !== undefined && {
      pricePerExtraPhoto: pricePerExtraPhoto === '' || pricePerExtraPhoto == null
        ? null
        : Number(pricePerExtraPhoto),
    }),
    ...(pricePerExtraRaw !== undefined && {
      pricePerExtraRaw: pricePerExtraRaw === '' || pricePerExtraRaw == null
        ? null
        : Number(pricePerExtraRaw),
    }),
    ...(pricePerExtraEdited !== undefined && {
      pricePerExtraEdited: pricePerExtraEdited === '' || pricePerExtraEdited == null
        ? null
        : Number(pricePerExtraEdited),
    }),
    ...(workflowMode !== undefined && { workflowMode: workflowMode || 'SELECT_ONLY' }),
  };
  // Keep legacy single rate aligned with edited rate when edited is set
  if (data.pricePerExtraEdited != null && data.pricePerExtraPhoto == null) {
    data.pricePerExtraPhoto = data.pricePerExtraEdited;
  }
  if (bookingSteps !== undefined) {
    let steps = bookingSteps;
    try { if (typeof steps === 'string') steps = JSON.parse(steps); } catch { steps = []; }
    data.bookingSteps = parseBookingSteps(steps);
  }
  if (req.file) {
    data.coverKey = await uploadCmsImage(req.studioId, 'packages', req.file);
  } else if (req.body.coverKey !== undefined) {
    // Reuse an Our Work / portfolio media key (must belong to this studio)
    const ck = req.body.coverKey ? String(req.body.coverKey).trim() : null;
    if (!ck) {
      data.coverKey = null;
    } else if (!ck.startsWith(`studios/${req.studioId}/`)) {
      return fail(res, CODES.VALIDATION, 'Invalid cover key for this studio', { status: 400 });
    } else {
      data.coverKey = ck;
      // Ensure derivatives exist when reusing portfolio master
      try {
        const { ensureCmsDerivatives } = require('../services/cmsImages');
        await ensureCmsDerivatives(ck);
      } catch (_) { /* best effort */ }
    }
  }
  if (features !== undefined) {
    let featureList = [];
    try { featureList = typeof features === 'string' ? JSON.parse(features) : features; } catch { /* */ }
    await prisma.servicePackageFeature.deleteMany({ where: { packageId: existing.id } });
    await prisma.servicePackageFeature.createMany({
      data: (Array.isArray(featureList) ? featureList : []).map((t, i) => ({
        packageId: existing.id,
        title: typeof t === 'string' ? t : t.title,
        displayOrder: i,
      })),
    });
  }
  const pkg = await prisma.servicePackage.update({
    where: { id: existing.id },
    data,
    include: { features: true },
  });
  try {
    const { syncSelectionTierFromServicePackage } = require('../services/packageSync');
    await syncSelectionTierFromServicePackage(pkg);
  } catch (_) { /* non-fatal */ }
  const fresh = await prisma.servicePackage.findUnique({
    where: { id: pkg.id },
    include: { features: true },
  });
  return ok(res, { package: await mapPackage(fresh) });
});

adminRouter.delete('/packages/:id', async (req, res) => {
  try {
    const { deleteOrArchiveServicePackage } = require('../services/packageSync');
    const result = await deleteOrArchiveServicePackage({
      studioId: req.studioId,
      packageId: req.params.id,
    });
    return ok(res, result);
  } catch (err) {
    return fail(res, err.code || CODES.INTERNAL, err.message || 'Could not delete package', {
      status: err.status || 500,
    });
  }
});

/** One-time / on-demand unify: ServicePackage ↔ selection pricing (ClientType). */
adminRouter.post('/packages/unify', async (req, res) => {
  try {
    const { unifyPackagesForStudio } = require('../services/packageSync');
    await unifyPackagesForStudio(req.studioId);
    const list = await prisma.servicePackage.findMany({
      where: { studioId: req.studioId },
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'desc' }],
      include: { features: true },
    });
    return ok(res, {
      unified: true,
      packages: await Promise.all(list.map(mapPackage)),
    });
  } catch (err) {
    return fail(res, CODES.INTERNAL, err.message, { status: 500 });
  }
});

// —— Portfolio ——
adminRouter.get('/portfolio', async (req, res) => {
  const items = await prisma.portfolioItem.findMany({
    where: { studioId: req.studioId },
    orderBy: { displayOrder: 'asc' },
    include: { media: { orderBy: { sortOrder: 'asc' } } },
  });
  return ok(res, {
    items: await Promise.all(items.map(mapPortfolioItem)),
  });
});

adminRouter.post('/portfolio', upload.fields([
  { name: 'cover', maxCount: 1 },
  { name: 'media', maxCount: 24 },
]), async (req, res) => {
  const { title, description, category, mediaType, displayOrder, active, externalUrl } = req.body;
  if (!title || !String(title).trim()) {
    return fail(res, CODES.VALIDATION, 'Title required', { status: 400 });
  }

  const wantReel = String(mediaType || '').toUpperCase() === 'REEL'
    || String(mediaType || '').toUpperCase() === 'INSTAGRAM'
    || !!(externalUrl && String(externalUrl).trim());
  const normalizedExternal = normalizeExternalUrl(externalUrl);
  if (wantReel && externalUrl && String(externalUrl).trim() && !normalizedExternal) {
    return fail(res, CODES.VALIDATION, 'Enter a valid Instagram Reel or post link', { status: 400 });
  }
  if (wantReel && !normalizedExternal) {
    return fail(res, CODES.VALIDATION, 'Instagram Reel link is required', { status: 400 });
  }

  const files = [
    ...(req.files?.media || []),
  ];
  // Optional single cover file goes first if provided
  if (req.files?.cover?.[0]) {
    files.unshift(req.files.cover[0]);
  }

  const uploaded = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const isVideo = (f.mimetype || '').startsWith('video');
    let key;
    if (isVideo) {
      key = `studios/${req.studioId}/portfolio/${uuidv4()}${path.extname(f.originalname) || '.mp4'}`;
      await uploadToS3(key, f.buffer, f.mimetype || 'video/mp4');
    } else {
      key = await uploadCmsImage(req.studioId, 'portfolio', f);
    }
    uploaded.push({
      mediaKey: key,
      mediaType: isVideo ? 'VIDEO' : 'IMAGE',
      sortOrder: i,
    });
  }

  // Dedupe if cover was also in media
  const seen = new Set();
  const uniqueMedia = uploaded.filter((m) => {
    if (seen.has(m.mediaKey)) return false;
    seen.add(m.mediaKey);
    return true;
  }).map((m, i) => ({ ...m, sortOrder: i }));

  const primary = uniqueMedia[0] || null;
  const primaryType = wantReel
    ? 'REEL'
    : (mediaType || primary?.mediaType || 'IMAGE');

  const item = await prisma.portfolioItem.create({
    data: {
      studioId: req.studioId,
      title: String(title).trim(),
      description: description ? String(description).trim() : null,
      category: category ? String(category).trim() : null,
      mediaType: primaryType,
      externalUrl: wantReel ? normalizedExternal : null,
      displayOrder: parseInt(displayOrder || 0, 10) || 0,
      active: active !== 'false' && active !== false,
      coverKey: primary?.mediaKey || null,
      mediaKey: primary?.mediaKey || null,
      media: uniqueMedia.length
        ? {
            create: uniqueMedia.map((m) => ({
              mediaKey: m.mediaKey,
              mediaType: m.mediaType,
              sortOrder: m.sortOrder,
            })),
          }
        : undefined,
    },
    include: { media: { orderBy: { sortOrder: 'asc' } } },
  });

  bustPortfolioCache(req.studioId);
  return ok(res, { item: await mapPortfolioItem(item) }, 201);
});

/** Append more media to an existing work (optional multi-photo). */
adminRouter.post('/portfolio/:id/media', upload.array('media', 24), async (req, res) => {
  const existing = await prisma.portfolioItem.findFirst({
    where: { id: req.params.id, studioId: req.studioId },
    include: { media: true },
  });
  if (!existing) return fail(res, CODES.NOT_FOUND, 'Portfolio item not found', { status: 404 });

  const files = req.files || [];
  if (!files.length) return fail(res, CODES.VALIDATION, 'Add at least one file', { status: 400 });

  const startOrder = existing.media.reduce((m, r) => Math.max(m, r.sortOrder || 0), -1) + 1;
  const created = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const isVideo = (f.mimetype || '').startsWith('video');
    let key;
    if (isVideo) {
      key = `studios/${req.studioId}/portfolio/${uuidv4()}${path.extname(f.originalname) || '.mp4'}`;
      await uploadToS3(key, f.buffer, f.mimetype || 'video/mp4');
    } else {
      key = await uploadCmsImage(req.studioId, 'portfolio', f);
    }
    const row = await prisma.portfolioMedia.create({
      data: {
        portfolioItemId: existing.id,
        mediaKey: key,
        mediaType: isVideo ? 'VIDEO' : 'IMAGE',
        sortOrder: startOrder + i,
      },
    });
    created.push(row);
  }

  // Ensure cover if missing
  if (!existing.coverKey && created[0]) {
    await prisma.portfolioItem.update({
      where: { id: existing.id },
      data: {
        coverKey: created[0].mediaKey,
        mediaKey: created[0].mediaKey,
        mediaType: created[0].mediaType,
      },
    });
  }

  const full = await prisma.portfolioItem.findUnique({
    where: { id: existing.id },
    include: { media: { orderBy: { sortOrder: 'asc' } } },
  });
  return ok(res, { item: await mapPortfolioItem(full), added: created.length }, 201);
});

adminRouter.patch('/portfolio/:id', async (req, res) => {
  const { title, description, category, displayOrder, active, externalUrl, mediaType } = req.body;
  const existing = await prisma.portfolioItem.findFirst({
    where: { id: req.params.id, studioId: req.studioId },
  });
  if (!existing) return fail(res, CODES.NOT_FOUND, 'Portfolio item not found', { status: 404 });

  if (title !== undefined && !String(title || '').trim()) {
    return fail(res, CODES.VALIDATION, 'Title is required', { status: 400 });
  }

  const data = {
    ...(title !== undefined && { title: String(title).trim() }),
    ...(description !== undefined && { description: description ? String(description).trim() : null }),
    ...(category !== undefined && { category: category ? String(category).trim() : null }),
    ...(displayOrder != null && { displayOrder: parseInt(displayOrder, 10) || 0 }),
    ...(active !== undefined && { active: active === true || active === 'true' }),
  };

  if (externalUrl !== undefined) {
    if (externalUrl === null || String(externalUrl).trim() === '') {
      data.externalUrl = null;
      // Clearing link: demote REEL → IMAGE if no media files force VIDEO
      if (String(existing.mediaType || '').toUpperCase() === 'REEL' && mediaType === undefined) {
        data.mediaType = 'IMAGE';
      }
    } else {
      const n = normalizeExternalUrl(externalUrl);
      if (!n) {
        return fail(res, CODES.VALIDATION, 'Enter a valid Instagram Reel or post link', { status: 400 });
      }
      data.externalUrl = n;
      data.mediaType = 'REEL';
    }
  }
  if (mediaType !== undefined && mediaType != null) {
    const t = String(mediaType).toUpperCase();
    if (t === 'REEL' || t === 'INSTAGRAM') {
      data.mediaType = 'REEL';
      if (!data.externalUrl && !existing.externalUrl) {
        return fail(res, CODES.VALIDATION, 'Instagram Reel link is required', { status: 400 });
      }
    } else if (['IMAGE', 'VIDEO'].includes(t)) {
      data.mediaType = t;
    }
  }

  await prisma.portfolioItem.update({
    where: { id: existing.id },
    data,
  });
  const full = await prisma.portfolioItem.findUnique({
    where: { id: existing.id },
    include: { media: { orderBy: { sortOrder: 'asc' } } },
  });
  bustPortfolioCache(req.studioId);
  return ok(res, { item: await mapPortfolioItem(full), updated: 1 });
});

adminRouter.delete('/portfolio/:id', async (req, res) => {
  await prisma.portfolioItem.deleteMany({ where: { id: req.params.id, studioId: req.studioId } });
  bustPortfolioCache(req.studioId);
  return ok(res, { deleted: true });
});

adminRouter.delete('/portfolio/:id/media/:mediaId', async (req, res) => {
  const item = await prisma.portfolioItem.findFirst({
    where: { id: req.params.id, studioId: req.studioId },
    include: { media: { orderBy: { sortOrder: 'asc' } } },
  });
  if (!item) return fail(res, CODES.NOT_FOUND, 'Portfolio item not found', { status: 404 });
  await prisma.portfolioMedia.deleteMany({
    where: { id: req.params.mediaId, portfolioItemId: item.id },
  });
  // Refresh cover from remaining media
  const remaining = await prisma.portfolioMedia.findMany({
    where: { portfolioItemId: item.id },
    orderBy: { sortOrder: 'asc' },
  });
  const first = remaining[0];
  await prisma.portfolioItem.update({
    where: { id: item.id },
    data: {
      coverKey: first?.mediaKey || null,
      mediaKey: first?.mediaKey || null,
      mediaType: first?.mediaType || item.mediaType,
    },
  });
  return ok(res, { deleted: true, remaining: remaining.length });
});

// —— Announcements ——
const ANN_STYLES = new Set(['FEED', 'BANNER', 'POPUP', 'BOTH']);
function normalizeAnnStyle(raw) {
  const s = String(raw || 'FEED').toUpperCase().trim();
  return ANN_STYLES.has(s) ? s : 'FEED';
}

adminRouter.get('/announcements', async (req, res) => {
  const list = await prisma.announcement.findMany({
    where: { studioId: req.studioId },
    orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
  });
  return ok(res, {
    announcements: await Promise.all(list.map(async (a) => ({
      ...a,
      style: a.style || 'FEED',
      imageUrl: await signCms(a.imageKey, 'thumb'),
    }))),
  });
});

adminRouter.post('/announcements', upload.single('image'), async (req, res) => {
  const { title, description, priority, active, expiresAt, style, ctaLabel, ctaUrl } = req.body;
  if (!title) return fail(res, CODES.VALIDATION, 'Title required', { status: 400 });
  let imageKey = null;
  if (req.file) {
    imageKey = await uploadCmsImage(req.studioId, 'announcements', req.file);
  }
  const a = await prisma.announcement.create({
    data: {
      studioId: req.studioId,
      title: String(title).trim(),
      description: description ? String(description).trim() : null,
      priority: parseInt(priority || 0, 10) || 0,
      active: active !== 'false' && active !== false,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      style: normalizeAnnStyle(style),
      ctaLabel: ctaLabel ? String(ctaLabel).trim() : null,
      ctaUrl: ctaUrl ? String(ctaUrl).trim() : null,
      imageKey,
    },
  });
  return ok(res, { announcement: { ...a, imageUrl: await signCms(a.imageKey, 'thumb') } }, 201);
});

adminRouter.patch('/announcements/:id', upload.single('image'), async (req, res) => {
  const existing = await prisma.announcement.findFirst({
    where: { id: req.params.id, studioId: req.studioId },
  });
  if (!existing) return fail(res, CODES.NOT_FOUND, 'Announcement not found', { status: 404 });

  const { title, description, priority, active, expiresAt, style, ctaLabel, ctaUrl } = req.body;
  const data = {};
  if (title !== undefined && title !== '') data.title = String(title).trim();
  if (description !== undefined) data.description = description ? String(description).trim() : null;
  if (priority != null && priority !== '') data.priority = parseInt(priority, 10) || 0;
  if (active !== undefined) data.active = active === true || active === 'true';
  if (expiresAt !== undefined) data.expiresAt = expiresAt ? new Date(expiresAt) : null;
  if (style !== undefined) data.style = normalizeAnnStyle(style);
  if (ctaLabel !== undefined) data.ctaLabel = ctaLabel ? String(ctaLabel).trim() : null;
  if (ctaUrl !== undefined) data.ctaUrl = ctaUrl ? String(ctaUrl).trim() : null;
  if (req.file) {
    data.imageKey = await uploadCmsImage(req.studioId, 'announcements', req.file);
  }

  const a = await prisma.announcement.update({
    where: { id: existing.id },
    data,
  });
  return ok(res, { announcement: { ...a, imageUrl: await signCms(a.imageKey, 'thumb') }, updated: 1 });
});

adminRouter.delete('/announcements/:id', async (req, res) => {
  await prisma.announcement.deleteMany({ where: { id: req.params.id, studioId: req.studioId } });
  return ok(res, { deleted: true });
});

// —— Bookings ——
adminRouter.get('/bookings', async (req, res) => {
  const list = await prisma.customerBooking.findMany({
    where: { studioId: req.studioId },
    include: {
      customer: { select: { id: true, name: true, email: true, phone: true } },
      servicePackage: { select: { id: true, title: true, bookingSteps: true } },
    },
    orderBy: { updatedAt: 'desc' },
  });
  return ok(res, {
    bookings: list.map((b) => {
      const base = b.servicePackage
        ? parseBookingSteps(b.servicePackage.bookingSteps)
        : parseBookingSteps([]);
      const steps = mergeBookingFlow(base, b.history, b.status);
      const jobs = jobsFromBooking(b);
      return {
        id: b.id,
        status: b.status,
        notes: b.notes,
        estimatedCompletion: b.estimatedCompletion,
        confirmedDate: b.confirmedDate,
        confirmedTime: b.confirmedTime,
        confirmedSlotLabel: formatSlotLabel(b.confirmedDate, b.confirmedTime),
        requestedDate: b.requestedDate,
        requestedTime: b.requestedTime,
        slotStatus: b.slotStatus || 'NONE',
        rescheduleNote: b.rescheduleNote || null,
        rescheduleRequestedAt: b.rescheduleRequestedAt || null,
        history: b.history,
        jobs,
        updatedAt: b.updatedAt,
        customer: b.customer,
        servicePackageId: b.servicePackageId,
        steps,
        stepIndex: indexInBookingFlow(steps, b.status),
        package: b.servicePackage
          ? {
            id: b.servicePackage.id,
            title: b.servicePackage.title,
            steps: base,
          }
          : null,
      };
    }),
    statuses: BOOKING_STATUSES,
  });
});

/** Admin direct timeslot edit or reschedule confirm */
adminRouter.put('/bookings/:customerId/timeslot', async (req, res) => {
  const customer = await prisma.customer.findFirst({
    where: { id: req.params.customerId, studioId: req.studioId },
  });
  if (!customer) return fail(res, CODES.NOT_FOUND, 'Customer not found', { status: 404 });

  const { confirmedDate, confirmedTime, adminNote } = req.body || {};
  if (!confirmedDate) {
    return fail(res, CODES.VALIDATION, 'Confirmed date is required', { status: 400 });
  }
  const d = new Date(confirmedDate);
  if (Number.isNaN(d.getTime())) {
    return fail(res, CODES.VALIDATION, 'Invalid date format', { status: 400 });
  }
  const confDate = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0));
  const confTime = parseSlotTime(confirmedTime) || (typeof confirmedTime === 'string' ? confirmedTime.trim() : '10:00');
  const slotLabel = formatSlotLabel(confDate, confTime);
  const now = new Date();

  let result;
  try {
    result = await updateSlot(prisma, { studioId: req.studioId, customerId: customer.id,
      jobId: req.body.jobId, date: confDate.toISOString(), time: confTime, label: slotLabel, note: adminNote });
  } catch (err) { return fail(res, err.code || CODES.VALIDATION, err.message, { status: err.status || 500 }); }
  const { booking, job, hadConfirmed } = result;

  try {
    const { notifyShootSchedule } = require('../services/whatsapp');
    if (customer.phone) {
      await notifyShootSchedule(req.studioId, {
        phone: customer.phone,
        name: customer.name,
        customerId: customer.id,
        kind: hadConfirmed ? 'updated' : 'confirmed',
        date: confDate,
        time: confTime,
        adminNote: adminNote ? String(adminNote).slice(0, 800) : '',
      });
    }
  } catch (e) {
    logger.warn(`[admin timeslot] WhatsApp notify error: ${e.message}`);
  }

  return ok(res, {
    success: true,
    confirmedDate: confDate,
    confirmedTime: confTime,
    slotLabel,
    booking,
  });
});

adminRouter.put('/bookings/:customerId', async (req, res) => {
  try {
    const { booking, job, entry } = await updateStage(prisma, { studioId: req.studioId, customerId: req.params.customerId, body: req.body });
    const jobs = jobsFromBooking(booking);
    await prisma.customer.update({ where: { id: booking.customerId }, data: { status: jobs[0]?.packageTitle + ' · ' + humanizeStatus(jobs[0]?.status) } });
    const customer = await prisma.customer.findUnique({ where: { id: booking.customerId } });
    if (customer?.phone) {
      try {
        const { triggerAuto } = require('../services/whatsapp');
        triggerAuto(req.studioId, 'BOOKING_UPDATE', { phone: customer.phone, toName: customer.name,
          vars: { name: customer.name, bookingStatus: `${job.packageTitle} · ${entry.label}`, notes: entry.note || '' },
          meta: { customerId: customer.id, jobId: job.id, status: job.status } });
      } catch (_) { /* optional */ }
    }
    return ok(res, { booking: { ...booking, jobs, steps: jobs[0]?.steps || [], stepIndex: jobs[0]?.stepIndex || 0 } });
  } catch (err) { return fail(res, err.code || CODES.VALIDATION, err.message, { status: err.status || 500 }); }
});

// —— Leads ——
function inquiryWhere(studioId, query = {}) {
  const where = {
    studioId,
    ...(query.kind === 'ALL' ? {} : query.kind && query.kind !== 'WEDDING' ? { inquiryKind: query.kind } : { OR: [{ inquiryKind: 'WEDDING' }, { source: 'WEDDING' }] }),
  };
  if (query.status && weddingInquiry.INQUIRY_STATUSES.includes(String(query.status).toUpperCase())) {
    where.inquiryStatus = String(query.status).toUpperCase();
  }
  const q = String(query.q || '').trim();
  if (q) {
    where.AND = [
      {
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { email: { contains: q, mode: 'insensitive' } },
          { phone: { contains: q, mode: 'insensitive' } },
          { message: { contains: q, mode: 'insensitive' } },
          { customer: { name: { contains: q, mode: 'insensitive' } } },
        ],
      },
    ];
  }
  return where;
}

adminRouter.get(['/wedding-inquiries', '/inquiries'], async (req, res) => {
  const where = inquiryWhere(req.studioId, req.query);
  const page = Math.max(1, parseInt(req.query.page, 10) || 1), pageSize = 30;
  const [list, total] = await Promise.all([prisma.lead.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    skip: (page - 1) * pageSize, take: pageSize,
    include: {
      customer: { select: { id: true, name: true, email: true, phone: true } },
      package: { select: { id: true, title: true } },
      _count: { select: { notes: true } },
      quotes: { select: { id: true, title: true, status: true, pdfKey: true }, orderBy: { createdAt: 'desc' }, take: 1 },
    },
  }), prisma.lead.count({ where })]);
  return ok(res, {
    inquiries: list.map((l) => ({
      ...weddingInquiry.serializeInquiry(l),
      notesCount: l._count?.notes || 0,
      quote: l.quotes[0] ? { id: l.quotes[0].id, title: l.quotes[0].title, status: l.quotes[0].status, hasPdf: !!l.quotes[0].pdfKey } : null,
    })),
    catalog: weddingInquiry.catalogs(),
    page, pageSize, total,
  });
});

adminRouter.get('/wedding-inquiries/:id', async (req, res) => {
  const lead = await prisma.lead.findFirst({
    where: { id: req.params.id, studioId: req.studioId },
    include: {
      customer: { select: { id: true, name: true, email: true, phone: true, weddingExperience: true } },
      package: { select: { id: true, title: true } },
      notes: { orderBy: { createdAt: 'asc' } },
    },
  });
  if (!lead) return fail(res, CODES.NOT_FOUND, 'Inquiry not found', { status: 404 });
  let job = null;
  if (lead.customerId) {
    const booking = await prisma.customerBooking.findUnique({ where: { customerId: lead.customerId } });
    job = jobsFromBooking(booking).find((j) => j.id === lead.id || j.leadId === lead.id) || null;
  }
  return ok(res, {
    inquiry: weddingInquiry.serializeInquiry(lead, { notes: lead.notes, job }),
  });
});

adminRouter.patch('/wedding-inquiries/:id', async (req, res) => {
  const existing = await prisma.lead.findFirst({
    where: { id: req.params.id, studioId: req.studioId },
    include: {
      customer: { select: { id: true, name: true, phone: true, email: true } },
      package: { select: { id: true, title: true } },
    },
  });
  if (!existing) return fail(res, CODES.NOT_FOUND, 'Inquiry not found', { status: 404 });

  const nextStatus = req.body?.inquiryStatus
    ? String(req.body.inquiryStatus).toUpperCase()
    : null;
  if (nextStatus && !weddingInquiry.INQUIRY_STATUSES.includes(nextStatus)) {
    return fail(res, CODES.VALIDATION, 'Unknown inquiry status', { status: 400 });
  }
  const adminNote = req.body?.adminNote != null
    ? String(req.body.adminNote).slice(0, 2000)
    : undefined;

  const data = {};
  if (nextStatus) {
    data.inquiryStatus = nextStatus;
    data.status = weddingInquiry.LEAD_STATUS_FOR_INQUIRY[nextStatus] || existing.status;
    data.decidedAt = ['APPROVED', 'REJECTED', 'BOOKED'].includes(nextStatus) ? new Date() : existing.decidedAt;
    if (nextStatus === 'BOOKED' && existing.requestedDate) {
      data.slotStatus = 'ACCEPTED';
      data.confirmedDate = existing.confirmedDate || existing.requestedDate;
      data.confirmedTime = existing.confirmedTime || existing.requestedTime || '10:00';
    }
  }
  if (adminNote !== undefined) data.adminNote = adminNote || null;

  const updated = await prisma.lead.update({
    where: { id: existing.id },
    data,
    include: {
      customer: { select: { id: true, name: true, phone: true, email: true } },
      package: { select: { id: true, title: true } },
      notes: { orderBy: { createdAt: 'asc' } },
    },
  });

  if (nextStatus && existing.customerId) {
    await patchJobInquiryStatus(
      existing.customerId,
      existing.id,
      nextStatus,
      adminNote || weddingInquiry.stepForStatus(nextStatus).label,
    );
  }

  try {
    const { triggerAuto } = require('../services/whatsapp');
    const phone = updated.phone || updated.customer?.phone;
    if (phone && nextStatus && nextStatus !== existing.inquiryStatus) {
      const step = weddingInquiry.stepForStatus(nextStatus);
      triggerAuto(req.studioId, 'BOOKING_UPDATE', {
        phone,
        toName: updated.name || updated.customer?.name,
        vars: {
          name: updated.name || updated.customer?.name,
          bookingStatus: step.label,
          notes: adminNote || '',
        },
        meta: { leadId: updated.id, inquiryStatus: nextStatus },
      });
    }
  } catch (_) { /* optional */ }

  return ok(res, { inquiry: weddingInquiry.serializeInquiry(updated, { notes: updated.notes }) });
});

adminRouter.post('/wedding-inquiries/:id/notes', async (req, res) => {
  const existing = await prisma.lead.findFirst({
    where: { id: req.params.id, studioId: req.studioId },
  });
  if (!existing) return fail(res, CODES.NOT_FOUND, 'Inquiry not found', { status: 404 });
  const body = String(req.body?.body || req.body?.note || '').trim().slice(0, 4000);
  if (!body) return fail(res, CODES.VALIDATION, 'Write a note first', { status: 400 });
  const note = await prisma.leadNote.create({
    data: {
      leadId: existing.id,
      authorAdminId: req.admin?.id || null,
      authorName: req.admin?.name || req.admin?.email || 'Studio',
      body,
    },
  });
  return ok(res, { note }, 201);
});

adminRouter.get('/leads', async (req, res) => {
  const list = await prisma.lead.findMany({
    where: {
      studioId: req.studioId,
      ...(req.query.status ? { status: req.query.status } : {}),
      ...(req.query.slotStatus ? { slotStatus: req.query.slotStatus } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: {
      customer: { select: { id: true, name: true, email: true, phone: true } },
      package: { select: { id: true, title: true, price: true, discountPrice: true } },
    },
  });
  return ok(res, {
    leads: list.map((l) => ({
      ...l,
      package: l.package
        ? {
            ...l.package,
            price: Number(l.package.discountPrice ?? l.package.price ?? 0),
          }
        : null,
      slotLabel: formatSlotLabel(
        l.confirmedDate || l.requestedDate,
        l.confirmedTime || l.requestedTime,
      ),
      requestedSlotLabel: formatSlotLabel(l.requestedDate, l.requestedTime),
      confirmedSlotLabel: formatSlotLabel(l.confirmedDate, l.confirmedTime),
    })),
  });
});

/**
 * Update lead status and/or accept/decline a time slot.
 * Body: { status?, slotAction?: 'ACCEPT'|'DECLINE', adminNote?, confirmedDate?, confirmedTime? }
 * ACCEPT locks the slot (final) and advances booking to BOOKING_CONFIRMED.
 */
adminRouter.patch('/leads/:id', async (req, res) => {
  const { status, slotAction, adminNote, confirmedDate, confirmedTime } = req.body || {};
  const existing = await prisma.lead.findFirst({
    where: { id: req.params.id, studioId: req.studioId },
    include: {
      customer: { select: { id: true, name: true, phone: true } },
      package: { select: { id: true, title: true, bookingSteps: true } },
    },
  });
  if (!existing) return fail(res, CODES.NOT_FOUND, 'Lead not found', { status: 404 });

  const data = {};
  if (status) data.status = String(status).toUpperCase();
  if (adminNote !== undefined) {
    data.adminNote = adminNote === null || adminNote === ''
      ? null
      : String(adminNote).slice(0, 2000);
  }

  const action = String(slotAction || '').toUpperCase();
  if (action === 'ACCEPT' || confirmedDate || confirmedTime) {
    let confDate = existing.requestedDate;
    let confTime = existing.requestedTime;
    if (confirmedDate) {
      const d = weddingInquiry.parseIsoDate(String(confirmedDate));
      if (!d) return fail(res,CODES.VALIDATION,'Enter a valid confirmed date',{status:400});
      if (!Number.isNaN(d.getTime())) {
        confDate = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0));
      }
    }
    if (confirmedTime) confTime = parseSlotTime(confirmedTime) || confTime;
    if (!confDate) confDate = existing.confirmedDate;
    if (!confDate) return fail(res,CODES.VALIDATION,'Choose the confirmed date before accepting this enquiry',{status:400});
    if (!confTime) confTime = existing.confirmedTime || '10:00';

    data.slotStatus = 'ACCEPTED';
    data.confirmedDate = confDate;
    data.confirmedTime = confTime;
    data.decidedAt = new Date();
    data.status = data.status || 'WON';
  } else if (action === 'DECLINE') {
    data.slotStatus = 'DECLINED';
    data.decidedAt = new Date();
    if (!data.status) data.status = 'CONTACTED';
  }

  const updated = await prisma.lead.update({
    where: { id: existing.id },
    data,
    include: {
      customer: { select: { id: true, name: true, phone: true, email: true } },
      package: { select: { id: true, title: true, price: true, discountPrice: true } },
    },
  });

  // On accept / edit → update customer booking
  if ((action === 'ACCEPT' || confirmedDate || confirmedTime) && existing.customerId) {
    const confDate = updated.confirmedDate;
    const confTime = updated.confirmedTime;
    const slotLabel = formatSlotLabel(confDate, confTime);
    const steps = existing.package
      ? parseBookingSteps(existing.package.bookingSteps)
      : parseBookingSteps([]);
    const confirmKey = steps.find((s) => /CONFIRM|BOOKED|SCHEDULE/i.test(s.key))?.key
      || steps.find((s) => s.key === 'BOOKING_CONFIRMED')?.key
      || 'BOOKING_CONFIRMED';
    const confirmLabel = steps.find((s) => s.key === confirmKey)?.label || 'Booking confirmed';
    const entry = {
      status: confirmKey,
      label: confirmLabel,
      at: new Date().toISOString(),
      note: `Slot confirmed: ${slotLabel}${existing.package ? ` · ${existing.package.title}` : ''}`,
    };
    const booking = await prisma.customerBooking.findUnique({ where: { customerId: existing.customerId } });
    const previous = jobsFromBooking(booking).find(j => j.id === existing.id || j.leadId === existing.id);
    await upsertCustomerJob({ studioId: req.studioId, customerId: existing.customerId, pkg: existing.package,
      newJob: serializeJob({ ...previous, id: existing.id, leadId: existing.id,
        packageId: existing.packageId || previous?.packageId || null,
        packageTitle: existing.package?.title || previous?.packageTitle || 'Your booking',
        source: previous?.source || existing.source || 'ENQUIRE', status: confirmKey,
        steps: previous?.steps || steps, history: [...(previous?.history || []), entry],
        confirmedDate: confDate?.toISOString(), confirmedTime: confTime,
        slotLabel, slotStatus: 'ACCEPTED', requestedDate: null, requestedTime: null,
        createdAt: previous?.createdAt || existing.createdAt.toISOString(), updatedAt: new Date().toISOString() }) });
    // Dashboard status line
    await prisma.customer.update({
      where: { id: existing.customerId },
      data: { status: `Session confirmed · ${slotLabel}` },
    }).catch(() => {});
  }

  // Notify client — full shoot schedule on accept / edit / decline
  try {
    const { notifyShootSchedule, triggerAuto } = require('../services/whatsapp');
    const phone = updated.phone || updated.customer?.phone;
    const name = updated.name || updated.customer?.name;
    if (phone && (action === 'ACCEPT' || action === 'DECLINE' || confirmedDate || confirmedTime)) {
      const alreadyAccepted = existing.slotStatus === 'ACCEPTED' && existing.confirmedDate;
      const kind = action === 'DECLINE'
        ? 'declined'
        : (alreadyAccepted ? 'updated' : 'confirmed');
      await notifyShootSchedule(req.studioId, {
        phone,
        name,
        customerId: existing.customerId || updated.customer?.id,
        kind,
        date: updated.confirmedDate || updated.requestedDate,
        time: updated.confirmedTime || updated.requestedTime,
        packageTitle: updated.package?.title || existing.package?.title || '',
        adminNote: updated.adminNote || '',
      });
    } else if (phone && status && status !== existing.status) {
      triggerAuto(req.studioId, 'LEAD_UPDATED', {
        phone,
        toName: name,
        vars: {
          name: name || 'there',
          leadStatus: status || updated.status,
          message: updated.message || updated.adminNote || '',
          packageTitle: updated.package?.title ? ` for ${updated.package.title}` : '',
        },
        meta: { leadId: updated.id },
      });
    }
  } catch (_) { /* optional */ }

  return ok(res, {
    lead: {
      ...updated,
      package: updated.package
        ? {
            ...updated.package,
            price: Number(updated.package.discountPrice ?? updated.package.price ?? 0),
          }
        : null,
      slotLabel: formatSlotLabel(
        updated.confirmedDate || updated.requestedDate,
        updated.confirmedTime || updated.requestedTime,
      ),
      confirmedSlotLabel: formatSlotLabel(updated.confirmedDate, updated.confirmedTime),
      requestedSlotLabel: formatSlotLabel(updated.requestedDate, updated.requestedTime),
    },
  });
});

// Export both routers — mounted separately in index.js so /api/admin/*
// is not intercepted by the customer auth middleware stack.
// Unified event enquiries. No package or booking is assumed before acceptance.
customerRouter.get('/event-inquiry/catalog', async (req,res)=>ok(res,await require('../services/inquiryCatalog').getCatalog(req.customer.studioId)));
customerRouter.post('/event-inquiry', async (req,res)=>{
 const body=req.body||{};
 const catalog=await require('../services/inquiryCatalog').getCatalog(req.customer.studioId);
 const kind=String(body.kind||'OTHER').toUpperCase();
 if(!catalog.eventTypes.some(t=>t.id===kind))return fail(res,CODES.VALIDATION,'Choose an event type',{status:400});
 const contact=body.contact||{};
 const phone=weddingInquiry.normalizePhone(contact.countryCode||'+91',contact.phone||req.customer.phone);
 const name=String(contact.name||req.customer.name||'').trim();
 const dateText=String(body.date||'');
 const date=dateText ? new Date(`${dateText}T12:00:00Z`):null;
 const flexible=body.flexible===true;
 if(name.length<2||phone.national.length<7||phone.national.length>12)return fail(res,CODES.VALIDATION,'Enter your name and a valid phone number',{status:400});
 if(!flexible&&(!date||!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==dateText))return fail(res,CODES.VALIDATION,'Choose a valid date, or select date not decided',{status:400});
 const services=Array.isArray(body.services)?body.services.filter(id=>catalog.services.some(s=>s.id===id)):[];
 const venue=String(body.venue||'').trim().slice(0,200);
 if(!venue||!services.length)return fail(res,CODES.VALIDATION,'Add your location and the coverage you need',{status:400});
 const email=String(contact.email||'').trim();
 if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return fail(res,CODES.VALIDATION,'Enter a valid email address',{status:400});
 const form={kind,labels:{services:Object.fromEntries(catalog.services.map(r=>[r.id,r.label])),budgets:Object.fromEntries(catalog.budgetTiers.map(r=>[r.id,r.label]))},eventType:catalog.eventTypes.find(t=>t.id===kind)?.label,contact:{name,phone:phone.e164,email:String(contact.email||'').slice(0,160)},venue:{location:venue},dates:{flexible,start:flexible?'':dateText,days:[]},services,budgetTier:String(body.budgetTier||'UNSURE'),organization:String(body.organization||'').slice(0,160),guestCount:Number(body.guestCount)||null,duration:String(body.duration||'').slice(0,100),deliverables:String(body.deliverables||'').slice(0,1500),notes:String(body.notes||'').slice(0,4000)};
 const lead=await prisma.lead.create({data:{studioId:req.customer.studioId,customerId:req.customer.id,name,phone:phone.e164,email:form.contact.email||null,source:kind,inquiryKind:kind,inquiryStatus:'PENDING',status:'NEW',formData:form,message:[form.eventType,form.organization,venue,form.deliverables,form.notes].filter(Boolean).join('\n'),requestedDate:flexible?null:date,slotStatus:flexible?'NONE':'REQUESTED'}});
 return ok(res,{inquiry:weddingInquiry.serializeInquiry(lead),message:'Your enquiry is with the studio. We will confirm scope and dates with you.'},201);
});
adminRouter.get('/inquiry-settings',async(req,res)=>ok(res,await require('../services/inquiryCatalog').getCatalog(req.studioId)));
adminRouter.put('/inquiry-settings',async(req,res)=>{
 if(!['OWNER','MANAGER'].includes(req.admin.role))return fail(res,CODES.FORBIDDEN,'Manager access required',{status:403});
 try{const settings=require('../services/inquiryCatalog').validateCatalog(req.body);await prisma.studioProfile.upsert({where:{studioId:req.studioId},create:{studioId:req.studioId,inquirySettings:settings},update:{inquirySettings:settings}});return ok(res,settings);}catch(e){return fail(res,CODES.VALIDATION,e.message,{status:400});}
});

module.exports = { customerRouter, adminRouter, BOOKING_STATUSES };
