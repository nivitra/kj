const { test } = require('node:test');
const assert = require('node:assert/strict');

// rankPhotos is attached to the faceSearch processor export for testing.
process.env.REKOGNITION_MODE = 'mock';
const { rankPhotos } = require('../src/queues/processors/faceSearch');

test('ranks by similarity desc as the primary key', () => {
  const ranked = rankPhotos([
    { photoId: 'a', similarity: 96 },
    { photoId: 'b', similarity: 99 },
    { photoId: 'c', similarity: 97 },
  ]);
  assert.deepEqual(ranked.map((r) => r.photoId), ['b', 'c', 'a']);
});

test('breaks similarity ties by sharpness desc, then oldest capture, then id', () => {
  const t1 = '2024-01-01T00:00:00Z';
  const t2 = '2024-06-01T00:00:00Z';
  const ranked = rankPhotos([
    { photoId: 'z', similarity: 98, quality: { Sharpness: 50 }, capturedAt: t2 },
    { photoId: 'y', similarity: 98, quality: { Sharpness: 90 }, capturedAt: t2 }, // sharper wins
    { photoId: 'x', similarity: 98, quality: { Sharpness: 50 }, capturedAt: t1 }, // older wins over z
  ]);
  assert.deepEqual(ranked.map((r) => r.photoId), ['y', 'x', 'z']);
});

test('is deterministic — identical input always yields identical order', () => {
  const rows = () => [
    { photoId: 'p2', similarity: 95, quality: { Sharpness: 10 }, capturedAt: '2024-01-02T00:00:00Z' },
    { photoId: 'p1', similarity: 95, quality: { Sharpness: 10 }, capturedAt: '2024-01-02T00:00:00Z' },
    { photoId: 'p3', similarity: 99 },
  ];
  const first = rankPhotos(rows()).map((r) => r.photoId);
  for (let i = 0; i < 5; i++) {
    assert.deepEqual(rankPhotos(rows()).map((r) => r.photoId), first);
  }
  // Full tiebreak falls through to photoId ascending.
  assert.deepEqual(first, ['p3', 'p1', 'p2']);
});
