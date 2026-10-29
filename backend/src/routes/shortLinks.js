const express = require('express');
const rateLimit = require('express-rate-limit');
const { prisma } = require('../config/prisma');
const { authenticateAdmin, authenticateCustomer, requireRole } = require('../middleware/auth');
const { ok, fail } = require('../lib/envelope');
const { CODES } = require('../lib/errors');
const { parseDestination, canShare, createShortLink, available, APP_URL } = require('../services/shortLinks');
const adminRouter = express.Router(), customerRouter = express.Router(), publicRouter = express.Router();
adminRouter.use(authenticateAdmin);
customerRouter.use(authenticateCustomer);
const createLimiter = rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false });
async function create(req, res) {
  const destination = parseDestination(req.body?.path);
  if (!destination) return fail(res, CODES.VALIDATION, 'Choose a valid app destination.', { status: 400 });
  if (!await canShare(destination, { studioId: req.studioId, customerId: req.customer?.id })) return fail(res, CODES.NOT_FOUND, 'This item is unavailable or you do not have access.', { status: 404 });
  return ok(res, await createShortLink({ studioId: req.studioId, path: destination.path }));
}
adminRouter.post('/', createLimiter, create);
customerRouter.post('/', createLimiter, create);
adminRouter.delete('/:id', requireRole('OWNER', 'MANAGER'), async (req, res) => {
  await prisma.shortLink.updateMany({ where: { id: req.params.id, studioId: req.studioId }, data: { active: false } });
  return ok(res, { revoked: true });
});
const resolveLimiter = rateLimit({ windowMs: 60 * 1000, limit: 180, standardHeaders: true, legacyHeaders: false });
async function resolve(req, res) {
  res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' });
  const token = req.params.token;
  const link = /^[A-Za-z0-9_-]{16}$/.test(token) ? await prisma.shortLink.findUnique({ where: { token } }) : null;
  let usable = available(link);
  if (usable) {
    const destination = parseDestination(link.path);
    if (destination) usable = await canShare(destination, { studioId: link.studioId });
    else {
      const target = new URL(link.path, APP_URL);
      usable = target.origin === new URL(APP_URL).origin && target.pathname === '/quotation-request' && target.searchParams.get('studioId') === link.studioId
        && !!await prisma.lead.findFirst({ where: { id: target.searchParams.get('requestId') || '', studioId: link.studioId }, select: { id: true } });
    }
  }
  if (!usable) {
    if (req.baseUrl === '/l') return res.redirect(302, `${APP_URL}/link-unavailable`);
    return fail(res, CODES.NOT_FOUND, 'This link has expired or is no longer available. Ask the studio for a new link.', { status: 404 });
  }
  // Destinations are server-generated local paths. Never accept redirect URLs from a request.
  if (req.baseUrl === '/l') {
    const target = new URL(link.path, APP_URL);
    // Keep private tracking credentials out of the browser address and history.
    const receipt = target.pathname === '/quotation-request' && target.searchParams.has('requestId');
    return res.redirect(302, receipt ? `${APP_URL}/r/${link.token}` : target.toString());
  }
  return ok(res, { path: link.path });
}
publicRouter.get('/:token', resolveLimiter, resolve);
module.exports = { adminRouter, customerRouter, publicRouter };
