const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveSelectionPhase,
  lockedIncludedIds,
  billedExtraIds,
  extraReviewFlags,
  extraRateOf,
} = require('../src/services/selectionPhase');
const { isOfferLive, buildOfferPayload } = require('../src/services/rawDump');

test('phase is INCLUDED until includedLockedAt, EXTRAS after lock', () => {
  assert.equal(resolveSelectionPhase({ status: 'OPEN' }), 'INCLUDED');
  assert.equal(resolveSelectionPhase({ status: 'SUBMITTED', includedLockedAt: new Date() }), 'EXTRAS');
  assert.equal(resolveSelectionPhase({
    status: 'UNLOCKED',
    unlockMode: 'INCLUDED',
    includedLockedAt: null,
    history: [{ kind: 'INCLUDED' }],
  }), 'INCLUDED');
  assert.equal(resolveSelectionPhase({
    status: 'UNLOCKED',
    unlockMode: 'EXTRAS',
    includedLockedAt: new Date(),
  }), 'EXTRAS');
});

test('locked included ids empty when included is reopened', () => {
  const sel = {
    unlockMode: 'INCLUDED',
    includedLimit: 2,
    overageInvoiceId: 'inv-1',
    items: [
      { photoId: 'a', deliveryType: 'INCLUDED', createdAt: new Date() },
      { photoId: 'b', deliveryType: 'INCLUDED', createdAt: new Date() },
      { photoId: 'c', deliveryType: 'EDITED', createdAt: new Date() },
    ],
  };
  assert.deepEqual(lockedIncludedIds(sel), []);
  assert.deepEqual(billedExtraIds(sel), ['c']);
});

test('pending extras are not billed just because included was locked', () => {
  const billed = billedExtraIds({
    overageInvoiceId: null,
    submittedAt: new Date(),
    items: [
      { photoId: 'inc', deliveryType: 'INCLUDED' },
      { photoId: 'ex', deliveryType: 'EDITED', submittedAt: new Date() },
    ],
  });
  assert.deepEqual(billed, []);

  const pending = extraReviewFlags({
    isExtra: true,
    photoId: 'ex',
    billedIds: billed,
    rowSubmittedAt: null,
    selectionSubmittedAt: new Date('2026-09-01T00:00:00Z'),
  });
  assert.equal(pending.alreadySubmitted, false);
  assert.equal(pending.isNewExtra, true);
  assert.equal(pending.submittedAt, null);

  const invoiced = extraReviewFlags({
    isExtra: true,
    photoId: 'ex',
    billedIds: ['ex'],
    rowSubmittedAt: new Date('2026-09-02T00:00:00Z'),
    selectionSubmittedAt: new Date('2026-09-01T00:00:00Z'),
  });
  assert.equal(invoiced.alreadySubmitted, true);
  assert.equal(invoiced.isNewExtra, false);
  assert.ok(invoiced.submittedAt);

  const locked = extraReviewFlags({
    isExtra: false,
    photoId: 'inc',
    billedIds: ['ex'],
    rowSubmittedAt: new Date('2026-09-01T00:00:00Z'),
    selectionSubmittedAt: new Date('2026-09-01T00:00:00Z'),
  });
  assert.equal(locked.alreadySubmitted, false);
  assert.equal(locked.isNewExtra, false);
  assert.ok(locked.submittedAt);
});

test('extraRateOf preserves an explicitly free extra rate', () => {
  assert.equal(extraRateOf({ pricePerExtraEdited: 0 }), 0);
  assert.equal(extraRateOf({ pricePerExtraEdited: 400 }), 400);
});

test('package price label never shows ₹0', () => {
  const label = (pkg) => {
    const price = Number(pkg.discountPrice != null ? pkg.discountPrice : pkg.price) || 0;
    return price > 0 ? `₹${price.toLocaleString('en-IN')} onwards` : 'Contact for price';
  };
  assert.equal(label({ price: 0 }), 'Contact for price');
  assert.match(label({ price: 25000 }), /25,000/);
});

test('RAW dump offer is live only in the window with a positive price', () => {
  const now = new Date('2026-09-01T12:00:00Z');
  const gallery = {
    bulkRawEnabled: true,
    bulkRawPrice: 4999,
    bulkRawWindowDays: 14,
    expiresAt: new Date('2026-09-10T00:00:00Z'),
  };
  assert.equal(isOfferLive(gallery, { now }), true);
  assert.equal(isOfferLive({ ...gallery, bulkRawPrice: 0 }, { now }), false);
  assert.equal(isOfferLive(gallery, { rawAccess: true, now }), false);
  const payload = buildOfferPayload(gallery, { rawAccess: false, photoCount: 800, now });
  assert.equal(payload.live, true);
  assert.equal(payload.priceLabel, '₹4,999');
});
