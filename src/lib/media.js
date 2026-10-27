// Image URLs. Uploads are stored as "/uploads/..." paths and served as
// absolute URLs on PUBLIC_URL, so moving the API to another host doesn't
// break saved images. External http(s) URLs pass through untouched.
import path from 'node:path';
import { z } from 'zod';

export const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || 'uploads');

// PUBLIC_URL must be the API's own domain — /uploads isn't served by the
// storefront (its SPA answers with index.html). If it was set to the
// storefront's domain, use the API's instead.
const STOREFRONT_HOST = /^https?:\/\/(www\.)?veliorfragrances\.com$/i;
const LIVE_API = 'https://api.veliorfragrances.com';

const base = () => {
  const url = (process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 5000}`).replace(/\/+$/, '');
  return STOREFRONT_HOST.test(url) ? LIVE_API : url;
};

/** Stored value → URL the browser can load. */
export const toPublicUrl = (stored) => (stored?.startsWith('/') ? `${base()}${stored}` : stored ?? null);

// Hosts that serve our own uploads, past and present. An image URL on any of
// them is stored as its "/uploads/..." path, so a wrong or changed PUBLIC_URL
// can't bake a dead absolute link into the catalogue.
const OWN_HOST =
  /^https?:\/\/(localhost(:\d+)?|127\.0\.0\.1(:\d+)?|(api\.|www\.)?veliorfragrances\.com)(?=\/uploads\/)/i;

/** URL the admin sent back → what we store. */
export const toStoredUrl = (url) => {
  if (!url) return null;
  const ours = `${base()}/uploads/`;
  if (url.startsWith(ours)) return url.slice(base().length);
  return url.replace(OWN_HOST, '');
};

/** One image field: our upload path or an http(s) URL. */
export const imageUrl = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v.startsWith('/uploads/') || /^https?:\/\/\S+$/.test(v), 'Upload the image again');
