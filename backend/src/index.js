require('dotenv').config();
require('express-async-errors'); // route async rejections to the error handler
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const { logger } = require('./utils/logger');
const { prisma } = require('./config/prisma');
const { getRedis } = require('./config/redis');
const { requestId, fail } = require('./lib/envelope');
const { register } = require('./services/metrics');
const { AppError, CODES } = require('./lib/errors');
const rekognition = require('./services/rekognition');

const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const adminCommerceRoutes = require('./routes/adminCommerce');
const galleryRoutes = require('./routes/gallery');
const photoRoutes = require('./routes/photo');
const customerRoutes = require('./routes/customer');
const uploadRoutes = require('./routes/upload');
const faceRoutes = require('./routes/face');
const selectionRoutes = require('./routes/selection');
const shopRoutes = require('./routes/shop');
const { customerRouter: portalCustomerRoutes, adminRouter: portalAdminRoutes } = require('./routes/portal');

const app = express();
const PORT = process.env.PORT || 4000;
// Behind Docker nginx which sets X-Forwarded-For — required for express-rate-limit.
app.set('trust proxy', 1);

// CORS allow-list from env (comma-separated), with dev fallbacks.
const corsOrigins = (process.env.CORS_ORIGINS || '')
  .split(',').map((s) => s.trim()).filter(Boolean);
const devOrigins = process.env.NODE_ENV === 'production'
  ? [] : ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:5000'];
const allowedOrigins = [
  ...corsOrigins,
  ...[process.env.FRONTEND_URL, process.env.CUSTOMER_APP_URL].filter(Boolean),
  ...devOrigins,
];

// Prisma BigInt → JSON number (global safety net for res.json)
app.set('json replacer', (key, value) =>
  (typeof value === 'bigint' ? Number(value) : value));

app.use(helmet());
// gzip JSON for large portal/home + package payloads (mobile clients benefit a lot)
app.use(compression({ threshold: 1024 }));
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    return cb(null, false);
  },
  credentials: true,
}));
app.use(requestId);
app.use(morgan('combined', { stream: { write: (msg) => logger.info(msg.trim()) } }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// Express uses JSON.stringify without app 'json replacer' for res.json in some versions —
// patch once so BigInt never 500s a response.
const _json = express.response.json;
express.response.json = function patchedJson(body) {
  const safe = JSON.parse(JSON.stringify(body, (_, v) => (typeof v === 'bigint' ? Number(v) : v)));
  return _json.call(this, safe);
};

/**
 * Global API rate limit.
 * 300/15min was far too low for the admin SPA (many parallel queries +
 * WhatsApp polling + React Query retries) and caused cascading 429s with
 * empty dashboards. Authenticated studio traffic gets a high ceiling;
 * anonymous traffic stays tighter.
 */
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: (req) => {
    const auth = req.headers.authorization || '';
    if (auth.startsWith('Bearer ')) return 12000; // ~13 req/s sustained per admin IP
    return 800; // public / guest
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Health probes under /api if any; uploads stream many tiny complete calls
  skip: (req) => {
    const p = req.path || '';
    return p === '/health' || p === '/health/live' || p === '/health/ready';
  },
  handler: (req, res) => {
    res.setHeader('Retry-After', '30');
    return fail(res, CODES.RATE_LIMITED, 'Too many requests — wait a few seconds and refresh', {
      status: 429,
      retryable: true,
    });
  },
});
app.use('/api', generalLimiter);

// Health checks
app.get('/health/live', (req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));
app.get('/health/ready', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    await getRedis().ping();
    res.json({ status: 'ready' });
  } catch (err) {
    res.status(503).json({ status: 'not_ready', error: err.message });
  }
});
app.get('/health', (req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// Protected Prometheus metrics
app.get('/metrics', async (req, res) => {
  if (process.env.METRICS_TOKEN && req.headers['x-metrics-token'] !== process.env.METRICS_TOKEN) {
    return res.status(401).end();
  }
  res.setHeader('Content-Type', register.contentType);
  res.end(await register.metrics());
});

const shortLinks = require('./routes/shortLinks');
app.use('/l', shortLinks.publicRouter);
app.use('/api/links', shortLinks.publicRouter);
app.use('/api/links', shortLinks.customerRouter);
app.use('/api/admin/links', shortLinks.adminRouter);
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/admin', adminCommerceRoutes);
// Portal admin CMS MUST be before shopRoutes (shop applies customer auth to /api/*)
app.use('/api/admin/portal', portalAdminRoutes);
app.use('/api/galleries', galleryRoutes);
app.use('/api/photos', photoRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/face', faceRoutes);
app.use('/api/selections', selectionRoutes);
const quotationRequests = require('./routes/quotationRequests');
app.use('/api/quotation-requests', quotationRequests.publicRouter);
app.use('/api/portal', quotationRequests.customerRouter);
app.use('/api/portal', portalCustomerRoutes);
const shareRoutes = require('./routes/share');
app.use('/api/share', shareRoutes.router);
app.use('/api/admin/share', shareRoutes.adminRouter);
const agreementRoutes = require('./routes/agreements');
app.use('/api/admin/agreements', agreementRoutes.adminRouter);
app.use('/api/agreements', agreementRoutes.customerRouter);
const quoteRoutes = require('./routes/quotes');
app.use('/api/admin/quotes', quoteRoutes.adminRouter);
app.use('/api/portal', quoteRoutes.customerRouter);
const billingRoutes = require('./routes/billing');
app.use('/api/admin/billing', billingRoutes.adminRouter);
app.use('/api/billing', billingRoutes.customerRouter);
const whatsappRoutes = require('./routes/whatsapp');
app.use('/api/admin/whatsapp', whatsappRoutes);
app.use('/api', shopRoutes);

// Central error handler → typed envelope.
app.use((err, req, res, next) => {
  if (err instanceof AppError) {
    return fail(res, err.code, err.message, { status: err.status, retryable: err.retryable });
  }
  logger.error(err.stack || err.message);
  const message = process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message;
  return fail(res, CODES.INTERNAL, message, { status: err.status || 500 });
});

// Bind 0.0.0.0 so reverse proxies / LAN clients can reach the API.
const HOST = process.env.HOST || '0.0.0.0';
const server = app.listen(PORT, HOST, async () => {
  logger.info(`Studio API running on http://${HOST}:${PORT}`);
  // Ensure Rekognition collection exists on boot (idempotent; never crashes if it already exists).
  if (rekognition.MODE !== 'mock') {
    try {
      await rekognition.ensureCollection();
      logger.info(`Rekognition collection ready: ${rekognition.COLLECTION_ID}`);
    } catch (err) {
      // Do not take down the API if face infra is unavailable — log and continue.
      logger.error(`Rekognition ensureCollection failed (non-fatal): ${err.message}`);
    }
  }
  // Restore WhatsApp Web sessions (Baileys) that were previously QR-linked.
  try {
    if (process.env.DISABLE_OUTBOUND_NOTIFICATIONS === 'true') return;
    const wa = require('./services/whatsapp');
    await wa.restoreAllSessions();
  } catch (err) {
    logger.warn(`WhatsApp restore skipped: ${err.message}`);
  }
});

const shutdown = (signal) => {
  logger.info(`${signal} received — graceful shutdown`);
  server.close(async () => {
    try {
      await prisma.$disconnect();
    } catch (_) { /* ignore */ }
    process.exit(0);
  });
  // Force exit if connections linger.
  setTimeout(() => process.exit(1), 15000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = app;
