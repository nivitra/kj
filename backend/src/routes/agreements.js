/**
 * Structured Wedding Agreement forms (admin wizard) → PDF → Contract for both parties.
 */
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { prisma } = require('../config/prisma');
const { authenticateAdmin, authenticateCustomer } = require('../middleware/auth');
const { ok, fail } = require('../lib/envelope');
const { CODES } = require('../lib/errors');
const { uploadToS3, getSignedPhotoUrl } = require('../services/s3');
const path = require('path');
const fs = require('fs');
const {
  buildWeddingAgreementPdf,
  emptyWeddingForm,
  emptyDay,
  SCOPE_OPTIONS,
  DELIVERABLE_CATALOG,
  TIMELINE_CATALOG,
  RESPONSIBILITY_CATALOG,
  DEFAULT_WHY_US,
} = require('../services/weddingAgreementPdf');

const adminRouter = express.Router();
adminRouter.use(authenticateAdmin);

const customerRouter = express.Router();
customerRouter.use(authenticateCustomer);

function numOrNull(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

// ── Admin: template metadata ───────────────────────────────────────────────

adminRouter.get('/wedding/template', async (_req, res) => {
  return ok(res, {
    templateType: 'WEDDING',
    title: 'Wedding Photography Quotation',
    scopeOptions: SCOPE_OPTIONS,
    deliverableCatalog: DELIVERABLE_CATALOG,
    timelineCatalog: TIMELINE_CATALOG,
    responsibilityCatalog: RESPONSIBILITY_CATALOG,
    defaultWhyUs: DEFAULT_WHY_US,
    sections: [
      { id: 'parties', title: 'Parties & contacts' },
      { id: 'event', title: 'Event details' },
      { id: 'package', title: 'Package' },
      { id: 'days', title: 'Day-wise coverage & services' },
      { id: 'deliverables', title: 'Deliverables & scope of work' },
      { id: 'timeline', title: 'Delivery timeline & process' },
      { id: 'responsibilities', title: 'Photographer responsibilities' },
      { id: 'payment', title: 'Package cost & payment' },
      { id: 'terms', title: 'Terms & special conditions' },
      { id: 'review', title: 'Review & finalize' },
    ],
    emptyDay: emptyDay(1),
  });
});

// ── Admin: list / get / create draft / update / finalize ────────────────────

adminRouter.get('/customer/:customerId', async (req, res) => {
  const customer = await prisma.customer.findFirst({
    where: { id: req.params.customerId, studioId: req.studioId },
  });
  if (!customer) return fail(res, CODES.NOT_FOUND, 'Customer not found', { status: 404 });

  const list = await prisma.weddingAgreement.findMany({
    where: { customerId: customer.id, studioId: req.studioId },
    orderBy: { updatedAt: 'desc' },
  });
  return ok(res, {
    agreements: list.map((a) => ({
      id: a.id,
      title: a.title,
      status: a.status,
      contractId: a.contractId,
      finalizedAt: a.finalizedAt,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
      hasPdf: !!a.pdfKey,
    })),
  });
});

adminRouter.post('/customer/:customerId/wedding', async (req, res) => {
  const customer = await prisma.customer.findFirst({
    where: { id: req.params.customerId, studioId: req.studioId },
    include: { package: true },
  });
  if (!customer) return fail(res, CODES.NOT_FOUND, 'Customer not found', { status: 404 });

  const form = {
    ...emptyWeddingForm(customer),
    ...(req.body?.formData && typeof req.body.formData === 'object' ? req.body.formData : {}),
  };

  const agreement = await prisma.weddingAgreement.create({
    data: {
      studioId: req.studioId,
      customerId: customer.id,
      title: req.body?.title || 'Wedding Service Agreement',
      status: 'DRAFT',
      formData: form,
    },
  });
  return ok(res, { agreement });
});

adminRouter.get('/:id', async (req, res) => {
  const agreement = await prisma.weddingAgreement.findFirst({
    where: { id: req.params.id, studioId: req.studioId },
    include: {
      customer: {
        select: {
          id: true, name: true, email: true, phone: true,
          paymentTerms: true, paymentTotalDue: true, paymentAmountPaid: true, paymentCurrency: true,
        },
      },
    },
  });
  if (!agreement) return fail(res, CODES.NOT_FOUND, 'Agreement not found', { status: 404 });

  let pdfUrl = null;
  if (agreement.pdfKey) {
    pdfUrl = await getSignedPhotoUrl(agreement.pdfKey, 900);
  }
  return ok(res, {
    agreement: {
      ...agreement,
      formData: agreement.formData || {},
      pdfUrl,
      scopeOptions: SCOPE_OPTIONS,
    },
  });
});

adminRouter.put('/:id', async (req, res) => {
  const existing = await prisma.weddingAgreement.findFirst({
    where: { id: req.params.id, studioId: req.studioId },
  });
  if (!existing) return fail(res, CODES.NOT_FOUND, 'Agreement not found', { status: 404 });

  // Reopen finalized agreements for editing (same record; re-finalize regenerates PDF).
  const reopen = req.body?.reopen === true || req.body?.reopen === 'true';
  if (existing.status === 'FINALIZED' && !reopen && !req.body?.formData && !req.body?.title) {
    return fail(res, CODES.VALIDATION, 'Finalized agreement — pass reopen:true to edit, or create a new one.', { status: 400 });
  }

  const formData = req.body?.formData && typeof req.body.formData === 'object'
    ? { ...(existing.formData || {}), ...req.body.formData }
    : existing.formData;

  const agreement = await prisma.weddingAgreement.update({
    where: { id: existing.id },
    data: {
      ...(req.body?.title && { title: String(req.body.title).slice(0, 200) }),
      formData,
      ...(reopen || (existing.status === 'FINALIZED' && req.body?.formData)
        ? { status: 'DRAFT', finalizedAt: null }
        : {}),
    },
  });
  return ok(res, { agreement });
});

adminRouter.post('/:id/finalize', async (req, res) => {
  try {
    const existing = await prisma.weddingAgreement.findFirst({
      where: { id: req.params.id, studioId: req.studioId },
      include: {
        customer: { include: { package: true } },
      },
    });
    if (!existing) return fail(res, CODES.NOT_FOUND, 'Agreement not found', { status: 404 });

    // Merge any last-minute form patches
    let form = existing.formData && typeof existing.formData === 'object' ? { ...existing.formData } : {};
    if (req.body?.formData && typeof req.body.formData === 'object') {
      form = { ...form, ...req.body.formData };
    }

    const studio = await prisma.studio.findUnique({ where: { id: req.studioId } });
    const profile = await prisma.studioProfile.findUnique({ where: { studioId: req.studioId } });
    const studioName = profile?.displayName || studio?.name || 'SJ Clicks & Films';

    // Prefill studio contact on the form when blank (shows on PDF)
    if (!form.studioName) form.studioName = studioName;
    if (!form.studioPhone) form.studioPhone = profile?.phone || '';
    if (!form.studioEmail) form.studioEmail = profile?.email || '';
    if (!form.studioAddress) form.studioAddress = profile?.address || '';
    if (!form.studioWebsite) form.studioWebsite = profile?.website || '';
    if (!form.studioSignatory) form.studioSignatory = studioName;
    if (!form.agreementDate) form.agreementDate = new Date().toISOString();

    // Compute balance if not set
    const total = numOrNull(form.totalFee);
    const paid = numOrNull(form.amountPaid) ?? 0;
    if (total != null && (form.balanceDue === '' || form.balanceDue == null)) {
      form.balanceDue = Math.max(0, total - paid);
    }

    // Prefer studio logo from profile S3, else bundled asset
    let logoBuffer = null;
    if (profile?.logoKey) {
      try {
        const { getObjectBuffer } = require('../services/s3');
        logoBuffer = await getObjectBuffer(profile.logoKey);
      } catch (_) { /* fall back to local */ }
    }
    if (!logoBuffer) {
      const localLogo = path.join(__dirname, '../../assets/logo-square.png');
      if (fs.existsSync(localLogo)) logoBuffer = fs.readFileSync(localLogo);
    }

    const pdfBuf = await buildWeddingAgreementPdf(form, {
      studioName,
      customerName: existing.customer.name,
      title: existing.title || 'Wedding Photography Quotation',
      agreementId: existing.id,
      finalizedAt: new Date().toISOString(),
      logoBuffer,
      studioPhone: profile?.phone || null,
      studioEmail: profile?.email || null,
      studioAddress: profile?.address || null,
      studioWebsite: profile?.website || null,
    });

    const key = `studios/${req.studioId}/agreements/${existing.customerId}/${existing.id}-${uuidv4()}.pdf`;
    await uploadToS3(key, pdfBuf, 'application/pdf');

    // Create Contract so customer can download / accept
    const contract = await prisma.contract.create({
      data: {
        studioId: req.studioId,
        customerId: existing.customerId,
        title: existing.title || 'Wedding Service Agreement',
        fileKey: key,
        fileSize: pdfBuf.length,
        status: 'SENT',
        source: 'WEDDING_FORM',
        formData: form,
      },
    });

    const agreement = await prisma.weddingAgreement.update({
      where: { id: existing.id },
      data: {
        status: 'FINALIZED',
        formData: form,
        pdfKey: key,
        fileSize: pdfBuf.length,
        contractId: contract.id,
        finalizedAt: new Date(),
      },
    });

    // Agreement terms describe scope; only invoice ledger entries establish
    // billed/paid balances. Finalizing an agreement must not overwrite money.
    const paymentPatch = {};
    if (form.paymentTermsText) paymentPatch.paymentTerms = String(form.paymentTermsText).slice(0, 4000);
    if (Object.keys(paymentPatch).length) {
      await prisma.customer.update({
        where: { id: existing.customerId },
        data: paymentPatch,
      });
    }

    const pdfUrl = await getSignedPhotoUrl(key, 900);
    return ok(res, {
      agreement: {
        id: agreement.id,
        status: agreement.status,
        contractId: contract.id,
        finalizedAt: agreement.finalizedAt,
        pdfUrl,
        fileSize: agreement.fileSize,
      },
      contract: { id: contract.id, title: contract.title, status: contract.status },
    });
  } catch (err) {
    return fail(res, CODES.INTERNAL, err.message, { status: 500 });
  }
});

adminRouter.post('/:id/pdf', (req, res, next) => {
  if (!['OWNER', 'MANAGER'].includes(req.admin.role)) return res.status(403).json({ error: { message: 'Manager access required' } });
  next();
}, require('../services/pdfUpload').pdfUpload, async (req, res) => {
  const existing = await prisma.weddingAgreement.findFirst({ where: { id: req.params.id, studioId: req.studioId } });
  if (!existing) return fail(res, CODES.NOT_FOUND, 'Agreement not found', { status: 404 });
  const key = `studios/${req.studioId}/agreements/${existing.customerId}/${existing.id}-${uuidv4()}.pdf`;
  await uploadToS3(key, req.file.buffer, 'application/pdf');
  try {
    const agreement = await prisma.$transaction(async (db) => {
      // Each revision creates a new client copy; previously accepted PDFs stay intact.
      const updated = await db.weddingAgreement.update({ where: { id: existing.id, updatedAt: existing.updatedAt }, data: {
        status: 'FINALIZED', pdfKey: key, fileSize: req.file.size, finalizedAt: new Date(),
      } });
      const contract = await db.contract.create({ data: {
        studioId: req.studioId, customerId: existing.customerId, title: existing.title,
        fileKey: key, fileSize: req.file.size, status: 'SENT', source: 'UPLOAD',
      } });
      return db.weddingAgreement.update({ where: { id: updated.id }, data: { contractId: contract.id } });
    });
    return ok(res, { agreement: { id: agreement.id, status: agreement.status, pdfUrl: await getSignedPhotoUrl(key, 900) } });
  } catch (e) {
    if (e.code === 'P2025') return fail(res, CODES.VALIDATION, 'Agreement changed. Refresh before uploading again.', { status: 409 });
    throw e;
  }
});

adminRouter.get('/:id/pdf', async (req, res) => {
  const agreement = await prisma.weddingAgreement.findFirst({
    where: { id: req.params.id, studioId: req.studioId },
  });
  if (!agreement?.pdfKey) return fail(res, CODES.NOT_FOUND, 'PDF not ready', { status: 404 });
  const url = await getSignedPhotoUrl(agreement.pdfKey, 900);
  return ok(res, { url, title: agreement.title });
});

// ── Customer: list agreements + download PDF ───────────────────────────────

customerRouter.get('/my', async (req, res) => {
  const [forms, contracts] = await Promise.all([
    prisma.weddingAgreement.findMany({
      where: { customerId: req.customer.id, studioId: req.customer.studioId, status: 'FINALIZED' },
      orderBy: { finalizedAt: 'desc' },
    }),
    prisma.contract.findMany({
      where: { customerId: req.customer.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, title: true, status: true, sentAt: true, viewedAt: true,
        acceptedAt: true, source: true, formData: true, fileSize: true, createdAt: true,
      },
    }),
  ]);

  return ok(res, {
    weddingAgreements: forms.map((a) => ({
      id: a.id,
      title: a.title,
      status: a.status,
      contractId: a.contractId,
      finalizedAt: a.finalizedAt,
      formData: a.formData,
    })),
    contracts,
  });
});

customerRouter.get('/my/:id/pdf', async (req, res) => {
  // Accept wedding agreement id OR contract id
  let key = null;
  let title = 'Agreement';
  const wa = await prisma.weddingAgreement.findFirst({
    where: { id: req.params.id, customerId: req.customer.id, status: 'FINALIZED' },
  });
  if (wa?.pdfKey) {
    key = wa.pdfKey;
    title = wa.title;
  } else {
    const c = await prisma.contract.findFirst({
      where: { id: req.params.id, customerId: req.customer.id },
    });
    if (c) {
      key = c.fileKey;
      title = c.title;
      if (c.status === 'SENT') {
        await prisma.contract.update({
          where: { id: c.id },
          data: { status: 'VIEWED', viewedAt: new Date() },
        });
      }
    }
  }
  if (!key) return fail(res, CODES.NOT_FOUND, 'Agreement not found', { status: 404 });
  const url = await getSignedPhotoUrl(key, 900);
  return ok(res, { url, title });
});

module.exports = { adminRouter, customerRouter };
