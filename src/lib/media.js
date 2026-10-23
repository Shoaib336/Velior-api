// Image URLs. Uploads are stored as "/uploads/..." paths and served as
// absolute URLs on PUBLIC_URL, so moving the API to another host doesn't
// break saved images. External http(s) URLs pass through untouched.
import path from 'node:path';
import { z } from 'zod';

export const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || 'uploads');

const base = () => (process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 5000}`).replace(/\/+$/, '');

/** Stored value → URL the browser can load. */
export const toPublicUrl = (stored) => (stored?.startsWith('/') ? `${base()}${stored}` : stored ?? null);

/** URL the admin sent back → what we store. */
export const toStoredUrl = (url) => {
  if (!url) return null;
  const ours = `${base()}/uploads/`;
  return url.startsWith(ours) ? url.slice(base().length) : url;
};

/** One image field: our upload path or an http(s) URL. */
export const imageUrl = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v.startsWith('/uploads/') || /^https?:\/\/\S+$/.test(v), 'Upload the image again');
