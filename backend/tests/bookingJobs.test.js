const test = require('node:test');
const assert = require('node:assert/strict');
const { jobsFromBooking, selectJobIndex, mergeBookingFlow, serializeJob } = require('../src/services/bookingJobs');
const { galleryAvailability, activeGrantWhere } = require('../src/services/galleryAccess');

test('shoot labels are stable when a newer enquiry is prepended', () => {
  const first = { id: 'first', createdAt: '2026-10-01T00:00:00Z', status: 'EDITING' };
  const second = { id: 'second', createdAt: '2026-10-02T00:00:00Z', status: 'BOOKING_CONFIRMED' };
  const jobs = jobsFromBooking({ jobs: [second, first] });
  assert.equal(jobs.find(j => j.id === 'first').shootLabel, 'S1');
  assert.equal(jobs.find(j => j.id === 'second').shootLabel, 'S2');
});

test('multiple timelines and invalid IDs cannot silently update job zero', () => {
  const jobs = [{ id: 'a' }, { id: 'b', leadId: 'lead-b' }];
  assert.throws(() => selectJobIndex(jobs), e => e.status === 409);
  assert.throws(() => selectJobIndex(jobs, 'unknown'), e => e.status === 404);
  assert.equal(selectJobIndex(jobs, 'lead-b'), 1);
  assert.equal(selectJobIndex([{ id: 'only' }]), 0);
});

test('reschedule events stay in history without becoming workflow stages', () => {
  const flow = mergeBookingFlow([{ key: 'SHOOT', label: 'Shoot' }, { key: 'EDITING', label: 'Editing' }],
    [{ status: 'SHOOT', event: 'SLOT_UPDATED', label: 'Shoot time updated' }], 'SHOOT');
  assert.deepEqual(flow.map(s => s.key), ['SHOOT', 'EDITING']);
});

test('timeline edits preserve quotation and delivery metadata', () => {
  const j = serializeJob({ id: 'quote', invoiceId: 'invoice', quoteId: 'quote', agreementId: 'agreement', days: [{ date: '2026-11-01' }], status: 'EDITING' });
  assert.equal(j.invoiceId, 'invoice'); assert.equal(j.agreementId, 'agreement'); assert.equal(j.days.length, 1);
});

test('publication and expiry blockers are distinguished', () => {
  const now = new Date('2026-10-07T12:00:00Z');
  assert.equal(galleryAvailability({ status: 'DRAFT' }, {}, now).reason, 'UNPUBLISHED');
  assert.equal(galleryAvailability({ status: 'PUBLISHED', expiresAt: now }, {}, now).reason, 'GALLERY_EXPIRED');
  assert.equal(galleryAvailability({ status: 'PUBLISHED' }, { expiresAt: now }, now).reason, 'ACCESS_EXPIRED');
  assert.equal(galleryAvailability({ status: 'PUBLISHED' }, {}, now).accessible, true);
  assert.equal(galleryAvailability({ status: 'DRAFT' }, { accessMode: 'RAW' }, now).accessible, true);
  assert.equal(galleryAvailability({ status: 'PUBLISHED', deletedAt: now }, { accessMode: 'RAW' }, now).reason, 'DELETED');
  assert.equal(activeGrantWhere('client', 'studio').gallery.studioId, 'studio');
});
