const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validatePdf, MAX_PDF_BYTES } = require('../src/services/pdfUpload');
const { galleryNotificationRecipient, recipientTemplateVars } = require('../src/services/notificationRecipient');
test('PDF upload rejects missing, disguised and oversized documents', () => {
  const file = { size: 30, mimetype: 'application/pdf', buffer: Buffer.from('%PDF-1.7\ncontent') };
  assert.equal(validatePdf(file), null);
  assert.ok(validatePdf(null));
  assert.ok(validatePdf({ ...file, size: MAX_PDF_BYTES + 1 }));
  assert.ok(validatePdf({ ...file, size: 0 }));
  assert.ok(validatePdf({ ...file, mimetype: 'text/html' }));
  assert.ok(validatePdf({ ...file, buffer: Buffer.from('<html>not a PDF') }));
});
test('explicit recipient wins over stale template variables', () => {
  assert.equal(recipientTemplateVars({ toName: '  Correct Client  ', vars: { name: 'Wrong Client' } }).name, 'Correct Client');
  assert.equal(recipientTemplateVars({ toName: ' ', vars: { name: 'Wrong Client' } }).name, 'there');
});
test('gallery greeting uses the exact granted client and current gallery, scoped to studio', async () => {
  let filter;
  const db = { accessGrant: { findFirst: async args => { filter = args.where; return { customer: { phone: '+919999999999', name: '  Updated Client  ' }, gallery: { name: 'Reception' } }; } } };
  const r = await galleryNotificationRecipient(db, 'studio-1', { customerId: 'client-2', galleryId: 'gallery-3' });
  assert.equal(r.name, 'Updated Client'); assert.equal(r.galleryName, 'Reception');
  assert.equal(filter.customerId, 'client-2'); assert.equal(filter.galleryId, 'gallery-3');
  assert.equal(filter.customer.studioId, 'studio-1'); assert.equal(filter.gallery.studioId, 'studio-1');
  assert.equal(filter.customer.isGuest, false); assert.equal(filter.AND[0].OR.length, 2);
  assert.equal(filter.gallery.deletedAt, null); assert.equal(filter.gallery.OR.length, 2);
  assert.equal(await galleryNotificationRecipient(db, 'studio-1', {}), null);
  db.accessGrant.findFirst = async () => null;
  assert.equal(await galleryNotificationRecipient(db, 'studio-1', { customerId: 'c', galleryId: 'g' }), null);
});
