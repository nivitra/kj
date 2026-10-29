const { test } = require('node:test');
const assert = require('node:assert/strict');

// Isolate env for pure config helpers
test('cognito publicConfig reflects disabled state without pool env', () => {
  const prev = { ...process.env };
  delete process.env.COGNITO_USER_POOL_ID;
  delete process.env.COGNITO_CLIENT_ID;
  process.env.COGNITO_ENABLED = 'false';

  // Re-require with cleared module cache
  delete require.cache[require.resolve('../src/services/cognito')];
  const cognito = require('../src/services/cognito');

  assert.equal(cognito.isConfigured(), false);
  assert.equal(cognito.isEnabled(), false);
  const cfg = cognito.publicConfig();
  assert.equal(cfg.enabled, false);
  assert.deepEqual(cfg.scopes, ['openid', 'email', 'profile']);
  assert.equal(cfg.pkce, true);
  assert.equal(cfg.responseType, 'code');

  process.env = prev;
  delete require.cache[require.resolve('../src/services/cognito')];
});

test('extractUser maps cognito claims', () => {
  delete require.cache[require.resolve('../src/services/cognito')];
  const cognito = require('../src/services/cognito');
  const u = cognito.extractUser({
    sub: 'abc-123',
    email: 'a@b.com',
    email_verified: 'true',
    name: 'Ada Lovelace',
    'custom:studio_id': 'studio-1',
    token_use: 'access',
  });
  assert.equal(u.sub, 'abc-123');
  assert.equal(u.email, 'a@b.com');
  assert.equal(u.emailVerified, true);
  assert.equal(u.name, 'Ada Lovelace');
  assert.equal(u.studioId, 'studio-1');
});
