/**
 * WhatsApp Web via Baileys — one session per studio.
 * Outbound only (replies ignored). Human-like typing (15–20s).
 * Hard cap: ≤80 outbound messages / day (new touchpoints), configurable.
 */
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const pino = require('pino');
const { prisma } = require('../config/prisma');
const { logger } = require('../utils/logger');
require('../utils/privateSessionLogs').protectSessionLogs();

const AUTH_ROOT = process.env.WHATSAPP_AUTH_DIR
  || path.join(process.cwd(), 'data', 'whatsapp-auth');

/** Default max outbound SENT messages per studio per UTC day. */
const DEFAULT_DAILY_LIMIT = parseInt(process.env.WHATSAPP_DAILY_LIMIT || '80', 10);

/** @type {Map<string, {
 *   sock: any,
 *   status: string,
 *   qrDataUrl: string|null,
 *   phone: string|null,
 *   name: string|null,
 *   intentionalClose: boolean,
 *   reconnectAttempts: number,
 * }>} */
const sessions = new Map();

/** Serialize outbound sends per studio so typing + bulk don't race. */
const sendChains = new Map();

/**
 * Baileys CacheStore-compatible map (get/set/del).
 * Used for msg-retry counters and outbound message bodies so recipients
 * can decrypt ("Waiting for this message…" is almost always a missing getMessage).
 */
function createCacheStore(max = 3000) {
  const map = new Map();
  return {
    get(key) {
      return map.get(key);
    },
    set(key, value) {
      if (map.has(key)) map.delete(key);
      map.set(key, value);
      while (map.size > max) {
        const oldest = map.keys().next().value;
        map.delete(oldest);
      }
    },
    del(key) {
      map.delete(key);
    },
    flushAll() {
      map.clear();
    },
  };
}

/**
 * Full WAMessage objects by id (guide pattern: store m, return m.message).
 * Also indexed by jid|id for multi-key retry lookups.
 */
const messageCache = createCacheStore(5000);
/** @deprecated alias — keep for any old call sites */
const outboundMsgCache = messageCache;
/** Per-socket retry counter (Baileys option). */
const msgRetryCounterCache = createCacheStore(8000);
/** Placeholder resend cache (Baileys option). */
const placeholderResendCache = createCacheStore(2000);

/** Auto-expire in-memory entries after 24h (guide recommendation). */
const MSG_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const msgCacheExpiryTimers = new Map();

function scheduleMsgCacheExpiry(id) {
  if (!id) return;
  const prev = msgCacheExpiryTimers.get(id);
  if (prev) clearTimeout(prev);
  const t = setTimeout(() => {
    messageCache.del(id);
    msgCacheExpiryTimers.delete(id);
  }, MSG_CACHE_TTL_MS);
  if (typeof t.unref === 'function') t.unref();
  msgCacheExpiryTimers.set(id, t);
}

/** Max files kept in per-studio disk msg-cache (auth volume). */
const MSG_DISK_CACHE_MAX = 800;

/**
 * JSON-safe clone of a Baileys proto message (Buffers → {type:'Buffer', data:[]}).
 * Exact stored content is required for Signal retry re-encryption.
 */
function cloneMessageForStore(msg) {
  if (!msg || typeof msg !== 'object') return null;
  try {
    return JSON.parse(JSON.stringify(msg, (_, v) => {
      if (typeof Buffer !== 'undefined' && Buffer.isBuffer(v)) {
        return { type: 'Buffer', data: Array.from(v) };
      }
      if (v instanceof Uint8Array) {
        return { type: 'Buffer', data: Array.from(v) };
      }
      return v;
    }));
  } catch {
    return null;
  }
}

function reviveMessageFromStore(obj) {
  if (!obj || typeof obj !== 'object') return undefined;
  const walk = (o) => {
    if (!o || typeof o !== 'object') return o;
    if (o.type === 'Buffer' && Array.isArray(o.data)) return Buffer.from(o.data);
    if (Array.isArray(o)) return o.map(walk);
    const out = {};
    for (const [k, v] of Object.entries(o)) out[k] = walk(v);
    return out;
  };
  try {
    return walk(obj);
  } catch {
    return undefined;
  }
}

function msgCacheDir(studioId) {
  return path.join(authDir(studioId), 'msg-cache');
}

function persistMsgToDisk(studioId, id, message) {
  if (!studioId || !id || !message) return;
  try {
    const dir = msgCacheDir(studioId);
    ensureDir(dir);
    const payload = cloneMessageForStore(message);
    if (!payload) return;
    fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(payload));
    // Opportunistic prune (every ~25 writes) so volume does not grow forever
    if (Math.random() < 0.04) {
      const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
      if (files.length > MSG_DISK_CACHE_MAX) {
        const ranked = files
          .map((f) => {
            try {
              const st = fs.statSync(path.join(dir, f));
              return { f, mtime: st.mtimeMs };
            } catch {
              return { f, mtime: 0 };
            }
          })
          .sort((a, b) => a.mtime - b.mtime);
        const drop = ranked.slice(0, files.length - MSG_DISK_CACHE_MAX);
        for (const d of drop) {
          try { fs.unlinkSync(path.join(dir, d.f)); } catch (_) { /* ignore */ }
        }
      }
    }
  } catch (err) {
    logger.warn(`[whatsapp] msg disk cache write: ${err.message}`);
  }
}

function loadMsgFromDisk(studioId, id) {
  if (!studioId || !id) return undefined;
  try {
    const file = path.join(msgCacheDir(studioId), `${id}.json`);
    if (!fs.existsSync(file)) return undefined;
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return reviveMessageFromStore(raw);
  } catch {
    return undefined;
  }
}

/**
 * Remember full WAMessage for getMessage retries (Baileys guide pattern).
 * Cache stores the whole object; getMessage returns `.message`.
 * Multi-key so retries by id / jid+id / participant+id all hit.
 */
function rememberOutboundMessage(sent, studioId = null) {
  const id = sent?.key?.id;
  const message = sent?.message;
  if (!id || !message) return;
  // Store full WAMessage (or a synthetic one) so getMessage can do msg?.message
  const entry = sent.key ? sent : { key: { id }, message };
  messageCache.set(id, entry);
  if (sent.key?.remoteJid) {
    messageCache.set(`${sent.key.remoteJid}|${id}`, entry);
  }
  if (sent.key?.participant) {
    messageCache.set(`${sent.key.participant}|${id}`, entry);
  }
  scheduleMsgCacheExpiry(id);
  if (studioId) persistMsgToDisk(studioId, id, message);
}

/** Extract proto message from cache entry (full WAMessage or raw message). */
function messageFromCacheEntry(entry) {
  if (!entry) return undefined;
  if (entry.message) return entry.message;
  // Legacy: we used to store bare proto message
  if (entry.extendedTextMessage || entry.conversation || entry.imageMessage) return entry;
  return undefined;
}

/** Build proto message from plain text — Baileys text sends use extendedTextMessage. */
function textToProtoMessage(text) {
  const t = String(text || '').slice(0, 4096);
  if (!t) return undefined;
  return { extendedTextMessage: { text: t } };
}

/**
 * CRITICAL: WhatsApp asks the *sender* to re-provide ciphertext plaintext when a
 * recipient cannot decrypt ("Waiting for this message. This may take a while.").
 * Returning undefined leaves the recipient stuck forever.
 *
 * Lookup order: memory → disk (auth volume) → DB exact waContent → DB body rebuild.
 */
async function loadMessageForRetry(studioId, key) {
  if (!key?.id) return undefined;
  const id = key.id;

  // Guide pattern: messageCache.get(id) → msg?.message
  const memEntry = messageCache.get(id)
    || (key.remoteJid ? messageCache.get(`${key.remoteJid}|${id}`) : null)
    || (key.participant ? messageCache.get(`${key.participant}|${id}`) : null);
  const fromMem = messageFromCacheEntry(memEntry);
  if (fromMem) return fromMem;

  const disk = loadMsgFromDisk(studioId, id);
  if (disk) {
    rememberOutboundMessage({ key: { id, remoteJid: key.remoteJid }, message: disk }, null);
    return disk;
  }

  try {
    // Prefer exact stored proto (survives restarts without shape mismatch)
    let row = await prisma.whatsAppMessageLog.findFirst({
      where: {
        studioId,
        status: 'SENT',
        sentAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        meta: { path: ['waMessageId'], equals: id },
      },
      select: { body: true, meta: true },
    });
    // Fallback: raw SQL if JSON path index is flaky on some deployments
    if (!row) {
      const raw = await prisma.$queryRaw`
        SELECT body, meta FROM "WhatsAppMessageLog"
        WHERE "studioId" = ${studioId}
          AND status = 'SENT'
          AND meta->>'waMessageId' = ${id}
        ORDER BY "sentAt" DESC NULLS LAST
        LIMIT 1
      `;
      if (Array.isArray(raw) && raw[0]) row = raw[0];
    }

    if (row?.meta && typeof row.meta === 'object' && row.meta.waContent) {
      const revived = reviveMessageFromStore(row.meta.waContent);
      if (revived) {
        rememberOutboundMessage({ key, message: revived }, studioId);
        logger.info(`[whatsapp] getMessage hit DB waContent id=${id}`);
        return revived;
      }
    }
    if (row?.body) {
      const msg = textToProtoMessage(row.body);
      if (msg) {
        rememberOutboundMessage({ key, message: msg }, studioId);
        logger.info(`[whatsapp] getMessage rebuilt from body id=${id}`);
        return msg;
      }
    }
  } catch (err) {
    logger.warn(`[whatsapp] getMessage fallback: ${err.message}`);
  }

  logger.warn(`[whatsapp] getMessage MISS id=${id} jid=${key.remoteJid || '?'} — recipient may stay on Waiting for this message`);
  return undefined;
}

/** Resolve phone → WhatsApp JID (uses onWhatsApp when possible). */
async function resolveRecipientJid(sock, phone) {
  const n = normalizePhone(phone);
  if (!n) return null;
  try {
    if (typeof sock?.onWhatsApp === 'function') {
      const results = await sock.onWhatsApp(n);
      const hit = Array.isArray(results) ? results.find((r) => r && r.exists && r.jid) : null;
      if (hit?.jid) return hit.jid;
    }
  } catch (_) { /* fall through */ }
  return `${n}@s.whatsapp.net`;
}

const DEFAULT_TEMPLATES = [
  {
    key: 'GUEST_QR_GREETING',
    name: 'Guest QR greeting',
    category: 'GALLERY',
    trigger: 'GUEST_REGISTERED',
    description: 'Sent when a guest scans the gallery QR and enters name + phone',
    sortOrder: 10,
    body: `Hi {{name}}! 👋

Thank you for joining *{{galleryName}}* via our studio link.

Save this link to open your gallery anytime:
{{galleryLink}}

You're all set — complete the face scan to find photos of you from the celebration.

With love,
{{studioName}}`,
  },
  {
    key: 'GUEST_FULL_ACCESS',
    name: 'Guest full access unlocked',
    category: 'GALLERY',
    trigger: 'GUEST_FULL_ACCESS',
    description: 'Optional: when guest unlocks full gallery with access code',
    sortOrder: 15,
    body: `Hi {{name}},

Full gallery access for *{{galleryName}}* is now unlocked. Enjoy browsing!

— {{studioName}}`,
  },
  {
    key: 'INVOICE_SENT',
    name: 'Invoice sent',
    category: 'BILLING',
    trigger: 'INVOICE_SENT',
    description: 'When an invoice is finalized / sent to the client',
    sortOrder: 20,
    body: `Hi {{name}},

Your invoice *{{invoiceNumber}}* for {{totalAmount}} {{currency}} is ready in the client app.

Balance due: {{balance}}

— {{studioName}}`,
  },
  {
    key: 'INVOICE_INSTALLMENT_PAID',
    name: 'Installment paid receipt',
    category: 'BILLING',
    trigger: 'INVOICE_INSTALLMENT_PAID',
    description: 'When admin marks an installment as paid',
    sortOrder: 25,
    body: `Hi {{name}},

We've recorded payment of *{{paidAmount}} {{currency}}* for {{installmentLabel}} on invoice {{invoiceNumber}}.

Remaining due: {{balance}}

Thank you!
— {{studioName}}`,
  },
  {
    key: 'BOOKING_UPDATE',
    name: 'Booking status update',
    category: 'BOOKING',
    trigger: 'BOOKING_UPDATE',
    description: 'When booking / project status changes',
    sortOrder: 30,
    body: `Hi {{name}},

Your booking status is now: *{{bookingStatus}}*

{{notes}}

— {{studioName}}`,
  },
  {
    key: 'LEAD_RECEIVED',
    name: 'Enquiry received (to client)',
    category: 'LEADS',
    trigger: 'LEAD_RECEIVED',
    description: 'Acknowledge when a client submits an enquiry / booking request',
    sortOrder: 40,
    body: `Hi {{name}},

We've received your enquiry{{packageTitle}}. Our team will get back to you shortly.

— {{studioName}}`,
  },
  {
    key: 'LEAD_UPDATED',
    name: 'Enquiry status update',
    category: 'LEADS',
    trigger: 'LEAD_UPDATED',
    description: 'When admin updates an enquiry status',
    sortOrder: 45,
    body: `Hi {{name}},

Update on your enquiry: *{{leadStatus}}*

{{message}}

— {{studioName}}`,
  },
  {
    key: 'SLOT_CONFIRMED',
    name: 'Shoot schedule confirmed',
    category: 'BOOKING',
    trigger: 'SLOT_CONFIRMED',
    description: 'When studio accepts / confirms a shoot date and time',
    sortOrder: 46,
    body: `Hi {{name}},

{{headline}}

{{details}}

{{closing}}

— *{{studioName}}*
{{studioContact}}`,
  },
  {
    key: 'SLOT_UPDATED',
    name: 'Shoot schedule updated',
    category: 'BOOKING',
    trigger: 'SLOT_UPDATED',
    description: 'When studio edits a confirmed shoot date or time',
    sortOrder: 47,
    body: `Hi {{name}},

{{headline}}

{{details}}

{{closing}}

— *{{studioName}}*
{{studioContact}}`,
  },
  {
    key: 'SLOT_DECLINED',
    name: 'Shoot slot declined',
    category: 'BOOKING',
    trigger: 'SLOT_DECLINED',
    description: 'When studio cannot confirm the requested shoot time',
    sortOrder: 48,
    body: `Hi {{name}},

{{headline}}

{{details}}

{{closing}}

— *{{studioName}}*
{{studioContact}}`,
  },
  {
    key: 'SLOT_RESCHEDULE_REQUESTED',
    name: 'Reschedule request received',
    category: 'BOOKING',
    trigger: 'SLOT_RESCHEDULE_REQUESTED',
    description: 'When the client asks to change the shoot time',
    sortOrder: 49,
    body: `Hi {{name}},

{{headline}}

{{details}}

{{closing}}

— *{{studioName}}*
{{studioContact}}`,
  },
  {
    key: 'GALLERY_PUBLISHED',
    name: 'Gallery published',
    category: 'GALLERY',
    trigger: 'GALLERY_PUBLISHED',
    description: 'When a gallery is published — client app link (not QR/full-access share)',
    sortOrder: 50,
    body: `Hi {{name}},

Great news — *{{galleryName}}* is now live in your client app.

Sign in with your phone to open it:
{{appUrl}}

— {{studioName}}`,
  },
  {
    key: 'CLIENT_PHONE_WELCOME',
    name: 'Client phone welcome',
    category: 'GENERAL',
    trigger: 'CLIENT_PHONE_ADDED',
    description: 'When admin adds/saves a phone number on a client profile',
    sortOrder: 55,
    body: `Hi {{name}}! 👋

Your number is now linked with *{{studioName}}*.

Sign in to the client portal with this phone number and your password anytime:
{{appUrl}}

We'll also message you gallery links and updates here on WhatsApp.

— {{studioName}}`,
  },
  {
    key: 'GALLERY_ASSIGNED',
    name: 'Gallery assigned to client',
    category: 'GALLERY',
    trigger: 'GALLERY_ASSIGNED',
    description: 'When admin grants a gallery — always the client app link (never full-access QR share)',
    sortOrder: 52,
    body: `Hi {{name}},

We've shared *{{galleryName}}* with you in the client app.

Open it here (sign in with your phone):
{{appUrl}}

— {{studioName}}`,
  },
  {
    key: 'CUSTOM_MANUAL',
    name: 'Custom message',
    category: 'GENERAL',
    trigger: null,
    description: 'Blank template for one-off / bulk messages',
    sortOrder: 100,
    body: `Hi {{name}},

{{message}}

— {{studioName}}`,
  },
];

const PLACEHOLDERS = [
  { key: 'name', label: 'Recipient name' },
  { key: 'phone', label: 'Recipient phone' },
  { key: 'studioName', label: 'Studio name' },
  { key: 'galleryName', label: 'Gallery name' },
  { key: 'galleryLink', label: 'Gallery deep link in client app (or guest QR for guests only)' },
  { key: 'appUrl', label: 'Client app URL (login with phone)' },
  { key: 'invoiceNumber', label: 'Invoice number' },
  { key: 'totalAmount', label: 'Invoice total' },
  { key: 'balance', label: 'Balance due' },
  { key: 'paidAmount', label: 'Amount just paid' },
  { key: 'installmentLabel', label: 'Installment label' },
  { key: 'currency', label: 'Currency code' },
  { key: 'bookingStatus', label: 'Booking status label' },
  { key: 'notes', label: 'Notes' },
  { key: 'message', label: 'Custom message body' },
  { key: 'packageTitle', label: 'Package title' },
  { key: 'leadStatus', label: 'Enquiry status' },
  { key: 'headline', label: 'Shoot schedule headline' },
  { key: 'details', label: 'Full shoot details block' },
  { key: 'closing', label: 'Shoot schedule closing line' },
  { key: 'dateLabel', label: 'Shoot date' },
  { key: 'timeLabel', label: 'Shoot time' },
  { key: 'slotLabel', label: 'Date + time together' },
  { key: 'studioContact', label: 'Studio phone + address' },
  { key: 'venue', label: 'Shoot venue' },
];

function authDir(studioId) {
  return path.join(AUTH_ROOT, studioId);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function randomBetween(min, max) {
  const a = Math.min(min, max);
  const b = Math.max(min, max);
  return a + Math.floor(Math.random() * (b - a + 1));
}

/** Normalize to digits-only international number (no +). */
function normalizePhone(raw) {
  if (!raw) return null;
  let s = String(raw).trim();
  // Drop guest suffixes
  s = s.split('#')[0];
  s = s.replace(/[^\d+]/g, '');
  if (s.startsWith('+')) s = s.slice(1);
  s = s.replace(/\D/g, '');
  // India 10-digit local → add 91 if no country code
  if (s.length === 10 && /^[6-9]/.test(s)) s = `91${s}`;
  return s.length >= 8 && s.length <= 15 ? s : null;
}

function toJid(phone) {
  const n = normalizePhone(phone);
  if (!n) return null;
  return `${n}@s.whatsapp.net`;
}

function renderTemplate(body, vars = {}) {
  let out = String(body || '');
  for (const [k, v] of Object.entries(vars || {})) {
    const val = v == null ? '' : String(v);
    out = out.replace(new RegExp(`\\{\\{\\s*${k}\\s*\\}\\}`, 'gi'), val);
  }
  out = out.replace(/\{\{\s*[\w.]+\s*\}\}/g, '').replace(/\n{3,}/g, '\n\n').trim();
  return out;
}

function startOfUtcDay(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

async function loadBaileys() {
  return import('@whiskeysockets/baileys');
}

async function upsertSessionRow(studioId, data) {
  return prisma.whatsAppSession.upsert({
    where: { studioId },
    create: {
      studioId,
      dailyTouchpointLimit: DEFAULT_DAILY_LIMIT,
      ...data,
    },
    update: data,
  });
}

async function getSessionRow(studioId) {
  return prisma.whatsAppSession.findUnique({ where: { studioId } });
}

/**
 * Daily quota: max 80 SENT messages / UTC day (new touchpoints).
 * Also returns unique recipients messaged today for display.
 */
async function getDailyQuota(studioId) {
  const row = await getSessionRow(studioId);
  const limit = Math.min(
    200,
    Math.max(1, row?.dailyTouchpointLimit ?? DEFAULT_DAILY_LIMIT),
  );
  const since = startOfUtcDay();
  const sentToday = await prisma.whatsAppMessageLog.count({
    where: {
      studioId,
      status: 'SENT',
      sentAt: { gte: since },
    },
  });
  // Unique phones messaged today (touchpoints)
  const distinct = await prisma.whatsAppMessageLog.findMany({
    where: {
      studioId,
      status: 'SENT',
      sentAt: { gte: since },
    },
    select: { toPhone: true },
    distinct: ['toPhone'],
  });
  const used = sentToday;
  const remaining = Math.max(0, limit - used);
  return {
    limit,
    used,
    remaining,
    uniqueRecipientsToday: distinct.length,
    resetsAt: new Date(since.getTime() + 24 * 60 * 60 * 1000).toISOString(),
    exhausted: remaining <= 0,
  };
}

async function ensureDefaultTemplates(studioId) {
  // Upsert by key: create missing, refresh system bodies that need new placeholders
  for (const t of DEFAULT_TEMPLATES) {
    const existing = await prisma.whatsAppTemplate.findFirst({
      where: { studioId, key: t.key },
    });
    if (!existing) {
      await prisma.whatsAppTemplate.create({
        data: {
          studioId,
          key: t.key,
          name: t.name,
          description: t.description,
          body: t.body,
          category: t.category,
          trigger: t.trigger,
          active: true,
          isSystem: true,
          sortOrder: t.sortOrder,
        },
      });
      continue;
    }
    // Keep admin customizations unless system template is missing new placeholders
    // or client-facing gallery templates still point at share/QR links only.
    if (existing.isSystem) {
      const needsLink = (t.body || '').includes('{{galleryLink}}')
        && !(existing.body || '').includes('{{galleryLink}}');
      const needsApp = (t.body || '').includes('{{appUrl}}')
        && !(existing.body || '').includes('{{appUrl}}');
      const galleryClientKeys = ['GALLERY_ASSIGNED', 'GALLERY_PUBLISHED'];
      const needsClientAppCopy = galleryClientKeys.includes(t.key)
        && !(existing.body || '').includes('{{appUrl}}');
      const slotKeys = ['SLOT_CONFIRMED', 'SLOT_UPDATED', 'SLOT_DECLINED', 'SLOT_RESCHEDULE_REQUESTED'];
      const needsSlotCopy = slotKeys.includes(t.key)
        && !(existing.body || '').includes('{{details}}');
      if (needsLink || needsApp || needsClientAppCopy || needsSlotCopy || existing.trigger !== t.trigger) {
        await prisma.whatsAppTemplate.update({
          where: { id: existing.id },
          data: {
            body: t.body,
            description: t.description,
            trigger: t.trigger,
            name: t.name,
          },
        });
      }
    }
  }
}

function clientAppUrl() {
  return (process.env.CUSTOMER_APP_URL || process.env.FRONTEND_URL || 'https://app.warmkelvin.com')
    .replace(/\/$/, '');
}

/** Client app deep link to a gallery (login required) — never QR/full-access share. */
function clientGalleryAppUrl(galleryId, studioId) {
  const base = clientAppUrl();
  if (galleryId && studioId) return require('./shortLinks').createShortLink({ studioId, path: `/gallery/${galleryId}` }).then(link => link.url);
  if (galleryId) return `${base}/gallery/${galleryId}`;
  return base;
}

/**
 * Welcome clients whose phone was saved in the last hour (one-time backfill after deploy).
 * Skips if CLIENT_PHONE_WELCOME already sent to that number.
 */
async function notifyRecentPhoneAdds({ hours = 1 } = {}) {
  const since = new Date(Date.now() - Math.max(0.1, hours) * 60 * 60 * 1000);
  try {
    const customers = await prisma.customer.findMany({
      where: {
        isGuest: false,
        phone: { not: null },
        updatedAt: { gte: since },
        accountStatus: { not: 'DISABLED' },
      },
      select: {
        id: true,
        name: true,
        phone: true,
        studioId: true,
      },
      take: 200,
    });
    let queued = 0;
    for (const c of customers) {
      if (!c.phone) continue;
      const norm = normalizePhone(c.phone);
      if (!norm) continue;
      // Already welcomed?
      const prior = await prisma.whatsAppMessageLog.findFirst({
        where: {
          studioId: c.studioId,
          toPhone: norm,
          templateKey: 'CLIENT_PHONE_WELCOME',
          status: { in: ['SENT', 'QUEUED', 'TYPING'] },
        },
      });
      if (prior) continue;
      triggerAuto(c.studioId, 'CLIENT_PHONE_ADDED', {
        phone: norm,
        toName: c.name,
        vars: {
          name: c.name || 'there',
          phone: norm,
          appUrl: clientAppUrl(),
        },
        meta: { customerId: c.id, source: 'BACKFILL_1H' },
      });
      queued += 1;
    }
    if (queued) logger.info(`[whatsapp] queued ${queued} phone-welcome message(s) for last ${hours}h`);
    return { scanned: customers.length, queued };
  } catch (err) {
    logger.warn(`[whatsapp] notifyRecentPhoneAdds: ${err.message}`);
    return { scanned: 0, queued: 0, error: err.message };
  }
}

/**
 * Human-like typing: available → composing (refreshed) for 15–20s → pause → send.
 * Longer messages get slightly longer typing (still within max).
 */
async function emulateTyping(sock, jid, { minMs, maxMs, textLen = 80 }) {
  const base = randomBetween(minMs, maxMs);
  // ~40ms per char, capped so we stay within range
  const lengthBoost = Math.min(4000, Math.floor(Math.max(0, textLen - 40) * 25));
  const total = Math.min(maxMs + 2000, base + lengthBoost);

  await sock.sendPresenceUpdate('available').catch(() => {});
  await sleep(randomBetween(400, 1200));

  const endAt = Date.now() + total;
  // WhatsApp drops "composing" after ~~10–15s — refresh every ~8s
  while (Date.now() < endAt) {
    await sock.sendPresenceUpdate('composing', jid).catch(() => {});
    const left = endAt - Date.now();
    if (left <= 0) break;
    await sleep(Math.min(8000, left));
  }

  await sock.sendPresenceUpdate('paused', jid).catch(() => {});
  await sleep(randomBetween(300, 900));
}

async function connectStudio(studioId) {
  await ensureDefaultTemplates(studioId);
  const existing = sessions.get(studioId);
  if (existing?.sock && ['CONNECTED', 'QR', 'CONNECTING'].includes(existing.status)) {
    return getStatus(studioId);
  }

  const baileys = await loadBaileys();
  const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    Browsers,
  } = baileys;

  const dir = authDir(studioId);
  ensureDir(dir);
  const { state, saveCreds } = await useMultiFileAuthState(dir);

  let version;
  try {
    const v = await fetchLatestBaileysVersion();
    version = v.version;
  } catch {
    version = undefined;
  }

  await upsertSessionRow(studioId, {
    status: 'CONNECTING',
    lastError: null,
  });

  const sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
    },
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    generateHighQualityLinkPreview: false,
    syncFullHistory: false,
    emitOwnEvents: true,
    // Stay online enough for presence + reliable delivery retries
    markOnlineOnConnect: true,
    // CRITICAL: WhatsApp asks the sender to re-provide message content when a
    // recipient cannot decrypt ("Waiting for this message. This may take a while").
    // Returning undefined here leaves the recipient stuck forever.
    getMessage: async (key) => {
      try {
        return await loadMessageForRetry(studioId, key);
      } catch (err) {
        logger.warn(`[whatsapp] getMessage error: ${err.message}`);
        return undefined;
      }
    },
    msgRetryCounterCache,
    placeholderResendCache,
    browser: Browsers?.ubuntu?.('Chrome') || ['SJ Studio', 'Chrome', '122.0.0'],
    connectTimeoutMs: 60_000,
    defaultQueryTimeoutMs: 60_000,
    keepAliveIntervalMs: 25_000,
    // Retry failed sends a few times at the socket layer
    retryRequestDelayMs: 350,
    maxMsgRetryCount: 8,
  });

  const runtime = {
    sock,
    status: 'CONNECTING',
    qrDataUrl: null,
    phone: null,
    name: null,
    intentionalClose: false,
    reconnectAttempts: existing?.reconnectAttempts || 0,
  };
  sessions.set(studioId, runtime);

  // Persist credentials immediately — never lose session mid-flight
  sock.ev.on('creds.update', async (creds) => {
    try {
      await saveCreds(creds);
    } catch (err) {
      logger.error(`[whatsapp] saveCreds failed: ${err.message}`);
    }
  });

  // Cache every message with content (outbound echoes + anything we may need for retries)
  sock.ev.on('messages.upsert', ({ messages }) => {
    try {
      for (const m of messages || []) {
        if (m?.key?.id && m.message) {
          rememberOutboundMessage(m, studioId);
        }
      }
    } catch (_) { /* ignore */ }
  });

  // Track delivery / read receipts on our outbound messages for Activity UI
  sock.ev.on('messages.update', async (updates) => {
    try {
      for (const u of updates || []) {
        const id = u?.key?.id;
        if (!id || !u.key?.fromMe) continue;
        const status = u.update?.status;
        if (status == null) continue;
        // proto.WebMessageInfo.Status: PENDING=0 SERVER_ACK=1 DELIVERY_ACK=2 READ=3 PLAYED=4
        const label = status === 3 || status === 4 ? 'READ'
          : status === 2 ? 'DELIVERED'
            : status === 1 ? 'SERVER_ACK'
              : null;
        if (!label) continue;
        // Merge delivery into meta via raw SQL (preserve waMessageId / waContent / etc.)
        await prisma.$executeRaw`
          UPDATE "WhatsAppMessageLog"
          SET meta = COALESCE(meta, '{}'::jsonb) || ${JSON.stringify({
            deliveryStatus: label,
            deliveryStatusAt: new Date().toISOString(),
          })}::jsonb
          WHERE "studioId" = ${studioId}
            AND meta->>'waMessageId' = ${id}
        `.catch(() => {});
      }
    } catch (_) { /* ignore */ }
  });

  // No auto-replies; ignore history noise
  sock.ev.on('messaging-history.set', () => {});

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    try {
      if (qr) {
        const qrDataUrl = await QRCode.toDataURL(qr, {
          errorCorrectionLevel: 'M',
          margin: 2,
          width: 360,
          color: { dark: '#1A1917', light: '#FBFAF8' },
        });
        runtime.qrDataUrl = qrDataUrl;
        runtime.status = 'QR';
        await upsertSessionRow(studioId, {
          status: 'QR',
          lastQrAt: new Date(),
          lastError: null,
        });
        logger.info(`[whatsapp] studio=${studioId} QR ready`);
      }

      if (connection === 'open') {
        runtime.status = 'CONNECTED';
        runtime.qrDataUrl = null;
        runtime.reconnectAttempts = 0;
        const me = sock.user || {};
        const phone = (me.id || '').split(':')[0].split('@')[0] || null;
        runtime.phone = phone;
        runtime.name = me.name || me.verifiedName || null;
        await upsertSessionRow(studioId, {
          status: 'CONNECTED',
          phoneNumber: phone,
          displayName: runtime.name,
          lastConnectedAt: new Date(),
          lastError: null,
        });
        // Stay "available" lightly for typing presence to work
        await sock.sendPresenceUpdate('available').catch(() => {});
        logger.info(`[whatsapp] studio=${studioId} connected as ${phone}`);
      }

      if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode
          || lastDisconnect?.error?.status
          || 0;
        const loggedOut = code === DisconnectReason.loggedOut;
        const restartRequired = code === DisconnectReason.restartRequired;
        const intentional = runtime.intentionalClose;
        runtime.sock = null;
        runtime.qrDataUrl = null;

        if (loggedOut) {
          runtime.status = 'LOGGED_OUT';
          await upsertSessionRow(studioId, {
            status: 'LOGGED_OUT',
            lastError: 'Logged out from phone — scan QR again',
            phoneNumber: null,
          });
          sessions.delete(studioId);
          try {
            fs.rmSync(authDir(studioId), { recursive: true, force: true });
          } catch (_) { /* ignore */ }
          return;
        }

        runtime.status = 'DISCONNECTED';
        await upsertSessionRow(studioId, {
          status: 'DISCONNECTED',
          lastError: intentional
            ? null
            : (lastDisconnect?.error?.message || `Disconnected (${code})`),
        });
        sessions.delete(studioId);

        if (intentional) return;

        // Exponential backoff reconnect (max ~5 attempts then stop)
        if (restartRequired || code !== DisconnectReason.loggedOut) {
          const attempts = (runtime.reconnectAttempts || 0) + 1;
          if (attempts > 8) {
            logger.warn(`[whatsapp] studio=${studioId} stop reconnect after ${attempts} attempts`);
            return;
          }
          const delay = Math.min(60_000, 2000 * (2 ** Math.min(attempts, 5)));
          setTimeout(() => {
            connectStudio(studioId)
              .then(() => {
                const r = sessions.get(studioId);
                if (r) r.reconnectAttempts = attempts;
              })
              .catch((e) => logger.error(`[whatsapp] reconnect: ${e.message}`));
          }, delay);
        }
      }
    } catch (err) {
      logger.error(`[whatsapp] connection.update error: ${err.message}`);
    }
  });

  return getStatus(studioId);
}

async function disconnectStudio(studioId, { logout = false } = {}) {
  const runtime = sessions.get(studioId);
  if (runtime) runtime.intentionalClose = true;
  try {
    if (runtime?.sock) {
      if (logout) {
        await runtime.sock.logout().catch(() => {});
      } else {
        try {
          runtime.sock.end?.(undefined);
        } catch (_) { /* ignore */ }
      }
    }
  } catch (_) { /* ignore */ }
  sessions.delete(studioId);
  if (logout) {
    try {
      fs.rmSync(authDir(studioId), { recursive: true, force: true });
    } catch (_) { /* ignore */ }
    await upsertSessionRow(studioId, {
      status: 'LOGGED_OUT',
      phoneNumber: null,
      displayName: null,
      lastError: 'Logged out from dashboard',
    });
  } else {
    await upsertSessionRow(studioId, { status: 'DISCONNECTED', lastError: null });
  }
  return getStatus(studioId);
}

async function getStatus(studioId) {
  const row = await getSessionRow(studioId);
  const runtime = sessions.get(studioId);
  const status = runtime?.status || row?.status || 'DISCONNECTED';
  const quota = await getDailyQuota(studioId).catch(() => ({
    limit: DEFAULT_DAILY_LIMIT,
    used: 0,
    remaining: DEFAULT_DAILY_LIMIT,
    uniqueRecipientsToday: 0,
    exhausted: false,
  }));
  return {
    status,
    online: status === 'CONNECTED',
    phoneNumber: runtime?.phone || row?.phoneNumber || null,
    displayName: runtime?.name || row?.displayName || null,
    qrDataUrl: status === 'QR' ? (runtime?.qrDataUrl || null) : null,
    lastConnectedAt: row?.lastConnectedAt || null,
    lastQrAt: row?.lastQrAt || null,
    lastError: row?.lastError || null,
    autoSendEnabled: row?.autoSendEnabled !== false,
    typingMinMs: row?.typingMinMs ?? 15000,
    typingMaxMs: row?.typingMaxMs ?? 20000,
    dailyTouchpointLimit: row?.dailyTouchpointLimit ?? DEFAULT_DAILY_LIMIT,
    quota,
  };
}

function enqueueStudio(studioId, fn) {
  const prev = sendChains.get(studioId) || Promise.resolve();
  const next = prev.then(fn, fn);
  sendChains.set(studioId, next.catch(() => {}));
  return next;
}

/**
 * Send a PDF/document to a WhatsApp number (agreements, invoices).
 */
async function sendDocument({
  studioId,
  phone,
  buffer,
  fileName = 'document.pdf',
  mimetype = 'application/pdf',
  caption = '',
  toName = null,
  source = 'AUTO',
  meta = null,
}) {
  const normalized = normalizePhone(phone);
  if (!normalized) {
    return prisma.whatsAppMessageLog.create({
      data: {
        studioId,
        toPhone: String(phone || ''),
        toName,
        body: caption || fileName,
        status: 'FAILED',
        error: 'Invalid phone',
        source,
        meta: meta || undefined,
      },
    });
  }
  const log = await prisma.whatsAppMessageLog.create({
    data: {
      studioId,
      toPhone: normalized,
      toName,
      body: caption || fileName,
      status: 'QUEUED',
      source,
      meta: meta || undefined,
    },
  });
  return enqueueStudio(studioId, async () => {
    const runtime = sessions.get(studioId);
    if (!runtime?.sock || runtime.status !== 'CONNECTED') {
      return prisma.whatsAppMessageLog.update({
        where: { id: log.id },
        data: { status: 'FAILED', error: 'WhatsApp is offline — connect from Messaging' },
      });
    }
    try {
      const jid = await resolveRecipientJid(runtime.sock, normalized);
      if (!jid) {
        return prisma.whatsAppMessageLog.update({
          where: { id: log.id },
          data: { status: 'FAILED', error: 'Could not resolve WhatsApp number' },
        });
      }
      const sent = await runtime.sock.sendMessage(jid, {
        document: Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer),
        mimetype: mimetype || 'application/pdf',
        fileName: String(fileName || 'document.pdf').slice(0, 120),
        caption: caption ? String(caption).slice(0, 1024) : undefined,
      });
      if (sent?.key?.id && sent.message) {
        rememberOutboundMessage({ key: sent.key, message: sent.message }, studioId);
      }
      return prisma.whatsAppMessageLog.update({
        where: { id: log.id },
        data: {
          status: 'SENT',
          waMessageId: sent?.key?.id || null,
          error: null,
        },
      });
    } catch (err) {
      logger.error(`[whatsapp] document send: ${err.message}`);
      return prisma.whatsAppMessageLog.update({
        where: { id: log.id },
        data: { status: 'FAILED', error: String(err.message || err).slice(0, 400) },
      });
    }
  });
}

/**
 * Send one message with typing indicator + daily quota enforcement.
 */
async function sendText({
  studioId,
  phone,
  text,
  toName = null,
  templateId = null,
  templateKey = null,
  campaignId = null,
  source = 'MANUAL',
  meta = null,
  skipTyping = false,
  /** System OTPs (password reset) should not be blocked by marketing daily cap. */
  skipDailyQuota = false,
}) {
  const normalized = normalizePhone(phone);
  const isSystemOtp = skipDailyQuota
    || (meta && typeof meta === 'object' && meta.kind === 'PASSWORD_RESET_OTP');
  // OTP / system messages: no 12–20s fake typing, no post-send cool-down
  const fastSend = !!skipTyping || isSystemOtp;

  if (!normalized) {
    return prisma.whatsAppMessageLog.create({
      data: {
        studioId,
        templateId,
        templateKey,
        campaignId,
        toPhone: String(phone || ''),
        toName,
        body: text,
        status: 'FAILED',
        error: 'Invalid phone — use country code (e.g. 91… for India)',
        source,
        meta: meta || undefined,
      },
    });
  }

  // Pre-check daily quota (final check also inside queue to avoid races)
  if (!isSystemOtp) {
    const quota = await getDailyQuota(studioId);
    if (quota.exhausted) {
      return prisma.whatsAppMessageLog.create({
        data: {
          studioId,
          templateId,
          templateKey,
          campaignId,
          toPhone: normalized,
          toName,
          body: text,
          status: 'SKIPPED',
          error: `Daily limit reached (${quota.limit}/day). Resets at ${quota.resetsAt}`,
          source,
          meta: { ...(meta || {}), quota },
        },
      });
    }
  }

  const log = await prisma.whatsAppMessageLog.create({
    data: {
      studioId,
      templateId,
      templateKey,
      campaignId,
      toPhone: normalized,
      toName,
      body: text,
      status: 'QUEUED',
      source,
      meta: meta || undefined,
    },
  });

  return enqueueStudio(studioId, async () => {
    // Re-check quota inside serial queue (unless system OTP)
    if (!isSystemOtp) {
      const q2 = await getDailyQuota(studioId);
      if (q2.exhausted) {
        return prisma.whatsAppMessageLog.update({
          where: { id: log.id },
          data: {
            status: 'SKIPPED',
            error: `Daily limit reached (${q2.limit}/day)`,
          },
        });
      }
    }

    const runtime = sessions.get(studioId);
    if (!runtime?.sock || runtime.status !== 'CONNECTED') {
      return prisma.whatsAppMessageLog.update({
        where: { id: log.id },
        data: { status: 'FAILED', error: 'WhatsApp is offline — connect from Messaging tab' },
      });
    }

    try {
      // Resolve real WA JID (handles multi-device / non-existent numbers better)
      const jid = await resolveRecipientJid(runtime.sock, normalized);
      if (!jid) {
        return prisma.whatsAppMessageLog.update({
          where: { id: log.id },
          data: { status: 'FAILED', error: 'Could not resolve WhatsApp number' },
        });
      }

      // Force a fresh Signal session before first touch — reduces
      // "Waiting for this message" on new / multi-device contacts.
      try {
        if (typeof runtime.sock.presenceSubscribe === 'function') {
          await runtime.sock.presenceSubscribe(jid).catch(() => {});
        }
        if (typeof runtime.sock.assertSessions === 'function') {
          await runtime.sock.assertSessions([jid], true);
        }
        // Groups: clear sender-key-memory so Baileys redistributes keys
        // after members change phones (guide workaround).
        if (String(jid).endsWith('@g.us') && runtime.sock.authState?.keys?.set) {
          await runtime.sock.authState.keys.set({
            'sender-key-memory': { [jid]: null },
          }).catch(() => {});
        }
      } catch (sessErr) {
        logger.warn(`[whatsapp] session prepare ${jid}: ${sessErr.message}`);
      }

      if (!fastSend) {
        const row = await getSessionRow(studioId);
        let minMs = row?.typingMinMs ?? 15000;
        let maxMs = row?.typingMaxMs ?? 20000;
        // Clamp to safe human range (marketing / bulk only)
        minMs = Math.max(12000, Math.min(30000, minMs));
        maxMs = Math.max(minMs, Math.min(35000, maxMs));

        await prisma.whatsAppMessageLog.update({
          where: { id: log.id },
          data: { status: 'TYPING' },
        });

        await emulateTyping(runtime.sock, jid, {
          minMs,
          maxMs,
          textLen: (text || '').length,
        });
      }

      const bodyText = String(text || '').slice(0, 4096);
      // linkPreview: null — never embed previews (preview media keys break retries
      // and are a common cause of permanent "Waiting for this message" on iOS).
      const sent = await runtime.sock.sendMessage(jid, {
        text: bodyText,
        linkPreview: null,
      });

      // Always seed memory + disk with exact proto (or rebuilt plain text)
      const exactMsg = sent?.message || textToProtoMessage(bodyText);
      if (sent?.key?.id && exactMsg) {
        rememberOutboundMessage(
          { key: sent.key, message: exactMsg },
          studioId,
        );
      }

      const waMessageId = sent?.key?.id || null;
      const waJid = sent?.key?.remoteJid || jid;
      const waContent = cloneMessageForStore(exactMsg);

      // Cool-down only for normal messages (never for OTP)
      if (!fastSend) {
        await sleep(randomBetween(800, 2200));
      }

      return prisma.whatsAppMessageLog.update({
        where: { id: log.id },
        data: {
          status: 'SENT',
          sentAt: new Date(),
          error: null,
          meta: {
            ...(meta && typeof meta === 'object' ? meta : {}),
            waMessageId,
            waJid,
            // Exact proto for getMessage after process restart
            waContent: waContent || undefined,
            bodySnapshot: bodyText,
            fastSend: fastSend || undefined,
          },
        },
      });
    } catch (err) {
      logger.error(`[whatsapp] send failed: ${err.message}`);
      return prisma.whatsAppMessageLog.update({
        where: { id: log.id },
        data: { status: 'FAILED', error: err.message || 'Send failed' },
      });
    }
  });
}

async function sendTemplate({
  studioId,
  phone,
  toName,
  templateKey,
  vars = {},
  source = 'AUTO',
  campaignId = null,
  meta = null,
}) {
  const tpl = await prisma.whatsAppTemplate.findFirst({
    where: { studioId, key: templateKey, active: true },
  });
  if (!tpl) {
    logger.warn(`[whatsapp] template ${templateKey} missing for studio ${studioId}`);
    return null;
  }

  let studioName = vars.studioName;
  if (!studioName) {
    const studio = await prisma.studio.findUnique({
      where: { id: studioId },
      include: { profile: true },
    });
    studioName = studio?.profile?.displayName || studio?.name || 'Studio';
  }

  const { recipientTemplateVars } = require('./notificationRecipient');
  const body = renderTemplate(tpl.body, recipientTemplateVars({ vars, toName, phone: normalizePhone(phone) || phone || '', studioName }));

  return sendText({
    studioId,
    phone,
    text: body,
    toName,
    templateId: tpl.id,
    templateKey: tpl.key,
    campaignId,
    source,
    meta,
  });
}

/**
 * Fire-and-forget auto message if session online + autoSend + template active + quota.
 * Dedupes: same trigger + phone within last 6 hours won't re-fire.
 */
function triggerAuto(studioId, trigger, { phone, toName, vars, meta, skipDedup } = {}) {
  if (process.env.DISABLE_OUTBOUND_NOTIFICATIONS === 'true') return;
  setImmediate(async () => {
    try {
      if (['GALLERY_ASSIGNED', 'GALLERY_PUBLISHED'].includes(trigger)) {
        const { galleryNotificationRecipient } = require('./notificationRecipient');
        const recipient = await galleryNotificationRecipient(prisma, studioId, meta);
        if (!recipient) return;
        phone = recipient.phone;
        toName = recipient.toName;
        vars = { ...vars, name: recipient.name, galleryName: recipient.galleryName };
      }
      if (!phone) return;
      const normalized = normalizePhone(phone);
      if (!normalized) {
        logger.info(`[whatsapp] skip auto ${trigger}: bad phone`);
        return;
      }

      const row = await getSessionRow(studioId);
      if (row && row.autoSendEnabled === false) return;

      const status = await getStatus(studioId);
      if (!status.online) {
        logger.info(`[whatsapp] skip auto ${trigger}: offline`);
        return;
      }
      if (status.quota?.exhausted) {
        logger.info(`[whatsapp] skip auto ${trigger}: daily limit`);
        return;
      }

      const tpl = await prisma.whatsAppTemplate.findFirst({
        where: { studioId, trigger, active: true },
      });
      if (!tpl) return;

      const slotTriggers = ['SLOT_CONFIRMED', 'SLOT_UPDATED', 'SLOT_DECLINED', 'SLOT_RESCHEDULE_REQUESTED'];
      const noDedup = skipDedup || slotTriggers.includes(trigger);
      // Dedup auto-fire for same template + phone in last 6h (never for shoot-slot updates)
      if (!noDedup) {
        const since = new Date(Date.now() - 6 * 60 * 60 * 1000);
        const recent = await prisma.whatsAppMessageLog.findFirst({
          where: {
            studioId,
            toPhone: normalized,
            templateKey: tpl.key,
            ...(['GALLERY_ASSIGNED', 'GALLERY_PUBLISHED'].includes(trigger) ? { AND: [
              { meta: { path: ['customerId'], equals: meta.customerId } },
              { meta: { path: ['galleryId'], equals: meta.galleryId } },
            ] } : {}),
            status: { in: ['SENT', 'QUEUED', 'TYPING'] },
            createdAt: { gte: since },
          },
        });
        if (recent) {
          logger.info(`[whatsapp] skip auto ${trigger}: deduped for ${normalized}`);
          return;
        }
      }

      await sendTemplate({
        studioId,
        phone: normalized,
        toName,
        templateKey: tpl.key,
        vars,
        source: 'AUTO',
        meta: { trigger, ...(meta || {}) },
      });
    } catch (err) {
      logger.error(`[whatsapp] auto ${trigger}: ${err.message}`);
    }
  });
}

/**
 * Bulk send — max min(99, remaining daily quota). Sequential with typing.
 */
async function sendBulk({
  studioId,
  templateKey,
  bodyOverride = null,
  recipients,
  createdById = null,
  name = null,
}) {
  const list = Array.isArray(recipients) ? recipients : [];
  if (!list.length) {
    const err = new Error('Add at least one recipient');
    err.status = 400;
    throw err;
  }

  const status = await getStatus(studioId);
  if (!status.online) {
    const err = new Error('WhatsApp is offline — scan QR and connect first');
    err.status = 400;
    throw err;
  }

  const quota = status.quota || await getDailyQuota(studioId);
  if (quota.exhausted) {
    const err = new Error(`Daily limit of ${quota.limit} messages reached. Try again tomorrow.`);
    err.status = 400;
    throw err;
  }

  // Hard caps: never more than 99 AND never more than remaining daily quota
  const maxAllowed = Math.min(99, quota.remaining);
  if (list.length > maxAllowed) {
    const err = new Error(
      `Bulk limited to ${maxAllowed} today (daily cap ${quota.limit}, used ${quota.used}). Reduce recipients.`,
    );
    err.status = 400;
    throw err;
  }

  let tpl = null;
  if (templateKey) {
    tpl = await prisma.whatsAppTemplate.findFirst({
      where: { studioId, key: templateKey, active: true },
    });
  }

  const campaign = await prisma.whatsAppCampaign.create({
    data: {
      studioId,
      name: name || `Bulk · ${new Date().toISOString().slice(0, 16)}`,
      templateId: tpl?.id || null,
      templateKey: tpl?.key || templateKey || null,
      status: 'RUNNING',
      total: list.length,
      createdById,
    },
  });

  setImmediate(async () => {
    let sent = 0;
    let failed = 0;
    try {
      const studio = await prisma.studio.findUnique({
        where: { id: studioId },
        include: { profile: true },
      });
      const studioName = studio?.profile?.displayName || studio?.name || 'Studio';

      for (const r of list) {
        // Stop bulk early if quota hits mid-run
        const q = await getDailyQuota(studioId);
        if (q.exhausted) {
          failed += 1;
          await prisma.whatsAppMessageLog.create({
            data: {
              studioId,
              campaignId: campaign.id,
              toPhone: normalizePhone(r.phone || r.toPhone) || String(r.phone || ''),
              toName: r.name || r.toName || null,
              body: '(skipped — daily limit)',
              status: 'SKIPPED',
              error: 'Daily limit reached during bulk',
              source: 'BULK',
              templateKey: tpl?.key || null,
              templateId: tpl?.id || null,
            },
          }).catch(() => {});
          continue;
        }

        const phone = r.phone || r.toPhone;
        const toName = r.name || r.toName || null;
        const vars = { studioName, name: toName || 'there', ...(r.vars || {}) };
        const text = bodyOverride
          ? renderTemplate(bodyOverride, vars)
          : tpl
            ? renderTemplate(tpl.body, vars)
            : renderTemplate(String(r.body || r.message || ''), vars);

        const log = await sendText({
          studioId,
          phone,
          text,
          toName,
          templateId: tpl?.id || null,
          templateKey: tpl?.key || null,
          campaignId: campaign.id,
          source: 'BULK',
          meta: r.meta || null,
        });
        if (log?.status === 'SENT') sent += 1;
        else failed += 1;
        await prisma.whatsAppCampaign.update({
          where: { id: campaign.id },
          data: { sent, failed },
        });
      }
      await prisma.whatsAppCampaign.update({
        where: { id: campaign.id },
        data: {
          status: failed && !sent ? 'FAILED' : 'COMPLETED',
          sent,
          failed,
          finishedAt: new Date(),
        },
      });
    } catch (err) {
      await prisma.whatsAppCampaign.update({
        where: { id: campaign.id },
        data: {
          status: 'FAILED',
          sent,
          failed,
          finishedAt: new Date(),
        },
      }).catch(() => {});
      logger.error(`[whatsapp] bulk campaign failed: ${err.message}`);
    }
  });

  return campaign;
}

/** Try restore sessions for all studios that have auth folders on boot. */
async function restoreAllSessions() {
  try {
    ensureDir(AUTH_ROOT);
    const dirs = fs.readdirSync(AUTH_ROOT, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    // Stagger restores so we don't open many sockets at once
    let i = 0;
    for (const studioId of dirs) {
      const creds = path.join(authDir(studioId), 'creds.json');
      if (fs.existsSync(creds)) {
        const delay = i * 1500;
        i += 1;
        setTimeout(() => {
          connectStudio(studioId).catch((e) =>
            logger.warn(`[whatsapp] restore ${studioId}: ${e.message}`));
        }, delay);
      }
    }
  } catch (err) {
    logger.warn(`[whatsapp] restoreAll: ${err.message}`);
  }
}

function formatShootDate(date) {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });
}

function formatShootTime(time) {
  if (!time) return '';
  const t = String(time).trim();
  if (/^\d{2}:\d{2}$/.test(t)) {
    const [hh, mm] = t.split(':').map(Number);
    const ap = hh >= 12 ? 'PM' : 'AM';
    const h12 = ((hh + 11) % 12) + 1;
    return `${h12}:${String(mm).padStart(2, '0')} ${ap}`;
  }
  return t;
}

/**
 * Full shoot-schedule WhatsApp: date, time, package, venue, studio contact.
 * kind: confirmed | updated | declined | reschedule_requested
 */
async function notifyShootSchedule(studioId, opts = {}) {
  const {
    phone,
    name,
    customerId,
    kind = 'confirmed',
    date,
    time,
    packageTitle,
    adminNote,
    clientNote,
    venue,
  } = opts;
  if (!phone || !studioId) return;

  await ensureDefaultTemplates(studioId).catch(() => {});

  let venueText = venue || '';
  let pkg = packageTitle || '';
  try {
    if (customerId && (!venueText || !pkg)) {
      const customer = await prisma.customer.findUnique({
        where: { id: customerId },
        select: {
          weddingVenue: true,
          booking: { include: { servicePackage: { select: { title: true } } } },
        },
      });
      if (!venueText) venueText = customer?.weddingVenue || '';
      if (!pkg) pkg = customer?.booking?.servicePackage?.title || '';
    }
    const studio = await prisma.studio.findUnique({
      where: { id: studioId },
      include: { profile: true },
    });
    const profile = studio?.profile;
    const studioName = profile?.displayName || studio?.name || 'SJ Studios';
    const studioPhone = profile?.whatsapp || profile?.phone || studio?.phone || '';
    const studioAddress = profile?.address || '';
    const mapsUrl = profile?.mapsUrl || '';
    const dateLabel = formatShootDate(date);
    const timeLabel = formatShootTime(time);
    const slotLabel = [dateLabel, timeLabel].filter(Boolean).join(' · ');

    const contactBits = [];
    if (studioPhone) contactBits.push(studioPhone);
    if (studioAddress) contactBits.push(studioAddress);
    if (mapsUrl) contactBits.push(mapsUrl);
    const studioContact = contactBits.join('\n');

    const detailLines = [];
    if (dateLabel) detailLines.push(`📅 *Date:* ${dateLabel}`);
    if (timeLabel) detailLines.push(`⏰ *Time:* ${timeLabel}`);
    if (pkg) detailLines.push(`📦 *Package:* ${pkg}`);
    if (venueText) detailLines.push(`📍 *Venue:* ${venueText}`);
    if (adminNote) detailLines.push(`📝 *Studio note:* ${adminNote}`);
    if (clientNote) detailLines.push(`💬 *Your note:* ${clientNote}`);
    const details = detailLines.join('\n') || slotLabel || 'Details will follow.';

    const copy = {
      confirmed: {
        trigger: 'SLOT_CONFIRMED',
        headline: 'Your shoot is *confirmed*.',
        closing: 'Please arrive 15 minutes early. Reply here if you need to change anything.',
      },
      updated: {
        trigger: 'SLOT_UPDATED',
        headline: 'Your shoot schedule has been *updated*. Please note the new date and time.',
        closing: 'Please arrive 15 minutes early. Reply here if anything looks wrong.',
      },
      declined: {
        trigger: 'SLOT_DECLINED',
        headline: 'We could not confirm the requested shoot time.',
        closing: 'Please pick another date and time in the app, or reply here and we will help.',
      },
      reschedule_requested: {
        trigger: 'SLOT_RESCHEDULE_REQUESTED',
        headline: 'We have received your *reschedule request*.',
        closing: 'The studio will review this and confirm your new slot shortly.',
      },
    }[kind] || {
      trigger: 'SLOT_UPDATED',
      headline: 'Your shoot schedule has been updated.',
      closing: 'See you then.',
    };

    triggerAuto(studioId, copy.trigger, {
      phone,
      toName: name,
      skipDedup: true,
      vars: {
        name: name || 'there',
        studioName,
        studioPhone,
        studioAddress,
        studioContact,
        mapsUrl,
        packageTitle: pkg,
        dateLabel,
        timeLabel,
        slotLabel,
        venue: venueText,
        adminNote: adminNote || '',
        headline: copy.headline,
        details,
        closing: copy.closing,
        appUrl: clientAppUrl(),
      },
      meta: { kind, slotLabel, date: dateLabel, time: timeLabel },
    });
  } catch (err) {
    logger.warn(`[whatsapp] notifyShootSchedule: ${err.message}`);
  }
}

module.exports = {
  DEFAULT_TEMPLATES,
  PLACEHOLDERS,
  DEFAULT_DAILY_LIMIT,
  connectStudio,
  disconnectStudio,
  getStatus,
  getDailyQuota,
  sendText,
  sendDocument,
  sendTemplate,
  sendBulk,
  triggerAuto,
  notifyShootSchedule,
  ensureDefaultTemplates,
  notifyRecentPhoneAdds,
  clientAppUrl,
  clientGalleryAppUrl,
  renderTemplate,
  normalizePhone,
  restoreAllSessions,
  upsertSessionRow,
  getSessionRow,
};
