/**
 * Per-client, per-gallery entitlements.
 *
 * SELECTION — watermarked previews, heart/lock/extras, originals only if downloads on
 * RAW       — no selection, full original download, face search to find yourself
 * VIEW      — watermarked preview only; no hearts, no originals
 */

const MODES = new Set(['SELECTION', 'RAW', 'VIEW']);

function galleryAvailability(gallery, grant, now = new Date()) {
  const expired = value => value && new Date(value) <= now;
  if (gallery?.deletedAt) return { accessible: false, reason: 'DELETED', message: 'This gallery has been removed by the studio.' };
  if (expired(gallery?.expiresAt)) return { accessible: false, reason: 'GALLERY_EXPIRED', message: 'This gallery has expired. Ask the studio to extend its availability.' };
  if (expired(grant?.expiresAt)) return { accessible: false, reason: 'ACCESS_EXPIRED', message: 'Your access to this gallery has expired. Ask the studio to renew your access.' };
  if (gallery?.status !== 'PUBLISHED' && !grant?.rawAccess && grant?.accessMode !== 'RAW') return { accessible: false, reason: 'UNPUBLISHED', message: 'This gallery has not been published yet. Ask the studio to publish it.' };
  return { accessible: true, reason: null, message: 'Available in the client app' };
}

function activeGrantWhere(customerId, studioId, galleryId, now = new Date()) {
  return { customerId, ...(galleryId && { galleryId }),
    AND: [
      { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      { OR: [{ gallery: { status: 'PUBLISHED' } }, { rawAccess: true }, { accessMode: 'RAW' }] },
    ],
    gallery: { studioId, deletedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
  };
}

function normalizeMode(raw, fallback = 'SELECTION') {
  const m = String(raw || '').toUpperCase();
  if (MODES.has(m)) return m;
  return fallback;
}

function pickPositiveRate(...vals) {
  for (const v of vals) {
    if (v == null || v === '') continue;
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return null;
}

function pickLimit(...vals) {
  for (const v of vals) {
    if (v == null || v === '') continue;
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0) return Math.floor(n);
  }
  return null;
}

/**
 * @param {object} gallery EventGallery (clientType optional)
 * @param {object} grant AccessGrant
 * @param {object} [pkg] resolved package / clientType pricing
 */
function resolveEntitlements(gallery, grant, pkg = null) {
  const rawFlag = !!grant?.rawAccess;
  const mode = normalizeMode(grant?.accessMode || (rawFlag ? 'RAW' : 'SELECTION'));

  const extraRate = pickPositiveRate(
    grant?.extraPhotoPrice,
    gallery?.extraPhotoPrice,
    pkg?.pricePerExtraEdited,
    pkg?.pricePerExtraPhoto,
  );
  const includedLimit = pickLimit(
    grant?.selectionLimit,
    gallery?.selectionLimit,
    pkg?.includedPhotos,
  );

  const galleryDownloads = gallery?.downloadEnabled === true;
  const galleryFace = gallery?.faceSearchEnabled === true;
  const gallerySelection = gallery?.selectionEnabled !== false
    && (gallery?.purpose || 'GENERAL') !== 'DELIVERY';

  let downloadsAllowed = false;
  let selectionEnabled = false;
  let faceSearchEnabled = galleryFace;
  let originalsAllowed = false;

  if (mode === 'RAW') {
    downloadsAllowed = true;
    originalsAllowed = true;
    selectionEnabled = false;
    faceSearchEnabled = galleryFace && (grant?.faceSearchEnabled != null ? !!grant.faceSearchEnabled : true);
  } else if (mode === 'VIEW') {
    downloadsAllowed = false;
    originalsAllowed = false;
    selectionEnabled = false;
    faceSearchEnabled = galleryFace && (grant?.faceSearchEnabled != null ? !!grant.faceSearchEnabled : true);
  } else {
    // SELECTION
    downloadsAllowed = rawFlag || (grant?.downloadEnabled != null ? !!grant.downloadEnabled : galleryDownloads);
    originalsAllowed = downloadsAllowed;
    selectionEnabled = gallerySelection;
    faceSearchEnabled = galleryFace && (grant?.faceSearchEnabled != null ? !!grant.faceSearchEnabled : true);
  }

  const extrasBillable = selectionEnabled && extraRate != null && extraRate > 0;

  return {
    accessMode: mode,
    rawAccess: rawFlag || mode === 'RAW',
    downloadsAllowed,
    originalsAllowed,
    selectionEnabled,
    faceSearchEnabled,
    extrasBillable,
    extraRate: extraRate != null ? extraRate : null,
    includedLimit: includedLimit != null ? includedLimit : 0,
    watermarkedPreviews: true, // always — originals only via download-url
    label: mode === 'RAW'
      ? `Full originals${faceSearchEnabled ? ' · face search' : ''} · no selection`
      : mode === 'VIEW'
        ? 'Preview only · watermarked · no download'
        : 'Select photos · extras billed',
  };
}

function grantWriteFromMode(mode, extra = {}) {
  const accessMode = normalizeMode(mode);
  return {
    accessMode,
    rawAccess: accessMode === 'RAW',
    rawGrantedAt: accessMode === 'RAW' ? (extra.now || new Date()) : null,
    rawGrantedByAdminId: accessMode === 'RAW' ? (extra.adminId || null) : null,
    ...(extra.selectionLimit !== undefined && {
      selectionLimit: extra.selectionLimit === '' || extra.selectionLimit == null
        ? null
        : Math.max(0, parseInt(extra.selectionLimit, 10) || 0),
    }),
    ...(extra.extraPhotoPrice !== undefined && {
      extraPhotoPrice: extra.extraPhotoPrice === '' || extra.extraPhotoPrice == null
        ? null
        : Number(extra.extraPhotoPrice),
    }),
    ...(extra.downloadEnabled !== undefined && {
      downloadEnabled: extra.downloadEnabled == null ? null : !!extra.downloadEnabled,
    }),
    ...(extra.faceSearchEnabled !== undefined && {
      faceSearchEnabled: extra.faceSearchEnabled == null ? null : !!extra.faceSearchEnabled,
    }),
  };
}

function publicGrantFields(ent) {
  return {
    accessMode: ent.accessMode,
    rawAccess: ent.rawAccess,
    downloadsAllowed: ent.downloadsAllowed,
    originalsAllowed: ent.originalsAllowed,
    selectionEnabled: ent.selectionEnabled,
    faceSearchEnabled: ent.faceSearchEnabled,
    extrasBillable: ent.extrasBillable,
    extraRate: ent.extraRate,
    includedLimit: ent.includedLimit,
    accessLabel: ent.label,
  };
}

module.exports = {
  galleryAvailability,
  activeGrantWhere,
  MODES,
  normalizeMode,
  pickPositiveRate,
  pickLimit,
  resolveEntitlements,
  grantWriteFromMode,
  publicGrantFields,
};
