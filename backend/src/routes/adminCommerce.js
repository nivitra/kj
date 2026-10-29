const express = require('express');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { prisma } = require('../config/prisma');
const { authenticateAdmin } = require('../middleware/auth');
const sharp = require('sharp');
const { uploadToS3, getSignedPhotoUrl, signOriginalDownload, buildContractKey } = require('../services/s3');
const { estimateSelection } = require('../services/pricing');
const { enqueueFaceDelete } = require('../services/jobs');
const rekognition = require('../services/rekognition');
const { ok, fail } = require('../lib/envelope');
const { CODES } = require('../lib/errors');

const router = express.Router();
router.use(authenticateAdmin);

// Memory upload for admin face-search selfies (not persisted long-term).
const faceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(jpeg|jpg|png|webp)$/i.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only JPEG/PNG/WebP selfies are supported'));
  },
});

const num = (v) => (v == null ? undefined : Number(v));
const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// ---- Pricing settings ------------------------------------------------------

router.get('/pricing', async (req, res) => {
  const settings = await prisma.pricingSettings.upsert({
    where: { studioId: req.studioId }, create: { studioId: req.studioId }, update: {},
  });
  return ok(res, { ...settings, pricePerExtraPhoto: Number(settings.pricePerExtraPhoto), baseGalleryFee: Number(settings.baseGalleryFee) });
});

router.put('/pricing', async (req, res) => {
  const { currency, includedPhotos, pricePerExtraPhoto, baseGalleryFee, watermarkEnabled, faceSearchThreshold, notes } = req.body;
  const settings = await prisma.pricingSettings.upsert({
    where: { studioId: req.studioId },
    create: { studioId: req.studioId, currency, includedPhotos, pricePerExtraPhoto, baseGalleryFee, watermarkEnabled, faceSearchThreshold, notes },
    update: {
      ...(currency && { currency }), ...(includedPhotos != null && { includedPhotos }),
      ...(pricePerExtraPhoto != null && { pricePerExtraPhoto }), ...(baseGalleryFee != null && { baseGalleryFee }),
      ...(watermarkEnabled != null && { watermarkEnabled }), ...(faceSearchThreshold !== undefined && { faceSearchThreshold }),
      ...(notes !== undefined && { notes }),
    },
  });
  return ok(res, settings);
});

// ---- Packages (ClientType) -------------------------------------------------
// Studio packages: name, base price, included photos, extra photo price, workflow.
// Assignable to customers (Customer.packageId) and galleries (EventGallery.clientTypeId).

const mapPackage = (t) => ({
  id: t.id,
  name: t.name,
  slug: t.slug,
  description: t.description || null,
  basePrice: Number(t.basePrice || 0),
  includedPhotos: t.includedPhotos ?? null,
  pricePerExtraPhoto: t.pricePerExtraPhoto == null ? null : Number(t.pricePerExtraPhoto),
  workflowMode: t.workflowMode,
  paymentMode: t.paymentMode,
  active: t.active,
  sortOrder: t.sortOrder,
  customersCount: t._count?.customers ?? undefined,
  galleriesCount: t._count?.galleries ?? undefined,
  createdAt: t.createdAt,
  updatedAt: t.updatedAt,
});

router.get('/client-types', async (req, res) => {
  const types = await prisma.clientType.findMany({
    where: { studioId: req.studioId },
    orderBy: { sortOrder: 'asc' },
    include: { _count: { select: { customers: true, galleries: true } } },
  });
  const packages = types.map(mapPackage);
  return ok(res, { clientTypes: packages, packages });
});

// Seed a sensible default set the first time a studio opens Packages.
const ensureDefaultPackages = async (studioId) => {
  const count = await prisma.clientType.count({ where: { studioId } });
  if (count > 0) return;
  const defaults = [
    { name: 'Wedding Basic', slug: 'wedding-basic', description: 'Core wedding coverage.', basePrice: 25000, includedPhotos: 40, pricePerExtraPhoto: 250, workflowMode: 'SELECT_ONLY', sortOrder: 0 },
    { name: 'Wedding Premium', slug: 'wedding-premium', description: 'Extended wedding package.', basePrice: 50000, includedPhotos: 80, pricePerExtraPhoto: 200, workflowMode: 'SELECT_ONLY', sortOrder: 1 },
    { name: 'Portrait', slug: 'portrait', description: 'Portraits with download access.', basePrice: 8000, includedPhotos: 10, pricePerExtraPhoto: 150, workflowMode: 'SELECT_AND_DOWNLOAD', sortOrder: 2 },
    { name: 'Custom', slug: 'custom', description: 'Flexible package — set terms per client.', basePrice: 0, includedPhotos: 20, pricePerExtraPhoto: 200, workflowMode: 'SELECT_ONLY', sortOrder: 3 },
  ];
  await prisma.clientType.createMany({ data: defaults.map((d) => ({ ...d, studioId })) });
};

// Alias: /admin/packages
router.get('/packages', async (req, res) => {
  await ensureDefaultPackages(req.studioId);
  const types = await prisma.clientType.findMany({
    where: {
      studioId: req.studioId,
      ...(req.query.active === 'true' ? { active: true } : {}),
      ...(req.query.active === 'false' ? { active: false } : {}),
    },
    orderBy: { sortOrder: 'asc' },
    include: { _count: { select: { customers: true, galleries: true } } },
  });
  return ok(res, { packages: types.map(mapPackage) });
});

const createPackageHandler = async (req, res) => {
  const {
    name, description, basePrice, workflowMode, paymentMode,
    includedPhotos, pricePerExtraPhoto, sortOrder, active,
  } = req.body;
  if (!name) return fail(res, CODES.VALIDATION, 'Package name required', { status: 400 });
  try {
    const type = await prisma.clientType.create({
      data: {
        studioId: req.studioId,
        name,
        slug: slugify(name),
        description: description || null,
        basePrice: num(basePrice) ?? 0,
        workflowMode: workflowMode || 'SELECT_ONLY',
        paymentMode: paymentMode || 'OFFLINE',
        includedPhotos: includedPhotos != null ? num(includedPhotos) : null,
        pricePerExtraPhoto: pricePerExtraPhoto != null ? num(pricePerExtraPhoto) : null,
        sortOrder: sortOrder || 0,
        active: active !== false,
      },
    });
    return ok(res, mapPackage(type), 201);
  } catch (err) {
    if (err.code === 'P2002') return fail(res, CODES.CONFLICT, 'A package with that name already exists', { status: 409 });
    throw err;
  }
};

const updatePackageHandler = async (req, res) => {
  const {
    name, description, basePrice, workflowMode, paymentMode,
    includedPhotos, pricePerExtraPhoto, active, sortOrder,
  } = req.body;
  const existing = await prisma.clientType.findFirst({ where: { id: req.params.id, studioId: req.studioId } });
  if (!existing) return fail(res, CODES.NOT_FOUND, 'Package not found', { status: 404 });
  const type = await prisma.clientType.update({
    where: { id: existing.id },
    data: {
      ...(name && { name, slug: slugify(name) }),
      ...(description !== undefined && { description }),
      ...(basePrice !== undefined && { basePrice: num(basePrice) ?? 0 }),
      ...(workflowMode && { workflowMode }),
      ...(paymentMode && { paymentMode }),
      ...(includedPhotos !== undefined && { includedPhotos: includedPhotos == null ? null : num(includedPhotos) }),
      ...(pricePerExtraPhoto !== undefined && { pricePerExtraPhoto: pricePerExtraPhoto == null ? null : num(pricePerExtraPhoto) }),
      ...(active !== undefined && { active }),
      ...(sortOrder != null && { sortOrder }),
    },
  });
  return ok(res, mapPackage(type));
};

const deletePackageHandler = async (req, res) => {
  await prisma.clientType.deleteMany({ where: { id: req.params.id, studioId: req.studioId } });
  return ok(res, { deleted: true });
};

router.post('/client-types', createPackageHandler);
router.post('/packages', createPackageHandler);
router.patch('/client-types/:id', updatePackageHandler);
router.patch('/packages/:id', updatePackageHandler);
router.delete('/client-types/:id', deletePackageHandler);
router.delete('/packages/:id', deletePackageHandler);

// ---- Frames ----------------------------------------------------------------

const frameUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.get('/frames', async (req, res) => {
  const frames = await prisma.frameProduct.findMany({ where: { studioId: req.studioId }, orderBy: { sortOrder: 'asc' } });
  const withUrls = await Promise.all(frames.map(async (f) => ({ ...f, price: Number(f.price), imageUrl: f.imageKey ? await getSignedPhotoUrl(f.imageKey) : null })));
  return ok(res, { frames: withUrls });
});

router.post('/frames', frameUpload.single('image'), async (req, res) => {
  const { name, description, size, material, price, sortOrder } = req.body;
  if (!name) return fail(res, CODES.VALIDATION, 'Name required', { status: 400 });
  let imageKey = null;
  if (req.file) {
    imageKey = `studios/${req.studioId}/frames/${uuidv4()}${path.extname(req.file.originalname) || '.jpg'}`;
    await uploadToS3(imageKey, req.file.buffer, req.file.mimetype);
  }
  const frame = await prisma.frameProduct.create({
    data: { studioId: req.studioId, name, description, size, material, price: num(price) || 0, sortOrder: parseInt(sortOrder || 0, 10), imageKey },
  });
  return ok(res, frame, 201);
});

router.patch('/frames/:id', frameUpload.single('image'), async (req, res) => {
  const { name, description, size, material, price, active, sortOrder } = req.body;
  let imageKey;
  if (req.file) {
    imageKey = `studios/${req.studioId}/frames/${uuidv4()}${path.extname(req.file.originalname) || '.jpg'}`;
    await uploadToS3(imageKey, req.file.buffer, req.file.mimetype);
  }
  await prisma.frameProduct.updateMany({
    where: { id: req.params.id, studioId: req.studioId },
    data: {
      ...(name && { name }), ...(description !== undefined && { description }), ...(size !== undefined && { size }),
      ...(material !== undefined && { material }), ...(price != null && { price: num(price) }),
      ...(active !== undefined && { active: active === 'true' || active === true }), ...(sortOrder != null && { sortOrder: parseInt(sortOrder, 10) }),
      ...(imageKey && { imageKey }),
    },
  });
  return ok(res, { updated: true });
});

router.delete('/frames/:id', async (req, res) => {
  await prisma.frameProduct.deleteMany({ where: { id: req.params.id, studioId: req.studioId } });
  return ok(res, { deleted: true });
});

// ---- Selections ------------------------------------------------------------

router.get('/selections', async (req, res) => {
  const where = { gallery: { studioId: req.studioId }, ...(req.query.status ? { status: req.query.status } : {}) };
  const selections = await prisma.selection.findMany({
    where, orderBy: { submittedAt: 'desc' },
    include: { customer: { select: { id: true, name: true, loginId: true } }, gallery: { select: { id: true, name: true, clientTypeId: true, studioId: true } }, _count: { select: { items: true } } },
  });
  const rows = await Promise.all(selections.map(async (s) => {
    const est = await estimateSelection(s.gallery, s._count.items, s.customer.id);
    return {
      id: s.id,
      status: s.status,
      submittedAt: s.submittedAt,
      adminOpenedAt: s.adminOpenedAt || null,
      unread: !!(s.submittedAt && !s.adminOpenedAt),
      count: s._count.items,
      extraCount: s.extraCount || 0,
      includedLimit: s.includedLimit ?? est?.includedPhotos ?? null,
      deliveryStatus: s.deliveryStatus || 'NONE',
      historyCount: Array.isArray(s.history) ? s.history.length : 0,
      customer: s.customer,
      gallery: { id: s.gallery.id, name: s.gallery.name },
      estimate: est,
    };
  }));
  return ok(res, { selections: rows });
});

router.get('/selections/:id', async (req, res) => {
  const selection = await prisma.selection.findFirst({
    where: { id: req.params.id, gallery: { studioId: req.studioId } },
    include: {
      customer: true,
      gallery: true,
      items: { include: { photo: true }, orderBy: [{ batchNumber: 'asc' }, { submittedAt: 'asc' }, { createdAt: 'asc' }] },
    },
  });
  if (!selection) return fail(res, CODES.NOT_FOUND, 'Selection not found', { status: 404 });

  if (selection.submittedAt && !selection.adminOpenedAt) {
    await prisma.selection.update({
      where: { id: selection.id },
      data: { adminOpenedAt: new Date() },
    }).catch(() => {});
    selection.adminOpenedAt = new Date();
  }
  const includedLimit = selection.includedLimit
    ?? selection.gallery.selectionLimit
    ?? null;
  let includedAssigned = 0;
  const classified = selection.items.map((it) => {
    const dtype = it.deliveryType || null;
    let isIncluded = dtype === 'INCLUDED' || dtype === 'PACKAGE';
    if (!isIncluded && dtype !== 'RAW' && dtype !== 'EDITED' && includedLimit != null) {
      if (includedAssigned < Number(includedLimit)) {
        isIncluded = true;
        includedAssigned += 1;
      }
    }
    return {
      id: it.id,
      photoId: it.photoId,
      filename: it.photo.filename,
      deliveryType: dtype,
      batchNumber: it.batchNumber || 1,
      submittedAt: it.submittedAt || selection.submittedAt,
      createdAt: it.createdAt || it.submittedAt || selection.submittedAt,
      isIncluded: !!isIncluded,
      isExtra: !isIncluded,
      badge: isIncluded ? 'INCLUDED' : 'EXTRA',
      thumbnailKey: it.photo.thumbnailKey,
      previewKey: it.photo.previewKey,
    };
  });
  const items = await Promise.all(classified.map(async (it) => ({
    id: it.id,
    photoId: it.photoId,
    filename: it.filename,
    deliveryType: it.deliveryType,
    batchNumber: it.batchNumber,
    submittedAt: it.submittedAt,
    createdAt: it.createdAt,
    isIncluded: it.isIncluded,
    isExtra: it.isExtra,
    badge: it.badge,
    thumbnailUrl: await getSignedPhotoUrl(it.thumbnailKey),
    previewUrl: await getSignedPhotoUrl(it.previewKey),
  })));
  const includedItems = items.filter((i) => i.isIncluded);
  const extraItems = items.filter((i) => i.isExtra);
  const estimate = await estimateSelection(selection.gallery, items.length, selection.customerId);
  let bill = null;
  let rates = null;
  try {
    const { resolveDeliveryRates, computeDeliveryBill } = require('../services/selectionDelivery');
    rates = await resolveDeliveryRates(selection.gallery, selection.customerId);
    bill = computeDeliveryBill(
      selection.items.map((i) => ({ deliveryType: i.deliveryType })),
      rates,
    );
  } catch (_) { /* non-fatal */ }

  let overageInvoice = null;
  if (selection.overageInvoiceId) {
    overageInvoice = await prisma.invoice.findFirst({
      where: { id: selection.overageInvoiceId, studioId: req.studioId },
      select: {
        id: true,
        invoiceNumber: true,
        status: true,
        totalAmount: true,
        amountPaid: true,
        cachedOutstanding: true,
      },
    });
  }
  return ok(res, {
    id: selection.id,
    status: selection.status,
    submittedAt: selection.submittedAt,
    history: selection.history || [],
    customer: { id: selection.customer.id, name: selection.customer.name },
    gallery: {
      id: selection.gallery.id,
      name: selection.gallery.name,
      selectionLimit: selection.gallery.selectionLimit,
      extraPhotoPrice: selection.gallery.extraPhotoPrice != null
        ? Number(selection.gallery.extraPhotoPrice)
        : null,
    },
    items,
    includedItems,
    extraItems,
    partitions: {
      included: {
        count: includedItems.length,
        limit: selection.includedLimit ?? estimate?.includedPhotos ?? null,
        items: includedItems,
        firstSubmittedAt: (() => {
          const times = includedItems.map((i) => i.submittedAt && new Date(i.submittedAt).getTime()).filter(Boolean);
          return times.length ? new Date(Math.min(...times)).toISOString() : null;
        })(),
        lastSubmittedAt: (() => {
          const times = includedItems.map((i) => i.submittedAt && new Date(i.submittedAt).getTime()).filter(Boolean);
          return times.length ? new Date(Math.max(...times)).toISOString() : null;
        })(),
      },
      extras: {
        count: extraItems.length,
        items: extraItems,
        firstSubmittedAt: (() => {
          const times = extraItems.map((i) => i.submittedAt && new Date(i.submittedAt).getTime()).filter(Boolean);
          return times.length ? new Date(Math.min(...times)).toISOString() : null;
        })(),
        lastSubmittedAt: (() => {
          const times = extraItems.map((i) => i.submittedAt && new Date(i.submittedAt).getTime()).filter(Boolean);
          return times.length ? new Date(Math.max(...times)).toISOString() : null;
        })(),
      },
    },
    estimate,
    bill,
    rates,
    customerNote: selection.customerNote,
    includedLimit: selection.includedLimit,
    extraCount: selection.extraCount,
    extraUnitPrice: selection.extraUnitPrice != null ? Number(selection.extraUnitPrice) : null,
    overageAmount: selection.overageAmount != null ? Number(selection.overageAmount) : null,
    deliveryStatus: selection.deliveryStatus || 'NONE',
    rawCount: selection.rawCount || 0,
    editedCount: selection.editedCount || 0,
    freeCount: selection.freeCount || 0,
    rawExtraCount: selection.rawExtraCount || 0,
    editedExtraCount: selection.editedExtraCount || 0,
    rawUnitPrice: selection.editedUnitPrice != null
      ? Number(selection.editedUnitPrice)
      : (rates?.pricePerExtraEdited ?? rates?.pricePerExtraPhoto ?? 350),
    editedUnitPrice: selection.editedUnitPrice != null
      ? Number(selection.editedUnitPrice)
      : (rates?.pricePerExtraEdited ?? rates?.pricePerExtraPhoto ?? 350),
    overageInvoiceId: selection.overageInvoiceId,
    overageInvoice: overageInvoice
      ? {
          id: overageInvoice.id,
          invoiceNumber: overageInvoice.invoiceNumber,
          status: overageInvoice.status,
          totalAmount: Number(overageInvoice.totalAmount || 0),
          balance: Number(
            overageInvoice.cachedOutstanding != null
              ? overageInvoice.cachedOutstanding
              : Math.max(0, Number(overageInvoice.totalAmount || 0) - Number(overageInvoice.amountPaid || 0)),
          ),
        }
      : null,
  });
});

for (const action of ['start-editing', 'unlock']) {
  router.post(`/selections/:id/${action}`, async (req, res) => {
    try {
      const { startEditing } = require('../services/selectionWorkflow');
      const selection = await startEditing({ selectionId: req.params.id, studioId: req.studioId, admin: req.admin,
        revision: req.body?.revision, reopen: action === 'unlock', reason: req.body?.reason });
      return ok(res, { selection, message: action === 'unlock' ? 'Latest editing batch reopened' : 'Editing started. The client can still add more photos.' });
    } catch (e) { return fail(res, CODES.VALIDATION, e.message, { status: e.status || 400 }); }
  });
}

/**
 * Classify selected photos as RAW (₹200 extra) or EDITED (₹350 extra).
 * Body: { classifications: [{ photoId, deliveryType: 'RAW'|'EDITED' }] }
 *    or { all: 'RAW'|'EDITED' }
 *    or { defaultRemaining: 'RAW'|'EDITED' }
 */
router.post('/selections/:id/classify', async (req, res) => {
  try {
    const { classifySelectionItems } = require('../services/selectionDelivery');
    const result = await classifySelectionItems(req.params.id, req.studioId, req.body || {});
    const items = await Promise.all(result.selection.items.map(async (it) => ({
      id: it.id,
      photoId: it.photoId,
      filename: it.photo?.filename,
      deliveryType: it.deliveryType || null,
      thumbnailUrl: await getSignedPhotoUrl(it.photo?.thumbnailKey),
    })));
    return ok(res, {
      items,
      bill: result.bill,
      rates: result.rates,
      deliveryStatus: result.bill.fullyClassified ? 'CLASSIFIED' : 'AWAITING_CLASSIFY',
    });
  } catch (err) {
    return fail(res, CODES.VALIDATION, err.message, { status: err.status || 400 });
  }
});

/**
 * Confirm classification → attach ADDON lines to original invoice (or create one).
 */
router.post('/selections/:id/bill', async (req, res) => {
  try {
    const { billClassifiedSelection } = require('../services/selectionDelivery');
    const result = await billClassifiedSelection(req.params.id, req.studioId);
    return ok(res, result);
  } catch (err) {
    return fail(res, CODES.VALIDATION, err.message, { status: err.status || 400 });
  }
});

// CSV export of selected filenames (for the editor/printer).
router.get('/selections/:id/export', async (req, res) => {
  const selection = await prisma.selection.findFirst({
    where: { id: req.params.id, gallery: { studioId: req.studioId } },
    include: { items: { include: { photo: { select: { filename: true } } } } },
  });
  if (!selection) return res.status(404).send('Not found');
  const rows = ['filename', ...selection.items.map((i) => i.photo.filename)];
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="selection-${selection.id}.csv"`);
  return res.send(rows.join('\n'));
});

// ---- Orders ----------------------------------------------------------------

router.get('/orders', async (req, res) => {
  const orders = await prisma.order.findMany({
    where: { studioId: req.studioId, ...(req.query.status ? { status: req.query.status } : {}) },
    orderBy: { createdAt: 'desc' },
    include: { customer: { select: { id: true, name: true } }, items: { include: { frameProduct: { select: { name: true } } } } },
  });
  return ok(res, { orders: orders.map((o) => ({ ...o, subtotal: Number(o.subtotal), total: Number(o.total) })) });
});

router.patch('/orders/:id', async (req, res) => {
  const { status } = req.body;
  const updated = await prisma.order.updateMany({ where: { id: req.params.id, studioId: req.studioId }, data: { ...(status && { status }) } });
  return ok(res, { updated: updated.count });
});

// ---- Payments (manual ledger) ---------------------------------------------

// Compatibility reads expose the invoice ledger. New receipts must be attached
// to an invoice so balances, permissions and audit history stay consistent.
router.get('/payments', async (req, res) => {
  const payments = await prisma.invoicePayment.findMany({
    where: { studioId: req.studioId, invoice: { ...(req.query.customerId ? { customerId: String(req.query.customerId) } : {}) } },
    include: { invoice: { select: { customerId: true, invoiceNumber: true } } },
    orderBy: { paidAt: 'desc' },
  });
  return ok(res, { payments: payments.map(p => ({ ...p, amount: Number(p.amount), customerId: p.invoice.customerId, receivedAt: p.paidAt })) });
});
router.post('/payments', async (req, res) => {
  return fail(res, CODES.VALIDATION, 'Record payments against an invoice in Billing.', { status: 410 });
});

// ---- Estimate / balance for a customer ------------------------------------

router.get('/estimates/:customerId', async (req, res) => {
  const customerId = req.params.customerId;
  const customer = await prisma.customer.findFirst({ where: { id: customerId, studioId: req.studioId } });
  if (!customer) return fail(res, CODES.NOT_FOUND, 'Customer not found', { status: 404 });

  const selections = await prisma.selection.findMany({
    where: { customerId, status: 'SUBMITTED', gallery: { studioId: req.studioId } },
    include: { gallery: true, _count: { select: { items: true } } },
  });
  let selectionTotal = 0;
  const perGallery = [];
  for (const s of selections) {
    const est = await estimateSelection(s.gallery, s._count.items, customerId);
    selectionTotal += est.estimatedTotal;
    perGallery.push({ galleryId: s.galleryId, galleryName: s.gallery.name, count: s._count.items, estimatedTotal: est.estimatedTotal });
  }

  const orders = await prisma.order.aggregate({ where: { customerId, studioId: req.studioId, status: { not: 'CANCELLED' } }, _sum: { total: true } });
  const { projectInvoice, invoiceInclude } = require('../services/billing/projectInvoice');
  const { accountSummary } = require('../services/billing/accountSummary');
  const invoices = await prisma.invoice.findMany({ where: { customerId, studioId: req.studioId, kind: 'INVOICE' }, include: invoiceInclude });
  const billing = accountSummary(invoices.map(i => projectInvoice(i)));

  const ordersTotal = Number(orders._sum.total || 0);
  return ok(res, { selectionTotal, ordersTotal, estimatedTotal: selectionTotal + ordersTotal, paidTotal: billing.paid, balance: billing.balance, billing, perGallery });
});

// ---- Contracts -------------------------------------------------------------

const contractUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

router.get('/contracts', async (req, res) => {
  const where = { studioId: req.studioId, ...(req.query.customerId ? { customerId: req.query.customerId } : {}) };
  const contracts = await prisma.contract.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: { customer: { select: { name: true } } },
  });
  const withUrls = await Promise.all(contracts.map(async (c) => ({
    ...c,
    downloadUrl: c.fileKey ? await getSignedPhotoUrl(c.fileKey, 900) : null,
  })));
  return ok(res, { contracts: withUrls });
});

router.get('/contracts/:id/download', async (req, res) => {
  const contract = await prisma.contract.findFirst({
    where: { id: req.params.id, studioId: req.studioId },
  });
  if (!contract?.fileKey) return fail(res, CODES.NOT_FOUND, 'Contract not found', { status: 404 });
  const url = await getSignedPhotoUrl(contract.fileKey, 900);
  return ok(res, { url, title: contract.title, fileSize: contract.fileSize });
});

router.post('/contracts', contractUpload.single('file'), async (req, res) => {
  const { customerId, galleryId, title } = req.body;
  if (!customerId || !title || !req.file) return fail(res, CODES.VALIDATION, 'customerId, title and file required', { status: 400 });
  if (req.file.mimetype !== 'application/pdf') return fail(res, CODES.UNSUPPORTED_MEDIA, 'Contract must be a PDF', { status: 422 });

  const id = uuidv4();
  const fileKey = buildContractKey(req.studioId, id, '.pdf');
  await uploadToS3(fileKey, req.file.buffer, 'application/pdf');
  const contract = await prisma.contract.create({
    data: { id, studioId: req.studioId, customerId, galleryId: galleryId || null, title, fileKey, fileSize: req.file.size, status: 'SENT' },
  });
  const downloadUrl = await getSignedPhotoUrl(fileKey, 900);
  return ok(res, { ...contract, downloadUrl }, 201);
});

// ---- Dead-letter jobs (inspect + replay) ----------------------------------

router.get('/jobs', async (req, res) => {
  const jobs = await prisma.processingJob.findMany({
    where: { studioId: req.studioId, ...(req.query.status ? { status: req.query.status } : { status: 'DEAD_LETTER' }) },
    orderBy: { updatedAt: 'desc' }, take: 200,
  });
  return ok(res, { jobs });
});

router.post('/jobs/:id/replay', async (req, res) => {
  const job = await prisma.processingJob.findFirst({ where: { id: req.params.id, studioId: req.studioId } });
  if (!job) return fail(res, CODES.NOT_FOUND, 'Job not found', { status: 404 });
  const {
    enqueueDerivatives, enqueueFaceIndex, enqueueFaceSearch, enqueueFaceDelete: del,
  } = require('../services/jobs');
  if (job.jobType === 'generate_derivatives' && job.photoId) {
    await enqueueDerivatives(job.photoId, { studioId: job.studioId, galleryId: job.galleryId });
  } else if (job.jobType === 'index_photo_faces' && job.photoId) {
    await prisma.photo.updateMany({
      where: { id: job.photoId },
      data: { faceIndexed: false, rekognitionIndexedAt: null },
    });
    await enqueueFaceIndex(job.photoId, { studioId: job.studioId, galleryId: job.galleryId });
  } else if (job.jobType === 'delete_photo_faces' && job.photoId) {
    await del(job.photoId, { studioId: job.studioId });
  } else if (job.jobType === 'face_search' && job.sessionId) {
    await enqueueFaceSearch(job.sessionId, { studioId: job.studioId });
  } else {
    return fail(res, CODES.VALIDATION, 'Job type not replayable', { status: 400 });
  }
  await prisma.processingJob.update({
    where: { id: job.id },
    data: { status: 'QUEUED', lastErrorCode: null, lastErrorMessageSafe: null },
  });
  return ok(res, { replayed: true });
});

// ---- Face search admin: reindex + analytics (FACE-PIPELINE-PLAN.md §7) -----

router.patch('/galleries/:id/face-search', async (req, res) => {
  const gallery = await prisma.eventGallery.findFirst({
    where: { id: req.params.id, studioId: req.studioId },
  });
  if (!gallery) return fail(res, CODES.NOT_FOUND, 'Gallery not found', { status: 404 });

  const { faceSearchEnabled, faceSearchThreshold, confirmCost } = req.body;
  // Enabling face search incurs AWS Rekognition charges — require explicit cost confirmation.
  if (faceSearchEnabled === true && !gallery.faceSearchEnabled) {
    if (confirmCost !== true) {
      return fail(
        res,
        CODES.VALIDATION,
        'Face search uses Amazon Rekognition and costs money per indexed photo. Confirm the cost warning to enable.',
        { status: 400, details: { requiresCostConfirm: true } },
      );
    }
  }

  const updated = await prisma.eventGallery.update({
    where: { id: gallery.id },
    data: {
      ...(faceSearchEnabled !== undefined && { faceSearchEnabled: !!faceSearchEnabled }),
      ...(faceSearchThreshold !== undefined && {
        faceSearchThreshold: faceSearchThreshold === null ? null : Number(faceSearchThreshold),
      }),
    },
  });

  await prisma.auditLog.create({
    data: {
      adminId: req.admin.id,
      galleryId: gallery.id,
      action: 'FACE_SEARCH_SETTINGS',
      entityType: 'gallery',
      entityId: gallery.id,
      details: {
        faceSearchEnabled: updated.faceSearchEnabled,
        faceSearchThreshold: updated.faceSearchThreshold,
        confirmCost: confirmCost === true,
      },
    },
  });

  // When enabling, kick off indexing for already-processed photos (images only).
  if (faceSearchEnabled === true && !gallery.faceSearchEnabled) {
    const { enqueueFaceIndex } = require('../services/jobs');
    const photos = await prisma.photo.findMany({
      where: {
        galleryId: gallery.id,
        previewKey: { not: null },
        rekognitionIndexedAt: null,
        OR: [{ mediaType: 'IMAGE' }, { mediaType: null }],
      },
      select: { id: true },
      take: 10000,
    });
    for (const p of photos) {
      await enqueueFaceIndex(p.id, { studioId: req.studioId, galleryId: gallery.id });
    }
    await prisma.eventGallery.update({
      where: { id: gallery.id },
      data: { faceIndexStatus: photos.length ? 'RUNNING' : 'COMPLETE' },
    });
  }

  return ok(res, updated);
});

router.post('/galleries/:id/reindex', async (req, res) => {
  const gallery = await prisma.eventGallery.findFirst({
    where: { id: req.params.id, studioId: req.studioId },
  });
  if (!gallery) return fail(res, CODES.NOT_FOUND, 'Gallery not found', { status: 404 });
  if (!gallery.faceSearchEnabled) {
    return fail(res, CODES.VALIDATION, 'Enable face search on this gallery before reindexing.', { status: 400 });
  }

  const { enqueueGalleryReindex } = require('../services/jobs');
  const result = await enqueueGalleryReindex(gallery.id, { studioId: req.studioId });
  await prisma.auditLog.create({
    data: {
      adminId: req.admin.id,
      galleryId: gallery.id,
      action: 'FACE_REINDEX',
      entityType: 'gallery',
      entityId: gallery.id,
      details: result,
    },
  });
  return ok(res, result, 202);
});

router.get('/galleries/:id/face-analytics', async (req, res) => {
  const gallery = await prisma.eventGallery.findFirst({
    where: { id: req.params.id, studioId: req.studioId },
  });
  if (!gallery) return fail(res, CODES.NOT_FOUND, 'Gallery not found', { status: 404 });

  const [
    faceCount,
    photosIndexed,
    photosTotal,
    sessions,
    matchAgg,
    deadJobs,
  ] = await Promise.all([
    prisma.photoFace.count({ where: { galleryId: gallery.id, faceStatus: 'ACTIVE' } }),
    prisma.photo.count({ where: { galleryId: gallery.id, rekognitionIndexedAt: { not: null } } }),
    prisma.photo.count({ where: { galleryId: gallery.id, processingStatus: 'COMPLETE' } }),
    prisma.faceSearchSession.groupBy({
      by: ['status'],
      where: {
        studioId: req.studioId,
        OR: [{ galleryId: gallery.id }, { galleryId: null }],
      },
      _count: true,
    }),
    prisma.faceSearchMatch.aggregate({
      where: {
        includedInResult: true,
        session: { studioId: req.studioId },
        photoId: { in: (await prisma.photo.findMany({ where: { galleryId: gallery.id }, select: { id: true } })).map((p) => p.id) },
      },
      _avg: { similarity: true },
      _count: true,
    }),
    prisma.processingJob.count({
      where: { galleryId: gallery.id, status: 'DEAD_LETTER' },
    }),
  ]);

  // Cost estimate (Rekognition Image — ap-south-1 ballpark; verify current pricing).
  const indexCost = (photosIndexed / 1000) * 1.0;
  const storageCost = (faceCount / 1000) * 0.01;

  return ok(res, {
    galleryId: gallery.id,
    faceSearchEnabled: gallery.faceSearchEnabled,
    faceSearchThreshold: gallery.faceSearchThreshold,
    faceIndexStatus: gallery.faceIndexStatus,
    photosTotal,
    photosIndexed,
    activeFaces: faceCount,
    sessionsByStatus: Object.fromEntries(sessions.map((s) => [s.status, s._count])),
    matchCount: matchAgg._count,
    avgSimilarityAdminOnly: matchAgg._avg.similarity,
    deadLetterJobs: deadJobs,
    estimatedCostUsd: {
      indexingOneTime: Number(indexCost.toFixed(4)),
      faceStoragePerMonth: Number(storageCost.toFixed(4)),
      note: 'Approximate Rekognition Image pricing — verify current ap-south-1 rates.',
    },
  });
});

/**
 * Admin face search within a gallery.
 * POST multipart field "selfie" (image). Returns matching photos ranked by similarity.
 * Studio staff can see similarity scores (customers cannot).
 */
router.post('/galleries/:id/face-search', faceUpload.single('selfie'), async (req, res) => {
  try {
    const gallery = await prisma.eventGallery.findFirst({
      where: { id: req.params.id, studioId: req.studioId },
    });
    if (!gallery) return fail(res, CODES.NOT_FOUND, 'Gallery not found', { status: 404 });
    if (!req.file?.buffer?.length) {
      return fail(res, CODES.VALIDATION, 'Upload a selfie image (field name: selfie).', { status: 400 });
    }

    const threshold = Number(
      req.body?.threshold
      || gallery.faceSearchThreshold
      || process.env.FACE_MATCH_THRESHOLD
      || 80,
    );

    // Ensure faces are indexed for this gallery (kick off missing ones).
    const unindexed = await prisma.photo.count({
      where: {
        galleryId: gallery.id,
        processingStatus: 'COMPLETE',
        faceIndexed: false,
      },
    });
    if (unindexed > 0 && gallery.faceSearchEnabled) {
      const { enqueueFaceIndex } = require('../services/jobs');
      const photos = await prisma.photo.findMany({
        where: {
          galleryId: gallery.id,
          processingStatus: 'COMPLETE',
          faceIndexed: false,
        },
        select: { id: true },
        take: 500,
      });
      for (const p of photos) {
        await enqueueFaceIndex(p.id, { studioId: req.studioId, galleryId: gallery.id }).catch(() => {});
      }
    }

    // Convert any format to JPEG for Rekognition SearchFacesByImage.
    const jpeg = await sharp(req.file.buffer)
      .rotate()
      .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 92 })
      .toBuffer();

    await rekognition.ensureCollection();

    let matches;
    try {
      matches = await rekognition.searchFacesByImage({
        bytes: jpeg,
        threshold,
        maxFaces: 100,
      });
    } catch (err) {
      if (err.name === 'InvalidParameterException' || /no faces|face/i.test(err.message || '')) {
        return ok(res, {
          threshold,
          matchCount: 0,
          message: 'No clear face found in the selfie. Try a brighter photo of one person.',
          results: [],
          unindexedPhotos: unindexed,
        });
      }
      throw err;
    }

    if (!matches.length) {
      return ok(res, {
        threshold,
        matchCount: 0,
        message: unindexed > 0
          ? `No matches yet. ${unindexed} photo(s) still indexing — try again in a minute.`
          : 'No matching faces in this gallery.',
        results: [],
        unindexedPhotos: unindexed,
      });
    }

    const faceIds = matches.map((m) => m.faceId);
    const faces = await prisma.photoFace.findMany({
      where: {
        rekognitionFaceId: { in: faceIds },
        galleryId: gallery.id,
        faceStatus: 'ACTIVE',
        studioId: req.studioId,
      },
      include: {
        photo: true,
      },
    });

    const simByFace = Object.fromEntries(matches.map((m) => [m.faceId, m.similarity]));
    const byPhoto = new Map();
    for (const face of faces) {
      const photo = face.photo;
      if (!photo) continue;
      const similarity = simByFace[face.rekognitionFaceId] || 0;
      const prev = byPhoto.get(photo.id);
      if (!prev || similarity > prev.similarity) {
        byPhoto.set(photo.id, { photo, similarity, faceId: face.rekognitionFaceId });
      }
    }

    const ranked = [...byPhoto.values()].sort((a, b) => b.similarity - a.similarity);
    const results = await Promise.all(ranked.map(async (r, i) => ({
      rank: i + 1,
      photoId: r.photo.id,
      filename: r.photo.filename,
      similarity: Math.round(r.similarity * 10) / 10,
      thumbnailUrl: r.photo.thumbnailKey ? await getSignedPhotoUrl(r.photo.thumbnailKey, 3600) : null,
      previewUrl: r.photo.previewKey ? await getSignedPhotoUrl(r.photo.previewKey, 3600) : null,
      // Pure original only — never display/thumb WebP
      downloadUrl: await signOriginalDownload(r.photo, 900),
    })));

    await prisma.auditLog.create({
      data: {
        adminId: req.admin.id,
        galleryId: gallery.id,
        action: 'ADMIN_FACE_SEARCH',
        entityType: 'gallery',
        entityId: gallery.id,
        details: { threshold, matchCount: results.length, unindexedPhotos: unindexed },
      },
    });

    return ok(res, {
      threshold,
      matchCount: results.length,
      message: results.length
        ? `Found ${results.length} photo${results.length === 1 ? '' : 's'} that may include this person.`
        : 'No matching faces in this gallery.',
      results,
      unindexedPhotos: unindexed,
    });
  } catch (err) {
    if (err.message && /Only JPEG/.test(err.message)) {
      return fail(res, CODES.VALIDATION, err.message, { status: 400 });
    }
    throw err;
  }
});

module.exports = router;
