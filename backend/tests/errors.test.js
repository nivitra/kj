const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AppError, CODES, isRetryable } = require('../src/lib/errors');

test('AppError carries code, status, retryable with sane defaults', () => {
  const e = new AppError(CODES.NO_FACE_DETECTED, 'no face', { status: 422 });
  assert.equal(e.code, 'NO_FACE_DETECTED');
  assert.equal(e.status, 422);
  assert.equal(e.retryable, false); // default: permanent
  assert.ok(e instanceof Error);
});

test('isRetryable: transient AWS errors retry', () => {
  for (const name of ['ThrottlingException', 'ProvisionedThroughputExceededException', 'InternalServerError', 'ServiceUnavailable', 'RequestTimeout', 'TimeoutError']) {
    assert.equal(isRetryable({ name }), true, `${name} should retry`);
  }
});

test('isRetryable: 5xx and network blips retry, 4xx does not', () => {
  assert.equal(isRetryable({ $metadata: { httpStatusCode: 503 } }), true);
  assert.equal(isRetryable({ $metadata: { httpStatusCode: 400 } }), false);
  assert.equal(isRetryable({ code: 'ECONNRESET' }), true);
  assert.equal(isRetryable({ code: 'ETIMEDOUT' }), true);
});

test('isRetryable: AppError honours its own flag — validation is permanent', () => {
  assert.equal(isRetryable(new AppError(CODES.UNSUPPORTED_MEDIA, 'x', { status: 422, retryable: false })), false);
  assert.equal(isRetryable(new AppError(CODES.SEARCH_FAILED, 'x', { status: 500, retryable: true })), true);
});

test('isRetryable: unknown plain error is permanent', () => {
  assert.equal(isRetryable(new Error('boom')), false);
});
