/**
 * Dual-write legacy installment paidAmount/status from FIFO (cache only).
 */
const { allocateFifo } = require('./allocate');
const { fromPaiseDecimalString, toPaise } = require('./money');

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} invoiceId
 * @param {{ totalPaise: bigint, netAppliedPaise: bigint, cashPaidPaise: bigint }} money
 * @param {Array} installments
 */
async function writeLegacyInstallmentMirrors(tx, invoiceId, money, installments) {
  if (!installments?.length) return;

  const plan = allocateFifo(
    installments,
    money.netAppliedPaise,
    money.totalPaise != null ? fromPaiseDecimalString(money.totalPaise) : money.total,
    { applyIsPaise: true },
  );

  // Fix allocateFifo when total passed as paise string wrong — pass total rupees
  // Re-run with proper total from first installment's invoice if needed
  const totalRupees = money.total != null
    ? money.total
    : Number(money.totalPaise) / 100;

  const plan2 = allocateFifo(
    installments,
    money.netAppliedPaise,
    totalRupees,
    { applyIsPaise: true },
  );

  for (const m of plan2.milestones) {
    if (!m.id) continue;
    const paidAt = m.state === 'COVERED' ? new Date() : null;
    await tx.invoiceInstallment.update({
      where: { id: m.id },
      data: {
        paidAmount: m.allocatedAmount,
        status: m.status,
        paidAt: m.state === 'COVERED' ? paidAt : null,
      },
    });
  }
}

module.exports = { writeLegacyInstallmentMirrors };
