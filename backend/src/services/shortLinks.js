const crypto = require('node:crypto');
const { prisma } = require('../config/prisma');

const APP_URL = (process.env.CUSTOMER_APP_URL || 'https://app.warmkelvin.com').replace(/\/$/, '');
const ID = /^[A-Za-z0-9_-]{1,100}$/;
const pages = new Set(['/app', '/packages', '/quotes', '/contracts', '/invoices', '/billing', '/galleries', '/portfolio', '/announcements', '/booking', '/contact', '/wedding-inquiry', '/event-inquiry', '/quotation-request', '/favorites', '/find-me']);
function parseDestination(value) {
  if (typeof value !== 'string' || value.length > 500 || !value.startsWith('/') || value.startsWith('//') || /[\\\s#]/.test(value)) return null;
  const url = new URL(value, APP_URL);
  if (url.origin !== new URL(APP_URL).origin || url.pathname !== value.split('?')[0]) return null;
  const gallery = url.pathname.match(/^\/gallery\/([A-Za-z0-9_-]{1,100})(\/(?:selection|photo))?$/);
  if (!pages.has(url.pathname) && !gallery) return null;
  const allowed = gallery?.[2] === '/photo' ? ['photoId'] : url.pathname === '/quotation-request' ? ['studioId'] : url.pathname === '/app' ? ['tab'] : ['/packages','/quotes','/contracts','/invoices','/billing','/portfolio','/announcements'].includes(url.pathname) ? ['id'] : url.pathname === '/find-me' ? ['galleryId'] : [];
  for (const [key, val] of url.searchParams) if (!allowed.includes(key) || !ID.test(val) || url.searchParams.getAll(key).length !== 1) return null;
  if (gallery?.[2] === '/photo' && !url.searchParams.get('photoId')) return null;
  return { photoId: url.searchParams.get('photoId'), path: url.pathname + url.search, page: url.pathname, id: gallery?.[1] || url.searchParams.get('id') || url.searchParams.get('galleryId'), studioId: url.searchParams.get('studioId') };
}

async function canShare(destination, actor, db = prisma) {
  const { studioId, customerId } = actor;
  const { page, id } = destination;
  if (destination.studioId && destination.studioId !== studioId) return false;
  if (!id) return true;
  const where = { id, studioId };
  let record;
  if (page.startsWith('/gallery/') || page === '/find-me') {
    record = await db.eventGallery.findFirst({ where: { ...where, deletedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } });
    if (!record) return false;
    if (customerId) {
      const grant = await db.accessGrant.findFirst({ where: { customerId, galleryId: id, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } });
      if (!grant || (record.status !== 'PUBLISHED' && !grant.rawAccess && grant.accessMode !== 'RAW')) return false;
      if (destination.photoId) return !!await db.photo.findFirst({ where: { id: destination.photoId, galleryId: id, ...(grant.rawAccess || grant.accessMode === 'RAW' ? {} : { isVisibleToCustomers: true }) } });
      return true;
    }
    if (destination.photoId) return !!await db.photo.findFirst({ where: { id: destination.photoId, galleryId: id } });
    return true;
  }
  if (page === '/packages') return !!await db.servicePackage.findFirst({ where: { ...where, active: true } });
  if (page === '/portfolio') return !!await db.portfolioItem.findFirst({ where: { ...where, active: true } });
  if (page === '/announcements') return !!await db.announcement.findFirst({ where: { ...where, active: true, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } });
  if (customerId) where.customerId = customerId;
  if (page === '/quotes') return !!await db.quote.findFirst({ where: { ...where, status: { in: ['SENT','APPROVED','CONVERTED'] } } });
  if (page === '/invoices' || page === '/billing') return !!await db.invoice.findFirst({ where: { ...where, status: { notIn: ['DRAFT','VOID'] } } });
  if (page === '/contracts') {
    record = await db.weddingAgreement.findFirst({ where: { ...where, status: 'FINALIZED' } });
    return !!record || !!await db.contract.findFirst({ where });
  }
  return false;
}

async function createShortLink({ studioId, path, key = path, expiresAt = null }, db = prisma) {
  const targetHash = crypto.createHash('sha256').update(key).digest('hex');
  const where = { studioId_targetHash: { studioId, targetHash } };
  for (let attempt = 0; attempt < 4; attempt++) {
    const existing = await db.shortLink.findUnique({ where });
    if (existing?.active && (!existing.expiresAt || existing.expiresAt > new Date())) return payload(existing);
    const data = { token: crypto.randomBytes(12).toString('base64url'), path, active: true, expiresAt };
    try {
      if (existing) {
        // Only one concurrent renewal replaces the token; other callers reuse its result.
        const updated = await db.shortLink.updateMany({ where: { id: existing.id, token: existing.token }, data });
        if (!updated.count) continue;
        return payload(await db.shortLink.findUnique({ where }));
      }
      return payload(await db.shortLink.create({ data: { ...data, studioId, targetHash } }));
    } catch (e) { if (e.code !== 'P2002' || attempt === 3) throw e; }
  }
}
function payload(link) { const path = `/l/${link.token}`; return { id: link.id, path, url: `${APP_URL}${path}`, expiresAt: link.expiresAt }; }
function available(link) { return !!link?.active && (!link.expiresAt || link.expiresAt > new Date()); }
module.exports = { parseDestination, canShare, createShortLink, available, APP_URL };
