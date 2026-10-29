/**
 * Two-phase selection: INCLUDED (lock package picks) then EXTRAS (billed).
 * Single source of truth for selection.js and photo favorite toggle.
 */

function extraRateOf(estimate) {
  const n = Number(
    estimate?.pricePerExtraEdited
    ?? estimate?.pricePerExtraPhoto
    ?? estimate?.pricePerExtraRaw
    ?? 0,
  );
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function orderedUniquePhotoIds(items, predicate) {
  const ordered = [...(items || [])]
    .filter((i) => i?.photoId && (!predicate || predicate(i)))
    .sort((a, b) => {
      const at = new Date(a.submittedAt || a.createdAt || 0).getTime();
      const bt = new Date(b.submittedAt || b.createdAt || 0).getTime();
      return at - bt;
    });
  const ids = [];
  for (const i of ordered) {
    if (!ids.includes(i.photoId)) ids.push(i.photoId);
  }
  return ids;
}

function capIncluded(ids, includedLimit) {
  const unique = [...new Set((ids || []).filter(Boolean))];
  if (includedLimit == null || includedLimit === '') return unique;
  const limit = Number(includedLimit);
  if (!Number.isFinite(limit) || limit < 0) return unique;
  return unique.slice(0, Math.floor(limit));
}

/**
 * INCLUDED — client is still picking free package photos.
 * EXTRAS   — included are locked (unless admin reopened included).
 */
function resolveSelectionPhase(selection) {
  const mode = String(selection?.unlockMode || 'NONE').toUpperCase();
  if (mode === 'INCLUDED') return 'INCLUDED';
  if (selection?.includedLockedAt) return 'EXTRAS';
  const history = Array.isArray(selection?.history) ? selection.history : [];
  if (history.length > 0 && mode !== 'INCLUDED') return 'EXTRAS';
  if (selection?.status === 'SUBMITTED' && mode !== 'INCLUDED') return 'EXTRAS';
  return 'INCLUDED';
}

function lockedIncludedIds(selection) {
  const phase = resolveSelectionPhase(selection);
  if (phase !== 'EXTRAS') return [];

  const items = selection?.items || [];
  const fromType = orderedUniquePhotoIds(
    items,
    (i) => i.deliveryType === 'INCLUDED' || i.deliveryType === 'PACKAGE',
  );
  let ids = fromType;

  if (ids.length === 0) {
    const history = Array.isArray(selection?.history) ? selection.history : [];
    const first = history.find((h) => h?.kind === 'INCLUDED' || h?.phase === 'INCLUDED') || history[0];
    if (first && Array.isArray(first.items)) {
      ids = first.items
        .filter((i) => i.isIncluded !== false && i.isExtra !== true)
        .map((i) => i.photoId)
        .filter(Boolean);
    }
  }

  const limitRaw = selection?.includedLimit;
  const limit = Math.max(0, Number(limitRaw) || 0);
  if (ids.length === 0 && limit > 0 && items.length > 0) {
    ids = orderedUniquePhotoIds(items).slice(0, limit);
  }

  return capIncluded(ids, limitRaw);
}

/**
 * Review-list flags for one photo.
 * Pending extras must not inherit the included-lock timestamp — that made the
 * app show "already billed" / "add extras in the gallery first" before any invoice.
 */
function extraReviewFlags({ isExtra, photoId, billedIds, rowSubmittedAt, selectionSubmittedAt }) {
  const billed = !!(isExtra && photoId && Array.isArray(billedIds) && billedIds.includes(photoId));
  if (!isExtra) {
    return {
      alreadySubmitted: false,
      isNewExtra: false,
      submittedAt: rowSubmittedAt || selectionSubmittedAt || null,
    };
  }
  return {
    alreadySubmitted: billed,
    isNewExtra: !billed,
    submittedAt: billed ? (rowSubmittedAt || selectionSubmittedAt || null) : null,
  };
}

function billedExtraIds(selection) {
  // Without an extras invoice, EDITED/RAW stamps are leftover from a failed bill — treat as pending.
  if (!selection?.overageInvoiceId) return [];
  const items = selection?.items || [];
  const fromType = items
    .filter((i) => {
      const t = String(i.deliveryType || '').toUpperCase();
      return t === 'RAW' || t === 'EDITED';
    })
    .map((i) => i.photoId)
    .filter(Boolean);
  if (fromType.length > 0) return [...new Set(fromType)];

  const history = Array.isArray(selection?.history) ? selection.history : [];
  const ids = [];
  for (const h of history) {
    if (!Array.isArray(h?.items)) continue;
    for (const row of h.items) {
      if (!row?.photoId) continue;
      const t = String(row.deliveryType || '').toUpperCase();
      if (row.isExtra === true || t === 'RAW' || t === 'EDITED') ids.push(row.photoId);
    }
  }
  return [...new Set(ids)];
}

function phaseMeta(phase, includedLimit, count, estimate, lockedCount = 0) {
  const limit = Math.max(0, Number(includedLimit) || 0);
  const extra = extraRateOf(estimate);
  const extrasCount = phase === 'EXTRAS'
    ? Math.max(0, count - Math.max(lockedCount, 0))
    : 0;
  const extraLabel = extra > 0 ? `₹${extra.toLocaleString('en-IN')}` : null;
  return {
    selectionPhase: phase,
    includedLimit: limit,
    slotsRemaining: phase === 'INCLUDED' ? Math.max(0, limit - count) : null,
    extrasUnlocked: phase === 'EXTRAS',
    lockedCount: lockedCount || 0,
    extraRate: extra,
    phaseLabel: phase === 'INCLUDED'
      ? (limit > 0
        ? `Choose your ${limit} included photo${limit === 1 ? '' : 's'}`
        : 'Choose your included photos')
      : (lockedCount > 0
        ? `${lockedCount} photo${lockedCount === 1 ? '' : 's'} locked · add extras anytime`
        : 'Add extra photos (billed)'),
    phaseHint: phase === 'INCLUDED'
      ? (limit > 0
        ? `Your package includes ${limit} photo${limit === 1 ? '' : 's'} — pick only these first. When you lock them, they stay fixed.`
          + (extraLabel ? ` After that you can add more as extras at ${extraLabel} each.` : '')
        : 'Pick your included photos, then lock them. After that you can add more as extras.')
      : (extraLabel
        ? `Your included picks are locked. Anything new from the gallery is an extra at ${extraLabel} each.`
        : 'Your included picks are locked. Add more from the gallery as extras.'),
    extrasSelectedHint: extrasCount > 0 && extraLabel
      ? `${extrasCount} extra photo${extrasCount === 1 ? '' : 's'} selected · ${extraLabel} each`
      : null,
  };
}

module.exports = {
  extraRateOf,
  orderedUniquePhotoIds,
  capIncluded,
  resolveSelectionPhase,
  lockedIncludedIds,
  billedExtraIds,
  extraReviewFlags,
  phaseMeta,
};
