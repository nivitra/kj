/**
 * FIFO milestone allocation — pure function of plan + apply amount.
 * Installments are display/reminder only; cash SoT is the payment ledger.
 */
const { toPaise, fromPaise } = require('./money');

/**
 * @param {Array<{ id?: string, sortOrder?: number, label?: string, amount: unknown, dueDate?: unknown }>} milestones
 * @param {bigint|number|string} applyAmount  rupees or paise bigint
 * @param {unknown} totalAmount invoice total
 * @param {{ applyIsPaise?: boolean }} [opts]
 */
function allocateFifo(milestones, applyAmount, totalAmount, opts = {}) {
  const totalPaise = toPaise(totalAmount);
  let remaining = typeof applyAmount === 'bigint'
    ? applyAmount
    : (opts.applyIsPaise ? BigInt(applyAmount || 0) : toPaise(applyAmount));

  if (remaining < 0n) remaining = 0n;

  const sorted = (milestones || [])
    .slice()
    .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));

  let plannedSum = 0n;
  const result = [];

  for (const m of sorted) {
    const planned = toPaise(m.amount);
    plannedSum += planned;
    const applied = planned < remaining ? planned : (remaining > 0n ? remaining : 0n);
    // Actually: min(planned, remaining)
    const alloc = applied > planned ? planned : applied;
    remaining -= alloc;

    let state = 'PENDING';
    if (alloc <= 0n) state = 'PENDING';
    else if (alloc < planned) state = 'PARTIAL';
    else state = 'COVERED';

    result.push({
      id: m.id || null,
      sortOrder: m.sortOrder ?? result.length,
      label: m.label || `Installment ${result.length + 1}`,
      plannedAmount: fromPaise(planned),
      allocatedAmount: fromPaise(alloc),
      remainingAmount: fromPaise(planned - alloc > 0n ? planned - alloc : 0n),
      state,
      progress: planned > 0n ? Number(alloc) / Number(planned) : 0,
      dueDate: m.dueDate || null,
      terms: m.terms || null,
      notes: m.notes || null,
      // Legacy mirrors for dual-write / old clients
      amount: fromPaise(planned),
      paidAmount: fromPaise(alloc),
      status: state === 'COVERED' ? 'PAID' : (state === 'PARTIAL' ? 'PARTIAL' : 'PENDING'),
      paidAt: state === 'COVERED' ? (m.paidAt || null) : null,
    });
  }

  const unscheduledPlanned = totalPaise - plannedSum > 0n ? totalPaise - plannedSum : 0n;
  const unscheduledApplied = unscheduledPlanned < remaining ? unscheduledPlanned : remaining;
  remaining -= unscheduledApplied;

  const nextDue = result.find((m) => m.remainingAmount > 0.001) || null;

  return {
    milestones: result,
    unscheduled: {
      plannedAmount: fromPaise(unscheduledPlanned),
      allocatedAmount: fromPaise(unscheduledApplied),
    },
    leftoverApplyPaise: remaining,
    leftoverApply: fromPaise(remaining),
    nextDue: nextDue
      ? {
          id: nextDue.id,
          label: nextDue.label,
          dueDate: nextDue.dueDate,
          remainingAmount: nextDue.remainingAmount,
        }
      : (unscheduledPlanned - unscheduledApplied > 0n
        ? {
            id: null,
            label: 'Balance',
            dueDate: null,
            remainingAmount: fromPaise(unscheduledPlanned - unscheduledApplied),
          }
        : null),
  };
}

module.exports = { allocateFifo };
