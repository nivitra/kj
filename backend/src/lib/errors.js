// Typed application error carrying a stable code, safe message, HTTP status,
// and whether the client should retry. Used across routes and job processors.
class AppError extends Error {
  constructor(code, message, { status = 400, retryable = false } = {}) {
    super(message);
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

// Error codes surfaced to clients (safe, human-friendly messages).
const CODES = {
  VALIDATION: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  RATE_LIMITED: 'RATE_LIMITED',
  CONSENT_REQUIRED: 'CONSENT_REQUIRED',
  NO_FACE_DETECTED: 'NO_FACE_DETECTED',
  MULTIPLE_FACES: 'MULTIPLE_FACES',
  FACE_TOO_SMALL: 'FACE_TOO_SMALL',
  LOW_QUALITY_SELFIE: 'LOW_QUALITY_SELFIE',
  UNSUPPORTED_MEDIA: 'UNSUPPORTED_MEDIA',
  GALLERY_NOT_ACCESSIBLE: 'GALLERY_NOT_ACCESSIBLE',
  SEARCH_FAILED: 'SEARCH_FAILED',
  SELECTION_LOCKED: 'SELECTION_LOCKED',
  CONFLICT: 'CONFLICT',
  INTERNAL: 'INTERNAL_ERROR',
};

// Classify an error as retryable (transient AWS/network/Redis) vs permanent.
const isRetryable = (err) => {
  if (err instanceof AppError) return err.retryable;
  const name = err?.name || '';
  const retryableNames = [
    'ThrottlingException',
    'ProvisionedThroughputExceededException',
    'InternalServerError',
    'ServiceUnavailable',
    'RequestTimeout',
    'TimeoutError',
    'TooManyRequestsException',
    'PriorRequestNotComplete',
  ];
  if (retryableNames.includes(name)) return true;
  const status = err?.$metadata?.httpStatusCode;
  if (status === 429 || (status && status >= 500)) return true;
  if (err?.code === 'ECONNRESET' || err?.code === 'ETIMEDOUT' || err?.code === 'EAI_AGAIN') return true;
  // Rekognition service may be briefly unavailable — do not fail the upload pipeline permanently.
  if (/throttl|rate exceeded|temporarily unavailable|try again/i.test(err?.message || '')) return true;
  return false;
};

module.exports = { AppError, CODES, isRetryable };
