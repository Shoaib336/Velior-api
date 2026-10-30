// The order shape shared by checkout, tracking and the admin, plus the
// stock moves a status change implies.
import pool from '../db.js';
import { linesOf, returnStock as putBack, takeStock as take } from './stock.js';

export const STATUSES = ['confirmed', 'in_progress', 'delivered', 'cancelled'];

/** "D25M09Y26O1001" — day, month, two-digit year, then the order id. */
export const orderNumber = (date, id) => {
  const pad = (n) => String(n).padStart(2, '0');
  return `D${pad(date.getDate())}M${pad(date.getMonth() + 1)}Y${pad(date.getFullYear() % 100)}O${id}`;
};

const iso = (value) => (value ? new Date(value).toISOString() : null);

/** `admin` adds purchase prices (per line, and the order's total cost) — never sent to customers. */
export const shapeOrder = (o, items, { admin = false } = {}) => {
  const own = items.filter((i) => i.order_id === o.id);
  return {
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
      ...(admin && { cost: own.reduce((n, i) => n + i.qty * i.unit_cost, 0) }),
    },
    items: own.map((i) => ({
      slug: i.slug,
      name: i.product_name,
      size: i.size_label,
      qty: i.qty,
      unitPrice: i.unit_price,
      ...(admin && { unitCost: i.unit_cost }),
      audience: i.audience ?? 'unisex',
    })),
  };
};

/** Order rows → full orders (items + each item's audience) in the same order. */
export const withItems = async (orders, conn = pool, options) => {
  if (orders.length === 0) return [];
  const [items] = await conn.query(
    `SELECT oi.*, p.audience
       FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id
      WHERE oi.order_id IN (?) ORDER BY oi.id`,
    [orders.map((o) => o.id)],
  );
  return orders.map((o) => shapeOrder(o, items, options));
};

export const loadOrder = async (where, params, conn = pool, options) => {
  const [rows] = await conn.query(`SELECT * FROM orders WHERE ${where} LIMIT 1`, params);
  return rows[0] ? (await withItems(rows, conn, options))[0] : null;
};

/**
 * Copies each size's current purchase price onto the order's lines, so cost
 * of goods stays what it was when sold even after later batches change it.
 */
export const stampCosts = (conn, orderId) =>
  conn.query(
    `UPDATE order_items oi JOIN product_sizes ps ON ps.product_id = oi.product_id AND ps.label = oi.size_label
        SET oi.unit_cost = ps.unit_cost
      WHERE oi.order_id = ?`,
    [orderId],
  );

/** Cancelling puts the order's units back on the shelf. */
export const returnStock = async (conn, orderId) => putBack(conn, await linesOf(conn, 'order_items', 'order_id', orderId));

/** Reopening a cancelled order takes its units again — 409 if any size is short. */
export const takeStock = async (conn, orderId) =>
  take(conn, await linesOf(conn, 'order_items', 'order_id', orderId), {
    prefix: "Can't reopen — restock first: ",
  });
