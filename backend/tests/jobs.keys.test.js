const { test } = require('node:test');
const assert = require('node:assert/strict');

// Schemes from FACE-PIPELINE-PLAN.md §9 — keep in sync with src/services/jobs.js.
// BullMQ jobIds cannot contain ":" so we use hyphens.
const { keys } = require('../src/services/jobKeys');

test('idempotency key schemes are BullMQ-safe (no colon)', () => {
  assert.equal(keys.derive('p1'), 'derive-p1');
  assert.equal(keys.index('p1'), 'index-p1');
  assert.equal(keys.search('s1'), 'search-s1');
  assert.equal(keys.broader('s1'), 'broader-s1');
  assert.equal(keys.del('p1'), 'delete-p1');
  assert.equal(keys.cleanup('s1'), 'cleanup-s1');
  for (const v of Object.values(keys).map((fn) => fn('x'))) {
    assert.ok(!v.includes(':'), `jobId must not contain colon: ${v}`);
  }
});
