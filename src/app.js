// Express app: security headers, CORS, JSON parsing, rate limits, routes, error handler.
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import catalogueRoutes from './routes/catalogue.js';
import orderRoutes from './routes/orders.js';
import contactRoutes from './routes/contact.js';
import contentRoutes from './routes/content.js';
import adminRoutes from './routes/admin/index.js';
import { UPLOAD_DIR } from './lib/media.js';

const app = express();

// Production runs behind Nginx on the same machine, so trust X-Forwarded-For
// from loopback by default — otherwise every customer shares Nginx's IP and
// one rate-limit bucket (10 orders an hour for the whole site). TRUST_PROXY
// overrides it (e.g. 1 for a proxy on another host).
app.set('trust proxy', Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY || 'loopback');

// CORS_ORIGINS: comma-separated, e.g. "https://veliorfragrances.com,https://admin.veliorfragrances.com".
// A trailing slash is ignored, "www." and bare domains count as the same
// site, and "*" matches one subdomain level ("https://*.vercel.app").
// The live storefront and admin are always allowed, whatever the env says.
const LIVE_ORIGINS = 'https://veliorfragrances.com,https://admin.veliorfragrances.com';
const allowedOrigins = `${LIVE_ORIGINS},${process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:5174'}`
  .split(',')
  .map((o) => o.trim().replace(/\/+$/, '').replace('://www.', '://'))
  .filter(Boolean)
  .map((o) => new RegExp(`^${o.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[a-z0-9-]+')}$`, 'i'));

const isAllowedOrigin = (origin) => allowedOrigins.some((re) => re.test(origin.replace('://www.', '://')));

const fail = (message) => ({ isRequestSuccessful: false, message, successResponse: null });
const limiter = (windowMinutes, limit, message) =>
  rateLimit({ windowMs: windowMinutes * 60_000, limit, standardHeaders: true, legacyHeaders: false, message: fail(message) });

app.use(helmet());
app.use(cors({ origin: (origin, done) => done(null, !origin || isAllowedOrigin(origin)) }));

// Product images, loaded by the storefront and admin from other origins.
app.use(
  '/uploads',
  (req, res, next) => {
    res.set('Cross-Origin-Resource-Policy', 'cross-origin');
    next();
  },
  express.static(UPLOAD_DIR, { immutable: true, maxAge: '365d', index: false, fallthrough: false }),
);

// Prices and stock change from the admin at any time — never let a browser
// or proxy serve an old copy.
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

app.get('/api/health', (req, res) => {
  res.json({ isRequestSuccessful: true, message: null, successResponse: { status: 'ok' } });
});

// Admin: its own body limit and rate limits (sign-in ones are strict).
app.use('/api/admin', express.json({ limit: '200kb' }));
app.post('/api/admin/auth/login', limiter(15, 10, 'Too many sign-in attempts. Please wait a few minutes.'));
app.post('/api/admin/auth/forgot-password', limiter(60, 5, 'Too many reset requests. Please try again later.'));
app.post('/api/admin/auth/reset-password', limiter(15, 10, 'Too many attempts. Please try again later.'));
app.use('/api/admin', limiter(15, 2000, 'Too many requests, please slow down'));
app.use('/api/admin', adminRoutes);

app.use('/api', express.json({ limit: '20kb' }));
app.use('/api', limiter(15, 300, 'Too many requests, please try again later'));
app.post('/api/orders', limiter(60, 10, 'Too many orders from this connection, please try again later'));
app.use('/api/orders/track', limiter(15, 30, 'Too many lookups, please try again later'));
app.post('/api/contact', limiter(60, 5, 'Too many messages, please try again later'));

app.use('/api', catalogueRoutes, orderRoutes, contactRoutes, contentRoutes);

app.use('/api', (req, res) => res.status(404).json(fail('Not found')));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.type === 'entity.parse.failed' ? 400 : err.status || err.statusCode || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({
    ...fail(status < 500 ? err.message : 'Internal server error'),
    ...(err.details && { errors: err.details }),
  });
});

export default app;
