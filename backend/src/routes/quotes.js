const express = require('express');
const { prisma } = require('../config/prisma');
const { authenticateAdmin, authenticateCustomer } = require('../middleware/auth');
const { ok, fail } = require('../lib/envelope');
const { CODES } = require('../lib/errors');
const { uploadToS3, getSignedPhotoUrl, getSignedDownloadUrl } = require('../services/s3');
const { computeQuote, ensureCatalog } = require('../services/billing/quotePricing');
const { buildQuotationPdf } = require('../services/quotationPdf');
const { v4: uuidv4 } = require('uuid');

const adminRouter = express.Router();
adminRouter.use(authenticateAdmin);
adminRouter.use((req, res, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !['OWNER', 'MANAGER'].includes(req.admin.role)) return res.status(403).json({ error: 'Manager access required' });
  next();
});
const customerRouter = express.Router();

function mapQuote(q, extra = {}) {
  if (!q) return null;
  return {
    id: q.id,
    status: q.status,
    title: q.title,
    eventType: q.eventType,
    clientName: q.clientName,
    eventDate: q.eventDate,
    venue: q.venue,
    overview: q.overview,
    formData: q.formData,
    pricingSnapshot: q.pricingSnapshot,
    leadId: q.leadId,
    customerId: q.customerId,
    agreementId: q.agreementId,
    sentAt: q.sentAt,
    convertedAt: q.convertedAt,
    createdAt: q.createdAt,
    updatedAt: q.updatedAt,
    fileSize: q.fileSize,
    hasPdf: !!q.pdfKey,
    ...extra,
  };
}

adminRouter.get('/catalog', async (req, res) => {
  try {
    const catalog = await ensureCatalog(req.studioId);
    return ok(res, catalog);
  } catch (e) {
    return fail(res, CODES.INTERNAL, e.message, { status: 500 });
  }
});

adminRouter.get('/addons', async (req,res)=>ok(res,{addOns:await prisma.quoteAddOn.findMany({where:{studioId:req.studioId},orderBy:{displayOrder:'asc'}})}));
adminRouter.post('/addons', async (req,res)=>{
  const b=req.body||{};
  if(!/^[A-Z0-9_]{1,60}$/.test(b.code||'')||!String(b.title||'').trim()||!Number.isFinite(Number(b.price))||Number(b.price)<0)return fail(res,CODES.VALIDATION,'Enter a title, unique code and non-negative price',{status:400});
  const data={code:b.code,title:String(b.title).slice(0,160),price:Number(b.price),active:b.active!==false,displayOrder:Math.trunc(Number(b.displayOrder)||0),specsJson:Array.isArray(b.specs)?b.specs.map(x=>String(x).slice(0,500)).slice(0,50):[]};
  if(b.id){const existing=await prisma.quoteAddOn.findFirst({where:{id:b.id,studioId:req.studioId}});if(!existing)return fail(res,CODES.NOT_FOUND,'Add-on not found',{status:404});return ok(res,{addOn:await prisma.quoteAddOn.update({where:{id:b.id},data})});}
  const duplicate=await prisma.quoteAddOn.findUnique({where:{studioId_code:{studioId:req.studioId,code:data.code}}});
  if(duplicate)return fail(res,CODES.VALIDATION,'That code already exists; edit its existing add-on',{status:409});
  return ok(res,{addOn:await prisma.quoteAddOn.create({data:{studioId:req.studioId,...data}})},201);
});

adminRouter.post('/preview', async (req, res) => {
  try {
    const snap = await computeQuote({
      studioId: req.studioId,
      optionIds: req.body?.optionIds,
      addOnIds: req.body?.addOnIds,
      extraDays: req.body?.extraDays,
      albumNeeded: req.body?.albumNeeded,
    });
    return ok(res, { pricing: snap });
  } catch (e) {
    return fail(res, CODES.INTERNAL, e.message, { status: 500 });
  }
});

adminRouter.get('/', async (req, res) => {
  const where = { studioId: req.studioId };
  if (req.query.customerId) where.customerId = String(req.query.customerId);
  if (req.query.leadId) where.leadId = String(req.query.leadId);
  const page = Math.max(1, parseInt(req.query.page, 10) || 1), pageSize = 30;
  const [quotes, total] = await Promise.all([prisma.quote.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
    skip: (page - 1) * pageSize, take: pageSize,
  }), prisma.quote.count({ where })]);
  return ok(res, { quotes: quotes.map((q) => mapQuote(q)), page, pageSize, total });
});

adminRouter.post('/', async (req, res) => {
  try {
    const leadId = req.body?.leadId || null;
    let customerId = req.body?.customerId || null;
    let lead = null;
    if (leadId) {
      lead = await prisma.lead.findFirst({
        where: { id: leadId, studioId: req.studioId },
      });
      if (!lead) return fail(res, CODES.NOT_FOUND, 'Inquiry not found', { status: 404 });
      customerId = lead.customerId || customerId;
      // Resume the existing quotation when the request is opened again.
      const current = await prisma.quote.findFirst({ where: { studioId: req.studioId, leadId }, orderBy: { createdAt: 'desc' } });
      if (current) return ok(res, { quote: mapQuote(current) });
      if (!customerId) {
        // Keep unverified public contact details on the lead. This placeholder
        // must not claim an existing account or block the visitor's registration.
        const attached = await prisma.$transaction(async db => {
          await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lead.id}))`;
          const fresh = await db.lead.findUnique({ where: { id: lead.id } });
          if (fresh.customerId) return fresh.customerId;
          const customer = await db.customer.create({ data: { studioId: req.studioId, name: lead.name || 'Quotation client', notes: 'Client record for a public quotation request. Contact details are on the request.' } });
          await db.lead.update({ where: { id: lead.id }, data: { customerId: customer.id } });
          return customer.id;
        });
        customerId = attached;
      }
    }
    if (!customerId) return fail(res, CODES.VALIDATION, 'customerId or leadId required', { status: 400 });

    const customer = await prisma.customer.findFirst({
      where: { id: customerId, studioId: req.studioId },
    });
    if (!customer) return fail(res, CODES.NOT_FOUND, 'Client not found', { status: 404 });

    const form = lead?.formData && typeof lead.formData === 'object' ? lead.formData : {};
    const albumNeeded = form.album?.needed === true;
    const dayCount = Number(form.dates?.dayCount) || form.dates?.days?.length || 1;
    const extraDays = Math.max(0, dayCount - 1);
    const optionIds = req.body?.optionIds || [];
    const snap = await computeQuote({
      studioId: req.studioId,
      optionIds,
      addOnIds: req.body?.addOnIds,
      extraDays,
      albumNeeded,
    });

    const firstDate = form.dates?.flexible ? null : form.dates?.days?.[0]?.date || form.dates?.start || lead?.requestedDate || (!lead ? customer.weddingDate : null);
    const quoteData = {
        studioId: req.studioId,
        customerId,
        leadId: lead?.id || null,
        title: req.body?.title || `${form.kind === 'WEDDING' || req.body?.eventType === 'WEDDING' ? 'Wedding' : form.kind === 'CORPORATE' || req.body?.eventType === 'CORPORATE' ? 'Corporate' : 'Event'} quotation`,
        eventType: req.body?.eventType || form.kind || 'OTHER',
        clientName: lead?.name || customer.name,
        eventDate: firstDate ? new Date(firstDate) : null,
        venue: [form.venue?.location, form.venue?.city].filter(Boolean).join(', ')
          || customer.weddingVenue || null,
        overview: req.body?.overview || null,
        formData: {
          request: form,
          dayCount,
          days: form.dates?.days || [],
          album: form.album || null,
          optionIds,
          addOnIds: req.body?.addOnIds || (snap.lines || []).filter(l => l.kind === 'ADDON').map(l => l.id),
        },
        pricingSnapshot: snap,
        status: 'DRAFT',
    };

    const quote = lead ? await prisma.$transaction(async db => {
      await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lead.id}))`;
      const current = await db.quote.findFirst({ where: { studioId: req.studioId, leadId: lead.id }, orderBy: { createdAt: 'desc' } });
      return current || db.quote.create({ data: quoteData });
    }) : await prisma.quote.create({ data: quoteData });
    if (lead) await prisma.lead.updateMany({ where: { id: lead.id, studioId: req.studioId, inquiryStatus: 'PENDING' }, data: { inquiryStatus: 'IN_REVIEW', status: 'CONTACTED' } });
    return ok(res, { quote: mapQuote(quote) }, 201);
  } catch (e) {
    return fail(res, CODES.INTERNAL, e.message, { status: 500 });
  }
});

adminRouter.get('/:id/request-link', async (req, res) => {
  const quote = await prisma.quote.findFirst({ where: { id: req.params.id, studioId: req.studioId }, include: { lead: true } });
  if (!quote?.lead) return fail(res, CODES.NOT_FOUND, 'This quotation has no request', { status: 404 });
  return ok(res, await require('./quotationRequests').receiptLink(quote.lead));
});

adminRouter.get('/:id', async (req, res) => {
  const quote = await prisma.quote.findFirst({
    where: { id: req.params.id, studioId: req.studioId },
  });
  if (!quote) return fail(res, CODES.NOT_FOUND, 'Quote not found', { status: 404 });
  let pdfUrl = null;
  if (quote.pdfKey) {
    try { pdfUrl = await getSignedPhotoUrl(quote.pdfKey, 900); } catch (_) { /* */ }
  }
  return ok(res, { quote: mapQuote(quote, { pdfUrl }) });
});

adminRouter.put('/:id', async (req, res) => {
  try {
    const existing = await prisma.quote.findFirst({
      where: { id: req.params.id, studioId: req.studioId },
    });
    if (!existing) return fail(res, CODES.NOT_FOUND, 'Quote not found', { status: 404 });
    if (req.body?.updatedAt && new Date(req.body.updatedAt).getTime() !== existing.updatedAt.getTime()) {
      return fail(res, CODES.VALIDATION, 'Quotation changed. Refresh before saving again.', { status: 409 });
    }
    if (['CONVERTED', 'APPROVED'].includes(existing.status)) {
      return fail(res, CODES.VALIDATION, 'Converted quotes cannot be edited', { status: 400 });
    }
    const formData = { ...(existing.formData || {}), ...(req.body?.formData || {}) };
    if (req.body?.optionIds) formData.optionIds = req.body.optionIds;
    if (req.body?.addOnIds) formData.addOnIds = req.body.addOnIds;
    const days = Array.isArray(formData.days) ? formData.days : [];
    const snap = await computeQuote({
      studioId: req.studioId,
      optionIds: formData.optionIds,
      addOnIds: formData.addOnIds,
      extraDays: Math.max(0, (Number(formData.dayCount) || days.length || 1) - 1),
      albumNeeded: formData.album?.needed === true,
    });
    const quote = await prisma.quote.update({
      where: { id: existing.id, status: { in: ['DRAFT', 'SENT'] }, updatedAt: existing.updatedAt },
      data: {
        status: 'DRAFT',
        pdfKey: null,
        fileSize: null,
        title: req.body?.title ?? existing.title,
        eventType: req.body?.eventType ?? existing.eventType,
        clientName: req.body?.clientName ?? existing.clientName,
        eventDate: req.body?.eventDate === null || req.body?.eventDate === '' ? null : req.body?.eventDate ? new Date(req.body.eventDate) : existing.eventDate,
        venue: req.body?.venue ?? existing.venue,
        overview: req.body?.overview ?? existing.overview,
        formData,
        pricingSnapshot: snap,
      },
    });
    return ok(res, { quote: mapQuote(quote) });
  } catch (e) {
    if (e.code === 'P2025') return fail(res, CODES.VALIDATION, 'Quotation changed. Refresh and review it again.', { status: 409 });
    return fail(res, CODES.INTERNAL, e.message, { status: 500 });
  }
});

adminRouter.post('/:id/finalize', async (req, res) => {
  try {
    const existing = await prisma.quote.findFirst({
      where: { id: req.params.id, studioId: req.studioId },
      include: { customer: true },
    });
    if (!existing) return fail(res, CODES.NOT_FOUND, 'Quote not found', { status: 404 });

    if (!(existing.pricingSnapshot?.options || []).length) return fail(res, CODES.VALIDATION, 'Choose and price at least one package before sending', { status: 400 });
    if (!['DRAFT', 'SENT'].includes(existing.status)) return fail(res, CODES.VALIDATION, 'This quote is already accepted or closed', { status: 409 });
    const profile = await prisma.studioProfile.findUnique({ where: { studioId: req.studioId } });
    const studio = await prisma.studio.findUnique({ where: { id: req.studioId } });
    const pdfBuf = await buildQuotationPdf(existing, {
      studioName: profile?.displayName || studio?.name || 'SJ Clicks & Films',
      phone: profile?.phone || profile?.whatsapp || studio?.phone,
      email: profile?.email || studio?.email,
    });
    const key = `studios/${req.studioId}/quotes/${existing.customerId}/${existing.id}-${uuidv4()}.pdf`;
    await uploadToS3(key, pdfBuf, 'application/pdf');
    const quote = await prisma.quote.update({
      where: { id: existing.id, status: { in: ['DRAFT', 'SENT'] }, updatedAt: existing.updatedAt },
      data: {
        status: 'SENT',
        pdfKey: key,
        fileSize: pdfBuf.length,
        sentAt: new Date(),
      },
    });

    let notification = { sent: false, reason: 'no-phone' };
    try {
      const { sendDocument } = require('../services/whatsapp');
      if (process.env.DISABLE_OUTBOUND_NOTIFICATIONS !== 'true' && existing.customer?.phone && typeof sendDocument === 'function') {
        const result = await sendDocument({
          studioId: req.studioId,
          phone: existing.customer.phone,
          buffer: pdfBuf,
          mimetype: 'application/pdf',
          fileName: `${quote.title || 'quotation'}.pdf`,
          caption: `Your quotation from ${profile?.displayName || studio?.name || 'the studio'}`,
        });
        notification = { sent: result?.status === 'SENT', reason: result?.status === 'SENT' ? null : 'delivery-failed' };
      }
    } catch (_) { notification = { sent: false, reason: 'delivery-failed' }; }

    const pdfUrl = await getSignedPhotoUrl(key, 900);
    return ok(res, {
      notification,
      quote: mapQuote(quote, {
        pdfUrl,
        invoiceId: null,
        invoiceNumber: null,
      }),
    });
  } catch (e) {
    if (e.code === 'P2025') return fail(res, CODES.VALIDATION, 'Quotation changed. Refresh and review it again.', { status: 409 });
    return fail(res, CODES.INTERNAL, e.message, { status: 500 });
  }
});

adminRouter.post('/:id/pdf', require('../services/pdfUpload').pdfUpload, async (req, res) => {
  const existing = await prisma.quote.findFirst({ where: { id: req.params.id, studioId: req.studioId } });
  if (!existing) return fail(res, CODES.NOT_FOUND, 'Quotation not found', { status: 404 });
  if (!['DRAFT', 'SENT'].includes(existing.status)) return fail(res, CODES.VALIDATION, 'Accepted quotations cannot be replaced', { status: 409 });
  if (req.body?.updatedAt && new Date(req.body.updatedAt).getTime() !== existing.updatedAt.getTime()) return fail(res, CODES.VALIDATION, 'Quotation changed. Refresh before uploading again.', { status: 409 });
  const key = `studios/${req.studioId}/quotes/${existing.customerId}/${existing.id}-${uuidv4()}.pdf`;
  await uploadToS3(key, req.file.buffer, 'application/pdf');
  try {
    const quote = await prisma.quote.update({
      where: { id: existing.id, updatedAt: existing.updatedAt, status: { in: ['DRAFT', 'SENT'] } },
      data: { pdfKey: key, fileSize: req.file.size, status: 'SENT', sentAt: new Date() },
    });
    return ok(res, { quote: mapQuote(quote) });
  } catch (e) {
    if (e.code === 'P2025') return fail(res, CODES.VALIDATION, 'Quotation changed. Refresh before uploading again.', { status: 409 });
    throw e;
  }
});

adminRouter.get('/:id/pdf', async (req, res) => {
  const quote = await prisma.quote.findFirst({
    where: { id: req.params.id, studioId: req.studioId },
  });
  if (!quote?.pdfKey) return fail(res, CODES.NOT_FOUND, 'PDF not generated yet', { status: 404 });
  const url = await getSignedPhotoUrl(quote.pdfKey, 900);
  return ok(res, { url, filename: `${quote.title || 'quotation'}.pdf` });
});

adminRouter.post('/:id/accept', async (req, res) => {
  try {
    const { acceptQuote } = require('../services/billing/quoteLifecycle');
    const quote = await acceptQuote({ studioId: req.studioId, quoteId: req.params.id, optionId: req.body.optionId, actor: req.admin.id, note: req.body.note, updatedAt: req.body.updatedAt });
    return ok(res, { quote: mapQuote(quote) });
  } catch (e) { return fail(res, CODES.VALIDATION, e.message, { status: e.status || 400 }); }
});
adminRouter.post('/:id/convert', async (req, res) => {
  try {
    const { convertQuote } = require('../services/billing/quoteLifecycle');
    return ok(res, await convertQuote({ studioId: req.studioId, quoteId: req.params.id, admin: req.admin }));
  } catch (e) { return fail(res, CODES.VALIDATION, e.message, { status: e.status || 400 }); }
});
customerRouter.post('/quotes/:id/accept', authenticateCustomer, async (req, res) => {
  try {
    const { acceptQuote } = require('../services/billing/quoteLifecycle');
    const quote = await acceptQuote({ studioId: req.customer.studioId, customerId: req.customer.id, quoteId: req.params.id, optionId: req.body.optionId, actor: req.customer.id, updatedAt: req.body.updatedAt });
    return ok(res, { quote: mapQuote(quote) });
  } catch (e) { return fail(res, CODES.VALIDATION, e.message, { status: e.status || 400 }); }
});

customerRouter.get('/quotes/:id/pdf', authenticateCustomer, async (req, res) => {
  const quote = await prisma.quote.findFirst({ where: {
    id: req.params.id, customerId: req.customer.id, studioId: req.customer.studioId,
    status: { in: ['SENT', 'APPROVED', 'CONVERTED'] },
  } });
  if (!quote?.pdfKey) return fail(res, CODES.NOT_FOUND, 'Quotation PDF is unavailable. Refresh or contact the studio.', { status: 404 });
  res.set('Cache-Control', 'no-store');
  const url = await getSignedDownloadUrl(quote.pdfKey, 900, { contentType: 'application/pdf' });
  return ok(res, { url });
});

customerRouter.get('/quotes', authenticateCustomer, async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1), pageSize = 20;
  const where = {
      customerId: req.customer.id,
      studioId: req.customer.studioId,
      status: { in: ['SENT', 'APPROVED', 'CONVERTED'] },
      ...(req.query.id ? { id: String(req.query.id) } : {}),
    };
  const [quotes, total] = await Promise.all([prisma.quote.findMany({
    where,
    orderBy: { sentAt: 'desc' },
    skip: (page - 1) * pageSize, take: pageSize,
  }), prisma.quote.count({ where })]);
  const mapped = await Promise.all(quotes.map(async (q) => {
    let pdfUrl = null;
    if (q.pdfKey) {
      try { pdfUrl = await getSignedPhotoUrl(q.pdfKey, 900); } catch (_) { /* */ }
    }
    return {
      id: q.id,
      title: q.title,
      status: q.status,
      eventDate: q.eventDate,
      total: q.pricingSnapshot?.total ?? null,
      pricingSnapshot: q.pricingSnapshot,
      currency: q.pricingSnapshot?.currency || 'INR',
      sentAt: q.sentAt,
      updatedAt: q.updatedAt,
      hasPdf: !!q.pdfKey,
      pdfUrl,
      agreementId: q.agreementId,
    };
  }));
  res.set('Cache-Control', 'no-store');
  return ok(res, { quotes: mapped, page, pageSize, total });
});

module.exports = { adminRouter, customerRouter };
