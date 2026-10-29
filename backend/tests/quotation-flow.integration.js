// Disposable PostgreSQL only. S3 and outbound messaging are replaced in-process.
if (!process.env.DATABASE_URL?.includes('/sj_release_rehearsal')) throw Error('Use a disposable rehearsal database');
Object.assign(process.env, { NODE_ENV: 'production', COGNITO_ENABLED: 'false', DISABLE_OUTBOUND_NOTIFICATIONS: 'true', JWT_SECRET: 'quotation-audit-only', REKOGNITION_MODE: 'mock' });
require('express-async-errors');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const { prisma: db } = require('../src/config/prisma');
const stored = new Map();
let signCount = 0, storageFailure = false;
require.cache[require.resolve('../src/services/s3')] = { exports: {
  uploadToS3: async (key, data) => stored.set(key, data),
  getSignedPhotoUrl: async key => `https://private.example/${key}?signature=${++signCount}`,
  getSignedDownloadUrl: async key => `https://private.example/${key}?signature=${++signCount}`,
  deleteManyFromS3: async () => { if (storageFailure) throw Error('Storage unavailable'); },
  deletePrefix: async () => {},
  getObjectBuffer: async key => { if (storageFailure) throw Error('Storage temporarily unavailable'); return stored.get(key); },
  headObject: async () => ({ exists: true }),
  buildS3Key: (studioId,galleryId,type,name) => `studios/${studioId}/galleries/${galleryId}/${type}/${name}`,
} };
require.cache[require.resolve('../src/services/lock')] = { exports: { withLock: async (key, ttl, fn) => fn() } };
require.cache[require.resolve('../src/services/whatsapp')] = { exports: { triggerAuto: async () => {}, sendDocument: async () => { throw Error('Tests must not send messages'); } } };
const quotes = require('../src/routes/quotes');
const portal = require('../src/routes/portal');
const { authenticateCustomer } = require('../src/middleware/auth');
const app = express(); app.use(express.json());
app.use('/admin/quotes', quotes.adminRouter); app.use('/portal', quotes.customerRouter); app.use('/portal', portal.customerRouter);
const face = express.Router(); face.use(authenticateCustomer); face.get('/probe', (req,res) => res.json({ galleryId: req.guestGalleryId })); app.use('/face', face);
app.use((err, req, res, next) => res.status(500).json({ error: err.message }));
let server;
async function run() {
 const studio = await db.studio.create({ data: { name: 'Quotation audit', email: `quote-${Date.now()}@example.invalid` } });
 const studioId = studio.id;
 const owner = await db.adminUser.create({ data: { studioId, name: 'Owner', email: `${studioId}@example.invalid`, passwordHash: 'disabled', role: 'OWNER' } });
 const staff = await db.adminUser.create({ data: { studioId, name: 'Staff', email: `staff-${studioId}@example.invalid`, passwordHash: 'disabled', role: 'STAFF' } });
 const client = await db.customer.create({ data: { studioId, name: 'Quotation client' } });
 const other = await db.customer.create({ data: { studioId, name: 'Other client' } });
 const token = (row, type) => jwt.sign({ id: row.id, ...(type ? { type } : {}) }, process.env.JWT_SECRET, { expiresIn: '10m' });
 const adminToken = token(owner), clientToken = token(client, 'customer'), otherToken = token(other, 'customer');
 await db.studioProfile.create({ data: { studioId, taxPercent: 18 } });
 const a = await db.servicePackage.create({ data: { studioId, title: 'Essential', price: 1000.25 } });
 const b = await db.servicePackage.create({ data: { studioId, title: 'Signature', price: 2000.50 } });
 const day = await db.quoteAddOn.create({ data: { studioId, code: 'EXTRA_DAY', title: 'Extra coverage', price: 100 } });
 await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
 const base = `http://127.0.0.1:${server.address().port}`;
 async function call(path, auth, method = 'GET', body) {
  const r = await fetch(base + path, { method, headers: { ...(auth ? { Authorization: `Bearer ${auth}` } : {}), 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const json = await r.json(); return { status: r.status, data: json.data, error: json.error, headers: r.headers };
 }
 const inquiry = await call('/portal/wedding-inquiry', clientToken, 'POST', { name: 'Quotation client', phone: '9123456789', venue: { city: 'Pune' }, dates: { flexible: true, days: [{ event: 'Wedding', services: ['candid_photographer'] }] } });
 assert.equal(inquiry.status, 201, JSON.stringify(inquiry));
 assert.equal(await db.customerBooking.count({ where: { customerId: client.id } }), 0);
 let r = await call('/admin/quotes', adminToken, 'POST', { leadId: inquiry.data.inquiry.id, optionIds: [a.id, b.id], addOnIds: [day.id] });
 assert.equal(r.status, 201); let q = r.data.quote; const id = q.id;
 assert.equal(q.eventDate, null); assert.equal(q.pricingSnapshot.alternatives[0].total, 1298.30);
 assert.equal((await call(`/admin/quotes/${id}`, token(staff), 'PUT', { overview: 'bad' })).status, 403);
 const saves = await Promise.all([call(`/admin/quotes/${id}`, adminToken, 'PUT', { updatedAt: q.updatedAt, overview: 'Revision A' }), call(`/admin/quotes/${id}`, adminToken, 'PUT', { updatedAt: q.updatedAt, overview: 'Revision B' })]);
 assert.deepEqual(saves.map(x => x.status).sort(), [200,409]);
 r = await call(`/admin/quotes/${id}/finalize`, adminToken, 'POST'); assert.equal(r.status,200,JSON.stringify(r));
 q = r.data.quote; assert.equal(r.data.notification.sent, false); assert.equal(await db.invoice.count({ where: { customerId: client.id } }),0);
 const pdf = stored.get((await db.quote.findUnique({where:{id}})).pdfKey); assert.equal(pdf.subarray(0,5).toString(), '%PDF-');
 require('node:fs').writeFileSync('/tmp/sj-quotation-audit.pdf', pdf);
 const first = await call(`/portal/quotes/${id}/pdf`, clientToken); const second = await call(`/portal/quotes/${id}/pdf`, clientToken);
 assert.equal(first.status,200); assert.notEqual(first.data.url,second.data.url); assert.equal(first.headers.get('cache-control'),'no-store');
 assert.equal((await call(`/portal/quotes/${id}/pdf`,otherToken)).status,404);
 assert.equal((await call(`/portal/quotes/${id}/pdf`)).status,401);
 const oldVersion = q.updatedAt;
 r = await call(`/admin/quotes/${id}`, adminToken, 'PUT', { overview: 'Latest scope', formData: { terms: 'Optional agreed terms' }, eventDate: '2026-12-20', updatedAt: q.updatedAt }); assert.equal(r.status,200);
 assert.equal((await call(`/portal/quotes/${id}/pdf`,clientToken)).status,404);
 q = (await call(`/admin/quotes/${id}/finalize`,adminToken,'POST')).data.quote;
 assert.equal((await call(`/portal/quotes/${id}/accept`,clientToken,'POST',{optionId:a.id,updatedAt:oldVersion})).status,409);
 assert.equal((await call(`/portal/quotes/${id}/accept`,otherToken,'POST',{optionId:a.id})).status,404);
 const accepted = await Promise.all([call(`/portal/quotes/${id}/accept`,clientToken,'POST',{optionId:b.id,updatedAt:q.updatedAt}),call(`/portal/quotes/${id}/accept`,clientToken,'POST',{optionId:b.id,updatedAt:q.updatedAt})]);
 assert.ok(accepted.every(x=>x.status===200));
 const converted = await Promise.all([call(`/admin/quotes/${id}/convert`,adminToken,'POST'),call(`/admin/quotes/${id}/convert`,adminToken,'POST')]);
 assert.ok(converted.every(x=>x.status===200),JSON.stringify(converted)); assert.equal(converted[0].data.invoiceId,converted[1].data.invoiceId);
 const invoice = await db.invoice.findUnique({ where: { id: converted[0].data.invoiceId } }); assert.equal(Number(invoice.totalAmount),2478.59); assert.equal(invoice.terms,'Optional agreed terms');
 const booking = await db.customerBooking.findUnique({where:{customerId:client.id}}); assert.equal(booking.jobs.length,1);assert.equal(booking.jobs[0].requestedDate,'2026-12-20T00:00:00.000Z');assert.equal(booking.jobs[0].venue,'Pune');
 assert.equal((await db.lead.findUnique({where:{id:inquiry.data.inquiry.id}})).inquiryStatus,'APPROVED');
 assert.equal((await call(`/admin/quotes/${id}`,adminToken,'PUT',{overview:'Overwrite accepted'})).status,400);
 console.log('PASS optional inquiry → alternatives/extras/tax → PDF → fresh private links → stale acceptance rejection → concurrent acceptance/conversion → one invoice and dated job');
 const single=await db.quote.create({data:{studioId,customerId:client.id,status:'SENT',pricingSnapshot:require('../src/services/billing/quotePricing').calculateQuote({options:[{id:a.id,title:'A',price:10}],addOns:[]},{optionIds:[a.id]})}});
 assert.equal((await call(`/portal/quotes/${single.id}/accept`,clientToken,'POST',{optionId:'not-the-offered-option'})).status,400);
 console.log('PASS explicit invalid single-option acceptance rejected');
 const mediaGallery=await db.eventGallery.create({data:{studioId,name:'Image pipeline',watermarkEnabled:false}});
 const original=await require('sharp')({create:{width:80,height:40,channels:3,background:'red'}}).jpeg().withMetadata({orientation:6}).toBuffer();
 const media=await db.photo.create({data:{galleryId:mediaGallery.id,originalKey:`test/${mediaGallery.id}/originals/a.jpg`,filename:'a.jpg',fileSize:original.length,mimeType:'image/jpeg'}});
 stored.set(media.originalKey,original);
 const {processPhoto}=require('../src/services/imageProcessor');
 storageFailure=true;await assert.rejects(processPhoto(media.id));storageFailure=false;
 assert.equal((await db.photo.findUnique({where:{id:media.id}})).ingestionStatus,'FAILED');
 await processPhoto(media.id);const processed=await db.photo.findUnique({where:{id:media.id}});
 assert.equal(processed.width,40);assert.equal(processed.height,80);assert.equal(processed.processingStatus,'COMPLETE');assert.deepEqual(stored.get(media.originalKey),original);
 const duplicate=await db.photo.create({data:{galleryId:mediaGallery.id,originalKey:`test/${mediaGallery.id}/originals/b.jpg`,filename:'b.jpg',fileSize:original.length,mimeType:'image/jpeg'}});stored.set(duplicate.originalKey,original);
 assert.equal((await processPhoto(duplicate.id)).duplicate,true);
 const dup=await db.photo.findUnique({where:{id:duplicate.id}});assert.equal(dup.previewKey,processed.previewKey);assert.equal(dup.sha256,null);
 assert.equal((await processPhoto(media.id)).skipped,true);
 console.log('PASS image processing retries storage failure, EXIF dimensions, original preservation, duplicate upload and replay');
 const gallery=await db.eventGallery.create({data:{studioId,name:'Recycle test',status:'PUBLISHED'}});
 const link=await db.galleryShareLink.create({data:{studioId,galleryId:gallery.id,token:`audit-${gallery.id}`}});
 await db.galleryGuest.create({data:{studioId,galleryId:gallery.id,shareLinkId:link.id,customerId:other.id,name:'Guest',phone:'test',sessionToken:gallery.id}});
 const guestToken=jwt.sign({id:other.id,type:'customer',guest:true,galleryId:gallery.id},process.env.JWT_SECRET,{expiresIn:'10m'});
 assert.equal((await call('/portal/quotes',guestToken)).status,403);
 assert.equal((await call('/face/probe',guestToken)).status,200);
 await db.galleryShareLink.update({where:{id:link.id},data:{active:false}});
 assert.equal((await call('/face/probe',guestToken)).status,403);
 console.log('PASS guest token isolation and revoked share rejection');
 const {hardPurgeGallery}=require('../src/services/galleryTrash');
 assert.equal((await hardPurgeGallery(gallery.id,studioId)).skipped,true);
 await db.eventGallery.update({where:{id:gallery.id},data:{deletedAt:new Date(),purgeAt:new Date()}});
 await db.accessGrant.create({data:{galleryId:gallery.id,customerId:client.id}});
 const photo=await db.photo.create({data:{galleryId:gallery.id,filename:'test.jpg',originalKey:`test/${gallery.id}/originals/test.jpg`,fileSize:1,mimeType:'image/jpeg'}});
 await db.selection.create({data:{galleryId:gallery.id,customerId:client.id,items:{create:[{photoId:photo.id}]}}});
 const contract=await db.contract.create({data:{studioId,customerId:client.id,galleryId:gallery.id,title:'Retained contract',fileKey:'test.pdf',fileSize:1}});
 storageFailure=true;await assert.rejects(hardPurgeGallery(gallery.id,studioId));assert.ok(await db.eventGallery.findUnique({where:{id:gallery.id}}));storageFailure=false;
 const purges=await Promise.all([hardPurgeGallery(gallery.id,studioId),hardPurgeGallery(gallery.id,studioId)]);assert.equal(purges.filter(x=>x.skipped).length,1);
 assert.equal((await db.contract.findUnique({where:{id:contract.id}})).galleryId,null);
 assert.equal(await db.invoice.count({where:{customerId:client.id}}),1);
 const archive=await db.auditLog.findFirst({where:{entityId:gallery.id,action:'GALLERY_SELECTIONS_ARCHIVED'}});assert.equal(archive.details.selections[0].items.length,1);
 console.log('PASS recycle cleanup retries safely, concurrent sweeps, preserved contracts/invoices/selection audit');
}
run().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{if(server)await new Promise(resolve=>server.close(resolve));await db.$disconnect();});
