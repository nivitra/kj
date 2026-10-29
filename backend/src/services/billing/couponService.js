const { prisma } = require('../../config/prisma');
const { toPaise, fromPaise, computeMoney, deriveStatus } = require('./money');
const { recomputeCustomerRollup } = require('./customerRollup');
const { invoiceInclude } = require('./projectInvoice');
const { BillingError } = require('./paymentService');

async function validateCoupon({ studioId, code, packageId, orderAmount, customerId, invoiceId }, db = prisma) {
  const normalized = String(code || '').trim().toUpperCase();
  const coupon = await db.coupon.findFirst({ where: { studioId, code: normalized } });
  if (!coupon?.active) throw new BillingError('Invalid or inactive coupon');
  const now = new Date();
  if (coupon.startsAt && coupon.startsAt > now) throw new BillingError('This coupon is not active yet');
  if (coupon.expiresAt && coupon.expiresAt < now) throw new BillingError('This coupon has expired');
  if (coupon.maxRedemptions != null && coupon.redemptionCount >= coupon.maxRedemptions) throw new BillingError('This coupon has reached its usage limit');
  const ids = Array.isArray(coupon.packageIds) ? coupon.packageIds : [];
  if (ids.length && !ids.includes(packageId)) throw new BillingError('This coupon does not apply to this package');
  const base = toPaise(orderAmount);
  if (base < 0n) throw new BillingError('Invalid order amount');
  if (base < toPaise(coupon.minOrderAmount)) throw new BillingError(`Minimum eligible amount is ₹${coupon.minOrderAmount}`);
  if (customerId) {
    const used = await db.couponRedemption.findFirst({ where: { couponId: coupon.id, customerId, ...(invoiceId ? { NOT: { invoiceId } } : {}) } });
    if (used) throw new BillingError('You have already used this coupon');
  }
  const value = toPaise(coupon.discountValue);
  if (value < 0n || (coupon.discountType === 'PERCENT' && value > 10000n)) throw new BillingError('Coupon discount is not configured correctly');
  const raw = coupon.discountType === 'FIXED' ? value : (base * value + 5000n) / 10000n;
  const discount = raw > base ? base : raw;
  return { coupon, discountAmount: fromPaise(discount), finalAmount: fromPaise(base - discount) };
}

async function redeemCoupon(db, inv) {
  if (!inv.couponCode) return;
  await db.$queryRaw`SELECT id FROM "Coupon" WHERE "studioId" = ${inv.studioId} AND code = ${inv.couponCode} FOR UPDATE`;
  const existing = await db.couponRedemption.findUnique({ where: { invoiceId: inv.id } });
  if (existing) return;
  const result = await validateCoupon({ studioId: inv.studioId, code: inv.couponCode, packageId: inv.packageId,
    orderAmount: Number(inv.totalAmount) + Number(inv.discountAmount) - Number(inv.taxAmount || 0) - Number(inv.travelAmount || 0), customerId: inv.customerId, invoiceId: inv.id }, db);
  if (toPaise(result.discountAmount) !== toPaise(inv.discountAmount)) throw new BillingError('Coupon terms changed. Update this draft before issuing it.');
  await db.couponRedemption.create({ data: { invoiceId: inv.id, studioId: inv.studioId, customerId: inv.customerId,
    couponId: result.coupon.id, packageId: inv.packageId, amountSaved: inv.discountAmount, note: `Invoice ${inv.invoiceNumber}` } });
  await db.coupon.update({ where: { id: result.coupon.id }, data: { redemptionCount: { increment: 1 } } });
}

async function applyInvoiceCoupon({ studioId, customerId, invoiceId, code }) {
  return prisma.$transaction(async (db) => {
    await db.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${invoiceId} AND "studioId" = ${studioId} AND "customerId" = ${customerId} FOR UPDATE`;
    const inv = await db.invoice.findFirst({ where: { id: invoiceId, studioId, customerId }, include: invoiceInclude });
    if (!inv || inv.kind !== 'INVOICE' || ['VOID', 'DRAFT'].includes(inv.status)) throw new BillingError('Invoice is not available');
    const normalized = String(code || '').trim().toUpperCase();
    if (inv.couponCode === normalized) return inv;
    if (inv.couponCode) throw new BillingError('A coupon is already applied');
    if (inv.payments.length || toPaise(inv.amountPaid) > 0n) throw new BillingError('Ask the studio to revise this invoice because payment has already been recorded');
    await db.$queryRaw`SELECT id FROM "Coupon" WHERE "studioId" = ${studioId} AND code = ${normalized} FOR UPDATE`;
    const base = Number(inv.totalAmount) - Number(inv.taxAmount) - Number(inv.travelAmount);
    const result = await validateCoupon({ studioId, customerId, code: normalized, packageId: inv.packageId, orderAmount: base }, db);
    const taxBase = toPaise(inv.totalAmount) - toPaise(inv.taxAmount);
    const discount = toPaise(result.discountAmount);
    const tax = taxBase > 0n ? (toPaise(inv.taxAmount) * (taxBase - discount) + taxBase / 2n) / taxBase : 0n;
    const total = taxBase - discount + tax;
    const prior = await db.invoiceRevision.aggregate({ where: { invoiceId }, _max: { revision: true } });
    await db.invoiceRevision.create({ data: { invoiceId, revision: (prior._max.revision || 0) + 1,
      reason: `Coupon ${normalized} applied before payment`, snapshot: JSON.parse(JSON.stringify(inv)) } });
    let allocated = 0n;
    for (const [i, row] of inv.installments.entries()) {
      const sum = inv.installments.reduce((n, x) => n + toPaise(x.amount), 0n);
      const amount = i === inv.installments.length - 1 ? total - allocated : sum > 0n ? total * toPaise(row.amount) / sum : 0n;
      allocated += amount;
      await db.invoiceInstallment.update({ where: { id: row.id }, data: { amount: fromPaise(amount) } });
    }
    await db.invoiceLineItem.create({ data: { invoiceId, sortOrder: inv.lineItems.length, kind: 'DISCOUNT', description: `Coupon ${normalized}`, quantity: 1, unitAmount: -result.discountAmount, lineTotal: -result.discountAmount } });
    if (toPaise(inv.taxAmount) !== tax) {
      await db.invoiceLineItem.deleteMany({ where: { invoiceId, kind: 'TAX' } });
      if (tax > 0n) await db.invoiceLineItem.create({ data: { invoiceId, sortOrder: inv.lineItems.length + 1, kind: 'TAX', description: inv.taxLabel || 'Tax', quantity: 1, unitAmount: fromPaise(tax), lineTotal: fromPaise(tax) } });
    }
    const updated = await db.invoice.update({ where: { id: invoiceId }, data: { couponCode: normalized, discountAmount: result.discountAmount,
      taxAmount: fromPaise(tax), totalAmount: fromPaise(total), cachedOutstanding: fromPaise(total), status: deriveStatus(inv, computeMoney(fromPaise(total), [])) }, include: invoiceInclude });
    await db.couponRedemption.create({ data: { invoiceId, studioId, customerId, couponId: result.coupon.id, packageId: inv.packageId, amountSaved: result.discountAmount, orderAmount: base } });
    await db.coupon.update({ where: { id: result.coupon.id }, data: { redemptionCount: { increment: 1 } } });
    await recomputeCustomerRollup(db, customerId);
    return updated;
  });
}
module.exports = { validateCoupon, redeemCoupon, applyInvoiceCoupon };
