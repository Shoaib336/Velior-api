// Orders for the Sales Manager: filtered lists, one order, and status moves.
import { Router } from 'express';
import { z } from 'zod';
import pool, { transaction } from '../../db.js';
import { HttpError, ok, paging, parse } from '../../lib/http.js';
import { addDays, dayKey, isDayKey, startOf } from '../../lib/dates.js';
import { STATUSES, loadOrder, orderNumber, returnStock, stampCosts, takeStock, withItems } from '../../lib/orders.js';
import { loadSettings } from '../../lib/settings.js';

const router = Router();

// Admin labels, for error messages.
const LABEL = { confirmed: 'New', in_progress: 'Confirmed', delivered: 'Delivered', cancelled: 'Cancelled' };

// Allowed status moves (see the admin README).
const MOVES = {
  confirmed: ['in_progress', 'cancelled'],
  in_progress: ['delivered', 'cancelled', 'confirmed'],
  delivered: ['in_progress'],
  cancelled: ['confirmed'],
};

const like = (value) => `%${value.replace(/[\\%_]/g, '\\$&')}%`;

/** "d21-m03-y26-o1002 " → "D21M03Y26O1002" */
const normaliseNumber = (value) => String(value).replace(/[\s-]+/g, '').toUpperCase().slice(0, 30);

/** WHERE clause for the list filters (status, dates, product/audience/size, search). */
const filterSql = (query) => {
  const where = [];
  const params = [];

  const statuses = String(query.status ?? '')
    .split(',')
    .filter((s) => STATUSES.includes(s));
  if (statuses.length) {
    where.push('o.status IN (?)');
    params.push(statuses);
  }
  if (['online', 'local'].includes(query.channel)) {
    where.push('o.channel = ?');
    params.push(query.channel);
  }
  if (['male', 'female'].includes(query.gender)) {
    where.push('o.customer_gender = ?');
    params.push(query.gender);
  }
  if (isDayKey(query.from ?? '')) {
    where.push('o.placed_at >= ?');
    params.push(startOf(query.from));
  }
  if (isDayKey(query.to ?? '')) {
    where.push('o.placed_at < ?');
    params.push(addDays(startOf(query.to), 1));
  }

  // One line of the order must match every item filter given.
  const item = [];
  if (query.product) {
    item.push('oi.slug = ?');
    params.push(String(query.product));
  }
  if (['men', 'women', 'unisex'].includes(query.audience)) {
    item.push('p.audience = ?');
    params.push(query.audience);
  }
  if (query.size) {
    item.push('oi.size_label = ?');
    params.push(String(query.size));
  }
  if (item.length) {
    where.push(`EXISTS (SELECT 1 FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id
                         WHERE oi.order_id = o.id AND ${item.join(' AND ')})`);
  }

  const q = String(query.q ?? '').trim().slice(0, 100);
  if (q) {
    const ors = ['o.order_number LIKE ?', 'o.customer_name LIKE ?'];
    params.push(like(normaliseNumber(q)), like(q));
    const digits = q.replace(/\D/g, '');
    if (digits.length >= 3) {
      ors.push("REPLACE(REPLACE(REPLACE(o.whatsapp, ' ', ''), '-', ''), '+', '') LIKE ?");
      params.push(like(digits.replace(/^0/, '')));
    }
    where.push(`(${ors.join(' OR ')})`);
  }

  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
};

router.get('/orders', async (req, res) => {
  const { page, pageSize, offset } = paging(req.query);
  const filter = filterSql(req.query);

  const [rows] = await pool.query(
    `SELECT o.* FROM orders o ${filter.sql} ORDER BY o.placed_at DESC, o.id DESC LIMIT ? OFFSET ?`,
    [...filter.params, pageSize, offset],
  );
  const [[summary]] = await pool.query(
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(CASE WHEN o.status = 'delivered' THEN o.total ELSE 0 END), 0) AS value
       FROM orders o ${filter.sql}`,
    filter.params,
  );

  // Stat cards ignore the filters.
  const [byStatus] = await pool.query(
    'SELECT status, COUNT(*) AS n, COALESCE(SUM(total), 0) AS value FROM orders GROUP BY status',
  );
  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  let delivered = 0;
  for (const r of byStatus) {
    counts[r.status] = r.n;
    if (r.status === 'delivered') delivered = Number(r.value);
  }
  counts.all = byStatus.reduce((n, r) => n + r.n, 0);

  ok(res, {
    orders: await withItems(rows),
    total: summary.total,
    page,
    pageSize,
    counts,
    revenue: { delivered },
    summary: { count: summary.total, value: Number(summary.value) },
  });
});

// "Add New Sale": an order entered by hand — a walk-in (local) sale or one
// taken over the phone/WhatsApp (online). Prices are what the admin typed,
// not the catalogue's, so discounts given in person are kept.
const saleSchema = z.object({
  placedAt: z
    .string({ error: 'Pick the sale date' })
    .refine(isDayKey, 'Pick the sale date')
    .refine((d) => d <= dayKey(new Date()), "The sale date can't be in the future"),
  channel: z.enum(['local', 'online'], { error: 'Pick the order type' }).default('local'),
  status: z.enum(['in_progress', 'delivered'], { error: 'Unknown status' }).default('in_progress'),
  customer: z.object({
    fullName: z.string({ error: "Enter the customer's name" }).trim().min(2, "Enter the customer's name").max(120),
    gender: z.enum(['male', 'female']).nullish().transform((v) => v ?? null),
    whatsapp: z
      .string({ error: 'Enter a WhatsApp number' })
      .trim()
      .regex(/^[0-9+\s-]{10,15}$/, 'Enter a valid WhatsApp number'),
    address: z.string({ error: 'Enter the address' }).trim().min(3, 'Enter the address').max(500),
  }),
  items: z
    .array(
      z.object({
        slug: z.string().trim().min(1).max(60),
        size: z.string().trim().min(1).max(30),
        qty: z.number().int('Quantity must be whole units').min(1, 'Quantity must be 1 or more').max(1000),
        unitPrice: z.number().int('Prices are whole rupees').min(0, "A price can't be negative").max(10_000_000),
      }),
    )
    .min(1, 'Add at least one product')
    .max(50),
  discountRate: z.number().min(0).max(1, 'The discount can be at most 100%').default(0),
  delivery: z.number().int('The delivery fee is whole rupees').min(0).max(100_000).default(0),
});

router.post('/orders', async (req, res) => {
  const body = parse(saleSchema, req.body);

  const id = await transaction(async (conn) => {
    const slugs = [...new Set(body.items.map((i) => i.slug))];
    const [products] = await conn.query('SELECT id, slug, name, stock FROM products WHERE slug IN (?) FOR UPDATE', [slugs]);
    const [sizes] = products.length
      ? await conn.query('SELECT product_id, label FROM product_sizes WHERE product_id IN (?)', [products.map((p) => p.id)])
      : [[]];
    const bySlug = new Map(products.map((p) => [p.slug, p]));

    body.items.forEach((line, i) => {
      const product = bySlug.get(line.slug);
      if (!product) throw new HttpError(400, `"${line.slug}" isn't in the catalogue`, { [`items.${i}.slug`]: 'Unknown product' });
      if (!sizes.some((s) => s.product_id === product.id && s.label === line.size)) {
        throw new HttpError(400, `${product.name} has no ${line.size} size`, { [`items.${i}.size`]: 'Unknown size' });
      }
    });

    // Stock is per product, across every size sold.
    for (const product of products) {
      const wanted = body.items.filter((l) => l.slug === product.slug).reduce((n, l) => n + l.qty, 0);
      if (wanted > product.stock) {
        throw new HttpError(
          409,
          product.stock > 0 ? `Only ${product.stock} of ${product.name} in stock` : `${product.name} is out of stock`,
        );
      }
    }

    const items = body.items.reduce((n, l) => n + l.qty, 0);
    const subtotal = body.items.reduce((n, l) => n + l.qty * l.unitPrice, 0);
    const discountRate = Math.round(body.discountRate * 1000) / 1000;
    const discount = Math.round(subtotal * discountRate);
    const total = subtotal - discount + body.delivery;
    // Today's sales keep the real time; back-dated ones sit at midday.
    const placedAt = body.placedAt === dayKey(new Date()) ? new Date() : new Date(`${body.placedAt}T12:00:00`);
    const { store } = await loadSettings(conn);
    const delivered = body.status === 'delivered';

    const [inserted] = await conn.query(
      `INSERT INTO orders (customer_name, customer_gender, whatsapp, address, payment_method, channel, status,
         items_count, subtotal, discount_rate, discount, delivery_fee, total, estimated_delivery,
         placed_at, confirmed_at, in_progress_at, delivered_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        body.customer.fullName,
        body.customer.gender,
        body.customer.whatsapp,
        body.customer.address,
        body.channel === 'local' ? 'Cash' : 'Cash on Delivery',
        body.channel,
        body.status,
        items,
        subtotal,
        discountRate,
        discount,
        body.delivery,
        total,
        store.estimatedDelivery,
        placedAt,
        placedAt,
        placedAt,
        delivered ? placedAt : null,
      ],
    );
    await conn.query('UPDATE orders SET order_number = ? WHERE id = ?', [orderNumber(placedAt, inserted.insertId), inserted.insertId]);

    await conn.query(
      'INSERT INTO order_items (order_id, product_id, slug, product_name, size_label, qty, unit_price) VALUES ?',
      [
        body.items.map((l) => {
          const p = bySlug.get(l.slug);
          return [inserted.insertId, p.id, p.slug, p.name, l.size, l.qty, l.unitPrice];
        }),
      ],
    );
    await stampCosts(conn, inserted.insertId);
    for (const product of products) {
      const wanted = body.items.filter((l) => l.slug === product.slug).reduce((n, l) => n + l.qty, 0);
      await conn.query('UPDATE products SET stock = stock - ? WHERE id = ?', [wanted, product.id]);
    }
    return inserted.insertId;
  });

  ok(res, { order: await loadOrder('id = ?', [id]) }, 'Sale added', 201);
});

router.get('/orders/:number', async (req, res) => {
  const order = await loadOrder('order_number = ?', [normaliseNumber(req.params.number)]);
  if (!order) throw new HttpError(404, 'Order not found');
  ok(res, { order });
});

const patchSchema = z
  .object({
    status: z.enum(STATUSES, { error: 'Unknown status' }).optional(),
    estimatedDelivery: z.string().trim().min(1, 'Enter a delivery estimate').max(60).optional(),
  })
  .refine((p) => p.status || p.estimatedDelivery, 'Nothing to update');

router.patch('/orders/:number', async (req, res) => {
  const body = parse(patchSchema, req.body);
  const number = normaliseNumber(req.params.number);

  const order = await transaction(async (conn) => {
    const [[row]] = await conn.query('SELECT * FROM orders WHERE order_number = ? FOR UPDATE', [number]);
    if (!row) throw new HttpError(404, 'Order not found');

    const sets = [];
    const params = [];
    if (body.estimatedDelivery) {
      sets.push('estimated_delivery = ?');
      params.push(body.estimatedDelivery);
    }

    const from = row.status;
    const to = body.status;
    if (to && to !== from) {
      if (!MOVES[from].includes(to)) {
        throw new HttpError(409, `A ${LABEL[from].toLowerCase()} order can't be moved to ${LABEL[to].toLowerCase()}`);
      }
      sets.push('status = ?');
      params.push(to);
      if (to === 'in_progress') sets.push(from === 'confirmed' ? 'in_progress_at = NOW()' : 'delivered_at = NULL');
      if (to === 'delivered') sets.push('delivered_at = NOW()');
      if (to === 'confirmed') sets.push('in_progress_at = NULL', 'delivered_at = NULL', 'cancelled_at = NULL');
      if (to === 'cancelled') {
        sets.push('cancelled_at = NOW()');
        await returnStock(conn, row.id);
      }
      if (from === 'cancelled') await takeStock(conn, row.id);
    }

    if (sets.length) await conn.query(`UPDATE orders SET ${sets.join(', ')} WHERE id = ?`, [...params, row.id]);
    return loadOrder('id = ?', [row.id], conn);
  });

  ok(res, { order }, 'Order updated');
});

export default router;
