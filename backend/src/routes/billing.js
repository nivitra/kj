/**
 * Coupons + Invoices (admin manage, customer view/apply).
 * Billing v2: ledger SoT + FIFO milestones — see services/billing/*
 */
const express = require('express');
const { accountSummary } = require('../services/billing/accountSummary');
const { body } = require('express-validator');
const { prisma } = require('../config/prisma');
const { authenticateAdmin, authenticateCustomer, requireRole } = require('../middleware/auth');
const { ok, fail } = require('../lib/envelope');
const { CODES } = require('../lib/errors');
const { validate } = require('../lib/validate');
const { buildInvoicePdf } = require('../services/invoicePdf');
const { resolvePaymentTerms, DEFAULT_PAYMENT_TERMS } = require('../services/studioTerms');
const { uploadToS3, getSignedDownloadUrl } = require('../services/s3');
const {
  projectInvoice,
  invoiceInclude,
  mapPayment,
  recordPayment,
  setInvoicePaid,
  voidPayment,
  recomputeInvoiceFromLedger,
  BillingError,
  allowHardDeletePayments,
  recomputeCustomerRollup,
  reviseInvoice,
} = require('../services/billing');

const adminRouter = express.Router();
const customerRouter = express.Router();
adminRouter.use(authenticateAdmin);
adminRouter.use((req, res, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !['OWNER', 'MANAGER'].includes(req.admin.role)) return res.status(403).json({ error: 'Manager access required' });
  next();
});
customerRouter.use(authenticateCustomer);

customerRouter.get('/invoices/:id/payment-options', async (req, res) => {
  const invoice = await prisma.invoice.findFirst({ where: { id: req.params.id, customerId: req.customer.id, studioId: req.customer.studioId, status: { not: 'DRAFT' } } });
  if (!invoice) return fail(res, CODES.NOT_FOUND, 'Invoice not found', { status: 404 });
  const profile = await prisma.studioProfile.findUnique({ where: { studioId: req.customer.studioId } });
  const claims = await prisma.paymentClaim.findMany({ where: { invoiceId: invoice.id, customerId: req.customer.id }, orderBy: { createdAt: 'desc' } });
  return ok(res, { qrUrl: profile?.paymentQrKey ? await getSignedDownloadUrl(profile.paymentQrKey, 900) : null, upiId: profile?.upiId, payeeName: profile?.displayName, claims });
});
customerRouter.post('/invoices/:id/payment-claims', async (req, res) => {
  try {
    const { reportPayment } = require('../services/billing/paymentClaims');
    const claim = await reportPayment({ studioId: req.customer.studioId, customerId: req.customer.id, invoiceId: req.params.id, amount: req.body.amount, reference: req.body.reference });
    return ok(res, { claim, message: 'Payment reported. The studio will confirm receipt.' });
  } catch (e) { return billingFail(res, e); }
});
adminRouter.get('/payment-claims', async (req, res) => {
  const claims = await prisma.paymentClaim.findMany({ where: { studioId: req.studioId, status: req.query.status || 'PENDING' }, orderBy: { createdAt: 'asc' }, take: 100 });
  const invoices = await prisma.invoice.findMany({ where: { id: { in: claims.map((c) => c.invoiceId) }, studioId: req.studioId }, include: { customer: { select: { name: true } } } });
  return ok(res, { claims: claims.map((c) => ({ ...c, amount: Number(c.amount), invoice: invoices.find((i) => i.id === c.invoiceId) })) });
});
adminRouter.post('/payment-claims/:id/review', async (req, res) => {
  try {
    if (typeof req.body.approve !== 'boolean') throw new BillingError('Choose confirm or reject');
    const { reviewPayment } = require('../services/billing/paymentClaims');
    const claim = await reviewPayment({ studioId: req.studioId, claimId: req.params.id, admin: req.admin, approve: req.body.approve, note: req.body.note });
    return ok(res, { claim });
  } catch (e) { return billingFail(res, e); }
});

function billingFail(res, err) {
  if (err instanceof BillingError) {
    return fail(res, err.code || CODES.VALIDATION, err.message, {
      status: err.status || 400,
      details: err.details,
    });
  }
  throw err;
}

const num = (v, fallback = null) => {
  if (v == null || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const normalizeCode = (c) => String(c || '').trim().toUpperCase().replace(/\s+/g, '');

function mapCoupon(c) {
  return {
    id: c.id,
    code: c.code,
    description: c.description,
    discountType: c.discountType,
    discountValue: Number(c.discountValue || 0),
    minOrderAmount: c.minOrderAmount == null ? null : Number(c.minOrderAmount),
    maxRedemptions: c.maxRedemptions,
    redemptionCount: c.redemptionCount || 0,
    packageIds: Array.isArray(c.packageIds) ? c.packageIds : [],
    active: c.active,
    startsAt: c.startsAt,
    expiresAt: c.expiresAt,
    createdAt: c.createdAt,
  };
}

/** @deprecated use projectInvoice — kept name for call-site compatibility */
function mapInvoice(inv, opts = {}) {
  return projectInvoice(inv, opts);
}

async function recomputeInvoiceBalances(invoiceId) {
  return recomputeInvoiceFromLedger(invoiceId);
}

/** Normalize optional amount-only installments (0–12). Empty plan is allowed (v2). */
function normalizeAmountInstallments(rows, { totalHint = null, allowEmpty = true } = {}) {
  if (!Array.isArray(rows) || !rows.length) {
    if (allowEmpty) return { normalized: [], total: totalHint != null ? Number(totalHint) : 0 };
    const err = new Error('Add at least one installment');
    err.status = 400;
    throw err;
  }
  if (rows.length > 12) {
    const err = new Error('Maximum 12 installments');
    err.status = 400;
    throw err;
  }
  const normalized = rows.map((r, i) => {
    const amount = num(r.amount, null);
    if (amount == null || amount < 0) {
      const err = new Error(`Installment ${i + 1}: enter a valid amount`);
      err.status = 400;
      throw err;
    }
    return {
      sortOrder: i,
      label: (r.label || `Installment ${i + 1}`).toString().slice(0, 120),
      percentage: null,
      amount: Math.round(amount * 100) / 100,
      dueDate: r.dueDate ? new Date(r.dueDate) : null,
      terms: r.terms || null,
      notes: r.notes || null,
      status: r.status || 'PENDING',
    };
  });
  const sum = normalized.reduce((s, r) => s + Number(r.amount || 0), 0);
  const total = totalHint != null && totalHint > 0 ? Number(totalHint) : sum;
  if (total > 0 && Math.abs(sum - total) > 1) {
    // Prefer sum of installment amounts as source of truth when drift is large.
    return { normalized, total: Math.round(sum * 100) / 100 };
  }
  return { normalized, total: Math.round((total || sum) * 100) / 100 };
}

async function createPaymentReceipt({ parent, installment, paidAmount, studioId }) {
  const receiptNumber = await nextInvoiceNumber(studioId);
  const remaining = Math.max(
    0,
    Number(parent.totalAmount || 0) - Number(parent.amountPaid || 0) - Number(paidAmount || 0),
  );
  // amountPaid on parent is updated by caller after; compute remaining carefully
  const parentPaidAfter = Number(parent.amountPaid || 0) + Number(paidAmount || 0);
  const balanceAfter = Math.max(0, Number(parent.totalAmount || 0) - parentPaidAfter);

  return prisma.invoice.create({
    data: {
      studioId,
      customerId: parent.customerId,
      packageId: parent.packageId,
      invoiceNumber: receiptNumber,
      title: `Payment receipt — ${installment.label || 'Installment'}`,
      status: 'PAID',
      kind: 'RECEIPT',
      parentInvoiceId: parent.id,
      currency: parent.currency || 'INR',
      totalAmount: paidAmount,
      amountPaid: paidAmount,
      notes: `Paid against ${parent.invoiceNumber}. Remaining due: ${balanceAfter.toFixed(2)} ${parent.currency || 'INR'}.`,
      terms: parent.terms || null,
      sentAt: new Date(),
      finalizedAt: new Date(),
      installments: {
        create: [{
          sortOrder: 0,
          label: installment.label || 'Payment',
          percentage: null,
          amount: paidAmount,
          status: 'PAID',
          paidAt: new Date(),
          paidAmount,
        }],
      },
    },
    include: {
      customer: { select: { id: true, name: true, email: true, phone: true } },
      package: true,
      installments: true,
    },
  });
}

async function loadStudioMeta(studioId) {
  const [studio, profile] = await Promise.all([
    prisma.studio.findUnique({ where: { id: studioId }, select: { name: true } }),
    prisma.studioProfile.findUnique({ where: { studioId } }),
  ]);
  return {
    studioName: profile?.displayName || studio?.name || 'SJ Clicks and Films',
    studioPhone: profile?.phone || null,
    studioEmail: profile?.email || null,
    studioAddress: profile?.address || 'Nanded, Maharashtra',
    termsHtml: profile?.termsHtml || null,
    tagline: profile?.tagline || 'Studio by Warmkelvin',
  };
}

/**
 * Build invoice PDF. Always return base64 (works even if S3 is down) plus a
 * true S3 pre-signed URL when upload succeeds. Never use bare CloudFront URLs
 * for private invoice objects — those 403 and break View/Download.
 */
const toNum = (v, fallback = 0) => {
  if (v == null || v === '') return fallback;
  if (typeof v === 'number') return Number.isFinite(v) ? v : fallback;
  // Prisma Decimal has toString / toNumber
  if (typeof v?.toNumber === 'function') {
    try { return v.toNumber(); } catch (_) { /* fall through */ }
  }
  const n = Number(typeof v === 'object' && v?.toString ? v.toString() : v);
  return Number.isFinite(n) ? n : fallback;
};

async function invoicePdfResponse(inv, studioId) {
  const meta = await loadStudioMeta(studioId);
  const projected = mapInvoice(inv);
  // Prisma Decimals → plain numbers for the PDF layer
  const plain = {
    ...inv,
    ...projected,
    totalAmount: toNum(inv.totalAmount, projected?.totalAmount || 0),
    amountPaid: projected?.cashPaid ?? toNum(inv.amountPaid, 0),
    cashPaid: projected?.cashPaid ?? toNum(inv.amountPaid, 0),
    adjusted: projected?.adjusted ?? 0,
    balance: projected?.balance ?? Math.max(0, toNum(inv.totalAmount, 0) - toNum(inv.amountPaid, 0)),
    status: projected?.status || inv.status,
    discountAmount: toNum(inv.discountAmount, 0),
    lineItems: (inv.lineItems || []).map((it) => ({
      ...it,
      quantity: toNum(it.quantity, 1),
      unitAmount: toNum(it.unitAmount, 0),
      lineTotal: toNum(it.lineTotal, 0),
    })),
    terms: resolvePaymentTerms(meta.termsHtml, inv.terms),
    installments: projected.installments,
  };
  const buf = await buildInvoicePdf(plain, meta);
  const filename = `${(inv.invoiceNumber || 'invoice').replace(/[^\w.-]+/g, '_')}.pdf`;
  let url = null;
  try {
    const key = `studios/${studioId}/invoices/${inv.id}/invoice.pdf`;
    await uploadToS3(key, buf, 'application/pdf', {
      contentDisposition: `inline; filename="${filename}"`,
    });
    url = await getSignedDownloadUrl(key, 900, {
      contentType: 'application/pdf',
      contentDisposition: `inline; filename="${filename}"`,
    });
  } catch (err) {
    // Non-fatal — clients can still open via base64
    console.error('[invoice-pdf] S3 upload/sign failed:', err?.message || err);
  }
  return {
    url,
    base64: buf.toString('base64'),
    contentType: 'application/pdf',
    size: buf.length,
    title: inv.title || 'Invoice',
    filename,
    invoiceNumber: inv.invoiceNumber,
  };
}

const { nextInvoiceNumber } = require('../services/billing/invoiceNumber');

function computeDiscount({ discountType, discountValue, orderAmount }) {
  const base = Number(orderAmount || 0);
  const val = Number(discountValue || 0);
  if (discountType === 'FIXED') return Math.min(base, Math.max(0, val));
  // PERCENT
  return Math.min(base, Math.max(0, (base * val) / 100));
}

const { validateCoupon: validateCouponForStudio, redeemCoupon, applyInvoiceCoupon } = require('../services/billing/couponService');

// ── Admin: Coupons ─────────────────────────────────────────────────────────

adminRouter.get('/coupons', async (req, res) => {
  const list = await prisma.coupon.findMany({
    where: { studioId: req.studioId },
    orderBy: { createdAt: 'desc' },
  });
  return ok(res, { coupons: list.map(mapCoupon) });
});

adminRouter.post(
  '/coupons',
  body('code').isString().trim().isLength({ min: 2, max: 40 }),
  body('discountType').optional().isIn(['PERCENT', 'FIXED']),
  body('discountValue').isFloat({ min: 0 }),
  validate,
  async (req, res) => {
    const code = normalizeCode(req.body.code);
    const discountType = req.body.discountType === 'FIXED' ? 'FIXED' : 'PERCENT';
    const discountValue = num(req.body.discountValue, 0);
    if (discountType === 'PERCENT' && discountValue > 100) {
      return fail(res, CODES.VALIDATION, 'Percent cannot exceed 100', { status: 400 });
    }
    try {
      const coupon = await prisma.coupon.create({
        data: {
          studioId: req.studioId,
          code,
          description: req.body.description || null,
          discountType,
          discountValue,
          minOrderAmount: num(req.body.minOrderAmount),
          maxRedemptions: req.body.maxRedemptions != null ? parseInt(req.body.maxRedemptions, 10) : null,
          packageIds: Array.isArray(req.body.packageIds) ? req.body.packageIds : [],
          active: req.body.active !== false,
          startsAt: req.body.startsAt ? new Date(req.body.startsAt) : null,
          expiresAt: req.body.expiresAt ? new Date(req.body.expiresAt) : null,
        },
      });
      return ok(res, { coupon: mapCoupon(coupon) }, 201);
    } catch (e) {
      if (e.code === 'P2002') {
        return fail(res, CODES.CONFLICT, 'Coupon code already exists', { status: 409 });
      }
      throw e;
    }
  },
);

adminRouter.patch('/coupons/:id', async (req, res) => {
  const existing = await prisma.coupon.findFirst({
    where: { id: req.params.id, studioId: req.studioId },
  });
  if (!existing) return fail(res, CODES.NOT_FOUND, 'Coupon not found', { status: 404 });
  const data = {};
  if (req.body.description !== undefined) data.description = req.body.description || null;
  if (req.body.discountType) data.discountType = req.body.discountType === 'FIXED' ? 'FIXED' : 'PERCENT';
  if (req.body.discountValue !== undefined) data.discountValue = num(req.body.discountValue, 0);
  if (req.body.minOrderAmount !== undefined) data.minOrderAmount = num(req.body.minOrderAmount);
  if (req.body.maxRedemptions !== undefined) {
    data.maxRedemptions = req.body.maxRedemptions == null ? null : parseInt(req.body.maxRedemptions, 10);
  }
  if (req.body.packageIds !== undefined) data.packageIds = Array.isArray(req.body.packageIds) ? req.body.packageIds : [];
  if (req.body.active !== undefined) data.active = !!req.body.active;
  if (req.body.startsAt !== undefined) data.startsAt = req.body.startsAt ? new Date(req.body.startsAt) : null;
  if (req.body.expiresAt !== undefined) data.expiresAt = req.body.expiresAt ? new Date(req.body.expiresAt) : null;
  const coupon = await prisma.coupon.update({ where: { id: existing.id }, data });
  return ok(res, { coupon: mapCoupon(coupon) });
});

adminRouter.delete('/coupons/:id', async (req, res) => {
  await prisma.coupon.deleteMany({ where: { id: req.params.id, studioId: req.studioId } });
  return ok(res, { deleted: true });
});

// ── Admin: Invoices ────────────────────────────────────────────────────────

/** Studio billing summary + invoices (service invoices only by default). */
adminRouter.get('/summary', async (req, res) => {
  const invoices = await prisma.invoice.findMany({
    where: {
      studioId: req.studioId,
      kind: 'INVOICE',
      status: { notIn: ['VOID', 'DRAFT'] },
    },
    include: {
      payments: true,
      customer: { select: { id: true, name: true, phone: true } },
    },
  });
  let totalBilled = 0;
  let totalCash = 0;
  let totalAdjusted = 0;
  let openCount = 0;
  const byCustomer = new Map();

  for (const inv of invoices) {
    const m = mapInvoice(inv, { includeCustomer: true });
    totalBilled += m.totalAmount;
    totalCash += m.cashPaid;
    totalAdjusted += m.adjusted;
    if (m.balance > 0) openCount += 1;
    const cid = inv.customerId;
    const row = byCustomer.get(cid) || {
      customerId: cid,
      name: inv.customer?.name || 'Client',
      phone: inv.customer?.phone || null,
      billed: 0,
      paid: 0,
      adjusted: 0,
      balance: 0,
      openInvoices: 0,
    };
    row.billed += m.totalAmount;
    row.paid += m.cashPaid;
    row.adjusted += m.adjusted;
    row.balance += m.balance;
    if (m.balance > 0) row.openInvoices += 1;
    byCustomer.set(cid, row);
  }

  const accounts = [...byCustomer.values()]
    .map((a) => ({
      ...a,
      billed: Math.round(a.billed * 100) / 100,
      paid: Math.round(a.paid * 100) / 100,
      adjusted: Math.round(a.adjusted * 100) / 100,
      balance: Math.round(a.balance * 100) / 100,
    }))
    .sort((a, b) => b.balance - a.balance);

  return ok(res, {
    summary: {
      totalBilled: Math.round(totalBilled * 100) / 100,
      totalCash: Math.round(totalCash * 100) / 100,
      totalAdjusted: Math.round(totalAdjusted * 100) / 100,
      totalOutstanding: accountSummary(invoices.map(i => mapInvoice(i))).balance,
      openInvoices: openCount,
      clientsWithDues: accounts.filter((a) => a.balance > 0).length,
    },
    accounts,
  });
});

adminRouter.get('/invoices', async (req, res) => {
  const { status, customerId, kind, q } = req.query;
  // Default: only service invoices (hide legacy receipt clutter)
  const kindFilter = kind === 'ALL'
    ? {}
    : kind
      ? { kind: String(kind) }
      : { kind: 'INVOICE' };
  const qstr = String(q || '').trim();
  const list = await prisma.invoice.findMany({
    where: {
      studioId: req.studioId,
      ...kindFilter,
      ...(status ? { status: String(status) } : {}),
      ...(customerId ? { customerId: String(customerId) } : {}),
      ...(qstr
        ? {
          OR: [
            { invoiceNumber: { contains: qstr, mode: 'insensitive' } },
            { title: { contains: qstr, mode: 'insensitive' } },
            { customer: { name: { contains: qstr, mode: 'insensitive' } } },
            { customer: { phone: { contains: qstr.replace(/\D/g, '') || qstr } } },
          ],
        }
        : {}),
    },
    orderBy: { createdAt: 'desc' },
    include: {
      customer: { select: { id: true, name: true, email: true, phone: true } },
      package: { select: { id: true, title: true, price: true } },
      installments: { orderBy: { sortOrder: 'asc' } },
      payments: {
        orderBy: { paidAt: 'desc' },
        include: { installment: { select: { id: true, label: true } } },
      },
    },
  });
  return ok(res, { invoices: list.map((i) => mapInvoice(i, { includeCustomer: true })) });
});

adminRouter.get('/invoices/:id', async (req, res) => {
  const inv = await prisma.invoice.findFirst({
    where: { id: req.params.id, studioId: req.studioId },
    include: invoiceInclude,
  });
  if (!inv) return fail(res, CODES.NOT_FOUND, 'Invoice not found', { status: 404 });
  return ok(res, { invoice: mapInvoice(inv, { includeCustomer: true }) });
});

adminRouter.post('/invoices', async (req, res) => {
  const {
    customerId, packageId, title, totalAmount, travelAmount, currency, notes, terms,
    couponCode, installments,
  } = req.body || {};
  if (!customerId) return fail(res, CODES.VALIDATION, 'customerId required', { status: 400 });

  const customer = await prisma.customer.findFirst({
    where: { id: customerId, studioId: req.studioId, isGuest: false },
  });
  if (!customer) return fail(res, CODES.NOT_FOUND, 'Customer not found', { status: 404 });

  let pkg = null;
  if (packageId) {
    pkg = await prisma.servicePackage.findFirst({
      where: { id: packageId, studioId: req.studioId },
    });
    if (!pkg) return fail(res, CODES.NOT_FOUND, 'Package not found', { status: 404 });
  }

  const travel = Math.max(0, num(travelAmount, 0) || 0);
  // totalAmount from client = service / package total (before travel)
  let serviceTotal = num(
    totalAmount,
    pkg ? Number(pkg.discountPrice ?? pkg.price) : 0,
  ) || 0;
  const grandHint = serviceTotal > 0 ? serviceTotal + travel : null;
  let discountAmount = 0;
  let appliedCode = null;

  let normalized;
  let total;
  try {
    const rows = Array.isArray(installments) ? installments : [];
    ({ normalized, total } = normalizeAmountInstallments(rows, { totalHint: grandHint }));
  } catch (e) {
    return fail(res, CODES.VALIDATION, e.message, { status: e.status || 400 });
  }

  // Prefer explicit service + travel when provided; else installment sum
  if (grandHint != null && grandHint > 0) {
    total = Math.round(grandHint * 100) / 100;
  }

  if (couponCode) {
    try {
      const v = await validateCouponForStudio({
        studioId: req.studioId,
        code: couponCode,
        packageId: packageId || null,
        orderAmount: total - travel,
        customerId,
      });
      discountAmount = v.discountAmount;
      appliedCode = v.coupon.code;
      // Reduce last installment first to match discounted total
      let remaining = Math.round((v.finalAmount + travel) * 100) / 100;
      total = remaining;
      for (let i = 0; i < normalized.length; i++) {
        if (i === normalized.length - 1) {
          normalized[i].amount = Math.max(0, Math.round(remaining * 100) / 100);
        } else {
          const a = Math.min(normalized[i].amount, remaining);
          normalized[i].amount = a;
          remaining = Math.round((remaining - a) * 100) / 100;
        }
      }
    } catch (e) {
      return fail(res, CODES.VALIDATION, e.message, { status: e.status || 400 });
    }
  }

  const profile = await prisma.studioProfile.findUnique({ where: { studioId: req.studioId } });
  const resolvedTerms = String(terms || '').trim()
    || resolvePaymentTerms(profile?.termsHtml, null)
    || DEFAULT_PAYMENT_TERMS;

  const invoiceNumber = await nextInvoiceNumber(req.studioId);
  const serviceAmt = Math.max(0, Math.round((total + discountAmount - travel) * 100) / 100);
  const lineCreates = [];
  if (serviceAmt > 0) {
    lineCreates.push({
      sortOrder: 0,
      kind: 'PACKAGE',
      description: (title || 'Service').toString().slice(0, 200),
      quantity: 1,
      unitAmount: serviceAmt,
      lineTotal: serviceAmt,
    });
  }
  if (travel > 0) {
    lineCreates.push({
      sortOrder: 1,
      kind: 'TRAVEL',
      description: 'Travelling',
      quantity: 1,
      unitAmount: travel,
      lineTotal: travel,
    });
  }
  if (discountAmount > 0) {
    lineCreates.push({
      sortOrder: 2,
      kind: 'DISCOUNT',
      description: appliedCode ? `Coupon ${appliedCode}` : 'Discount',
      quantity: 1,
      unitAmount: -discountAmount,
      lineTotal: -discountAmount,
    });
  }

  const inv = await prisma.invoice.create({
    data: {
      studioId: req.studioId,
      customerId,
      packageId: packageId || null,
      invoiceNumber,
      title: (title || 'Service Invoice').toString().slice(0, 160),
      status: 'DRAFT',
      kind: 'INVOICE',
      currency: (currency || 'INR').toString().slice(0, 8),
      totalAmount: total,
      travelAmount: travel,
      amountPaid: 0,
      cachedOutstanding: total,
      notes: notes || null,
      terms: resolvedTerms,
      couponCode: appliedCode,
      discountAmount,
      createdById: req.admin?.id || null,
      installments: normalized.length
        ? { create: normalized.map(({ status, ...r }) => ({ ...r, status: 'PENDING' })) }
        : undefined,
      lineItems: lineCreates.length ? { create: lineCreates } : undefined,
    },
    include: invoiceInclude,
  });
  return ok(res, { invoice: mapInvoice(inv, { includeCustomer: true }) }, 201);
});

adminRouter.put('/invoices/:id', async (req, res) => {
  const existing = await prisma.invoice.findFirst({
    where: { id: req.params.id, studioId: req.studioId },
    include: { installments: true },
  });
  if (!existing) return fail(res, CODES.NOT_FOUND, 'Invoice not found', { status: 404 });
  if (existing.status === 'VOID') {
    return fail(res, CODES.VALIDATION, 'Cannot edit a void invoice', { status: 400 });
  }

  const {
    title, totalAmount, travelAmount, currency, notes, terms, packageId, installments, status,
  } = req.body || {};

  // Full money edits only on DRAFT (or when explicitly allowed)
  const moneyEditable = existing.status === 'DRAFT';

  const data = {
    ...(title !== undefined && { title: String(title).slice(0, 160) }),
    ...(currency !== undefined && { currency: String(currency).slice(0, 8) }),
    ...(notes !== undefined && { notes: notes || null }),
    ...(terms !== undefined && { terms: terms || null }),
    ...(moneyEditable && totalAmount !== undefined && { totalAmount: num(totalAmount, 0) || 0 }),
    ...(moneyEditable && travelAmount !== undefined && { travelAmount: num(travelAmount, 0) || 0 }),
  };

  if (packageId !== undefined) {
    if (!packageId) data.packageId = null;
    else {
      const pkg = await prisma.servicePackage.findFirst({
        where: { id: packageId, studioId: req.studioId },
      });
      if (!pkg) return fail(res, CODES.NOT_FOUND, 'Package not found', { status: 404 });
      data.packageId = pkg.id;
    }
  }

  if (Array.isArray(installments)) {
    if (existing.kind === 'RECEIPT') {
      return fail(res, CODES.VALIDATION, 'Cannot edit receipt installments', { status: 400 });
    }
    if (!moneyEditable && existing.status !== 'DRAFT') {
      return fail(res, CODES.VALIDATION, 'Installment plan can only be rewritten on DRAFT invoices. Use revise for finalized.', { status: 400 });
    }
    try {
      const totalHint = data.totalAmount != null ? Number(data.totalAmount) : Number(existing.totalAmount);
      const { normalized, total } = normalizeAmountInstallments(installments, { totalHint, allowEmpty: true });
      if (normalized.length && total > 0) data.totalAmount = total;
      await prisma.invoiceInstallment.deleteMany({ where: { invoiceId: existing.id } });
      await prisma.invoiceInstallment.createMany({
        data: normalized.map((r) => ({
          invoiceId: existing.id,
          sortOrder: r.sortOrder,
          label: r.label,
          percentage: null,
          amount: r.amount,
          dueDate: r.dueDate,
          terms: r.terms,
          notes: r.notes,
          status: r.status || 'PENDING',
        })),
      });
    } catch (e) {
      return fail(res, CODES.VALIDATION, e.message, { status: e.status || 400 });
    }
  }

  // Legacy markInstallmentPaid → ledger payment (remaining balance of installment)
  if (req.body.markInstallmentPaid) {
    if (existing.kind === 'RECEIPT') {
      return fail(res, CODES.VALIDATION, 'Cannot mark a receipt as paid again', { status: 400 });
    }
    const { installmentId, paidAmount, method, note } = req.body.markInstallmentPaid;
    const inst = await prisma.invoiceInstallment.findFirst({
      where: { id: installmentId, invoiceId: existing.id },
    });
    if (!inst) {
      return fail(res, CODES.NOT_FOUND, 'Installment not found', { status: 404 });
    }
    if (inst.status === 'PAID' || inst.status === 'WAIVED') {
      return fail(res, CODES.VALIDATION, 'Installment already settled', { status: 400 });
    }
    const already = Number(inst.paidAmount || 0);
    const remaining = Math.max(0, Number(inst.amount || 0) - already);
    const paid = num(paidAmount, remaining) || 0;
    if (paid <= 0) {
      return fail(res, CODES.VALIDATION, 'Payment amount must be greater than zero', { status: 400 });
    }
    await prisma.invoicePayment.create({
      data: {
        studioId: req.studioId,
        invoiceId: existing.id,
        installmentId: inst.id,
        kind: 'PAYMENT',
        amount: Math.round(paid * 100) / 100,
        method: method || 'CASH',
        note: note || `Payment against ${inst.label}`,
        paidAt: new Date(),
        createdById: req.admin?.id || null,
      },
    });
    // Apply any other PUT fields first
    if (Object.keys(data).length) {
      await prisma.invoice.update({ where: { id: existing.id }, data });
    }
    const full = await recomputeInvoiceBalances(existing.id);
    // WhatsApp notice
    try {
      const { triggerAuto } = require('../services/whatsapp');
      const cust = await prisma.customer.findUnique({
        where: { id: existing.customerId },
        select: { name: true, phone: true },
      });
      if (cust?.phone) {
        const mapped = mapInvoice(full, { includeCustomer: true });
        triggerAuto(req.studioId, 'INVOICE_INSTALLMENT_PAID', {
          phone: cust.phone,
          toName: cust.name,
          vars: {
            name: cust.name,
            invoiceNumber: existing.invoiceNumber,
            installmentLabel: inst.label,
            paidAmount: String(paid),
            balance: String(mapped.balance),
            currency: existing.currency || 'INR',
            totalAmount: String(mapped.totalAmount),
          },
          meta: { invoiceId: existing.id, installmentId: inst.id },
        });
      }
    } catch (_) { /* optional */ }
    return ok(res, {
      invoice: mapInvoice(full, { includeCustomer: true }),
      receipt: null,
    });
  }

  if (status === 'VOID') data.status = 'VOID';

  const inv = await prisma.invoice.update({
    where: { id: existing.id },
    data,
    include: invoiceInclude,
  });
  return ok(res, {
    invoice: mapInvoice(inv, { includeCustomer: true }),
    receipt: null,
  });
});

/**
 * Set total amount paid on an invoice (unified — cash paid only).
 * Body: { amountPaid, method?, note? }
 */
adminRouter.put('/invoices/:id/paid', async (req, res) => {
  try {
    const result = await setInvoicePaid({
      studioId: req.studioId,
      invoiceId: req.params.id,
      amountPaid: req.body?.amountPaid ?? req.body?.paid ?? req.body?.amount,
      method: req.body?.method,
      note: req.body?.note,
      admin: req.admin,
    });
    const full = await prisma.invoice.findUnique({
      where: { id: req.params.id },
      include: invoiceInclude,
    });
    const mapped = mapInvoice(full, { includeCustomer: true });
    if (result?.payment && String(result.payment.kind || 'PAYMENT').toUpperCase() === 'PAYMENT' && !result.unchanged) {
      try {
        const { triggerAuto } = require('../services/whatsapp');
        const cust = full?.customer;
        if (cust?.phone) {
          triggerAuto(req.studioId, 'PAYMENT_RECORDED', {
            phone: cust.phone,
            toName: cust.name,
            vars: {
              name: cust.name,
              invoiceNumber: full.invoiceNumber,
              paidAmount: String(result.payment.amount),
              balance: String(mapped.balance),
              currency: full.currency || 'INR',
              totalAmount: String(mapped.totalAmount),
              method: result.payment.method || '',
            },
            meta: { invoiceId: full.id, paymentId: result.payment.id },
          });
        }
      } catch (_) { /* optional */ }
    }
    return ok(res, { invoice: mapped });
  } catch (e) {
    if (e instanceof BillingError) {
      return fail(res, e.code || CODES.VALIDATION, e.message, { status: e.status || 400 });
    }
    return fail(res, CODES.INTERNAL, e.message || 'Could not update paid amount', { status: 500 });
  }
});

adminRouter.post('/invoices/:id/payments', async (req, res) => {
  try {
    const incomingKind = String(req.body?.kind || 'PAYMENT').toUpperCase();
    if (['WRITE_OFF', 'ROUND_OFF', 'ADJUSTMENT'].includes(incomingKind)) {
      return fail(res, CODES.VALIDATION, 'Use Update paid — set how much is paid. Write-off and round-off are not used.', { status: 400 });
    }
    const result = await recordPayment({
      studioId: req.studioId,
      invoiceId: req.params.id,
      body: req.body || {},
      admin: req.admin,
    });

    const full = await prisma.invoice.findUnique({
      where: { id: req.params.id },
      include: invoiceInclude,
    });
    const mapped = mapInvoice(full, { includeCustomer: true });

    const kind = String(req.body?.kind || 'PAYMENT').toUpperCase();
    if (kind === 'PAYMENT' && !result.replayed) {
      try {
        const { triggerAuto } = require('../services/whatsapp');
        const cust = full?.customer;
        if (cust?.phone) {
          const next = mapped.plan?.nextDue;
          triggerAuto(req.studioId, 'INVOICE_INSTALLMENT_PAID', {
            phone: cust.phone,
            toName: cust.name,
            vars: {
              name: cust.name,
              invoiceNumber: full.invoiceNumber,
              installmentLabel: next?.label || 'Payment',
              paidAmount: String(result.payment.amount),
              balance: String(mapped.balance),
              currency: full.currency || 'INR',
              totalAmount: String(mapped.totalAmount),
            },
            meta: { invoiceId: full.id, paymentId: result.payment.id },
          });
          // Dual-fire new key when templates exist
          try {
            triggerAuto(req.studioId, 'PAYMENT_RECORDED', {
              phone: cust.phone,
              toName: cust.name,
              vars: {
                name: cust.name,
                invoiceNumber: full.invoiceNumber,
                paidAmount: String(result.payment.amount),
                balance: String(mapped.balance),
                currency: full.currency || 'INR',
                totalAmount: String(mapped.totalAmount),
                method: result.payment.method || '',
              },
              meta: { invoiceId: full.id, paymentId: result.payment.id },
            });
          } catch (_) { /* optional template */ }
        }
      } catch (_) { /* optional */ }
    }

    return ok(res, {
      payment: mapPayment(result.payment),
      receipt: result.receipt || null,
      invoice: mapped,
      replayed: !!result.replayed,
    }, result.replayed ? 200 : 201);
  } catch (err) {
    return billingFail(res, err);
  }
});

/** Soft-void payment (MANAGER+) */
adminRouter.post('/invoices/:id/payments/:paymentId/void', requireRole('OWNER', 'MANAGER'), async (req, res) => {
  try {
    await voidPayment({
      studioId: req.studioId,
      invoiceId: req.params.id,
      paymentId: req.params.paymentId,
      reason: req.body?.reason,
      admin: req.admin,
    });
    const full = await prisma.invoice.findUnique({
      where: { id: req.params.id },
      include: invoiceInclude,
    });
    return ok(res, {
      voided: true,
      invoice: mapInvoice(full, { includeCustomer: true }),
    });
  } catch (err) {
    return billingFail(res, err);
  }
});

/** Hard delete deprecated — soft-void unless BILLING_ALLOW_HARD_DELETE */
adminRouter.delete('/invoices/:id/payments/:paymentId', async (req, res) => {
  if (!allowHardDeletePayments()) {
    return fail(res, CODES.VALIDATION,
      'Hard delete disabled. Use POST .../payments/:id/void to soft-void.',
      { status: 410 });
  }
  const existing = await prisma.invoice.findFirst({
    where: { id: req.params.id, studioId: req.studioId },
  });
  if (!existing) return fail(res, CODES.NOT_FOUND, 'Invoice not found', { status: 404 });

  const deleted = await prisma.invoicePayment.deleteMany({
    where: {
      id: req.params.paymentId,
      invoiceId: existing.id,
      studioId: req.studioId,
    },
  });
  if (!deleted.count) return fail(res, CODES.NOT_FOUND, 'Payment not found', { status: 404 });

  const full = await recomputeInvoiceBalances(existing.id);
  return ok(res, {
    deleted: true,
    invoice: mapInvoice(full, { includeCustomer: true }),
  });
});

/** Package upgrade/downgrade revise (MANAGER+) */
adminRouter.post('/invoices/:id/revise', requireRole('OWNER', 'MANAGER'), async (req, res) => {
  try {
    await reviseInvoice({
      studioId: req.studioId,
      invoiceId: req.params.id,
      body: req.body || {},
      admin: req.admin,
    });
    const full = await prisma.invoice.findUnique({
      where: { id: req.params.id },
      include: invoiceInclude,
    });
    return ok(res, { invoice: mapInvoice(full, { includeCustomer: true }) });
  } catch (err) {
    return billingFail(res, err);
  }
});

/** Finalize & send invoice to customer dashboard. Installments optional (v2). */
adminRouter.post('/invoices/:id/finalize', async (req, res) => {
  try {
    const inv = await prisma.$transaction(async (db) => {
      await db.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${req.params.id} AND "studioId" = ${req.studioId} FOR UPDATE`;
      const existing = await db.invoice.findFirst({ where: { id: req.params.id, studioId: req.studioId }, include: invoiceInclude });
      if (!existing || existing.status === 'VOID') throw new BillingError('Invoice is unavailable');
      if (existing.finalizedAt) return existing;
      if (Number(existing.totalAmount) < 0) throw new BillingError('Invoice total cannot be negative');
      await redeemCoupon(db, existing);
      const snapshot = existing.packageSnapshot || (existing.package ? JSON.parse(JSON.stringify(existing.package)) : undefined);
      const inv = await db.invoice.update({ where: { id: existing.id }, data: {
        status: Number(existing.amountPaid) >= Number(existing.totalAmount) ? 'PAID' : Number(existing.amountPaid) > 0 ? 'PARTIALLY_PAID' : 'SENT',
        finalizedAt: new Date(), issuedAt: existing.issuedAt || new Date(), sentAt: existing.sentAt || new Date(),
        packageSnapshot: snapshot, cachedOutstanding: Math.max(0, Number(existing.totalAmount) - Number(existing.amountPaid)),
      }, include: invoiceInclude });
      await recomputeCustomerRollup(db, inv.customerId);
      return inv;
    });
    return ok(res, { invoice: mapInvoice(inv, { includeCustomer: true }) });
  } catch (e) { return fail(res, CODES.VALIDATION, e.message, { status: e.status || 400 }); }
});

adminRouter.delete('/invoices/:id', async (req, res) => {
  try {
    const result = await prisma.$transaction(async (db) => {
      await db.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${req.params.id} AND "studioId" = ${req.studioId} FOR UPDATE`;
      const existing = await db.invoice.findFirst({ where: { id: req.params.id, studioId: req.studioId }, include: { payments: true } });
      if (!existing) throw new BillingError('Invoice not found', { status: 404 });
      if (existing.payments.some((p) => !p.voidedAt) || Number(existing.amountPaid) > 0) throw new BillingError('Reverse incorrect receipts or settle refunds before voiding this invoice');
      if (existing.status === 'DRAFT') await db.invoice.delete({ where: { id: existing.id } });
      else await db.invoice.update({ where: { id: existing.id }, data: { status: 'VOID', voidedAt: new Date(), voidReason: String(req.body?.reason || 'Voided by studio').slice(0, 500) } });
      await require('../services/rawDump').fulfillRawDumpIfPaid(existing.id, db);
      await recomputeCustomerRollup(db, existing.customerId);
      return existing.status === 'DRAFT' ? { deleted: true } : { voided: true };
    });
    return ok(res, result);
  } catch (e) { return fail(res, CODES.VALIDATION, e.message, { status: e.status || 400 }); }
});

/** Generate / refresh invoice PDF and return a signed download URL. */
adminRouter.get('/invoices/:id/pdf', async (req, res) => {
  try {
    const inv = await prisma.invoice.findFirst({
      where: { id: req.params.id, studioId: req.studioId },
      include: invoiceInclude,
    });
    if (!inv) return fail(res, CODES.NOT_FOUND, 'Invoice not found', { status: 404 });
    const payload = await invoicePdfResponse(inv, req.studioId);
    return ok(res, payload);
  } catch (err) {
    return fail(res, CODES.INTERNAL, err.message || 'Could not generate PDF', { status: 500 });
  }
});

// The same receipt document is available to studio and owning customer.
async function receiptPdfResponse(req, res) {
  const studioId = req.studioId || req.customer.studioId;
  const receipt = await prisma.receipt.findFirst({
    where: { id: req.params.receiptId, studioId,
      ...(req.customer ? { invoice: { customerId: req.customer.id, status: { not: 'DRAFT' } } } : {}),
    },
    include: { payment: true, invoice: { include: { customer: true } } },
  });
  if (!receipt) return fail(res, CODES.NOT_FOUND, 'Receipt not found', { status: 404 });
  const studio = await prisma.studio.findUnique({ where: { id: studioId }, select: { name: true } });
  const { buildReceiptPdf } = require('../services/billing/receiptPdf');
  const buffer = await buildReceiptPdf(receipt, studio);
  return ok(res, { base64: buffer.toString('base64'), filename: `${receipt.receiptNumber}.pdf` });
}
adminRouter.get('/receipts/:receiptId/pdf', receiptPdfResponse);
customerRouter.get('/receipts/:receiptId/pdf', receiptPdfResponse);

// ── Customer: coupons + invoices ───────────────────────────────────────────

customerRouter.post('/coupons/validate', async (req, res) => {
  try {
    const { code, packageId, orderAmount } = req.body || {};
    const result = await validateCouponForStudio({
      studioId: req.customer.studioId,
      code,
      packageId: packageId || null,
      orderAmount: num(orderAmount, 0) || 0,
      customerId: req.customer.id,
    });
    return ok(res, {
      valid: true,
      code: result.coupon.code,
      discountType: result.coupon.discountType,
      discountValue: Number(result.coupon.discountValue),
      discountAmount: result.discountAmount,
      finalAmount: result.finalAmount,
      description: result.coupon.description,
    });
  } catch (e) {
    return fail(res, CODES.VALIDATION, e.message, { status: e.status || 400 });
  }
});

customerRouter.post('/coupons/apply', async (req, res) => {
  return fail(res, CODES.VALIDATION, 'Apply the coupon to your invoice so the saving is recorded correctly.', { status: 400 });
});

/** Plain-language invoice status for customers (never raw enums). */
function customerInvoiceStatusLabel(inv) {
  if (!inv || inv.status === 'VOID') return 'Cancelled';
  const bal = Number(inv.balance ?? inv.totals?.outstanding ?? 0);
  const total = Number(inv.totalAmount ?? inv.totals?.total ?? 0);
  const paid = Number(inv.cashPaid ?? inv.amountPaid ?? 0);

  if (bal <= 0 || inv.status === 'PAID' || inv.status === 'WRITTEN_OFF') {
    return 'Nothing due — you\'re all paid up';
  }
  if (paid > 0.01 && bal > 0) {
    return `Partially paid — ₹${paid.toLocaleString('en-IN')} of ₹${total.toLocaleString('en-IN')}`;
  }
  return `₹${bal.toLocaleString('en-IN')} due`;
}

/** Customer one-stop billing: summary + invoices + chronological money timeline. */
customerRouter.get('/account', async (req, res) => {
  const list = await prisma.invoice.findMany({
    where: {
      customerId: req.customer.id,
      studioId: req.customer.studioId,
      status: { not: 'DRAFT' },
      kind: 'INVOICE',
    },
    orderBy: { createdAt: 'desc' },
    include: invoiceInclude,
  });
  const invoices = list.map((i) => {
    const mapped = mapInvoice(i);
    return {
      ...mapped,
      statusLabel: customerInvoiceStatusLabel(mapped),
    };
  });
  const summary = accountSummary(invoices);
  const { billed, paid, adjusted, balance } = summary;

  // Chronological timeline for Billing home
  const timeline = [];
  for (const inv of list) {
    if (inv.status === 'VOID') continue;
    timeline.push({
      type: 'INVOICE_CREATED',
      at: inv.sentAt || inv.finalizedAt || inv.createdAt,
      title: `Invoice ${inv.invoiceNumber} created`,
      subtitle: inv.title || null,
      amount: Number(inv.totalAmount || 0),
      invoiceId: inv.id,
      invoiceNumber: inv.invoiceNumber,
    });
    for (const p of inv.payments || []) {
      if (p.voidedAt) continue;
      const kind = String(p.kind || 'PAYMENT').toUpperCase();
      if (kind === 'PAYMENT') {
        timeline.push({
          type: 'PAYMENT',
          at: p.paidAt || p.createdAt,
          title: `₹${Number(p.amount || 0).toLocaleString('en-IN')} paid${p.method ? ` (${p.method})` : ''}`,
          subtitle: inv.invoiceNumber,
          amount: Number(p.amount || 0),
          invoiceId: inv.id,
          invoiceNumber: inv.invoiceNumber,
        });
      } else if (kind === 'REFUND') {
        timeline.push({
          type: 'REFUND',
          at: p.paidAt || p.createdAt,
          title: `₹${Number(p.amount || 0).toLocaleString('en-IN')} refund`,
          subtitle: inv.invoiceNumber,
          amount: Number(p.amount || 0),
          invoiceId: inv.id,
          invoiceNumber: inv.invoiceNumber,
        });
      }
    }
    for (const li of inv.lineItems || []) {
      if (String(li.kind).toUpperCase() === 'ADDON' && String(li.description || '').includes('[SEL_OVERAGE:')) {
        timeline.push({
          type: 'SELECTION_OVERAGE',
          at: inv.updatedAt || inv.createdAt,
          title: `${Number(li.quantity || 0)} extra photos → +₹${Number(li.lineTotal || 0).toLocaleString('en-IN')}`,
          subtitle: inv.invoiceNumber,
          amount: Number(li.lineTotal || 0),
          invoiceId: inv.id,
          invoiceNumber: inv.invoiceNumber,
        });
      }
    }
    if (inv.couponCode) {
      timeline.push({
        type: 'COUPON',
        at: inv.updatedAt || inv.createdAt,
        title: `Coupon ${inv.couponCode} applied`,
        subtitle: inv.discountAmount
          ? `Saved ₹${Number(inv.discountAmount).toLocaleString('en-IN')}`
          : inv.invoiceNumber,
        amount: Number(inv.discountAmount || 0),
        invoiceId: inv.id,
      });
    }
  }
  timeline.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  let headline = 'Nothing due — you\'re all paid up';
  if (balance > 0) {
    if (paid > 0.01) {
      headline = `Partially paid — ₹${paid.toLocaleString('en-IN')} of ₹${billed.toLocaleString('en-IN')}`;
    } else {
      headline = `₹${balance.toLocaleString('en-IN')} due`;
    }
  } else if (adjusted > 0) {
    if (paid > 0.01) {
      headline = `Account settled — ₹${paid.toLocaleString('en-IN')} paid · ₹${adjusted.toLocaleString('en-IN')} written off`;
    } else {
      headline = `Account written off — ₹${adjusted.toLocaleString('en-IN')} waived`;
    }
  } else if (billed <= 0) {
    headline = 'No bills yet';
  }

  // Pending package request (no non-draft invoice yet)
  const customer = await prisma.customer.findUnique({
    where: { id: req.customer.id },
    select: {
      requestedPackageId: true,
      packageId: true,
      requestedPackage: { select: { id: true, name: true } },
      package: { select: { id: true, name: true } },
    },
  });
  const hasInvoice = invoices.some((i) => i.status !== 'VOID');
  const packagePending = !!(
    (customer?.requestedPackageId || customer?.packageId)
    && !hasInvoice
  );

  return ok(res, {
    summary: {
      ...summary,
      headline,
      statusLabel: headline,
    },
    invoices,
    timeline: timeline.slice(0, 80),
    packagePending: packagePending
      ? {
          pending: true,
          message: 'Awaiting studio confirmation — they will confirm pricing and send your invoice shortly.',
          packageName: customer?.requestedPackage?.name || customer?.package?.name || null,
        }
      : { pending: false },
  });
});

customerRouter.get('/invoices', async (req, res) => {
  const list = await prisma.invoice.findMany({
    where: {
      customerId: req.customer.id,
      studioId: req.customer.studioId,
      status: { not: 'DRAFT' },
      kind: 'INVOICE', // hide receipt clutter
    },
    orderBy: { createdAt: 'desc' },
    include: invoiceInclude,
  });
  return ok(res, { invoices: list.map((i) => mapInvoice(i)) });
});

customerRouter.get('/invoices/:id', async (req, res) => {
  const inv = await prisma.invoice.findFirst({
    where: {
      id: req.params.id,
      customerId: req.customer.id,
      studioId: req.customer.studioId,
      status: { not: 'DRAFT' },
    },
    include: invoiceInclude,
  });
  if (!inv) return fail(res, CODES.NOT_FOUND, 'Invoice not found', { status: 404 });
  return ok(res, { invoice: mapInvoice(inv) });
});

/** Customer: view / download invoice PDF (same content as admin). */
customerRouter.get('/invoices/:id/pdf', async (req, res) => {
  try {
    const inv = await prisma.invoice.findFirst({
      where: {
        id: req.params.id,
        customerId: req.customer.id,
        studioId: req.customer.studioId,
        status: { not: 'DRAFT' },
      },
      include: invoiceInclude,
    });
    if (!inv) return fail(res, CODES.NOT_FOUND, 'Invoice not found', { status: 404 });
    const payload = await invoicePdfResponse(inv, req.customer.studioId);
    return ok(res, payload);
  } catch (err) {
    return fail(res, CODES.INTERNAL, err.message || 'Could not generate PDF', { status: 500 });
  }
});

/**
 * Customer applies coupon on a SENT invoice before any installment is paid.
 * Option A: reject if any installment is already PAID.
 */
customerRouter.post('/invoices/:id/apply-coupon', async (req, res) => {
  try {
    const invoice = await applyInvoiceCoupon({ studioId: req.customer.studioId, customerId: req.customer.id, invoiceId: req.params.id, code: req.body?.code });
    return ok(res, { invoice: mapInvoice(invoice), discountAmount: Number(invoice.discountAmount), finalAmount: Number(invoice.totalAmount), code: invoice.couponCode });
  } catch (e) { return fail(res, CODES.VALIDATION, e.message, { status: e.status || 400 }); }
});

module.exports = { adminRouter, customerRouter };
