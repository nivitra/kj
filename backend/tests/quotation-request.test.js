const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeRequest, dateOnly } = require('../src/services/quotationRequest');
const { catalogs } = require('../src/services/weddingInquiry');
const catalog = { ...catalogs(), eventTypes: [{ id: 'CORPORATE', label: 'Corporate event' }] };
const sample = () => ({ kind: 'WEDDING', contact: { name: 'Wedding client', phone: '9123456789', email: 'client@example.com' }, venue: { location: 'Pune' }, dates: { flexible: false, start: '2099-12-01', end: '2099-12-03', dayCount: 2 }, services: ['candid_photographer'], crewCounts: { candid_photographer: 3 }, budgetTier: 'UNSURE', album: { needed: true, count: 2 }, guestCount: 300, deliverables: 'Edited photos and wedding film' });
test('retains the requested date range, coverage quantities and physical albums', () => {
  const form = normalizeRequest(sample(), catalog);
  assert.equal(form.dates.dayCount, 2);
  assert.equal(form.dates.end, '2099-12-03');
  assert.equal(form.crewCounts.candid_photographer, 3);
  assert.equal(form.album.count, 2);
  assert.equal(form.contact.phone, '+919123456789');
  assert.equal(form.deliverables, 'Edited photos and wedding film');
});
test('corporate and flexible requests preserve scope without inventing dates', () => {
  const input = sample(); input.kind = 'CORPORATE'; input.organization = 'Brand'; input.dates.flexible = true;
  const form = normalizeRequest(input, catalog);
  assert.equal(form.kind, 'CORPORATE'); assert.equal(form.organization, 'Brand'); assert.equal(form.dates.start, ''); assert.equal(form.dates.end, ''); assert.equal(form.dates.dayCount, 2);
});
test('rejects invalid dates, backwards ranges and impossible coverage counts', () => {
  assert.equal(dateOnly('2099-02-29'), null);
  for (const dates of [{ start: '2099-02-31', end: '2099-03-04', dayCount: 1 }, { start: '2099-12-03', end: '2099-12-01', dayCount: 1 }, { start: '2099-12-01', end: '2099-12-01', dayCount: 2 }, { start: '2001-01-01', end: '2001-01-02', dayCount: 1 }]) {
    assert.throws(() => normalizeRequest({ ...sample(), dates }, catalog), e => e.status === 400);
  }
});
test('rejects unsupported services, noninteger quantities and malformed contacts', () => {
  for (const patch of [{ services: ['invented'] }, { services: [] }, { crewCounts: { candid_photographer: 0 } }, { crewCounts: { candid_photographer: 1.5 } }, { album: { needed: true, count: 0 } }, { album: {} }, { contact: { name: 'A', phone: '123' } }, { contact: { name: 'Client', phone: '9123456789', email: 'bad' } }, { guestCount: -1 }, { budgetTier: 'invented' }]) {
    assert.throws(() => normalizeRequest({ ...sample(), ...patch }, catalog), e => e.status === 400);
  }
});
