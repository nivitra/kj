/**
 * Crop an image buffer to a normalized rectangle and emit WebP/JPEG.
 * Rect is { x, y, width, height } in 0–1 of the natural image (after EXIF rotate).
 */
const sharp = require('sharp');

function clamp01(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

function normalizeCrop(crop) {
  if (!crop || typeof crop !== 'object') return null;
  if (!['x', 'y', 'width', 'height'].every((key) => Number.isFinite(Number(crop[key])))) return null;
  const x = clamp01(crop.x);
  const y = clamp01(crop.y);
  const width = clamp01(crop.width);
  const height = clamp01(crop.height);
  if (width <= 0 || height <= 0 || x >= 1 || y >= 1) return null;
  return {
    x,
    y,
    width: Math.min(width, 1 - x),
    height: Math.min(height, 1 - y),
    aspect: crop.aspect != null ? Number(crop.aspect) : null,
  };
}

/**
 * @param {Buffer} buffer
 * @param {{ x:number, y:number, width:number, height:number }} crop
 * @param {{ maxWidth?: number, quality?: number, format?: 'webp'|'jpeg' }} [opts]
 */
async function cropBuffer(buffer, crop, opts = {}) {
  const rect = normalizeCrop(crop);
  if (crop != null && !rect) {
    const error = new Error('Choose a valid crop inside the image');
    error.status = 400;
    throw error;
  }
  const maxWidth = opts.maxWidth || 1920;
  const quality = opts.quality || 82;
  const format = opts.format || 'webp';
  // Materialize orientation before reading dimensions or extracting pixels.
  const oriented = await sharp(buffer).rotate().raw().toBuffer({ resolveWithObject: true });
  const w = oriented.info.width;
  const h = oriented.info.height;
  let img = sharp(oriented.data, { raw: oriented.info });
  if (!w || !h) {
    throw new Error('Could not read image size');
  }
  if (rect) {
    const left = Math.min(w - 1, Math.max(0, Math.round(rect.x * w)));
    const top = Math.min(h - 1, Math.max(0, Math.round(rect.y * h)));
    const width = Math.max(1, Math.round(rect.width * w));
    const height = Math.max(1, Math.round(rect.height * h));
    img = img.extract({
      left: Math.min(left, w - 1),
      top: Math.min(top, h - 1),
      width: Math.min(width, w - left),
      height: Math.min(height, h - top),
    });
  }
  img = img.resize(maxWidth, null, { withoutEnlargement: true, fit: 'inside' });
  if (format === 'jpeg') {
    return img.jpeg({ quality, mozjpeg: true }).toBuffer();
  }
  return img.webp({ quality, effort: 4 }).toBuffer();
}

module.exports = { cropBuffer, normalizeCrop };
