const { test } = require('node:test');
const assert = require('node:assert/strict');
const { projectInvoice } = require('../src/services/billing/projectInvoice');
const { accountSummary } = require('../src/services/billing/accountSummary');
const base = { kind: 'INVOICE', status: 'SENT', finalizedAt: new Date(), totalAmount: '60000', amountPaid: '0' };
test('ledger, refund and reversal determine status and balance regardless of stale caches', () => {
  const inv = projectInvoice({ ...base, status: 'PAID', amountPaid: 60000, payments: [
    { kind: 'PAYMENT', amount: 20000 }, { kind: 'PAYMENT', amount: 15000 }, { kind: 'REFUND', amount: 5000 },
    { kind: 'PAYMENT', amount: 30000, voidedAt: new Date() },
  ] });
  assert.equal(inv.balance, 30000); assert.equal(inv.cashPaid, 30000);
  assert.equal(inv.status, 'PARTIALLY_PAID'); assert.equal(inv.canPay, true);
});
test('legacy paid amount is preserved only before a ledger exists', () => {
  assert.equal(projectInvoice({ ...base, amountPaid: 10000 }).balance, 50000);
  assert.equal(projectInvoice({ ...base, amountPaid: 10000, payments: [{ amount: 10000, voidedAt: new Date() }] }).balance, 60000);
});
test('credit does not silently settle another invoice; one paise remains payable', () => {
  const summary = accountSummary([
    projectInvoice({ ...base, totalAmount: 10, amountPaid: 20 }),
    projectInvoice({ ...base, totalAmount: '0.01' }),
    projectInvoice({ ...base, status: 'DRAFT' }),
    projectInvoice({ ...base, status: 'VOID' }),
    projectInvoice({ ...base, kind: 'RECEIPT' }),
  ]);
  assert.equal(summary.balance, 0.01); assert.equal(summary.credit, 10);
  assert.equal(summary.openCount, 1); assert.equal(summary.billed, 10.01);
});
test('all invoices count in an account, not only the last twenty', () => {
  const invoices = Array.from({ length: 25 }, () => projectInvoice({ ...base, totalAmount: '10.01' }));
  assert.equal(accountSummary(invoices).balance, 250.25);
});
test('service subtotal, tax, travel and discount reconcile to total', () => {
  const inv = projectInvoice({ ...base, totalAmount: 1180, travelAmount: 100, taxAmount: 180, discountAmount: 100 });
  assert.equal(inv.serviceAmount, 1000);
  assert.equal(inv.serviceAmount + inv.travelAmount + inv.taxAmount - inv.discountAmount, inv.totalAmount);
});
test('cancelled invoices cannot be paid and settled credits allocate milestones consistently', () => {
  assert.equal(projectInvoice({ ...base, status: 'VOID' }).canPay, false);
  const inv = projectInvoice({ ...base, totalAmount: 100, payments: [{ amount: 80 }, { kind: 'WRITE_OFF', amount: 20 }], installments: [{ id: '1', amount: 100, sortOrder: 0 }] });
  assert.equal(inv.status, 'PAID'); assert.equal(inv.progress, 1); assert.equal(inv.installments[0].remaining, 0);
});
