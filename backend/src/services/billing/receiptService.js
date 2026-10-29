/**
 * Receipt documents — 1:1 with PAYMENT ledger rows (not invoice children).
 */
const { prisma } = require('../../config/prisma');

async function nextReceiptNumber(tx, studioId) {
  const year = new Date().getFullYear();
  const prefix = `RCT-${year}-`;
  // Advisory lock per studio+year to serialize numbers
  const lockKey = Number.parseInt(
    String(studioId).replace(/\D/g, '').slice(0, 9) || '1',
    10,
  ) % 2147483647;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey})`;

  const last = await tx.receipt.findFirst({
    where: { studioId, receiptNumber: { startsWith: prefix } },
    orderBy: { receiptNumber: 'desc' },
    select: { receiptNumber: true },
  });
  let seq = 1;
  if (last?.receiptNumber) {
    const n = parseInt(last.receiptNumber.slice(prefix.length), 10);
    if (Number.isFinite(n)) seq = n + 1;
  }
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

/**
 * Create receipt inside an open transaction.
 */
async function createReceiptInTx(tx, studioId, invoiceId, paymentId) {
  const existing = await tx.receipt.findFirst({
    where: { paymentId, studioId },
  });
  if (existing) return existing;

  const receiptNumber = await nextReceiptNumber(tx, studioId);
  return tx.receipt.create({
    data: {
      studioId,
      invoiceId,
      paymentId,
      receiptNumber,
      status: 'ACTIVE',
    },
  });
}

async function getReceipt(studioId, receiptId) {
  return prisma.receipt.findFirst({
    where: { id: receiptId, studioId },
    include: {
      invoice: {
        include: {
          customer: { select: { id: true, name: true, email: true, phone: true } },
        },
      },
      payment: true,
    },
  });
}

module.exports = {
  nextReceiptNumber,
  createReceiptInTx,
  getReceipt,
};
