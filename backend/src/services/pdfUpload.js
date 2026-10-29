const multer = require('multer');
const MAX_PDF_BYTES = 25 * 1024 * 1024;
function validatePdf(file) {
  if (!file) return 'Choose a PDF to upload';
  if (!file.size || file.size > MAX_PDF_BYTES) return 'PDF must be between 1 byte and 25 MB';
  if (file.mimetype !== 'application/pdf' || file.buffer?.subarray(0, 5).toString() !== '%PDF-') return 'Choose a valid PDF file';
  return null;
}
const parse = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_PDF_BYTES, files: 1 } }).single('file');
function pdfUpload(req, res, next) {
  parse(req, res, (err) => {
    const message = err ? (err.code === 'LIMIT_FILE_SIZE' ? 'PDF must be 25 MB or smaller' : 'Upload one PDF file') : validatePdf(req.file);
    if (message) return res.status(400).json({ error: { message } });
    next();
  });
}
module.exports = { pdfUpload, validatePdf, MAX_PDF_BYTES };
