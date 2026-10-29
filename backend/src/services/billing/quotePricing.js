/**
 * Quotation pricing — single calculator for inquiry, quote, agreement, invoice.
 */
const { prisma } = require('../../config/prisma');
const { toPaise, fromPaise } = require('./money');

const DEFAULT_OPTIONS = [
  {
    code: 'STANDARD',
    title: 'Standard Package (Essential Coverage)',
    subtitle: 'Classic documentary flow with single-angle cinematic highlights.',
    recommended: false,
    displayOrder: 0,
    appAccessMonths: 3,
    deliveryWeeksMin: 4,
    deliveryWeeksMax: 5,
    price: 40000,
    crewJson: [
      { role: 'Cinematographer', count: 1, blurb: 'Single-camera creative framing and gimbal shots' },
      { role: 'Candid Photographer', count: 1, blurb: 'Natural candid moments and couple portraits' },
      { role: 'Traditional Photographer', count: 1, blurb: 'Stage portraits, family, and guest photos' },
      { role: 'Traditional Videographer', count: 1, blurb: 'Full continuous ceremony documentation' },
    ],
    deliverablesJson: [
      { title: 'Full HD (1080p) Traditional Documentary Film', spec: 'Classic single-angle continuous ritual coverage' },
      { title: '4K Cinematic Highlight Film', spec: '' },
      { title: 'Standard Color-Corrected High-Resolution Photographs', spec: '' },
      { title: 'Proprietary Studio App Access', spec: 'Active for 3 months' },
      { title: 'Complete RAW Data & Final Edits', spec: 'Transferred via client-provided SSD' },
    ],
  },
  {
    code: 'SIGNATURE',
    title: 'Signature Package (Recommended)',
    subtitle: 'Multi-camera film production with TV-serial / episodic quality finish.',
    recommended: true,
    displayOrder: 1,
    appAccessMonths: 6,
    deliveryWeeksMin: 2,
    deliveryWeeksMax: 3,
    price: 65000,
    crewJson: [
      { role: 'Cinematographers', count: 2, blurb: 'Dual cinema cameras: close-ups and wide gimbal shots' },
      { role: 'Senior Candid Photographer', count: 1, blurb: 'Magazine-grade candid frames' },
      { role: 'Traditional Photographer', count: 1, blurb: 'Family, guest, and stage documentation' },
      { role: 'Traditional 4K Videographer', count: 1, blurb: 'Dedicated continuous ceremony recording' },
    ],
    deliverablesJson: [
      { title: '4K Ultra HD Multi-Angle Full Documentary Film', spec: 'Merges cinema angles and traditional footage' },
      { title: '4K Cinematic Storytelling Highlight Film', spec: '' },
      { title: '1 Fast-Track 4K Social Media Reel', spec: '' },
      { title: 'Dedicated Wireless Lapel / Ambience Audio', spec: '' },
      { title: 'Magazine-Grade Fine-Art Retouching', spec: 'Selected couple portraits' },
      { title: 'Proprietary Studio App Access', spec: 'Extended to 6 months' },
      { title: 'Dual-Copy Redundant Cloud/Drive Backup', spec: '6 months' },
      { title: 'Complete RAW Data & Final Edits', spec: 'Transferred via client-provided SSD' },
    ],
  },
];

const DEFAULT_ADDONS = [
  {
    code: 'ALBUM',
    title: 'Custom Handcrafted Premium Photobook Album',
    price: 10000,
    displayOrder: 0,
    specsJson: [
      '20 Sheets / 40 Premium Flush-Mount Seamless Spreads',
      'Accommodates 80 to 100 curated photographs',
      'Velvet / Non-Tearable Laminated Archival Paper',
      'Luxury Hardbound Cover with Custom Embossing & Presentation Box',
    ],
  },
  {
    code: 'EXTRA_DAY',
    title: 'Extra coverage day',
    price: 25000,
    displayOrder: 1,
    specsJson: ['Additional shoot day with the selected package crew'],
  },
];

function mapOption(row) {
  if (!row) return null;
  return {
    id: row.id,
    code: row.code,
    title: row.title,
    subtitle: row.subtitle || '',
    recommended: !!row.recommended,
    crew: Array.isArray(row.crewJson) ? row.crewJson : [],
    deliverables: Array.isArray(row.deliverablesJson) ? row.deliverablesJson : [],
    appAccessMonths: row.appAccessMonths,
    deliveryWeeksMin: row.deliveryWeeksMin,
    deliveryWeeksMax: row.deliveryWeeksMax,
    price: Number(row.price || 0),
    servicePackageId: row.servicePackageId || null,
  };
}

function mapAddOn(row) {
  if (!row) return null;
  return {
    id: row.id,
    code: row.code,
    title: row.title,
    specs: Array.isArray(row.specsJson) ? row.specsJson : [],
    price: Number(row.price || 0),
  };
}

async function ensureCatalog(studioId) {
  const [packages, addOns, legacy] = await Promise.all([
    prisma.servicePackage.findMany({ where: { studioId, active: true }, include: { features: true }, orderBy: { displayOrder: 'asc' } }),
    prisma.quoteAddOn.findMany({ where: { studioId, active: true }, orderBy: { displayOrder: 'asc' } }),
    prisma.quoteOption.findMany({ where: { studioId, active: true }, orderBy: { displayOrder: 'asc' } }),
  ]);
  const options = packages.map((p) => ({ id: p.id, code: p.id, title: p.title, subtitle: p.description || '',
    price: Number(p.discountPrice ?? p.price), servicePackageId: p.id,
    includedPhotos: p.includedPhotos, pricePerExtraPhoto: p.pricePerExtraPhoto == null ? null : Number(p.pricePerExtraPhoto),
    workflowMode: p.workflowMode, details: p.details || {}, eventType: p.eventType, crew: p.details?.crew ? [{role:p.details.crew,count:1,blurb:''}] : [], deliverables: [...p.features.map((f) => ({ title: f.text || f.title || f.label || '', spec: '' })), ...(p.details?.deliverables ? [{title:p.details.deliverables,spec:p.details.deliveryTimeline || ''}] : [])],
  }));
  return { options: options.length ? options : legacy.map(mapOption), addOns: addOns.map(mapAddOn) };
}

function calculateQuote(catalog, input, taxPercent = 0) {
  const optionIds = Array.isArray(input.optionIds) ? [...new Set(input.optionIds)] : [];
  const options = catalog.options.filter((o) => optionIds.includes(o.id) || optionIds.includes(o.code));
  if (!optionIds.length) return { currency: 'INR', options: [], alternatives: [], lines: [], subtotal: 0, tax: 0, total: 0, taxPercent: Number(taxPercent) };
  if (!options.length || options.length !== optionIds.length) throw new Error('Choose available packages for this quotation');
  const extraDays = Number(input.extraDays ?? 0);
  if (!Number.isInteger(extraDays) || extraDays < 0 || extraDays > 366) throw new Error('Enter a valid number of extra coverage days');
  if (input.addOnIds != null && !Array.isArray(input.addOnIds)) throw new Error('Choose add-ons from the available list');
  const addOnIds = new Set(input.addOnIds || []);
  if (input.albumNeeded && input.addOnIds == null) {
    const album = catalog.addOns.find((a) => a.code === 'ALBUM');
    if (!album) throw new Error('Configure an album add-on before quoting an album');
    addOnIds.add(album.id);
  }
  if ([...addOnIds].some((id) => !catalog.addOns.some((a) => a.id === id || a.code === id))) throw new Error('One of the add-ons is unavailable');
  const extras = catalog.addOns.filter((a) => addOnIds.has(a.id) || addOnIds.has(a.code)).filter((a) => a.code !== 'EXTRA_DAY')
    .map((a) => ({ kind: 'ADDON', id: a.id, code: a.code, title: a.title, amount: a.price }));
  const selectedDay = catalog.addOns.find((a) => a.code === 'EXTRA_DAY' && (addOnIds.has(a.id) || addOnIds.has(a.code)));
  const chargedDays = extraDays || (selectedDay ? 1 : 0);
  if (chargedDays) {
    const day = catalog.addOns.find((a) => a.code === 'EXTRA_DAY');
    if (!day) throw new Error('Configure extra-day pricing before quoting multiple days');
    extras.push({ kind: 'ADDON', id: day.id, code: day.code, title: `${day.title} × ${chargedDays}`, amount: fromPaise(toPaise(day.price) * BigInt(chargedDays)) });
  }
  const rate = toPaise(taxPercent);
  if (rate < 0n || rate > 10000n) throw new Error('Invalid tax rate');
  const alternatives = options.map((o) => {
    const lines = [{ kind: 'OPTION', id: o.id, title: o.title, amount: o.price }, ...extras];
    if (lines.some((l) => toPaise(l.amount) < 0n)) throw new Error('Prices cannot be negative');
    const subtotal = lines.reduce((s, l) => s + toPaise(l.amount), 0n);
    const tax = (subtotal * rate + 5000n) / 10000n;
    return { optionId: o.id, title: o.title, lines, subtotal: fromPaise(subtotal), tax: fromPaise(tax), total: fromPaise(subtotal + tax) };
  });
  const chosen = alternatives.find((a) => a.optionId === input.selectedOptionId) || alternatives[0];
  return { currency: 'INR', options, alternatives, selectedOptionId: chosen.optionId, ...chosen, taxPercent: Number(taxPercent), comparison: alternatives.length > 1 };
}

async function computeQuote(input) {
  const catalog = await ensureCatalog(input.studioId);
  const profile = await prisma.studioProfile.findUnique({ where: { studioId: input.studioId } });
  return calculateQuote(catalog, input, profile?.taxPercent || 0);
}

function rupeesInWords(n) {
  const amount = toPaise(n || 0);
  const absolute = amount < 0n ? -amount : amount;
  const num = Number(absolute / 100n);
  const paise = Number(absolute % 100n);
  if (!num && !paise) return 'Zero Only';
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const chunk = (x) => {
    if (x >= 1000) return `${chunk(Math.floor(x / 1000))} Thousand${x % 1000 ? ` ${chunk(x % 1000)}` : ''}`;
    if (x >= 100) return `${ones[Math.floor(x / 100)]} Hundred${x % 100 ? ` ${chunk(x % 100)}` : ''}`;
    if (x < 20) return ones[x];
    return `${tens[Math.floor(x / 10)]}${x % 10 ? ` ${ones[x % 10]}` : ''}`.trim();
  };
  const crore = Math.floor(num / 10000000);
  const lakh = Math.floor((num % 10000000) / 100000);
  const thousand = Math.floor((num % 100000) / 1000);
  const hundred = Math.floor((num % 1000) / 100);
  const rest = num % 100;
  const parts = [];
  if (crore) parts.push(`${chunk(crore)} Crore`);
  if (lakh) parts.push(`${chunk(lakh)} Lakh`);
  if (thousand) parts.push(`${chunk(thousand)} Thousand`);
  if (hundred) parts.push(`${ones[hundred]} Hundred`);
  if (rest) parts.push(chunk(rest));
  const whole = parts.join(' ') || 'Zero';
  return `${amount < 0n ? 'Minus ' : ''}${whole}${paise ? ` Rupees and ${chunk(paise)} Paise` : ''} Only`;
}

module.exports = {
  ensureCatalog,
  calculateQuote,
  computeQuote,
  rupeesInWords,
  mapOption,
  mapAddOn,
};
