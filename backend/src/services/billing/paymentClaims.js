const { prisma } = require('../../config/prisma');
const { recordPayment, BillingError, assertManagerPlus } = require('./paymentService');
const { toPaise } = require('./money');
async function reportPayment({ studioId, customerId, invoiceId, amount, reference }) {
  const ref = String(reference || '').trim();
  if (ref.length < 6 || ref.length > 120) throw new BillingError('Enter the payment reference / UTR from your payment app');
  if (toPaise(amount) <= 0n) throw new BillingError('Enter the amount you paid');
  const inv = await prisma.invoice.findFirst({ where: { id: invoiceId, studioId, customerId, status: { notIn: ['DRAFT', 'VOID'] }, kind: 'INVOICE' } });
  if (!inv) throw new BillingError('Invoice not found', { status: 404 });
  const existing = await prisma.paymentClaim.findUnique({ where: { studioId_reference: { studioId, reference: ref } } });
  if (existing) {
    if (existing.customerId !== customerId || existing.invoiceId !== invoiceId || toPaise(existing.amount) !== toPaise(amount)) throw new BillingError('That payment reference has already been reported', { status: 409 });
    return existing;
  }
  try { return await prisma.paymentClaim.create({ data: { studioId, customerId, invoiceId, amount, reference: ref } }); }
  catch (e) { if (e.code === 'P2002') return reportPayment({ studioId, customerId, invoiceId, amount, reference: ref }); throw e; }
}
async function reviewPayment({ studioId, claimId, admin, approve, note }) {
  assertManagerPlus(admin);
  return prisma.$transaction(async (db) => {
    await db.$queryRaw`SELECT id FROM "PaymentClaim" WHERE id = ${claimId} AND "studioId" = ${studioId} FOR UPDATE`;
    const claim = await db.paymentClaim.findFirst({ where: { id: claimId, studioId } });
    if (!claim) throw new BillingError('Payment report not found', { status: 404 });
    if (claim.status !== 'PENDING') return claim;
    if (!approve && !String(note || '').trim()) throw new BillingError('Explain why the payment could not be verified');
    let paymentId = null;
    if (approve) {
      const result = await recordPayment({ studioId, invoiceId: claim.invoiceId, admin, db, body: {
        amount: claim.amount, reference: claim.reference, method: 'UPI', idempotencyKey: `claim:${claim.id}`, note: 'Studio verified customer payment report',
      } });
      paymentId = result.payment.id;
    }
    return db.paymentClaim.update({ where: { id: claim.id }, data: { status: approve ? 'CONFIRMED' : 'REJECTED', paymentId,
      reviewedAt: new Date(), reviewedById: admin.id, note: String(note || '').slice(0, 500) || null } });
  });
}
module.exports = { reportPayment, reviewPayment };
