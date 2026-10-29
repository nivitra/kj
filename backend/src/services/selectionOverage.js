/**
 * Unified selection overage → invoice ADDON line.
 * Ties gallery selection extras to the client's active service invoice
 * (package + booking aware), creating one when none exists.
 */
const { prisma } = require('../config/prisma');
const { recomputeInvoiceFromLedger } = require('./billing/paymentService');
const { logger } = require('../utils/logger');

const OVERAGE_PREFIX = '[SEL_OVERAGE:';

function overageLineMarker(galleryId) {
  return `${OVERAGE_PREFIX}${galleryId}]`;
}

function isOverageLine(li, galleryId) {
  const d = String(li.description || '');
  return d.startsWith(overageLineMarker(galleryId)) || d.includes(`${OVERAGE_PREFIX}${galleryId}]`);
}

async function nextInvoiceNumber(studioId) {
  const year = new Date().getFullYear();
  const prefix = `INV-${year}-`;
  const last = await prisma.invoice.findFirst({
    where: { studioId, invoiceNumber: { startsWith: prefix } },
    orderBy: { invoiceNumber: 'desc' },
    select: { invoiceNumber: true },
  });
  let seq = 1;
  if (last?.invoiceNumber) {
    const n = parseInt(last.invoiceNumber.slice(prefix.length), 10);
    if (Number.isFinite(n)) seq = n + 1;
  }
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

/**
 * Pick the best open invoice for this client — extreme unification:
 * 1) Same ServicePackage as booking when possible
 * 2) Non-void service invoices (SENT / FINALIZED / PARTIAL / PAID / DRAFT)
 * 3) Most recent
 */
async function findBestInvoice(studioId, customerId) {
  const booking = await prisma.customerBooking.findUnique({
    where: { customerId },
    select: { servicePackageId: true, status: true },
  });

  const candidates = await prisma.invoice.findMany({
    where: {
      studioId,
      customerId,
      kind: { not: 'RECEIPT' },
      status: { not: 'VOID' },
    },
    include: { lineItems: { orderBy: { sortOrder: 'asc' } } },
    orderBy: { updatedAt: 'desc' },
    take: 20,
  });
  if (!candidates.length) return { invoice: null, booking };

  const pkgId = booking?.servicePackageId || null;
  const rank = (inv) => {
    let score = 0;
    if (pkgId && inv.packageId === pkgId) score += 100;
    if (['SENT', 'FINALIZED', 'PARTIALLY_PAID'].includes(inv.status)) score += 40;
    if (inv.status === 'DRAFT') score += 20;
    if (inv.status === 'PAID') score += 10; // still attach extras (raises balance)
    score += Math.min(10, (inv.lineItems?.length || 0));
    return score;
  };

  candidates.sort((a, b) => rank(b) - rank(a));
  return { invoice: candidates[0], booking };
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

/**
 * Sync selection overage onto the unified client invoice.
 * @returns {{ invoice, created, removed, lineItem, bookingNote }}
 */
async function syncSelectionOverageInvoice({
  studioId,
  customerId,
  gallery,
  estimate,
  selectionId = null,
}) {
  const extraCount = Number(estimate?.extraCount || 0);
  const unit = Number(estimate?.pricePerExtraPhoto || 0);
  const overageTotal = Math.round(Number(estimate?.overageTotal || 0) * 100) / 100;
  const currency = estimate?.currency || 'INR';
  const galleryId = gallery.id;
  const marker = overageLineMarker(galleryId);
  const description =
    `${marker} Extra photo selections × ${extraCount} @ ₹${unit.toLocaleString('en-IN')} — ${gallery.name}` +
    (estimate?.includedPhotos > 0 ? ` (included limit ${estimate.includedPhotos})` : '');

  const { invoice: found, booking } = await findBestInvoice(studioId, customerId);
  let invoice = found;
  let created = false;

  // No extras → remove prior overage line if present
  if (extraCount <= 0 || overageTotal <= 0 || unit <= 0) {
    if (invoice) {
      const existing = (invoice.lineItems || []).find((li) => isOverageLine(li, galleryId));
      if (existing) {
        await prisma.invoiceLineItem.delete({ where: { id: existing.id } });
        const remaining = await prisma.invoiceLineItem.findMany({
          where: { invoiceId: invoice.id },
          orderBy: { sortOrder: 'asc' },
        });
        // If invoice was auto-created only for overage and is now empty, void it
        const onlyOverageInvoice = String(invoice.title || '').includes('Extra photo selections')
          && remaining.length === 0
          && Number(invoice.amountPaid || 0) === 0;
        if (onlyOverageInvoice && invoice.status === 'DRAFT') {
          await prisma.invoice.update({
            where: { id: invoice.id },
            data: { status: 'VOID', voidedAt: new Date(), voidReason: 'Selection extras cleared', totalAmount: 0 },
          });
        } else {
          const total = remaining.length ? sumLineTotals(remaining) : Number(invoice.totalAmount || 0);
          // If we still have non-overage lines, recompute from them; else keep package total minus this line
          let newTotal;
          if (remaining.length) {
            newTotal = sumLineTotals(remaining);
          } else {
            newTotal = Math.max(0, Number(invoice.totalAmount || 0) - Number(existing.lineTotal || 0));
          }
          await prisma.invoice.update({
            where: { id: invoice.id },
            data: {
              totalAmount: newTotal,
              travelAmount: remaining.filter((l) => l.kind === 'TRAVEL').reduce((s, l) => s + Number(l.lineTotal || 0), 0),
            },
          });
          await recomputeInvoiceFromLedger(invoice.id);
        }
        if (selectionId) {
          await prisma.selection.update({
            where: { id: selectionId },
            data: {
              extraCount: 0,
              overageAmount: 0,
              extraUnitPrice: unit,
              includedLimit: estimate?.includedPhotos ?? null,
              overageInvoiceId: null,
              overageSyncedAt: new Date(),
            },
          }).catch(() => {});
        }
        return { invoice, created: false, removed: true, lineItem: null, booking };
      }
    }
    if (selectionId) {
      await prisma.selection.update({
        where: { id: selectionId },
        data: {
          extraCount: 0,
          overageAmount: 0,
          extraUnitPrice: unit,
          includedLimit: estimate?.includedPhotos ?? null,
          overageSyncedAt: new Date(),
        },
      }).catch(() => {});
    }
    return { invoice, created: false, removed: false, lineItem: null, booking };
  }

  // Create invoice if client has none
  if (!invoice) {
    const invoiceNumber = await nextInvoiceNumber(studioId);
    const packageId = booking?.servicePackageId || null;
    invoice = await prisma.invoice.create({
      data: {
        studioId,
        customerId,
        packageId,
        invoiceNumber,
        title: `Extra photo selections — ${gallery.name}`,
        status: 'SENT',
        kind: 'INVOICE',
        currency,
        totalAmount: overageTotal,
        amountPaid: 0,
        cachedOutstanding: overageTotal,
        notes: `Auto-created from selection overage on gallery “${gallery.name}”. Package limit ${estimate.includedPhotos}, extras @ ₹${unit}.`,
        sentAt: new Date(),
        issuedAt: new Date(),
        lineItems: {
          create: [{
            sortOrder: 0,
            kind: 'ADDON',
            description,
            quantity: extraCount,
            unitAmount: unit,
            lineTotal: overageTotal,
          }],
        },
      },
      include: { lineItems: true },
    });
    created = true;
    await recomputeInvoiceFromLedger(invoice.id);
  } else {
    // Ensure package line exists when invoice has package total but no lines
    let lines = invoice.lineItems || [];
    if (!lines.length && Number(invoice.totalAmount || 0) > 0) {
      const packageLabel = invoice.packageId
        ? 'Package / service fee'
        : 'Studio service total';
      await prisma.invoiceLineItem.create({
        data: {
          invoiceId: invoice.id,
          sortOrder: 0,
          kind: 'PACKAGE',
          description: packageLabel,
          quantity: 1,
          unitAmount: Number(invoice.totalAmount),
          lineTotal: Number(invoice.totalAmount),
        },
      });
      lines = await prisma.invoiceLineItem.findMany({
        where: { invoiceId: invoice.id },
        orderBy: { sortOrder: 'asc' },
      });
    }

    const existing = lines.find((li) => isOverageLine(li, galleryId));
    if (existing) {
      await prisma.invoiceLineItem.update({
        where: { id: existing.id },
        data: {
          description,
          quantity: extraCount,
          unitAmount: unit,
          lineTotal: overageTotal,
          kind: 'ADDON',
        },
      });
    } else {
      const maxSort = lines.reduce((m, l) => Math.max(m, l.sortOrder || 0), 0);
      await prisma.invoiceLineItem.create({
        data: {
          invoiceId: invoice.id,
          sortOrder: maxSort + 1,
          kind: 'ADDON',
          description,
          quantity: extraCount,
          unitAmount: unit,
          lineTotal: overageTotal,
        },
      });
    }

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
        // Keep SENT/FINALIZED; recompute status from ledger after
        ...(invoice.status === 'DRAFT' ? { status: 'SENT', sentAt: invoice.sentAt || new Date() } : {}),
        notes: invoice.notes
          ? `${invoice.notes}\n[selection] ${gallery.name}: ${extraCount} extras @ ₹${unit}`.slice(0, 2000)
          : `Selection overage on “${gallery.name}”: ${extraCount} × ₹${unit}.`,
      },
    });
    invoice = await recomputeInvoiceFromLedger(invoice.id);
  }

  if (selectionId) {
    await prisma.selection.update({
      where: { id: selectionId },
      data: {
        extraCount,
        extraUnitPrice: unit,
        overageAmount: overageTotal,
        includedLimit: estimate?.includedPhotos ?? null,
        overageInvoiceId: invoice.id,
        overageSyncedAt: new Date(),
      },
    }).catch(() => {});
  }

  // Booking timeline note — unify status board with selection + invoice
  if (booking) {
    try {
      const b = await prisma.customerBooking.findUnique({ where: { customerId } });
      if (b) {
        const history = Array.isArray(b.history) ? [...b.history] : [];
        history.push({
          status: b.status,
          at: new Date().toISOString(),
          note:
            `Selection on “${gallery.name}”: ${estimate.selectedCount} photos ` +
            `(${estimate.freeCount || Math.min(estimate.selectedCount, estimate.includedPhotos)} included, ` +
            `${extraCount} extra @ ₹${unit} = ₹${overageTotal}) → invoice ${invoice.invoiceNumber}`,
          source: 'SELECTION_OVERAGE',
          galleryId,
          invoiceId: invoice.id,
        });
        await prisma.customerBooking.update({
          where: { id: b.id },
          data: { history },
        });
      }
    } catch (err) {
      logger.warn(`[selectionOverage] booking history: ${err.message}`);
    }
  }

  // Persist structured activity event on invoice meta (admin + customer timeline)
  try {
    const fullInv = await prisma.invoice.findUnique({
      where: { id: invoice.id },
      select: { meta: true, notes: true },
    });
    // meta may not exist on older schemas — use notes activity JSON line as fallback
    const event = {
      type: 'SELECTION_OVERAGE',
      at: new Date().toISOString(),
      galleryId,
      galleryName: gallery.name,
      extraCount,
      unit,
      overageTotal,
      invoiceNumber: invoice.invoiceNumber,
      customerId,
      created,
    };
    const activityLine = `[activity] ${JSON.stringify(event)}`;
    const prevNotes = fullInv?.notes || '';
    if (!prevNotes.includes(`"galleryId":"${galleryId}"`) || !prevNotes.includes('"type":"SELECTION_OVERAGE"')) {
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          notes: `${prevNotes}${prevNotes ? '\n' : ''}${activityLine}`.slice(0, 4000),
        },
      }).catch(() => {});
    }
    // Optional AuditLog if table exists in schema
    try {
      await prisma.auditLog.create({
        data: {
          galleryId,
          action: 'SELECTION_OVERAGE_INVOICE',
          entityType: 'invoice',
          entityId: invoice.id,
          details: event,
        },
      });
    } catch (_) { /* non-fatal */ }
  } catch (err) {
    logger.warn(`[selectionOverage] activity log: ${err.message}`);
  }

  logger.info(
    `[selectionOverage] customer=${customerId} gallery=${galleryId} extras=${extraCount} ` +
    `₹${overageTotal} invoice=${invoice.invoiceNumber} created=${created}`,
  );

  return {
    invoice: {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      status: invoice.status,
      totalAmount: Number(invoice.totalAmount || 0),
      balance: Number(invoice.cachedOutstanding != null
        ? invoice.cachedOutstanding
        : Math.max(0, Number(invoice.totalAmount || 0) - Number(invoice.amountPaid || 0))),
      currency: invoice.currency || currency,
    },
    created,
    removed: false,
    lineItem: { extraCount, unit, overageTotal, description },
    booking: booking ? { status: booking.status, servicePackageId: booking.servicePackageId } : null,
    notifyAdmin: {
      message: `₹${overageTotal.toLocaleString('en-IN')} extra added to ${invoice.invoiceNumber}`,
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      overageTotal,
      extraCount,
      galleryName: gallery.name,
      customerId,
    },
  };
}

module.exports = {
  syncSelectionOverageInvoice,
  findBestInvoice,
  overageLineMarker,
  DEFAULT_EXTRA_PHOTO_PRICE: require('./pricing').DEFAULT_EXTRA_PHOTO_PRICE,
};
