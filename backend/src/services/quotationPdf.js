/**
 * Studio quotation PDF — matches SJ Clicks / WarmKelvin quotation layout.
 */
const PDFDocument = require('pdfkit');
const { rupeesInWords } = require('./billing/quotePricing');

function money(n) {
  return `INR ${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(raw) {
  if (!raw) return '';
  const d = raw instanceof Date ? raw : new Date(raw);
  if (Number.isNaN(d.getTime())) return String(raw);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase();
}

function buildQuotationPdf(quote, { studioName, phone, email } = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const ink = '#1A1917';
    const gold = '#9A7B4F';
    const form = quote.formData && typeof quote.formData === 'object' ? quote.formData : {};
    const snap = quote.pricingSnapshot && typeof quote.pricingSnapshot === 'object' ? quote.pricingSnapshot : {};
    const options = Array.isArray(snap.options) ? snap.options : [];
    const eventType = String(quote.eventType || 'WEDDING').replace(/_/g, ' ');
    const titleEvent = eventType === 'ENGAGEMENT' ? 'ENGAGEMENT' : eventType;

    const heading = (text) => {
      doc.moveDown(0.6);
      doc.font('Helvetica-Bold').fontSize(11).fillColor(gold).text(text.toUpperCase(), { characterSpacing: 0.8 });
      doc.moveTo(48, doc.y + 4).lineTo(547, doc.y + 4).strokeColor('#E8E0D4').lineWidth(1).stroke();
      doc.moveDown(0.6);
      doc.fillColor(ink);
    };

    doc.font('Helvetica-Bold').fontSize(16).fillColor(ink)
      .text(`${titleEvent} PHOTOGRAPHY & CINEMATOGRAPHY QUOTATION`, { align: 'center' });
    doc.moveDown(0.8);
    doc.font('Helvetica').fontSize(11);
    doc.text(`Name: ${quote.clientName || ''}`);
    doc.text(`Event Date: ${fmtDate(quote.eventDate) || 'To be confirmed'}`);
    doc.text(`Location: ${quote.venue || 'To be confirmed'}`);

    heading('Overview');
    doc.font('Helvetica').fontSize(10).fillColor(ink)
      .text(quote.overview || form.overview ||
        `Thank you for considering ${studioName || 'SJ Clicks & Films'} to document your ${eventType.toLowerCase()} celebration. To help you choose the ideal coverage, we offer distinct production setups.`);

    options.forEach((opt, idx) => {
      const label = idx === 0 ? 'OPTION 1' : `OPTION ${idx + 1}`;
      heading(`${label}: ${opt.title}`);
      if (opt.subtitle) {
        doc.font('Helvetica-Oblique').fontSize(10).text(opt.subtitle);
        doc.moveDown(0.4);
      }
      const crew = opt.crew || [];
      const crewCount = crew.reduce((s, c) => s + (Number(c.count) || 1), 0);
      if (crew.length) doc.font('Helvetica-Bold').fontSize(10).text(`Team on Set (${crewCount} Crew Members):`);
      doc.font('Helvetica').fontSize(10);
      crew.forEach((c) => {
        doc.text(`  ${c.count || 1} ${c.role}${c.blurb ? ` (${c.blurb})` : ''}`);
      });
      doc.moveDown(0.35);
      doc.font('Helvetica-Bold').fontSize(10).text('Deliverables & Specifications:');
      doc.font('Helvetica').fontSize(10);
      (opt.deliverables || []).forEach((d) => {
        const t = typeof d === 'string' ? d : [d.title, d.spec].filter(Boolean).join(' — ');
        doc.text(`  ${t}`);
      });
      if (opt.appAccessMonths) {
        doc.text(`  Proprietary Studio App Access: Active for ${opt.appAccessMonths} Month${opt.appAccessMonths === 1 ? '' : 's'}`);
      }
      if (opt.deliveryWeeksMin) {
        doc.text(`  Delivery Timeline: ${opt.deliveryWeeksMin} to ${opt.deliveryWeeksMax || opt.deliveryWeeksMin} weeks`);
      }
      doc.moveDown(0.3);
      doc.font('Helvetica-Bold').fontSize(11)
        .text(`Base Package Cost: ${money(opt.price)} (${rupeesInWords(opt.price)})`);
    });

    if ((snap.alternatives || []).length > 1) {
      heading('Choose one package');
      for (const alternative of snap.alternatives) {
        doc.font('Helvetica-Bold').fontSize(11).text(`${alternative.title}: ${money(alternative.total)}`);
        doc.font('Helvetica').fontSize(10).text(`Package and selected extras: ${money(alternative.subtotal)} · Tax: ${money(alternative.tax)}`);
      }
      doc.text('These are alternatives. Only your accepted package and its selected extras are payable.');
    }
    const addOnLines = (snap.lines || []).filter((l) => l.kind === 'ADDON');
    if (addOnLines.length) {
      heading('Selected add-ons (included in the totals)');
      addOnLines.forEach((l) => {
        doc.font('Helvetica-Bold').fontSize(10).text(`${l.title}: ${money(l.amount)}`);
      });
    }

    if (form.studioNote) { heading('About the studio'); doc.font('Helvetica').fontSize(10).text(String(form.studioNote)); }
    if (form.terms) { heading('Terms & delivery'); doc.font('Helvetica').fontSize(10).text(String(form.terms)); }

    if (snap.total != null && (snap.alternatives || []).length <= 1) {
      doc.moveDown(0.6);
      doc.font('Helvetica').fontSize(10).text(`Subtotal: ${money(snap.subtotal)} · Tax (${snap.taxPercent || 0}%): ${money(snap.tax)}`);
      doc.font('Helvetica-Bold').fontSize(12)
        .text(`Quotation total: ${money(snap.total)} (${rupeesInWords(snap.total)})`);
    }

    heading('Contact details');
    doc.font('Helvetica').fontSize(10);
    doc.text(`Studio: ${studioName || 'SJ CLICKS & FILMS (WARMKELVIN)'}`);
    if (phone) doc.text(`Phone: ${phone}`);
    if (email) doc.text(`Email: ${email}`);

    doc.end();
  });
}

module.exports = { buildQuotationPdf };
