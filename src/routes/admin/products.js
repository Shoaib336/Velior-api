// The catalogue for the Stock Manager: products, sizes with their prices,
// purchase price and stock, images and product-page content. Slugs are
// fixed once created (orders and storefront links use them); products with
// orders can only be hidden.
import { Router } from 'express';
import { z } from 'zod';
import pool, { transaction } from '../../db.js';
import { HttpError, fieldError, isDuplicate, ok, parse } from '../../lib/http.js';
import { HIGHLIGHT_KEYS, SPEC_KEYS, loadAdminProducts } from '../../lib/catalogue.js';
import { imageUrl, toStoredUrl } from '../../lib/media.js';
import { loadSettings } from '../../lib/settings.js';

const router = Router();

const rupees = (label) =>
  z
    .number({ error: `Enter the ${label}` })
    .int(`The ${label} must be whole rupees`)
    .min(1, `The ${label} must be at least 1`)
    .max(10_000_000, `The ${label} is too large`);

const units = z
  .number({ error: 'Enter the units in stock' })
  .int('Stock must be whole units')
  .min(0, "Stock can't be negative")
  .max(1_000_000, 'That stock level is too large');

// Stock and purchase price are optional: left out, a size keeps what it has
// (so switching a size on/off never overwrites stock a sale just took).
const sizeSchema = z
  .object({
    label: z.string().trim().min(1, 'Enter a size, e.g. 50 ML').max(30),
    price: rupees('price'),
    salePrice: rupees('sale price').nullish().transform((v) => v ?? null),
    unitCost: z
      .number({ error: 'Enter the purchase price' })
      .int('The purchase price must be whole rupees')
      .min(0, "The purchase price can't be negative")
      .max(10_000_000, 'The purchase price is too large')
      .optional(),
    stock: units.optional(),
    isActive: z.boolean().default(true),
  })
  .refine((s) => s.salePrice === null || s.salePrice < s.price, {
    message: 'The sale price must be lower than the price',
    path: ['salePrice'],
  });

const text = (max) => z.string().trim().max(max, `Keep it under ${max} characters`);
const group = (keys, max) => z.object(Object.fromEntries(keys.map((k) => [k, text(max).default('')])));

const fields = {
  name: z.string().trim().min(2, 'Enter the product name').max(120),
  audience: z.enum(['unisex', 'men', 'women'], { error: 'Pick a gender' }),
  isSet: z.boolean(),
  isActive: z.boolean(),
  sizes: z
    .array(sizeSchema)
    .min(1, 'Add at least one size')
    .max(6, 'Up to 6 sizes')
    .superRefine((sizes, ctx) => {
      const seen = new Set();
      sizes.forEach((s, i) => {
        const key = s.label.toLowerCase();
        if (seen.has(key)) ctx.addIssue({ code: 'custom', message: 'Each size needs its own label', path: [i, 'label'] });
        seen.add(key);
      });
    }),
  excerpt: text(300),
  notes: z.array(z.string().trim().min(1).max(40)).max(12, 'Up to 12 notes'),
  images: z.object({
    card: imageUrl.nullish(),
    portrait: imageUrl.nullish(),
    gallery: z.array(imageUrl).max(3, 'Up to 3 gallery images').default([]),
  }),
  detail: z.object({
    description: text(2000).default(''),
    highlights: group(HIGHLIGHT_KEYS, 200).default({}),
    specs: group(SPEC_KEYS, 80).default({}),
  }),
};

const slug = z
  .string({ error: 'Enter the storefront URL' })
  .trim()
  .min(2, 'Enter the storefront URL')
  .max(60)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and single dashes');

const createSchema = z.object({
  slug,
  ...fields,
  isSet: fields.isSet.default(false),
  isActive: fields.isActive.default(true),
  excerpt: fields.excerpt.default(''),
  notes: fields.notes.default([]),
  images: fields.images.default({ card: null, portrait: null, gallery: [] }),
  detail: fields.detail.default({ description: '', highlights: {}, specs: {} }),
});

const patchSchema = z.object(fields).partial();

/** Parsed body → product columns (only the ones given). */
const columns = (body) => {
  const cols = {};
  if (body.name !== undefined) cols.name = body.name;
  if (body.audience !== undefined) cols.audience = body.audience;
  if (body.isSet !== undefined) cols.is_set = body.isSet;
  if (body.isActive !== undefined) cols.is_active = body.isActive;
  if (body.excerpt !== undefined) cols.excerpt = body.excerpt;
  if (body.notes !== undefined) cols.notes = JSON.stringify(body.notes);
  if (body.images !== undefined) {
    cols.images = JSON.stringify({
      card: toStoredUrl(body.images.card),
      portrait: toStoredUrl(body.images.portrait),
      gallery: body.images.gallery.map(toStoredUrl),
    });
  }
  if (body.detail !== undefined) cols.detail = JSON.stringify(body.detail);
  return cols;
};

/** Replaces the sizes; a size sent without stock / purchase price keeps its saved ones (matched on label). */
const saveSizes = async (conn, productId, sizes) => {
  const [saved] = await conn.query('SELECT label, stock, unit_cost FROM product_sizes WHERE product_id = ? FOR UPDATE', [
    productId,
  ]);
  const old = new Map(saved.map((s) => [s.label.toLowerCase(), s]));
  await conn.query('DELETE FROM product_sizes WHERE product_id = ?', [productId]);
  await conn.query(
    'INSERT INTO product_sizes (product_id, label, price, sale_price, stock, unit_cost, is_active) VALUES ?',
    [
      sizes.map((s) => {
        const was = old.get(s.label.toLowerCase());
        return [productId, s.label, s.price, s.salePrice, s.stock ?? was?.stock ?? 0, s.unitCost ?? was?.unit_cost ?? 0, s.isActive];
      }),
    ],
  );
};

const findId = async (conn, slugValue, { lock = false } = {}) => {
  const [[row]] = await conn.query(`SELECT id FROM products WHERE slug = ?${lock ? ' FOR UPDATE' : ''}`, [slugValue]);
  if (!row) throw new HttpError(404, 'Product not found');
  return row.id;
};

router.get('/products', async (req, res) => {
  const [products, settings] = await Promise.all([loadAdminProducts(), loadSettings()]);
  ok(res, { products, lowStockThreshold: settings.store.lowStockThreshold });
});

router.get('/products/:slug', async (req, res) => {
  const [product] = await loadAdminProducts(pool, { slug: req.params.slug });
  if (!product) throw new HttpError(404, 'Product not found');
  ok(res, { product });
});

router.post('/products', async (req, res) => {
  const body = parse(createSchema, req.body);
  const product = await transaction(async (conn) => {
    const cols = { slug: body.slug, ...columns(body) };
    let inserted;
    try {
      [inserted] = await conn.query('INSERT INTO products SET ?', [cols]);
    } catch (err) {
      if (isDuplicate(err)) throw fieldError(409, 'slug', 'Another product already uses this URL');
      throw err;
    }
    await saveSizes(conn, inserted.insertId, body.sizes);
    return (await loadAdminProducts(conn, { slug: body.slug }))[0];
  });
  ok(res, { product }, 'Product added', 201);
});

router.patch('/products/:slug', async (req, res) => {
  if (req.body?.slug !== undefined && req.body.slug !== req.params.slug) {
    throw fieldError(400, 'slug', "A product's URL can't be changed");
  }
  const body = parse(patchSchema, req.body);
  const product = await transaction(async (conn) => {
    const id = await findId(conn, req.params.slug, { lock: true });
    const cols = columns(body);
    if (Object.keys(cols).length) await conn.query('UPDATE products SET ? WHERE id = ?', [cols, id]);
    if (body.sizes) await saveSizes(conn, id, body.sizes);
    return (await loadAdminProducts(conn, { slug: req.params.slug }))[0];
  });
  ok(res, { product }, 'Product saved');
});

router.delete('/products/:slug', async (req, res) => {
  await transaction(async (conn) => {
    const id = await findId(conn, req.params.slug, { lock: true });
    const [[used]] = await conn.query('SELECT 1 AS yes FROM order_items WHERE product_id = ? LIMIT 1', [id]);
    if (used) throw new HttpError(409, 'This product has orders, so it can only be hidden');
    await conn.query('DELETE FROM products WHERE id = ?', [id]);
  });
  ok(res, null, 'Product deleted');
});

export default router;
