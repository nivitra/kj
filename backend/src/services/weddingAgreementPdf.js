/**
 * Professional Wedding Photography Quotation / Service Agreement PDF.
 * Layout is continuous with ensureSpace() - avoids accidental blank pages.
 */
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const SCOPE_LABELS = {
  traditional_photographer: 'Traditional Photographer',
  candid_photographer: 'Candid Photographer',
  traditional_videographer: 'Traditional Videographer',
  cinematic_videographer: 'Cinematographer',
  drone: 'Drone',
  same_day_edit: 'Same-day Edit',
  live_stream: 'Live Streaming',
  album_design: 'Album Design',
  photo_booth: 'Photo Booth',
  custom: 'Custom',
};

const DELIVERABLE_CATALOG = [
  {
    id: 'traditional_documentary_film',
    title: 'Traditional Documentary Film',
    description:
      'A complete, long-format cinematic record of the wedding ceremonies, capturing all rituals and events in a chronological sequence with professional high-quality audio and video.',
  },
  {
    id: 'cinematic_highlight_film',
    title: 'Cinematic Highlight Film',
    description:
      'A creatively edited, high-definition short film featuring the best moments of the wedding, professionally color-graded.',
  },
  {
    id: 'edited_couple_photos',
    title: 'Selected Edited Couple Photographs',
    description:
      'A premium collection of artistic, high-end edited portraits of the couple, focusing on aesthetics, lighting, and specialized post-processing.',
  },
  {
    id: 'color_corrected_photos',
    title: 'Selected Color-Corrected Photographs',
    description:
      'A curated set of high-resolution images, individually color-corrected and enhanced to ensure a consistent and professional look across the event.',
    defaultQty: '350',
    qtyLabel: 'Number of photos',
  },
  {
    id: 'social_media_reels',
    title: 'Social Media Reels',
    description:
      'Professionally edited vertical short-form videos (Reels), optimized for platforms like Instagram and Facebook, capturing the trendiest highlights of the celebration.',
    defaultQty: '3',
    qtyLabel: 'Number of reels',
  },
  {
    id: 'raw_data_transfer',
    title: 'Raw Data Transfer',
    description:
      'All unedited (Raw) photos and video footage will be provided to the Client. Note: As per the logistics clause, the Client must provide their own External Hard Drive or SSD for this transfer.',
  },
];

const TIMELINE_CATALOG = [
  {
    id: 'sneak_peek',
    title: 'Preview / Sneak Peek',
    defaultTimeframe: '2-3 days after the event',
    description: 'A selection of 10-15 "best of" images shared for social media.',
  },
  {
    id: 'raw_handover',
    title: 'Raw Data Handover',
    defaultTimeframe: 'When client visits the studio after the event',
    description: 'All raw photos and video transferred to the Client\'s Hard Drive / SSD.',
  },
  {
    id: 'selection_process',
    title: 'Selection Process',
    defaultTimeframe: 'Within 15 days of receiving the full set',
    description: 'Client selects images for color correction / editing.',
  },
  {
    id: 'final_photos',
    title: 'Final Edited Photos',
    defaultTimeframe: '30-45 days after selection',
    description: 'Color-corrected and edited couple portraits delivered.',
  },
  {
    id: 'highlight_film',
    title: 'Cinematic Highlight Film',
    defaultTimeframe: '20 working days from the event',
    description: 'High-definition creatively edited highlight film.',
  },
  {
    id: 'social_reels',
    title: 'Social Media Reels',
    defaultTimeframe: '7-10 working days',
    description: 'Professionally edited reels for immediate social sharing.',
  },
  {
    id: 'documentary_film',
    title: 'Documentary Film',
    defaultTimeframe: '60-90 days from the event',
    description: 'Full traditional / documentary film delivery.',
  },
];

const RESPONSIBILITY_CATALOG = [
  {
    id: 'professional_conduct',
    title: 'Professional Conduct',
    description:
      'The Photographer and the entire team shall maintain professional decorum, dressing appropriately for the event and interacting respectfully with all guests and family members.',
  },
  {
    id: 'creative_excellence',
    title: 'Creative Excellence',
    description:
      'The Photographer will use professional expertise, high-quality equipment, and artistic judgment to capture the event in the best possible manner.',
  },
  {
    id: 'equipment_backup',
    title: 'Equipment Backup',
    description:
      'The Photographer shall carry backup camera bodies, lenses, and flash units to ensure the shoot continues uninterrupted in case of equipment failure.',
  },
  {
    id: 'data_safety',
    title: 'Data Safety',
    description:
      'During the event, the Photographer will use dual-slot memory cards (where possible) to ensure an immediate backup of all captured photos and videos.',
  },
  {
    id: 'time_management',
    title: 'Time Management',
    description:
      'The team will arrive at the venue at the agreed-upon reporting time to set up equipment and begin coverage as per the itinerary.',
  },
  {
    id: 'quality_control',
    title: 'Quality Control',
    description:
      'Every deliverable will undergo a quality check for color, sound, and editing before being shared with the Client.',
  },
  {
    id: 'adherence_timeline',
    title: 'Adherence to Timeline',
    description:
      'The Photographer is responsible for meeting all delivery deadlines, provided client obligations (selections, music, payments) are met.',
  },
];

const DEFAULT_WHY_US = [
  'Experienced photographers & cinematographers',
  'High-end equipment & professional workflow',
  'On-time delivery of edited content',
  'Creative storytelling with emotional depth',
  'Dedicated team coordination for every event',
];

// -- Layout helpers ---------------------------------------------------------

// bottom margin kept small so we can draw a footer band ourselves without
// PDFKit thinking footer text is "overflow" (which was creating blank pages).
const M = { top: 48, bottom: 36, left: 48, right: 48 };
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const CONTENT_W = PAGE_W - M.left - M.right;
const LEFT = M.left;
const FOOTER_Y = PAGE_H - 28;

const C = {
  ink: '#1A1917',
  ink2: '#5C574F',
  ink3: '#8A847A',
  gold: '#9A7B4F',
  line: '#E4DFD4',
  lineSoft: '#EFEBE3',
  paper: '#FBFAF8',
  white: '#FFFFFF',
  soft: '#F6F2EA',
};

function money(n, currency = 'INR') {
  if (n == null || n === '') return '-';
  const num = Number(n);
  if (Number.isNaN(num)) return String(n);
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: currency || 'INR',
      maximumFractionDigits: 0,
    }).format(num);
  } catch {
    return `${currency} ${num.toLocaleString('en-IN')}`;
  }
}

function fmtDate(d) {
  if (!d) return '';
  if (typeof d === 'string' && /^\d{2}\/\d{2}\/\d{4}/.test(d)) return d;
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return String(d);
  return dt.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function loadLogoBuffer(explicit) {
  if (Buffer.isBuffer(explicit)) return explicit;
  const candidates = [
    explicit,
    path.join(__dirname, '../../assets/logo-square.png'),
    path.join(__dirname, '../../assets/logo.png'),
    path.join(__dirname, '../../../admin-dashboard/public/logo-square.png'),
    path.join(__dirname, '../../../admin-dashboard/public/logo.png'),
  ].filter(Boolean);
  for (const p of candidates) {
    try {
      if (typeof p === 'string' && fs.existsSync(p)) return fs.readFileSync(p);
    } catch (_) { /* next */ }
  }
  return null;
}

function createLayout(doc) {
  const state = { page: 1 };

  /** Usable bottom Y - leave a band for the footer inside the page margin. */
  function contentBottom() {
    return FOOTER_Y - 16;
  }

  /**
   * Stamp footers after full layout via switchToPage (needs bufferPages: true).
   * Drawing footers mid-layout made PDFKit insert blank pages.
   */
  function stampFooters() {
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      const savedBottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 16;
      const y = FOOTER_Y;
      doc.save();
      doc.strokeColor(C.lineSoft).lineWidth(0.6)
        .moveTo(LEFT, y - 10).lineTo(LEFT + CONTENT_W, y - 10).stroke();
      doc.font('Helvetica').fontSize(7.5).fillColor(C.ink3);
      doc.text('SJ Clicks & Films | Confidential client agreement', LEFT, y, {
        width: CONTENT_W - 50,
        lineBreak: false,
      });
      doc.text(String(i + 1), LEFT + CONTENT_W - 40, y, {
        width: 40,
        align: 'right',
        lineBreak: false,
      });
      doc.restore();
      doc.page.margins.bottom = savedBottom;
    }
  }

  function newPage() {
    doc.addPage({ size: 'A4', margins: M });
    state.page += 1;
    doc.x = LEFT;
    doc.y = M.top;
  }

  /**
   * Ensure room for `h` points. Caps request so we never blank-page when h is huge -
   * long text is allowed to flow naturally across pages via PDFKit.
   */
  function ensureSpace(h) {
    const need = Math.min(Math.max(h, 0), 100);
    if (doc.y + need > contentBottom()) newPage();
  }

  /** Keep x aligned only. */
  function clampFlow() {
    doc.x = LEFT;
  }

  function hr(color = C.line, w = 0.8) {
    ensureSpace(12);
    const y = doc.y + 2;
    doc.strokeColor(color).lineWidth(w)
      .moveTo(LEFT, y).lineTo(LEFT + CONTENT_W, y).stroke();
    doc.y = y + 8;
    doc.x = LEFT;
  }

  function section(title) {
    ensureSpace(40);
    doc.moveDown(0.4);
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(C.gold)
      .text(String(title).toUpperCase(), LEFT, doc.y, {
        characterSpacing: 1.15,
        width: CONTENT_W,
      });
    doc.moveDown(0.12);
    hr(C.gold, 1.1);
  }

  function para(text, opts = {}) {
    if (text == null || text === '') return;
    const size = opts.size || 9.5;
    const gap = opts.lineGap ?? 2.2;
    const font = opts.bold ? 'Helvetica-Bold' : 'Helvetica';
    const color = opts.color || C.ink;
    // Only need room for the first line; rest wraps / pages naturally
    ensureSpace(size + gap + 8);
    doc.font(font).fontSize(size).fillColor(color)
      .text(String(text), LEFT, doc.y, {
        width: CONTENT_W,
        align: opts.align || 'left',
        lineGap: gap,
      });
    clampFlow();
    if (opts.after != null) doc.moveDown(opts.after);
    else doc.moveDown(0.22);
  }

  function kv(label, value) {
    if (value == null || value === '' || (Array.isArray(value) && !value.length)) return;
    const v = Array.isArray(value) ? value.join(', ') : String(value);
    ensureSpace(28);
    doc.font('Helvetica-Bold').fontSize(8).fillColor(C.ink3)
      .text(label, LEFT, doc.y, { width: CONTENT_W });
    doc.font('Helvetica').fontSize(10).fillColor(C.ink)
      .text(v, LEFT, doc.y, { width: CONTENT_W });
    clampFlow();
    doc.moveDown(0.25);
    doc.x = LEFT;
  }

  function bullet(text, opts = {}) {
    if (!text) return;
    ensureSpace(18);
    const indent = opts.indent || 0;
    const textX = LEFT + indent + 12;
    const y = doc.y;
    doc.circle(LEFT + indent + 2.5, y + 5, 1.6).fill(C.gold);
    doc.font('Helvetica').fontSize(opts.size || 9.5).fillColor(opts.color || C.ink)
      .text(String(text), textX, y, {
        width: CONTENT_W - (textX - LEFT),
        lineGap: 1.6,
      });
    clampFlow();
    doc.moveDown(0.1);
    doc.x = LEFT;
  }

  return {
    ensureSpace,
    newPage,
    stampFooters,
    clampFlow,
    hr,
    section,
    para,
    kv,
    bullet,
    contentBottom,
    state,
  };
}

function normalizeService(entry) {
  if (typeof entry === 'string') return { id: entry, count: 1 };
  if (entry && typeof entry === 'object') {
    return {
      id: entry.id || entry.serviceId || 'custom',
      count: Math.max(1, parseInt(entry.count || entry.qty || 1, 10) || 1),
      label: entry.label || entry.customLabel || '',
    };
  }
  return null;
}

function serviceLabel(s, day) {
  if (!s) return '';
  const base =
    s.id === 'custom'
      ? (s.label || day?.customService || 'Custom')
      : (SCOPE_LABELS[s.id] || s.id);
  const count = Math.max(1, Number(s.count) || 1);
  // Always show count so crew size is explicit (e.g. "2 x Candid Photographer")
  return count > 1 ? `${count} x ${base}` : base;
}

/**
 * @param {object} form
 * @param {object} meta - studioName, customerName, title, agreementId, finalizedAt, logoBuffer/logoPath, studioPhone, studioEmail, studioAddress, studioWebsite
 */
function buildWeddingAgreementPdf(form, meta = {}) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margins: M,
        autoFirstPage: true,
        bufferPages: true, // required so we can stamp footers after layout
        info: {
          Title: meta.title || form.documentTitle || 'Wedding Photography Quotation',
          Author: meta.studioName || form.studioName || 'SJ Clicks & Films',
        },
      });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const L = createLayout(doc);
      const studio = meta.studioName || form.studioName || 'SJ Clicks & Films';
      const currency = form.currency || 'INR';
      const agreementDate = fmtDate(form.agreementDate || meta.finalizedAt || new Date());
      const days = Array.isArray(form.days) ? form.days : [];
      const logo = loadLogoBuffer(meta.logoBuffer || meta.logoPath);

      // -- HEADER ----------------------------------------------------------
      const headerTop = M.top;
      if (logo) {
        try {
          doc.image(logo, LEFT, headerTop, { fit: [52, 52] });
        } catch (_) { /* ignore bad image */ }
      }

      const textLeft = logo ? LEFT + 62 : LEFT;
      doc.font('Helvetica-Bold').fontSize(16).fillColor(C.ink)
        .text(studio, textLeft, headerTop + 4, { width: CONTENT_W - (logo ? 62 : 0) });
      doc.font('Helvetica').fontSize(8.5).fillColor(C.gold)
        .text('WEDDING PHOTOGRAPHY QUOTATION', textLeft, doc.y + 2, {
          characterSpacing: 1.3,
          width: CONTENT_W - (logo ? 62 : 0),
        });
      doc.font('Helvetica').fontSize(8).fillColor(C.ink3)
        .text(
          `Ref ${(meta.agreementId || '').slice(0, 8).toUpperCase() || 'DRAFT'}  |  ${agreementDate}`,
          textLeft,
          doc.y + 3,
          { width: CONTENT_W - (logo ? 62 : 0) },
        );

      doc.y = Math.max(doc.y, headerTop + 56) + 6;
      doc.x = LEFT;
      L.hr(C.ink, 1.2);

      // Intro
      const dayCount = days.length || form.coverageDays || '';
      const intro =
        form.introText ||
        (dayCount
          ? `Here's a detailed ${dayCount}-day wedding photography quotation. This agreement is made on this ${agreementDate}.`
          : `This wedding photography quotation / agreement is made on this ${agreementDate}.`);
      L.para(intro, { size: 10, lineGap: 3, after: 0.45 });
      L.para(
        'This agreement is entered into between the Client and the Photographer (Service Provider) for the event and package described below.',
        { size: 9.5, color: C.ink2, after: 0.5 },
      );

      // -- PARTIES (flow layout - avoids absolute-Y blank pages) -----------
      L.section('The parties');

      L.para('THE CLIENT', { size: 8, bold: true, color: C.gold, after: 0.15 });
      L.kv('Name', form.clientName || meta.customerName);
      L.kv('Address', form.billingAddress);
      L.kv('Phone', form.clientPhone);
      L.kv('Email', form.clientEmail);
      L.kv('Partner', form.partnerName);
      L.kv('Event dates', form.eventDatesLabel || form.eventDate);

      L.para('THE PHOTOGRAPHER (SERVICE PROVIDER)', { size: 8, bold: true, color: C.gold, after: 0.15 });
      L.kv('Studio', studio);
      L.kv('Address', form.studioAddress || meta.studioAddress);
      L.kv('Phone', form.studioPhone || meta.studioPhone);
      L.kv('Email', form.studioEmail || meta.studioEmail);
      L.kv('Website', form.studioWebsite || meta.studioWebsite);

      // -- WEDDING EVENTS ---------------------------------------------------
      L.section('Wedding events details');
      L.kv('Wedding event dates', form.eventDatesLabel || form.eventDate || days.map((d) => d.date).filter(Boolean).join(' & '));
      L.kv('Main ceremony date', form.mainCeremonyDate || form.eventDate);
      L.kv('Wedding venue', form.primaryVenue);
      L.kv('City', form.eventCity);
      L.kv('Additional venues', form.additionalVenues);
      L.kv('Estimated guests', form.guestCount);
      L.kv('Event type', form.eventType || 'Wedding');

      // -- SCOPE OF SERVICES -----------------------------------------------
      L.section('Scope of services');
      L.para(
        form.scopeIntro ||
          `The Photographer will provide the following photography services over the course of ${dayCount || days.length || 'the agreed'} day(s).`,
        { size: 9.5, color: C.ink2, after: 0.4 },
      );

      if (days.length) {
        days.forEach((day, idx) => {
          L.ensureSpace(50);
          const label = day.label || `Day ${day.dayNumber || idx + 1}`;
          L.para(label, { size: 11, bold: true, color: C.ink, after: 0.1 });

          const metaBits = [
            day.date && `Date: ${fmtDate(day.date)}`,
            (day.startTime || day.endTime) && `Time: ${[day.startTime, day.endTime].filter(Boolean).join(' - ')}`,
            day.venue && `Venue: ${day.venue}`,
          ].filter(Boolean);
          if (metaBits.length) L.para(metaBits.join('   |   '), { size: 8.5, color: C.ink3, after: 0.15 });

          const rawServices = Array.isArray(day.services) ? day.services : [];
          const services = rawServices.map(normalizeService).filter(Boolean);
          if (services.length) {
            services.forEach((s) => {
              const text = serviceLabel(s, day).toUpperCase();
              L.bullet(text, { size: 9.5 });
            });
          } else {
            L.para('Services as agreed with the studio.', { size: 9, color: C.ink3 });
          }
          if (day.notes) L.para(`Notes: ${day.notes}`, { size: 8.5, color: C.ink2, after: 0.3 });
          else doc.moveDown(0.2);
        });
      } else {
        const scope = Array.isArray(form.scopeServices) ? form.scopeServices : [];
        scope.forEach((k) => {
          const s = normalizeService(k);
          if (!s) return;
          const label = s.id === 'custom' && form.scopeCustom
            ? form.scopeCustom
            : (SCOPE_LABELS[s.id] || s.id);
          L.bullet(label);
        });
      }
      if (form.scopeNotes) L.kv('Crew / logistics notes', form.scopeNotes);

      // -- DELIVERABLES ----------------------------------------------------
      L.section('Deliverables & scope of work');
      L.para(
        'The Photographer/Studio agrees to deliver the following items as part of the final package:',
        { size: 9.5, color: C.ink2, after: 0.4 },
      );

      const selectedDeliverables = Array.isArray(form.deliverables) ? form.deliverables : [];
      const catalogById = Object.fromEntries(DELIVERABLE_CATALOG.map((d) => [d.id, d]));

      if (selectedDeliverables.length) {
        selectedDeliverables.forEach((item, i) => {
          L.ensureSpace(36);
          const id = typeof item === 'string' ? item : item.id;
          const qty = typeof item === 'object' ? item.qty : null;
          const customTitle = typeof item === 'object' ? item.customTitle : null;
          const customDesc = typeof item === 'object' ? item.customDescription : null;
          const cat = catalogById[id];

          let title = customTitle || cat?.title || id;
          if (qty && cat?.id === 'color_corrected_photos') {
            title = `Selected Color-Corrected Photographs (${qty} Nos.)`;
          } else if (qty && cat?.id === 'social_media_reels') {
            title = `Social Media Reels (${qty} Nos.)`;
          } else if (qty && String(id).startsWith('custom')) {
            title = `${title}${qty ? ` (${qty})` : ''}`;
          }

          const desc = customDesc || cat?.description || '';
          L.para(`${i + 1}.  ${title}`, { size: 10, bold: true, color: C.ink, after: 0.08 });
          if (desc) L.para(desc, { size: 9, color: C.ink2, align: 'justify', after: 0.35 });
        });
      } else {
        L.para('Deliverables as agreed with the studio.', { color: C.ink3 });
      }
      if (form.otherDeliverables) L.kv('Additional deliverable notes', form.otherDeliverables);
      if (form.deliveryMethod) L.kv('Delivery method', form.deliveryMethod);

      // -- DELIVERY TIMELINE -----------------------------------------------
      L.section('Delivery timeline & process');
      L.para(
        'The Photographer/Studio shall follow the delivery schedule as outlined below:',
        { size: 9.5, color: C.ink2, after: 0.35 },
      );

      const timelineItems = Array.isArray(form.timelineItems) ? form.timelineItems : [];
      const timelineById = Object.fromEntries(TIMELINE_CATALOG.map((t) => [t.id, t]));

      if (timelineItems.length) {
        timelineItems.forEach((item) => {
          L.ensureSpace(36);
          const id = typeof item === 'string' ? item : item.id;
          const cat = timelineById[id];
          const title = (typeof item === 'object' && item.title) || cat?.title || id;
          const timeframe = (typeof item === 'object' && item.timeframe) || cat?.defaultTimeframe || '';
          const desc = (typeof item === 'object' && item.description) || cat?.description || '';

          L.para(title, { size: 9.5, bold: true, color: C.ink, after: 0.05 });
          if (timeframe) L.para(timeframe, { size: 8.5, bold: true, color: C.gold, after: 0.05 });
          if (desc) L.para(desc, { size: 8.5, color: C.ink2, after: 0.3 });
        });
      } else if (form.deliveryTimeline) {
        L.para(form.deliveryTimeline, { size: 9.5 });
      } else {
        L.para('Timeline as agreed with the studio.', { color: C.ink3 });
      }

      // -- RESPONSIBILITIES ------------------------------------------------
      L.section('Photographer\'s responsibilities');
      L.para(
        'The Photographer and their team commit to the following professional standards:',
        { size: 9.5, color: C.ink2, after: 0.35 },
      );

      const responsibilities = Array.isArray(form.responsibilities) ? form.responsibilities : [];
      const respById = Object.fromEntries(RESPONSIBILITY_CATALOG.map((r) => [r.id, r]));

      if (responsibilities.length) {
        responsibilities.forEach((item) => {
          L.ensureSpace(36);
          const id = typeof item === 'string' ? item : item.id;
          const cat = respById[id];
          const title = (typeof item === 'object' && item.title) || cat?.title || id;
          const desc = (typeof item === 'object' && item.description) || cat?.description || '';
          L.para(title, { size: 9.5, bold: true, color: C.ink, after: 0.08 });
          if (desc) L.para(desc, { size: 9, color: C.ink2, align: 'justify', after: 0.3 });
        });
      } else {
        RESPONSIBILITY_CATALOG.forEach((r) => {
          L.ensureSpace(36);
          L.para(r.title, { size: 9.5, bold: true, color: C.ink, after: 0.08 });
          L.para(r.description, { size: 9, color: C.ink2, align: 'justify', after: 0.3 });
        });
      }

      // -- PACKAGE COST ----------------------------------------------------
      L.section('Total package cost');
      L.ensureSpace(70);
      L.para('TOTAL PACKAGE FEE', { size: 8, bold: true, color: C.ink3, after: 0.1 });
      L.para(money(form.totalFee, currency), { size: 18, bold: true, color: C.ink, after: 0.1 });
      if (form.totalFeeInWords) {
        L.para(`(${form.totalFeeInWords})`, { size: 9.5, color: C.ink2, after: 0.25 });
      }
      L.para(
        form.costIncludesText ||
          'Includes complete team charges, equipment, and post-production.',
        { size: 9.5, color: C.ink2, after: 0.25 },
      );

      const travel = form.travelIncluded; // yes | no | partial
      const stay = form.stayIncluded; // yes | no
      const includeBits = [];
      if (travel === 'yes' || travel === true) includeBits.push('Travelling: Included');
      else if (travel === 'partial') includeBits.push('Travelling: Partially included');
      else if (travel === 'no' || travel === false) includeBits.push('Travelling: Excluded');
      if (stay === 'yes' || stay === true) includeBits.push('Stay: Included');
      else if (stay === 'no' || stay === false) includeBits.push('Stay: Excluded');
      if (includeBits.length) {
        L.para(includeBits.join('   |   '), { size: 9.5, bold: true, color: C.ink, after: 0.25 });
      }
      if (form.travelNotes) L.kv('Travel / stay notes', form.travelNotes);

      L.kv('Advance / booking fee', form.advanceFee !== '' && form.advanceFee != null ? money(form.advanceFee, currency) : null);
      L.kv('Amount paid to date', form.amountPaid !== '' && form.amountPaid != null ? money(form.amountPaid, currency) : null);
      L.kv('Balance due', form.balanceDue !== '' && form.balanceDue != null ? money(form.balanceDue, currency) : null);
      L.kv('Balance due date', form.balanceDueDate ? fmtDate(form.balanceDueDate) : null);
      L.kv('Payment method', form.paymentMethod);
      L.kv('Payment schedule / terms', form.paymentTermsText);
      L.kv('Extra hour rate', form.extraHourRate !== '' && form.extraHourRate != null ? money(form.extraHourRate, currency) : null);

      // -- WHY CHOOSE US ---------------------------------------------------
      const why = Array.isArray(form.whyChooseUs) && form.whyChooseUs.length
        ? form.whyChooseUs
        : DEFAULT_WHY_US;
      if (why.length) {
        L.section('Why choose us');
        why.forEach((w) => L.bullet(w));
      }

      // -- CONTACT ---------------------------------------------------------
      L.section('Contact details');
      L.kv('Studio', form.studioSignatory || studio);
      L.kv('Phone', form.studioPhone || meta.studioPhone || form.contactPhone);
      L.kv('Email', form.studioEmail || meta.studioEmail || form.contactEmail);
      L.kv('Website', form.studioWebsite || meta.studioWebsite);

      // -- GENERAL TERMS ---------------------------------------------------
      L.section('General terms');
      const { resolvePaymentTerms } = require('./studioTerms');
      const defaultTerms = form.generalTerms || resolvePaymentTerms(null, null);
      L.para(defaultTerms, { size: 9, color: C.ink2, lineGap: 2.5, align: 'justify' });
      if (form.specialConditions) L.kv('Special conditions', form.specialConditions);

      // -- ACKNOWLEDGEMENT -------------------------------------------------
      L.section('Acknowledgement');
      L.para(
        'By finalizing this agreement, the Studio and the Client confirm that the details above are correct. The Client may accept the PDF agreement in their customer portal. A downloadable copy is available to both parties.',
        { size: 9.5, color: C.ink2, align: 'justify', after: 0.6 },
      );

      L.ensureSpace(100);
      L.para('SERVICE PROVIDER', { size: 8, bold: true, color: C.ink3, after: 0.8 });
      L.hr(C.line, 0.7);
      L.para(form.studioSignatory || studio, { size: 10, after: 0.05 });
      L.para('Authorized signatory', { size: 8, color: C.ink3, after: 0.5 });

      L.para('CLIENT', { size: 8, bold: true, color: C.ink3, after: 0.8 });
      L.hr(C.line, 0.7);
      L.para(form.clientName || meta.customerName || '-', { size: 10, after: 0.05 });
      L.para(form.clientSignDate || agreementDate, { size: 8, color: C.ink3, after: 0.3 });

      // Stamp page footers on every page after layout (avoids blank-page bugs)
      L.stampFooters();
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

function emptyDay(n = 1, defaults = {}) {
  return {
    id: `day-${n}-${Date.now().toString(36)}`,
    dayNumber: n,
    label: defaults.label || `Day ${n}`,
    date: defaults.date || '',
    startTime: defaults.startTime || '',
    endTime: defaults.endTime || '',
    venue: defaults.venue || '',
    // services: array of { id, count } (strings still accepted)
    services: defaults.services || [{ id: 'traditional_photographer', count: 1 }],
    customService: defaults.customService || '',
    notes: defaults.notes || '',
  };
}

function emptyWeddingForm(customer = {}) {
  return {
    documentTitle: 'Wedding Photography Quotation',
    agreementDate: '',
    introText: '',
    clientName: customer.name || '',
    clientEmail: customer.email || '',
    clientPhone: customer.phone || '',
    partnerName: '',
    partnerPhone: '',
    billingAddress: '',
    // Studio block (pre-filled from profile on finalize if blank)
    studioName: '',
    studioAddress: '',
    studioPhone: '',
    studioEmail: '',
    studioWebsite: '',
    eventType: 'Wedding',
    eventDate: '',
    eventDatesLabel: '',
    mainCeremonyDate: '',
    eventCity: '',
    primaryVenue: '',
    additionalVenues: '',
    ceremonyTime: '',
    receptionTime: '',
    guestCount: '',
    packageName: customer.package?.name || '',
    coverageHours: '',
    coverageDays: '1',
    packageNotes: '',
    scopeIntro: '',
    days: [emptyDay(1)],
    scopeServices: [],
    scopeCustom: '',
    scopeNotes: '',
    deliverables: [
      { id: 'traditional_documentary_film' },
      { id: 'cinematic_highlight_film' },
      { id: 'edited_couple_photos' },
      { id: 'color_corrected_photos', qty: '350' },
      { id: 'social_media_reels', qty: '3' },
      { id: 'raw_data_transfer' },
    ],
    timelineItems: TIMELINE_CATALOG.map((t) => ({
      id: t.id,
      title: t.title,
      timeframe: t.defaultTimeframe,
      description: t.description,
    })),
    responsibilities: RESPONSIBILITY_CATALOG.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
    })),
    whyChooseUs: [...DEFAULT_WHY_US],
    editedPhotosCount: '',
    includeRaws: 'no',
    highlightDuration: '',
    fullFilm: '',
    albums: '',
    deliveryTimeline: '',
    deliveryMethod: 'Online private gallery / Hard drive as agreed',
    otherDeliverables: '',
    currency: 'INR',
    totalFee: '',
    totalFeeInWords: '',
    costIncludesText: 'Includes complete team charges, equipment, post-production',
    travelIncluded: 'yes', // yes | no | partial
    stayIncluded: 'no', // yes | no
    advanceFee: '',
    amountPaid: '',
    balanceDue: '',
    balanceDueDate: '',
    paymentMethod: 'UPI / Bank transfer',
    paymentTermsText: '50% advance to confirm booking. Balance due before final delivery.',
    extraHourRate: '',
    travelNotes: '',
    generalTerms: '',
    specialConditions: '',
    studioSignatory: '',
    clientSignDate: '',
    contactPhone: '',
    contactEmail: '',
  };
}

const SCOPE_OPTIONS = Object.entries(SCOPE_LABELS).map(([id, label]) => ({ id, label }));

module.exports = {
  buildWeddingAgreementPdf,
  emptyWeddingForm,
  emptyDay,
  SCOPE_OPTIONS,
  SCOPE_LABELS,
  DELIVERABLE_CATALOG,
  TIMELINE_CATALOG,
  RESPONSIBILITY_CATALOG,
  DEFAULT_WHY_US,
};
