const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildS3Key, buildSelfieKey, buildContractKey } = require('../src/services/s3');
const { keys } = require('../src/services/jobKeys');

test('buildS3Key namespaces objects under studio + gallery (tenant isolation)', () => {
  const k = buildS3Key('studio1', 'gallery9', 'display', 'photo.webp');
  assert.equal(k, 'studios/studio1/galleries/gallery9/display/photo.webp');
  assert.ok(k.startsWith('studios/studio1/'));
});

test('buildSelfieKey routes selfies to the auto-expiring temp prefix', () => {
  const k = buildSelfieKey('sess-42', 'selfie.jpg');
  assert.equal(k, 'temporary-face-search/sess-42/selfie.jpg');
});

test('buildContractKey lands under the studio contracts prefix', () => {
  assert.equal(buildContractKey('studioX', 'c1', '.pdf'), 'studios/studioX/contracts/c1.pdf');
});

test('idempotency key schemes are stable and per-entity', () => {
  assert.equal(keys.derive('p1'), 'derive-p1');
  assert.equal(keys.index('p1'), 'index-p1');
  assert.equal(keys.search('s1'), 'search-s1');
  assert.equal(keys.del('p1'), 'delete-p1');
  assert.equal(keys.cleanup('s1'), 'cleanup-s1');
  // Same photo, different stage → distinct keys (no accidental collision).
  assert.notEqual(keys.derive('p1'), keys.index('p1'));
});
