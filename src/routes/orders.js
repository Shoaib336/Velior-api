// Place an order (server re-prices everything) and look one up for tracking.
import { Router } from 'express';
import { z } from 'zod';
import { transaction } from '../db.js';
import { loadProducts, findPromo } from '../lib/catalogue.js';
import { HttpError, ok, parse } from '../lib/http.js';
import { loadOrder, orderNumber, stampCosts } from '../lib/orders.js';
import { loadSettings } from '../lib/settings.js';
import { takeStock } from '../lib/stock.js';

const router = Router();

const PAYMENT_METHODS = { cod: 'Cash on Delivery' };

// Same rules as the storefront's checkout form.
const orderSchema = z.object({
  customer: z.object({
    fullName: z.string().trim().min(2, 'Please enter your full name').max(120),
    gender: z.enum(['male', 'female'], { error: 'Please select your gender' }),
    whatsapp: z
      .string()
      .trim()
      .regex(/^[0-9+\s-]{10,15}$/, 'Please enter a valid WhatsApp number'),
    address: z.string().trim().min(10, 'Please enter your full delivery address').max(500),
  }),
  items: z
    .array(
      z.object({
        slug: z.string().trim().min(1).max(60),
        size: z.string().trim().min(1).max(30),
        qty: z.number().int().min(1).max(20),
      }),
    )
    .min(1, 'Your cart is empty')
    .max(30),
  promo: z.string().trim().max(40).optional(),
  paymentMethod: z.enum(['cod']).default('cod'),
});

router.post('/orders', async (req, res) => {
  const body = parse(orderSchema, req.body);

  // Merge duplicate slug+size lines so stock is counted once.
  const merged = new Map();
  for (const line of body.items) {
    const key = `${line.slug}|${line.size}`;
    merged.set(key, { ...line, qty: (merged.get(key)?.qty ?? 0) + line.qty });
  }
  const lines = [...merged.values()];

  const id = await transaction(async (conn) => {
    const products = await loadProducts(conn, {
      slugs: [...new Set(lines.map((l) => l.slug))],
      lock: true,
    });
    const bySlug = new Map(products.map((p) => [p.slug, p]));

    const rows = lines.map((line) => {
      const product = bySlug.get(line.slug);
      const size = product?.sizes.find((s) => s.label === line.size);
      if (!product || !size) {
        throw new HttpError(400, `"${line.slug}" (${line.size}) is no longer available`);
      }
      return { ...line, product, name: product.name, unitPrice: size.salePrice ?? size.price };
    });

    // Stock is per size; 409 when one is short.
    await takeStock(conn, rows.map((r) => ({ productId: r.product.id, size: r.size, qty: r.qty })));

    const promo = body.promo ? await findPromo(conn, body.promo) : null;
    if (body.promo && !promo) throw new HttpError(400, 'Invalid promo code');

    const items = rows.reduce((n, r) => n + r.qty, 0);
    const subtotal = rows.reduce((n, r) => n + r.unitPrice * r.qty, 0);
    const discountRate = promo?.rate ?? 0;
    const discount = Math.round(subtotal * discountRate);
    const { store } = await loadSettings(conn);
    const total = subtotal - discount + store.deliveryFee;

    const placedAt = new Date();
    const [inserted] = await conn.query(
      `INSERT INTO orders (customer_name, customer_gender, whatsapp, address, payment_method, promo_code,
         items_count, subtotal, discount_rate, discount, delivery_fee, total, estimated_delivery, confirmed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        body.customer.fullName,
        body.customer.gender,
        body.customer.whatsapp,
        body.customer.address,
        PAYMENT_METHODS[body.paymentMethod],
        promo?.code ?? null,
        items,
        subtotal,
        discountRate,
        discount,
        store.deliveryFee,
        total,
        store.estimatedDelivery,
      ],
    );
    const number = orderNumber(placedAt, inserted.insertId);
    await conn.query('UPDATE orders SET order_number = ? WHERE id = ?', [number, inserted.insertId]);

    await conn.query(
      'INSERT INTO order_items (order_id, product_id, slug, product_name, size_label, qty, unit_price) VALUES ?',
      [rows.map((r) => [inserted.insertId, r.product.id, r.slug, r.name, r.size, r.qty, r.unitPrice])],
    );
    await stampCosts(conn, inserted.insertId);

    return inserted.insertId;
  });

  ok(res, { order: await loadOrder('id = ?', [id]) }, 'Order placed', 201);
});

// Full number ("D25M09Y26O1002", spaces/case ignored) or just the running
// number ("1002"), like the storefront's tracking box.
router.get('/orders/track/:query', async (req, res) => {
  const key = req.params.query.replace(/\s+/g, '').toUpperCase().slice(0, 30);
  if (!key) throw new HttpError(400, 'Enter an order number');

  const order = /^\d+$/.test(key)
    ? await loadOrder('order_number LIKE ?', [`%O${key}`])
    : await loadOrder('order_number = ?', [key]);
  if (!order) throw new HttpError(404, `We couldn't find an order matching "${req.params.query}"`);
  ok(res, { order });
});

export default router;
