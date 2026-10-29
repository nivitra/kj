const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body } = require('express-validator');
const rateLimit = require('express-rate-limit');
const { prisma } = require('../config/prisma');
const { ok, fail } = require('../lib/envelope');
const { CODES } = require('../lib/errors');
const { validate } = require('../lib/validate');
const cognito = require('../services/cognito');
const { authenticateCustomer } = require('../middleware/auth');

const router = express.Router();

// Tighter limiter specifically for credential-guessing on customer login / OTP.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  keyGenerator: (req) => {
    const id = (
      req.body?.phone ||
      req.body?.loginId ||
      req.body?.email ||
      ''
    ).toString().toLowerCase().replace(/\D/g, '') || 'x';
    return `${req.ip}:${id}`;
  },
});

/** OTP request limiter — prevent WhatsApp spam (5 / 15 min per IP+phone). */
const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  keyGenerator: (req) => {
    const p = String(req.body?.phone || '').replace(/\D/g, '') || 'x';
    return `otp:${req.ip}:${p}`;
  },
  message: { error: { code: 'RATE_LIMIT', message: 'Too many OTP requests. Try again later.' } },
});

// ── Public Cognito client config (Flutter PKCE / Hosted UI) ────────────────
router.get('/cognito/config', (req, res) => ok(res, cognito.publicConfig()));

/**
 * After Flutter completes Cognito OAuth (PKCE), it sends the access token here
 * to establish / sync the local Customer row. Also works as a lightweight
 * "whoami + provision" endpoint.
 */
router.post('/customer/session',
  loginLimiter,
  body('accessToken').isString().notEmpty(),
  validate,
  async (req, res) => {
    if (!cognito.isEnabled()) {
      return fail(res, CODES.VALIDATION, 'Cognito is not enabled on this server', { status: 503 });
    }
    try {
      const payload = await cognito.verifyJWT(req.body.accessToken);
      const identity = cognito.extractUser(payload);
      const customer = await cognito.createCustomerIfMissing(identity);
      if (customer.accountStatus === 'DISABLED') {
        return fail(res, CODES.UNAUTHORIZED, 'Account is disabled', { status: 403 });
      }
      return ok(res, {
        customer: {
          id: customer.id,
          name: customer.name,
          email: customer.email,
          phone: customer.phone,
          status: customer.status,
          emailVerified: customer.emailVerified,
          accountStatus: customer.accountStatus,
          cognitoSub: customer.cognitoSub,
          lastLoginAt: customer.lastLoginAt,
          studio: customer.studio,
        },
        authProvider: 'cognito',
      });
    } catch (err) {
      return fail(res, CODES.UNAUTHORIZED, err.message || 'Invalid Cognito token', { status: 401 });
    }
  });

// Validate current Bearer token (Cognito or legacy) + return full customer profile.
// Must include weddingExperience / package — app uses this as primary /me.
router.get('/customer/me', authenticateCustomer, async (req, res) => {
  try {
    const full = await prisma.customer.findUnique({
      where: { id: req.customer.id },
      include: {
        studio: { select: { id: true, name: true, logoUrl: true } },
        package: true,
        requestedPackage: true,
      },
    });
    if (!full) {
      return fail(res, CODES.UNAUTHORIZED, 'Customer not found', { status: 401 });
    }
    return ok(res, {
      customer: await customerPayload(full),
      authProvider: req.authProvider || 'cognito',
    });
  } catch (err) {
    return fail(res, CODES.INTERNAL, err.message || 'Profile load failed', { status: 500 });
  }
});

// Admin login (email + password) — unchanged, not Cognito.
router.post('/admin/login',
  body('email').isEmail(), body('password').isString().notEmpty(), validate,
  async (req, res) => {
    const { email, password } = req.body;
    const admin = await prisma.adminUser.findUnique({ where: { email }, include: { studio: true } });
    if (!admin || !(await bcrypt.compare(password, admin.passwordHash))) {
      return fail(res, CODES.UNAUTHORIZED, 'Invalid credentials', { status: 401 });
    }
    await prisma.adminUser.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } });
    const token = jwt.sign(
      { id: admin.id, studioId: admin.studioId, role: admin.role, type: 'admin' },
      process.env.JWT_SECRET,
      { expiresIn: process.env.ADMIN_JWT_EXPIRES_IN || '1d' }
    );
    return ok(res, { token, admin: { id: admin.id, name: admin.name, email: admin.email, role: admin.role, studio: admin.studio } });
  });

const crypto = require('crypto');
const { getRedis } = require('../config/redis');
const { hashPassword } = require('../services/credentials');
const { logger } = require('../utils/logger');

const mapPackageLite = (t) => {
  if (!t) return null;
  const basePrice = Number(t.basePrice != null ? t.basePrice : (t.price || 0));
  return {
    id: t.id,
    name: t.name || t.title || null,
    description: t.description || null,
    basePrice,
    priceLabel: basePrice > 0
      ? `₹${basePrice.toLocaleString('en-IN')} onwards`
      : 'Contact for price',
    includedPhotos: t.includedPhotos ?? null,
    pricePerExtraPhoto: t.pricePerExtraPhoto == null ? null : Number(t.pricePerExtraPhoto),
    workflowMode: t.workflowMode || null,
    active: t.active !== false,
  };
};

/** Full client profile for app session (login + /me). Includes wedding experience. */
const customerPayload = async (customer) => {
  let couplePhotoUrl = null;
  let weddingCoverUrl = null;
  let bookingPhotoUrl = null;
  try {
    const { getSignedPhotoUrl } = require('../services/s3');
    if (customer.couplePhotoKey) couplePhotoUrl = await getSignedPhotoUrl(customer.couplePhotoKey, 3600);
    if (customer.weddingCoverKey) weddingCoverUrl = await getSignedPhotoUrl(customer.weddingCoverKey, 3600);
    if (customer.bookingPhotoKey) bookingPhotoUrl = await getSignedPhotoUrl(customer.bookingPhotoKey, 3600);
  } catch (_) { /* non-fatal */ }

  return {
    id: customer.id,
    name: customer.name,
    email: customer.email,
    phone: customer.phone,
    loginId: customer.loginId,
    status: customer.status,
    emailVerified: customer.emailVerified,
    accountStatus: customer.accountStatus,
    cognitoSub: customer.cognitoSub || null,
    lastLoginAt: customer.lastLoginAt || null,
    studio: customer.studio
      ? { id: customer.studio.id, name: customer.studio.name, logoUrl: customer.studio.logoUrl }
      : null,
    package: mapPackageLite(customer.package),
    requestedPackage: mapPackageLite(customer.requestedPackage),
    // Wedding experience — app switches theme + WeddingHome when true
    weddingExperience: !!customer.weddingExperience,
    brideName: customer.brideName || null,
    groomName: customer.groomName || null,
    weddingDate: customer.weddingDate || null,
    weddingVenue: customer.weddingVenue || null,
    couplePhotoUrl,
    weddingCoverUrl,
    bookingPhotoUrl,
    albumStatus: customer.albumStatus || null,
    deliveryStatus: customer.deliveryStatus || null,
    photographerName: customer.photographerName || null,
    cinematographerName: customer.cinematographerName || null,
    weddingNotes: customer.weddingNotes || null,
  };
};

const issueCustomerToken = (customer) => jwt.sign(
  { id: customer.id, studioId: customer.studioId, type: 'customer' },
  process.env.JWT_SECRET,
  { expiresIn: process.env.JWT_EXPIRES_IN || '7d' },
);

const findDefaultStudioId = async () => {
  if (process.env.COGNITO_DEFAULT_STUDIO_ID) return process.env.COGNITO_DEFAULT_STUDIO_ID;
  const s = await prisma.studio.findFirst({ orderBy: { createdAt: 'asc' } });
  return s?.id || null;
};

/** Digits-only phone for storage / login lookup (India 10-digit → 91…). */
function normalizeCustomerPhone(raw) {
  if (!raw) return null;
  let s = String(raw).trim().split('#')[0];
  s = s.replace(/[^\d+]/g, '');
  if (s.startsWith('+')) s = s.slice(1);
  s = s.replace(/\D/g, '');
  if (s.length === 10 && /^[6-9]/.test(s)) s = `91${s}`;
  return s.length >= 8 && s.length <= 15 ? s : null;
}

/**
 * Find customer by normalized phone (or last-10 match when unique).
 */
async function findCustomerByPhone(phoneNorm, phoneRaw) {
  if (!phoneNorm) return null;
  // Studio-issued login IDs are unique; guests reuse phone numbers but must
  // never become the account used for a client's selection gallery.
  for (const loginId of [...new Set([phoneNorm, phoneRaw].filter(Boolean))]) {
    const registered = await prisma.customer.findUnique({ where: { loginId }, include: { studio: true } });
    if (registered && !registered.isGuest) return registered;
  }
  const exact = await prisma.customer.findMany({ where: { isGuest: false,
    OR: [{ phone: phoneNorm }, ...(phoneRaw ? [{ phone: phoneRaw }] : [])] }, include: { studio: true }, take: 2 });
  if (exact.length) return exact.length === 1 ? exact[0] : null;
  if (phoneNorm.length < 10) return null;
  const last10 = phoneNorm.slice(-10);
  const candidates = await prisma.customer.findMany({ where: { isGuest: false,
    OR: [{ phone: { endsWith: last10 } }, { loginId: { endsWith: last10 } }] }, include: { studio: true }, take: 2 });
  return candidates.length === 1 ? candidates[0] : null;
}

/**
 * Customer sign-in — phone (primary) or legacy loginId + password.
 */
router.post('/customer/login',
  loginLimiter,
  body('password').isString().notEmpty(),
  body('loginId').optional({ nullable: true }).isString(),
  body('phone').optional({ nullable: true }).isString(),
  // legacy clients may still send email field as phone box
  body('email').optional({ nullable: true }).isString(),
  validate,
  async (req, res) => {
    if (cognito.isEnabled() && process.env.COGNITO_ALLOW_LEGACY_FALLBACK !== 'true') {
      return fail(res, CODES.VALIDATION,
        'Use Sign in on the app home screen.',
        { status: 400 });
    }
    const password = req.body.password;
    const loginId = (req.body.loginId || '').trim();
    const phoneRaw = (req.body.phone || loginId || req.body.email || '').trim();
    const phoneNorm = normalizeCustomerPhone(phoneRaw);
    if (!phoneNorm && !loginId) {
      return fail(res, CODES.VALIDATION, 'Phone number is required', { status: 400 });
    }

    let customer = null;
    if (phoneNorm) {
      customer = await findCustomerByPhone(phoneNorm, phoneRaw);
    }
    // Legacy loginId (admin-created accounts that used name-based IDs)
    if (!customer && loginId && !loginId.includes('@')) {
      customer = await prisma.customer.findUnique({
        where: { loginId },
        include: { studio: true },
      });
    }

    if (!customer || customer.isGuest || !customer.passwordHash || !(await bcrypt.compare(password, customer.passwordHash))) {
      return fail(res, CODES.UNAUTHORIZED, 'Invalid phone number or password', { status: 401 });
    }
    if (customer.accountStatus === 'DISABLED') {
      return fail(res, CODES.UNAUTHORIZED, 'Account is disabled', { status: 403 });
    }
    await prisma.customer.update({ where: { id: customer.id }, data: { lastLoginAt: new Date() } });
    // Reload with package/studio for full wedding profile
    const full = await prisma.customer.findUnique({
      where: { id: customer.id },
      include: {
        studio: { select: { id: true, name: true, logoUrl: true } },
        package: true,
        requestedPackage: true,
      },
    });
    return ok(res, {
      token: issueCustomerToken(customer),
      customer: await customerPayload(full || customer),
      authProvider: 'password',
    });
  });

/** Public registration — name + phone + password only (no email). */
router.post('/customer/register',
  loginLimiter,
  body('name').isString().trim().isLength({ min: 1, max: 120 }),
  body('phone').isString().trim().isLength({ min: 8, max: 20 }),
  body('password').isString().isLength({ min: 8, max: 128 }),
  validate,
  async (req, res) => {
    if (cognito.isEnabled() && process.env.COGNITO_ALLOW_LEGACY_FALLBACK !== 'true') {
      return fail(res, CODES.VALIDATION, 'Create your account via Sign up on the app.', { status: 400 });
    }
    const name = req.body.name.trim();
    const phone = normalizeCustomerPhone(req.body.phone);
    if (!phone) {
      return fail(res, CODES.VALIDATION, 'Enter a valid phone number with country code (e.g. 9198…)', { status: 400 });
    }

    const studioId = await findDefaultStudioId();
    if (!studioId) return fail(res, CODES.VALIDATION, 'Studio is not configured yet', { status: 503 });

    const phoneTaken = await prisma.customer.findFirst({
      where: { studioId, phone },
    });
    if (phoneTaken) {
      return fail(res, CODES.CONFLICT, 'An account with this phone already exists. Sign in instead.', { status: 409 });
    }

    // Phone is loginId
    let loginId = phone;
    const loginTaken = await prisma.customer.findUnique({ where: { loginId } });
    if (loginTaken) {
      loginId = `${phone}_${Date.now().toString(36).slice(-4)}`;
    }

    const passwordHash = await hashPassword(req.body.password);
    const customer = await prisma.customer.create({
      data: {
        studioId,
        name,
        email: null,
        phone,
        loginId,
        passwordHash,
        emailVerified: false,
        accountStatus: 'ACTIVE',
        status: 'Welcome to SJ Studios.',
      },
      include: { studio: true, package: true, requestedPackage: true },
    });
    return ok(res, {
      token: issueCustomerToken(customer),
      customer: await customerPayload(customer),
      authProvider: 'password',
      message: 'Account created. Sign in with your phone number and password.',
    }, 201);
  });

/**
 * Request password-reset OTP via WhatsApp to the account phone.
 * Always returns 200 (no account enumeration).
 */
router.post('/customer/forgot-password',
  otpLimiter,
  body('phone').isString().trim().isLength({ min: 8, max: 20 }),
  validate,
  async (req, res) => {
    const phone = normalizeCustomerPhone(req.body.phone);
    const generic = {
      message: 'If an account exists for this phone, a 6-digit code was sent on WhatsApp. It expires in 10 minutes.',
      channel: 'whatsapp',
      expiresInSec: 600,
    };
    if (!phone) {
      return ok(res, generic);
    }

    const redis = getRedis();
    // Cooldown: 45s between OTPs for same phone
    const coolKey = `pwdreset:cool:${phone}`;
    const cool = await redis.get(coolKey);
    if (cool) {
      return ok(res, {
        ...generic,
        message: 'A code was already sent. Wait about a minute before requesting another.',
        cooldownSec: 45,
      });
    }

    const customer = await findCustomerByPhone(phone, req.body.phone);
    if (!customer || !customer.passwordHash || customer.accountStatus === 'DISABLED') {
      // Same response timing roughly — tiny delay
      await new Promise((r) => setTimeout(r, 200));
      return ok(res, generic);
    }

    const code = String(100000 + crypto.randomInt(900000));
    const studioName = customer.studio?.name || 'Studio';
    await redis.setex(
      `pwdreset:phone:${phone}`,
      10 * 60,
      JSON.stringify({
        customerId: customer.id,
        code,
        attempts: 0,
        phone,
      }),
    );
    await redis.setex(coolKey, 45, '1');

    // Send OTP on WhatsApp (skip long typing for speed)
    let sent = false;
    let sendError = null;
    try {
      const wa = require('../services/whatsapp');
      const text =
        `*${code}* is your password reset code\n\n` +
        `${studioName}\n` +
        `Valid for 10 minutes. Do not share this code with anyone.\n` +
        `If you didn't request this, ignore this message.`;
      const log = await wa.sendText({
        studioId: customer.studioId,
        phone,
        text,
        toName: customer.name,
        source: 'AUTO',
        skipTyping: true,
        skipDailyQuota: true,
        meta: { kind: 'PASSWORD_RESET_OTP' },
      });
      sent = log?.status === 'SENT';
      if (!sent) sendError = log?.error || 'WhatsApp send failed';
    } catch (err) {
      sendError = err.message;
      logger.error(`[auth] WhatsApp OTP failed for ${phone}: ${err.message}`);
    }

    if (!sent) {
      // Don't leave a dangling OTP if we couldn't deliver
      await redis.del(`pwdreset:phone:${phone}`).catch(() => {});
      await redis.del(coolKey).catch(() => {});
      logger.warn(`[auth] OTP not delivered to ${phone}: ${sendError}`);
      return fail(res, CODES.INTERNAL,
        'Could not send WhatsApp code. Make sure the studio WhatsApp is connected, or ask the studio to reset your password.',
        { status: 503 });
    }

    logger.info(`[auth] Password reset OTP sent via WhatsApp to ${phone}`);
    const debugCode = process.env.EXPOSE_RESET_CODES === 'true' ? code : undefined;
    return ok(res, {
      ...generic,
      ...(debugCode ? { debugCode } : {}),
    });
  });

/**
 * Complete password reset with phone + WhatsApp OTP + new password.
 */
router.post('/customer/reset-password',
  loginLimiter,
  body('phone').isString().trim().isLength({ min: 8, max: 20 }),
  body('code').isString().trim().isLength({ min: 4, max: 12 }),
  body('password').isString().isLength({ min: 8, max: 128 }),
  validate,
  async (req, res) => {
    const phone = normalizeCustomerPhone(req.body.phone);
    if (!phone) {
      return fail(res, CODES.VALIDATION, 'Enter a valid phone number', { status: 400 });
    }
    const redis = getRedis();
    const key = `pwdreset:phone:${phone}`;
    const raw = await redis.get(key);
    if (!raw) {
      return fail(res, CODES.VALIDATION, 'Code expired or invalid. Request a new one.', { status: 400 });
    }
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      await redis.del(key);
      return fail(res, CODES.VALIDATION, 'Code expired or invalid. Request a new one.', { status: 400 });
    }

    const attempts = (data.attempts || 0) + 1;
    if (attempts > 8) {
      await redis.del(key);
      return fail(res, CODES.VALIDATION, 'Too many wrong attempts. Request a new code.', { status: 400 });
    }

    if (String(data.code) !== String(req.body.code).trim()) {
      await redis.setex(key, 10 * 60, JSON.stringify({ ...data, attempts }));
      return fail(res, CODES.VALIDATION, 'Invalid code. Check WhatsApp and try again.', { status: 400 });
    }

    const passwordHash = await hashPassword(req.body.password);
    await prisma.customer.update({
      where: { id: data.customerId },
      data: { passwordHash },
    });
    await redis.del(key);
    await redis.del(`pwdreset:cool:${phone}`).catch(() => {});
    return ok(res, { message: 'Password updated. You can sign in with your phone number now.' });
  });

async function sendWhatsAppOtp({
  studioId, studioName, phone, toName, kind, code,
}) {
  const wa = require('../services/whatsapp');
  const brand = studioName || 'Studio';
  const first = (toName || '').trim().split(/\s+/)[0] || 'there';
  const text = kind === 'SIGNUP_OTP'
    ? `*${code}* is your signup code\n\nHi ${first} — ${brand}\nValid for 10 minutes. Do not share this code.`
    : `*${code}* is your login code\n\n${brand}\nValid for 10 minutes. Do not share this code.\nIf you didn't request this, ignore this message.`;
  const log = await wa.sendText({
    studioId,
    phone,
    text,
    toName: toName || undefined,
    source: 'AUTO',
    skipTyping: true,
    skipDailyQuota: true,
    meta: { kind },
  });
  return { sent: log?.status === 'SENT', error: log?.error || null };
}

/**
 * Sign up — name + WhatsApp number, then verify the 6-digit code.
 */
router.post('/customer/signup-otp',
  otpLimiter,
  body('name').isString().trim().isLength({ min: 2, max: 120 }),
  body('phone').isString().trim().isLength({ min: 8, max: 20 }),
  validate,
  async (req, res) => {
    const name = String(req.body.name || '').trim();
    const phone = normalizeCustomerPhone(req.body.phone);
    if (!phone) {
      return fail(res, CODES.VALIDATION, 'Enter a valid WhatsApp number', { status: 400 });
    }

    const existing = await findCustomerByPhone(phone, req.body.phone);
    if (existing) {
      if (existing.accountStatus === 'DISABLED') {
        return fail(res, CODES.UNAUTHORIZED, 'This account is disabled. Contact the studio.', { status: 403 });
      }
      return fail(
        res,
        CODES.CONFLICT,
        'This WhatsApp number already has an account. Sign in instead.',
        { status: 409 },
      );
    }

    const studioId = await findDefaultStudioId();
    if (!studioId) return fail(res, CODES.VALIDATION, 'Studio is not configured yet', { status: 503 });
    const studio = await prisma.studio.findUnique({
      where: { id: studioId },
      select: { id: true, name: true },
    });

    const redis = getRedis();
    const coolKey = `signupotp:cool:${phone}`;
    if (await redis.get(coolKey)) {
      return ok(res, {
        message: 'A code was already sent. Wait about a minute before requesting another.',
        channel: 'whatsapp',
        expiresInSec: 600,
        cooldownSec: 45,
      });
    }

    const code = String(100000 + crypto.randomInt(900000));
    await redis.setex(
      `signupotp:phone:${phone}`,
      10 * 60,
      JSON.stringify({ name, phone, code, attempts: 0, studioId }),
    );
    await redis.setex(coolKey, 45, '1');

    let sent = false;
    let sendError = null;
    try {
      const r = await sendWhatsAppOtp({
        studioId,
        studioName: studio?.name || 'Studio',
        phone,
        toName: name,
        kind: 'SIGNUP_OTP',
        code,
      });
      sent = r.sent;
      sendError = r.error;
    } catch (err) {
      sendError = err.message;
      logger.error(`[auth] Signup OTP WhatsApp failed for ${phone}: ${err.message}`);
    }

    if (!sent) {
      await redis.del(`signupotp:phone:${phone}`).catch(() => {});
      await redis.del(coolKey).catch(() => {});
      logger.warn(`[auth] Signup OTP not delivered to ${phone}: ${sendError}`);
      return fail(
        res,
        CODES.INTERNAL,
        'Could not send WhatsApp code. Make sure the number is on WhatsApp, or try again shortly.',
        { status: 503 },
      );
    }

    logger.info(`[auth] Signup OTP sent via WhatsApp to ${phone}`);
    const debugCode = process.env.EXPOSE_RESET_CODES === 'true' ? code : undefined;
    return ok(res, {
      message: 'We sent a 6-digit code to WhatsApp.',
      channel: 'whatsapp',
      expiresInSec: 600,
      ...(debugCode ? { debugCode } : {}),
    });
  });

/**
 * Complete WhatsApp signup — create account + session.
 */
router.post('/customer/signup-otp-verify',
  loginLimiter,
  body('phone').isString().trim().isLength({ min: 8, max: 20 }),
  body('code').isString().trim().isLength({ min: 4, max: 12 }),
  body('name').optional({ nullable: true }).isString(),
  validate,
  async (req, res) => {
    const phone = normalizeCustomerPhone(req.body.phone);
    if (!phone) {
      return fail(res, CODES.VALIDATION, 'Enter a valid WhatsApp number', { status: 400 });
    }
    const redis = getRedis();
    const key = `signupotp:phone:${phone}`;
    const raw = await redis.get(key);
    if (!raw) {
      return fail(res, CODES.VALIDATION, 'Code expired or invalid. Request a new one.', { status: 400 });
    }
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      await redis.del(key);
      return fail(res, CODES.VALIDATION, 'Code expired or invalid. Request a new one.', { status: 400 });
    }

    const attempts = (data.attempts || 0) + 1;
    if (attempts > 8) {
      await redis.del(key);
      return fail(res, CODES.VALIDATION, 'Too many wrong attempts. Request a new code.', { status: 400 });
    }
    if (String(data.code) !== String(req.body.code).trim()) {
      await redis.setex(key, 10 * 60, JSON.stringify({ ...data, attempts }));
      return fail(res, CODES.VALIDATION, 'Invalid code. Check WhatsApp and try again.', { status: 400 });
    }

    const taken = await findCustomerByPhone(phone, req.body.phone);
    if (taken) {
      await redis.del(key);
      return fail(
        res,
        CODES.CONFLICT,
        'This WhatsApp number already has an account. Sign in instead.',
        { status: 409 },
      );
    }

    const studioId = data.studioId || await findDefaultStudioId();
    if (!studioId) return fail(res, CODES.VALIDATION, 'Studio is not configured yet', { status: 503 });

    const name = String(data.name || req.body.name || '').trim() || 'Client';
    let loginId = phone;
    const loginTaken = await prisma.customer.findUnique({ where: { loginId } });
    if (loginTaken) loginId = `${phone}_${Date.now().toString(36).slice(-4)}`;

    const customer = await prisma.customer.create({
      data: {
        studioId,
        name,
        email: null,
        phone,
        loginId,
        passwordHash: null,
        emailVerified: false,
        accountStatus: 'ACTIVE',
        status: 'Welcome to SJ Studios.',
        lastLoginAt: new Date(),
      },
      include: {
        studio: { select: { id: true, name: true, logoUrl: true } },
        package: true,
        requestedPackage: true,
      },
    });

    await redis.del(key);
    await redis.del(`signupotp:cool:${phone}`).catch(() => {});

    logger.info(`[auth] WhatsApp signup created customer=${customer.id} phone=${phone}`);
    return ok(res, {
      token: issueCustomerToken(customer),
      customer: await customerPayload(customer),
      authProvider: 'otp',
      message: 'Account created',
    }, 201);
  });

/**
 * Request login OTP via WhatsApp (passwordless sign-in).
 */
router.post('/customer/otp-request',
  otpLimiter,
  body('phone').isString().trim().isLength({ min: 8, max: 20 }),
  validate,
  async (req, res) => {
    const phone = normalizeCustomerPhone(req.body.phone);
    if (!phone) {
      return fail(res, CODES.VALIDATION, 'Enter a valid WhatsApp number', { status: 400 });
    }

    const redis = getRedis();
    const coolKey = `loginotp:cool:${phone}`;
    if (await redis.get(coolKey)) {
      return ok(res, {
        message: 'A code was already sent. Wait about a minute before requesting another.',
        channel: 'whatsapp',
        expiresInSec: 600,
        cooldownSec: 45,
      });
    }

    const customer = await findCustomerByPhone(phone, req.body.phone);
    if (!customer) {
      return fail(
        res,
        CODES.NOT_FOUND,
        'No account for this WhatsApp number. Sign up first.',
        { status: 404 },
      );
    }
    if (customer.accountStatus === 'DISABLED') {
      return fail(res, CODES.UNAUTHORIZED, 'This account is disabled. Contact the studio.', { status: 403 });
    }

    const code = String(100000 + crypto.randomInt(900000));
    const studioName = customer.studio?.name || 'Studio';
    await redis.setex(
      `loginotp:phone:${phone}`,
      10 * 60,
      JSON.stringify({ customerId: customer.id, code, attempts: 0, phone }),
    );
    await redis.setex(coolKey, 45, '1');

    let sent = false;
    let sendError = null;
    try {
      const wa = require('../services/whatsapp');
      const text =
        `*${code}* is your login code\n\n` +
        `${studioName}\n` +
        `Valid for 10 minutes. Do not share this code.\n` +
        `If you didn't request this, ignore this message.`;
      const log = await wa.sendText({
        studioId: customer.studioId,
        phone,
        text,
        toName: customer.name,
        source: 'AUTO',
        skipTyping: true,
        skipDailyQuota: true,
        meta: { kind: 'LOGIN_OTP' },
      });
      sent = log?.status === 'SENT';
      if (!sent) sendError = log?.error || 'WhatsApp send failed';
    } catch (err) {
      sendError = err.message;
      logger.error(`[auth] Login OTP WhatsApp failed for ${phone}: ${err.message}`);
    }

    if (!sent) {
      await redis.del(`loginotp:phone:${phone}`).catch(() => {});
      await redis.del(coolKey).catch(() => {});
      logger.warn(`[auth] Login OTP not delivered to ${phone}: ${sendError}`);
      return fail(res, CODES.INTERNAL,
        'Could not send WhatsApp code. Try password sign-in, or ask the studio to check WhatsApp.',
        { status: 503 });
    }

    logger.info(`[auth] Login OTP sent via WhatsApp to ${phone}`);
    const debugCode = process.env.EXPOSE_RESET_CODES === 'true' ? code : undefined;
    return ok(res, {
      message: 'Code sent on WhatsApp',
      channel: 'whatsapp',
      expiresInSec: 600,
      cooldownSec: 45,
      ...(debugCode ? { debugCode } : {}),
    });
  });

/**
 * Complete passwordless login with phone + WhatsApp OTP.
 */
router.post('/customer/otp-login',
  loginLimiter,
  body('phone').isString().trim().isLength({ min: 8, max: 20 }),
  body('code').isString().trim().isLength({ min: 4, max: 12 }),
  validate,
  async (req, res) => {
    const phone = normalizeCustomerPhone(req.body.phone);
    if (!phone) {
      return fail(res, CODES.VALIDATION, 'Enter a valid phone number', { status: 400 });
    }
    const redis = getRedis();
    const key = `loginotp:phone:${phone}`;
    const raw = await redis.get(key);
    if (!raw) {
      return fail(res, CODES.VALIDATION, 'Code expired or invalid. Request a new one.', { status: 400 });
    }
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      await redis.del(key);
      return fail(res, CODES.VALIDATION, 'Code expired or invalid. Request a new one.', { status: 400 });
    }

    const attempts = (data.attempts || 0) + 1;
    if (attempts > 8) {
      await redis.del(key);
      return fail(res, CODES.VALIDATION, 'Too many wrong attempts. Request a new code.', { status: 400 });
    }
    if (String(data.code) !== String(req.body.code).trim()) {
      await redis.setex(key, 10 * 60, JSON.stringify({ ...data, attempts }));
      return fail(res, CODES.VALIDATION, 'Invalid code. Check WhatsApp and try again.', { status: 400 });
    }

    const customer = await prisma.customer.findUnique({
      where: { id: data.customerId },
      include: {
        studio: { select: { id: true, name: true, logoUrl: true } },
        package: true,
        requestedPackage: true,
      },
    });
    if (!customer || customer.accountStatus === 'DISABLED') {
      await redis.del(key);
      return fail(res, CODES.UNAUTHORIZED, 'Account unavailable', { status: 403 });
    }

    await redis.del(key);
    await redis.del(`loginotp:cool:${phone}`).catch(() => {});
    await prisma.customer.update({
      where: { id: customer.id },
      data: { lastLoginAt: new Date() },
    });

    return ok(res, {
      token: issueCustomerToken(customer),
      customer: await customerPayload(customer),
      authProvider: 'otp',
    });
  });

// First-time studio + owner setup (only when no studio exists yet).
router.post('/admin/setup',
  body('studioName').isString().notEmpty(), body('adminName').isString().notEmpty(),
  body('email').isEmail(), body('password').isLength({ min: 8 }), validate,
  async (req, res) => {
    const { studioName, adminName, email, password, studioPhone } = req.body;
    const existing = await prisma.studio.findFirst();
    if (existing) return fail(res, CODES.CONFLICT, 'Studio already set up', { status: 400 });

    const passwordHash = await bcrypt.hash(password, 12);
    const studio = await prisma.studio.create({
      data: {
        name: studioName, email, phone: studioPhone,
        admins: { create: { email, passwordHash, name: adminName, role: 'OWNER' } },
        pricing: { create: {} },
      },
    });
    return ok(res, { studioId: studio.id });
  });

module.exports = router;
