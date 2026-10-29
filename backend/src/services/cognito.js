/**
 * Amazon Cognito integration for customer authentication.
 *
 * - Access tokens verified via Cognito JWKS (no local password check).
 * - Admin APIs (disable/enable/delete/reset) use the default AWS credential
 *   chain (EC2 instance role in production).
 *
 * Env:
 *   COGNITO_USER_POOL_ID
 *   COGNITO_CLIENT_ID
 *   COGNITO_REGION          (defaults to AWS_REGION)
 *   COGNITO_DOMAIN          (e.g. sj-studio.auth.ap-south-1.amazoncognito.com)
 *   COGNITO_REDIRECT_URI
 *   COGNITO_LOGOUT_URI
 *   COGNITO_DEFAULT_STUDIO_ID  (studio for auto-created customers)
 *   COGNITO_ENABLED=true|false
 */
const {
  CognitoIdentityProviderClient,
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  AdminDeleteUserCommand,
  AdminResetUserPasswordCommand,
  AdminGetUserCommand,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  ListUsersCommand,
} = require('@aws-sdk/client-cognito-identity-provider');
const jose = require('jose');
const { prisma } = require('../config/prisma');
const { logger } = require('../utils/logger');

const REGION = process.env.COGNITO_REGION || process.env.AWS_REGION || 'ap-south-1';
const USER_POOL_ID = (process.env.COGNITO_USER_POOL_ID || '').trim();
const CLIENT_ID = (process.env.COGNITO_CLIENT_ID || '').trim();
const DOMAIN = (process.env.COGNITO_DOMAIN || '').trim().replace(/^https?:\/\//, '');
const REDIRECT_URI = (process.env.COGNITO_REDIRECT_URI || '').trim();
const LOGOUT_URI = (process.env.COGNITO_LOGOUT_URI || process.env.CUSTOMER_APP_URL || '').trim();
const DEFAULT_STUDIO_ID = (process.env.COGNITO_DEFAULT_STUDIO_ID || '').trim();

const isConfigured = () => !!(USER_POOL_ID && CLIENT_ID);
const isEnabled = () => {
  const flag = (process.env.COGNITO_ENABLED || '').toLowerCase();
  if (flag === 'false' || flag === '0') return false;
  return isConfigured();
};

const issuer = () => `https://cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}`;
const jwksUri = () => `${issuer()}/.well-known/jwks.json`;

let jwks;
const getJwks = () => {
  if (!jwks) {
    jwks = jose.createRemoteJWKSet(new URL(jwksUri()));
  }
  return jwks;
};

const cognitoClient = new CognitoIdentityProviderClient({ region: REGION });

/**
 * Verify a Cognito access (or id) token against the User Pool JWKS.
 * @returns {Promise<object>} decoded payload
 */
const verifyJWT = async (token) => {
  if (!isConfigured()) {
    const err = new Error('Cognito is not configured');
    err.code = 'COGNITO_NOT_CONFIGURED';
    throw err;
  }
  const { payload } = await jose.jwtVerify(token, getJwks(), {
    issuer: issuer(),
    // Access tokens use client_id claim; id tokens use aud.
  });

  // Access token checks
  if (payload.token_use === 'access') {
    if (payload.client_id !== CLIENT_ID) {
      const err = new Error('Token client_id mismatch');
      err.code = 'TOKEN_INVALID';
      throw err;
    }
  } else if (payload.token_use === 'id') {
    const aud = payload.aud;
    const ok = aud === CLIENT_ID || (Array.isArray(aud) && aud.includes(CLIENT_ID));
    if (!ok) {
      const err = new Error('Token audience mismatch');
      err.code = 'TOKEN_INVALID';
      throw err;
    }
  } else {
    const err = new Error('Unsupported token_use');
    err.code = 'TOKEN_INVALID';
    throw err;
  }

  if (!payload.sub) {
    const err = new Error('Token missing sub');
    err.code = 'TOKEN_INVALID';
    throw err;
  }

  return payload;
};

/**
 * Normalize Cognito claims into a stable user shape.
 */
const extractUser = (payload) => {
  const email =
    payload.email ||
    payload.username ||
    (typeof payload['cognito:username'] === 'string' && payload['cognito:username'].includes('@')
      ? payload['cognito:username']
      : null);
  const phone = payload.phone_number || null;
  const name =
    payload.name ||
    [payload.given_name, payload.family_name].filter(Boolean).join(' ').trim() ||
    (email ? email.split('@')[0] : 'Client');
  const emailVerified =
    payload.email_verified === true ||
    payload.email_verified === 'true';
  const studioId =
    payload['custom:studio_id'] ||
    payload['custom:studioId'] ||
    DEFAULT_STUDIO_ID ||
    null;

  return {
    sub: payload.sub,
    email: email || null,
    phone,
    name,
    emailVerified,
    studioId,
    username: payload.username || payload['cognito:username'] || payload.sub,
    raw: payload,
  };
};

/**
 * Find or create a local Customer row from a verified Cognito identity.
 * Updates lastLoginAt and emailVerified on every call.
 */
const createCustomerIfMissing = async (identity) => {
  if (!identity?.sub) throw new Error('identity.sub required');

  let customer = await prisma.customer.findUnique({
    where: { cognitoSub: identity.sub },
    include: { studio: { select: { id: true, name: true, logoUrl: true } } },
  });

  if (!customer && identity.email) {
    // Link existing email-matched row (legacy → Cognito migration).
    customer = await prisma.customer.findFirst({
      where: {
        email: { equals: identity.email, mode: 'insensitive' },
        cognitoSub: null,
      },
      include: { studio: { select: { id: true, name: true, logoUrl: true } } },
    });
    if (customer) {
      customer = await prisma.customer.update({
        where: { id: customer.id },
        data: {
          cognitoSub: identity.sub,
          emailVerified: identity.emailVerified,
          lastLoginAt: new Date(),
          accountStatus: customer.accountStatus === 'DISABLED' ? 'DISABLED' : 'ACTIVE',
          ...(identity.phone && !customer.phone ? { phone: identity.phone } : {}),
        },
        include: { studio: { select: { id: true, name: true, logoUrl: true } } },
      });
      return customer;
    }
  }

  if (!customer) {
    let studioId = identity.studioId;
    if (!studioId) {
      const first = await prisma.studio.findFirst({ orderBy: { createdAt: 'asc' } });
      studioId = first?.id;
    }
    if (!studioId) {
      const err = new Error('No studio available to attach customer');
      err.code = 'NO_STUDIO';
      throw err;
    }

    const baseName = identity.name || identity.email?.split('@')[0] || 'Client';
    customer = await prisma.customer.create({
      data: {
        studioId,
        cognitoSub: identity.sub,
        name: baseName,
        email: identity.email,
        phone: identity.phone,
        emailVerified: identity.emailVerified,
        accountStatus: 'ACTIVE',
        lastLoginAt: new Date(),
        // loginId/passwordHash intentionally null for Cognito-native accounts
      },
      include: { studio: { select: { id: true, name: true, logoUrl: true } } },
    });
    logger.info(`Cognito auto-created customer ${customer.id} sub=${identity.sub}`);
    return customer;
  }

  // Existing cognitoSub match
  customer = await prisma.customer.update({
    where: { id: customer.id },
    data: {
      lastLoginAt: new Date(),
      emailVerified: identity.emailVerified || customer.emailVerified,
      ...(identity.email && !customer.email ? { email: identity.email } : {}),
      ...(identity.phone && !customer.phone ? { phone: identity.phone } : {}),
    },
    include: { studio: { select: { id: true, name: true, logoUrl: true } } },
  });
  return customer;
};

const adminUsernameFromCustomer = async (customer) => {
  if (customer.cognitoSub) {
    // Prefer Username from AdminGetUser by filter — ListUsers by sub
    const listed = await cognitoClient.send(new ListUsersCommand({
      UserPoolId: USER_POOL_ID,
      Filter: `sub = "${customer.cognitoSub}"`,
      Limit: 1,
    }));
    const u = listed.Users?.[0]?.Username;
    if (u) return u;
  }
  if (customer.email) return customer.email;
  throw new Error('Cannot resolve Cognito username for customer');
};

const disableUser = async (customer) => {
  const Username = await adminUsernameFromCustomer(customer);
  await cognitoClient.send(new AdminDisableUserCommand({ UserPoolId: USER_POOL_ID, Username }));
  return prisma.customer.update({
    where: { id: customer.id },
    data: { accountStatus: 'DISABLED' },
  });
};

const enableUser = async (customer) => {
  const Username = await adminUsernameFromCustomer(customer);
  await cognitoClient.send(new AdminEnableUserCommand({ UserPoolId: USER_POOL_ID, Username }));
  return prisma.customer.update({
    where: { id: customer.id },
    data: { accountStatus: 'ACTIVE' },
  });
};

const deleteUser = async (customer) => {
  try {
    const Username = await adminUsernameFromCustomer(customer);
    await cognitoClient.send(new AdminDeleteUserCommand({ UserPoolId: USER_POOL_ID, Username }));
  } catch (err) {
    if (err?.name !== 'UserNotFoundException') throw err;
  }
  // Soft-detach Cognito identity; keep local row for gallery history unless hard-delete requested.
  return prisma.customer.update({
    where: { id: customer.id },
    data: { cognitoSub: null, accountStatus: 'DISABLED' },
  });
};

const resetPassword = async (customer) => {
  const Username = await adminUsernameFromCustomer(customer);
  await cognitoClient.send(new AdminResetUserPasswordCommand({
    UserPoolId: USER_POOL_ID,
    Username,
  }));
  return { ok: true, username: Username };
};

/**
 * Admin-invite: create Cognito user (email invite) + local Customer row.
 */
const adminCreateCustomer = async ({ email, name, phone, studioId, temporaryPassword }) => {
  if (!isConfigured()) throw new Error('Cognito is not configured');
  const Username = email.trim().toLowerCase();
  const attrs = [
    { Name: 'email', Value: Username },
    { Name: 'email_verified', Value: 'true' },
  ];
  if (name) attrs.push({ Name: 'name', Value: name });
  if (phone) attrs.push({ Name: 'phone_number', Value: phone });
  if (studioId) attrs.push({ Name: 'custom:studio_id', Value: studioId });

  const created = await cognitoClient.send(new AdminCreateUserCommand({
    UserPoolId: USER_POOL_ID,
    Username,
    UserAttributes: attrs,
    DesiredDeliveryMediums: ['EMAIL'],
    ...(temporaryPassword ? { TemporaryPassword: temporaryPassword } : {}),
  }));

  const subAttr = created.User?.Attributes?.find((a) => a.Name === 'sub');
  const cognitoSub = subAttr?.Value || null;

  if (temporaryPassword) {
    // Optional: mark password permanent if studio sets a known temp password.
    // Default leave FORCE_CHANGE_PASSWORD for first login.
  }

  return { cognitoSub, username: Username, userStatus: created.User?.UserStatus };
};

const getUserDetails = async (customer) => {
  const Username = await adminUsernameFromCustomer(customer);
  const out = await cognitoClient.send(new AdminGetUserCommand({
    UserPoolId: USER_POOL_ID,
    Username,
  }));
  const attrs = Object.fromEntries((out.UserAttributes || []).map((a) => [a.Name, a.Value]));
  return {
    username: out.Username,
    userStatus: out.UserStatus,
    enabled: out.Enabled,
    userCreateDate: out.UserCreateDate,
    userLastModifiedDate: out.UserLastModifiedDate,
    mfaOptions: out.MFAOptions || [],
    attributes: attrs,
  };
};

/** Public config for Flutter PKCE / Hosted UI (no secrets). */
const publicConfig = () => ({
  enabled: isEnabled(),
  region: REGION,
  userPoolId: USER_POOL_ID || null,
  clientId: CLIENT_ID || null,
  domain: DOMAIN || null,
  redirectUri: REDIRECT_URI || null,
  logoutUri: LOGOUT_URI || null,
  scopes: ['openid', 'email', 'profile'],
  // Hosted UI endpoints
  authorizeUrl: DOMAIN ? `https://${DOMAIN}/oauth2/authorize` : null,
  tokenUrl: DOMAIN ? `https://${DOMAIN}/oauth2/token` : null,
  logoutUrl: DOMAIN ? `https://${DOMAIN}/logout` : null,
  responseType: 'code',
  pkce: true,
});

module.exports = {
  isConfigured,
  isEnabled,
  verifyJWT,
  extractUser,
  createCustomerIfMissing,
  disableUser,
  enableUser,
  deleteUser,
  resetPassword,
  adminCreateCustomer,
  getUserDetails,
  publicConfig,
  USER_POOL_ID,
  CLIENT_ID,
  REGION,
};
