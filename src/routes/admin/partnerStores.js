// Shops that stock Velior. The dashboard counts the active ones.
import { Router } from 'express';
import { z } from 'zod';
import pool from '../../db.js';
import { HttpError, idParam, ok, parse } from '../../lib/http.js';

const router = Router();

const fields = {
  name: z.string({ error: 'Enter the store name' }).trim().min(2, 'Enter the store name').max(120),
  city: z.string().trim().max(80),
  contactName: z.string().trim().max(120),
  phone: z
    .string()
    .trim()
    .regex(/^$|^[0-9+\s-]{10,20}$/, 'Enter a valid phone number'),
  address: z.string().trim().max(300),
  isActive: z.boolean(),
};

const createSchema = z.object({
  ...fields,
  city: fields.city.default(''),
  contactName: fields.contactName.default(''),
  phone: fields.phone.default(''),
  address: fields.address.default(''),
  isActive: fields.isActive.default(true),
});

const patchSchema = z
  .object(fields)
  .partial()
  .refine((p) => Object.keys(p).length > 0, 'Nothing to update');

const COLUMNS = {
  name: 'name',
  city: 'city',
  contactName: 'contact_name',
  phone: 'phone',
  address: 'address',
  isActive: 'is_active',
};

const shape = (s) => ({
  id: s.id,
  name: s.name,
  city: s.city,
  contactName: s.contact_name,
  phone: s.phone,
  address: s.address,
  isActive: Boolean(s.is_active),
  createdAt: s.created_at,
  // What the store has been billed and paid, from its invoices (list only).
  ...(s.business !== undefined && {
    totals: {
      invoices: Number(s.invoices),
      units: Number(s.units),
      business: Number(s.business),
      received: Number(s.received),
      pending: Math.max(0, Number(s.business) - Number(s.received)),
    },
  }),
});

const loadOne = async (id) => {
  const [[row]] = await pool.query('SELECT * FROM partner_stores WHERE id = ?', [id]);
  if (!row) throw new HttpError(404, 'Store not found');
  return shape(row);
};

router.get('/partner-stores', async (req, res) => {
  const [rows] = await pool.query(
    `SELECT s.*,
            COALESCE(i.invoices, 0) AS invoices, COALESCE(i.units, 0) AS units,
            COALESCE(i.business, 0) AS business, COALESCE(p.received, 0) AS received
       FROM partner_stores s
       LEFT JOIN (SELECT store_id, COUNT(*) AS invoices, SUM(items_count) AS units, SUM(total) AS business
                    FROM partner_invoices GROUP BY store_id) i ON i.store_id = s.id
       LEFT JOIN (SELECT pi.store_id, SUM(pp.amount) AS received
                    FROM partner_payments pp JOIN partner_invoices pi ON pi.id = pp.invoice_id
                   GROUP BY pi.store_id) p ON p.store_id = s.id
      ORDER BY s.is_active DESC, s.name`,
  );
  ok(res, { stores: rows.map(shape) });
});

router.post('/partner-stores', async (req, res) => {
  const body = parse(createSchema, req.body);
  const keys = Object.keys(COLUMNS);
  const [inserted] = await pool.query(
    `INSERT INTO partner_stores (${keys.map((k) => COLUMNS[k]).join(', ')}) VALUES (?)`,
    [keys.map((k) => body[k])],
  );
  ok(res, { store: await loadOne(inserted.insertId) }, 'Store added', 201);
});

router.patch('/partner-stores/:id', async (req, res) => {
  const id = idParam(req.params.id);
  const body = parse(patchSchema, req.body);
  const keys = Object.keys(body);
  const [result] = await pool.query(
    `UPDATE partner_stores SET ${keys.map((k) => `${COLUMNS[k]} = ?`).join(', ')} WHERE id = ?`,
    [...keys.map((k) => body[k]), id],
  );
  if (result.affectedRows === 0) throw new HttpError(404, 'Store not found');
  ok(res, { store: await loadOne(id) }, 'Store saved');
});

router.delete('/partner-stores/:id', async (req, res) => {
  const id = idParam(req.params.id);
  const [[{ invoices }]] = await pool.query('SELECT COUNT(*) AS invoices FROM partner_invoices WHERE store_id = ?', [id]);
  if (invoices > 0) {
    throw new HttpError(409, 'This store has invoices, so it can’t be deleted. Switch it off instead.');
  }
  const [result] = await pool.query('DELETE FROM partner_stores WHERE id = ?', [id]);
  if (result.affectedRows === 0) throw new HttpError(404, 'Store not found');
  ok(res, null, 'Store deleted');
});

export default router;
