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

const shape = (p, sizes, { admin = false } = {}) => {
  const images = json(p.images, {});
  const detail = json(p.detail, {});
  return {
    slug: p.slug,
    name: p.name,
    audience: p.audience,
    isSet: Boolean(p.is_set),
    stock: p.stock,
    sizes: sizes
      .filter((s) => s.product_id === p.id)
      .map((s) => ({
        label: s.label,
        price: s.price,
        salePrice: s.sale_price,
        ...(admin && { isActive: Boolean(s.is_active) }),
      })),
    excerpt: p.excerpt ?? '',
    notes: json(p.notes, []),
    images: {
      card: toPublicUrl(images.card),
      portrait: toPublicUrl(images.portrait),
      gallery: (images.gallery ?? []).map(toPublicUrl),
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
 * to limit; pass `lock` (inside a transaction) to take row locks so
 * concurrent orders can't oversell stock. Rows keep their DB `id`.
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
  const [sales] = await conn.query(
    `SELECT oi.product_id,
            SUM(CASE WHEN o.status <> 'cancelled' THEN oi.qty ELSE 0 END) AS sold
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE oi.product_id IN (?)
      GROUP BY oi.product_id`,
    [ids],
  );
  const salesOf = new Map(sales.map((s) => [s.product_id, s]));
  return products.map((p) => ({
    ...shape(p, sizes, { admin: true }),
    isActive: Boolean(p.is_active),
    unitCost: p.unit_cost ?? 0,
    unitsSold: Number(salesOf.get(p.id)?.sold ?? 0),
    hasOrders: salesOf.has(p.id),
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

