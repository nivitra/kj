const PDFDocument = require('pdfkit');
function buildReceiptPdf(receipt, studio = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const { payment, invoice } = receipt;
    const amount = `${invoice.currency || 'INR'} ${Number(payment.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
    doc.font('Helvetica-Bold').fontSize(20).text(studio.name || 'Studio');
    doc.moveDown().fontSize(12).text(receipt.status === 'VOID' ? 'REVERSED PAYMENT RECEIPT' : 'PAYMENT RECEIPT');
    doc.moveDown().fontSize(16).text(receipt.receiptNumber);
    doc.font('Helvetica').fontSize(11);
    for (const [label, value] of [
      ['Client', invoice.customer?.name], ['Invoice', invoice.invoiceNumber],
      ['Amount received', amount], ['Payment date', new Date(payment.paidAt).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })],
      ['Method', payment.method], ['Reference', payment.reference],
      ['Issued', new Date(receipt.issuedAt).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })],
      ['Reversal reason', receipt.status === 'VOID' ? receipt.voidReason : null],
    ]) if (value) doc.moveDown(0.7).text(`${label}: ${value}`);
    doc.moveDown(2).fillColor('#666666').fontSize(10).text('This receipt records the payment shown above. See the invoice for the current balance and any later refunds or corrections.');
    doc.end();
  });
}
module.exports = { buildReceiptPdf };
