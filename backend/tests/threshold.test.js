const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.FACE_MATCH_THRESHOLD = '95';
process.env.FACE_HIGH_TIER = '98';
process.env.FACE_BROADER_THRESHOLD = '90';

// Re-require after env is set.
delete require.cache[require.resolve('../src/services/threshold')];
const { tierFor, AUTO_THRESHOLD, HIGH_TIER, BROADER_THRESHOLD } = require('../src/services/threshold');

test('tierFor classifies high / standard / broad / below', () => {
  assert.equal(tierFor(99), 'high');
  assert.equal(tierFor(HIGH_TIER), 'high');
  assert.equal(tierFor(96.5), 'standard');
  assert.equal(tierFor(AUTO_THRESHOLD), 'standard');
  assert.equal(tierFor(92), 'broad');
  assert.equal(tierFor(BROADER_THRESHOLD), 'broad');
  assert.equal(tierFor(80), 'below');
});
