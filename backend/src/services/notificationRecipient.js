const { activeGrantWhere } = require('./galleryAccess');
/** Resolve gallery notifications by the granted customer, never by a shared phone. */
async function galleryNotificationRecipient(db, studioId, meta) {
  if (!meta?.customerId || !meta?.galleryId) return null;
  const grant = await db.accessGrant.findFirst({ where: {
    ...activeGrantWhere(meta.customerId, studioId, meta.galleryId),
    customer: { studioId, isGuest: false, accountStatus: { not: 'DISABLED' } },
  }, include: { customer: true, gallery: true } });
  if (!grant?.customer?.phone) return null;
  const name = String(grant.customer.name || '').trim() || 'there';
  return { phone: grant.customer.phone, toName: name, name, galleryName: grant.gallery.name || 'your gallery' };
}
function recipientTemplateVars({ vars = {}, toName, phone, studioName }) {
  return { ...vars, name: String(toName || vars.name || '').trim() || 'there', phone, studioName };
}
module.exports = { galleryNotificationRecipient, recipientTemplateVars };
