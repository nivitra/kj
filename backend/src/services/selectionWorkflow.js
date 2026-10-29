const { prisma } = require('../config/prisma');
const { estimateSelection } = require('./pricing');
const { resolveEntitlements } = require('./galleryAccess');
const { BillingError, assertManagerPlus } = require('./billing/paymentService');
const { createSentInvoice } = require('./billing/issueAndNotify');
const { computeMoney, deriveStatus, toPaise, fromPaise } = require('./billing/money');
const { recomputeCustomerRollup } = require('./billing/customerRollup');
const { getSignedPhotoUrl } = require('./s3');

async function load(db, { customerId, studioId, galleryId }, lock = false) {
  if (lock) await db.$queryRaw`SELECT id FROM "AccessGrant" WHERE "customerId" = ${customerId} AND "galleryId" = ${galleryId} FOR UPDATE`;
  const grant = await db.accessGrant.findFirst({ where: { customerId, galleryId,
    OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    gallery: { studioId, status: 'PUBLISHED', deletedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
  }, include: { gallery: true } });
  if (!grant) throw new BillingError('Gallery access is unavailable or expired', { status: 403 });
  if (!resolveEntitlements(grant.gallery, grant).selectionEnabled) throw new BillingError('Selection is not enabled for this gallery', { status: 403 });
  const selection = await db.selection.findUnique({ where: { customerId_galleryId: { customerId, galleryId } }, include: { items: { include: { photo: true }, orderBy: [{ createdAt: 'asc' }, { photoId: 'asc' }] } } });
  const favorites = await db.favorite.findMany({ where: { customerId, photo: { galleryId } }, include: { photo: true }, orderBy: [{ createdAt: 'asc' }, { photoId: 'asc' }] });
  const frozen = (selection?.items || []).filter((i) => i.editingStartedAt);
  const frozenIds = new Set(frozen.map((i) => i.photoId));
  const photos = [...frozen, ...favorites.filter((f) => !frozenIds.has(f.photoId))];
  const pricing = selection?.pricingSnapshot || await estimateSelection({ ...grant.gallery,
    selectionLimit: grant.selectionLimit ?? grant.gallery.selectionLimit,
    extraPhotoPrice: grant.extraPhotoPrice ?? grant.gallery.extraPhotoPrice }, photos.length, customerId);
  const included = Number(pricing.includedPhotos ?? 0);
  const rate = Number(pricing.pricePerExtraPhoto ?? pricing.extraRate ?? 0);
  let freeRemaining = Math.max(0, included - frozen.filter((i) => i.deliveryType === 'INCLUDED').length);
  const old = new Map((selection?.items || []).map((i) => [i.photoId, i]));
  const items = photos.map((p) => {
    const locked = frozenIds.has(p.photoId);
    const isFree = locked ? p.deliveryType === 'INCLUDED' : freeRemaining-- > 0;
    const prev = old.get(p.photoId);
    return { photoId: p.photoId, photo: p.photo, locked, isFree, isExtra: !isFree,
      deliveryType: isFree ? 'INCLUDED' : 'EDITED', submittedAt: prev?.submittedAt || null,
      editingStartedAt: prev?.editingStartedAt || null, batchNumber: prev?.batchNumber || (selection?.revision || 0) + 1 };
  });
  return { grant, selection, items, pricing, included, rate };
}
function projection(state) {
  const { selection: s, items, included, rate, pricing } = state;
  const extras = items.filter((i) => i.isExtra);
  const pending = extras.filter((i) => !i.locked);
  const locked = items.filter((i) => i.locked);
  const estimate = { ...pricing, includedPhotos: included, selectionLimit: included, selectedCount: items.length,
    extraCount: extras.length, pendingExtraCount: pending.length, lockedExtraCount: extras.length - pending.length, freeCount: items.length - extras.length, pricePerExtraPhoto: rate, extraRate: rate,
    overageTotal: fromPaise(toPaise(rate) * BigInt(pending.length)), pricingReady: pricing.pricingReady !== false,
    continuousSelection: true, selectionPhase: 'CONTINUOUS',
    summaryLine: `${items.length} selected · ${items.length - extras.length} included · ${extras.length} extra`,
    phaseHint: 'You can change submitted photos until the studio starts editing. You can always add more photos.',
  };
  return { customerNote: s?.customerNote || '', status: s?.status || 'OPEN', revision: s?.revision || 0, continuousSelection: true,
    submittedAt: s?.submittedAt || null, editingStartedAt: s?.editingStartedAt || null,
    statusLabel: locked.length ? `${locked.length} photos confirmed · you can add more` : s?.submittedAt ? 'Submitted · changes allowed until editing starts' : 'Choose your photos',
    history: s?.history || [], count: items.length, selectionPhase: 'CONTINUOUS', includedLimit: included,
    slotsRemaining: Math.max(0, included - items.length), extrasUnlocked: true,
    lockedPhotoIds: locked.map((i) => i.photoId), billedExtraPhotoIds: extras.filter((i) => i.locked).map((i) => i.photoId),
    pendingExtraPhotoIds: pending.map((i) => i.photoId), extraRate: rate, estimate,
    pricingReady: estimate.pricingReady, selectionEnabled: true, overageInvoiceId: s?.overageInvoiceId || null,
    phaseLabel: 'Choose your photos', phaseHint: estimate.phaseHint,
  };
}
async function getSelection(args, withItems = false) {
  const state = await load(prisma, args);
  const result = projection(state);
  if (withItems) result.items = await Promise.all(state.items.map(async (i) => ({ ...i, photo: undefined, id: i.photoId,
    filename: i.photo.filename, thumbnailUrl: await getSignedPhotoUrl(i.photo.thumbnailKey), previewUrl: await getSignedPhotoUrl(i.photo.previewKey),
    alreadySubmitted: i.locked, isNewExtra: i.isExtra && !i.locked, badge: i.locked ? 'EDITING' : i.isFree ? 'FREE' : 'EXTRA',
  })));
  return result;
}
async function setSelected({ photoId, selected, ...args }) {
  const photo = await prisma.photo.findFirst({ where: { id: photoId, isVisibleToCustomers: true, gallery: { studioId: args.studioId } } });
  if (!photo) throw new BillingError('Photo not found', { status: 404 });
  args.galleryId = photo.galleryId;
  const favorited = await prisma.$transaction(async (db) => {
    const state = await load(db, args, true);
    const existing = await db.favorite.findUnique({ where: { customerId_photoId: { customerId: args.customerId, photoId } } });
    const desired = typeof selected === 'boolean' ? selected : !existing;
    if (!desired && state.items.some((i) => i.photoId === photoId && i.locked)) throw new BillingError('Editing has started for this photo. You can still add more photos.');
    if (desired) await db.favorite.upsert({ where: { customerId_photoId: { customerId: args.customerId, photoId } }, create: { customerId: args.customerId, photoId }, update: {} });
    else await db.favorite.deleteMany({ where: { customerId: args.customerId, photoId } });
    return desired;
  });
  return { ...await getSelection(args), favorited };
}
async function submitSelection(args) {
  const result = await prisma.$transaction(async (db) => {
    const state = await load(db, args, true);
    const { selection: old, items, pricing, rate } = state;
    if (!items.length) throw new BillingError('Choose at least one photo');
    if (pricing.pricingReady === false) throw new BillingError('The studio needs to finish pricing this gallery before you can confirm');
    const ids = items.map((i) => `${i.photoId}:${i.deliveryType}`).sort().join('|');
    const oldIds = (old?.items || []).map((i) => `${i.photoId}:${i.deliveryType}`).sort().join('|');
    if (old && ids === oldIds && (args.note || '') === (old.customerNote || '')) return { replayed: true, invoiceId: old.overageInvoiceId, overageTotal: Number(old.overageAmount || 0), extraCount: items.filter((i) => i.isExtra && !i.locked).length };
    if (args.revision != null && args.revision !== (old?.revision || 0)) throw new BillingError('Your selection changed on another device. Review the latest photos before submitting.', { status: 409 });
    const extras = items.filter((i) => i.isExtra && !i.locked);
    const total = fromPaise(toPaise(rate) * BigInt(extras.length));
    let invoice = old?.overageInvoiceId ? await db.invoice.findFirst({ where: { id: old.overageInvoiceId, studioId: args.studioId, customerId: args.customerId }, include: { payments: true, lineItems: true } }) : null;
    if (invoice?.status === 'VOID') invoice = null;
    const line = { kind: 'ADDON', description: `Extra photos — ${state.grant.gallery.name}`, quantity: extras.length, unitAmount: rate, lineTotal: total };
    if (!invoice && total > 0) {
      invoice = await createSentInvoice({ studioId: args.studioId, customerId: args.customerId, title: `Photo selection — ${state.grant.gallery.name}`, lines: [line] }, db);
    } else if (invoice && toPaise(invoice.totalAmount) !== toPaise(total)) {
      await db.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${invoice.id} FOR UPDATE`;
      invoice = await db.invoice.findUnique({ where: { id: invoice.id }, include: { payments: true, lineItems: true } });
      const last = await db.invoiceRevision.aggregate({ where: { invoiceId: invoice.id }, _max: { revision: true } });
      await db.invoiceRevision.create({ data: { invoiceId: invoice.id, revision: (last._max.revision || 0) + 1, reason: 'Customer revised selection before editing', snapshot: JSON.parse(JSON.stringify(invoice)) } });
      const ledger = invoice.payments.length ? invoice.payments : Number(invoice.amountPaid) > 0 ? [{ amount: invoice.amountPaid, kind: 'PAYMENT' }] : [];
      const money = computeMoney(total, ledger);
      await db.invoiceLineItem.deleteMany({ where: { invoiceId: invoice.id } });
      if (extras.length) await db.invoiceLineItem.create({ data: { invoiceId: invoice.id, sortOrder: 0, ...line } });
      invoice = await db.invoice.update({ where: { id: invoice.id }, data: { totalAmount: total, cachedOutstanding: money.outstanding,
        status: deriveStatus(invoice, money), notes: money.overpay > 0 ? `Credit of INR ${money.overpay} awaiting studio refund or allocation. No cash refund has been recorded.` : invoice.notes } });
    }
    const now = new Date();
    const revision = (old?.revision || 0) + 1;
    const history = [...(Array.isArray(old?.history) ? old.history : []), { batchNumber: revision, revision, submittedAt: now.toISOString(), kind: 'SELECTION', count: items.length,
      extraCount: extras.length, amount: total, invoiceId: invoice?.id || null, items: items.map((i) => ({ photoId: i.photoId, deliveryType: i.deliveryType, isIncluded: i.isFree, isExtra: i.isExtra })) }];
    const data = { status: 'SUBMITTED', submittedAt: now, customerNote: args.note || null, revision, history,
      pricingSnapshot: JSON.parse(JSON.stringify(pricing)), includedLimit: state.included, extraCount: items.filter((i) => i.isExtra).length,
      extraUnitPrice: rate, overageAmount: total, overageInvoiceId: invoice?.id || null, adminOpenedAt: null, deliveryStatus: 'SUBMITTED',
    };
    const selection = await db.selection.upsert({ where: { customerId_galleryId: { customerId: args.customerId, galleryId: args.galleryId } },
      create: { customerId: args.customerId, galleryId: args.galleryId, ...data }, update: data });
    await db.selectionItem.deleteMany({ where: { selectionId: selection.id, editingStartedAt: null } });
    const editable = items.filter((i) => !i.locked);
    if (editable.length) await db.selectionItem.createMany({ data: editable.map((i) => ({ selectionId: selection.id, photoId: i.photoId, deliveryType: i.deliveryType, batchNumber: revision, submittedAt: now })) });
    await recomputeCustomerRollup(db, args.customerId);
    return { invoiceId: invoice?.id || null, invoiceNumber: invoice?.invoiceNumber, extraCount: extras.length, overageTotal: total, replayed: false };
  }, { timeout: 20000 });
  const state = await getSelection(args);
  return { ...state, billing: result, estimate: { ...state.estimate, billing: result } };
}
async function startEditing({ selectionId, studioId, admin, revision, reopen = false, reason }) {
  assertManagerPlus(admin);
  const found = await prisma.selection.findFirst({ where: { id: selectionId, gallery: { studioId } } });
  if (!found) throw new BillingError('Selection not found', { status: 404 });
  return prisma.$transaction(async (db) => {
    await db.$queryRaw`SELECT id FROM "AccessGrant" WHERE "customerId" = ${found.customerId} AND "galleryId" = ${found.galleryId} FOR UPDATE`;
    const s = await db.selection.findUnique({ where: { id: selectionId }, include: { items: true } });
    if (revision != null && revision !== s.revision) throw new BillingError('Customer updated their selection. Review the latest revision first.', { status: 409 });
    if (!s.items.length) throw new BillingError('There are no submitted photos to edit');
    if (reopen && !String(reason || '').trim()) throw new BillingError('Give a reason for reopening');
    if (!reopen) {
      const picks = await db.favorite.findMany({ where: { customerId: s.customerId, photo: { galleryId: s.galleryId } }, select: { photoId: true } });
      const draft = new Set([...picks.map((p) => p.photoId), ...s.items.filter((i) => i.editingStartedAt).map((i) => i.photoId)]);
      if (draft.size !== s.items.length || s.items.some((i) => !draft.has(i.photoId))) throw new BillingError('The customer has unsubmitted changes. Ask them to submit the latest selection before starting editing.', { status: 409 });
    }
    if (!reopen && s.items.every((i) => i.editingStartedAt)) return s;
    const previousStart = [...(s.history || [])].reverse().find((h) => h.kind === 'EDITING_STARTED');
    if (reopen && !s.editingStartedAt) return s;
    const now = new Date();
    await db.selectionItem.updateMany({ where: { selectionId, ...(reopen ? { editingStartedAt: s.editingStartedAt } : { editingStartedAt: null }) }, data: { editingStartedAt: reopen ? null : now } });
    return db.selection.update({ where: { id: selectionId }, data: { editingStartedAt: reopen ? null : now,
      includedLockedAt: reopen ? null : now, revision: { increment: 1 },
      ...(reopen ? { status: 'UNLOCKED', unlockMode: 'INCLUDED', overageInvoiceId: previousStart?.invoiceId || null } : { overageInvoiceId: null, unlockMode: 'NONE' }),
      history: [...(s.history || []), { kind: reopen ? 'REOPENED' : 'EDITING_STARTED', at: now.toISOString(), actor: admin.id, reason: reason || null, revision: s.revision, invoiceId: s.overageInvoiceId }],
    } });
  });
}
module.exports = { getSelection, setSelected, submitSelection, startEditing };
