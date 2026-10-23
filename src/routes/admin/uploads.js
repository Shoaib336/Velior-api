// Product image uploads → UPLOAD_DIR/products, served at /uploads/products.
// The file type is read from the bytes, not trusted from the browser.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { HttpError, ok } from '../../lib/http.js';
import { UPLOAD_DIR, toPublicUrl } from '../../lib/media.js';

const router = Router();

const MAX_MB = 5;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_MB * 1024 * 1024, files: 1 },
});

const sniff = (buf) => {
  if (buf.length > 8 && buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return 'png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
};

const receive = (req, res) =>
  new Promise((resolve, reject) => {
    upload.single('image')(req, res, (err) => {
      if (err?.code === 'LIMIT_FILE_SIZE') reject(new HttpError(400, `Images must be under ${MAX_MB} MB`));
      else if (err instanceof multer.MulterError) reject(new HttpError(400, 'Send one image in the "image" field'));
      else if (err) reject(err);
      else resolve();
    });
  });

router.post('/uploads', async (req, res) => {
  await receive(req, res);
  if (!req.file) throw new HttpError(400, 'Choose an image to upload');
  const ext = sniff(req.file.buffer);
  if (!ext) throw new HttpError(400, 'Use a PNG, JPG or WebP image');

  const dir = path.join(UPLOAD_DIR, 'products');
  await fs.mkdir(dir, { recursive: true });
  const name = `${crypto.randomBytes(12).toString('hex')}.${ext}`;
  await fs.writeFile(path.join(dir, name), req.file.buffer);

  ok(res, { url: toPublicUrl(`/uploads/products/${name}`) }, 'Image uploaded', 201);
});

export default router;
