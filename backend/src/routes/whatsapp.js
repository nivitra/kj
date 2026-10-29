/**
 * Admin WhatsApp (Baileys) — session QR, templates, send, bulk, logs.
 */
const express = require('express');
const { body } = require('express-validator');
const { prisma } = require('../config/prisma');
const { authenticateAdmin } = require('../middleware/auth');
const { ok, fail } = require('../lib/envelope');
const { CODES } = require('../lib/errors');
const { validate } = require('../lib/validate');
const wa = require('../services/whatsapp');

const router = express.Router();
router.use(authenticateAdmin);

function mapTemplate(t) {
  return {
    id: t.id,
    key: t.key,
    name: t.name,
    description: t.description,
    body: t.body,
    category: t.category,
    trigger: t.trigger,
    active: t.active,
    isSystem: t.isSystem,
    sortOrder: t.sortOrder,
    updatedAt: t.updatedAt,
    createdAt: t.createdAt,
  };
}

function mapLog(m) {
  return {
    id: m.id,
    toPhone: m.toPhone,
    toName: m.toName,
    body: m.body,
    status: m.status,
    error: m.error,
    source: m.source,
    templateKey: m.templateKey,
    campaignId: m.campaignId,
    sentAt: m.sentAt,
    createdAt: m.createdAt,
    meta: m.meta,
  };
}

// ── Session ────────────────────────────────────────────────────────────────

router.get('/status', async (req, res) => {
  await wa.ensureDefaultTemplates(req.studioId);
  const status = await wa.getStatus(req.studioId);
  return ok(res, {
    session: status,
    placeholders: wa.PLACEHOLDERS,
    triggers: [
      { key: 'GUEST_REGISTERED', label: 'Guest scanned QR + entered details' },
      { key: 'GUEST_FULL_ACCESS', label: 'Guest unlocked full access' },
      { key: 'INVOICE_SENT', label: 'Invoice finalized / sent' },
      { key: 'INVOICE_INSTALLMENT_PAID', label: 'Installment marked paid' },
      { key: 'BOOKING_UPDATE', label: 'Booking status changed' },
      { key: 'LEAD_RECEIVED', label: 'New enquiry / lead' },
      { key: 'LEAD_UPDATED', label: 'Enquiry status updated' },
      { key: 'GALLERY_PUBLISHED', label: 'Gallery published' },
    ],
  });
});

router.post('/connect', async (req, res) => {
  try {
    const status = await wa.connectStudio(req.studioId);
    return ok(res, { session: status });
  } catch (err) {
    return fail(res, CODES.INTERNAL, err.message || 'Could not start WhatsApp', { status: 500 });
  }
});

router.post('/disconnect', async (req, res) => {
  const logout = req.body?.logout === true;
  const status = await wa.disconnectStudio(req.studioId, { logout });
  return ok(res, { session: status });
});

router.patch('/settings', async (req, res) => {
  const data = {};
  if (req.body.autoSendEnabled !== undefined) data.autoSendEnabled = !!req.body.autoSendEnabled;
  if (req.body.typingMinMs != null) {
    // Keep typing in the human 12–30s band
    data.typingMinMs = Math.max(12000, Math.min(30000, parseInt(req.body.typingMinMs, 10) || 15000));
  }
  if (req.body.typingMaxMs != null) {
    data.typingMaxMs = Math.max(12000, Math.min(35000, parseInt(req.body.typingMaxMs, 10) || 20000));
  }
  if (data.typingMinMs != null && data.typingMaxMs != null && data.typingMinMs > data.typingMaxMs) {
    const t = data.typingMinMs;
    data.typingMinMs = data.typingMaxMs;
    data.typingMaxMs = t;
  }
  if (req.body.dailyTouchpointLimit != null) {
    // Hard product rule: never above 80 new touchpoints / day
    data.dailyTouchpointLimit = Math.max(
      1,
      Math.min(80, parseInt(req.body.dailyTouchpointLimit, 10) || 80),
    );
  }
  await wa.upsertSessionRow(req.studioId, data);
  return ok(res, { session: await wa.getStatus(req.studioId) });
});

// ── Templates ──────────────────────────────────────────────────────────────

router.get('/templates', async (req, res) => {
  await wa.ensureDefaultTemplates(req.studioId);
  const list = await prisma.whatsAppTemplate.findMany({
    where: { studioId: req.studioId },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });
  return ok(res, { templates: list.map(mapTemplate) });
});

router.post(
  '/templates',
  body('name').isString().trim().isLength({ min: 2, max: 80 }),
  body('body').isString().trim().isLength({ min: 1, max: 4000 }),
  validate,
  async (req, res) => {
    const name = String(req.body.name).trim();
    let key = (req.body.key || name)
      .toString()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 40);
    if (!key) key = `CUSTOM_${Date.now().toString(36).toUpperCase()}`;

    try {
      const t = await prisma.whatsAppTemplate.create({
        data: {
          studioId: req.studioId,
          key,
          name,
          description: req.body.description || null,
          body: String(req.body.body),
          category: (req.body.category || 'GENERAL').toString().slice(0, 40),
          trigger: req.body.trigger || null,
          active: req.body.active !== false,
          isSystem: false,
          sortOrder: req.body.sortOrder != null ? parseInt(req.body.sortOrder, 10) : 200,
        },
      });
      return ok(res, { template: mapTemplate(t) }, 201);
    } catch (e) {
      if (e.code === 'P2002') {
        return fail(res, CODES.CONFLICT, 'Template key already exists', { status: 409 });
      }
      throw e;
    }
  },
);

router.patch('/templates/:id', async (req, res) => {
  const existing = await prisma.whatsAppTemplate.findFirst({
    where: { id: req.params.id, studioId: req.studioId },
  });
  if (!existing) return fail(res, CODES.NOT_FOUND, 'Template not found', { status: 404 });

  const data = {};
  if (req.body.name !== undefined) data.name = String(req.body.name).slice(0, 80);
  if (req.body.description !== undefined) data.description = req.body.description || null;
  if (req.body.body !== undefined) data.body = String(req.body.body).slice(0, 4000);
  if (req.body.category !== undefined) data.category = String(req.body.category).slice(0, 40);
  if (req.body.trigger !== undefined) data.trigger = req.body.trigger || null;
  if (req.body.active !== undefined) data.active = !!req.body.active;
  if (req.body.sortOrder !== undefined) data.sortOrder = parseInt(req.body.sortOrder, 10) || 0;

  const t = await prisma.whatsAppTemplate.update({ where: { id: existing.id }, data });
  return ok(res, { template: mapTemplate(t) });
});

router.delete('/templates/:id', async (req, res) => {
  const existing = await prisma.whatsAppTemplate.findFirst({
    where: { id: req.params.id, studioId: req.studioId },
  });
  if (!existing) return fail(res, CODES.NOT_FOUND, 'Template not found', { status: 404 });
  if (existing.isSystem) {
    // Soft-disable system templates instead of delete
    await prisma.whatsAppTemplate.update({
      where: { id: existing.id },
      data: { active: false },
    });
    return ok(res, { deactivated: true });
  }
  await prisma.whatsAppTemplate.delete({ where: { id: existing.id } });
  return ok(res, { deleted: true });
});

router.post('/templates/preview', async (req, res) => {
  const body = String(req.body.body || '');
  const vars = req.body.vars || {
    name: 'Priya',
    phone: '919876543210',
    studioName: 'SJ Studio',
    galleryName: 'Priya & Arjun Wedding',
    invoiceNumber: 'INV-1001',
    totalAmount: '100000',
    balance: '60000',
    paidAmount: '40000',
    installmentLabel: 'Booking advance',
    currency: 'INR',
    bookingStatus: 'Shoot scheduled',
    notes: 'See you on the 12th!',
    message: 'Looking forward to working with you.',
    packageTitle: ' — Wedding Gold',
    leadStatus: 'CONTACTED',
  };
  return ok(res, { preview: wa.renderTemplate(body, vars) });
});

// ── Send ───────────────────────────────────────────────────────────────────

router.post(
  '/send',
  body('phone').isString().trim().isLength({ min: 8, max: 20 }),
  validate,
  async (req, res) => {
    const { phone, name, templateKey, body: rawBody, vars } = req.body || {};
    try {
      const st = await wa.getStatus(req.studioId);
      if (!st.online) {
        return fail(res, CODES.VALIDATION, 'WhatsApp is offline — connect first', { status: 400 });
      }
      if (st.quota?.exhausted) {
        return fail(
          res,
          CODES.VALIDATION,
          `Daily limit of ${st.quota.limit} messages reached. Resets ${st.quota.resetsAt}`,
          { status: 429 },
        );
      }
      if (!wa.normalizePhone(phone)) {
        return fail(
          res,
          CODES.VALIDATION,
          'Invalid phone — include country code (e.g. 9198… for India)',
          { status: 400 },
        );
      }

      let log;
      if (templateKey) {
        log = await wa.sendTemplate({
          studioId: req.studioId,
          phone,
          toName: name || null,
          templateKey,
          vars: vars || {},
          source: 'MANUAL',
        });
      } else {
        if (!rawBody || !String(rawBody).trim()) {
          return fail(res, CODES.VALIDATION, 'body or templateKey required', { status: 400 });
        }
        const studio = await prisma.studio.findUnique({
          where: { id: req.studioId },
          include: { profile: true },
        });
        const text = wa.renderTemplate(rawBody, {
          name: name || 'there',
          phone: wa.normalizePhone(phone),
          studioName: studio?.profile?.displayName || studio?.name || 'Studio',
          ...(vars || {}),
        });
        log = await wa.sendText({
          studioId: req.studioId,
          phone,
          text,
          toName: name || null,
          source: 'MANUAL',
        });
      }
      return ok(res, {
        message: log ? mapLog(log) : null,
        quota: await wa.getDailyQuota(req.studioId),
      });
    } catch (err) {
      return fail(res, CODES.INTERNAL, err.message || 'Send failed', { status: err.status || 500 });
    }
  },
);

router.post(
  '/bulk',
  body('recipients').isArray({ min: 1, max: 99 }),
  validate,
  async (req, res) => {
    try {
      const campaign = await wa.sendBulk({
        studioId: req.studioId,
        templateKey: req.body.templateKey || null,
        bodyOverride: req.body.body || null,
        recipients: req.body.recipients,
        createdById: req.admin?.id || null,
        name: req.body.name || null,
      });
      return ok(res, {
        campaign: {
          id: campaign.id,
          status: campaign.status,
          total: campaign.total,
          sent: campaign.sent,
          failed: campaign.failed,
          name: campaign.name,
        },
      }, 202);
    } catch (err) {
      return fail(res, CODES.VALIDATION, err.message, { status: err.status || 400 });
    }
  },
);

// ── Logs & campaigns ───────────────────────────────────────────────────────

router.get('/messages', async (req, res) => {
  const take = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const list = await prisma.whatsAppMessageLog.findMany({
    where: { studioId: req.studioId },
    orderBy: { createdAt: 'desc' },
    take,
  });
  return ok(res, { messages: list.map(mapLog) });
});

router.get('/campaigns', async (req, res) => {
  const list = await prisma.whatsAppCampaign.findMany({
    where: { studioId: req.studioId },
    orderBy: { createdAt: 'desc' },
    take: 30,
  });
  return ok(res, {
    campaigns: list.map((c) => ({
      id: c.id,
      name: c.name,
      status: c.status,
      total: c.total,
      sent: c.sent,
      failed: c.failed,
      templateKey: c.templateKey,
      createdAt: c.createdAt,
      finishedAt: c.finishedAt,
    })),
  });
});

/** Phone book helpers for bulk picker */
router.get('/recipients', async (req, res) => {
  const [customers, leads, guests] = await Promise.all([
    prisma.customer.findMany({
      where: {
        studioId: req.studioId,
        isGuest: false,
        phone: { not: null },
      },
      select: { id: true, name: true, phone: true, email: true },
      take: 500,
      orderBy: { name: 'asc' },
    }),
    prisma.lead.findMany({
      where: { studioId: req.studioId, phone: { not: null } },
      select: { id: true, name: true, phone: true },
      take: 200,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.galleryGuest.findMany({
      where: { studioId: req.studioId },
      select: { id: true, name: true, phone: true, galleryId: true },
      take: 200,
      orderBy: { createdAt: 'desc' },
    }),
  ]);
  return ok(res, {
    customers: customers.map((c) => ({
      id: c.id,
      name: c.name,
      phone: wa.normalizePhone(c.phone),
      type: 'customer',
    })).filter((c) => c.phone),
    leads: leads.map((l) => ({
      id: l.id,
      name: l.name,
      phone: wa.normalizePhone(l.phone),
      type: 'lead',
    })).filter((l) => l.phone),
    guests: guests.map((g) => ({
      id: g.id,
      name: g.name,
      phone: wa.normalizePhone(g.phone),
      type: 'guest',
    })).filter((g) => g.phone),
  });
});

module.exports = router;
