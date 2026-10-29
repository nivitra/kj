/**
 * One Package = marketing (ServicePackage) + selection pricing (ClientType mirror).
 * Admin only creates ServicePackages; ClientType is synced under the hood so
 * Customer.packageId / gallery.clientTypeId keep working for selection.
 */
const { prisma } = require('../config/prisma');

function slugify(name) {
  return String(name || 'package')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'package';
}

/**
 * Upsert ClientType mirror for a ServicePackage. Returns ClientType id.
 */
async function syncSelectionTierFromServicePackage(pkg) {
  if (!pkg?.id || !pkg.studioId) return null;
  const name = pkg.title || 'Package';
  const baseSlug = slugify(name);
  const included = pkg.includedPhotos != null ? Number(pkg.includedPhotos) : null;
  const extra = pkg.pricePerExtraPhoto != null ? Number(pkg.pricePerExtraPhoto) : null;
  const basePrice = Number(pkg.discountPrice != null ? pkg.discountPrice : pkg.price) || 0;
  let workflow = String(pkg.workflowMode || 'SELECT_ONLY').toUpperCase();
  if (!['SELECT_ONLY', 'SELECT_AND_DOWNLOAD', 'DOWNLOAD_ONLY'].includes(workflow)) {
    workflow = 'SELECT_ONLY';
  }

  let tier = null;
  if (pkg.selectionTierId) {
    tier = await prisma.clientType.findFirst({
      where: { id: pkg.selectionTierId, studioId: pkg.studioId },
    });
  }
  if (!tier) {
    tier = await prisma.clientType.findFirst({
      where: { studioId: pkg.studioId, slug: baseSlug },
    });
  }
  if (!tier) {
    // Unique slug if collision with different name
    let slug = baseSlug;
    let n = 0;
    while (await prisma.clientType.findFirst({ where: { studioId: pkg.studioId, slug } })) {
      n += 1;
      slug = `${baseSlug}-${n}`;
    }
    tier = await prisma.clientType.create({
      data: {
        studioId: pkg.studioId,
        name,
        slug,
        description: pkg.description || null,
        basePrice,
        includedPhotos: included,
        pricePerExtraPhoto: extra,
        workflowMode: workflow,
        active: pkg.active !== false,
        sortOrder: pkg.displayOrder || 0,
      },
    });
  } else {
    tier = await prisma.clientType.update({
      where: { id: tier.id },
      data: {
        name,
        description: pkg.description || null,
        basePrice,
        includedPhotos: included,
        pricePerExtraPhoto: extra,
        workflowMode: workflow,
        active: pkg.active !== false,
        sortOrder: pkg.displayOrder || 0,
      },
    });
  }

  if (pkg.selectionTierId !== tier.id) {
    await prisma.servicePackage.update({
      where: { id: pkg.id },
      data: { selectionTierId: tier.id },
    });
  }
  return tier;
}

/**
 * Ensure every ServicePackage has selection pricing + ClientType mirror.
 * Backfill from ClientTypes that have no matching ServicePackage (legacy).
 */
async function unifyPackagesForStudio(studioId) {
  const services = await prisma.servicePackage.findMany({ where: { studioId } });
  for (const sp of services) {
    // Fill defaults on service package if selection fields empty
    const needsFill =
      sp.includedPhotos == null
      || sp.pricePerExtraPhoto == null
      || !sp.workflowMode;
    if (needsFill) {
      await prisma.servicePackage.update({
        where: { id: sp.id },
        data: {
          includedPhotos: sp.includedPhotos ?? 20,
          pricePerExtraPhoto: sp.pricePerExtraPhoto ?? 350,
          workflowMode: sp.workflowMode || 'SELECT_ONLY',
        },
      });
    }
    const fresh = await prisma.servicePackage.findUnique({ where: { id: sp.id } });
    await syncSelectionTierFromServicePackage(fresh);
  }

  // Legacy ClientTypes → create ServicePackage if title not present
  const tiers = await prisma.clientType.findMany({ where: { studioId, active: true } });
  for (const tier of tiers) {
    const linked = await prisma.servicePackage.findFirst({
      where: { studioId, selectionTierId: tier.id },
    });
    if (linked) continue;
    const byTitle = await prisma.servicePackage.findFirst({
      where: { studioId, title: tier.name },
    });
    if (byTitle) {
      await prisma.servicePackage.update({
        where: { id: byTitle.id },
        data: {
          selectionTierId: tier.id,
          includedPhotos: byTitle.includedPhotos ?? tier.includedPhotos ?? 20,
          pricePerExtraPhoto: byTitle.pricePerExtraPhoto ?? tier.pricePerExtraPhoto ?? 350,
          workflowMode: byTitle.workflowMode || tier.workflowMode || 'SELECT_ONLY',
        },
      });
      continue;
    }
    await prisma.servicePackage.create({
      data: {
        studioId,
        title: tier.name,
        description: tier.description || null,
        price: Number(tier.basePrice || 0),
        active: tier.active,
        displayOrder: tier.sortOrder || 0,
        includedPhotos: tier.includedPhotos ?? 20,
        pricePerExtraPhoto: tier.pricePerExtraPhoto ?? 350,
        workflowMode: tier.workflowMode || 'SELECT_ONLY',
        selectionTierId: tier.id,
        bookingSteps: [
          { key: 'ENQUIRY_RECEIVED', label: 'Enquiry received', order: 0 },
          { key: 'BOOKING_CONFIRMED', label: 'Booking confirmed', order: 1 },
          { key: 'SHOOT_COMPLETED', label: 'Shoot completed', order: 2 },
          { key: 'EDITING', label: 'Editing', order: 3 },
          { key: 'READY_FOR_DELIVERY', label: 'Ready for delivery', order: 4 },
          { key: 'DELIVERED', label: 'Delivered', order: 5 },
        ],
      },
    });
  }

  return { ok: true };
}

/**
 * Assign one ServicePackage to a customer for booking + selection + invoices.
 */
async function assignServicePackageToCustomer({
  studioId,
  customerId,
  servicePackageId,
  galleryId = null,
  applyGalleryOverride = false,
  syncBooking = true,
  selectionLimit = null,
  extraPhotoPrice = null,
}) {
  const pkg = await prisma.servicePackage.findFirst({
    where: { id: servicePackageId, studioId },
  });
  if (!pkg) {
    const err = new Error('Package not found');
    err.status = 404;
    throw err;
  }

  const tier = await syncSelectionTierFromServicePackage(pkg);
  if (!tier) {
    const err = new Error('Could not sync selection pricing for package');
    err.status = 500;
    throw err;
  }

  await prisma.customer.update({
    where: { id: customerId },
    data: { packageId: tier.id },
  });

  if (applyGalleryOverride === 'all' || applyGalleryOverride === true && !galleryId) {
    const grants = await prisma.accessGrant.findMany({
      where: { customerId, gallery: { studioId, deletedAt: null } },
      select: { galleryId: true },
    });
    for (const g of grants) {
      await prisma.eventGallery.updateMany({
        where: { id: g.galleryId, studioId, clientTypeId: null, deletedAt: null },
        data: { clientTypeId: tier.id, pricingSnapshot: JSON.parse(JSON.stringify(pkg)) },
      });
    }
  }

  const { withBooking } = require('./bookingMutation');
  const { jobsFromBooking, isPlaceholderJobList, parseBookingSteps, serializeJob } = require('./bookingJobs');
  const { v4: uuidv4 } = require('uuid');
  if (syncBooking) await withBooking(prisma, studioId, customerId, async (tx, booking) => {
    let jobs = jobsFromBooking(booking);
    const placeholder = isPlaceholderJobList(booking, jobs);
    const matching = jobs.findIndex(j => j.packageId === pkg.id);
    const unassigned = jobs.length === 1 && !jobs[0].packageId;
    const index = matching >= 0 ? matching : (placeholder || unassigned ? 0 : -1);
    const old = index >= 0 ? jobs[index] : null;
    const now = new Date().toISOString();
    const packageSteps = parseBookingSteps(pkg.bookingSteps);
    const entry = { status: old?.status || packageSteps[0].key, at: now,
      note: `Package assigned: ${pkg.title}`, source: 'PACKAGE_ASSIGN' };
    const job = serializeJob({ ...old, id: old?.id || uuidv4(), packageId: pkg.id, packageTitle: pkg.title,
      source: old?.source || 'PACKAGE_ASSIGN', status: entry.status,
      steps: packageSteps, history: [...(old?.history || []), entry],
      createdAt: old?.createdAt || now, updatedAt: now });
    entry.jobId = job.id;
    if (placeholder) jobs = [job]; else if (index >= 0) jobs[index] = job; else jobs.push(job);
    const data = { servicePackageId: jobs[0].packageId, status: jobs[0].status,
      jobs, history: [...(Array.isArray(booking?.history) ? booking.history : []), entry] };
    return booking ? tx.customerBooking.update({ where: { id: booking.id }, data })
      : tx.customerBooking.create({ data: { studioId, customerId, ...data } });
  });

  let gallery = null;
  if (galleryId) {
    const g = await prisma.eventGallery.findFirst({
      where: { id: galleryId, studioId, deletedAt: null },
    });
    if (g) {
      const gData = { clientTypeId: tier.id, pricingSnapshot: JSON.parse(JSON.stringify(pkg)) };
      if (applyGalleryOverride) {
        if (selectionLimit != null && selectionLimit !== '') {
          gData.selectionLimit = Math.max(0, parseInt(selectionLimit, 10) || 0);
        }
        if (extraPhotoPrice != null && extraPhotoPrice !== '') {
          gData.extraPhotoPrice = Number(extraPhotoPrice);
        }
      }
      gallery = await prisma.eventGallery.update({ where: { id: g.id }, data: gData });
    }
  }

  const price = Number(pkg.discountPrice != null ? pkg.discountPrice : pkg.price) || 0;
  const included = pkg.includedPhotos ?? tier.includedPhotos ?? 20;
  const extra = Number(pkg.pricePerExtraPhoto ?? tier.pricePerExtraPhoto ?? 350);

  return {
    servicePackage: {
      id: pkg.id,
      title: pkg.title,
      price,
      includedPhotos: included,
      pricePerExtraPhoto: extra,
      workflowMode: pkg.workflowMode || 'SELECT_ONLY',
    },
    selectionTier: {
      id: tier.id,
      name: tier.name,
      includedPhotos: tier.includedPhotos,
      pricePerExtraPhoto: Number(tier.pricePerExtraPhoto),
    },
    gallery: gallery
      ? {
          id: gallery.id,
          name: gallery.name,
          selectionLimit: gallery.selectionLimit,
          extraPhotoPrice: gallery.extraPhotoPrice != null ? Number(gallery.extraPhotoPrice) : null,
        }
      : null,
    preview: {
      packageName: pkg.title,
      includedPhotos: included,
      pricePerExtraPhoto: extra,
      basePrice: price,
      clientBannerExample:
        `You've selected ${included + 1} photos (${included} included). `
        + `You can keep selecting — each extra photo is ₹${extra.toLocaleString('en-IN')}.`,
    },
  };
}

/**
 * Link a ServicePackage onto a gallery (sets ClientType mirror).
 */
async function assignServicePackageToGallery({
  studioId,
  galleryId,
  servicePackageId,
  applyOverride = false,
  selectionLimit = null,
  extraPhotoPrice = null,
}) {
  const pkg = await prisma.servicePackage.findFirst({
    where: { id: servicePackageId, studioId },
  });
  if (!pkg) {
    const err = new Error('Package not found');
    err.status = 404;
    throw err;
  }
  const gallery = await prisma.eventGallery.findFirst({
    where: { id: galleryId, studioId, deletedAt: null },
  });
  if (!gallery) {
    const err = new Error('Gallery not found');
    err.status = 404;
    throw err;
  }
  const tier = await syncSelectionTierFromServicePackage(pkg);
  const data = { clientTypeId: tier.id, pricingSnapshot: JSON.parse(JSON.stringify(pkg)) };
  if (applyOverride) {
    if (selectionLimit != null && selectionLimit !== '') {
      data.selectionLimit = Math.max(0, parseInt(selectionLimit, 10) || 0);
    }
    if (extraPhotoPrice != null && extraPhotoPrice !== '') {
      data.extraPhotoPrice = Number(extraPhotoPrice);
    }
  }
  return prisma.eventGallery.update({ where: { id: gallery.id }, data });
}

async function packageUsage(studioId, pkg) {
  const tierId = pkg.selectionTierId || null;
  const [leads, bookings, invoices, quoteOptions, customers, galleries] = await Promise.all([
    prisma.lead.count({ where: { packageId: pkg.id } }),
    prisma.customerBooking.count({ where: { servicePackageId: pkg.id } }),
    prisma.invoice.count({ where: { packageId: pkg.id } }),
    prisma.quoteOption.count({ where: { servicePackageId: pkg.id } }),
    tierId
      ? prisma.customer.count({
          where: { studioId, OR: [{ packageId: tierId }, { requestedPackageId: tierId }] },
        })
      : 0,
    tierId
      ? prisma.eventGallery.count({ where: { studioId, clientTypeId: tierId } })
      : 0,
  ]);
  const total = leads + bookings + invoices + quoteOptions + customers + galleries;
  return { leads, bookings, invoices, quoteOptions, customers, galleries, total };
}

/**
 * Delete unused packages. Archive (hide from app) when anything still points at them.
 * Never zeroes the price.
 */
async function deleteOrArchiveServicePackage({ studioId, packageId }) {
  const pkg = await prisma.servicePackage.findFirst({
    where: { id: packageId, studioId },
    include: { features: true },
  });
  if (!pkg) {
    const err = new Error('Package not found');
    err.status = 404;
    throw err;
  }
  const usage = await packageUsage(studioId, pkg);

  if (usage.total > 0) {
    await prisma.servicePackage.update({
      where: { id: pkg.id },
      data: { active: false },
    });
    if (pkg.selectionTierId) {
      await prisma.clientType.updateMany({
        where: { id: pkg.selectionTierId, studioId },
        data: { active: false },
      });
    }
    return {
      action: 'archived',
      deleted: false,
      archived: true,
      usage,
      message: `Hidden from the client app. Still linked to ${usage.total} record${usage.total === 1 ? '' : 's'} (price kept).`,
    };
  }

  const tierId = pkg.selectionTierId;
  await prisma.servicePackageFeature.deleteMany({ where: { packageId: pkg.id } });
  await prisma.servicePackage.delete({ where: { id: pkg.id } });
  if (tierId) {
    const stillLinked = await prisma.servicePackage.count({
      where: { studioId, selectionTierId: tierId },
    });
    if (!stillLinked) {
      const leftover = await packageUsage(studioId, { id: pkg.id, selectionTierId: tierId });
      if (leftover.customers === 0 && leftover.galleries === 0) {
        await prisma.clientType.deleteMany({ where: { id: tierId, studioId } });
      } else {
        await prisma.clientType.updateMany({
          where: { id: tierId, studioId },
          data: { active: false },
        });
      }
    }
  }
  return {
    action: 'deleted',
    deleted: true,
    archived: false,
    usage,
    message: 'Package removed from admin and the client app.',
  };
}

function packagePriceLabel(pkg) {
  const price = Number(pkg.discountPrice != null ? pkg.discountPrice : pkg.price) || 0;
  return price > 0
    ? `₹${price.toLocaleString('en-IN')} onwards`
    : 'Contact for price';
}

module.exports = {
  slugify,
  syncSelectionTierFromServicePackage,
  unifyPackagesForStudio,
  assignServicePackageToCustomer,
  assignServicePackageToGallery,
  packageUsage,
  deleteOrArchiveServicePackage,
  packagePriceLabel,
};
