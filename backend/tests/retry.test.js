const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AppError, CODES, isRetryable } = require('../src/lib/errors');

test('permanent AppErrors are not retryable', () => {
  const err = new AppError(CODES.UNSUPPORTED_MEDIA, 'bad', { retryable: false });
  assert.equal(isRetryable(err), false);
});

test('throttling is retryable', () => {
  const err = new Error('slow down');
  err.name = 'ThrottlingException';
  assert.equal(isRetryable(err), true);
});

test('5xx AWS metadata is retryable', () => {
  const err = new Error('boom');
  err.$metadata = { httpStatusCode: 503 };
  assert.equal(isRetryable(err), true);
});

test('selfie validation codes are permanent', () => {
  for (const code of [CODES.NO_FACE_DETECTED, CODES.MULTIPLE_FACES, CODES.FACE_TOO_SMALL, CODES.LOW_QUALITY_SELFIE]) {
    const err = new AppError(code, 'x', { status: 422, retryable: false });
    assert.equal(isRetryable(err), false);
  }
});
