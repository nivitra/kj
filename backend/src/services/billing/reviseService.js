/**
 * Invoice revise — package upgrade/downgrade with snapshot history.
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
const { dualWriteLegacyInstallments } = require('./flags');
const { BillingError, assertManagerPlus } = require('./paymentService');

/**
 * @param {object} opts
 * @param {string} opts.studioId
 * @param {string} opts.invoiceId
 * @param {object} opts.body
 * @param {object} opts.admin
 */
async function reviseInvoice({ studioId, invoiceId, body, admin }) {
  assertManagerPlus(admin);

  const {
    lineItems,
    milestones,
    milestonesMode = 'KEEP',
    reason,
    title,
    notes,
    terms,
    packageId,
    packageSnapshot,
  } = body || {};

  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw`
      SELECT id, status, "totalAmount", "finalizedAt", "sentAt", "customerId", currency, kind
      FROM "Invoice"
      WHERE id = ${invoiceId} AND "studioId" = ${studioId}
      FOR UPDATE
    `;
    if (!rows?.length) {
      throw new BillingError('Invoice not found', { status: 404, code: 'NOT_FOUND' });
    }
    const inv = rows[0];
    if (inv.status === 'VOID' || inv.status === 'DRAFT') {
      throw new BillingError('Cannot revise a draft or void invoice');
    }
    if (inv.kind === 'RECEIPT') {
      throw new BillingError('Cannot revise a receipt');
    }

    // Snapshot current state
    const full = await tx.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        installments: true,
        lineItems: true,
        payments: true,
      },
    });
    const revCount = await tx.invoiceRevision.count({ where: { invoiceId } });
    await tx.invoiceRevision.create({
      data: {
        invoiceId,
        revision: revCount + 1,
        reason: reason ? String(reason).slice(0, 500) : null,
        createdById: admin?.id || null,
        snapshot: {
          totalAmount: Number(full.totalAmount),
          status: full.status,
          lineItems: full.lineItems,
          installments: full.installments,
          packageId: full.packageId,
          packageSnapshot: full.packageSnapshot,
        },
      },
    });

    let newTotal = Number(full.totalAmount);
    const data = {};

    if (title !== undefined) data.title = String(title).slice(0, 160);
    if (notes !== undefined) data.notes = notes || null;
    if (terms !== undefined) data.terms = terms || null;
    if (packageId !== undefined) data.packageId = packageId || null;
    if (packageSnapshot !== undefined) data.packageSnapshot = packageSnapshot;

    if (Array.isArray(lineItems) && lineItems.length) {
      await tx.invoiceLineItem.deleteMany({ where: { invoiceId } });
      let sum = 0n;
      let travel = 0n;
      let discount = 0n;
      let tax = 0n;
      const creates = lineItems.map((li, i) => {
        const qty = toPaise(li.quantity != null ? li.quantity : 1) / 100n || 1n;
        // quantity as decimal: use Number for qty, paise for unit
        const q = Number(li.quantity != null ? li.quantity : 1) || 1;
        const unit = toPaise(li.unitAmount || 0);
        const line = BigInt(Math.round(Number(unit) * q));
        // Better: unit is paise for one unit; line = unit * q
        const unitPaise = toPaise(li.unitAmount || 0);
        const linePaise = BigInt(Math.round(Number(unitPaise) * q));
        const kind = String(li.kind || 'CUSTOM').toUpperCase();
        if (kind === 'TRAVEL') travel += linePaise;
        if (kind === 'DISCOUNT') discount += linePaise > 0n ? linePaise : -linePaise;
        if (kind === 'TAX') tax += linePaise;
        // DISCOUNT lines should reduce total — use signed unitAmount
        sum += kind === 'DISCOUNT' && linePaise > 0n ? -linePaise : linePaise;
        return {
          invoiceId,
          sortOrder: i,
          kind,
          description: String(li.description || kind).slice(0, 200),
          quantity: q,
          unitAmount: fromPaise(unitPaise),
          lineTotal: fromPaise(kind === 'DISCOUNT' && linePaise > 0n ? -linePaise : linePaise),
          hsnCode: li.hsnCode || null,
        };
      });
      // Recalculate sum from creates
      sum = 0n;
      for (const c of creates) sum += toPaise(c.lineTotal);
      if (sum < 0n) sum = 0n;
      await tx.invoiceLineItem.createMany({ data: creates });
      newTotal = fromPaise(sum);
      data.totalAmount = fromPaiseDecimalString(sum);
      data.travelAmount = fromPaise(travel);
      data.discountAmount = fromPaise(discount);
      data.taxAmount = fromPaise(tax);
    } else if (body?.totalAmount != null) {
      newTotal = Number(body.totalAmount);
      data.totalAmount = newTotal;
    }

    const mode = String(milestonesMode || 'KEEP').toUpperCase();
    if (mode === 'CLEAR') {
      await tx.invoiceInstallment.deleteMany({ where: { invoiceId } });
    } else if (mode === 'REPLACE' && Array.isArray(milestones)) {
      await tx.invoiceInstallment.deleteMany({ where: { invoiceId } });
      if (milestones.length) {
        await tx.invoiceInstallment.createMany({
          data: milestones.map((m, i) => ({
            invoiceId,
            sortOrder: i,
            label: String(m.label || `Installment ${i + 1}`).slice(0, 120),
            amount: Number(m.plannedAmount ?? m.amount ?? 0),
            dueDate: m.dueDate ? new Date(m.dueDate) : null,
            terms: m.terms || null,
            notes: m.notes || null,
            status: 'PENDING',
            percentage: null,
          })),
        });
      }
    } else if (mode === 'RESCALE' && full.installments?.length) {
      const oldTotal = toPaise(full.totalAmount);
      const newTotalP = toPaise(newTotal);
      if (oldTotal > 0n) {
        let allocated = 0n;
        const sorted = full.installments.slice().sort((a, b) => a.sortOrder - b.sortOrder);
        for (let i = 0; i < sorted.length; i++) {
          let next;
          if (i === sorted.length - 1) {
            next = newTotalP - allocated;
          } else {
            next = (toPaise(sorted[i].amount) * newTotalP) / oldTotal;
            allocated += next;
          }
          if (next < 0n) next = 0n;
          await tx.invoiceInstallment.update({
            where: { id: sorted[i].id },
            data: { amount: fromPaise(next) },
          });
        }
      }
    }

    // Recompute status from ledger vs new total
    const payments = await tx.invoicePayment.findMany({
      where: { invoiceId, voidedAt: null },
    });
    const money = computeMoney(data.totalAmount != null ? data.totalAmount : full.totalAmount, payments);
    data.status = deriveStatus(full, money);
    data.amountPaid = fromPaiseDecimalString(money.displayCashPaid);
    data.cachedOutstanding = fromPaiseDecimalString(money.outstandingPaise);

    await tx.invoice.update({ where: { id: invoiceId }, data });

    if (dualWriteLegacyInstallments()) {
      const installments = await tx.invoiceInstallment.findMany({
        where: { invoiceId },
        orderBy: { sortOrder: 'asc' },
      });
      await writeLegacyInstallmentMirrors(tx, invoiceId, money, installments);
    }

    await recomputeCustomerRollup(tx, inv.customerId);

    return { invoiceId, money, status: data.status };
  });
}

module.exports = { reviseInvoice };
