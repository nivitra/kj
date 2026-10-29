/**
 * Invoice projection DTO — single shape for admin + customer.
 */
const { computeMoney, deriveStatus, publicStatus, toPaise, fromPaise } = require('./money');
const { allocateFifo } = require('./allocate');

function mapPayment(p) {
  return {
    id: p.id,
    invoiceId: p.invoiceId,
    installmentId: p.installmentId || null,
    kind: p.kind || 'PAYMENT',
    amount: Number(p.amount || 0),
    method: p.method || null,
    reference: p.reference || null,
    note: p.note || null,
    paidAt: p.paidAt,
    createdAt: p.createdAt,
    voidedAt: p.voidedAt || null,
    voidReason: p.voidReason || null,
    installmentLabel: p.installment?.label || null,
    isVoid: !!p.voidedAt,
  };
}

/**
 * @param {object} inv Prisma invoice with relations
 * @param {{ includeCustomer?: boolean, audience?: 'admin'|'customer' }} opts
 */
function projectInvoice(inv, { includeCustomer = false, audience = 'admin' } = {}) {
  if (!inv) return null;

  const paymentsAll = Array.isArray(inv.payments) ? inv.payments : [];
  // A legacy opening balance is used only when no ledger rows exist. Reversed
  // rows must never resurrect the cached paid total.
  const money = computeMoney(inv.totalAmount, paymentsAll.length ? paymentsAll :
    [{ kind: 'PAYMENT', amount: inv.amountPaid || 0 }]);
  const { cashPaid, outstanding, netApplied } = money;
  const nonCash = money.nonCashCredit;

  const total = Number(inv.totalAmount || 0);
  const travel = Number(inv.travelAmount || 0);
  const discount = Number(inv.discountAmount || 0);
  const tax = Number(inv.taxAmount || 0);
  const serviceAmount = Math.max(0, fromPaise(toPaise(total) - toPaise(travel) + toPaise(discount) - toPaise(tax)));

  const statusRaw = inv.status;
  const status = publicStatus(deriveStatus(inv, money), inv);

  // Both audiences allocate the same net settlement across the payment plan.
  const applyForPlan = toPaise(netApplied);

  const plan = allocateFifo(
    inv.installments || [],
    applyForPlan,
    total,
    { applyIsPaise: typeof applyForPlan === 'bigint' },
  );

  const progress = total > 0 ? Math.max(0, Math.min(1, netApplied / total)) : (status === 'PAID' ? 1 : 0);

  const lineItems = (inv.lineItems || []).map((li) => ({
    id: li.id,
    sortOrder: li.sortOrder,
    kind: li.kind,
    description: li.description,
    quantity: Number(li.quantity || 1),
    unitAmount: Number(li.unitAmount || 0),
    lineTotal: Number(li.lineTotal || 0),
    hsnCode: li.hsnCode || null,
  }));

  const receiptRows = inv.documentReceipts || inv.receipts || [];
  const receipts = receiptRows
    .filter((r) => r.status !== 'VOID')
    .map((r) => ({
      id: r.id,
      receiptNumber: r.receiptNumber,
      paymentId: r.paymentId,
      status: r.status,
      issuedAt: r.issuedAt,
    }));

  return {
    id: inv.id,
    invoiceNumber: inv.invoiceNumber,
    title: inv.title,
    status,
    statusRaw,
    kind: inv.kind || 'INVOICE',
    parentInvoiceId: inv.parentInvoiceId || null,
    currency: inv.currency || 'INR',
    totalAmount: total,
    serviceAmount,
    travelAmount: travel,
    amountPaid: cashPaid,
    cashPaid,
    adjusted: nonCash,
    balance: outstanding,
    canPay: !['DRAFT', 'VOID'].includes(status) && inv.kind !== 'RECEIPT' && outstanding > 0,
    discountAmount: discount,
    taxAmount: tax,
    taxLabel: inv.taxLabel || null,
    couponCode: inv.couponCode || null,
    notes: inv.notes,
    terms: inv.terms,
    sentAt: inv.sentAt,
    finalizedAt: inv.finalizedAt,
    dueDate: inv.dueDate || null,
    voidedAt: inv.voidedAt || null,
    voidReason: inv.voidReason || null,
    createdAt: inv.createdAt,
    updatedAt: inv.updatedAt,
    packageSnapshot: inv.packageSnapshot || null,
    package: inv.package
      ? { id: inv.package.id, title: inv.package.title, price: Number(inv.package.price || 0) }
      : null,
    packageId: inv.packageId,
    customerId: inv.customerId,
    customer: includeCustomer && inv.customer
      ? {
          id: inv.customer.id,
          name: inv.customer.name,
          email: inv.customer.email,
          phone: inv.customer.phone,
        }
      : undefined,
    totals: {
      subtotal: serviceAmount,
      travel,
      discount,
      tax,
      total,
      cashPaid,
      nonCashCredit: nonCash,
      netApplied,
      outstanding,
      overpay: money.overpay || 0,
    },
    progress,
    lineItems,
    plan: {
      milestones: plan.milestones,
      unscheduled: plan.unscheduled,
      nextDue: plan.nextDue,
    },
    // Legacy installments array (FIFO-enriched) for old UI
    installments: plan.milestones.map((m) => ({
      id: m.id,
      sortOrder: m.sortOrder,
      label: m.label,
      percentage: null,
      amount: m.plannedAmount,
      dueDate: m.dueDate,
      terms: m.terms,
      notes: m.notes,
      status: m.status,
      paidAt: m.paidAt,
      paidAmount: m.allocatedAmount,
      remaining: m.remainingAmount,
      allocatedAmount: m.allocatedAmount,
      remainingAmount: m.remainingAmount,
      state: m.state,
    })),
    payments: paymentsAll
      .slice()
      .sort((a, b) => new Date(b.paidAt || b.createdAt) - new Date(a.paidAt || a.createdAt))
      .map(mapPayment),
    receipts,
  };
}

const invoiceInclude = {
  customer: { select: { id: true, name: true, email: true, phone: true } },
  package: true,
  installments: { orderBy: { sortOrder: 'asc' } },
  payments: {
    orderBy: { paidAt: 'desc' },
    include: { installment: { select: { id: true, label: true } } },
  },
  lineItems: { orderBy: { sortOrder: 'asc' } },
  documentReceipts: true,
};

module.exports = {
  projectInvoice,
  mapPayment,
  invoiceInclude,
};
