/**
 * Create a SENT invoice from line items and WhatsApp the client (PDF + totals).
 */
const { prisma } = require('../../config/prisma');
const { buildInvoicePdf } = require('../invoicePdf');
const { projectInvoice, invoiceInclude } = require('./projectInvoice');
const { resolvePaymentTerms, DEFAULT_PAYMENT_TERMS } = require('../studioTerms');
const { uploadToS3, getSignedDownloadUrl } = require('../s3');
const { logger } = require('../../utils/logger');

const { nextInvoiceNumber } = require('./invoiceNumber');

async function loadStudioMeta(studioId) {
  const [studio, profile] = await Promise.all([
    prisma.studio.findUnique({ where: { id: studioId }, select: { name: true } }),
    prisma.studioProfile.findUnique({ where: { studioId } }),
  ]);
  return {
    studioName: profile?.displayName || studio?.name || 'SJ Clicks and Films',
    studioPhone: profile?.phone || profile?.whatsapp || null,
    studioEmail: profile?.email || null,
    studioAddress: profile?.address || 'Nanded, Maharashtra',
    termsHtml: profile?.termsHtml || null,
    tagline: profile?.tagline || 'Studio by Warmkelvin',
  };
}

function moneyIn(n, currency = 'INR') {
  const v = Math.round(Number(n) || 0);
  return `${currency} ${v.toLocaleString('en-IN')}`;
}

/**
 * @param {{ studioId, customerId, title, lines: {kind, description, quantity, unitAmount, lineTotal}[],
 *           terms?, notes?, createdById?, packageId?, fiftyFifty?: boolean }} opts
 */
async function createSentInvoice(opts, db = prisma) {
  const {
    studioId, customerId, title, lines, terms, notes, createdById, packageId, fiftyFifty,
  } = opts;
  const profile = await db.studioProfile.findUnique({ where: { studioId } });
  const resolvedTerms = String(terms || '').trim()
    || (profile?.termsHtml ? String(profile.termsHtml).replace(/<[^>]+>/g, ' ').slice(0, 2000) : '')
    || DEFAULT_PAYMENT_TERMS;

  const cleanLines = (Array.isArray(lines) ? lines : [])
    .filter((l) => Number(l.lineTotal || l.unitAmount || 0) !== 0)
    .map((l, i) => {
      const qty = Math.max(1, Number(l.quantity) || 1);
      const unit = Math.round(Number(l.unitAmount ?? l.amount ?? l.lineTotal ?? 0) * 100) / 100;
      const total = Math.round(Number(l.lineTotal != null ? l.lineTotal : unit * qty) * 100) / 100;
      return {
        sortOrder: i,
        kind: String(l.kind || 'PACKAGE').slice(0, 20),
        description: String(l.description || l.title || 'Item').slice(0, 240),
        quantity: qty,
        unitAmount: unit,
        lineTotal: total,
      };
    });
  const total = Math.round(cleanLines.reduce((s, l) => s + Number(l.lineTotal), 0) * 100) / 100;
  const invoiceNumber = await nextInvoiceNumber(studioId, db);

  const instCreates = [];
  if (fiftyFifty && total > 0) {
    const first = Math.round((total / 2) * 100) / 100;
    const second = Math.round((total - first) * 100) / 100;
    instCreates.push(
      { sortOrder: 0, label: 'Advance (50%)', amount: first, terms: 'To confirm and secure the date', status: 'PENDING' },
      { sortOrder: 1, label: 'Event day (50%)', amount: second, terms: 'Due on the day of the event', status: 'PENDING' },
    );
  }

  const inv = await db.invoice.create({
    data: {
      studioId,
      customerId,
      packageId: packageId || null,
      invoiceNumber,
      title: String(title || 'Service Invoice').slice(0, 160),
      status: 'SENT',
      kind: 'INVOICE',
      currency: 'INR',
      totalAmount: total,
      taxAmount: cleanLines.filter((l) => l.kind === 'TAX').reduce((sum, l) => sum + l.lineTotal, 0),
      amountPaid: 0,
      cachedOutstanding: total,
      notes: notes || null,
      terms: resolvedTerms,
      sentAt: new Date(),
      issuedAt: new Date(),
      finalizedAt: new Date(),
      createdById: createdById || null,
      lineItems: cleanLines.length ? { create: cleanLines } : undefined,
      installments: instCreates.length ? { create: instCreates } : undefined,
    },
    include: invoiceInclude,
  });
  return inv;
}

async function notifyInvoiceWhatsApp({ studioId, invoiceId, caption }) {
  const inv = await prisma.invoice.findFirst({
    where: { id: invoiceId, studioId },
    include: invoiceInclude,
  });
  if (!inv?.customer?.phone) return { sent: false, reason: 'no-phone' };

  const mapped = projectInvoice(inv, { includeCustomer: true });
  const meta = await loadStudioMeta(studioId);
  const buf = await buildInvoicePdf({
    ...inv,
    ...mapped,
    terms: resolvePaymentTerms(meta.termsHtml, inv.terms),
  }, meta);
  const filename = `${(inv.invoiceNumber || 'invoice').replace(/[^\w.-]+/g, '_')}.pdf`;
  try {
    const key = `studios/${studioId}/invoices/${inv.id}/invoice.pdf`;
    await uploadToS3(key, buf, 'application/pdf', {
      contentDisposition: `inline; filename="${filename}"`,
    });
    await getSignedDownloadUrl(key, 900, {
      contentType: 'application/pdf',
      contentDisposition: `inline; filename="${filename}"`,
    }).catch(() => null);
  } catch (err) {
    logger.warn(`[invoice-notify] pdf upload: ${err.message}`);
  }

  const total = Number(mapped.totalAmount || inv.totalAmount || 0);
  const paid = Number(mapped.cashPaid ?? mapped.amountPaid ?? 0);
  const balance = Math.max(0, total - paid);
  const currency = inv.currency || 'INR';
  const text = caption || [
    `Hi ${inv.customer.name || 'there'},`,
    '',
    `Invoice *${inv.invoiceNumber}* is ready.`,
    `Total: ${moneyIn(total, currency)}`,
    paid > 0 ? `Paid: ${moneyIn(paid, currency)}` : null,
    `Balance due: ${moneyIn(balance, currency)}`,
    '',
    'Open the client app → Billing to view it anytime.',
    '',
    `— ${meta.studioName}`,
  ].filter((l) => l !== null).join('\n');

  try {
    const { sendDocument, triggerAuto } = require('../whatsapp');
    await sendDocument({
      studioId,
      phone: inv.customer.phone,
      toName: inv.customer.name,
      buffer: buf,
      fileName: filename,
      caption: text.slice(0, 1024),
      source: 'AUTO',
      meta: { invoiceId: inv.id, invoiceNumber: inv.invoiceNumber },
    });
    triggerAuto(studioId, 'INVOICE_SENT', {
      phone: inv.customer.phone,
      toName: inv.customer.name,
      vars: {
        name: inv.customer.name,
        invoiceNumber: inv.invoiceNumber,
        totalAmount: String(total),
        balance: String(balance),
        currency,
      },
      meta: { invoiceId: inv.id },
    });
  } catch (err) {
    logger.warn(`[invoice-notify] whatsapp: ${err.message}`);
    return { sent: false, reason: err.message };
  }
  return { sent: true, invoiceNumber: inv.invoiceNumber };
}

module.exports = {
  nextInvoiceNumber,
  createSentInvoice,
  notifyInvoiceWhatsApp,
  loadStudioMeta,
};
