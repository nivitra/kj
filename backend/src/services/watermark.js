const sharp = require('sharp');

const WORDMARK = process.env.WATERMARK_TEXT || 'SJ CLICKS';

const escapeXml = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Diagonal tiled wordmark + a crisper bottom-right mark, sized to the image.
// Baked into the pixels so a screenshot always carries the brand.
const buildOverlaySvg = (width, height, { tiled }) => {
  const text = escapeXml(WORDMARK);
  const diagFont = Math.max(18, Math.round(width * 0.03));
  const cornerFont = Math.max(12, Math.round(width * 0.022));
  const gapX = diagFont * 9;
  const gapY = diagFont * 7;

  let tiles = '';
  if (tiled) {
    for (let y = -gapY; y < height + gapY; y += gapY) {
      for (let x = -gapX; x < width + gapX; x += gapX) {
        tiles += `<text x="${x}" y="${y}" font-family="Georgia, 'Times New Roman', serif" font-size="${diagFont}" fill="#FFFFFF" fill-opacity="0.10" transform="rotate(-30 ${x} ${y})">${text}</text>`;
      }
    }
  }

  const pad = Math.round(width * 0.025);
  const corner = `<text x="${width - pad}" y="${height - pad}" text-anchor="end" font-family="Georgia, 'Times New Roman', serif" font-size="${cornerFont}" fill="#FFFFFF" fill-opacity="0.55" letter-spacing="2">${text}</text>`;

  return Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${tiles}${corner}</svg>`
  );
};

// Composite the wordmark onto a rendered image buffer.
// `tiled` = full diagonal tiling (used on display/preview); false = corner only.
const applyWatermark = async (buffer, { width, height, tiled }) => {
  const overlay = buildOverlaySvg(width, height, { tiled });
  return sharp(buffer).composite([{ input: overlay, top: 0, left: 0 }]).toBuffer();
};

module.exports = { applyWatermark, WORDMARK };
