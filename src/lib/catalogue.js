// Catalogue reads and the product shape shared by the storefront and admin.
import pool from '../db.js';
import { toPublicUrl } from './media.js';

const json = (value, fallback) => {
  if (value == null) return fallback;
  return typeof value === 'string' ? JSON.parse(value) : value;
};

export const HIGHLIGHT_KEYS = ['bestFor', 'scentVibe', 'keyHighlights'];
export const SPEC_KEYS = ['top', 'heart', 'base', 'longevity', 'type', 'sillage'];
const blank = (keys) => Object.fromEntries(keys.map((k) => [k, '']));

// Stock is per size; the product's `stock` is the total of its sizes.
// Purchase prices (`unitCost`) only go to the admin.
const shape = (p, sizes, { admin = false, soldBySize } = {}) => {
  const images = json(p.images, {});
  const detail = json(p.detail, {});
  const own = sizes.filter((s) => s.product_id === p.id);
  return {
    slug: p.slug,
    name: p.name,
    audience: p.audience,
    isSet: Boolean(p.is_set),
    stock: own.reduce((n, s) => n + s.stock, 0),
    sizes: own.map((s) => ({
      label: s.label,
      price: s.price,
      salePrice: s.sale_price,
      stock: s.stock,
      ...(admin && {
        unitCost: s.unit_cost,
        isActive: Boolean(s.is_active),
        unitsSold: soldBySize?.get(`${p.id}|${s.label}`) ?? 0,
      }),
    })),
    excerpt: p.excerpt ?? '',
    notes: json(p.notes, []),
    images: {
      card: toPublicUrl(images.card),
      portrait: toPublicUrl(images.portrait),
      gallery: (images.gallery ?? []).map(toPublicUrl),
      sizes: Object.fromEntries(Object.entries(images.sizes ?? {}).map(([label, url]) => [label, toPublicUrl(url)])),
    },
    detail: {
      description: detail.description ?? '',
      highlights: { ...blank(HIGHLIGHT_KEYS), ...detail.highlights },
      specs: { ...blank(SPEC_KEYS), ...detail.specs },
    },
  };
};

/**
 * Storefront products: visible, with at least one size on sale. Pass `slugs`
 * to limit; pass `lock` (inside a transaction) to lock the product rows.
 * Rows keep their DB `id`.
 */
export const loadProducts = async (conn = pool, { slugs, lock = false } = {}) => {
  const params = [];
  let where = 'is_active = 1';
  if (slugs) {
    if (slugs.length === 0) return [];
    where += ` AND slug IN (${slugs.map(() => '?').join(',')})`;
    params.push(...slugs);
  }
  const [products] = await conn.query(
    `SELECT * FROM products WHERE ${where} ORDER BY id${lock ? ' FOR UPDATE' : ''}`,
    params,
  );
  if (products.length === 0) return [];
  const [sizes] = await conn.query(
    'SELECT * FROM product_sizes WHERE is_active = 1 AND product_id IN (?) ORDER BY id',
    [products.map((p) => p.id)],
  );
  return products
    .map((p) => ({ ...shape(p, sizes), id: p.id }))
    .filter((p) => p.sizes.length > 0);
};

/**
 * Admin view: every product (hidden ones and every size included) plus
 * sales figures. `slug` limits to one.
 */
export const loadAdminProducts = async (conn = pool, { slug } = {}) => {
  const [products] = await conn.query(
    `SELECT * FROM products${slug ? ' WHERE slug = ?' : ''} ORDER BY id`,
    slug ? [slug] : [],
  );
  if (products.length === 0) return [];
  const ids = products.map((p) => p.id);
  const [sizes] = await conn.query('SELECT * FROM product_sizes WHERE product_id IN (?) ORDER BY id', [ids]);
  // Orders and partner-store invoices both count as sold.
  const [sales] = await conn.query(
    `SELECT product_id, size_label, SUM(sold) AS sold, MAX(ordered) AS ordered FROM (
       SELECT oi.product_id, oi.size_label, CASE WHEN o.status <> 'cancelled' THEN oi.qty ELSE 0 END AS sold, 1 AS ordered
         FROM order_items oi JOIN orders o ON o.id = oi.order_id
        WHERE oi.product_id IN (?)
       UNION ALL
       SELECT product_id, size_label, qty, 0 FROM partner_invoice_items WHERE product_id IN (?)
     ) s
     GROUP BY product_id, size_label`,
    [ids, ids],
  );
  // Units sold per product and per "product|size" (sizes match on label).
  // Only orders block deleting a product (invoices are kept by name).
  const soldOf = new Map();
  const soldBySize = new Map();
  const hasOrders = new Set();
  for (const s of sales) {
    soldOf.set(s.product_id, (soldOf.get(s.product_id) ?? 0) + Number(s.sold));
    soldBySize.set(`${s.product_id}|${s.size_label}`, Number(s.sold));
    if (Number(s.ordered)) hasOrders.add(s.product_id);
  }
  return products.map((p) => ({
    ...shape(p, sizes, { admin: true, soldBySize }),
    isActive: Boolean(p.is_active),
    unitsSold: soldOf.get(p.id) ?? 0,
    hasOrders: hasOrders.has(p.id),
    createdAt: p.created_at,
    updatedAt: p.updated_at,
  }));
};

/** Discount rate (0.1 = 10%) for a code, or null when it isn't valid. */
export const findPromo = async (conn = pool, code = '') => {
  const key = String(code).trim().toUpperCase();
  if (!key) return null;
  const [rows] = await conn.query('SELECT code, discount_rate FROM promo_codes WHERE code = ? AND is_active = 1', [
    key,
  ]);
  return rows[0] ? { code: rows[0].code, rate: Number(rows[0].discount_rate) } : null;
};

