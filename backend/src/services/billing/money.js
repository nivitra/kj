/**
 * Money helpers — integer paise (1/100 INR) for exact arithmetic.
 * Never use Number(prismaDecimal) * 100 for authorization math.
 */

function decimalToFixedString(value, places = 2) {
  if (value == null || value === '') return '0.00';
  let raw = String(value).trim();
  if (/e/i.test(raw)) {
    const n = Number(raw);
    if (!Number.isFinite(n) || Math.abs(n) >= 1e12) throw new Error('Invalid monetary amount');
    raw = n.toFixed(places + 4);
  }
  const match = raw.match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!match || Number(raw) >= 1e12 || Number(raw) <= -1e12) throw new Error('Invalid monetary amount');
  const [, sign, whole, fraction = ''] = match;
  const digits = fraction.padEnd(places + 1, '0');
  let scaled = BigInt(whole) * (10n ** BigInt(places)) + BigInt(digits.slice(0, places) || '0');
  if (Number(digits[places]) >= 5) scaled += 1n;
  const text = scaled.toString().padStart(places + 1, '0');
  return `${sign && scaled !== 0n ? '-' : ''}${text.slice(0, -places)}.${text.slice(-places)}`;
}

/** @returns {bigint} paise */
function toPaise(value) {
  const s = decimalToFixedString(value, 2);
  const neg = s.startsWith('-');
  const body = neg ? s.slice(1) : s;
  const [w, f = '00'] = body.split('.');
  const paise = BigInt(w || '0') * 100n + BigInt((f || '00').padEnd(2, '0').slice(0, 2));
  return neg ? -paise : paise;
}

/** @returns {number} rupees for JSON APIs */
function fromPaise(paise) {
  const p = typeof paise === 'bigint' ? paise : BigInt(paise || 0);
  // Safe for studio-scale amounts (well under Number.MAX_SAFE_INTEGER paise)
  return Number(p) / 100;
}

/** @returns {string} "123.45" for Prisma Decimal writes */
function fromPaiseDecimalString(paise) {
  const p = typeof paise === 'bigint' ? paise : BigInt(paise || 0);
  const sign = p < 0n ? '-' : '';
  const a = p < 0n ? -p : p;
  const w = a / 100n;
  const f = a % 100n;
  return `${sign}${w}.${f.toString().padStart(2, '0')}`;
}

/**
 * Compute money facts from invoice total + non-voided ledger rows.
 * @param {unknown} totalAmount
 * @param {Array<{ kind?: string, amount: unknown, voidedAt?: unknown }>} payments
 */
function computeMoney(totalAmount, payments = []) {
  const totalPaise = toPaise(totalAmount);
  let cashIn = 0n;
  let cashOut = 0n;
  let nonCash = 0n;

  for (const p of payments) {
    if (p.voidedAt) continue;
    const a = toPaise(p.amount);
    if (a <= 0n) continue;
    const k = String(p.kind || 'PAYMENT').toUpperCase();
    if (k === 'PAYMENT') cashIn += a;
    else if (k === 'REFUND') cashOut += a;
    else if (k === 'ROUND_OFF' || k === 'WRITE_OFF' || k === 'ADJUSTMENT') nonCash += a;
  }

  const cashPaidPaise = cashIn - cashOut;
  const nonCashPaise = nonCash;
  const netAppliedPaise = cashPaidPaise + nonCashPaise;
  const outstandingPaise = totalPaise - netAppliedPaise > 0n ? totalPaise - netAppliedPaise : 0n;
  const overpayPaise = netAppliedPaise - totalPaise > 0n ? netAppliedPaise - totalPaise : 0n;
  const displayCashPaid = cashPaidPaise > 0n ? cashPaidPaise : 0n;

  return {
    totalPaise,
    cashPaidPaise,
    nonCashPaise,
    netAppliedPaise,
    outstandingPaise,
    overpayPaise,
    displayCashPaid,
    total: fromPaise(totalPaise),
    cashPaid: fromPaise(displayCashPaid),
    nonCashCredit: fromPaise(nonCashPaise),
    netApplied: fromPaise(netAppliedPaise),
    outstanding: fromPaise(outstandingPaise),
    overpay: fromPaise(overpayPaise),
  };
}

/**
 * Derive invoice status from money + lifecycle.
 * DRAFT / VOID preserved. FINALIZED maps to SENT for API compat when sentAt set.
 */
function deriveStatus(inv, money) {
  const st = String(inv.status || '');
  if (st === 'DRAFT' || st === 'VOID') return st;
  if (money.outstandingPaise === 0n) {
    return 'PAID';
  }
  if (money.netAppliedPaise > 0n) return 'PARTIALLY_PAID';
  // Open, no payments yet
  if (inv.finalizedAt || inv.sentAt || st === 'FINALIZED' || st === 'SENT') {
    return inv.sentAt || inv.finalizedAt ? 'SENT' : 'FINALIZED';
  }
  return st || 'SENT';
}

/** Compat status for clients that only know SENT */
function publicStatus(status, inv) {
  if (status === 'FINALIZED') return inv?.sentAt ? 'SENT' : 'FINALIZED';
  return status;
}

module.exports = {
  decimalToFixedString,
  toPaise,
  fromPaise,
  fromPaiseDecimalString,
  computeMoney,
  deriveStatus,
  publicStatus,
};
