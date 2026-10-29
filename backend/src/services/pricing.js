const { prisma } = require('../config/prisma');

/** Suggested default when admin explicitly configures rate — never silent auto-bill fallback. */
const DEFAULT_EXTRA_PHOTO_PRICE = 350;

/**
 * Normalize ServicePackage or ClientType into a pricing source shape.
 */
function asPricingSource(row, kind = 'package') {
  if (!row) return null;
  // ServicePackage uses title; ClientType uses name
  const name = row.name || row.title || null;
  const basePrice = row.basePrice != null
    ? Number(row.basePrice)
    : Number(row.discountPrice != null ? row.discountPrice : row.price) || 0;
  const extra = row.pricePerExtraEdited != null
    ? Number(row.pricePerExtraEdited)
    : (row.pricePerExtraPhoto != null ? Number(row.pricePerExtraPhoto) : null);
  return {
    id: row.id,
    name,
    includedPhotos: row.includedPhotos ?? null,
    pricePerExtraPhoto: extra,
    pricePerExtraRaw: extra,
    pricePerExtraEdited: extra,
    basePrice,
    workflowMode: row.workflowMode || 'SELECT_ONLY',
    _kind: kind,
  };
}

/**
 * Resolve pricing source: gallery tier → booking ServicePackage → customer ClientType.
 * Unified packages: ServicePackage is source of truth; ClientType is the selection mirror.
 */
async function resolveClientType(gallery, customerId) {
  if (gallery?.pricingSnapshot) return asPricingSource(gallery.pricingSnapshot, 'agreed');
  if (gallery?.clientTypeId) {
    const tier = await prisma.clientType.findUnique({ where: { id: gallery.clientTypeId } });
    if (tier) {
      // Prefer linked ServicePackage fields when present
      const sp = await prisma.servicePackage.findFirst({
        where: {
          studioId: gallery.studioId,
          selectionTierId: tier.id,
        },
      });
      if (sp && (sp.includedPhotos != null || sp.pricePerExtraPhoto != null)) {
        return asPricingSource(sp, 'service');
      }
      return asPricingSource(tier, 'tier');
    }
  }
  if (customerId) {
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      include: {
        package: true,
        booking: { include: { servicePackage: true } },
      },
    });
    // Multiple jobs must be priced explicitly per gallery, never from the latest booking.
    if (Array.isArray(customer?.booking?.jobs) && customer.booking.jobs.length > 1) return null;
    const sp = customer?.booking?.servicePackage;
    if (sp) return asPricingSource(sp, 'service');
    if (customer?.package) return asPricingSource(customer.package, 'tier');
  }
  return null;
}

/**
 * Guardrail: selection + auto-invoice only when pricing is intentionally configured.
 * - Need pricing tier (client/gallery ClientType) OR gallery override (limit or rate)
 * - Need explicit ₹/extra on gallery, package, or studio settings (NOT silent code default)
 */
async function assessSelectionPricing(gallery, customerId) {
  const settings = await prisma.pricingSettings.findUnique({
    where: { studioId: gallery.studioId },
  });
  const clientType = await resolveClientType(gallery, customerId);

  const hasTier = !!clientType;
  const hasGalleryOverride =
    gallery?.selectionLimit != null
    || (gallery?.extraPhotoPrice != null && gallery.extraPhotoPrice !== '');

  const rateFromGallery = gallery?.extraPhotoPrice != null && gallery.extraPhotoPrice !== '';
  const rateFromPackage = clientType?.pricePerExtraPhoto != null && clientType.pricePerExtraPhoto !== '';
  const rateFromStudio = settings?.pricePerExtraPhoto != null && settings.pricePerExtraPhoto !== '';
  const rateExplicit = rateFromGallery || rateFromPackage || rateFromStudio;

  const missing = [];
  if (!hasTier && !hasGalleryOverride) {
    missing.push('pricing_tier_or_gallery_override');
  }
  if (!rateExplicit) {
    missing.push('extra_photo_rate');
  }

  const ready = missing.length === 0;

  let adminMessage = null;
  let clientMessage = null;
  if (!ready) {
    adminMessage =
      'Pricing incomplete — customers can choose photos, but confirmation waits until you set ₹/extra '
      + '(gallery override or client pricing tier) and set the included allowance.';
    clientMessage =
      "You can keep choosing photos. The studio will confirm your included allowance and extra-photo price before you submit.";
  }

  return {
    ready,
    missing,
    hasTier,
    hasGalleryOverride,
    rateExplicit,
    rateSource: rateFromGallery ? 'gallery' : rateFromPackage ? 'package' : rateFromStudio ? 'studio' : 'none',
    clientTypeId: clientType?.id || null,
    clientTypeName: clientType?.name || null,
    adminMessage,
    clientMessage,
  };
}

/**
 * Resolve effective selection pricing — most specific wins.
 * Priority: gallery override → gallery package (clientType) → customer package → studio settings → defaults.
 */
const effectivePricing = async (studioId, clientType, gallery = null) => {
  const settings = await prisma.pricingSettings.findUnique({ where: { studioId } });
  const currency = settings?.currency || 'INR';

  const fromGalleryLimit = gallery?.selectionLimit != null ? Number(gallery.selectionLimit) : null;
  const fromPackageLimit = clientType?.includedPhotos != null ? Number(clientType.includedPhotos) : null;
  const fromStudioLimit = settings?.includedPhotos != null ? Number(settings.includedPhotos) : null;

  const includedPhotos = fromGalleryLimit != null && !Number.isNaN(fromGalleryLimit)
    ? Math.max(0, Math.floor(fromGalleryLimit))
    : fromPackageLimit != null && !Number.isNaN(fromPackageLimit)
      ? Math.max(0, Math.floor(fromPackageLimit))
      : fromStudioLimit != null && !Number.isNaN(fromStudioLimit)
        ? Math.max(0, Math.floor(fromStudioLimit))
        : 0;

  let extraRate = 0;
  let rateSource = 'default';
  let rateExplicit = false;

  if (settings?.pricePerExtraPhoto != null && settings.pricePerExtraPhoto !== '') {
    const n = Number(settings.pricePerExtraPhoto);
    if (Number.isFinite(n) && n >= 0) {
      extraRate = n;
      rateSource = 'studio';
      rateExplicit = true;
    }
  }

  if (clientType?.pricePerExtraPhoto != null && clientType.pricePerExtraPhoto !== '') {
    const n = Number(clientType.pricePerExtraPhoto);
    if (Number.isFinite(n) && n >= 0) {
      extraRate = n;
      rateSource = 'package';
      rateExplicit = true;
    }
  } else if (clientType?.pricePerExtraEdited != null && Number.isFinite(Number(clientType.pricePerExtraEdited))) {
    extraRate = Number(clientType.pricePerExtraEdited);
    rateSource = 'package';
    rateExplicit = true;
  }

  if (gallery?.extraPhotoPrice != null && gallery.extraPhotoPrice !== '') {
    const g = Number(gallery.extraPhotoPrice);
    if (Number.isFinite(g) && g >= 0) {
      extraRate = g;
      rateSource = 'gallery';
      rateExplicit = true;
    }
  }

  if (!Number.isFinite(extraRate) || extraRate < 0) extraRate = 0;

  const baseGalleryFee = Number(settings?.baseGalleryFee ?? 0) || 0;
  const workflowMode = clientType?.workflowMode || 'SELECT_ONLY';
  const pricePerExtraPhoto = extraRate;
  const pricePerExtraEdited = extraRate;
  const pricePerExtraRaw = extraRate;

  return {
    currency,
    includedPhotos,
    pricePerExtraPhoto,
    pricePerExtraRaw,
    pricePerExtraEdited,
    baseGalleryFee,
    workflowMode,
    packageId: clientType?.id || null,
    packageName: clientType?.name || null,
    rateSource,
    rateExplicit,
    limitSource: fromGalleryLimit != null ? 'gallery'
      : fromPackageLimit != null ? 'package'
        : fromStudioLimit != null ? 'studio' : 'default',
    defaultExtraPrice: DEFAULT_EXTRA_PHOTO_PRICE,
  };
};

/**
 * Estimate for a selection of `count` photos.
 * One explicitly configured extra rate. Never treats package base price as ₹/extra.
 */
const estimateSelection = async (gallery, count, customerId, options = {}) => {
  const n = Math.max(0, Number(count) || 0);
  const assessment = await assessSelectionPricing(gallery, customerId);
  const clientType = await resolveClientType(gallery, customerId);
  const p = await effectivePricing(gallery.studioId, clientType, gallery);
  const extra = Math.max(0, n - p.includedPhotos);
  const extraRate = p.pricePerExtraEdited ?? p.pricePerExtraPhoto ?? DEFAULT_EXTRA_PHOTO_PRICE;
  const extraTotal = Math.round(extra * extraRate * 100) / 100;
  const withinLimit = extra === 0;

  let exactBill = null;
  if (Array.isArray(options.deliveryTypes) && options.deliveryTypes.length > 0) {
    const { computeDeliveryBill } = require('./selectionDelivery');
    exactBill = computeDeliveryBill(
      options.deliveryTypes.map((t) => ({ deliveryType: t })),
      {
        includedPhotos: p.includedPhotos,
        pricePerExtraPhoto: extraRate,
        pricePerExtraRaw: extraRate,
        pricePerExtraEdited: extraRate,
      },
    );
  }

  let message = null;
  let overLimitMessage = null;
  if (!assessment.ready) {
    message = assessment.clientMessage;
  } else if (p.includedPhotos > 0 && extra > 0) {
    overLimitMessage =
      `You've selected ${n} photos (${p.includedPhotos} included in package). ` +
      `Extras are ₹${extraRate} each and billed on your invoice.`;
    message = overLimitMessage;
  } else if (p.includedPhotos > 0 && withinLimit) {
    const left = p.includedPhotos - n;
    message = left > 0
      ? `${n} of ${p.includedPhotos} included · ${left} remaining`
      : `All ${p.includedPhotos} included photos used · next picks are extras at ₹${extraRate} each`;
  } else if (p.includedPhotos === 0 && n > 0) {
    message = `No included package photos — extras are ₹${extraRate} each.`;
  }

  const billedTotal = exactBill?.overageTotal ?? extraTotal;
  const summaryLine = !assessment.ready
    ? null
    : extra <= 0
      ? `${Math.min(n, p.includedPhotos)} included in package · no extras`
      : `${Math.min(n, p.includedPhotos)} included · ${extra} extra · ₹${billedTotal}`;

  return {
    currency: p.currency,
    includedPhotos: p.includedPhotos,
    selectionLimit: p.includedPhotos,
    pricePerExtraPhoto: extraRate,
    pricePerExtraRaw: extraRate,
    pricePerExtraEdited: extraRate,
    baseGalleryFee: p.baseGalleryFee,
    selectedCount: n,
    freeCount: Math.min(n, p.includedPhotos),
    extraCount: extra,
    overageTotal: billedTotal,
    overageMin: billedTotal,
    overageMax: billedTotal,
    estimatedTotal: billedTotal,
    dualRate: false,
    summaryLine,
    billPreview: exactBill,
    withinLimit,
    overLimit: !withinLimit && p.includedPhotos > 0,
    canSelectMore: true,
    pricingReady: assessment.ready,
    pricingMissing: assessment.missing,
    pricingAdminMessage: assessment.adminMessage,
    pricingClientMessage: assessment.clientMessage,
    message,
    overLimitMessage,
    workflowMode: p.workflowMode,
    packageId: p.packageId,
    packageName: p.packageName,
    rateSource: p.rateSource,
    limitSource: p.limitSource,
    galleryId: gallery?.id || null,
    galleryName: gallery?.name || null,
  };
};

/**
 * Studio-wide setup gaps for Command Center.
 */
async function listPricingSetupGaps(studioId) {
  const customers = await prisma.customer.findMany({
    where: {
      studioId,
      isGuest: false,
      accountStatus: { not: 'DISABLED' },
      OR: [
        { packageId: null },
        { package: { pricePerExtraPhoto: null } },
      ],
    },
    select: {
      id: true,
      name: true,
      packageId: true,
      package: { select: { id: true, name: true, pricePerExtraPhoto: true, includedPhotos: true } },
    },
    take: 50,
    orderBy: { updatedAt: 'desc' },
  });

  const noTier = customers.filter((c) => !c.packageId);
  const tierNoRate = customers.filter(
    (c) => c.packageId && (c.package?.pricePerExtraPhoto == null || c.package?.pricePerExtraPhoto === ''),
  );

  const galleries = await prisma.eventGallery.findMany({
    where: {
      studioId,
      deletedAt: null,
      status: 'PUBLISHED',
      purpose: { not: 'DELIVERY' },
    },
    select: {
      id: true,
      name: true,
      selectionLimit: true,
      extraPhotoPrice: true,
      clientTypeId: true,
      clientType: { select: { pricePerExtraPhoto: true, name: true } },
    },
    take: 40,
  });

  const settings = await prisma.pricingSettings.findUnique({ where: { studioId } });
  const studioRate = settings?.pricePerExtraPhoto != null && settings.pricePerExtraPhoto !== '';

  const incompleteGalleries = galleries.filter((g) => {
    const hasOverride = g.selectionLimit != null || g.extraPhotoPrice != null;
    const hasTier = !!g.clientTypeId;
    const rateOk =
      g.extraPhotoPrice != null
      || g.clientType?.pricePerExtraPhoto != null
      || studioRate;
    return !(hasOverride || hasTier) || !rateOk;
  });

  return {
    clientsMissingPricingTier: noTier.map((c) => ({ id: c.id, name: c.name })),
    clientsTierMissingExtraRate: tierNoRate.map((c) => ({
      id: c.id,
      name: c.name,
      packageName: c.package?.name || null,
    })),
    galleriesPricingIncomplete: incompleteGalleries.map((g) => ({
      id: g.id,
      name: g.name,
    })),
    counts: {
      clientsMissingTier: noTier.length,
      clientsTierMissingRate: tierNoRate.length,
      galleriesIncomplete: incompleteGalleries.length,
      total:
        noTier.length + tierNoRate.length + incompleteGalleries.length,
    },
  };
}

module.exports = {
  DEFAULT_EXTRA_PHOTO_PRICE,
  DEFAULT_RAW_PRICE: DEFAULT_EXTRA_PHOTO_PRICE,
  DEFAULT_EDITED_PRICE: DEFAULT_EXTRA_PHOTO_PRICE,
  effectivePricing,
  estimateSelection,
  resolveClientType,
  assessSelectionPricing,
  listPricingSetupGaps,
};
