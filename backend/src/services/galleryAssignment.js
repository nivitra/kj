const { AppError, CODES } = require('../lib/errors');
const { galleryAvailability } = require('./galleryAccess');

// One transaction for both assignment surfaces: validate the entire request,
// publish when explicitly requested, and create/renew grants before notifying.
async function assignGalleries(db, { studioId, customerIds, galleryIds, expiresAt, publish = false }) {
  const clients = [...new Set(customerIds || [])];
  const galleries = [...new Set(galleryIds || [])];
  if (!clients.length || !galleries.length) throw new AppError(CODES.VALIDATION, 'Choose clients and galleries.');
  const expiry = expiresAt ? new Date(expiresAt) : null;
  if (expiry && (!Number.isFinite(expiry.getTime()) || expiry <= new Date())) {
    throw new AppError(CODES.VALIDATION, 'Access expiry must be a date in the future.');
  }
  return db.$transaction(async tx => {
    const customers = await tx.customer.findMany({ where: { id: { in: clients }, studioId, isGuest: false, accountStatus: { not: 'DISABLED' } }, select: { id: true, name: true, phone: true, isGuest: true } });
    const rows = await tx.eventGallery.findMany({ where: { id: { in: galleries }, studioId, deletedAt: null } });
    if (customers.length !== clients.length || rows.length !== galleries.length) {
      throw new AppError(CODES.VALIDATION, 'One or more clients or galleries are unavailable. Refresh and select them again.');
    }
    for (const g of rows) {
      if (g.expiresAt && g.expiresAt <= new Date()) throw new AppError(CODES.CONFLICT, `${g.name} has expired. Extend its gallery expiry before assigning it.`, { status: 409 });
      if (g.status === 'ARCHIVED') throw new AppError(CODES.CONFLICT, `${g.name} is archived. Publish it before assigning it.`, { status: 409 });
      if (g.status !== 'PUBLISHED' && !publish) throw new AppError(CODES.CONFLICT, `${g.name} is not published. Use Assign and publish to make it available to the client.`, { status: 409 });
    }
    if (publish) await tx.eventGallery.updateMany({ where: { id: { in: galleries }, studioId, status: 'DRAFT', deletedAt: null }, data: { status: 'PUBLISHED' } });
    const grants = [];
    for (const g of rows) {
      if (publish && g.status === 'DRAFT') g.status = 'PUBLISHED';
      for (const c of customers) grants.push(await tx.accessGrant.upsert({
        where: { customerId_galleryId: { customerId: c.id, galleryId: g.id } },
        create: { customerId: c.id, galleryId: g.id, expiresAt: expiry },
        update: { expiresAt: expiry },
      }));
    }
    return { grants, granted: grants.length, customers, galleries: rows,
      availability: rows.map(g => ({ galleryId: g.id, ...galleryAvailability(g, { expiresAt: expiry }) })) };
  });
}
module.exports = { assignGalleries };
