/**
 * Billing v2 feature flags.
 * After full rollout, BILLING_V2 defaults true; dual-write stays until PR14.
 */

function isBillingV2(studioId) {
  if (process.env.BILLING_V2 === 'false') return false;
  if (process.env.BILLING_V2 === 'true') return true;
  const list = (process.env.BILLING_V2_STUDIO_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (list.length) return list.includes(studioId);
  // Default ON — redesign is the production path
  return true;
}

/** Receipt rows enabled (PR5+). Set BILLING_RECEIPTS=false to disable. */
function receiptsEnabled() {
  return process.env.BILLING_RECEIPTS !== 'false';
}

/** Dual-write installment paidAmount/status cache until columns dropped. */
function dualWriteLegacyInstallments() {
  return process.env.BILLING_DUAL_WRITE !== 'false';
}

function allowHardDeletePayments() {
  return process.env.BILLING_ALLOW_HARD_DELETE === 'true';
}

module.exports = {
  isBillingV2,
  receiptsEnabled,
  dualWriteLegacyInstallments,
  allowHardDeletePayments,
};
