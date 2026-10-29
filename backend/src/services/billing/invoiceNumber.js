const { prisma } = require('../../config/prisma');
async function nextInvoiceNumber(studioId, db = prisma) {
  const year = new Date().getFullYear();
  const prefix = `INV-${year}-`;
  const rows = await db.$queryRaw`
    INSERT INTO "BillingSequence" ("studioId", year, value)
    SELECT ${studioId}, ${year}, COALESCE(MAX(CASE WHEN "invoiceNumber" ~ ${'^INV-' + year + '-[0-9]+$'}
      THEN split_part("invoiceNumber", '-', 3)::integer ELSE 0 END), 0) + 1
    FROM "Invoice" WHERE "studioId" = ${studioId}
    ON CONFLICT ("studioId", year) DO UPDATE SET value = "BillingSequence".value + 1
    RETURNING value
  `;
  return `${prefix}${String(rows[0].value).padStart(4, '0')}`;
}
module.exports = { nextInvoiceNumber };
