const { prisma } = require('../../config/prisma');
const { BillingError, assertManagerPlus } = require('./paymentService');
const { createSentInvoice } = require('./issueAndNotify');
const { recomputeCustomerRollup } = require('./customerRollup');
const { jobsFromBooking, isPlaceholderJobList } = require('../bookingJobs');

async function acceptQuote({ studioId, quoteId, customerId, optionId, actor, note, updatedAt }) {
  return prisma.$transaction(async (db) => {
    await db.$queryRaw`SELECT id FROM "Quote" WHERE id = ${quoteId} AND "studioId" = ${studioId} FOR UPDATE`;
    const q = await db.quote.findFirst({ where: { id: quoteId, studioId, ...(customerId ? { customerId } : {}) } });
    if (!q) throw new BillingError('Quotation not found', { status: 404 });
    const snap = q.pricingSnapshot || {};
    if (['APPROVED', 'CONVERTED'].includes(q.status)) {
      if (optionId && optionId !== snap.selectedOptionId) throw new BillingError('A different option was already accepted', { status: 409 });
      return q;
    }
    if (q.status !== 'SENT') throw new BillingError('Only a sent quotation can be accepted');
    if (updatedAt && new Date(updatedAt).getTime() !== q.updatedAt.getTime()) throw new BillingError('Quotation changed. Refresh and review the latest prices before accepting.', { status: 409 });
    const alternatives = snap.alternatives || [];
    const picked = alternatives.find((a) => a.optionId === optionId) || (!optionId && alternatives.length === 1 ? alternatives[0] : null);
    if (!picked) throw new BillingError('Choose the package you want to accept');
    return db.quote.update({ where: { id: q.id }, data: {
      status: 'APPROVED', pricingSnapshot: { ...snap, ...picked, selectedOptionId: picked.optionId },
      formData: { ...q.formData, acceptedAt: new Date().toISOString(), acceptedBy: actor, acceptanceNote: String(note || '').slice(0, 500), selectedOptionId: picked.optionId },
    } });
  });
}

async function convertQuote({ studioId, quoteId, admin }) {
  assertManagerPlus(admin);
  return prisma.$transaction(async (db) => {
    await db.$queryRaw`SELECT id FROM "Quote" WHERE id = ${quoteId} AND "studioId" = ${studioId} FOR UPDATE`;
    const q = await db.quote.findFirst({ where: { id: quoteId, studioId } });
    if (!q) throw new BillingError('Quotation not found', { status: 404 });
    if (q.status === 'CONVERTED') return { quote: q, agreementId: q.agreementId, invoiceId: q.formData?.invoiceId, replayed: true };
    if (q.status !== 'APPROVED') throw new BillingError('Record the client’s package acceptance before creating the booking and invoice');
    const snap = q.pricingSnapshot || {};
    const option = (snap.options || []).find((o) => o.id === snap.selectedOptionId);
    if (!option) throw new BillingError('Accepted package is missing from the quotation');
    const lines = (snap.lines || []).map((l) => ({ kind: l.kind === 'OPTION' ? 'PACKAGE' : 'ADDON', description: l.title, quantity: 1, unitAmount: l.amount, lineTotal: l.amount }));
    if (snap.tax > 0) lines.push({ kind: 'TAX', description: `Tax (${snap.taxPercent}%)`, quantity: 1, unitAmount: snap.tax, lineTotal: snap.tax });
    const invoice = await createSentInvoice({ studioId, customerId: q.customerId, createdById: admin.id, packageId: option.servicePackageId || null,
      title: q.title, lines, fiftyFifty: true, terms: q.formData?.terms, notes: `Accepted quotation ${q.id}` }, db);
    await db.invoice.update({ where: { id: invoice.id }, data: { packageSnapshot: option } });
    const agreement = await db.weddingAgreement.create({ data: { studioId, customerId: q.customerId, title: q.title, status: 'DRAFT', formData: {
      clientName: q.clientName, eventDate: q.eventDate, primaryVenue: q.venue, days: q.formData?.days || [],
      quoteId: q.id, invoiceId: invoice.id, totalFee: snap.total, packageName: option.title,
      pricingSnapshot: snap, paymentTermsText: q.formData?.terms || null,
    } } });
    await db.$queryRaw`SELECT id FROM "Customer" WHERE id = ${q.customerId} FOR UPDATE`;
    const booking = await db.customerBooking.findUnique({ where: { customerId: q.customerId }, include: { servicePackage: true } });
    const savedJobs = jobsFromBooking(booking);
    const jobs = isPlaceholderJobList(booking, savedJobs) ? [] : savedJobs;
    const createdAt = new Date().toISOString();
    const job = { id: q.id, quoteId: q.id, leadId: q.leadId, packageId: option.servicePackageId || null, packageTitle: option.title,
      requestedDate: q.eventDate?.toISOString() || null, venue: q.venue, eventType: q.eventType, days: q.formData?.days || [],
      slotStatus: q.eventDate ? 'REQUESTED' : 'NONE',
      history: [{ status: 'AWAITING_ADVANCE', label: 'Awaiting advance', at: createdAt, by: admin.id }],
      pricingSnapshot: option, invoiceId: invoice.id, agreementId: agreement.id, status: 'AWAITING_ADVANCE', source: 'QUOTATION', createdAt };
    await db.customerBooking.upsert({ where: { customerId: q.customerId }, create: { studioId, customerId: q.customerId, servicePackageId: option.servicePackageId, status: 'AWAITING_ADVANCE', jobs: [job] },
      update: { jobs: [...jobs.filter((j) => j.id !== q.id), job] } });
    if (q.leadId) await db.lead.updateMany({
      where: { id: q.leadId, studioId, customerId: q.customerId, inquiryStatus: { not: 'BOOKED' } },
      data: { inquiryStatus: 'APPROVED', status: 'WON', decidedAt: new Date() },
    });
    const quote = await db.quote.update({ where: { id: q.id }, data: { status: 'CONVERTED', agreementId: agreement.id, convertedAt: new Date(), formData: { ...q.formData, invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber } } });
    await recomputeCustomerRollup(db, q.customerId);
    return { quote, agreementId: agreement.id, invoiceId: invoice.id, replayed: false };
  });
}
module.exports = { acceptQuote, convertQuote };
