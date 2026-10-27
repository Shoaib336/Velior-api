// Production batches ("stock purchases"): units Velior has made or bought
// in, where, and what they cost — as one cost per unit or as a breakdown
// (oil, bottles, packaging…) that adds up to the batch total. A batch is
// either still being made ("ordered": budget committed, no stock yet) or
// "received": its units are on the shelf and its cost is folded into the
// product's average unit cost, which new sales copy for cost of goods.
import { Router } from 'express';
import { z } from 'zod';
import pool, { transaction } from '../../db.js';
import { HttpError, fieldError, idParam, ok, paging, parse } from '../../lib/http.js';
import { dayKey, isDayKey } from '../../lib/dates.js';

const router = Router();

const rupees = z
  .number({ error: 'Enter the amount' })
  .int('Amounts are whole rupees')
  .min(0, "Amounts can't be negative")
  .max(100_000_000, 'That amount is too large');

const day = (message) =>
  z
    .string()
    .refine(isDayKey, message)
    .refine((d) => d <= dayKey(new Date()), "The date can't be in the future");

const fields = {
  qty: z
    .number({ error: 'Enter how many units' })
    .int('Units must be whole numbers')
    .min(1, 'Enter how many units')
    .max(1_000_000, 'That is too many units'),
  unitCost: rupees.max(10_000_000, 'That cost is too large').optional(),
  costs: z
    .array(
      z.object({
        label: z.string().trim().min(1, 'Name this cost, e.g. Bottles').max(60),
        amount: rupees,
      }),
    )
    .max(12, 'Up to 12 cost lines')
    .optional(),
  supplier: z.string().trim().max(120),
  note: z.string().trim().max(200),
  purchasedOn: day('Pick the date'),
};

// Either a breakdown or a cost per unit gives the batch its cost.
const needsCost = (b) => b.unitCost !== undefined || b.costs?.length > 0;

const createSchema = z
  .object({
    slug: z.string({ error: 'Pick a product' }).trim().min(1, 'Pick a product').max(60),
    ...fields,
    supplier: fields.supplier.default(''),
    note: fields.note.default(''),
    purchasedOn: fields.purchasedOn.default(() => dayKey(new Date())),
    status: z.enum(['ordered', 'received']).default('received'),
  })
  .refine(needsCost, { message: 'Enter the cost per unit', path: ['unitCost'] });

const patchSchema = z.object(fields).partial();

const receiveSchema = z.object({ receivedOn: day('Pick the date it arrived').default(() => dayKey(new Date())) });

/** → { unitCost, totalCost, costs } — the breakdown wins when there is one. */
const pricing = ({ qty, unitCost, costs }) => {
  if (costs?.length) {
    const totalCost = costs.reduce((sum, c) => sum + c.amount, 0);
    return { unitCost: Math.round(totalCost / qty), totalCost, costs };
  }
  return { unitCost, totalCost: qty * unitCost, costs: null };
};

const parseCosts = (value) => (typeof value === 'string' ? JSON.parse(value) : value) ?? [];

const shape = (r) => ({
  id: r.id,
  slug: r.slug,
  productName: r.product_name,
  qty: r.qty,
  unitCost: r.unit_cost,
  totalCost: r.total_cost,
  costs: parseCosts(r.costs),
  supplier: r.supplier,
  note: r.note,
  status: r.status,
  purchasedOn: r.purchased_on,
  receivedOn: r.received_on,
  createdAt: r.created_at,
});

const SELECT = `SELECT sp.*, p.slug FROM stock_purchases sp LEFT JOIN products p ON p.id = sp.product_id`;

const findOne = async (conn, id) => {
  const [[row]] = await conn.query(`${SELECT} WHERE sp.id = ?`, [id]);
  return shape(row);
};

/** Puts a batch's units on the shelf and re-averages the product's unit cost. */
const receive = async (conn, productId, { qty, totalCost }) => {
  const [[product]] = await conn.query('SELECT stock, unit_cost FROM products WHERE id = ? FOR UPDATE', [productId]);
  const units = product.stock + qty;
  // Weighted average; a product with no recorded cost just takes this batch's.
  const unitCost =
    product.unit_cost > 0 && product.stock > 0
      ? Math.round((product.stock * product.unit_cost + totalCost) / units)
      : Math.round(totalCost / qty);
  await conn.query('UPDATE products SET stock = ?, unit_cost = ? WHERE id = ?', [units, unitCost, productId]);
  return { stock: units, unitCost };
};

// Filters: q (product, supplier or note), status, slug, from/to (batch date).
// The summary covers every matching batch, not just the page.
router.get('/stock-purchases', async (req, res) => {
  const { page, pageSize, offset } = paging(req.query);
  const where = [];
  const params = [];
  const q = String(req.query.q ?? '').trim();
  if (q) {
    where.push('(sp.product_name LIKE ? OR sp.supplier LIKE ? OR sp.note LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (['ordered', 'received'].includes(req.query.status)) {
    where.push('sp.status = ?');
    params.push(req.query.status);
  }
  if (req.query.slug) {
    where.push('p.slug = ?');
    params.push(String(req.query.slug));
  }
  if (isDayKey(req.query.from ?? '')) {
    where.push('sp.purchased_on >= ?');
    params.push(req.query.from);
  }
  if (isDayKey(req.query.to ?? '')) {
    where.push('sp.purchased_on <= ?');
    params.push(req.query.to);
  }
  const sql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [rows] = await pool.query(`${SELECT} ${sql} ORDER BY sp.purchased_on DESC, sp.id DESC LIMIT ? OFFSET ?`, [
    ...params,
    pageSize,
    offset,
  ]);
  const [[summary]] = await pool.query(
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(sp.total_cost), 0) AS spent,
            COALESCE(SUM(CASE WHEN sp.status = 'received' THEN sp.qty ELSE 0 END), 0) AS unitsReceived,
            COALESCE(SUM(CASE WHEN sp.status = 'received' THEN sp.total_cost ELSE 0 END), 0) AS receivedCost,
            COALESCE(SUM(CASE WHEN sp.status = 'ordered' THEN 1 ELSE 0 END), 0) AS inProduction,
            COALESCE(SUM(CASE WHEN sp.status = 'ordered' THEN sp.qty ELSE 0 END), 0) AS unitsInProduction,
            COALESCE(SUM(CASE WHEN sp.status = 'ordered' THEN sp.total_cost ELSE 0 END), 0) AS inProductionCost
       FROM stock_purchases sp LEFT JOIN products p ON p.id = sp.product_id ${sql}`,
    params,
  );
  const n = Number;
  ok(res, {
    purchases: rows.map(shape),
    total: n(summary.total),
    page,
    pageSize,
    summary: {
      spent: n(summary.spent),
      unitsReceived: n(summary.unitsReceived),
      receivedCost: n(summary.receivedCost),
      inProduction: n(summary.inProduction),
      unitsInProduction: n(summary.unitsInProduction),
      inProductionCost: n(summary.inProductionCost),
    },
  });
});

router.post('/stock-purchases', async (req, res) => {
  const body = parse(createSchema, req.body);
  const cost = pricing(body);
  const result = await transaction(async (conn) => {
    const [[product]] = await conn.query('SELECT id, name FROM products WHERE slug = ? FOR UPDATE', [body.slug]);
    if (!product) throw fieldError(404, 'slug', 'Product not found');

    const received = body.status === 'received';
    const [inserted] = await conn.query(
      `INSERT INTO stock_purchases
         (product_id, product_name, qty, unit_cost, total_cost, costs, supplier, note, purchased_on, status, received_on)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        product.id,
        product.name,
        body.qty,
        cost.unitCost,
        cost.totalCost,
        cost.costs && JSON.stringify(cost.costs),
        body.supplier,
        body.note,
        body.purchasedOn,
        body.status,
        received ? body.purchasedOn : null,
      ],
    );
    const stock = received ? await receive(conn, product.id, { qty: body.qty, totalCost: cost.totalCost }) : null;
    return { purchase: await findOne(conn, inserted.insertId), product: stock && { slug: body.slug, ...stock } };
  });
  ok(res, result, body.status === 'received' ? 'Added to stock' : 'Batch saved', 201);
});

// Supplier, note and date can always change. Units and cost only while the
// batch is still being made — once received they're in stock and costs.
router.patch('/stock-purchases/:id', async (req, res) => {
  const id = idParam(req.params.id);
  const body = parse(patchSchema, req.body);
  const purchase = await transaction(async (conn) => {
    const [[row]] = await conn.query('SELECT * FROM stock_purchases WHERE id = ? FOR UPDATE', [id]);
    if (!row) throw new HttpError(404, 'Batch not found');
    const cols = {};
    if (body.supplier !== undefined) cols.supplier = body.supplier;
    if (body.note !== undefined) cols.note = body.note;
    if (body.purchasedOn !== undefined) cols.purchased_on = body.purchasedOn;
    if (body.qty !== undefined || needsCost(body)) {
      if (row.status === 'received') {
        throw new HttpError(409, "This batch is already in stock, so its units and cost can't change");
      }
      const qty = body.qty ?? row.qty;
      const saved = parseCosts(row.costs);
      const cost = pricing(
        needsCost(body)
          ? { qty, unitCost: body.unitCost, costs: body.costs }
          : saved.length
            ? { qty, costs: saved }
            : { qty, unitCost: row.unit_cost },
      );
      Object.assign(cols, {
        qty,
        unit_cost: cost.unitCost,
        total_cost: cost.totalCost,
        costs: cost.costs && JSON.stringify(cost.costs),
      });
    }
    if (Object.keys(cols).length) await conn.query('UPDATE stock_purchases SET ? WHERE id = ?', [cols, id]);
    return findOne(conn, id);
  });
  ok(res, { purchase }, 'Batch saved');
});

// A batch in production has arrived: its units go on the shelf.
router.post('/stock-purchases/:id/receive', async (req, res) => {
  const id = idParam(req.params.id);
  const { receivedOn } = parse(receiveSchema, req.body ?? {});
  const result = await transaction(async (conn) => {
    const [[row]] = await conn.query(`${SELECT} WHERE sp.id = ? FOR UPDATE`, [id]);
    if (!row) throw new HttpError(404, 'Batch not found');
    if (row.status === 'received') throw new HttpError(409, 'This batch is already in stock');
    if (!row.product_id) throw new HttpError(409, 'This product was deleted, so the batch has nowhere to go');
    if (receivedOn < row.purchased_on) throw fieldError(400, 'receivedOn', "It can't arrive before it was ordered");
    await conn.query("UPDATE stock_purchases SET status = 'received', received_on = ? WHERE id = ?", [receivedOn, id]);
    const stock = await receive(conn, row.product_id, { qty: row.qty, totalCost: row.total_cost });
    return { purchase: await findOne(conn, id), product: { slug: row.slug, ...stock } };
  });
  ok(res, result, 'Added to stock');
});

// Undo a batch entered by mistake. A received one takes its units back off
// the shelf (409 if some were already sold); the average cost is left as it is.
router.delete('/stock-purchases/:id', async (req, res) => {
  const id = idParam(req.params.id);
  await transaction(async (conn) => {
    const [[row]] = await conn.query('SELECT * FROM stock_purchases WHERE id = ? FOR UPDATE', [id]);
    if (!row) throw new HttpError(404, 'Batch not found');
    if (row.product_id && row.status === 'received') {
      const [[product]] = await conn.query('SELECT stock, name FROM products WHERE id = ? FOR UPDATE', [row.product_id]);
      if (product && product.stock < row.qty) {
        throw new HttpError(409, `Only ${product.stock} of ${product.name} left — some of this batch was already sold`);
      }
      await conn.query('UPDATE products SET stock = stock - ? WHERE id = ?', [row.qty, row.product_id]);
    }
    await conn.query('DELETE FROM stock_purchases WHERE id = ?', [id]);
  });
  ok(res, null, 'Batch removed');
});

export default router;
