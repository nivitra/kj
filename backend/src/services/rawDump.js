/**
 * Near-expiry “buy all remaining originals” offer.
 * Fulfillment is AccessGrant.rawAccess after the RAW_DUMP invoice is paid.
 */
const { prisma } = require('../config/prisma');
const { recomputeInvoiceFromLedger } = require('./billing/paymentService');

const RAW_DUMP_PREFIX = '[RAW_DUMP:';

function rawDumpMarker(galleryId) {
  return `${RAW_DUMP_PREFIX}${galleryId}]`;
}

function daysUntil(date) {
  if (!date) return null;
  const ms = new Date(date).getTime() - Date.now();
  return Math.ceil(ms / 86400000);
}

function offerWindowStart(gallery) {
  if (!gallery?.expiresAt) return null;
  const days = Math.max(1, Number(gallery.bulkRawWindowDays) || 14);
  return new Date(new Date(gallery.expiresAt).getTime() - days * 86400000);
}

function isOfferLive(gallery, { rawAccess = false, now = new Date() } = {}) {
  if (rawAccess) return false;
  if (!gallery?.bulkRawEnabled) return false;
  const price = Number(gallery.bulkRawPrice);
  if (!Number.isFinite(price) || price <= 0) return false;
  return !gallery.expiresAt || now <= new Date(gallery.expiresAt);
}

function buildOfferPayload(gallery, { rawAccess = false, photoCount = 0, invoice = null, now = new Date() } = {}) {
  const price = Number(gallery?.bulkRawPrice);
  const live = isOfferLive(gallery, { rawAccess, now });
  const daysLeft = daysUntil(gallery?.expiresAt);
  const pending = invoice && !['PAID', 'VOID'].includes(String(invoice.status || '').toUpperCase());
  return {
    enabled: !!gallery?.bulkRawEnabled && Number.isFinite(price) && price > 0,
    live,
    purchased: !!rawAccess,
    pending: !!pending,
    price: Number.isFinite(price) && price > 0 ? price : null,
    priceLabel: Number.isFinite(price) && price > 0
      ? `₹${price.toLocaleString('en-IN')}`
      : null,
    expiresAt: gallery?.expiresAt || null,
    daysLeft,
    windowDays: gallery?.bulkRawWindowDays ?? 14,
    windowStartsAt: offerWindowStart(gallery),
    photoCount,
    headline: live
      ? 'Get the full raw gallery'
      : null,
    body: live
      ? `Unlock every original in this gallery for ${Number.isFinite(price) ? `₹${price.toLocaleString('en-IN')}` : 'a set price'} — no extra picking.`
      : null,
    invoiceId: invoice?.id || null,
    invoiceNumber: invoice?.invoiceNumber || null,
    invoiceStatus: invoice?.status || null,
  };
}

const { nextInvoiceNumber } = require('./billing/invoiceNumber');

async function requestRawDump({ studioId, customerId, gallery, grant }) {
  return prisma.$transaction(async (db) => {
    await db.$queryRaw`SELECT id FROM "AccessGrant" WHERE "customerId" = ${customerId} AND "galleryId" = ${gallery.id} FOR UPDATE`;
    grant = await db.accessGrant.findUnique({ where: { customerId_galleryId: { customerId, galleryId: gallery.id } } });
    gallery = await db.eventGallery.findFirst({ where: { id: gallery.id, studioId, deletedAt: null, status: 'PUBLISHED' } });
    if (!grant || !gallery || (grant.expiresAt && grant.expiresAt <= new Date())) throw new Error('Gallery is unavailable');
  if (grant?.rawAccess) {
    const err = new Error('All originals are already unlocked for this gallery.');
    err.status = 400;
    err.code = 'ALREADY_UNLOCKED';
    throw err;
  }
  if (!isOfferLive(gallery, { rawAccess: false })) {
    const err = new Error('Full raw gallery access is not currently available. Please contact the studio.');
    err.status = 400;
    err.code = 'OFFER_CLOSED';
    throw err;
  }
  const price = Number(gallery.bulkRawPrice);
  const marker = rawDumpMarker(gallery.id);

  if (gallery.bulkRawInvoiceId) {
    const existing = await db.invoice.findFirst({
      where: { id: gallery.bulkRawInvoiceId, studioId, customerId },
      include: { lineItems: true },
    });
    if (existing && existing.status !== 'VOID') {
      const hasLine = (existing.lineItems || []).some((li) =>
        String(li.description || '').includes(marker),
      );
      if (hasLine) {
        return { invoice: existing, created: false, replayed: true };
      }
    }
  }

  const prior = await db.invoice.findFirst({
    where: {
      studioId,
      customerId,
      status: { not: 'VOID' },
      lineItems: { some: { description: { contains: marker } } },
    },
    include: { lineItems: true },
    orderBy: { createdAt: 'desc' },
  });
  if (prior) {
    await db.eventGallery.update({
      where: { id: gallery.id },
      data: { bulkRawInvoiceId: prior.id },
    });
    return { invoice: prior, created: false, replayed: true };
  }

  const invoiceNumber = await nextInvoiceNumber(studioId, db);
  const invoice = await db.invoice.create({
    data: {
      studioId,
      customerId,
      invoiceNumber,
      title: `All originals — ${gallery.name}`,
      status: 'SENT',
      kind: 'INVOICE',
      currency: 'INR',
      totalAmount: price,
      amountPaid: 0,
      cachedOutstanding: price,
      notes: `Client requested full RAW dump for gallery ${gallery.name} ${gallery.expiresAt ? 'before ' + new Date(gallery.expiresAt).toISOString().slice(0, 10) : ''}.`,
      sentAt: new Date(),
      issuedAt: new Date(),
      finalizedAt: new Date(),
      dueDate: gallery.expiresAt ? new Date(gallery.expiresAt) : null,
      lineItems: {
        create: [{
          sortOrder: 0,
          kind: 'ADDON',
          description: `${marker} All remaining originals — ${gallery.name}`,
          quantity: 1,
          unitAmount: price,
          lineTotal: price,
        }],
      },
    },
    include: { lineItems: true },
  });
  await db.eventGallery.update({
    where: { id: gallery.id },
    data: { bulkRawInvoiceId: invoice.id },
  });
  await require('./billing/customerRollup').recomputeCustomerRollup(db, customerId);
  return { invoice, created: true, replayed: false };
  });
}

/**
 * When a RAW_DUMP invoice becomes PAID, grant rawAccess to that customer.
 */
async function fulfillRawDumpIfPaid(invoiceId, db = prisma) {
  if (!invoiceId) return { granted: 0 };
  const invoice = await db.invoice.findUnique({
    where: { id: invoiceId },
    include: { lineItems: true },
  });
  if (!invoice) return { granted: 0 };
  const status = String(invoice.status || '').toUpperCase();
  if (status !== 'PAID') {
    await db.accessGrant.updateMany({ where: { rawInvoiceId: invoiceId, rawGrantedByAdminId: null }, data: { rawAccess: false } });
    return { granted: 0 };
  }

  const galleryIds = new Set();
  for (const li of invoice.lineItems || []) {
    const m = String(li.description || '').match(/\[RAW_DUMP:([^\]]+)\]/);
    if (m?.[1]) galleryIds.add(m[1]);
  }
  if (!galleryIds.size) return { granted: 0 };

  let granted = 0;
  for (const galleryId of galleryIds) {
    const grant = await db.accessGrant.findUnique({
      where: { customerId_galleryId: { customerId: invoice.customerId, galleryId } },
    });
    if (!grant || (grant.expiresAt && grant.expiresAt <= new Date())) continue;
    if (grant.rawAccess || grant.rawGrantedByAdminId) continue;
    await db.accessGrant.update({
      where: { id: grant.id },
      data: {
        rawAccess: true,
        rawInvoiceId: invoiceId,
        rawGrantedAt: new Date(),
      },
    });
    granted += 1;
  }
  return { granted, galleryIds: [...galleryIds] };
}

module.exports = {
  rawDumpMarker,
  daysUntil,
  offerWindowStart,
  isOfferLive,
  buildOfferPayload,
  requestRawDump,
  fulfillRawDumpIfPaid,
};
