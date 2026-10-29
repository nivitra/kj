/**
 * Generate a clean invoice PDF (studio branding + installments + terms).
 */
const PDFDocument = require('pdfkit');
const {
  resolvePaymentTerms,
  STUDIO_LEGAL_NAME,
  STUDIO_LOCKUP,
  STUDIO_CITY,
} = require('./studioTerms');

function money(n, currency = 'INR') {
  if (n == null || n === '') return '—';
  const num = Number(n);
  if (Number.isNaN(num)) return String(n);
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: currency || 'INR',
      maximumFractionDigits: 2,
    }).format(num);
  } catch {
    return `${currency} ${num.toLocaleString('en-IN')}`;
  }
}

function fmtDate(d) {
  if (!d) return '—';
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function statusLabel(s) {
  return String(s || '').replace(/_/g, ' ');
}

/**
 * @param {object} inv — invoice with installments, customer, package
 * @param {object} meta — { studioName, studioPhone, studioEmail, studioAddress }
 * @returns {Promise<Buffer>}
 */
function buildInvoicePdf(inv, meta = {}) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 48, bottom: 56, left: 48, right: 48 },
        bufferPages: true,
        info: {
          Title: inv.invoiceNumber || 'Invoice',
          Author: meta.studioName || 'Studio',
        },
      });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const studio = meta.studioName || STUDIO_LEGAL_NAME;
      const currency = inv.currency || 'INR';
      const customer = inv.customer || {};
      const termsText = resolvePaymentTerms(meta.termsHtml, inv.terms);
      const installments = (inv.installments || [])
        .slice()
        .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
      const pageW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const left = doc.page.margins.left;

      // ── Header ──────────────────────────────────────────────────────────
      doc.font('Helvetica-Bold').fontSize(16).fillColor('#1A1917').text(studio, { align: 'left' });
      doc.font('Helvetica').fontSize(8).fillColor('#9A7B4F')
        .text(`${STUDIO_LOCKUP} · ${STUDIO_CITY}`, { width: pageW * 0.55 });
      doc.moveDown(0.15);
      doc.font('Helvetica').fontSize(9).fillColor('#9A7B4F').text('INVOICE', { characterSpacing: 1.6 });
      if (meta.studioPhone || meta.studioEmail || meta.studioAddress) {
        doc.moveDown(0.2);
        doc.fontSize(8).fillColor('#8A847A').text(
          [meta.studioPhone, meta.studioEmail, meta.studioAddress].filter(Boolean).join('  ·  '),
          { width: pageW * 0.55 },
        );
      }

      const headerTop = 48;
      doc.font('Helvetica-Bold').fontSize(11).fillColor('#1A1917')
        .text(inv.invoiceNumber || '', left + pageW * 0.55, headerTop, { width: pageW * 0.45, align: 'right' });
      doc.font('Helvetica').fontSize(9).fillColor('#6E6B66')
        .text(statusLabel(inv.status), { width: pageW * 0.45, align: 'right' });
      doc.fontSize(8).fillColor('#A8A39B')
        .text(`Date: ${fmtDate(inv.finalizedAt || inv.sentAt || inv.createdAt)}`, {
          width: pageW * 0.45,
          align: 'right',
        });

      doc.moveDown(1.2);
      doc.x = left;
      doc.moveTo(left, doc.y).lineTo(left + pageW, doc.y).strokeColor('#EAE6DE').lineWidth(1).stroke();
      doc.moveDown(0.8);

      // ── Bill to + title ──────────────────────────────────────────────────
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#9A7B4F').text('BILL TO', { characterSpacing: 1.1 });
      doc.moveDown(0.25);
      doc.font('Helvetica-Bold').fontSize(12).fillColor('#1A1917').text(customer.name || 'Customer');
      if (customer.email) {
        doc.font('Helvetica').fontSize(9).fillColor('#6E6B66').text(customer.email);
      }
      if (customer.phone) {
        doc.font('Helvetica').fontSize(9).fillColor('#6E6B66').text(customer.phone);
      }

      doc.moveDown(0.7);
      doc.font('Helvetica-Bold').fontSize(14).fillColor('#1A1917').text(inv.title || 'Service Invoice');
      if (inv.package?.title) {
        doc.font('Helvetica').fontSize(9).fillColor('#6E6B66').text(`Package: ${inv.package.title}`);
      }
      doc.moveDown(0.6);

      // ── Line items (service + travel + extras) ──────────────────────────
      const travelAmt = Number(inv.travelAmount || 0);
      const grandTotal = Number(inv.totalAmount || 0);
      const serviceAmt = Number(inv.serviceAmount ?? Math.max(0, grandTotal - travelAmt + Number(inv.discountAmount || 0) - Number(inv.taxAmount || 0)));
      const items = Array.isArray(inv.lineItems) ? inv.lineItems : [];

      doc.font('Helvetica-Bold').fontSize(10).fillColor('#9A7B4F')
        .text('CHARGES', { characterSpacing: 1.0 });
      doc.moveDown(0.3);
      doc.moveTo(left, doc.y).lineTo(left + pageW, doc.y).strokeColor('#EAE6DE').lineWidth(1).stroke();
      doc.moveDown(0.4);

      const line = (label, value) => {
        const y = doc.y;
        doc.font('Helvetica').fontSize(9).fillColor('#6E6B66')
          .text(label, left, y, { width: pageW * 0.65 });
        doc.font('Helvetica-Bold').fontSize(9).fillColor('#1A1917')
          .text(value, left + pageW * 0.65, y, { width: pageW * 0.35, align: 'right' });
        doc.y = y + 16;
        doc.x = left;
      };
      if (items.length) {
        items
          .slice()
          .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
          .forEach((it) => {
            const qty = Number(it.quantity || 1);
            const label = qty > 1
              ? `${it.description || 'Item'} × ${qty}`
              : (it.description || 'Item');
            line(label, money(it.lineTotal != null ? it.lineTotal : it.unitAmount, currency));
          });
      } else {
        line('Service / package', money(serviceAmt, currency));
        if (travelAmt > 0) line('Travelling', money(travelAmt, currency));
      }
      if (Number(inv.discountAmount || 0) > 0 || inv.couponCode) {
        line(
          inv.couponCode ? `Discount (${inv.couponCode})` : 'Discount',
          `− ${money(inv.discountAmount, currency)}`,
        );
      }
      if (Number(inv.taxAmount || 0) > 0 && !items.some(it => it.kind === 'TAX')) line(inv.taxLabel || 'Tax', money(inv.taxAmount, currency));
      doc.moveDown(0.2);
      doc.moveTo(left, doc.y).lineTo(left + pageW, doc.y).strokeColor('#EAE6DE').lineWidth(0.8).stroke();
      doc.moveDown(0.5);

      // ── Summary box ─────────────────────────────────────────────────────
      const sumY = doc.y;
      const boxH = 52;
      doc.roundedRect(left, sumY, pageW, boxH, 8).fillAndStroke('#FBFAF8', '#EAE6DE');

      const cashPaid = Number(inv.cashPaid ?? (inv.amountPaid || 0));
      const adjusted = Number(inv.adjusted || 0);
      const bal = inv.balance != null ? Number(inv.balance) : Math.max(0, grandTotal - cashPaid - adjusted);

      if (adjusted > 0) {
        const colW = pageW / 4;
        const drawSum = (label, value, x) => {
          doc.font('Helvetica').fontSize(8).fillColor('#8A847A')
            .text(label, x + 10, sumY + 12, { width: colW - 14 });
          doc.font('Helvetica-Bold').fontSize(11).fillColor('#1A1917')
            .text(value, x + 10, sumY + 26, { width: colW - 14 });
        };
        drawSum('TOTAL', money(grandTotal, currency), left);
        drawSum('WRITE-OFF', money(adjusted, currency), left + colW);
        drawSum('CASH PAID', money(cashPaid, currency), left + colW * 2);
        drawSum('BALANCE', money(bal, currency), left + colW * 3);
      } else {
        const colW = pageW / 3;
        const drawSum = (label, value, x) => {
          doc.font('Helvetica').fontSize(8).fillColor('#8A847A')
            .text(label, x + 14, sumY + 12, { width: colW - 20 });
          doc.font('Helvetica-Bold').fontSize(12).fillColor('#1A1917')
            .text(value, x + 14, sumY + 26, { width: colW - 20 });
        };
        drawSum('TOTAL', money(grandTotal, currency), left);
        drawSum('PAID', money(cashPaid, currency), left + colW);
        drawSum('BALANCE', money(bal, currency), left + colW * 2);
      }
      doc.y = sumY + boxH + 14;
      doc.x = left;

      // ── Payment History ────────────────────────────────────────────────
      const activePayments = (inv.payments || []).filter((p) => !p.voidedAt && !p.isVoid);
      if (activePayments.length) {
        if (doc.y > doc.page.height - 140) {
          doc.addPage();
          doc.x = left;
        }
        doc.font('Helvetica-Bold').fontSize(10).fillColor('#9A7B4F')
          .text('PAYMENTS', { characterSpacing: 1.0 });
        doc.moveDown(0.3);
        doc.moveTo(left, doc.y).lineTo(left + pageW, doc.y).strokeColor('#EAE6DE').lineWidth(1).stroke();
        doc.moveDown(0.4);

        activePayments.forEach((p) => {
          if (doc.y > doc.page.height - 80) {
            doc.addPage();
            doc.x = left;
          }
          const rowY = doc.y;
          const k = String(p.kind || 'PAYMENT').toUpperCase();
          const kindLabel = k === 'REFUND'
            ? 'Refund'
            : (p.method ? `Payment (${p.method})` : 'Payment');
          doc.font('Helvetica-Bold').fontSize(9).fillColor('#1A1917')
            .text(kindLabel, left, rowY, { width: pageW * 0.45 });
          doc.font('Helvetica').fontSize(8).fillColor('#6E6B66')
            .text(fmtDate(p.paidAt || p.createdAt), left + pageW * 0.45, rowY, { width: pageW * 0.25 });
          doc.font('Helvetica-Bold').fontSize(9).fillColor('#1A1917')
            .text(money(p.amount, currency), left + pageW * 0.70, rowY, { width: pageW * 0.30, align: 'right' });
          doc.y = rowY + 14;
          doc.moveDown(0.2);
        });
        doc.moveDown(0.4);
      }

      // ── Installments table ──────────────────────────────────────────────
      if (doc.y > doc.page.height - 140) {
        doc.addPage();
        doc.x = left;
      }
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#9A7B4F')
        .text('INSTALLMENT SCHEDULE', { characterSpacing: 1.0 });
      doc.moveDown(0.35);
      doc.moveTo(left, doc.y).lineTo(left + pageW, doc.y).strokeColor('#EAE6DE').lineWidth(1).stroke();
      doc.moveDown(0.45);

      // Table header
      const cols = {
        label: left,
        pct: left + pageW * 0.38,
        due: left + pageW * 0.48,
        amount: left + pageW * 0.68,
        status: left + pageW * 0.86,
      };
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#8A847A');
      const headY = doc.y;
      doc.text('Installment', cols.label, headY, { width: pageW * 0.36 });
      doc.text('%', cols.pct, headY, { width: pageW * 0.09 });
      doc.text('Due', cols.due, headY, { width: pageW * 0.18 });
      doc.text('Amount', cols.amount, headY, { width: pageW * 0.16, align: 'right' });
      doc.text('Status', cols.status, headY, { width: pageW * 0.14, align: 'right' });
      doc.y = headY + 14;
      doc.moveTo(left, doc.y).lineTo(left + pageW, doc.y).strokeColor('#EAE6DE').lineWidth(0.6).stroke();
      doc.moveDown(0.35);

      if (!installments.length) {
        doc.font('Helvetica').fontSize(9).fillColor('#8A847A').text('No installments listed.');
      }

      installments.forEach((inst, idx) => {
        // Page break if near bottom
        if (doc.y > doc.page.height - 100) {
          doc.addPage();
          doc.x = left;
        }
        const rowY = doc.y;
        doc.font('Helvetica-Bold').fontSize(9).fillColor('#1A1917')
          .text(inst.label || `Installment ${idx + 1}`, cols.label, rowY, { width: pageW * 0.36 });
        doc.font('Helvetica').fontSize(9).fillColor('#6E6B66')
          .text(inst.percentage != null ? `${Number(inst.percentage)}%` : '—', cols.pct, rowY, { width: pageW * 0.09 })
          .text(fmtDate(inst.dueDate), cols.due, rowY, { width: pageW * 0.18 });
        doc.font('Helvetica-Bold').fontSize(9).fillColor('#1A1917')
          .text(money(inst.amount, currency), cols.amount, rowY, { width: pageW * 0.16, align: 'right' });
        doc.font('Helvetica').fontSize(8).fillColor('#6E6B66')
          .text(statusLabel(inst.status), cols.status, rowY, { width: pageW * 0.14, align: 'right' });

        let nextY = rowY + 14;
        if (inst.terms) {
          doc.font('Helvetica').fontSize(8).fillColor('#6E6B66')
            .text(`Terms: ${inst.terms}`, cols.label, nextY, { width: pageW });
          nextY = doc.y + 2;
        }
        if (inst.notes) {
          doc.font('Helvetica').fontSize(8).fillColor('#A8A39B')
            .text(`Note: ${inst.notes}`, cols.label, nextY, { width: pageW });
          nextY = doc.y + 2;
        }
        doc.y = Math.max(nextY, rowY + 16);
        doc.moveDown(0.25);
        doc.moveTo(left, doc.y).lineTo(left + pageW, doc.y).strokeColor('#F2EFE9').lineWidth(0.5).stroke();
        doc.moveDown(0.35);
      });

      // ── Invoice terms (always — studio default if invoice has none) ──────
      if (termsText) {
        if (doc.y > doc.page.height - 140) {
          doc.addPage();
          doc.x = left;
        }
        doc.moveDown(0.4);
        doc.font('Helvetica-Bold').fontSize(10).fillColor('#9A7B4F')
          .text('PAYMENT TERMS & CONDITIONS', { characterSpacing: 1.0 });
        doc.moveDown(0.15);
        doc.font('Helvetica').fontSize(7.5).fillColor('#A8A39B')
          .text(`${STUDIO_LEGAL_NAME}, ${STUDIO_CITY} · ${STUDIO_LOCKUP}`);
        doc.moveDown(0.3);
        doc.moveTo(left, doc.y).lineTo(left + pageW, doc.y).strokeColor('#EAE6DE').lineWidth(1).stroke();
        doc.moveDown(0.4);
        doc.font('Helvetica').fontSize(8.5).fillColor('#5C574F')
          .text(termsText, { width: pageW, align: 'left', lineGap: 2.4 });
      }

      if (inv.notes) {
        if (doc.y > doc.page.height - 120) {
          doc.addPage();
          doc.x = left;
        }
        doc.moveDown(0.7);
        doc.font('Helvetica-Bold').fontSize(10).fillColor('#9A7B4F')
          .text('NOTES', { characterSpacing: 1.0 });
        doc.moveDown(0.3);
        doc.moveTo(left, doc.y).lineTo(left + pageW, doc.y).strokeColor('#EAE6DE').lineWidth(1).stroke();
        doc.moveDown(0.4);
        doc.font('Helvetica').fontSize(9).fillColor('#5C574F')
          .text(String(inv.notes), { width: pageW, lineGap: 2 });
      }

      // ── Footer for all pages ─────────────────────────────────────────────
      const pageRange = doc.bufferedPageRange();
      for (let i = pageRange.start; i < pageRange.start + pageRange.count; i++) {
        doc.switchToPage(i);
        const footerY = doc.page.height - 38;
        doc.font('Helvetica').fontSize(8).fillColor('#A8A39B')
          .text(
            `${studio} · ${STUDIO_CITY} · ${inv.invoiceNumber || ''} · Page ${i + 1} of ${pageRange.count}`,
            left,
            footerY,
            { width: pageW, align: 'center' },
          );
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { buildInvoicePdf };
