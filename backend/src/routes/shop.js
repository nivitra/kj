const express = require('express');
const { body } = require('express-validator');
const { prisma } = require('../config/prisma');
const { authenticateCustomer } = require('../middleware/auth');
const { getSignedPhotoUrl } = require('../services/s3');
const { effectivePricing } = require('../services/pricing');
const { ok, fail } = require('../lib/envelope');
const { CODES } = require('../lib/errors');
const { validate } = require('../lib/validate');

const router = express.Router();

// IMPORTANT: do NOT `router.use(authenticateCustomer)` on the whole router when
// this is mounted at `/api` — that would 401 every unmatched /api/* path
// (including admin portal CMS) and log admins out of the dashboard.

const orderNumber = () => `SJ-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 1e4)}`;

// Public pricing for the app's live estimate.
router.get('/pricing/public', authenticateCustomer, async (req, res) => {
  const settings = await prisma.pricingSettings.findUnique({ where: { studioId: req.customer.studioId } });
  return ok(res, {
    currency: settings?.currency || 'INR',
    includedPhotos: settings?.includedPhotos || 0,
    pricePerExtraPhoto: Number(settings?.pricePerExtraPhoto || 0),
    baseGalleryFee: Number(settings?.baseGalleryFee || 0),
  });
});

// Active frame catalog.
router.get('/frames', authenticateCustomer, async (req, res) => {
  const frames = await prisma.frameProduct.findMany({
    where: { studioId: req.customer.studioId, active: true },
    orderBy: { sortOrder: 'asc' },
  });
  const withUrls = await Promise.all(frames.map(async (f) => ({
    id: f.id, name: f.name, description: f.description, size: f.size, material: f.material,
    price: Number(f.price), imageUrl: f.imageKey ? await getSignedPhotoUrl(f.imageKey) : null,
  })));
  return ok(res, { frames: withUrls });
});

// Place a frame order — the server prices every line (never trust the client).
router.post('/orders',
  authenticateCustomer,
  body('items').isArray({ min: 1 }), validate,
  async (req, res) => {
    const { items, galleryId, note } = req.body;
    const frameIds = [...new Set(items.map((i) => i.frameProductId))];
    const frames = await prisma.frameProduct.findMany({
      where: { id: { in: frameIds }, studioId: req.customer.studioId, active: true },
    });
    const frameById = Object.fromEntries(frames.map((f) => [f.id, f]));

    let subtotal = 0;
    const orderItems = [];
    for (const it of items) {
      const frame = frameById[it.frameProductId];
      if (!frame) return fail(res, CODES.VALIDATION, 'Invalid frame in order', { status: 400 });
      const qty = Math.max(1, parseInt(it.quantity || 1, 10));
      const unitPrice = Number(frame.price);
      subtotal += unitPrice * qty;
      orderItems.push({ frameProductId: frame.id, photoId: it.photoId || null, quantity: qty, unitPrice });
    }

    const order = await prisma.order.create({
      data: {
        studioId: req.customer.studioId, customerId: req.customer.id, galleryId: galleryId || null,
        orderNumber: orderNumber(), subtotal, total: subtotal, customerNote: note || null,
        items: { create: orderItems },
      },
      include: { items: true },
    });
    return ok(res, { order }, 201);
  });

// Order history.
router.get('/orders/my', authenticateCustomer, async (req, res) => {
  const orders = await prisma.order.findMany({
    where: { customerId: req.customer.id },
    orderBy: { createdAt: 'desc' },
    include: { items: { include: { frameProduct: { select: { name: true, size: true } } } } },
  });
  return ok(res, { orders: orders.map((o) => ({ ...o, subtotal: Number(o.subtotal), total: Number(o.total) })) });
});

// Contracts assigned to me.
router.get('/contracts/my', authenticateCustomer, async (req, res) => {
  const contracts = await prisma.contract.findMany({
    where: { customerId: req.customer.id }, orderBy: { createdAt: 'desc' },
    select: {
      id: true, title: true, status: true, sentAt: true, viewedAt: true, acceptedAt: true,
      source: true, fileSize: true, createdAt: true,
    },
  });
  return ok(res, { contracts });
});

// View a contract (signed URL) — marks it VIEWED.
router.get('/contracts/my/:id/view', authenticateCustomer, async (req, res) => {
  const { getSignedPhotoUrl: signed } = require('../services/s3');
  const contract = await prisma.contract.findFirst({ where: { id: req.params.id, customerId: req.customer.id } });
  if (!contract) return fail(res, CODES.NOT_FOUND, 'Contract not found', { status: 404 });
  if (contract.status === 'SENT') {
    await prisma.contract.update({ where: { id: contract.id }, data: { status: 'VIEWED', viewedAt: new Date() } });
  }
  const url = await signed(contract.fileKey, 900);
  return ok(res, { url });
});

// Accept a contract.
router.post('/contracts/my/:id/accept', authenticateCustomer, async (req, res) => {
  const contract = await prisma.contract.findFirst({ where: { id: req.params.id, customerId: req.customer.id } });
  if (!contract) return fail(res, CODES.NOT_FOUND, 'Contract not found', { status: 404 });
  await prisma.contract.update({
    where: { id: contract.id },
    data: { status: 'ACCEPTED', acceptedAt: new Date(), acceptedFromIp: req.ip },
  });
  return ok(res, { accepted: true });
});

module.exports = router;
