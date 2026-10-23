// "Purchase stock": units bought in from a supplier. Each purchase adds to
// the product's stock and folds its cost into the product's average unit
// cost, which new sales copy onto their lines for cost of goods.
import { Router } from 'express';
import { z } from 'zod';
import pool, { transaction } from '../../db.js';
import { HttpError, fieldError, idParam, ok, paging, parse } from '../../lib/http.js';
import { dayKey, isDayKey } from '../../lib/dates.js';

const router = Router();

const schema = z.object({
  slug: z.string({ error: 'Pick a product' }).trim().min(1, 'Pick a product').max(60),
  qty: z
    .number({ error: 'Enter how many units arrived' })
    .int('Units must be whole numbers')
    .min(1, 'Enter how many units arrived')
    .max(1_000_000, 'That is too many units'),
  unitCost: z
    .number({ error: 'Enter the cost per unit' })
    .int('The cost is whole rupees')
    .min(0, "The cost can't be negative")
    .max(10_000_000, 'That cost is too large'),
  supplier: z.string().trim().max(120).default(''),
  note: z.string().trim().max(200).default(''),
  purchasedOn: z
    .string()
    .refine(isDayKey, 'Pick the purchase date')
    .refine((d) => d <= dayKey(new Date()), "The date can't be in the future")
    .default(() => dayKey(new Date())),
});

const shape = (r) => ({
  id: r.id,
  slug: r.slug,
  productName: r.product_name,
  qty: r.qty,
  unitCost: r.unit_cost,
  totalCost: r.qty * r.unit_cost,
  supplier: r.supplier,
  note: r.note,
  purchasedOn: r.purchased_on,
  createdAt: r.created_at,
});

const SELECT = `SELECT sp.*, p.slug FROM stock_purchases sp LEFT JOIN products p ON p.id = sp.product_id`;

router.get('/stock-purchases', async (req, res) => {
  const { page, pageSize, offset } = paging(req.query);
  const [rows] = await pool.query(`${SELECT} ORDER BY sp.purchased_on DESC, sp.id DESC LIMIT ? OFFSET ?`, [
    pageSize,
    offset,
  ]);
  const [[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM stock_purchases');
  ok(res, { purchases: rows.map(shape), total, page, pageSize });
});

router.post('/stock-purchases', async (req, res) => {
  const body = parse(schema, req.body);
  const result = await transaction(async (conn) => {
    const [[product]] = await conn.query('SELECT id, name, stock, unit_cost FROM products WHERE slug = ? FOR UPDATE', [
      body.slug,
    ]);
    if (!product) throw fieldError(404, 'slug', 'Product not found');

    // Weighted average; a product with no recorded cost just takes this one.
    const units = product.stock + body.qty;
    const unitCost =
      product.unit_cost > 0 && product.stock > 0
        ? Math.round((product.stock * product.unit_cost + body.qty * body.unitCost) / units)
        : body.unitCost;

    const [inserted] = await conn.query(
      `INSERT INTO stock_purchases (product_id, product_name, qty, unit_cost, supplier, note, purchased_on)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [product.id, product.name, body.qty, body.unitCost, body.supplier, body.note, body.purchasedOn],
    );
    await conn.query('UPDATE products SET stock = ?, unit_cost = ? WHERE id = ?', [units, unitCost, product.id]);

    const [[row]] = await conn.query(`${SELECT} WHERE sp.id = ?`, [inserted.insertId]);
    return { purchase: shape(row), product: { slug: body.slug, stock: units, unitCost } };
  });
  ok(res, result, 'Stock purchase saved', 201);
});

// Undo a purchase entered by mistake: takes its units back off the shelf
// (409 if some were already sold). The average cost is left as it is.
router.delete('/stock-purchases/:id', async (req, res) => {
  const id = idParam(req.params.id);
  await transaction(async (conn) => {
    const [[row]] = await conn.query('SELECT * FROM stock_purchases WHERE id = ? FOR UPDATE', [id]);
    if (!row) throw new HttpError(404, 'Purchase not found');
    if (row.product_id) {
      const [[product]] = await conn.query('SELECT stock, name FROM products WHERE id = ? FOR UPDATE', [row.product_id]);
      if (product && product.stock < row.qty) {
        throw new HttpError(409, `Only ${product.stock} of ${product.name} left — some of this purchase was already sold`);
      }
      await conn.query('UPDATE products SET stock = stock - ? WHERE id = ?', [row.qty, row.product_id]);
    }
    await conn.query('DELETE FROM stock_purchases WHERE id = ?', [id]);
  });
  ok(res, null, 'Stock purchase removed');
});

export default router;
