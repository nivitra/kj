const express = require('express');
const bcrypt = require('bcryptjs');
const { prisma } = require('../config/prisma');
const { authenticateAdmin, requireRole } = require('../middleware/auth');
const { generateLoginId, generatePassword, hashPassword } = require('../services/credentials');
const cognito = require('../services/cognito');
const { ok, fail } = require('../lib/envelope');
const { AppError, CODES } = require('../lib/errors');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const { uploadToS3, getSignedPhotoUrl } = require('../services/s3');

const weddingPhotoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

const { assignGalleries } = require('../services/galleryAssignment');
const { galleryAvailability } = require('../services/galleryAccess');
const router = express.Router();
router.use(authenticateAdmin);

// Dashboard stats
router.get('/stats', async (req, res) => {
  try {
    const [customers, galleries, photos, submittedSelections] = await Promise.all([
      prisma.customer.count({ where: { studioId: req.studioId } }),
      prisma.eventGallery.count({ where: { studioId: req.studioId } }),
      prisma.photo.count({ where: { gallery: { studioId: req.studioId } } }),
      prisma.selection.count({ where: { status: 'SUBMITTED', gallery: { studioId: req.studioId } } }),
    ]);
    const recentUploads = await prisma.auditLog.count({
      where: { action: 'PHOTO_UPLOADED', createdAt: { gte: new Date(Date.now() - 7 * 86400000) } },
    });
    let pricingGaps = null;
    try {
      const { listPricingSetupGaps } = require('../services/pricing');
      pricingGaps = await listPricingSetupGaps(req.studioId);
    } catch (_) { /* non-fatal */ }
    res.json({
      customers,
      galleries,
      photos,
      recentUploads,
      submittedSelections,
      pricingGaps,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Command Center: pricing setup gaps that would block selection / auto-invoice. */
router.get('/billing/setup-gaps', async (req, res) => {
  try {
    const { listPricingSetupGaps } = require('../services/pricing');
    const gaps = await listPricingSetupGaps(req.studioId);
    return ok(res, gaps);
  } catch (err) {
    return fail(res, CODES.INTERNAL, err.message, { status: 500 });
  }
});

/**
 * Assign ONE package to a client (the Packages list you edit under Packages).
 * Syncs booking + selection pricing + optional gallery override.
 * Body: { servicePackageId }  (preferred)
 *        or legacy { pricingPackageId } as ClientType id / package id
 */
router.post('/customers/:id/assign-package-pricing', async (req, res) => {
  try {
    const customer = await prisma.customer.findFirst({
      where: { id: req.params.id, studioId: req.studioId },
    });
    if (!customer) return fail(res, CODES.NOT_FOUND, 'Client not found', { status: 404 });

    const {
      servicePackageId,
      pricingPackageId, // legacy: may be ServicePackage id or ClientType id
      galleryId,
      selectionLimit,
      extraPhotoPrice,
      applyGalleryOverride,
    } = req.body || {};

    let pkgId = servicePackageId || pricingPackageId;
    if (!pkgId) {
      return fail(res, CODES.VALIDATION, 'Pick a package', { status: 400 });
    }

    // Resolve: ServicePackage id first, else ClientType → linked ServicePackage
    let sp = await prisma.servicePackage.findFirst({
      where: { id: pkgId, studioId: req.studioId },
    });
    if (!sp) {
      const tier = await prisma.clientType.findFirst({
        where: { id: pkgId, studioId: req.studioId },
      });
      if (tier) {
        sp = await prisma.servicePackage.findFirst({
          where: {
            studioId: req.studioId,
            OR: [{ selectionTierId: tier.id }, { title: tier.name }],
          },
        });
        if (!sp) {
          // Create service package from legacy tier so lists stay unified
          const { syncSelectionTierFromServicePackage } = require('../services/packageSync');
          sp = await prisma.servicePackage.create({
            data: {
              studioId: req.studioId,
              title: tier.name,
              description: tier.description,
              price: Number(tier.basePrice || 0),
              includedPhotos: tier.includedPhotos ?? 20,
              pricePerExtraPhoto: tier.pricePerExtraPhoto ?? 350,
              workflowMode: tier.workflowMode || 'SELECT_ONLY',
              selectionTierId: tier.id,
              active: tier.active,
              bookingSteps: [],
            },
          });
          await syncSelectionTierFromServicePackage(sp);
        }
      }
    }
    if (!sp) return fail(res, CODES.VALIDATION, 'Package not found', { status: 404 });

    const { assignServicePackageToCustomer } = require('../services/packageSync');
    const result = await assignServicePackageToCustomer({
      studioId: req.studioId,
      customerId: customer.id,
      servicePackageId: sp.id,
      galleryId: galleryId || null,
      applyGalleryOverride: !!applyGalleryOverride,
      selectionLimit,
      extraPhotoPrice,
    });

    const updated = await prisma.customer.findUnique({
      where: { id: customer.id },
      include: { package: true, booking: { include: { servicePackage: true } } },
    });

    return ok(res, {
      ...result,
      customer: {
        id: updated.id,
        name: updated.name,
        packageId: updated.packageId,
        package: updated.package
          ? {
              id: updated.package.id,
              name: updated.package.name,
              includedPhotos: updated.package.includedPhotos,
              pricePerExtraPhoto: updated.package.pricePerExtraPhoto != null
                ? Number(updated.package.pricePerExtraPhoto)
                : null,
            }
          : null,
        servicePackage: updated.booking?.servicePackage
          ? {
              id: updated.booking.servicePackage.id,
              title: updated.booking.servicePackage.title,
            }
          : result.servicePackage,
      },
    });
  } catch (err) {
    return fail(res, CODES.INTERNAL, err.message, { status: err.status || 500 });
  }
});

// List customers (Cognito-aware management view)
// Query filters (easy admin UX):
//   kind=clients|guests|all   (default clients)
//   gallery=has|none
//   login=never|signed_in
//   account=active|disabled
//   package=has|none
//   phone=has|none
router.get('/customers', async (req, res) => {
  try {
    const {
      search,
      page = 1,
      limit = 20,
      kind = 'clients',
      gallery,
      login,
      account,
      package: packageFilter,
      phone: phoneFilter,
      experience,
    } = req.query;
    const skip = (page - 1) * limit;
    const take = Math.min(Math.max(Number(limit) || 20, 1), 100);

    const and = [{ studioId: req.studioId }];

    // Clients vs QR/share guests vs everyone
    const kindNorm = String(kind || 'clients').toLowerCase();
    if (kindNorm === 'guests') and.push({ isGuest: true });
    else if (kindNorm === 'all') {
      /* no isGuest filter */
    } else {
      and.push({ isGuest: false }); // default: full clients only
    }

    if (search && String(search).trim()) {
      const q = String(search).trim();
      and.push({
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { email: { contains: q, mode: 'insensitive' } },
          { phone: { contains: q } },
          { loginId: { contains: q, mode: 'insensitive' } },
          { cognitoSub: { contains: q } },
        ],
      });
    }

    if (gallery === 'has') and.push({ accessGrants: { some: {} } });
    if (gallery === 'none') and.push({ accessGrants: { none: {} } });

    if (login === 'never') and.push({ lastLoginAt: null });
    if (login === 'signed_in') and.push({ lastLoginAt: { not: null } });

    if (account === 'disabled') and.push({ accountStatus: 'DISABLED' });
    if (account === 'active') and.push({ accountStatus: 'ACTIVE' });

    if (packageFilter === 'has') and.push({ packageId: { not: null } });
    if (packageFilter === 'none') and.push({ packageId: null });

    const packageId = req.query.packageId ? String(req.query.packageId) : '';
    if (packageId && packageId !== 'has' && packageId !== 'none') {
      const sp = await prisma.servicePackage.findFirst({
        where: { id: packageId, studioId: req.studioId },
        select: { id: true, selectionTierId: true, title: true },
      });
      const ors = [{ booking: { is: { servicePackageId: packageId } } }];
      if (sp?.selectionTierId) ors.push({ packageId: sp.selectionTierId });
      if (sp?.title) ors.push({ package: { is: { name: sp.title } } });
      and.push({ OR: ors });
    }

    if (phoneFilter === 'has') {
      and.push({ AND: [{ phone: { not: null } }, { NOT: { phone: '' } }] });
    }
    if (phoneFilter === 'none') {
      and.push({ OR: [{ phone: null }, { phone: '' }] });
    }

    const exp = String(experience || '').toLowerCase();
    if (exp === 'wedding') and.push({ weddingExperience: true });
    if (exp === 'custom') and.push({ weddingExperience: false });

    const where = { AND: and };

    // Facet counts for the kind tabs (respect search + secondary filters, not kind)
    const facetAnd = and.filter((c) => !('isGuest' in c));
    const facetBase = { AND: facetAnd.length ? facetAnd : [{ studioId: req.studioId }] };

    const [customers, total, clientsCount, guestsCount, allCount] = await Promise.all([
      prisma.customer.findMany({
        where,
        skip: Number(skip),
        take,
        orderBy: { createdAt: 'desc' },
        include: {
          package: { select: { id: true, name: true, includedPhotos: true, basePrice: true } },
          requestedPackage: { select: { id: true, name: true } },
          _count: { select: { accessGrants: true, selections: true } },
        },
      }),
      prisma.customer.count({ where }),
      prisma.customer.count({ where: { AND: [...facetAnd, { isGuest: false }] } }),
      prisma.customer.count({ where: { AND: [...facetAnd, { isGuest: true }] } }),
      prisma.customer.count({ where: facetBase }),
    ]);
    // passwordHash must never leave the API
    const safe = customers.map(({ passwordHash, package: pkg, requestedPackage, storageUsedBytes, ...c }) => ({
      ...c,
      storageUsedBytes: storageUsedBytes != null ? Number(storageUsedBytes) : 0,
      emailVerified: !!c.emailVerified,
      accountStatus: c.accountStatus || 'ACTIVE',
      isGuest: !!c.isGuest,
      galleryCount: c._count?.accessGrants ?? 0,
      package: pkg
        ? { ...pkg, basePrice: Number(pkg.basePrice || 0) }
        : null,
      requestedPackage: requestedPackage || null,
    }));
    res.json({
      customers: safe,
      total,
      page: Number(page),
      pages: Math.ceil(total / take) || 1,
      facets: {
        clients: clientsCount,
        guests: guestsCount,
        all: allCount,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create customer — Cognito invite when enabled; optional legacy credentials + multi-gallery.
router.post('/customers', async (req, res) => {
  try {
    const {
      name, email, phone, notes, status,
      loginId: customLoginId, password: customPassword, packageId,
      galleryIds, inviteToCognito,
    } = req.body;
    if (!name) return res.status(400).json({ error: 'Name required' });

    // Phone is the primary identifier for clients (email no longer used)
    let phoneNorm = null;
    if (phone) {
      let s = String(phone).trim().replace(/[^\d+]/g, '');
      if (s.startsWith('+')) s = s.slice(1);
      s = s.replace(/\D/g, '');
      if (s.length === 10 && /^[6-9]/.test(s)) s = `91${s}`;
      if (s.length >= 8 && s.length <= 15) phoneNorm = s;
    }
    if (!phoneNorm) {
      return res.status(400).json({ error: 'Phone number is required (with country code, e.g. 91…)' });
    }

    let resolvedPackageId = null;
    if (packageId) {
      const pkg = await prisma.clientType.findFirst({
        where: { id: packageId, studioId: req.studioId, active: true },
      });
      if (!pkg) return res.status(400).json({ error: 'Invalid or inactive package' });
      resolvedPackageId = pkg.id;
    }

    const statusText = status != null && String(status).trim() ? String(status).trim().slice(0, 200) : null;
    // Cognito invite disabled for phone-first flow (email optional/legacy only)
    const useCognito = false;

    let cognitoSub = null;
    let credentials = null;
    // Prefer phone as loginId; allow custom override for rare cases
    let loginId = (customLoginId || '').trim() || phoneNorm;
    let passwordHash = null;

    {
      // Local password accounts — phone + password
      if (customLoginId && !/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,39}$/.test(loginId)) {
        return res.status(400).json({ error: 'Login ID must be 3–40 chars: letters, numbers, . _ -' });
      }
      const existingPhone = await prisma.customer.findFirst({
        where: { studioId: req.studioId, phone: phoneNorm },
      });
      if (existingPhone) {
        return res.status(409).json({ error: 'A client with this phone already exists' });
      }
      const password = (customPassword || '').trim() || generatePassword();
      if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
      passwordHash = await hashPassword(password);
      credentials = { loginId, password, phone: phoneNorm };
    }

    const ids = [...new Set(Array.isArray(galleryIds) ? galleryIds.filter(Boolean) : [])];
    const { customer, galleries } = await prisma.$transaction(async tx => {
      const galleries = ids.length ? await tx.eventGallery.findMany({
        where: { id: { in: ids }, studioId: req.studioId, deletedAt: null },
      }) : [];
      if (galleries.length !== ids.length) throw new AppError(CODES.VALIDATION, 'One or more selected galleries are unavailable. Refresh and select them again.');
      for (const g of galleries) {
        const availability = galleryAvailability(g, {});
        if (!availability.accessible) throw new AppError(CODES.CONFLICT, `${g.name}: ${availability.message}`, { status: 409 });
      }
      const customer = await tx.customer.create({
      data: {
        studioId: req.studioId,
        name,
        email: null,
        phone: phoneNorm,
        notes: notes || null,
        status: statusText,
        loginId,
        passwordHash,
        cognitoSub,
        emailVerified: false,
        accountStatus: 'ACTIVE',
        packageId: resolvedPackageId,
        ...(ids.length && { accessGrants: { create: ids.map(galleryId => ({ galleryId })) } }),
      },
      include: {
        package: {
          select: {
            id: true, name: true, description: true, basePrice: true,
            includedPhotos: true, pricePerExtraPhoto: true, workflowMode: true,
          },
        },
      },
      });
      return { customer, galleries };
    });
    let granted = 0;
    if (ids.length) {
      for (const g of galleries) {
        granted++;
        if (phoneNorm) {
          try {
            // Always client app link — never full-access / QR share link
            const { triggerAuto, clientAppUrl, clientGalleryAppUrl } = require('../services/whatsapp');
            const appUrl = await clientGalleryAppUrl(g.id, req.studioId);
            triggerAuto(req.studioId, 'GALLERY_ASSIGNED', {
              phone: phoneNorm,
              toName: name,
              vars: {
                name: name || 'there',
                galleryName: g.name || 'your gallery',
                appUrl,
                galleryLink: appUrl, // legacy templates that still use galleryLink
              },
              meta: {
                customerId: customer.id,
                galleryId: g.id,
                source: 'ADMIN_CREATE',
                linkType: 'CLIENT_APP',
              },
            });
          } catch (_) { /* optional */ }
        }
      }
    }

    // WhatsApp welcome for new client phone
    if (phoneNorm) {
      try {
        const { triggerAuto, clientAppUrl } = require('../services/whatsapp');
        triggerAuto(req.studioId, 'CLIENT_PHONE_ADDED', {
          phone: phoneNorm,
          toName: name,
          vars: {
            name: name || 'there',
            phone: phoneNorm,
            appUrl: clientAppUrl(),
          },
          meta: { customerId: customer.id, source: 'ADMIN_CREATE' },
        });
      } catch (_) { /* optional */ }
    }

    const { passwordHash: _omit, ...safe } = customer;
    res.json({
      ...safe,
      storageUsedBytes: Number(safe.storageUsedBytes || 0),
      package: safe.package
        ? {
          ...safe.package,
          basePrice: Number(safe.package.basePrice || 0),
          pricePerExtraPhoto: safe.package.pricePerExtraPhoto == null
            ? null
            : Number(safe.package.pricePerExtraPhoto),
        }
        : null,
      galleriesGranted: granted,
      credentials,
      cognitoInvited: !!useCognito,
    });
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Customer with this email/phone/login already exists' });
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Reset password — Cognito AdminResetUserPassword when linked; else local temp password.
router.post('/customers/:id/reset-password', async (req, res) => {
  try {
    const customer = await prisma.customer.findFirst({ where: { id: req.params.id, studioId: req.studioId } });
    if (!customer) return res.status(404).json({ error: 'Customer not found' });

    if (cognito.isEnabled() && customer.cognitoSub) {
      await cognito.resetPassword(customer);
      return res.json({ ok: true, provider: 'cognito', message: 'Password reset email sent via Cognito' });
    }

    let password = (req.body?.password || '').trim();
    if (password) {
      if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    } else {
      password = generatePassword();
    }
    await prisma.customer.update({ where: { id: customer.id }, data: { passwordHash: await hashPassword(password) } });
    res.json({ loginId: customer.loginId, password, provider: 'legacy' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Cognito account actions ────────────────────────────────────────────────

router.post('/customers/:id/disable', async (req, res) => {
  try {
    const customer = await prisma.customer.findFirst({ where: { id: req.params.id, studioId: req.studioId } });
    if (!customer) return res.status(404).json({ error: 'Customer not found' });
    if (cognito.isEnabled() && customer.cognitoSub) {
      await cognito.disableUser(customer);
    } else {
      await prisma.customer.update({ where: { id: customer.id }, data: { accountStatus: 'DISABLED' } });
    }
    res.json({ ok: true, accountStatus: 'DISABLED' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/customers/:id/enable', async (req, res) => {
  try {
    const customer = await prisma.customer.findFirst({ where: { id: req.params.id, studioId: req.studioId } });
    if (!customer) return res.status(404).json({ error: 'Customer not found' });
    if (cognito.isEnabled() && customer.cognitoSub) {
      await cognito.enableUser(customer);
    } else {
      await prisma.customer.update({ where: { id: customer.id }, data: { accountStatus: 'ACTIVE' } });
    }
    res.json({ ok: true, accountStatus: 'ACTIVE' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/customers/:id', async (req, res) => {
  try {
    const customer = await prisma.customer.findFirst({ where: { id: req.params.id, studioId: req.studioId } });
    if (!customer) return res.status(404).json({ error: 'Customer not found' });
    if (cognito.isEnabled() && customer.cognitoSub) {
      try { await cognito.deleteUser(customer); } catch (e) { /* continue local cleanup */ }
    }
    // Hard-delete local row (cascades grants/favorites via schema relations where set)
    await prisma.accessGrant.deleteMany({ where: { customerId: customer.id } });
    await prisma.favorite.deleteMany({ where: { customerId: customer.id } });
    await prisma.customer.delete({ where: { id: customer.id } });
    res.json({ ok: true, deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/customers/:id/cognito', async (req, res) => {
  try {
    const customer = await prisma.customer.findFirst({ where: { id: req.params.id, studioId: req.studioId } });
    if (!customer) return res.status(404).json({ error: 'Customer not found' });
    if (!cognito.isEnabled()) return res.json({ enabled: false, message: 'Cognito not configured' });
    if (!customer.cognitoSub) return res.json({ enabled: true, linked: false });
    const details = await cognito.getUserDetails(customer);
    res.json({ enabled: true, linked: true, cognitoSub: customer.cognitoSub, details });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Digits-only phone; India 10-digit → 91… */
function normalizeAdminPhone(raw) {
  if (raw == null || raw === '') return null;
  let s = String(raw).trim().split('#')[0];
  s = s.replace(/[^\d+]/g, '');
  if (s.startsWith('+')) s = s.slice(1);
  s = s.replace(/\D/g, '');
  if (s.length === 10 && /^[6-9]/.test(s)) s = `91${s}`;
  return s.length >= 8 && s.length <= 15 ? s : null;
}

// Update customer (notes, status, contact, package; optional loginId change)
router.patch('/customers/:id', async (req, res) => {
  try {
    const {
      name, email, phone, notes, status, loginId, packageId,
      paymentTerms, paymentTotalDue, paymentAmountPaid, paymentCurrency,
      // When true (default if client had no phone), set loginId to the new phone
      syncLoginToPhone,
      // Wedding experience
      weddingExperience, brideName, groomName, weddingDate, weddingVenue,
      couplePhotoKey, weddingCoverKey, bookingPhotoKey,
      albumStatus, deliveryStatus, photographerName, cinematographerName, weddingNotes,
    } = req.body;
    const existing = await prisma.customer.findFirst({ where: { id: req.params.id, studioId: req.studioId } });
    if (!existing) return res.status(404).json({ error: 'Customer not found' });

    if (paymentTotalDue !== undefined || paymentAmountPaid !== undefined || paymentCurrency !== undefined) {
      return res.status(400).json({ error: 'Billing totals are managed by invoices. Create an invoice or record a payment in Billing.' });
    }

    const data = {
      ...(name && { name: String(name).trim().slice(0, 120) }),
      ...(notes !== undefined && { notes }),
      ...(status !== undefined && {
        status: status === null || status === '' ? null : String(status).trim().slice(0, 200),
      }),
      ...(paymentTerms !== undefined && {
        paymentTerms: paymentTerms === null || paymentTerms === '' ? null : String(paymentTerms).slice(0, 4000),
      }),
      ...(weddingExperience !== undefined && { weddingExperience: !!weddingExperience }),
      ...(brideName !== undefined && {
        brideName: brideName === null || brideName === '' ? null : String(brideName).trim().slice(0, 80),
      }),
      ...(groomName !== undefined && {
        groomName: groomName === null || groomName === '' ? null : String(groomName).trim().slice(0, 80),
      }),
      ...(weddingDate !== undefined && {
        weddingDate: weddingDate === null || weddingDate === ''
          ? null
          : new Date(weddingDate),
      }),
      ...(weddingVenue !== undefined && {
        weddingVenue: weddingVenue === null || weddingVenue === '' ? null : String(weddingVenue).trim().slice(0, 200),
      }),
      ...(couplePhotoKey !== undefined && {
        couplePhotoKey: couplePhotoKey === null || couplePhotoKey === '' ? null : String(couplePhotoKey).slice(0, 500),
      }),
      ...(weddingCoverKey !== undefined && {
        weddingCoverKey: weddingCoverKey === null || weddingCoverKey === '' ? null : String(weddingCoverKey).slice(0, 500),
      }),
      ...(bookingPhotoKey !== undefined && {
        bookingPhotoKey: bookingPhotoKey === null || bookingPhotoKey === '' ? null : String(bookingPhotoKey).slice(0, 500),
      }),
      ...(albumStatus !== undefined && {
        albumStatus: albumStatus === null || albumStatus === '' ? null : String(albumStatus).slice(0, 80),
      }),
      ...(deliveryStatus !== undefined && {
        deliveryStatus: deliveryStatus === null || deliveryStatus === '' ? null : String(deliveryStatus).slice(0, 80),
      }),
      ...(photographerName !== undefined && {
        photographerName: photographerName === null || photographerName === '' ? null : String(photographerName).slice(0, 80),
      }),
      ...(cinematographerName !== undefined && {
        cinematographerName: cinematographerName === null || cinematographerName === '' ? null : String(cinematographerName).slice(0, 80),
      }),
      ...(weddingNotes !== undefined && {
        weddingNotes: weddingNotes === null || weddingNotes === '' ? null : String(weddingNotes).slice(0, 4000),
      }),
    };

    // Phone: primary contact + sign-in identifier for legacy email-only accounts
    if (phone !== undefined) {
      if (phone === null || String(phone).trim() === '') {
        data.phone = null;
      } else {
        const phoneNorm = normalizeAdminPhone(phone);
        if (!phoneNorm) {
          return res.status(400).json({
            error: 'Enter a valid phone number (e.g. 98765… or 9198765…)',
          });
        }
        const taken = await prisma.customer.findFirst({
          where: {
            studioId: req.studioId,
            phone: phoneNorm,
            NOT: { id: existing.id },
          },
          select: { id: true, name: true },
        });
        if (taken) {
          return res.status(409).json({
            error: `Phone already used by ${taken.name || 'another client'}`,
          });
        }
        data.phone = phoneNorm;

        // Auto-link login to phone for email-only / empty-phone clients
        const shouldSync = syncLoginToPhone !== false && (
          !existing.phone
          || !existing.loginId
          || (existing.loginId && String(existing.loginId).includes('@'))
          || (existing.phone && existing.loginId === existing.phone)
        );
        if (shouldSync) {
          const loginTaken = await prisma.customer.findFirst({
            where: {
              loginId: phoneNorm,
              NOT: { id: existing.id },
            },
            select: { id: true },
          });
          if (!loginTaken) {
            data.loginId = phoneNorm;
          }
        }
      }
    }

    // Email is optional legacy field — keep for display only if provided
    if (email !== undefined) {
      if (email === null || String(email).trim() === '') {
        data.email = null;
      } else {
        const em = String(email).trim().toLowerCase();
        if (!em.includes('@')) {
          return res.status(400).json({ error: 'Invalid email address' });
        }
        data.email = em;
      }
    }

    if (loginId !== undefined && loginId !== null && String(loginId).trim() && String(loginId).trim() !== existing.loginId) {
      const next = String(loginId).trim();
      // Allow pure phone digits as loginId
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,39}$/.test(next)) {
        return res.status(400).json({ error: 'Login ID must be 3–40 chars: letters, numbers, . _ -' });
      }
      data.loginId = next;
    }
    if (packageId !== undefined) {
      if (packageId === null || packageId === '') {
        data.packageId = null;
      } else {
        const pkg = await prisma.clientType.findFirst({
          where: { id: packageId, studioId: req.studioId },
        });
        if (!pkg) return res.status(400).json({ error: 'Invalid package' });
        data.packageId = pkg.id;
      }
    }

    const phoneJustSet = !!(data.phone && data.phone !== existing.phone);

    const customer = await prisma.customer.update({
      where: { id: existing.id },
      data,
      include: {
        package: {
          select: {
            id: true, name: true, description: true, basePrice: true,
            includedPhotos: true, pricePerExtraPhoto: true, workflowMode: true, active: true,
          },
        },
      },
    });

    // WhatsApp welcome when phone is first added / changed on profile
    if (phoneJustSet && customer.phone) {
      try {
        const { triggerAuto, clientAppUrl } = require('../services/whatsapp');
        triggerAuto(req.studioId, 'CLIENT_PHONE_ADDED', {
          phone: customer.phone,
          toName: customer.name,
          vars: {
            name: customer.name || 'there',
            phone: customer.phone,
            appUrl: clientAppUrl(),
          },
          meta: { customerId: customer.id, source: 'ADMIN_PHONE_SAVE' },
        });
      } catch (_) { /* optional */ }
    }

    const { passwordHash, ...safe } = customer;
    res.json({
      ...safe,
      package: safe.package
        ? {
          ...safe.package,
          basePrice: Number(safe.package.basePrice || 0),
          pricePerExtraPhoto: safe.package.pricePerExtraPhoto == null
            ? null
            : Number(safe.package.pricePerExtraPhoto),
        }
        : null,
    });
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'That login ID or contact is already taken' });
    res.status(500).json({ error: err.message });
  }
});

// Get customer detail with galleries + package + submitted selections
router.get('/customers/:id', async (req, res) => {
  try {
    const { getSignedPhotoUrl } = require('../services/s3');
    const customer = await prisma.customer.findFirst({
      where: { id: req.params.id, studioId: req.studioId },
      include: {
        package: true,
        requestedPackage: true,
        booking: { include: { servicePackage: true } },
        accessGrants: { include: { gallery: { include: { _count: { select: { photos: true } } } } } },
        selections: {
          orderBy: { submittedAt: 'desc' },
          include: {
            gallery: { select: { id: true, name: true } },
            _count: { select: { items: true } },
          },
        },
        contracts: { orderBy: { createdAt: 'desc' }, take: 20 },
        weddingAgreements: { orderBy: { updatedAt: 'desc' }, take: 20 },
      },
    });
    if (!customer) return res.status(404).json({ error: 'Customer not found' });
    // Never return passwordHash to the dashboard.
    const { passwordHash, storageUsedBytes, contracts, weddingAgreements, ...safe } = customer;

    const contractsWithUrls = await Promise.all((contracts || []).map(async (c) => ({
      ...c,
      downloadUrl: c.fileKey ? await getSignedPhotoUrl(c.fileKey, 900) : null,
      hasPdf: !!c.fileKey,
    })));

    const weddingWithUrls = await Promise.all((weddingAgreements || []).map(async (a) => ({
      id: a.id,
      title: a.title,
      status: a.status,
      contractId: a.contractId,
      finalizedAt: a.finalizedAt,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
      hasPdf: !!a.pdfKey,
      pdfUrl: a.pdfKey ? await getSignedPhotoUrl(a.pdfKey, 900) : null,
    })));

    const sign = async (key) => (key ? getSignedPhotoUrl(key, 3600) : null);
    const {
      couplePhotoKey, weddingCoverKey, bookingPhotoKey, ...safePublic
    } = safe;

    res.json({
      ...safePublic,
      accessGrants: (safePublic.accessGrants || []).map(g => ({ ...g, availability: galleryAvailability(g.gallery, g) })),
      couplePhotoUrl: await sign(couplePhotoKey),
      weddingCoverUrl: await sign(weddingCoverKey),
      bookingPhotoUrl: await sign(bookingPhotoKey),
      hasCouplePhoto: !!couplePhotoKey,
      hasWeddingCover: !!weddingCoverKey,
      hasBookingPhoto: !!bookingPhotoKey,
      selections: (safePublic.selections || []).map((s) => ({
        ...s,
        unread: !!(s.submittedAt && !s.adminOpenedAt),
      })),
      contracts: contractsWithUrls,
      weddingAgreements: weddingWithUrls,
      storageUsedBytes: storageUsedBytes != null ? Number(storageUsedBytes) : 0,
      galleryCount: safePublic.accessGrants?.length ?? 0,
      package: safePublic.package
        ? {
          ...safePublic.package,
          basePrice: Number(safePublic.package.basePrice || 0),
          pricePerExtraPhoto: safePublic.package.pricePerExtraPhoto == null
            ? null
            : Number(safePublic.package.pricePerExtraPhoto),
        }
        : null,
      requestedPackage: safePublic.requestedPackage
        ? { id: safePublic.requestedPackage.id, name: safePublic.requestedPackage.name }
        : null,
      booking: safePublic.booking
        ? {
            id: safe.booking.id,
            status: safe.booking.status,
            servicePackageId: safe.booking.servicePackageId,
            servicePackage: safe.booking.servicePackage
              ? {
                  id: safe.booking.servicePackage.id,
                  title: safe.booking.servicePackage.title,
                  includedPhotos: safe.booking.servicePackage.includedPhotos,
                  pricePerExtraPhoto: safe.booking.servicePackage.pricePerExtraPhoto == null
                    ? null
                    : Number(safe.booking.servicePackage.pricePerExtraPhoto),
                  price: Number(safe.booking.servicePackage.price || 0),
                }
              : null,
          }
        : null,
      weddingExperience: !!safePublic.weddingExperience,
      brideName: safePublic.brideName || null,
      groomName: safePublic.groomName || null,
      weddingDate: safePublic.weddingDate || null,
      weddingVenue: safePublic.weddingVenue || null,
      albumStatus: safePublic.albumStatus || null,
      deliveryStatus: safePublic.deliveryStatus || null,
      photographerName: safePublic.photographerName || null,
      cinematographerName: safePublic.cinematographerName || null,
      weddingNotes: safePublic.weddingNotes || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/customers/:id/wedding-photo', weddingPhotoUpload.single('file'), async (req, res) => {
  try {
    const customer = await prisma.customer.findFirst({
      where: { id: req.params.id, studioId: req.studioId },
    });
    if (!customer) return res.status(404).json({ error: 'Customer not found' });
    if (!req.file?.buffer) return res.status(400).json({ error: 'Image file required' });
    const slot = String(req.body?.slot || 'couple');
    const field = slot === 'cover'
      ? 'weddingCoverKey'
      : slot === 'booking'
        ? 'bookingPhotoKey'
        : 'couplePhotoKey';
    const ext = path.extname(req.file.originalname || '') || '.jpg';
    const key = `studios/${req.studioId}/wedding/${customer.id}/${field}-${uuidv4()}${ext}`;
    await uploadToS3(key, req.file.buffer, req.file.mimetype || 'image/jpeg');
    await prisma.customer.update({ where: { id: customer.id }, data: { [field]: key } });
    const url = await getSignedPhotoUrl(key, 3600);
    res.json({ slot, url, hasPhoto: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Grant gallery access — single galleryId or bulk galleryIds[]
router.post('/customers/:id/access', async (req, res) => {
  try {
    const customer = await prisma.customer.findFirst({
      where: { id: req.params.id, studioId: req.studioId },
    });
    if (!customer) return res.status(404).json({ error: 'Customer not found' });

    const { galleryId, galleryIds, expiresAt } = req.body;
    const ids = Array.isArray(galleryIds) && galleryIds.length
      ? galleryIds.filter(Boolean)
      : (galleryId ? [galleryId] : []);
    if (!ids.length) return res.status(400).json({ error: 'galleryId or galleryIds required' });

    const result = await assignGalleries(prisma, { studioId: req.studioId, customerIds: [customer.id],
      galleryIds: ids, expiresAt, publish: req.body.publish === true });
    const grants = result.grants;
    const nameById = new Map(result.galleries.map(g => [g.id, g.name]));
    for (const g of result.galleries) {
      // WhatsApp: client app link only (never QR / full-access share)
      if (customer.phone && !customer.isGuest) {
        try {
          const { triggerAuto, clientGalleryAppUrl } = require('../services/whatsapp');
          const appUrl = await clientGalleryAppUrl(g.id, req.studioId);
          triggerAuto(req.studioId, 'GALLERY_ASSIGNED', {
            phone: customer.phone,
            toName: customer.name,
            vars: {
              name: customer.name || 'there',
              galleryName: nameById.get(g.id) || 'your gallery',
              appUrl,
              galleryLink: appUrl, // legacy template placeholder
            },
            meta: {
              customerId: customer.id,
              galleryId: g.id,
              appUrl,
              source: 'ADMIN_GRANT',
              linkType: 'CLIENT_APP',
            },
          });
        } catch (_) { /* optional */ }
      }
    }
    res.json({ grants, granted: grants.length, availability: result.availability });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message, code: err.code });
  }
});

// Revoke gallery access
router.delete('/customers/:id/access/:galleryId', async (req, res) => {
  try {
    await prisma.accessGrant.deleteMany({
      where: { customerId: req.params.id, galleryId: req.params.galleryId },
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List admin users (owner only)
router.get('/team', requireRole('OWNER', 'MANAGER'), async (req, res) => {
  try {
    const admins = await prisma.adminUser.findMany({
      where: { studioId: req.studioId },
      select: { id: true, name: true, email: true, role: true, lastLoginAt: true, createdAt: true },
    });
    res.json(admins);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create admin user
router.post('/team', requireRole('OWNER'), async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    const passwordHash = await bcrypt.hash(password, 12);
    const admin = await prisma.adminUser.create({
      data: { studioId: req.studioId, name, email, passwordHash, role: role || 'STAFF' },
      select: { id: true, name: true, email: true, role: true, createdAt: true },
    });
    res.json(admin);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Audit log
router.get('/audit', requireRole('OWNER', 'MANAGER'), async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const skip = (page - 1) * limit;
    const logs = await prisma.auditLog.findMany({
      where: { gallery: { studioId: req.studioId } },
      skip: Number(skip),
      take: Number(limit),
      orderBy: { createdAt: 'desc' },
      include: { admin: { select: { name: true, email: true } } },
    });
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
