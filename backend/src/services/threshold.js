const { prisma } = require('../config/prisma');

// Resolve face-match threshold: global env → studio PricingSettings → gallery override.
// FACE-PIPELINE-PLAN.md §3.
const resolveThreshold = async ({ studioId, galleryId } = {}) => {
  const global = parseFloat(process.env.FACE_MATCH_THRESHOLD || '95');
  let threshold = Number.isFinite(global) ? global : 95;
  let source = 'env';

  if (studioId) {
    const pricing = await prisma.pricingSettings.findUnique({ where: { studioId } });
    if (pricing?.faceSearchThreshold != null) {
      threshold = pricing.faceSearchThreshold;
      source = 'studio';
    }
  }

  if (galleryId) {
    const gallery = await prisma.eventGallery.findUnique({
      where: { id: galleryId },
      select: { faceSearchThreshold: true, studioId: true },
    });
    if (gallery?.faceSearchThreshold != null) {
      threshold = gallery.faceSearchThreshold;
      source = 'gallery';
    } else if (!studioId && gallery?.studioId) {
      return resolveThreshold({ studioId: gallery.studioId, galleryId });
    }
  }

  // Clamp to Rekognition-valid range.
  threshold = Math.min(99.9, Math.max(0, threshold));
  return { threshold, source };
};

// Result-quality tiers (FACE-PIPELINE-PLAN.md §6).
// ≥98 direct; 95–97.99 standard; < auto-threshold only via broader opt-in.
const HIGH_TIER = parseFloat(process.env.FACE_HIGH_TIER || '98');
const AUTO_THRESHOLD = parseFloat(process.env.FACE_MATCH_THRESHOLD || '95');
const BROADER_THRESHOLD = parseFloat(process.env.FACE_BROADER_THRESHOLD || '90');

const tierFor = (similarity) => {
  if (similarity >= HIGH_TIER) return 'high';
  if (similarity >= AUTO_THRESHOLD) return 'standard';
  if (similarity >= BROADER_THRESHOLD) return 'broad';
  return 'below';
};

module.exports = {
  resolveThreshold,
  tierFor,
  HIGH_TIER,
  AUTO_THRESHOLD,
  BROADER_THRESHOLD,
};
