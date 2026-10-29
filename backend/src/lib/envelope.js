const { randomUUID } = require('crypto');

// Consistent success/error envelopes: { data, request_id } / { error, request_id }.
const ok = (res, data, status = 200) =>
  res.status(status).json({ data, request_id: res.locals.requestId || randomUUID() });

const fail = (res, code, message, { status = 400, retryable = false } = {}) =>
  res.status(status).json({
    error: { code, message, retryable },
    request_id: res.locals.requestId || randomUUID(),
  });

// Attach a request id to every response for tracing.
const requestId = (req, res, next) => {
  res.locals.requestId = req.headers['x-request-id'] || randomUUID();
  res.setHeader('x-request-id', res.locals.requestId);
  next();
};

module.exports = { ok, fail, requestId };
