const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveEntitlements, grantWriteFromMode, publicGrantFields } = require('../src/services/galleryAccess');
const phase = require('../src/services/selectionPhase');

test('RAW grant: no selection, originals + face search', () => {
  const ent = resolveEntitlements(
    { selectionEnabled: true, downloadEnabled: false, faceSearchEnabled: true },
    { accessMode: 'RAW', rawAccess: true },
  );
  assert.equal(ent.accessMode, 'RAW');
  assert.equal(ent.selectionEnabled, false);
  assert.equal(ent.originalsAllowed, true);
  assert.equal(ent.downloadsAllowed, true);
  assert.equal(ent.faceSearchEnabled, true);
  assert.equal(ent.watermarkedPreviews, true);
});

test('VIEW grant: no originals, no selection', () => {
  const ent = resolveEntitlements(
    { selectionEnabled: true, downloadEnabled: true, faceSearchEnabled: true },
    { accessMode: 'VIEW' },
  );
  assert.equal(ent.selectionEnabled, false);
  assert.equal(ent.originalsAllowed, false);
  assert.equal(ent.downloadsAllowed, false);
});

test('SELECTION grant uses per-client extra price over gallery', () => {
  const ent = resolveEntitlements(
    { selectionEnabled: true, extraPhotoPrice: 350, selectionLimit: 20 },
    { accessMode: 'SELECTION', extraPhotoPrice: 199, selectionLimit: 8 },
  );
  assert.equal(ent.selectionEnabled, true);
  assert.equal(ent.extraRate, 199);
  assert.equal(ent.includedLimit, 8);
  assert.equal(ent.extrasBillable, true);
});

test('un-invoiced EDITED items are not billed extras', () => {
  const ids = phase.billedExtraIds({
    overageInvoiceId: null,
    items: [{ photoId: 'a', deliveryType: 'EDITED' }],
  });
  assert.deepEqual(ids, []);
  const billed = phase.billedExtraIds({
    overageInvoiceId: 'inv-1',
    items: [{ photoId: 'a', deliveryType: 'EDITED' }],
  });
  assert.deepEqual(billed, ['a']);
});


test('RAW client face scan can be disabled without removing full original access', () => {
  const grant = grantWriteFromMode('RAW', { faceSearchEnabled: false });
  const ent = resolveEntitlements({ faceSearchEnabled: true }, grant);
  assert.equal(grant.faceSearchEnabled, false);
  assert.equal(publicGrantFields(ent).faceSearchEnabled, false);
  assert.equal(ent.originalsAllowed, true);
  assert.equal(ent.downloadsAllowed, true);
  assert.equal(ent.selectionEnabled, false);
  assert.equal(ent.label.includes('face search'), false);
});

test('RAW client face scan can be enabled and survives an access update', () => {
  const grant = grantWriteFromMode('RAW', { faceSearchEnabled: true });
  const ent = resolveEntitlements({ faceSearchEnabled: true }, grant);
  assert.equal(publicGrantFields(ent).faceSearchEnabled, true);
  assert.equal(ent.label.includes('face search'), true);
});


test('client face search stays unavailable while gallery indexing is disabled', () => {
  for (const accessMode of ['RAW', 'SELECTION', 'VIEW']) {
    const ent = resolveEntitlements({ faceSearchEnabled: false }, { accessMode, faceSearchEnabled: true });
    assert.equal(ent.faceSearchEnabled, false);
  }
});
