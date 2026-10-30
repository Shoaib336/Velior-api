// Production batches ("stock purchases"): units of one product size Velior
// has made or bought in, where, and what they cost — as one cost per unit or
// as a breakdown (oil, bottles, packaging…) that adds up to the batch total.
// A batch is either still being made ("ordered": budget committed, no stock
// yet) or "received": its units are on that size's shelf and its cost is
// folded into the size's average purchase price, which new sales copy for
// cost of goods.
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
    size: z.string({ error: 'Pick a size' }).trim().min(1, 'Pick a size').max(30),
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
  size: r.size_label,
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

const lockSize = async (conn, productId, size) => {
  const [[row]] = await conn.query(
    `SELECT ps.id, ps.stock, ps.unit_cost, p.name FROM product_sizes ps JOIN products p ON p.id = ps.product_id
      WHERE ps.product_id = ? AND ps.label = ? FOR UPDATE`,
    [productId, size],
  );
  return row;
};

/** Puts a batch's units on its size's shelf and re-averages that size's purchase price. */
const receive = async (conn, productId, size, { qty, totalCost }) => {
  const row = await lockSize(conn, productId, size);
  if (!row) throw new HttpError(409, `This product no longer has a ${size} size, so the batch has nowhere to go`);
  const units = row.stock + qty;
  // Weighted average; a size with no recorded cost just takes this batch's.
  const unitCost =
    row.unit_cost > 0 && row.stock > 0
      ? Math.round((row.stock * row.unit_cost + totalCost) / units)
      : Math.round(totalCost / qty);
  await conn.query('UPDATE product_sizes SET stock = ?, unit_cost = ? WHERE id = ?', [units, unitCost, row.id]);
  return { size, stock: units, unitCost };
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
    if (!(await lockSize(conn, product.id, body.size))) throw fieldError(400, 'size', `${product.name} has no ${body.size} size`);

    const received = body.status === 'received';
    const [inserted] = await conn.query(
      `INSERT INTO stock_purchases
         (product_id, product_name, size_label, qty, unit_cost, total_cost, costs, supplier, note, purchased_on, status, received_on)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        product.id,
        product.name,
        body.size,
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
    const stock = received ? await receive(conn, product.id, body.size, { qty: body.qty, totalCost: cost.totalCost }) : null;
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
    const stock = await receive(conn, row.product_id, row.size_label, { qty: row.qty, totalCost: row.total_cost });
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
    const size = row.product_id && row.status === 'received' ? await lockSize(conn, row.product_id, row.size_label) : null;
    if (size) {
      if (size.stock < row.qty) {
        throw new HttpError(
          409,
          `Only ${size.stock} of ${size.name} ${row.size_label} left — some of this batch was already sold`,
        );
      }
      await conn.query('UPDATE product_sizes SET stock = stock - ? WHERE id = ?', [row.qty, size.id]);
    }
    await conn.query('DELETE FROM stock_purchases WHERE id = ?', [id]);
  });
  ok(res, null, 'Batch removed');
});

export default router;
