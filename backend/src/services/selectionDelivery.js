/**
 * Selection extras are a single price (default ₹350) — no Raw vs Edited.
 * Included package photos stay free. Extras bill on the client's invoice.
 */
const { prisma } = require('../config/prisma');
const { logger } = require('../utils/logger');
const { findBestInvoice } = require('./selectionOverage');
const { recomputeInvoiceFromLedger } = require('./billing/paymentService');

const DEFAULT_EXTRA = 350;

const RAW_PREFIX = '[SEL_RAW:';
const EDIT_PREFIX = '[SEL_EDIT:';

function rawMarker(galleryId) {
  return `${RAW_PREFIX}${galleryId}]`;
}
function editMarker(galleryId) {
  return `${EDIT_PREFIX}${galleryId}]`;
}

function pickExtraRate(...vals) {
  for (const v of vals) {
    if (v == null || v === '') continue;
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

async function resolveDeliveryRates(gallery, customerId) {
  const { pickPositiveRate, pickLimit } = require('./galleryAccess');
  let grant = null;
  if (customerId && gallery?.id) {
    grant = await prisma.accessGrant.findUnique({
      where: { customerId_galleryId: { customerId, galleryId: gallery.id } },
    }).catch(() => null);
  }

  let included = pickLimit(grant?.selectionLimit, gallery?.selectionLimit);
  let extraRate = pickPositiveRate(grant?.extraPhotoPrice, gallery?.extraPhotoPrice);

  if (customerId) {
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      include: {
        package: true,
        booking: { include: { servicePackage: true } },
      },
    });
    const sp = customer?.booking?.servicePackage;
    const tier = customer?.package;
    if (included == null) {
      included = pickLimit(sp?.includedPhotos, tier?.includedPhotos);
    }
    if (extraRate == null) {
      extraRate = pickPositiveRate(
        sp?.pricePerExtraEdited,
        sp?.pricePerExtraPhoto,
        tier?.pricePerExtraPhoto,
        tier?.pricePerExtraEdited,
      );
    }
  }

  const settings = await prisma.pricingSettings.findUnique({
    where: { studioId: gallery.studioId },
  }).catch(() => null);
  if (included == null && settings?.includedPhotos != null) {
    included = Number(settings.includedPhotos);
  }
  if (extraRate == null) {
    extraRate = pickExtraRate(settings?.pricePerExtraPhoto) ?? DEFAULT_EXTRA;
  }

  if (included == null || Number.isNaN(included)) included = 0;
  if (extraRate == null || !Number.isFinite(extraRate)) extraRate = DEFAULT_EXTRA;

  return {
    includedPhotos: Math.max(0, Math.floor(included)),
    pricePerExtraPhoto: extraRate,
    pricePerExtraRaw: extraRate,
    pricePerExtraEdited: extraRate,
  };
}

/**
 * Compute bill from classified items.
 *
 * Package-covered photos: deliveryType INCLUDED | PACKAGE (no charge — already in package).
 * Extras only: RAW (₹200) or EDITED (₹350) — these generate invoice ADDON lines.
 *
 * Legacy fallback: if no INCLUDED markers, free pool covers first `includedPhotos`
 * preferring EDITED then RAW (client-friendly).
 */
function computeDeliveryBill(items, rates) {
  const freePool = Math.max(0, rates.includedPhotos);
  const extraRate = Number(rates.pricePerExtraEdited ?? rates.pricePerExtraPhoto ?? rates.pricePerExtraRaw ?? DEFAULT_EXTRA);
  const includedMarked = items.filter(
    (i) => i.deliveryType === 'INCLUDED' || i.deliveryType === 'PACKAGE' || i.isFree === true,
  );
  const extraItems = items.filter(
    (i) => !(i.deliveryType === 'INCLUDED' || i.deliveryType === 'PACKAGE' || i.isFree === true),
  );

  let freeUsed;
  let extraCount;
  if (includedMarked.length > 0) {
    freeUsed = Math.min(freePool, includedMarked.length);
    extraCount = extraItems.length;
  } else {
    freeUsed = Math.min(freePool, items.length);
    extraCount = Math.max(0, items.length - freeUsed);
  }

  const extraAmount = Math.round(extraCount * extraRate * 100) / 100;

  return {
    totalSelected: items.length,
    classifiedCount: items.length,
    pendingCount: 0,
    rawCount: 0,
    editedCount: extraCount,
    freeCount: freeUsed,
    freePool,
    rawExtraCount: 0,
    editedExtraCount: extraCount,
    extraCount,
    pricePerExtraPhoto: extraRate,
    pricePerExtraRaw: extraRate,
    pricePerExtraEdited: extraRate,
    rawAmount: 0,
    editedAmount: extraAmount,
    extraAmount,
    overageTotal: extraAmount,
    fullyClassified: items.length > 0,
    summaryLines: [
      `${items.length} selected · ${Math.min(freeUsed, freePool)} included (of ${freePool})`,
      extraCount ? `${extraCount} extra × ₹${extraRate} = ₹${extraAmount}` : null,
      extraAmount > 0 ? `Extras total ₹${extraAmount.toLocaleString('en-IN')}` : 'No extra charge — within package',
    ].filter(Boolean),
  };
}

async function loadSelectionForStudio(selectionId, studioId) {
  return prisma.selection.findFirst({
    where: { id: selectionId, gallery: { studioId } },
    include: {
      customer: true,
      gallery: true,
      items: { include: { photo: true }, orderBy: { createdAt: 'asc' } },
    },
  });
}

/**
 * Set delivery type on items. body.classifications: [{ photoId, deliveryType: 'RAW'|'EDITED' }]
 * or bulk: { all: 'RAW'|'EDITED' } or { defaultRemaining: 'RAW'|'EDITED' }
 */
async function classifySelectionItems(selectionId, studioId, body = {}) {
  const selection = await loadSelectionForStudio(selectionId, studioId);
  if (!selection) {
    const err = new Error('Selection not found');
    err.status = 404;
    throw err;
  }
  if (selection.status !== 'SUBMITTED' && selection.status !== 'UNLOCKED') {
    // allow classify when submitted
  }
  if (selection.status === 'OPEN') {
    const err = new Error('Client has not submitted this selection yet');
    err.status = 400;
    throw err;
  }

  const items = selection.items;
  const byPhoto = new Map(items.map((i) => [i.photoId, i]));

  if (body.all === 'RAW' || body.all === 'EDITED') {
    await prisma.selectionItem.updateMany({
      where: { selectionId },
      data: { deliveryType: body.all },
    });
  } else if (body.defaultRemaining === 'RAW' || body.defaultRemaining === 'EDITED') {
    await prisma.selectionItem.updateMany({
      where: {
        selectionId,
        OR: [{ deliveryType: null }, { deliveryType: 'PENDING' }],
      },
      data: { deliveryType: body.defaultRemaining },
    });
  }

  if (Array.isArray(body.classifications)) {
    for (const row of body.classifications) {
      const t = String(row.deliveryType || '').toUpperCase();
      if (!['RAW', 'EDITED', 'INCLUDED', 'PACKAGE', 'PENDING', ''].includes(t)) continue;
      const item = byPhoto.get(row.photoId);
      if (!item) continue;
      const stored = t === 'PENDING' || t === '' ? null : (t === 'PACKAGE' ? 'INCLUDED' : t);
      await prisma.selectionItem.update({
        where: { id: item.id },
        data: { deliveryType: stored },
      });
    }
  }

  const refreshed = await loadSelectionForStudio(selectionId, studioId);
  const rates = await resolveDeliveryRates(refreshed.gallery, refreshed.customerId);
  const bill = computeDeliveryBill(refreshed.items, rates);

  await prisma.selection.update({
    where: { id: selectionId },
    data: {
      deliveryStatus: bill.fullyClassified ? 'CLASSIFIED' : 'AWAITING_CLASSIFY',
      rawCount: bill.rawCount,
      editedCount: bill.editedCount,
      freeCount: bill.freeCount,
      rawExtraCount: bill.rawExtraCount,
      editedExtraCount: bill.editedExtraCount,
      rawUnitPrice: bill.pricePerExtraRaw,
      editedUnitPrice: bill.pricePerExtraEdited,
      overageAmount: bill.overageTotal,
      extraCount: bill.rawExtraCount + bill.editedExtraCount,
      includedLimit: bill.freePool,
      classifiedAt: bill.fullyClassified ? new Date() : null,
    },
  });

  return { selection: refreshed, bill, rates };
}

/**
 * Upsert two ADDON lines (raw + edited) on the linked invoice.
 */
async function billClassifiedSelection(selectionId, studioId, opts = {}) {
  const selection = await loadSelectionForStudio(selectionId, studioId);
  if (!selection) {
    const err = new Error('Selection not found');
    err.status = 404;
    throw err;
  }
  if (selection.status !== 'SUBMITTED') {
    const err = new Error('Selection must be submitted before billing');
    err.status = 400;
    throw err;
  }

  const rates = await resolveDeliveryRates(selection.gallery, selection.customerId);
  const bill = computeDeliveryBill(selection.items, rates);
  if (!bill.fullyClassified) {
    const err = new Error(
      `Classify all photos first (${bill.pendingCount} remaining). Mark each as Raw or Edited.`,
    );
    err.status = 400;
    throw err;
  }

  const gallery = selection.gallery;
  const studioIdG = gallery.studioId;
  const customerId = selection.customerId;
  const galleryId = gallery.id;
  const preferDedicated = opts.preferDedicatedInvoice !== false;

  // Prefer linked extras invoice; optionally create a dedicated one instead of package ADDON.
  let invoice = null;
  let booking = null;
  let created = false;

  if (selection.overageInvoiceId) {
    invoice = await prisma.invoice.findFirst({
      where: { id: selection.overageInvoiceId, studioId: studioIdG, customerId },
      include: { lineItems: true },
    });
  }

  if (!invoice && preferDedicated && bill.overageTotal > 0) {
    // Create dedicated linked extras invoice below (skip attaching to package invoice)
    booking = (await prisma.customerBooking.findUnique({
      where: { customerId },
      select: { servicePackageId: true },
    }).catch(() => null));
  } else if (!invoice) {
    const found = await findBestInvoice(studioIdG, customerId);
    invoice = found.invoice;
    booking = found.booking;
  }

  const currency = 'INR';
  const extraRate = Number(bill.pricePerExtraEdited ?? bill.pricePerExtraPhoto ?? DEFAULT_EXTRA);
  const extraCount = Number(bill.editedExtraCount ?? bill.extraCount ?? 0);
  const extraAmount = Number(bill.editedAmount ?? bill.extraAmount ?? bill.overageTotal ?? 0);
  const extraDesc = `${editMarker(galleryId)} Extra photos × ${extraCount} @ ₹${extraRate} — ${gallery.name}`;

  // Remove old single-rate overage line if present
  if (invoice) {
    const oldPrefix = `[SEL_OVERAGE:${galleryId}]`;
    await prisma.invoiceLineItem.deleteMany({
      where: {
        invoiceId: invoice.id,
        description: { contains: oldPrefix },
      },
    }).catch(() => {});
  }

  async function upsertLine(invoiceId, marker, description, qty, unit, amount) {
    const lines = await prisma.invoiceLineItem.findMany({ where: { invoiceId } });
    const existing = lines.find((li) => String(li.description || '').includes(marker));
    if (qty <= 0 || amount <= 0) {
      if (existing) await prisma.invoiceLineItem.delete({ where: { id: existing.id } });
      return;
    }
    if (existing) {
      await prisma.invoiceLineItem.update({
        where: { id: existing.id },
        data: {
          description,
          quantity: qty,
          unitAmount: unit,
          lineTotal: amount,
          kind: 'ADDON',
        },
      });
    } else {
      const maxSort = lines.reduce((m, l) => Math.max(m, l.sortOrder || 0), 0);
      await prisma.invoiceLineItem.create({
        data: {
          invoiceId,
          sortOrder: maxSort + 1,
          kind: 'ADDON',
          description,
          quantity: qty,
          unitAmount: unit,
          lineTotal: amount,
        },
      });
    }
  }

  function sumLineTotals(lineItems) {
    let sum = 0;
    for (const li of lineItems) {
      const kind = String(li.kind || 'CUSTOM').toUpperCase();
      const lt = Number(li.lineTotal || 0);
      if (kind === 'DISCOUNT') sum -= Math.abs(lt);
      else sum += lt;
    }
    return Math.round(sum * 100) / 100;
  }

  if (!invoice) {
    const year = new Date().getFullYear();
    const prefix = `INV-${year}-`;
    const last = await prisma.invoice.findFirst({
      where: { studioId: studioIdG, invoiceNumber: { startsWith: prefix } },
      orderBy: { invoiceNumber: 'desc' },
      select: { invoiceNumber: true },
    });
    let seq = 1;
    if (last?.invoiceNumber) {
      const n = parseInt(last.invoiceNumber.slice(prefix.length), 10);
      if (Number.isFinite(n)) seq = n + 1;
    }
    const invoiceNumber = `${prefix}${String(seq).padStart(4, '0')}`;
    const total = bill.overageTotal || 0;
    invoice = await prisma.invoice.create({
      data: {
        studioId: studioIdG,
        customerId,
        packageId: booking?.servicePackageId || null,
        invoiceNumber,
        title: `Selection extras — ${gallery.name}`,
        status: 'SENT',
        kind: 'INVOICE',
        currency,
        totalAmount: total,
        amountPaid: 0,
        cachedOutstanding: total,
        notes: `Auto from selection delivery: ${bill.summaryLines.join(' · ')}`,
        sentAt: new Date(),
        issuedAt: new Date(),
        lineItems: {
          create: extraCount > 0 ? [{
            sortOrder: 0,
            kind: 'ADDON',
            description: extraDesc,
            quantity: extraCount,
            unitAmount: extraRate,
            lineTotal: extraAmount,
          }] : [],
        },
      },
      include: { lineItems: true },
    });
    created = true;
    if (total <= 0) {
      // free only — still mark billed
    } else {
      await recomputeInvoiceFromLedger(invoice.id);
    }
  } else {
    // Ensure package line exists when invoice has total but no lines
    let lines = await prisma.invoiceLineItem.findMany({
      where: { invoiceId: invoice.id },
      orderBy: { sortOrder: 'asc' },
    });
    if (!lines.length && Number(invoice.totalAmount || 0) > 0) {
      await prisma.invoiceLineItem.create({
        data: {
          invoiceId: invoice.id,
          sortOrder: 0,
          kind: 'PACKAGE',
          description: 'Package / service fee',
          quantity: 1,
          unitAmount: Number(invoice.totalAmount),
          lineTotal: Number(invoice.totalAmount),
        },
      });
    }

    await upsertLine(invoice.id, rawMarker(galleryId), extraDesc, 0, extraRate, 0);
    await upsertLine(invoice.id, editMarker(galleryId), extraDesc, extraCount, extraRate, extraAmount);

    const allLines = await prisma.invoiceLineItem.findMany({
      where: { invoiceId: invoice.id },
      orderBy: { sortOrder: 'asc' },
    });
    const newTotal = sumLineTotals(allLines);
    const travel = allLines
      .filter((l) => String(l.kind).toUpperCase() === 'TRAVEL')
      .reduce((s, l) => s + Number(l.lineTotal || 0), 0);

    await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        totalAmount: newTotal,
        travelAmount: travel,
        ...(invoice.status === 'DRAFT' ? { status: 'SENT', sentAt: invoice.sentAt || new Date() } : {}),
        notes: [
          invoice.notes || '',
          `[selection-delivery] ${gallery.name}: ${bill.summaryLines.join(' · ')}`,
        ].filter(Boolean).join('\n').slice(0, 4000),
      },
    });
    invoice = await recomputeInvoiceFromLedger(invoice.id);
  }

  await prisma.selection.update({
    where: { id: selectionId },
    data: {
      deliveryStatus: 'BILLED',
      overageInvoiceId: invoice.id,
      overageSyncedAt: new Date(),
      billedAt: new Date(),
      overageAmount: bill.overageTotal,
      rawCount: bill.rawCount,
      editedCount: bill.editedCount,
      freeCount: bill.freeCount,
      rawExtraCount: bill.rawExtraCount,
      editedExtraCount: bill.editedExtraCount,
      rawUnitPrice: bill.pricePerExtraRaw,
      editedUnitPrice: bill.pricePerExtraEdited,
      extraCount: bill.rawExtraCount + bill.editedExtraCount,
      includedLimit: bill.freePool,
      classifiedAt: new Date(),
    },
  });

  // Booking history
  try {
    const b = await prisma.customerBooking.findUnique({ where: { customerId } });
    if (b) {
      const history = Array.isArray(b.history) ? [...b.history] : [];
      history.push({
        status: b.status,
        at: new Date().toISOString(),
        note: `Selection delivery billed on ${invoice.invoiceNumber}: ${bill.summaryLines.join(' · ')}`,
        source: 'SELECTION_DELIVERY_BILL',
        galleryId,
        invoiceId: invoice.id,
      });
      await prisma.customerBooking.update({ where: { id: b.id }, data: { history } });
    }
  } catch (err) {
    logger.warn(`[selectionDelivery] booking history: ${err.message}`);
  }

  logger.info(
    `[selectionDelivery] billed selection=${selectionId} invoice=${invoice.invoiceNumber} total=₹${bill.overageTotal}`,
  );

  return {
    bill,
    invoice: {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      status: invoice.status,
      totalAmount: Number(invoice.totalAmount || 0),
      balance: Number(
        invoice.cachedOutstanding != null
          ? invoice.cachedOutstanding
          : Math.max(0, Number(invoice.totalAmount || 0) - Number(invoice.amountPaid || 0)),
      ),
      currency: invoice.currency || 'INR',
      created,
    },
    notifyAdmin: {
      message: bill.overageTotal > 0
        ? `₹${bill.overageTotal.toLocaleString('en-IN')} selection extras on ${invoice.invoiceNumber}`
        : `Selection billed — no extras (${invoice.invoiceNumber})`,
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      overageTotal: bill.overageTotal,
    },
  };
}

/**
 * Always write extras onto a dedicated SENT invoice at the resolved ₹/extra.
 * Cumulative: line quantity = all billed extras for this gallery.
 */
async function billExtrasNow({
  studioId,
  customerId,
  gallery,
  extraPhotoIds,
  extraRate,
  existingInvoiceId,
}) {
  const ids = [...new Set((extraPhotoIds || []).filter(Boolean))];
  const qty = ids.length;
  const rate = Number.isFinite(Number(extraRate)) && Number(extraRate) >= 0
    ? Number(extraRate)
    : DEFAULT_EXTRA;
  const amount = Math.round(qty * rate * 100) / 100;
  if (qty <= 0) return null;

  let invoice = null;
  let hadExisting = false;
  if (existingInvoiceId) {
    invoice = await prisma.invoice.findFirst({
      where: { id: existingInvoiceId, studioId, customerId, status: { not: 'VOID' } },
      include: { lineItems: true },
    });
    hadExisting = !!invoice;
  }

  const marker = editMarker(gallery.id);
  const description = `Extra photos × ${qty} @ ₹${rate} — ${gallery.name}`;

  if (!invoice) {
    const { nextInvoiceNumber } = require('./billing/issueAndNotify');
    const invoiceNumber = await nextInvoiceNumber(studioId);
    invoice = await prisma.invoice.create({
      data: {
        studioId,
        customerId,
        invoiceNumber,
        title: `Selection extras — ${gallery.name}`,
        status: 'SENT',
        kind: 'INVOICE',
        currency: 'INR',
        totalAmount: amount,
        amountPaid: 0,
        cachedOutstanding: amount,
        notes: description,
        sentAt: new Date(),
        issuedAt: new Date(),
        lineItems: {
          create: [{
            sortOrder: 0,
            kind: 'ADDON',
            description: `${marker} ${description}`,
            quantity: qty,
            unitAmount: rate,
            lineTotal: amount,
          }],
        },
      },
      include: { lineItems: true },
    });
  } else {
    const lines = invoice.lineItems || [];
    const existing = lines.find((li) => String(li.description || '').includes(marker));
    if (existing) {
      await prisma.invoiceLineItem.update({
        where: { id: existing.id },
        data: { description: `${marker} ${description}`, quantity: qty, unitAmount: rate, lineTotal: amount, kind: 'ADDON' },
      });
    } else {
      const maxSort = lines.reduce((m, l) => Math.max(m, l.sortOrder || 0), 0);
      await prisma.invoiceLineItem.create({
        data: {
          invoiceId: invoice.id,
          sortOrder: maxSort + 1,
          kind: 'ADDON',
          description: `${marker} ${description}`,
          quantity: qty,
          unitAmount: rate,
          lineTotal: amount,
        },
      });
    }
    const allLines = await prisma.invoiceLineItem.findMany({ where: { invoiceId: invoice.id } });
    const newTotal = Math.round(allLines.reduce((s, l) => {
      const k = String(l.kind || '').toUpperCase();
      const lt = Number(l.lineTotal || 0);
      return s + (k === 'DISCOUNT' ? -Math.abs(lt) : lt);
    }, 0) * 100) / 100;
    invoice = await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        totalAmount: newTotal,
        cachedOutstanding: Math.max(0, newTotal - Number(invoice.amountPaid || 0)),
        status: invoice.status === 'DRAFT' ? 'SENT' : invoice.status,
        sentAt: invoice.sentAt || new Date(),
        notes: description,
      },
      include: { lineItems: true },
    });
  }

  try {
    invoice = await recomputeInvoiceFromLedger(invoice.id);
  } catch (err) {
    logger.warn(`[selectionDelivery] extras ledger recompute: ${err.message}`);
  }

  logger.info(
    `[selectionDelivery] extras billed invoice=${invoice.invoiceNumber} qty=${qty} rate=₹${rate} total=₹${amount}`,
  );

  return {
    invoiceId: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    extraCount: qty,
    extraRate: rate,
    overageTotal: amount,
    invoiceTotal: Number(invoice.totalAmount || amount),
    created: !hadExisting,
  };
}

module.exports = {
  DEFAULT_RAW: DEFAULT_EXTRA,
  DEFAULT_EDITED: DEFAULT_EXTRA,
  DEFAULT_EXTRA,
  resolveDeliveryRates,
  computeDeliveryBill,
  classifySelectionItems,
  billClassifiedSelection,
  billExtrasNow,
  loadSelectionForStudio,
};
