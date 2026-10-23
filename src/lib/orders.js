// The order shape shared by checkout, tracking and the admin, plus the
// stock moves a status change implies.
import pool from '../db.js';
import { HttpError } from './http.js';

export const STATUSES = ['confirmed', 'in_progress', 'delivered', 'cancelled'];

/** "D25M09Y26O1001" — day, month, two-digit year, then the order id. */
export const orderNumber = (date, id) => {
  const pad = (n) => String(n).padStart(2, '0');
  return `D${pad(date.getDate())}M${pad(date.getMonth() + 1)}Y${pad(date.getFullYear() % 100)}O${id}`;
};

const iso = (value) => (value ? new Date(value).toISOString() : null);

export const shapeOrder = (o, items) => ({
  number: o.order_number,
  status: o.status,
  placedAt: iso(o.placed_at),
  confirmedAt: iso(o.confirmed_at),
  inProgressAt: iso(o.in_progress_at),
  deliveredAt: iso(o.delivered_at),
  cancelledAt: iso(o.cancelled_at),
  customer: { fullName: o.customer_name, gender: o.customer_gender, whatsapp: o.whatsapp, address: o.address },
  paymentMethod: o.payment_method,
  channel: o.channel ?? 'online',
  estimatedDelivery: o.estimated_delivery,
  promoCode: o.promo_code,
  totals: {
    items: o.items_count,
    subtotal: o.subtotal,
    discountRate: Number(o.discount_rate),
    discount: o.discount,
    delivery: o.delivery_fee,
    total: o.total,
  },
  items: items
    .filter((i) => i.order_id === o.id)
    .map((i) => ({
      slug: i.slug,
      name: i.product_name,
      size: i.size_label,
      qty: i.qty,
      unitPrice: i.unit_price,
      audience: i.audience ?? 'unisex',
    })),
});

/** Order rows → full orders (items + each item's audience) in the same order. */
export const withItems = async (orders, conn = pool) => {
  if (orders.length === 0) return [];
  const [items] = await conn.query(
    `SELECT oi.*, p.audience
       FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id
      WHERE oi.order_id IN (?) ORDER BY oi.id`,
    [orders.map((o) => o.id)],
  );
  return orders.map((o) => shapeOrder(o, items));
};

export const loadOrder = async (where, params, conn = pool) => {
  const [rows] = await conn.query(`SELECT * FROM orders WHERE ${where} LIMIT 1`, params);
  return rows[0] ? (await withItems(rows, conn))[0] : null;
};

/**
 * Copies each product's current unit cost onto the order's lines, so cost of
 * goods stays what it was when sold even after later purchases change it.
 */
export const stampCosts = (conn, orderId) =>
  conn.query(
    `UPDATE order_items oi JOIN products p ON p.id = oi.product_id
        SET oi.unit_cost = p.unit_cost
      WHERE oi.order_id = ?`,
    [orderId],
  );

/** Units per product id for an order's lines (lines of deleted products skipped). */
const unitsByProduct = async (conn, orderId) => {
  const [rows] = await conn.query(
    `SELECT product_id, SUM(qty) AS qty FROM order_items
      WHERE order_id = ? AND product_id IS NOT NULL GROUP BY product_id`,
    [orderId],
  );
  return rows.map((r) => ({ productId: r.product_id, qty: Number(r.qty) }));
};

/** Cancelling puts the order's units back on the shelf. */
export const returnStock = async (conn, orderId) => {
  for (const { productId, qty } of await unitsByProduct(conn, orderId)) {
    await conn.query('UPDATE products SET stock = stock + ? WHERE id = ?', [qty, productId]);
  }
};

/** Reopening a cancelled order takes its units again — 409 if any are short. */
export const takeStock = async (conn, orderId) => {
  const units = await unitsByProduct(conn, orderId);
  if (units.length === 0) return;
  const [products] = await conn.query('SELECT id, name, stock FROM products WHERE id IN (?) FOR UPDATE', [
    units.map((u) => u.productId),
  ]);
  for (const { productId, qty } of units) {
    const p = products.find((x) => x.id === productId);
    if (p && p.stock < qty) {
      throw new HttpError(
        409,
        `Can't reopen: ${p.name} has ${p.stock} in stock but this order needs ${qty}. Restock it first.`,
      );
    }
  }
  for (const { productId, qty } of units) {
    await conn.query('UPDATE products SET stock = stock - ? WHERE id = ?', [qty, productId]);
  }
};
