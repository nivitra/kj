const { toPaise, fromPaise } = require('./money');

// Aggregate per-invoice balances: credit on one invoice is not automatically
// transferred to another. Drafts, cancellations and legacy receipts aren't bills.
function accountSummary(invoices = []) {
  const active = invoices.filter(i => i.kind !== 'RECEIPT' && !['DRAFT', 'VOID'].includes(i.status));
  const sum = field => fromPaise(active.reduce((n, i) => n + toPaise(i[field] || 0), 0n));
  return {
    billed: sum('totalAmount'), paid: sum('cashPaid'), adjusted: sum('adjusted'),
    balance: sum('balance'),
    credit: fromPaise(active.reduce((n, i) => n + toPaise(i.totals?.overpay || 0), 0n)),
    currency: active[0]?.currency || 'INR',
    openCount: active.filter(i => toPaise(i.balance) > 0n).length,
  };
}
module.exports = { accountSummary };
