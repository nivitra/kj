// Runs only against the existing isolated rehearsal DB. Object storage is mocked.
if (!process.env.DATABASE_URL?.includes('/sj_release_rehearsal')) throw Error('Use a disposable rehearsal database');
Object.assign(process.env, { NODE_ENV: 'production', COGNITO_ENABLED: 'false', DISABLE_OUTBOUND_NOTIFICATIONS: 'true', JWT_SECRET: 'request-integration-only' });
require('express-async-errors');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const { prisma: db } = require('../src/config/prisma');
const stored = new Map(); let signCount = 0;
require.cache[require.resolve('../src/services/s3')] = { exports: {
  uploadToS3: async (key, buffer) => stored.set(key, buffer),
  getSignedPhotoUrl: async key => `https://private.example/${key}?signature=${++signCount}`,
  getSignedDownloadUrl: async key => `https://private.example/${key}?signature=${++signCount}`,
} };
const requests = require('../src/routes/quotationRequests');
const quotes = require('../src/routes/quotes');
const app = express(); app.use(express.json());
app.use('/quotation-requests', requests.publicRouter); app.use('/portal', requests.customerRouter);
app.use('/portal', quotes.customerRouter); app.use('/admin/quotes', quotes.adminRouter);
app.use((err, req, res, next) => res.status(500).json({ error: err.message }));
let server, studioId;
async function run() {
  const studio = await db.studio.create({ data: { name: 'Request integration', email: `request-${Date.now()}@example.invalid` } }); studioId = studio.id;
  const admin = await db.adminUser.create({ data: { studioId, name: 'Owner', email: `${studioId}@example.invalid`, passwordHash: 'disabled', role: 'OWNER' } });
  const staff = await db.adminUser.create({ data: { studioId, name: 'Staff', email: `staff-${studioId}@example.invalid`, passwordHash: 'disabled', role: 'STAFF' } });
  const client = await db.customer.create({ data: { studioId, name: 'Client', phone: '+919123456789' } });
  const otherClient = await db.customer.create({ data: { studioId, name: 'Other client' } });
  const token = (row, type) => jwt.sign({ id: row.id, ...(type ? { type } : {}) }, process.env.JWT_SECRET);
  const adminToken = token(admin), clientToken = token(client, 'customer');
  const option = await db.servicePackage.create({ data: { studioId, title: 'Coverage', price: 1000 } });
  await db.quoteAddOn.create({ data: { studioId, code: 'EXTRA_DAY', title: 'Additional coverage day', price: 100 } });
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function call(path, auth, method = 'GET', body) {
    const parsed = new URL(path, base), receiptToken = parsed.searchParams.get('token'); parsed.searchParams.delete('token');
    const r = await fetch(parsed, { method, headers: { ...(auth ? { Authorization: `Bearer ${auth}` } : {}), ...(receiptToken ? { 'X-Quotation-Token': receiptToken } : {}), ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }) }, ...(body ? { body: body instanceof FormData ? body : JSON.stringify(body) } : {}) });
    const json = await r.json(); return { status: r.status, data: json.data, error: json.error, headers: r.headers };
  }
  const input = { kind: 'WEDDING', contact: { name: 'Public visitor', phone: '9123456789', email: 'visitor@example.invalid' }, venue: { location: 'Pune hotel' }, dates: { start: '2099-12-01', end: '2099-12-03', dayCount: 3 }, services: ['candid_photographer'], crewCounts: { candid_photographer: 2 }, album: { needed: false }, budgetTier: 'UNSURE', deliverables: 'Photos and a short film' };
  assert.equal((await call(`/quotation-requests/${studioId}/catalog`)).data.studioName, studio.name);
  assert.equal((await call('/quotation-requests/missing/catalog')).status, 404);
  assert.equal((await call(`/quotation-requests/${studioId}`, null, 'POST', { ...input, dates: { ...input.dates, end: '2099-11-30' } })).status, 400);
  let r = await call(`/quotation-requests/${studioId}`, null, 'POST', input); assert.equal(r.status, 201, JSON.stringify(r));
  const leadId = r.data.inquiry.id, receipt = new URL(r.data.receiptPath, 'https://app.example');
  const receiptToken = receipt.searchParams.get('token');
  const receiptApi = `/quotation-requests/${studioId}/${leadId}`;
  assert.equal((await db.lead.findUnique({ where: { id: leadId } })).customerId, null);
  assert.equal((await call(receiptApi)).status, 403);
  assert.equal((await call(`${receiptApi}?token=${adminToken}`)).status, 403);
  assert.equal((await call(`${receiptApi}?token=${receiptToken}`)).data.quotes.length, 0);
  const opened = await Promise.all([call('/admin/quotes', adminToken, 'POST', { leadId, optionIds: [option.id] }), call('/admin/quotes', adminToken, 'POST', { leadId, optionIds: [option.id] })]);
  assert.ok(opened.every(x => x.status === 201), JSON.stringify(opened));
  const quote = opened[0].data.quote; assert.equal(quote.id, opened[1].data.quote.id); assert.notEqual(quote.customerId, client.id);
  assert.equal(await db.quote.count({ where: { leadId } }), 1);
  assert.equal(quote.formData.dayCount, 3); assert.equal(quote.formData.request.crewCounts.candid_photographer, 2);
  assert.equal(quote.pricingSnapshot.alternatives[0].subtotal, 1200);
  assert.equal((await call(`${receiptApi}?token=${receiptToken}`)).data.quotes.length, 0, 'Draft PDFs are hidden');
  await db.lead.update({ where: { id: leadId }, data: { adminNote: 'Never public' } });
  const pdfBody = () => { const form = new FormData(); form.append('file', new Blob([Buffer.from('%PDF-1.7\nQuotation test\n%%EOF')], { type: 'application/pdf' }), 'quotation.pdf'); return form; };
  assert.equal((await call(`/admin/quotes/${quote.id}/pdf`, token(staff), 'POST', pdfBody())).status, 403);
  const invalidPdf = new FormData(); invalidPdf.append('file', new Blob(['not PDF'], { type: 'application/pdf' }), 'fake.pdf');
  assert.equal((await call(`/admin/quotes/${quote.id}/pdf`, adminToken, 'POST', invalidPdf)).status, 400);
  r = await call(`/admin/quotes/${quote.id}/pdf`, adminToken, 'POST', pdfBody()); assert.equal(r.status, 200, JSON.stringify(r));
  assert.equal(r.data.quote.status, 'SENT'); assert.equal(r.data.quote.hasPdf, true);
  const stalePdf = pdfBody(); stalePdf.append('updatedAt', quote.updatedAt);
  assert.equal((await call(`/admin/quotes/${quote.id}/pdf`, adminToken, 'POST', stalePdf)).status, 409);
  assert.equal(stored.size, 1, 'Stale uploads never replace the published file');
  const published = await call(`${receiptApi}?token=${receiptToken}`); assert.equal(published.data.quotes[0].id, quote.id); assert.equal(published.headers.get('cache-control'), 'no-store');
  assert.ok(!JSON.stringify(published.data).includes('Never public')); assert.equal(published.data.inquiry.customerId, undefined);
  const pdfApi = `${receiptApi}/quotes/${quote.id}/pdf?token=${receiptToken}`;
  const pdf1 = await call(pdfApi), pdf2 = await call(pdfApi); assert.equal(pdf1.status, 200); assert.notEqual(pdf1.data.url, pdf2.data.url);
  assert.equal((await call(`/portal/quotes/${quote.id}/pdf`, clientToken)).status, 404);
  const renewed = await call(`/admin/quotes/${quote.id}/request-link`, adminToken); assert.match(renewed.data.path, /^\/l\/[A-Za-z0-9_-]{16}$/);
  const savedLink = await db.shortLink.findUnique({ where: { token: renewed.data.path.split('/').pop() } });
  assert.equal(new URL(savedLink.path, 'https://app.example').searchParams.get('requestId'), leadId);
  const corporate = await call('/portal/quotation-requests', clientToken, 'POST', { ...input, kind: 'CORPORATE', organization: 'Company', dates: { flexible: true, dayCount: 2 }, album: { needed: true, count: 2 } }); assert.equal(corporate.status, 201);
  assert.equal((await call('/portal/quotation-requests', clientToken)).data.requests[0].id, corporate.data.inquiry.id);
  assert.equal((await call('/portal/quotation-requests', token(otherClient, 'customer'))).data.requests.length, 0);
  assert.equal((await call(`/quotation-requests/${studioId}/${corporate.data.inquiry.id}?token=${receiptToken}`)).status, 403);
  assert.equal(await db.customerBooking.count({ where: { studioId } }), 0); assert.equal(await db.invoice.count({ where: { studioId } }), 0);
  console.log('PASS public request → private receipt → concurrent admin creation → scoped PDF upload/download → authenticated corporate request; no account impersonation, internal notes, invoices or bookings');
}
run().catch(e => { console.error(e); process.exitCode = 1; }).finally(async () => {
  server?.close();
  if (studioId) { await db.quote.deleteMany({ where: { studioId } }); await db.customer.deleteMany({ where: { studioId } }); await db.adminUser.deleteMany({ where: { studioId } }); await db.studio.delete({ where: { id: studioId } }); }
  await db.$disconnect();
});
