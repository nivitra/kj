// Real PostgreSQL and real Express routes, with external side effects disabled.
if (!process.env.DATABASE_URL?.includes('/sj_release_rehearsal')) throw Error('Use an isolated rehearsal database');
process.env.NODE_ENV = 'production';
process.env.COGNITO_ENABLED = 'false';
process.env.DISABLE_OUTBOUND_NOTIFICATIONS = 'true';
process.env.REKOGNITION_MODE = 'mock';
process.env.JWT_SECRET = 'booking-gallery-isolated-tests-only';
require('express-async-errors');
const assert = require('node:assert/strict');
const express = require('express'), jwt = require('jsonwebtoken'), bcrypt = require('bcryptjs');
const { prisma: db } = require('../src/config/prisma');
const redis = new Map();
require.cache[require.resolve('../src/services/jobs')] = { exports: { enqueueFaceDelete: async () => { throw Error('No queue side effects in regression'); } } };
require.cache[require.resolve('../src/config/redis')] = { exports: { getRedis: () => ({
  get: async k => redis.get(k), set: async (k, v) => redis.set(k, v), del: async k => redis.delete(k),
}), connectionOptions: {} } };
require.cache[require.resolve('../src/services/whatsapp')] = { exports: {
  triggerAuto: async () => {}, notifyShootSchedule: async () => {},
  clientGalleryAppUrl: async id => `https://app.example/gallery/${id}`,
} };
require.cache[require.resolve('../src/services/s3')] = { exports: {
  getSignedPhotoUrl: async key => `https://private.example/${key}?signed=1`,
  signOriginalDownload: async p => `https://private.example/${p.originalKey}?original=1`,
  headObject: async () => ({ exists: false }), uploadToS3: async () => { throw Error('No real uploads in regression'); },
} };
for (const modulePath of ['../src/config/redis', '../src/services/whatsapp', '../src/services/s3', '../src/services/jobs']) require.cache[require.resolve(modulePath)].loaded = true;
const app = express(); app.use(express.json());
const portal = require('../src/routes/portal');
app.use('/portal', portal.customerRouter); app.use('/admin/portal', portal.adminRouter);
app.use('/admin', require('../src/routes/admin')); app.use('/galleries', require('../src/routes/gallery'));
app.use('/auth', require('../src/routes/auth')); app.use('/selection', require('../src/routes/selection'));
app.use('/photos', require('../src/routes/photo'));
app.use('/face', require('../src/routes/face'));
app.use('/share', require('../src/routes/share').router);
app.use((e, req, res, next) => { console.error(e.message); res.status(500).json({ error: e.message }); });
let server;
async function run() {
  const stamp = `${Date.now()}`;
  const nationalPhone = '9' + stamp.slice(-9), phone = '91' + nationalPhone;
  const studio = await db.studio.create({ data: { name: 'Booking gallery regression', email: `booking-${stamp}@example.invalid` } });
  const foreign = await db.studio.create({ data: { name: 'Other studio', email: `foreign-${stamp}@example.invalid` } });
  const studioId = studio.id;
  const owner = await db.adminUser.create({ data: { studioId, name: 'Owner', email: `owner-${stamp}@example.invalid`, passwordHash: 'disabled', role: 'OWNER' } });
  const foreignOwner = await db.adminUser.create({ data: { studioId: foreign.id, name: 'Foreign owner', email: `foreign-owner-${stamp}@example.invalid`, passwordHash: 'disabled', role: 'OWNER' } });
  const hash = await bcrypt.hash('TestPassword123', 4);
  const guest = await db.customer.create({ data: { studioId, name: 'Guest with shared phone', phone: nationalPhone, isGuest: true, passwordHash: hash } });
  const client = await db.customer.create({ data: { studioId, name: 'Assigned client', phone, passwordHash: hash } });
  const other = await db.customer.create({ data: { studioId, name: 'Unassigned client' } });
  const foreignClient = await db.customer.create({ data: { studioId: foreign.id, name: 'Foreign client' } });
  const token = (u, type) => jwt.sign({ id: u.id, ...(type ? { type } : {}) }, process.env.JWT_SECRET, { expiresIn: '10m' });
  const admin = token(owner), auth = token(client, 'customer');
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(path, credential = auth, method = 'GET', body) {
    const r = await fetch(base + path, { method, headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' }, ...(body && { body: JSON.stringify(body) }) });
    const json = await r.json(); return { status: r.status, body: json.data || json };
  }
  async function expect(path, credential, method, body, status = 200) {
    const r = await request(path, credential, method, body); assert.equal(r.status, status, `${method || 'GET'} ${path}: ${JSON.stringify(r.body)}`); return r.body;
  }
  const login = await expect('/auth/customer/login', '', 'POST', { phone: nationalPhone, password: 'TestPassword123' });
  assert.equal(login.customer.id, client.id);
  await expect('/galleries/my/galleries', token(guest, 'customer'), 'GET', null, 401);
  // Unique studio-issued login ID wins over a duplicate historical client phone.
  const canonical = await db.customer.create({ data: { studioId, name: 'Canonical client', loginId: phone, phone: '+' + phone, passwordHash: hash } });
  assert.equal((await expect('/auth/customer/login', '', 'POST', { phone: nationalPhone, password: 'TestPassword123' })).customer.id, canonical.id);
  console.log('PASS client sign-in excludes guest records, handles canonical login IDs, and rejects old guest client sessions');

  const steps = [{ key: 'BOOKING_CONFIRMED', label: 'Booking confirmed' }, { key: 'SHOOT_SCHEDULED', label: 'Shoot scheduled' }, { key: 'EDITING', label: 'Editing' }, { key: 'DELIVERED', label: 'Delivered' }];
  const pkg = await db.servicePackage.create({ data: { studioId, title: 'Shoot one', bookingSteps: steps, includedPhotos: 2, pricePerExtraPhoto: 25 } });
  const bookClient = await db.customer.create({ data: { studioId, name: 'Client booking twice' } });
  const bookAuth = token(bookClient, 'customer');
  const bookRequest = { packageId: pkg.id, source: 'BOOK', requestedDate: '2026-11-12', requestedTime: '10:00' };
  const bookedFirst = await expect('/portal/lead', bookAuth, 'POST', bookRequest, 201);
  let clientJobs = (await expect('/portal/booking-status', bookAuth)).booking.jobs;
  assert.equal(clientJobs.length, 1); assert.equal(clientJobs[0].id, bookedFirst.lead.id); assert.equal(clientJobs[0].shootLabel, 'S1');
  const bookedSecond = await expect('/portal/lead', bookAuth, 'POST', { ...bookRequest, requestedDate: '2026-11-13', requestedTime: '15:00' }, 201);
  clientJobs = (await expect('/portal/booking-status', bookAuth)).booking.jobs;
  assert.equal(clientJobs.length, 2); assert.equal(clientJobs.find(j => j.id === bookedSecond.lead.id).shootLabel, 'S2');
  assert.equal(clientJobs.find(j => j.id === bookedFirst.lead.id).requestedTime, '10:00');
  console.log('PASS first Book Now creates exactly S1; a second request using the same package creates exactly S2 with its own preferred slot');
  const quoteClient = await db.customer.create({ data: { studioId, name: 'Legacy client accepting another shoot' } });
  const legacy = await db.customerBooking.create({ data: { studioId, customerId: quoteClient.id, servicePackageId: pkg.id, status: 'DELIVERED', history: [{ status: 'DELIVERED', note: 'Earlier shoot delivered' }] } });
  const { calculateQuote } = require('../src/services/billing/quotePricing');
  const { acceptQuote, convertQuote } = require('../src/services/billing/quoteLifecycle');
  const pricing = calculateQuote({ options: [{ id: pkg.id, servicePackageId: pkg.id, title: pkg.title, price: 1000 }], addOns: [] }, { optionIds: [pkg.id] }, 0);
  const quote = await db.quote.create({ data: { studioId, customerId: quoteClient.id, status: 'SENT', pricingSnapshot: pricing } });
  await acceptQuote({ studioId, quoteId: quote.id, customerId: quoteClient.id, optionId: pkg.id, actor: quoteClient.id });
  const conversions = await Promise.all([convertQuote({ studioId, quoteId: quote.id, admin: owner }), convertQuote({ studioId, quoteId: quote.id, admin: owner })]);
  assert.equal(conversions[0].invoiceId, conversions[1].invoiceId);
  const quoteJobs = (await expect('/portal/booking-status', token(quoteClient, 'customer'))).booking.jobs;
  assert.equal(quoteJobs.length, 2); assert.equal(quoteJobs[0].id, legacy.id); assert.equal(quoteJobs[0].status, 'DELIVERED');
  assert.equal(quoteJobs[1].id, quote.id); assert.equal(quoteJobs[1].shootLabel, 'S2'); assert.equal(quoteJobs[1].invoiceId, conversions[0].invoiceId);
  console.log('PASS quotation conversion preserves the earlier legacy shoot and adds S2 once, including concurrent conversion retries');
  let booking = (await expect(`/admin/portal/bookings/${client.id}`, admin, 'PUT', { servicePackageId: pkg.id, status: 'BOOKING_CONFIRMED' })).booking;
  const firstId = booking.jobs[0].id;
  booking = (await expect(`/admin/portal/bookings/${client.id}`, admin, 'PUT', { createJob: true, servicePackageId: pkg.id, status: 'BOOKING_CONFIRMED' })).booking;
  const secondId = booking.jobs.find(j => j.id !== firstId).id;
  await db.lead.createMany({ data: [firstId, secondId].map(id => ({ id, studioId, customerId: client.id, packageId: pkg.id, source: 'BOOK' })) });
  assert.equal(booking.jobs.length, 2); assert.equal(booking.jobs.find(j => j.id === secondId).shootLabel, 'S2');
  await expect(`/admin/portal/bookings/${client.id}`, admin, 'PUT', { status: 'EDITING' }, 409);
  await expect(`/admin/portal/bookings/${client.id}`, admin, 'PUT', { jobId: 'missing', status: 'EDITING' }, 404);
  booking = (await expect(`/admin/portal/bookings/${client.id}`, admin, 'PUT', { jobId: secondId, status: 'EDITING' })).booking;
  assert.equal(booking.jobs.find(j => j.id === firstId).status, 'BOOKING_CONFIRMED');
  assert.equal(booking.jobs.find(j => j.id === secondId).status, 'EDITING');
  await Promise.all([
    expect(`/admin/portal/bookings/${client.id}`, admin, 'PUT', { jobId: firstId, status: 'SHOOT_SCHEDULED' }),
    expect(`/admin/portal/bookings/${client.id}`, admin, 'PUT', { jobId: secondId, status: 'DELIVERED' }),
  ]);
  booking = (await expect('/portal/booking-status')).booking;
  assert.equal(booking.jobs.find(j => j.id === firstId).status, 'SHOOT_SCHEDULED'); assert.equal(booking.jobs.find(j => j.id === secondId).status, 'DELIVERED');
  await expect(`/admin/portal/bookings/${client.id}/timeslot`, admin, 'PUT', { confirmedDate: '2026-11-01', confirmedTime: '10:00' }, 409);
  await expect(`/admin/portal/bookings/${client.id}/timeslot`, admin, 'PUT', { jobId: firstId, confirmedDate: '2026-11-01', confirmedTime: '10:00' });
  await expect(`/admin/portal/bookings/${client.id}/timeslot`, admin, 'PUT', { jobId: secondId, confirmedDate: '2026-11-02', confirmedTime: '15:30' });
  await expect('/portal/reschedule', auth, 'POST', { jobId: secondId, requestedDate: '2026-11-03', requestedTime: '16:00', note: 'Change only S2' });
  booking = (await expect('/portal/booking-status')).booking;
  assert.equal(booking.jobs.find(j => j.id === firstId).slotStatus, 'ACCEPTED');
  assert.equal(booking.jobs.find(j => j.id === secondId).slotStatus, 'RESCHEDULE_REQUESTED');
  assert.equal(booking.jobs.find(j => j.id === firstId).confirmedDate.slice(0, 10), '2026-11-01');
  assert.equal(booking.jobs.find(j => j.id === secondId).confirmedTime, '15:30');
  assert.equal(booking.jobs.find(j => j.id === secondId).requestedDate.slice(0, 10), '2026-11-03');
  await expect(`/admin/portal/leads/${secondId}`, admin, 'PATCH', { slotAction: 'ACCEPT', confirmedDate: '2026-11-05', confirmedTime: '14:00' });
  booking = (await expect('/portal/booking-status')).booking;
  assert.equal(booking.jobs.find(j => j.id === firstId).confirmedDate.slice(0, 10), '2026-11-01');
  assert.equal(booking.jobs.find(j => j.id === secondId).confirmedDate.slice(0, 10), '2026-11-05');
  assert.equal((await db.lead.findUnique({ where: { id: firstId } })).confirmedTime, '10:00');
  await expect(`/admin/portal/bookings/${client.id}`, token(foreignOwner), 'PUT', { jobId: secondId, status: 'EDITING' }, 404);
  const pkg2 = await db.servicePackage.create({ data: { studioId, title: 'Second service', bookingSteps: [{ key: 'S2_STAGE', label: 'Second shoot stage' }], includedPhotos: 3, pricePerExtraPhoto: 30 } });
  await expect(`/admin/customers/${other.id}/assign-package-pricing`, admin, 'POST', { servicePackageId: pkg.id });
  await expect(`/admin/customers/${other.id}/assign-package-pricing`, admin, 'POST', { servicePackageId: pkg2.id });
  let separate = await db.customerBooking.findUnique({ where: { customerId: other.id } });
  assert.equal(separate.jobs.length, 2); assert.equal(separate.jobs[1].packageTitle, 'Second service'); assert.equal(separate.jobs[1].steps[0].key, 'S2_STAGE');
  await expect(`/admin/customers/${other.id}/assign-package-pricing`, admin, 'POST', { servicePackageId: pkg2.id });
  separate = await db.customerBooking.findUnique({ where: { customerId: other.id } }); assert.equal(separate.jobs.length, 2);
  console.log('PASS S1/S2 creation, job-specific stages and schedules, concurrent sibling edits, reschedule isolation, package assignment, and tenant isolation');

  const gallery = await db.eventGallery.create({ data: { studioId, name: 'Selection gallery', status: 'DRAFT', selectionLimit: 2, extraPhotoPrice: 25, faceSearchEnabled: true } });
  const newClientPhone = '8' + stamp.slice(-9);
  const newClientBody = { name: 'Newly created assigned client', phone: newClientPhone, password: 'TestPassword123', galleryIds: [gallery.id] };
  await expect('/admin/customers', admin, 'POST', newClientBody, 409);
  assert.equal(await db.customer.count({ where: { studioId, phone: '91' + newClientPhone } }), 0);
  await expect(`/galleries/${gallery.id}/access`, admin, 'POST', { customerIds: [client.id] }, 409);
  assert.equal(await db.accessGrant.count({ where: { galleryId: gallery.id } }), 0);
  await expect(`/galleries/${gallery.id}/access`, admin, 'POST', { customerIds: [client.id], publish: true });
  const createdClient = await expect('/admin/customers', admin, 'POST', newClientBody);
  assert.equal(createdClient.galleriesGranted, 1);
  assert.equal((await expect('/galleries/my/galleries', token(createdClient, 'customer'))).galleries[0].id, gallery.id);
  console.log('PASS new-client creation rejects an unavailable chosen gallery without creating the account, and creates account plus valid assignments atomically');
  assert.equal((await db.eventGallery.findUnique({ where: { id: gallery.id } })).status, 'PUBLISHED');
  assert.equal((await expect('/galleries/my/galleries')).galleries[0].id, gallery.id);
  assert.ok((await expect('/portal/home')).galleries.some(g => g.id === gallery.id));
  const photo = await db.photo.create({ data: { galleryId: gallery.id, originalKey: `test/${gallery.id}/original.jpg`, thumbnailKey: `test/${gallery.id}/thumb.jpg`, previewKey: `test/${gallery.id}/preview.jpg`, filename: 'test.jpg', fileSize: 100, mimeType: 'image/jpeg', isVisibleToCustomers: true, processingStatus: 'COMPLETE' } });
  let detail = await expect(`/galleries/my/${gallery.id}/photos`); assert.equal(detail.photos.length, 1); assert.equal(detail.selectionEnabled, true);
  await expect(`/photos/${photo.id}/favorite`, auth, 'POST', { selected: true });
  const selection = await expect(`/selection/my/${gallery.id}/submit`, auth, 'POST', {}); assert.equal(selection.count, 1);
  const share = await db.galleryShareLink.create({ data: { studioId, galleryId: gallery.id, token: `share-${stamp}` } });
  const shareGuest = await db.galleryGuest.create({ data: { studioId, galleryId: gallery.id, shareLinkId: share.id, name: 'Guest', phone: nationalPhone, sessionToken: `guest-${stamp}`, fullAccess: true } });
  const guestAuth = jwt.sign({ type: 'gallery_guest', guestId: shareGuest.id, sid: shareGuest.sessionToken }, process.env.JWT_SECRET);
  const session = await db.faceSearchSession.create({ data: { studioId, customerId: client.id, galleryId: gallery.id, status: 'COMPLETED', expiresAt: new Date(Date.now() + 600000) } });
  await db.faceSearchMatch.create({ data: { sessionId: session.id, photoId: photo.id, photoFaceId: `face-${stamp}`, similarity: 99, rank: 1 } });
  assert.equal((await expect(`/face/search/${session.id}/results`)).total, 1);
  assert.equal((await expect('/photos/my/favorites')).favorites.length, 1);
  await expect('/share/guest/photos', guestAuth);
  await expect(`/share/public/${share.token}`, '');
  await expect(`/galleries/my/${gallery.id}/photos/${photo.id}/download-url`, auth, 'GET', null, 403);
  await expect(`/galleries/my/${gallery.id}/photos`, token(other, 'customer'), 'GET', null, 403);
  await expect(`/galleries/my/${gallery.id}/photos`, token(foreignClient, 'customer'), 'GET', null, 403);
  await expect(`/galleries/${gallery.id}/access`, admin, 'POST', { customerIds: [client.id, foreignClient.id], publish: true }, 400);
  await expect(`/admin/customers/${other.id}/access`, admin, 'POST', { galleryIds: [gallery.id], publish: true });
  const detailAdmin = await expect(`/admin/customers/${other.id}`, admin); assert.equal(detailAdmin.accessGrants[0].availability.accessible, true);
  await db.eventGallery.update({ where: { id: gallery.id }, data: { expiresAt: new Date('2020-01-01') } });
  assert.equal((await expect('/galleries/my/galleries')).galleries.length, 0);
  assert.equal((await expect('/portal/home')).galleries.length, 0);
  assert.equal((await expect('/photos/my/favorites')).favorites.length, 0);
  assert.equal((await expect(`/face/search/${session.id}/results`)).total, 0);
  await expect(`/share/my/${gallery.id}/share-links`, auth, 'GET', null, 403);
  await expect('/share/guest/photos', guestAuth, 'GET', null, 401);
  await expect(`/share/public/${share.token}`, '', 'GET', null, 404);
  assert.equal((await expect(`/galleries/my/${gallery.id}/photos`, auth, 'GET', null, 403)).code, 'GALLERY_EXPIRED');
  await expect(`/admin/customers/${client.id}/access`, admin, 'POST', { galleryIds: [gallery.id], publish: true }, 409);
  await db.eventGallery.update({ where: { id: gallery.id }, data: { expiresAt: null } });
  await db.accessGrant.update({ where: { customerId_galleryId: { customerId: client.id, galleryId: gallery.id } }, data: { expiresAt: new Date('2020-01-01') } });
  assert.equal((await expect(`/galleries/my/${gallery.id}/photos`, auth, 'GET', null, 403)).code, 'ACCESS_EXPIRED');
  await expect(`/admin/customers/${client.id}/access`, admin, 'POST', { galleryIds: [gallery.id], publish: true });
  assert.equal((await expect('/galleries/my/galleries')).galleries.length, 1);
  assert.equal((await expect(`/face/search/${session.id}/results`)).total, 1);
  await db.galleryShareLink.update({ where: { id: share.id }, data: { active: false } });
  await expect('/share/guest/photos', guestAuth, 'GET', null, 401);
  await db.accessGrant.update({ where: { customerId_galleryId: { customerId: client.id, galleryId: gallery.id } }, data: { accessMode: 'VIEW' } });
  assert.equal((await expect(`/galleries/my/${gallery.id}/photos`)).selectionEnabled, false);
  await expect(`/selection/my/${gallery.id}/submit`, auth, 'POST', {}, 403);
  await db.accessGrant.update({ where: { customerId_galleryId: { customerId: client.id, galleryId: gallery.id } }, data: { accessMode: 'RAW', rawAccess: true } });
  assert.ok((await expect(`/galleries/my/${gallery.id}/photos/${photo.id}/download-url`)).downloadUrl);
  await db.eventGallery.update({ where: { id: gallery.id }, data: { status: 'ARCHIVED', deletedAt: new Date() } });
  assert.equal((await expect('/portal/home')).galleries.length, 0);
  await expect(`/galleries/my/${gallery.id}/photos`, auth, 'GET', null, 403);
  console.log('PASS assignment from both dashboard surfaces, atomic publication, fresh listing/home/deep link, selection submission, renewal, expiry diagnostics, wrong-account/tenant denial, VIEW/RAW permissions, and expiry/deletion/revocation on favorites, face results, and guest links');
}
run().catch(e => { console.error(e); process.exitCode = 1; }).finally(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  await db.$disconnect();
});
