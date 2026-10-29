/**
 * Studio-default payment T&Cs for SJ Clicks and Films, Nanded · Studio by Warmkelvin.
 * Stored on StudioProfile.termsHtml when the studio edits them.
 */

const STUDIO_LEGAL_NAME = 'SJ Clicks and Films';
const STUDIO_CITY = 'Nanded, Maharashtra';
const STUDIO_LOCKUP = 'Studio by Warmkelvin';

const DEFAULT_PAYMENT_TERMS = [
  `${STUDIO_LEGAL_NAME}, ${STUDIO_CITY} · ${STUDIO_LOCKUP}`,
  '1. A booking is confirmed only after the agreed advance is received. Dates are held after that payment.',
  '2. Remaining balance is due as per the invoice plan, and in any case before final delivery unless the studio agrees otherwise in writing.',
  '3. Payments may be made in parts (UPI, cash, bank). Each amount is recorded on this invoice. Outstanding = total − amounts received.',
  '4. Extra photographs beyond the package inclusion are billed at the rates on this invoice (Raw or Edited). Submitting extras adds those lines automatically.',
  '5. Advance is generally non-refundable once the date is reserved. Reschedule is subject to availability and may carry a fee.',
  '6. Delivery of galleries, albums, and downloads follows the studio timeline after the relevant balance is cleared, unless otherwise agreed.',
  '7. The studio retains copyright. The client receives a personal-use licence for delivered files. Portfolio use is allowed unless the client opts out in writing.',
  '8. Force majeure (weather, venue rules, illness, government order) may require reasonable changes to coverage.',
  `9. These terms are governed in ${STUDIO_CITY}. Questions: contact ${STUDIO_LEGAL_NAME} / ${STUDIO_LOCKUP}.`,
].join('\n');

const DEFAULT_WELCOME = 'Welcome to SJ Studios.';

function stripHtml(s) {
  return String(s || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Plain text for PDFs and invoice.terms. */
function resolvePaymentTerms(profileOrHtml, invoiceTerms) {
  const fromInvoice = String(invoiceTerms || '').trim();
  if (fromInvoice) return fromInvoice;
  const fromProfile = typeof profileOrHtml === 'string'
    ? stripHtml(profileOrHtml)
    : stripHtml(profileOrHtml?.termsHtml);
  return fromProfile || DEFAULT_PAYMENT_TERMS;
}

module.exports = {
  STUDIO_LEGAL_NAME,
  STUDIO_CITY,
  STUDIO_LOCKUP,
  DEFAULT_PAYMENT_TERMS,
  DEFAULT_WELCOME,
  stripHtml,
  resolvePaymentTerms,
};
