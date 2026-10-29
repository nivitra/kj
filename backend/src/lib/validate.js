const { validationResult } = require('express-validator');
const { fail } = require('./envelope');
const { CODES } = require('./errors');

// Run after an express-validator chain; short-circuits with a 400 envelope.
const validate = (req, res, next) => {
  const result = validationResult(req);
  if (result.isEmpty()) return next();
  const first = result.array()[0];
  return fail(res, CODES.VALIDATION, `${first.path}: ${first.msg}`, { status: 400 });
};

module.exports = { validate };
