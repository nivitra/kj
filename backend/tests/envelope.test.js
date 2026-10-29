const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ok, fail, requestId } = require('../src/lib/envelope');

// Minimal Express res/req doubles.
const makeRes = () => ({
  locals: {},
  headers: {},
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(payload) { this.body = payload; return this; },
  setHeader(k, v) { this.headers[k] = v; },
});

test('ok wraps data with a request_id and default 200', () => {
  const res = makeRes();
  res.locals.requestId = 'req-1';
  ok(res, { hello: 'world' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { data: { hello: 'world' }, request_id: 'req-1' });
});

test('fail produces the { error: { code, message, retryable } } envelope', () => {
  const res = makeRes();
  res.locals.requestId = 'req-2';
  fail(res, 'RATE_LIMITED', 'slow down', { status: 429, retryable: true });
  assert.equal(res.statusCode, 429);
  assert.deepEqual(res.body, {
    error: { code: 'RATE_LIMITED', message: 'slow down', retryable: true },
    request_id: 'req-2',
  });
});

test('requestId middleware honours inbound header and echoes it back', () => {
  const res = makeRes();
  const req = { headers: { 'x-request-id': 'trace-abc' } };
  let called = false;
  requestId(req, res, () => { called = true; });
  assert.equal(called, true);
  assert.equal(res.locals.requestId, 'trace-abc');
  assert.equal(res.headers['x-request-id'], 'trace-abc');
});

test('requestId middleware generates an id when none supplied', () => {
  const res = makeRes();
  requestId({ headers: {} }, res, () => {});
  assert.match(res.locals.requestId, /^[0-9a-f-]{36}$/);
});
