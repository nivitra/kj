const { test } = require('node:test');
const assert = require('node:assert/strict');
const { protectSessionLogs } = require('../src/utils/privateSessionLogs');
test('messaging session key material is omitted without hiding unrelated diagnostics', () => {
  const lines = [];
  const target = { info: (...args) => lines.push(args), warn: (...args) => lines.push(args), log: (...args) => lines.push(args) };
  protectSessionLogs(target); protectSessionLogs(target);
  target.info('Closing session:', { privateKey: 'must-not-be-logged' });
  target.warn('Session already closed', { privateKey: 'must-not-be-logged' });
  target.warn('Storage retry', { attempt: 2 });
  assert.ok(!JSON.stringify(lines).includes('must-not-be-logged'));
  assert.deepEqual(lines[2], ['Storage retry', { attempt: 2 }]);
});
