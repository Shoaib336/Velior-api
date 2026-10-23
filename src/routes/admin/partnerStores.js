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
});

const loadOne = async (id) => {
  const [[row]] = await pool.query('SELECT * FROM partner_stores WHERE id = ?', [id]);
  if (!row) throw new HttpError(404, 'Store not found');
  return shape(row);
};

router.get('/partner-stores', async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM partner_stores ORDER BY is_active DESC, name');
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
  const [result] = await pool.query('DELETE FROM partner_stores WHERE id = ?', [idParam(req.params.id)]);
  if (result.affectedRows === 0) throw new HttpError(404, 'Store not found');
  ok(res, null, 'Store deleted');
});

export default router;
