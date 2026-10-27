// Entry point: loads env vars and starts the HTTP server.
import 'dotenv/config';
import app from './app.js';

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error('JWT_SECRET must be set to a random string of at least 32 characters (see README).');
  process.exit(1);
}

// Image links and password-reset emails are built from these; left on
// localhost they break on the live site. Shows up in `pm2 logs velior-api`.
for (const key of ['PUBLIC_URL', 'ADMIN_URL']) {
  const value = process.env[key];
  if (!value || /\/\/(localhost|127\.0\.0\.1)/.test(value)) {
    console.warn(`${key} is ${value ? `"${value}"` : 'not set'} — on the live server set it to the public https URL.`);
  }
}
if (/^https?:\/\/(www\.)?veliorfragrances\.com\/?$/i.test(process.env.PUBLIC_URL ?? '')) {
  console.warn('PUBLIC_URL is the storefront domain — set it to https://api.veliorfragrances.com (images use that for now).');
}

const port = process.env.PORT || 5000;
app.listen(port, () => console.log(`perfume-api listening on port ${port}`));
