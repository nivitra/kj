const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  toPaise,
  fromPaise,
  fromPaiseDecimalString,
  computeMoney,
  deriveStatus,
} = require('../src/services/billing/money');
const { allocateFifo } = require('../src/services/billing/allocate');

describe('money.toPaise', () => {
  it('handles strings and numbers without float drift', () => {
    assert.equal(toPaise('125000.50'), 12500050n);
    assert.equal(toPaise(125000), 12500000n);
    assert.equal(toPaise('0.01'), 1n);
    assert.equal(fromPaise(12500050n), 125000.5);
    assert.equal(fromPaiseDecimalString(4300000n), '43000.00');
  });
});

describe('computeMoney', () => {
  it('computes outstanding from ledger', () => {
    const m = computeMoney(125000, [
      { kind: 'PAYMENT', amount: 40000 },
      { kind: 'PAYMENT', amount: 20000 },
      { kind: 'REFUND', amount: 5000 },
      { kind: 'WRITE_OFF', amount: 1000 },
    ]);
    assert.equal(m.cashPaid, 55000);
    assert.equal(m.nonCashCredit, 1000);
    assert.equal(m.netApplied, 56000);
    assert.equal(m.outstanding, 69000);
  });

  it('ignores voided payments', () => {
    const m = computeMoney(10000, [
      { kind: 'PAYMENT', amount: 10000, voidedAt: new Date() },
      { kind: 'PAYMENT', amount: 3000 },
    ]);
    assert.equal(m.cashPaid, 3000);
    assert.equal(m.outstanding, 7000);
  });
});

describe('allocateFifo Indian free-form', () => {
  const plan = [
    { id: '1', sortOrder: 0, label: 'M1', amount: 43000 },
    { id: '2', sortOrder: 1, label: 'M2', amount: 43000 },
    { id: '3', sortOrder: 2, label: 'M3', amount: 39000 },
  ];
  const total = 125000;

  it('40k → partial first milestone', () => {
    const r = allocateFifo(plan, 40000, total);
    assert.equal(r.milestones[0].allocatedAmount, 40000);
    assert.equal(r.milestones[0].state, 'PARTIAL');
    assert.equal(r.milestones[1].allocatedAmount, 0);
    assert.equal(r.nextDue.remainingAmount, 3000);
  });

  it('60k → M1 covered, M2 partial 17k', () => {
    const r = allocateFifo(plan, 60000, total);
    assert.equal(r.milestones[0].state, 'COVERED');
    assert.equal(r.milestones[0].allocatedAmount, 43000);
    assert.equal(r.milestones[1].allocatedAmount, 17000);
    assert.equal(r.milestones[1].state, 'PARTIAL');
  });

  it('full 125k clears plan', () => {
    const r = allocateFifo(plan, 125000, total);
    assert.ok(r.milestones.every((m) => m.state === 'COVERED'));
    assert.equal(r.nextDue, null);
  });

  it('partial plan leaves unscheduled bucket', () => {
    const r = allocateFifo(
      [{ id: 'a', sortOrder: 0, label: 'Advance', amount: 25000 }],
      30000,
      100000,
    );
    assert.equal(r.milestones[0].state, 'COVERED');
    assert.equal(r.unscheduled.plannedAmount, 75000);
    assert.equal(r.unscheduled.allocatedAmount, 5000);
  });

  it('refund lowers fill from the end (pure recompute)', () => {
    const afterPay = allocateFifo(plan, 100000, total);
    assert.equal(afterPay.milestones[2].allocatedAmount, 14000);
    const afterRefund = allocateFifo(plan, 85000, total);
    assert.equal(afterRefund.milestones[2].allocatedAmount, 0);
    assert.equal(afterRefund.milestones[1].allocatedAmount, 42000);
  });
});

describe('deriveStatus', () => {
  it('returns PAID when outstanding 0 and no write-offs', () => {
    const money = computeMoney(1000, [{ kind: 'PAYMENT', amount: 1000 }]);
    assert.equal(deriveStatus({ status: 'SENT', finalizedAt: new Date() }, money), 'PAID');
  });
  it('returns PAID when outstanding 0 even if a legacy write-off is on the ledger', () => {
    const money = computeMoney(7000, [{ kind: 'PAYMENT', amount: 5000 }, { kind: 'WRITE_OFF', amount: 2000 }]);
    assert.equal(deriveStatus({ status: 'SENT', finalizedAt: new Date() }, money), 'PAID');
  });
  it('preserves DRAFT', () => {
    const money = computeMoney(1000, []);
    assert.equal(deriveStatus({ status: 'DRAFT' }, money), 'DRAFT');
  });
});
