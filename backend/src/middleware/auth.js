const jwt = require('jsonwebtoken');
const { prisma } = require('../config/prisma');
const cognito = require('../services/cognito');
const { fail } = require('../lib/envelope');
const { CODES } = require('../lib/errors');
const { logger } = require('../utils/logger');

const authenticateAdmin = async (req, res, next) => {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const admin = await prisma.adminUser.findUnique({
      where: { id: decoded.id },
      include: { studio: true },
    });
    if (!admin) return res.status(401).json({ error: 'Invalid token' });
    req.admin = admin;
    req.studioId = admin.studioId;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

/**
 * Customer auth: Cognito access token (preferred) or legacy HS256 JWT.
 *
 * Cognito path:
 *  1. verifyJWT via JWKS
 *  2. extractUser
 *  3. createCustomerIfMissing
 *  4. reject DISABLED accounts
 */
const authenticateCustomer = async (req, res, next) => {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) {
    return fail(res, CODES.UNAUTHORIZED, 'No token provided', { status: 401 });
  }

  // ── Cognito JWT (access or id token) ────────────────────────────────────
  if (cognito.isEnabled()) {
    try {
      const payload = await cognito.verifyJWT(token);
      const identity = cognito.extractUser(payload);
      const customer = await cognito.createCustomerIfMissing(identity);

      if (customer.accountStatus === 'DISABLED') {
        return fail(res, CODES.UNAUTHORIZED, 'Account is disabled', { status: 403 });
      }

      req.customer = customer;
      req.studioId = customer.studioId;
      req.authProvider = 'cognito';
      req.cognitoSub = identity.sub;
      return next();
    } catch (err) {
      // Fall through to legacy only if token clearly isn't a Cognito JWT
      const isCognitoShaped = err?.code === 'ERR_JWT_CLAIM_VALIDATION_FAILED'
        || err?.code === 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED'
        || err?.code === 'ERR_JWT_EXPIRED'
        || err?.name === 'JWTExpired'
        || err?.code === 'TOKEN_INVALID'
        || (typeof err?.message === 'string' && /jwt|jws|jwks|token/i.test(err.message));

      if (isCognitoShaped && !process.env.COGNITO_ALLOW_LEGACY_FALLBACK) {
        logger.warn(`Cognito auth failed: ${err.message}`);
        return fail(res, CODES.UNAUTHORIZED, 'Invalid or expired token', { status: 401 });
      }
      // try legacy below when fallback enabled or unverified shape
    }
  }

  // ── Legacy local JWT (migration / offline) ──────────────────────────────
  if (process.env.COGNITO_ALLOW_LEGACY_FALLBACK === 'true' || !cognito.isEnabled()) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (decoded.type !== 'customer') {
        return fail(res, CODES.UNAUTHORIZED, 'Invalid token type', { status: 401 });
      }
      const customer = await prisma.customer.findUnique({ where: { id: decoded.id } });
      if (!customer) {
        return fail(res, CODES.UNAUTHORIZED, 'Customer not found', { status: 401 });
      }
      if (customer.accountStatus === 'DISABLED') {
        return fail(res, CODES.UNAUTHORIZED, 'Account is disabled', { status: 403 });
      }
      if (customer.isGuest && !decoded.guest) {
        return fail(res, CODES.UNAUTHORIZED, 'Sign in again with your client account to see assigned galleries.', { status: 401 });
      }
      if (decoded.guest) {
        // Guest JWTs support selfie search only. Gallery browsing/downloads must
        // use /share/guest so face matches and full-access codes stay enforced.
        if (!/\/face$/.test(req.baseUrl || '') || !decoded.galleryId) {
          return fail(res, CODES.FORBIDDEN, 'Open the guest share link to view your photos.', { status: 403 });
        }
        const now = new Date();
        const guest = await prisma.galleryGuest.findFirst({ where: {
          customerId: customer.id, galleryId: decoded.galleryId,
          shareLink: { active: true, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
            gallery: { studioId: customer.studioId, status: 'PUBLISHED', deletedAt: null,
              OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } },
        } });
        if (!guest) return fail(res, CODES.FORBIDDEN, 'This guest share link is unavailable or expired.', { status: 403 });
        req.guestGalleryId = decoded.galleryId;
      }
      req.customer = customer;
      req.studioId = customer.studioId;
      req.authProvider = 'legacy';
      return next();
    } catch {
      return fail(res, CODES.UNAUTHORIZED, 'Invalid token', { status: 401 });
    }
  }

  return fail(res, CODES.UNAUTHORIZED, 'Invalid token', { status: 401 });
};

/**
 * Ensure a gallery belongs to the authenticated customer's studio.
 * Use after loading a gallery (or grant.gallery).
 */
const assertSameStudio = (customerStudioId, resourceStudioId) => {
  if (!customerStudioId || !resourceStudioId || customerStudioId !== resourceStudioId) {
    const err = new Error('Cross-studio access denied');
    err.status = 403;
    err.code = CODES.GALLERY_NOT_ACCESSIBLE || 'GALLERY_NOT_ACCESSIBLE';
    throw err;
  }
};

const requireRole = (...roles) => (req, res, next) => {
  if (!req.admin || !roles.includes(req.admin.role)) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }
  next();
};

module.exports = {
  authenticateAdmin,
  authenticateCustomer,
  requireRole,
  assertSameStudio,
};
