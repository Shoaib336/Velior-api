// Stock supplied to partner stores. Each delivery is an invoice numbered per
// store (1, 2, 3…); it takes the units off Velior's stock like a sale does,
// and the store's payments against it are recorded as they come in. Lines
// keep their purchase price for the admin's margins; the printed invoice
// shows only the sale price.
import { Router } from 'express';
import { z } from 'zod';
import pool, { transaction } from '../../db.js';
import { HttpError, idParam, ok, parse } from '../../lib/http.js';
import { dayKey, isDayKey } from '../../lib/dates.js';
import { linesOf, lockSizes, returnStock as putBack, sizeOf, takeStock } from '../../lib/stock.js';

const router = Router();

const rupees = (n) => Number(n).toLocaleString('en-US');

const day = (label) =>
  z
    .string({ error: `Pick the ${label}` })
    .refine(isDayKey, `Pick the ${label}`)
    .refine((d) => d <= dayKey(new Date()), `The ${label} can't be in the future`);

const amount = (label) =>
  z
    .number({ error: `Enter the ${label}` })
    .int(`The ${label} is whole rupees`)
    .min(1, `The ${label} must be more than 0`)
    .max(100_000_000, `The ${label} is too large`);

const invoiceSchema = z.object({
  issuedOn: day('invoice date'),
  note: z.string().trim().max(200).default(''),
  items: z
    .array(
      z.object({
        slug: z.string().trim().min(1).max(60),
        size: z.string().trim().min(1).max(30),
        qty: z.number().int('Quantity must be whole units').min(1, 'Quantity must be 1 or more').max(10_000),
        unitPrice: z.number().int('Prices are whole rupees').min(0, "A price can't be negative").max(10_000_000),
        unitCost: z
          .number()
          .int('Purchase prices are whole rupees')
          .min(0, "A purchase price can't be negative")
          .max(10_000_000)
          .nullish(),
      }),
    )
    .min(1, 'Add at least one product')
    .max(100),
});

const paymentSchema = z.object({
  amount: amount('amount'),
  paidOn: day('payment date'),
  note: z.string().trim().max(200).default(''),
});

// A new invoice may record what the store paid on the spot.
const createSchema = invoiceSchema.extend({ payment: paymentSchema.nullish() });

const shapeInvoice = (inv, items, payments) => {
  const received = payments.reduce((n, p) => n + p.amount, 0);
  const cost = items.reduce((n, i) => n + i.qty * i.unit_cost, 0);
  return {
    id: inv.id,
    storeId: inv.store_id,
    number: inv.invoice_no,
    issuedOn: inv.issued_on,
    note: inv.note,
    units: inv.items_count,
    total: inv.total,
    received,
    pending: Math.max(0, inv.total - received),
    cost,
    margin: inv.total - cost,
    items: items.map((i) => ({
      slug: i.slug,
      name: i.product_name,
      size: i.size_label,
      qty: i.qty,
      unitPrice: i.unit_price,
      unitCost: i.unit_cost,
    })),
    payments: payments.map((p) => ({ id: p.id, amount: p.amount, paidOn: p.paid_on, note: p.note })),
  };
};

/** Invoice rows → full invoices (lines + payments) in the same order. */
const withDetails = async (invoices, conn = pool) => {
  if (invoices.length === 0) return [];
  const ids = invoices.map((i) => i.id);
  const [items] = await conn.query('SELECT * FROM partner_invoice_items WHERE invoice_id IN (?) ORDER BY id', [ids]);
  const [payments] = await conn.query(
    'SELECT * FROM partner_payments WHERE invoice_id IN (?) ORDER BY paid_on, id',
    [ids],
  );
  return invoices.map((inv) =>
    shapeInvoice(
      inv,
      items.filter((i) => i.invoice_id === inv.id),
      payments.filter((p) => p.invoice_id === inv.id),
    ),
  );
};

const loadInvoice = async (id, conn = pool) => {
  const [rows] = await conn.query('SELECT * FROM partner_invoices WHERE id = ?', [id]);
  if (!rows[0]) throw new HttpError(404, 'Invoice not found');
  return (await withDetails(rows, conn))[0];
};

const shapeStore = (s) => ({
  id: s.id,
  name: s.name,
  city: s.city,
  contactName: s.contact_name,
  phone: s.phone,
  address: s.address,
  isActive: Boolean(s.is_active),
});

const loadStore = async (id, conn = pool, { lock = false } = {}) => {
  const [[row]] = await conn.query(`SELECT * FROM partner_stores WHERE id = ?${lock ? ' FOR UPDATE' : ''}`, [id]);
  if (!row) throw new HttpError(404, 'Store not found');
  return row;
};

const returnStock = async (conn, invoiceId) =>
  putBack(conn, await linesOf(conn, 'partner_invoice_items', 'invoice_id', invoiceId));

/**
 * Checks every line against the catalogue and the stock on hand, writes the
 * lines and takes the units (per size). A line's purchase price is what the
 * admin entered, else its size's average cost.
 */
const writeLines = async (conn, invoiceId, lines) => {
  const slugs = [...new Set(lines.map((l) => l.slug))];
  const [products] = await conn.query('SELECT id, slug, name FROM products WHERE slug IN (?) FOR UPDATE', [slugs]);
  const sizes = await lockSizes(conn, products.map((p) => p.id));
  const bySlug = new Map(products.map((p) => [p.slug, p]));

  lines.forEach((line, i) => {
    const product = bySlug.get(line.slug);
    if (!product) throw new HttpError(400, `"${line.slug}" isn't in the catalogue`, { [`items.${i}.slug`]: 'Unknown product' });
    if (!sizeOf(sizes, product.id, line.size)) {
      throw new HttpError(400, `${product.name} has no ${line.size} size`, { [`items.${i}.size`]: 'Unknown size' });
    }
  });

  await takeStock(conn, lines.map((l) => ({ productId: bySlug.get(l.slug).id, size: l.size, qty: l.qty })));

  await conn.query(
    `INSERT INTO partner_invoice_items (invoice_id, product_id, slug, product_name, size_label, qty, unit_price, unit_cost)
     VALUES ?`,
    [
      lines.map((l) => {
        const p = bySlug.get(l.slug);
        const unitCost = l.unitCost ?? sizeOf(sizes, p.id, l.size).unit_cost;
        return [invoiceId, p.id, p.slug, p.name, l.size, l.qty, l.unitPrice, unitCost];
      }),
    ],
  );

  return {
    units: lines.reduce((n, l) => n + l.qty, 0),
    total: lines.reduce((n, l) => n + l.qty * l.unitPrice, 0),
  };
};

const receivedOn = async (conn, invoiceId) => {
  const [[{ received }]] = await conn.query(
    'SELECT COALESCE(SUM(amount), 0) AS received FROM partner_payments WHERE invoice_id = ?',
    [invoiceId],
  );
  return Number(received);
};

// The store's ledger: every invoice (newest first) and the running totals.
router.get('/partner-stores/:id/invoices', async (req, res) => {
  const store = await loadStore(idParam(req.params.id));
  const [rows] = await pool.query('SELECT * FROM partner_invoices WHERE store_id = ? ORDER BY invoice_no DESC', [store.id]);
  const invoices = await withDetails(rows);
  const sum = (key) => invoices.reduce((n, i) => n + i[key], 0);
  ok(res, {
    store: shapeStore(store),
    invoices,
    summary: {
      invoices: invoices.length,
      units: sum('units'),
      business: sum('total'),
      received: sum('received'),
      pending: sum('pending'),
      cost: sum('cost'),
      margin: sum('margin'),
    },
  });
});

router.get('/partner-invoices/:id', async (req, res) => {
  const invoice = await loadInvoice(idParam(req.params.id));
  ok(res, { invoice, store: shapeStore(await loadStore(invoice.storeId)) });
});

router.post('/partner-stores/:id/invoices', async (req, res) => {
  const storeId = idParam(req.params.id);
  const body = parse(createSchema, req.body);

  const id = await transaction(async (conn) => {
    // Locking the store serialises numbering for it.
    await loadStore(storeId, conn, { lock: true });
    const [[{ next }]] = await conn.query(
      'SELECT COALESCE(MAX(invoice_no), 0) + 1 AS next FROM partner_invoices WHERE store_id = ?',
      [storeId],
    );
    const [inserted] = await conn.query(
      'INSERT INTO partner_invoices (store_id, invoice_no, issued_on, note) VALUES (?, ?, ?, ?)',
      [storeId, next, body.issuedOn, body.note],
    );
    const { units, total } = await writeLines(conn, inserted.insertId, body.items);
    await conn.query('UPDATE partner_invoices SET items_count = ?, total = ? WHERE id = ?', [units, total, inserted.insertId]);

    if (body.payment) {
      if (body.payment.amount > total) {
        throw new HttpError(400, "The amount received can't be more than the bill", { 'payment.amount': 'More than the bill' });
      }
      await conn.query('INSERT INTO partner_payments (invoice_id, amount, paid_on, note) VALUES (?, ?, ?, ?)', [
        inserted.insertId,
        body.payment.amount,
        body.payment.paidOn,
        body.payment.note,
      ]);
    }
    return inserted.insertId;
  });

  ok(res, { invoice: await loadInvoice(id) }, 'Invoice added', 201);
});

// Editing replaces the lines: the old units go back on the shelf first, then
// the new ones are taken, so a correction never double-counts stock.
router.patch('/partner-invoices/:id', async (req, res) => {
  const id = idParam(req.params.id);
  const body = parse(invoiceSchema, req.body);

  await transaction(async (conn) => {
    const [[inv]] = await conn.query('SELECT id FROM partner_invoices WHERE id = ? FOR UPDATE', [id]);
    if (!inv) throw new HttpError(404, 'Invoice not found');
    await returnStock(conn, id);
    await conn.query('DELETE FROM partner_invoice_items WHERE invoice_id = ?', [id]);
    const { units, total } = await writeLines(conn, id, body.items);
    const received = await receivedOn(conn, id);
    if (total < received) {
      throw new HttpError(409, `The store has already paid Rs. ${rupees(received)} on this invoice — the bill can't be less than that`);
    }
    await conn.query('UPDATE partner_invoices SET issued_on = ?, note = ?, items_count = ?, total = ? WHERE id = ?', [
      body.issuedOn,
      body.note,
      units,
      total,
      id,
    ]);
  });

  ok(res, { invoice: await loadInvoice(id) }, 'Invoice saved');
});

// For an invoice entered by mistake: its units come back into stock and its
// payments go with it.
router.delete('/partner-invoices/:id', async (req, res) => {
  const id = idParam(req.params.id);
  await transaction(async (conn) => {
    const [[inv]] = await conn.query('SELECT id FROM partner_invoices WHERE id = ? FOR UPDATE', [id]);
    if (!inv) throw new HttpError(404, 'Invoice not found');
    await returnStock(conn, id);
    await conn.query('DELETE FROM partner_invoices WHERE id = ?', [id]);
  });
  ok(res, null, 'Invoice deleted');
});

router.post('/partner-invoices/:id/payments', async (req, res) => {
  const id = idParam(req.params.id);
  const body = parse(paymentSchema, req.body);

  await transaction(async (conn) => {
    const [[inv]] = await conn.query('SELECT id, total FROM partner_invoices WHERE id = ? FOR UPDATE', [id]);
    if (!inv) throw new HttpError(404, 'Invoice not found');
    const pending = inv.total - (await receivedOn(conn, id));
    if (body.amount > pending) {
      throw new HttpError(
        400,
        pending > 0 ? `Only Rs. ${rupees(pending)} is pending on this invoice` : 'This invoice is already fully paid',
        { amount: 'More than what is pending' },
      );
    }
    await conn.query('INSERT INTO partner_payments (invoice_id, amount, paid_on, note) VALUES (?, ?, ?, ?)', [
      id,
      body.amount,
      body.paidOn,
      body.note,
    ]);
  });

  ok(res, { invoice: await loadInvoice(id) }, 'Payment recorded', 201);
});

router.delete('/partner-payments/:id', async (req, res) => {
  const id = idParam(req.params.id);
  const [[payment]] = await pool.query('SELECT invoice_id FROM partner_payments WHERE id = ?', [id]);
  if (!payment) throw new HttpError(404, 'Payment not found');
  await pool.query('DELETE FROM partner_payments WHERE id = ?', [id]);
  ok(res, { invoice: await loadInvoice(payment.invoice_id) }, 'Payment removed');
});

export default router;
