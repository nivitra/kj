/**
 * Immutable payment ledger — recordPayment with FOR UPDATE + idempotency.
 */
const { prisma } = require('../../config/prisma');
const {
  toPaise,
  fromPaise,
  fromPaiseDecimalString,
  computeMoney,
  deriveStatus,
} = require('./money');
const { writeLegacyInstallmentMirrors } = require('./dualWrite');
const { recomputeCustomerRollup } = require('./customerRollup');
const { dualWriteLegacyInstallments, receiptsEnabled } = require('./flags');

class BillingError extends Error {
  constructor(message, { status = 400, code = 'VALIDATION', details } = {}) {
    super(message);
    this.name = 'BillingError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function assertManagerPlus(admin) {
  const role = admin?.role || 'STAFF';
  if (!['OWNER', 'MANAGER'].includes(role)) {
    throw new BillingError('Insufficient permissions', { status: 403, code: 'FORBIDDEN' });
  }
}

/**
 * Record a payment or refund under row lock.
 * @returns {{ payment, receipt, money, status, replayed, invoiceId }}
 */
async function recordPayment({ studioId, invoiceId, body, admin, targetPaid, db }) {
  assertManagerPlus(admin);
  let key = body?.idempotencyKey;
  if (typeof key === 'string') {
    key = key.trim();
    if (key === '') {
      throw new BillingError('idempotencyKey must be non-empty when provided');
    }
    key = key.slice(0, 128);
  } else {
    key = null;
  }

  let kind = String(body?.kind || 'PAYMENT').toUpperCase();
  const allowed = ['PAYMENT', 'REFUND'];
  if (['ROUND_OFF', 'WRITE_OFF', 'ADJUSTMENT'].includes(kind)) {
    throw new BillingError('Use Update paid — set how much is paid. Write-off and round-off are not used.');
  }
  if (!allowed.includes(kind)) {
    throw new BillingError(`kind must be one of ${allowed.join(', ')}`);
  }



  let amountPaise = toPaise(body?.amount);
  if (targetPaid == null && amountPaise <= 0n) {
    throw new BillingError('Enter a positive amount');
  }

  const allowOverpay = false;
  const allowNegativeCash = false;
  const paidAt = body?.paidAt ? new Date(body.paidAt) : new Date();
  if (!Number.isFinite(paidAt.getTime())) throw new BillingError('Enter a valid payment date');
  const transact = db ? (fn) => fn(db) : (fn) => prisma.$transaction(fn, { isolationLevel: 'ReadCommitted' });

  try {
    return await transact(async (tx) => {
      const rows = await tx.$queryRaw`
        SELECT id, status, "totalAmount", "finalizedAt", "sentAt", "customerId", "amountPaid", currency, kind
        FROM "Invoice"
        WHERE id = ${invoiceId} AND "studioId" = ${studioId}
        FOR UPDATE
      `;
      if (!rows?.length) {
        throw new BillingError('Invoice not found', { status: 404, code: 'NOT_FOUND' });
      }
      const inv = rows[0];
      if (inv.kind === 'RECEIPT') {
        throw new BillingError('Cannot record payments on a receipt row');
      }
      if (inv.status === 'VOID') {
        throw new BillingError('Invoice is void');
      }
      if (inv.status === 'DRAFT' || !inv.finalizedAt) {
        throw new BillingError('Finalize the invoice before recording payments');
      }

      if (key) {
        const existing = await tx.invoicePayment.findFirst({
          where: { studioId, idempotencyKey: key },
        });
        if (existing) {
          if (existing.invoiceId !== invoiceId || toPaise(existing.amount) !== amountPaise || existing.kind !== kind || (existing.reference || '') !== (body?.reference || '')) {
            throw new BillingError('idempotencyKey already used on another invoice', {
              status: 409,
              code: 'CONFLICT',
            });
          }
          return {
            payment: existing,
            receipt: null,
            money: null,
            status: inv.status,
            replayed: true,
            invoiceId,
            customerId: inv.customerId,
          };
        }
      }

      const allPayments = await tx.invoicePayment.findMany({ where: { invoiceId } });
      // Preserve historical cash recorded before the ledger was introduced.
      if (allPayments.length === 0 && toPaise(inv.amountPaid) > 0n) {
        allPayments.push(await tx.invoicePayment.create({ data: {
          studioId, invoiceId, kind: 'PAYMENT', amount: inv.amountPaid,
          method: 'LEGACY', note: 'Opening balance imported from recorded paid total',
          idempotencyKey: `opening:${invoiceId}`, paidAt: inv.sentAt || inv.finalizedAt,
        } }));
      }
      const payments = allPayments.filter((p) => !p.voidedAt);
      const money = computeMoney(inv.totalAmount, payments);
      const displayCash = money.displayCashPaid;
      if (targetPaid != null) {
        const target = toPaise(targetPaid);
        if (target < displayCash) throw new BillingError('To reduce the paid total, reverse an incorrect receipt or record an actual refund. Payment history is preserved.');
        if (target > money.totalPaise) throw new BillingError('Paid total cannot exceed the invoice total');
        amountPaise = target - displayCash;
        if (amountPaise === 0n) return { payment: null, money, status: inv.status, unchanged: true, invoiceId };
      }

      if (kind === 'PAYMENT' && !allowOverpay) {
        if (amountPaise > money.outstandingPaise) {
          throw new BillingError(
            `Amount exceeds outstanding ${fromPaise(money.outstandingPaise)}`,
            { details: { outstanding: fromPaise(money.outstandingPaise) } },
          );
        }
      }
      if (kind === 'REFUND' && !allowNegativeCash) {
        if (amountPaise > displayCash) {
          throw new BillingError(
            `Refund exceeds cash paid ${fromPaise(displayCash)}`,
            { details: { cashPaid: fromPaise(displayCash) } },
          );
        }
      }
      if (['WRITE_OFF', 'ROUND_OFF', 'ADJUSTMENT'].includes(kind) && !allowOverpay) {
        if (amountPaise > money.outstandingPaise) {
          throw new BillingError(
            `Amount exceeds outstanding ${fromPaise(money.outstandingPaise)}`,
            { details: { outstanding: fromPaise(money.outstandingPaise) } },
          );
        }
      }

      const payment = await tx.invoicePayment.create({
        data: {
          studioId,
          invoiceId,
          installmentId: null,
          kind,
          amount: fromPaiseDecimalString(amountPaise),
          method: body?.method
            ? String(body.method).slice(0, 40)
            : (kind === 'PAYMENT' ? 'CASH' : null),
          reference: body?.reference ? String(body.reference).slice(0, 120) : null,
          note: body?.note ? String(body.note).slice(0, 500) : null,
          paidAt,
          createdById: admin?.id || null,
          idempotencyKey: key,
        },
      });

      const money2 = computeMoney(inv.totalAmount, [...payments, payment]);
      const status = deriveStatus(inv, money2);

      await tx.invoice.update({
        where: { id: invoiceId },
        data: {
          amountPaid: fromPaiseDecimalString(money2.displayCashPaid),
          cachedOutstanding: fromPaiseDecimalString(money2.outstandingPaise),
          status,
        },
      });

      if (dualWriteLegacyInstallments()) {
        const installments = await tx.invoiceInstallment.findMany({
          where: { invoiceId },
          orderBy: { sortOrder: 'asc' },
        });
        await writeLegacyInstallmentMirrors(tx, invoiceId, money2, installments);
      }

      let receipt = null;
      if (receiptsEnabled() && kind === 'PAYMENT' && body?.issueReceipt !== false) {
        const { createReceiptInTx } = require('./receiptService');
        receipt = await createReceiptInTx(tx, studioId, invoiceId, payment.id);
      }

      await recomputeCustomerRollup(tx, inv.customerId);
      await require('../rawDump').fulfillRawDumpIfPaid(invoiceId, tx);

      return {
        payment,
        receipt,
        money: money2,
        status,
        replayed: false,
        invoiceId,
        customerId: inv.customerId,
      };
    });
  } catch (e) {
    if (e instanceof BillingError) throw e;
    if (e?.code === 'P2002' && key) {
      const existing = await prisma.invoicePayment.findFirst({
        where: { studioId, idempotencyKey: key },
      });
      if (existing && existing.invoiceId === invoiceId && toPaise(existing.amount) === amountPaise && existing.kind === kind && (existing.reference || '') === (body?.reference || '')) {
        return {
          payment: existing,
          receipt: null,
          money: null,
          status: null,
          replayed: true,
          invoiceId,
        };
      }
      throw new BillingError('idempotencyKey already used on another invoice', {
        status: 409,
        code: 'CONFLICT',
      });
    }
    throw e;
  }
}

/**
 * Soft-void a payment (MANAGER+).
 */
async function voidPayment({ studioId, invoiceId, paymentId, reason, admin }) {
  assertManagerPlus(admin);

  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw`
      SELECT id, status, "totalAmount", "finalizedAt", "sentAt", "customerId", "amountPaid", currency, kind
      FROM "Invoice"
      WHERE id = ${invoiceId} AND "studioId" = ${studioId}
      FOR UPDATE
    `;
    if (!rows?.length) {
      throw new BillingError('Invoice not found', { status: 404, code: 'NOT_FOUND' });
    }
    const inv = rows[0];

    const payment = await tx.invoicePayment.findFirst({
      where: { id: paymentId, invoiceId, studioId },
    });
    if (!payment) {
      throw new BillingError('Payment not found', { status: 404, code: 'NOT_FOUND' });
    }
    if (payment.voidedAt) {
      throw new BillingError('Payment already voided');
    }

    await tx.invoicePayment.update({
      where: { id: paymentId },
      data: {
        voidedAt: new Date(),
        voidReason: reason ? String(reason).slice(0, 500) : null,
        voidedById: admin?.id || null,
      },
    });

    // Void linked receipts if table exists
    try {
      await tx.receipt.updateMany({
        where: { paymentId, studioId },
        data: {
          status: 'VOID',
          voidedAt: new Date(),
          voidReason: reason ? String(reason).slice(0, 500) : 'Payment voided',
        },
      });
    } catch (_) { /* table may not exist */ }

    const payments = await tx.invoicePayment.findMany({
      where: { invoiceId, voidedAt: null },
    });
    const money2 = computeMoney(inv.totalAmount, payments);
    if (money2.cashPaidPaise < 0n) throw new BillingError('Reverse the associated refund before reversing this payment');
    const status = deriveStatus(inv, money2);

    await tx.invoice.update({
      where: { id: invoiceId },
      data: {
        amountPaid: fromPaiseDecimalString(money2.displayCashPaid),
        cachedOutstanding: fromPaiseDecimalString(money2.outstandingPaise),
        status,
      },
    });

    if (dualWriteLegacyInstallments()) {
      const installments = await tx.invoiceInstallment.findMany({
        where: { invoiceId },
        orderBy: { sortOrder: 'asc' },
      });
      await writeLegacyInstallmentMirrors(tx, invoiceId, money2, installments);
    }

    await recomputeCustomerRollup(tx, inv.customerId);
    await require('../rawDump').fulfillRawDumpIfPaid(invoiceId, tx);

    return { money: money2, status, invoiceId };
  }).then(async (result) => {
    if (result?.status === 'PAID') {
      try {
        const { fulfillRawDumpIfPaid } = require('../rawDump');
        await fulfillRawDumpIfPaid(result.invoiceId);
      } catch (_) { /* non-fatal */ }
    }
    return result;
  });
}

/**
 * Recompute invoice caches from ledger (no new payment).
 */
async function recomputeInvoiceFromLedger(invoiceId) {
  const inv = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      installments: { orderBy: { sortOrder: 'asc' } },
      payments: true,
    },
  });
  if (!inv || inv.kind === 'RECEIPT') return inv;

  const active = (inv.payments || []).filter((p) => !p.voidedAt);
  const money = computeMoney(inv.totalAmount, inv.payments.length ? active : Number(inv.amountPaid) > 0 ? [{ kind: 'PAYMENT', amount: inv.amountPaid }] : []);
  const status = deriveStatus(inv, money);

  await prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      amountPaid: fromPaiseDecimalString(money.displayCashPaid),
      cachedOutstanding: fromPaiseDecimalString(money.outstandingPaise),
      status,
    },
  });
  if (status === 'PAID') {
    try {
      const { fulfillRawDumpIfPaid } = require('../rawDump');
      await fulfillRawDumpIfPaid(invoiceId);
    } catch (_) { /* non-fatal */ }
  }

  if (dualWriteLegacyInstallments() && inv.installments?.length) {
    await prisma.$transaction(async (tx) => {
      await writeLegacyInstallmentMirrors(tx, invoiceId, money, inv.installments);
    });
  }

  await recomputeCustomerRollup(prisma, inv.customerId);

  return prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      customer: { select: { id: true, name: true, email: true, phone: true } },
      package: true,
      installments: { orderBy: { sortOrder: 'asc' } },
      payments: { orderBy: { paidAt: 'desc' } },
      lineItems: { orderBy: { sortOrder: 'asc' } },
      documentReceipts: true,
    },
  });
}

/**
 * Set the invoice's paid total. One number — no write-off / round-off.
 * Records a PAYMENT or REFUND for the delta against current cash paid.
 */
async function setInvoicePaid({ studioId, invoiceId, amountPaid, admin, method, note }) {
  if (amountPaid == null || amountPaid === '') {
    throw new BillingError('Enter how much is paid');
  }
  const targetRaw = toPaise(amountPaid);
  if (targetRaw < 0n) {
    throw new BillingError('Paid amount cannot be negative');
  }

  return recordPayment({ studioId, invoiceId, admin, targetPaid: amountPaid,
    body: { amount: 0, method: method || 'CASH', note: note || 'Additional payment recorded from paid total' },
  });
}

module.exports = {
  BillingError,
  recordPayment,
  setInvoicePaid,
  voidPayment,
  recomputeInvoiceFromLedger,
  assertManagerPlus,
};
