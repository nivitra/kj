/**
 * Push uploaded / finalized agreement PDFs to the client on WhatsApp
 * and keep a short note pointing them to the in-app Agreements screen.
 */
const { logger } = require('../utils/logger');
const { sendText, sendDocument, clientAppUrl, normalizePhone } = require('./whatsapp');

function safeFileName(title, fallback = 'agreement.pdf') {
  const base = String(title || fallback)
    .replace(/[^\w\s.-]+/g, '')
    .trim()
    .slice(0, 80) || 'agreement';
  return base.toLowerCase().endsWith('.pdf') ? base : `${base}.pdf`;
}

async function notifyCustomerAgreements({ studioId, customer, items }) {
  const list = Array.isArray(items) ? items.filter((i) => i && i.buffer) : [];
  if (!list.length) return { sent: 0, reason: 'no_files' };
  const phone = customer?.phone;
  if (!normalizePhone(phone)) return { sent: 0, reason: 'no_phone' };

  const appUrl = typeof clientAppUrl === 'function' ? (clientAppUrl() || '') : '';
  const n = list.length;
  const name = customer.name || 'there';
  const intro = n === 1
    ? `Hi ${name}, your studio sent an agreement PDF. It’s in your app under Agreements, and attached here.`
    : `Hi ${name}, your studio sent ${n} agreement PDFs. They’re in your app under Agreements, and attached here.`;
  const text = appUrl ? `${intro}\n${appUrl}` : intro;

  try {
    await sendText({
      studioId,
      phone,
      toName: customer.name,
      text,
      source: 'AUTO',
      skipTyping: true,
      skipDailyQuota: true,
      meta: { kind: 'AGREEMENT_SENT', count: n },
    });
  } catch (err) {
    logger.warn(`[agreements] whatsapp intro: ${err.message}`);
  }

  let sent = 0;
  for (const item of list) {
    try {
      await sendDocument({
        studioId,
        phone,
        toName: customer.name,
        buffer: item.buffer,
        fileName: safeFileName(item.fileName || item.title),
        mimetype: 'application/pdf',
        caption: item.title ? String(item.title).slice(0, 200) : 'Agreement',
        source: 'AUTO',
        meta: { kind: 'AGREEMENT_PDF', contractId: item.contractId || null },
      });
      sent += 1;
    } catch (err) {
      logger.warn(`[agreements] whatsapp pdf ${item.title}: ${err.message}`);
    }
  }
  return { sent, total: list.length };
}

module.exports = { notifyCustomerAgreements, safeFileName };
