process.env.NODE_ENV = 'production';
process.env.COGNITO_ENABLED = 'false';
process.env.DISABLE_OUTBOUND_NOTIFICATIONS = 'true';
if (!process.env.DATABASE_URL?.includes('/sj_release_rehearsal')) throw Error('An isolated rehearsal database is required');
process.env.JWT_SECRET = 'isolated-sharing-testing-only';
require('express-async-errors');
const assert = require('node:assert/strict'), express = require('express'), jwt = require('jsonwebtoken');
const { prisma: db } = require('../src/config/prisma');
const stored = new Map();
require.cache[require.resolve('../src/services/s3')] = { exports: {
  uploadToS3: async (key, buffer) => stored.set(key, buffer), getSignedPhotoUrl: async key => `https://private.example/${key}?signed=1`,
} };
const quotes = require('../src/routes/quotes'), agreements = require('../src/routes/agreements');
const app = express(); app.use(express.json());
app.use('/admin/quotes', quotes.adminRouter); app.use('/portal', quotes.customerRouter);
app.use('/admin/agreements', agreements.adminRouter); app.use('/agreements', agreements.customerRouter);
app.use((e, req, res, next) => { console.error(e.message); res.status(500).json({ error: e.message }); });
let server, studioId, foreignId;
async function run() {
  const studio = await db.studio.create({ data: { name: 'Sharing test', email: `sharing-${Date.now()}@example.invalid` } }); studioId = studio.id;
  const owner = await db.adminUser.create({ data: { studioId, name: 'Owner', email: `sharing-${studioId}@example.invalid`, passwordHash: 'disabled', role: 'OWNER' } });
  const staff = await db.adminUser.create({ data: { studioId, name: 'Staff', email: `staff-${studioId}@example.invalid`, passwordHash: 'disabled', role: 'STAFF' } });
  const client = await db.customer.create({ data: { studioId, name: 'Correct Client' } });
  const other = await db.customer.create({ data: { studioId, name: 'Other Client' } });
  const quote = await db.quote.create({ data: { studioId, customerId: client.id, title: 'Uploaded quote' } });
  const agreement = await db.weddingAgreement.create({ data: { studioId, customerId: client.id, title: 'Uploaded agreement' } });
  const token = (user, type) => jwt.sign({ id: user.id, ...(type ? { type } : {}) }, process.env.JWT_SECRET, { expiresIn: '10m' });
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function upload(path, auth, content = '%PDF-1.7\nTest document\n%%EOF') {
    const body = new FormData(); body.append('file', new Blob([content], { type: 'application/pdf' }), 'document.pdf');
    return fetch(base + path, { method: 'POST', headers: auth ? { Authorization: `Bearer ${auth}` } : {}, body });
  }
  const get = (path, auth) => fetch(base + path, { headers: { Authorization: `Bearer ${auth}` } });
  const qt = `/admin/quotes/${quote.id}/pdf`, at = `/admin/agreements/${agreement.id}/pdf`;
  assert.equal((await upload(qt)).status, 401);
  assert.equal((await upload(qt, token(staff))).status, 403); assert.equal((await upload(at, token(staff))).status, 403);
  assert.equal((await upload(qt, token(owner), '<html>fake')).status, 400);
  assert.equal((await upload(qt, token(owner))).status, 200);
  const q = await db.quote.findUnique({ where: { id: quote.id } }); assert.equal(q.status, 'SENT'); assert.ok(stored.has(q.pdfKey));
  const clientQuotes = await (await get(`/portal/quotes?id=${q.id}`, token(client, 'customer'))).json();
  assert.equal(clientQuotes.data.quotes.length, 1); assert.ok(clientQuotes.data.quotes[0].pdfUrl);
  const otherQuotes = await (await get(`/portal/quotes?id=${q.id}`, token(other, 'customer'))).json(); assert.equal(otherQuotes.data.quotes.length, 0);
  await db.quote.update({ where: { id: q.id }, data: { status: 'APPROVED' } }); assert.equal((await upload(qt, token(owner))).status, 409);
  assert.equal((await upload(at, token(owner))).status, 200);
  let a = await db.weddingAgreement.findUnique({ where: { id: agreement.id } }); const firstContract = a.contractId;
  assert.equal(a.status, 'FINALIZED'); assert.ok(stored.has(a.pdfKey));
  assert.equal((await get(`/agreements/my/${a.id}/pdf`, token(client, 'customer'))).status, 200);
  assert.equal((await get(`/agreements/my/${a.id}/pdf`, token(other, 'customer'))).status, 404);
  await db.contract.update({ where: { id: firstContract }, data: { status: 'ACCEPTED' } });
  assert.equal((await upload(at, token(owner))).status, 200);
  a = await db.weddingAgreement.findUnique({ where: { id: a.id } }); assert.notEqual(a.contractId, firstContract);
  assert.equal((await db.contract.findUnique({ where: { id: firstContract } })).status, 'ACCEPTED');
  const foreign = await db.studio.create({ data: { name: 'Foreign studio', email: `foreign-${studioId}@example.invalid` } }); foreignId = foreign.id;
  await db.adminUser.update({ where: { id: staff.id }, data: { studioId: foreignId, role: 'OWNER' } });
  assert.equal((await upload(qt, token(staff))).status, 404); assert.equal((await upload(at, token(staff))).status, 404);
  await db.customer.update({ where: { id: client.id }, data: { name: 'Current greeting', phone: '+919999999999' } });
  const gallery = await db.eventGallery.create({ data: { studioId, name: 'Shared Gallery', status: 'PUBLISHED' } });
  await db.accessGrant.create({ data: { customerId: client.id, galleryId: gallery.id } });
  const { galleryNotificationRecipient } = require('../src/services/notificationRecipient');
  const recipient = await galleryNotificationRecipient(db, studioId, { customerId: client.id, galleryId: gallery.id });
  assert.equal(recipient.name, 'Current greeting'); assert.equal(recipient.galleryName, 'Shared Gallery');
  assert.equal(await galleryNotificationRecipient(db, foreignId, { customerId: client.id, galleryId: gallery.id }), null);
  console.log('PASS real database gallery recipient lookup and studio isolation');
  console.log('PASS: upload authentication, PDF validation, staff restrictions, customer visibility, exact shared quote, wrong-account denial, tenant isolation, accepted quote lock, agreement revision history');
}
run().catch(e => { console.error(e); process.exitCode = 1; }).finally(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  if (studioId) { await db.accessGrant.deleteMany({ where: { customer: { studioId } } }); await db.eventGallery.deleteMany({ where: { studioId } }); await db.quote.deleteMany({ where: { studioId } }); await db.weddingAgreement.deleteMany({ where: { studioId } }); await db.contract.deleteMany({ where: { studioId } }); await db.customer.deleteMany({ where: { studioId } }); await db.adminUser.deleteMany({ where: { studioId: { in: [studioId, foreignId].filter(Boolean) } } }); await db.studio.deleteMany({ where: { id: { in: [studioId, foreignId].filter(Boolean) } } }); }
  await db.$disconnect();
});
