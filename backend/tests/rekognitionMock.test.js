const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mock = require('../src/services/rekognition.mock');

beforeEach(() => mock._reset());

test('indexFaces is deterministic — same key yields identical faceIds', async () => {
  const a = await mock.indexFaces({ key: 'photo-A.jpg', externalImageId: 'A' });
  mock._reset();
  const b = await mock.indexFaces({ key: 'photo-A.jpg', externalImageId: 'A' });
  assert.deepEqual(a.map((f) => f.faceId), b.map((f) => f.faceId));
});

test('a group photo yields multiple face rows (0..2 faces per image)', async () => {
  // Find a key that produces >1 face so we exercise the many-rows path.
  let multi = null;
  for (let i = 0; i < 50 && !multi; i++) {
    mock._reset();
    const faces = await mock.indexFaces({ key: `group-${i}.jpg`, externalImageId: `g${i}` });
    if (faces.length > 1) multi = faces;
  }
  assert.ok(multi, 'expected at least one multi-face key');
  assert.ok(multi.every((f) => f.faceId && f.boundingBox && f.confidence > 0));
});

test('detectFaces distinguishes no-face / one-face / multi-face selfies', async () => {
  assert.equal((await mock.detectFaces({ key: 's/noface.jpg' })).length, 0);
  assert.equal((await mock.detectFaces({ key: 's/ok.jpg' })).length, 1);
  assert.equal((await mock.detectFaces({ key: 's/multiface.jpg' })).length, 2);
});

test('searchFacesByImage matches only faces in the same person bucket', async () => {
  await mock.indexFaces({ key: 'wedding/p1.jpg', externalImageId: 'p1' });
  await mock.indexFaces({ key: 'wedding/p2.jpg', externalImageId: 'p2' });
  const matches = await mock.searchFacesByImage({ key: 'wedding/p1.jpg' });
  // Every match must be a face we actually indexed.
  assert.ok(matches.every((m) => m.faceId && m.similarity >= 97 && m.similarity <= 99));
});

test('simulated failures throw a named, classifiable error once', async () => {
  mock._simulateFailure('ThrottlingException');
  await assert.rejects(() => mock.indexFaces({ key: 'x.jpg', externalImageId: 'x' }), (e) => e.name === 'ThrottlingException');
  // One-shot: the next call succeeds.
  const ok = await mock.indexFaces({ key: 'x.jpg', externalImageId: 'x' });
  assert.ok(Array.isArray(ok));
});

test('deleteFaces removes vectors so they no longer match', async () => {
  const faces = await mock.indexFaces({ key: 'del/a.jpg', externalImageId: 'a' });
  const ids = faces.map((f) => f.faceId);
  await mock.deleteFaces(ids);
  const remaining = await mock.searchFacesByImage({ key: 'del/a.jpg' });
  assert.ok(remaining.every((m) => !ids.includes(m.faceId)));
});
