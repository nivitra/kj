const { test } = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { sha256, validateImageBuffer } = require('../src/services/imageProcessor');

const solidPng = (w = 8, h = 8) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: 10, g: 20, b: 30 } } }).png().toBuffer();

test('sha256 is deterministic and content-addressed (dedupe key)', () => {
  const a = Buffer.from('identical bytes');
  const b = Buffer.from('identical bytes');
  const c = Buffer.from('different bytes');
  assert.equal(sha256(a), sha256(b));
  assert.notEqual(sha256(a), sha256(c));
  assert.match(sha256(a), /^[0-9a-f]{64}$/);
});

test('validateImageBuffer accepts a real PNG by magic bytes', async () => {
  const mime = await validateImageBuffer(await solidPng());
  assert.equal(mime, 'image/png');
});

test('validateImageBuffer accepts a real JPEG', async () => {
  const jpeg = await sharp(await solidPng()).jpeg().toBuffer();
  assert.equal(await validateImageBuffer(jpeg), 'image/jpeg');
});

test('validateImageBuffer rejects non-images as permanent UNSUPPORTED_MEDIA', async () => {
  // A .jpg-named text blob must not sneak past — magic bytes, not client MIME.
  await assert.rejects(
    () => validateImageBuffer(Buffer.from('<html>not an image</html>')),
    (e) => e.code === 'UNSUPPORTED_MEDIA' && e.retryable === false,
  );
});
