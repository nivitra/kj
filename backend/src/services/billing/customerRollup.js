/**
 * Customer payment profile fields = SQL aggregate of open invoices (not single-invoice overwrite).
 */
const { prisma } = require('../../config/prisma');

/**
 * @param {import('@prisma/client').Prisma.TransactionClient | typeof prisma} db
 * @param {string} customerId
 */
async function recomputeCustomerRollup(db, customerId) {
  if (!customerId) return;
  const client = db || prisma;

  await client.$queryRaw`SELECT id FROM "Customer" WHERE id = ${customerId} FOR UPDATE`;

  // Sum cache columns on non-void, non-legacy-receipt invoices
  const rows = await client.$queryRaw`
    SELECT
      COALESCE(SUM("totalAmount"), 0) AS "totalDue",
      COALESCE(SUM("amountPaid"), 0) AS "amountPaid",
      MAX(currency) AS currency
    FROM "Invoice"
    WHERE "customerId" = ${customerId}
      AND status <> 'VOID'
      AND status <> 'DRAFT'
      AND (kind IS NULL OR kind = 'INVOICE')
  `;

  const row = rows?.[0] || {};
  await client.customer.update({
    where: { id: customerId },
    data: {
      paymentTotalDue: row.totalDue ?? 0,
      paymentAmountPaid: row.amountPaid ?? 0,
      paymentCurrency: row.currency || 'INR',
    },
  });
}

module.exports = { recomputeCustomerRollup };
