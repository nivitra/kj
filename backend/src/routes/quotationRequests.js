const express = require('express');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const { prisma } = require('../config/prisma');
const { authenticateCustomer } = require('../middleware/auth');
const { getCatalog } = require('../services/inquiryCatalog');
const { normalizeRequest, leadData } = require('../services/quotationRequest');
const { serializeInquiry } = require('../services/weddingInquiry');
const { getSignedDownloadUrl } = require('../services/s3');
const { ok, fail } = require('../lib/envelope');
const { CODES } = require('../lib/errors');

const publicRouter = express.Router();
const customerRouter = express.Router();
const visibleStatuses = ['SENT', 'APPROVED', 'CONVERTED'];
const makeReceiptToken = lead => jwt.sign({ purpose: 'quotation-receipt', studioId: lead.studioId, leadId: lead.id }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '365d' });
function receiptPath(lead) {
  return `/quotation-request?${new URLSearchParams({ studioId: lead.studioId, requestId: lead.id, token: makeReceiptToken(lead) })}`;
}
async function receiptLink(lead) {
  const path = receiptPath(lead);
  const exp = jwt.decode(new URL(path, 'https://local.invalid').searchParams.get('token')).exp;
  return require('../services/shortLinks').createShortLink({ studioId: lead.studioId, path, key: `quotation-receipt:${lead.id}`, expiresAt: new Date(exp * 1000) });
}
function publicInquiry(lead) {
  const inquiry = serializeInquiry(lead);
  // Public receipts never expose staff notes, account identifiers, or internal decisions.
  return { id: inquiry.id, shortId: inquiry.shortId, name: inquiry.name, inquiryKind: inquiry.inquiryKind, inquiryStatus: inquiry.inquiryStatus, createdAt: inquiry.createdAt, form: inquiry.form, venueLabel: inquiry.venueLabel, datesLabel: inquiry.datesLabel, servicesLabel: inquiry.servicesLabel };
}
function publicQuote(q) {
  return { id: q.id, title: q.title, status: q.status, hasPdf: !!q.pdfKey, sentAt: q.sentAt, updatedAt: q.updatedAt };
}
publicRouter.use((req, res, next) => { res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }); next(); });
publicRouter.get('/:studioId/catalog', async (req, res) => {
  const studio = await prisma.studio.findUnique({ where: { id: req.params.studioId }, select: { name: true, profile: { select: { displayName: true } } } });
  if (!studio) return fail(res, CODES.NOT_FOUND, 'This request link is unavailable', { status: 404 });
  return ok(res, { ...await getCatalog(req.params.studioId), studioName: studio.profile?.displayName || studio.name });
});
publicRouter.post('/:studioId', rateLimit({ windowMs: 60 * 60 * 1000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: { message: 'Too many requests. Please try again later.' } } }), async (req, res) => {
  const studio = await prisma.studio.findUnique({ where: { id: req.params.studioId }, select: { id: true } });
  if (!studio) return fail(res, CODES.NOT_FOUND, 'This request link is unavailable', { status: 404 });
  let form;
  try { form = normalizeRequest(req.body || {}, await getCatalog(studio.id)); }
  catch (e) { if (e.status === 400) return fail(res, CODES.VALIDATION, e.message, { status: 400 }); throw e; }
  // A public form is an inquiry, never proof of ownership of an existing account.
  const lead = await prisma.lead.create({ data: leadData(studio.id, form) });
  const shortReceipt = await receiptLink(lead);
  return ok(res, { inquiry: publicInquiry(lead), receiptPath: receiptPath(lead), receiptSharePath: shortReceipt.path.replace('/l/', '/r/') }, 201);
});
publicRouter.use('/:studioId/:requestId', (req, res, next) => {
  try {
    const token = jwt.verify(String(req.get('X-Quotation-Token') || ''), process.env.JWT_SECRET, { algorithms: ['HS256'] });
    if (token.purpose !== 'quotation-receipt' || token.studioId !== req.params.studioId || token.leadId !== req.params.requestId) throw new Error('Wrong scope');
    next();
  } catch (_) { return fail(res, CODES.FORBIDDEN, 'This private request link is invalid or expired. Contact the studio for a new link.', { status: 403 }); }
});
publicRouter.post('/:studioId/:requestId/share-link', async (req, res) => {
  const lead = await prisma.lead.findFirst({ where: { id: req.params.requestId, studioId: req.params.studioId } });
  if (!lead) return fail(res, CODES.NOT_FOUND, 'Request not found', { status: 404 });
  return ok(res, await receiptLink(lead));
});
publicRouter.get('/:studioId/:requestId', async (req, res) => {
  const lead = await prisma.lead.findFirst({ where: { id: req.params.requestId, studioId: req.params.studioId }, include: { quotes: { where: { status: { in: visibleStatuses } }, orderBy: { sentAt: 'desc' } } } });
  if (!lead) return fail(res, CODES.NOT_FOUND, 'Request not found', { status: 404 });
  return ok(res, { inquiry: publicInquiry(lead), quotes: lead.quotes.map(publicQuote) });
});
publicRouter.get('/:studioId/:requestId/quotes/:quoteId/pdf', async (req, res) => {
  const quote = await prisma.quote.findFirst({ where: { id: req.params.quoteId, studioId: req.params.studioId, leadId: req.params.requestId, status: { in: visibleStatuses } } });
  if (!quote?.pdfKey) return fail(res, CODES.NOT_FOUND, 'Quotation PDF is unavailable. Refresh or contact the studio.', { status: 404 });
  return ok(res, { url: await getSignedDownloadUrl(quote.pdfKey, 900, { contentType: 'application/pdf' }) });
});
customerRouter.use(authenticateCustomer);
customerRouter.get('/quotation-requests/catalog', async (req, res) => ok(res, await getCatalog(req.customer.studioId)));
customerRouter.post('/quotation-requests', async (req, res) => {
  let form;
  try { form = normalizeRequest(req.body || {}, await getCatalog(req.customer.studioId), req.customer); }
  catch (e) { if (e.status === 400) return fail(res, CODES.VALIDATION, e.message, { status: 400 }); throw e; }
  const lead = await prisma.lead.create({ data: leadData(req.customer.studioId, form, req.customer.id) });
  return ok(res, { inquiry: publicInquiry(lead) }, 201);
});
customerRouter.get('/quotation-requests', async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1), pageSize = 20;
  const where = { customerId: req.customer.id, studioId: req.customer.studioId, OR: [{ source: 'QUOTATION_REQUEST' }, { inquiryKind: { not: 'GENERAL' } }] };
  const [requests, total] = await Promise.all([
    prisma.lead.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: { createdAt: 'desc' }, include: { quotes: { where: { status: { in: visibleStatuses } }, select: { id: true, title: true, status: true, pdfKey: true, sentAt: true, updatedAt: true } } } }),
    prisma.lead.count({ where }),
  ]);
  res.set('Cache-Control', 'no-store');
  return ok(res, { requests: requests.map(lead => ({ ...publicInquiry(lead), quotes: lead.quotes.map(publicQuote) })), page, pageSize, total });
});
module.exports = { publicRouter, customerRouter, receiptPath, receiptLink };
