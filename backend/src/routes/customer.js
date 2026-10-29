const express = require('express');
const { prisma } = require('../config/prisma');
const { authenticateCustomer } = require('../middleware/auth');
const { ok, fail } = require('../lib/envelope');
const { CODES } = require('../lib/errors');

const router = express.Router();
router.use(authenticateCustomer);

const priceLabelOf = (amount) => {
  const n = Number(amount || 0);
  return n > 0 ? `₹${n.toLocaleString('en-IN')} onwards` : 'Contact for price';
};

const mapPackage = (t) => {
  if (!t) return null;
  const basePrice = Number(t.basePrice != null ? t.basePrice : (t.discountPrice != null ? t.discountPrice : t.price) || 0);
  return {
    id: t.id,
    name: t.name || t.title || '',
    title: t.title || t.name || '',
    description: t.description || null,
    basePrice,
    price: basePrice,
    priceLabel: priceLabelOf(basePrice),
    includedPhotos: t.includedPhotos ?? null,
    pricePerExtraPhoto: t.pricePerExtraPhoto == null ? null : Number(t.pricePerExtraPhoto),
    workflowMode: t.workflowMode || 'SELECT_ONLY',
    active: t.active !== false,
    selectionTierId: t.selectionTierId || null,
  };
};

const safeCustomer = async (c) => {
  if (!c) return null;
  const { passwordHash, storageUsedBytes, couplePhotoKey, weddingCoverKey, bookingPhotoKey, ...rest } = c;
  let couplePhotoUrl = null;
  let weddingCoverUrl = null;
  let bookingPhotoUrl = null;
  try {
    const { getSignedPhotoUrl } = require('../services/s3');
    if (couplePhotoKey) couplePhotoUrl = await getSignedPhotoUrl(couplePhotoKey, 3600);
    if (weddingCoverKey) weddingCoverUrl = await getSignedPhotoUrl(weddingCoverKey, 3600);
    if (bookingPhotoKey) bookingPhotoUrl = await getSignedPhotoUrl(bookingPhotoKey, 3600);
  } catch (_) { /* non-fatal */ }
  return {
    ...rest,
    storageUsedBytes: storageUsedBytes != null ? Number(storageUsedBytes) : 0,
    package: mapPackage(c.package),
    requestedPackage: mapPackage(c.requestedPackage),
    weddingExperience: !!c.weddingExperience,
    brideName: c.brideName || null,
    groomName: c.groomName || null,
    weddingDate: c.weddingDate || null,
    weddingVenue: c.weddingVenue || null,
    couplePhotoUrl,
    weddingCoverUrl,
    bookingPhotoUrl,
    albumStatus: c.albumStatus || null,
    deliveryStatus: c.deliveryStatus || null,
    photographerName: c.photographerName || null,
    cinematographerName: c.cinematographerName || null,
    weddingNotes: c.weddingNotes || null,
  };
};

// Current customer profile — status, package, studio (never passwordHash).
router.get('/me', async (req, res) => {
  try {
    const customer = await prisma.customer.findUnique({
      where: { id: req.customer.id },
      include: {
        studio: { select: { id: true, name: true, logoUrl: true } },
        package: true,
        requestedPackage: true,
      },
    });
    if (!customer) return fail(res, CODES.NOT_FOUND, 'Customer not found', { status: 404 });
    return ok(res, { customer: await safeCustomer(customer) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Studio package catalog (active ServicePackages only — never archived / ₹0 ghosts).
router.get('/packages', async (req, res) => {
  try {
    const list = await prisma.servicePackage.findMany({
      where: { studioId: req.customer.studioId, active: true },
      orderBy: [{ isFeatured: 'desc' }, { displayOrder: 'asc' }],
    });
    const me = await prisma.customer.findUnique({
      where: { id: req.customer.id },
      select: { packageId: true, requestedPackageId: true },
    });
    const current = list.find((p) => p.selectionTierId && p.selectionTierId === me?.packageId);
    const requested = list.find((p) => p.selectionTierId && p.selectionTierId === me?.requestedPackageId);
    return ok(res, {
      packages: list.map(mapPackage),
      currentPackageId: current?.id || null,
      requestedPackageId: requested?.id || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Customer requests / selects a package (studio can still change the assigned one).
router.post('/me/package-request', async (req, res) => {
  try {
    const packageId = (req.body?.packageId || '').trim();
    if (!packageId) return fail(res, CODES.VALIDATION, 'packageId required', { status: 400 });
    let sp = await prisma.servicePackage.findFirst({
      where: { id: packageId, studioId: req.customer.studioId, active: true },
    });
    let tierId = sp?.selectionTierId || null;
    if (!sp) {
      const tier = await prisma.clientType.findFirst({
        where: { id: packageId, studioId: req.customer.studioId, active: true },
      });
      if (!tier) return fail(res, CODES.NOT_FOUND, 'Package not found', { status: 404 });
      tierId = tier.id;
      sp = await prisma.servicePackage.findFirst({
        where: { studioId: req.customer.studioId, selectionTierId: tier.id, active: true },
      });
    }
    if (sp && !tierId) {
      const { syncSelectionTierFromServicePackage } = require('../services/packageSync');
      const tier = await syncSelectionTierFromServicePackage(sp);
      tierId = tier?.id;
    }
    if (!tierId) return fail(res, CODES.NOT_FOUND, 'Package not found', { status: 404 });

    const customer = await prisma.customer.update({
      where: { id: req.customer.id },
      data: {
        requestedPackageId: tierId,
        packageId: tierId,
      },
      include: {
        studio: { select: { id: true, name: true, logoUrl: true } },
        package: true,
        requestedPackage: true,
      },
    });
    return ok(res, {
      customer: await safeCustomer(customer),
      message: `You selected the ${sp?.title || customer.package?.name || 'package'} package. Your studio can confirm or adjust it.`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
