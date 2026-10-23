// Discount codes for the cart's promo box. Orders keep the code as text, so
// deleting one never touches order history.
import { Router } from 'express';
import { z } from 'zod';
import pool from '../../db.js';
import { HttpError, fieldError, isDuplicate, ok, parse } from '../../lib/http.js';

const router = Router();

const rate = z
  .number({ error: 'Enter the discount' })
  .min(0.01, 'The discount must be at least 1%')
  .max(0.9, 'The discount can be at most 90%')
  .transform((v) => Math.round(v * 1000) / 1000);

const createSchema = z.object({
  code: z
    .string({ error: 'Enter a code' })
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_-]{3,20}$/, 'Use 3–20 letters, numbers, dashes or underscores'),
  discountRate: rate,
  isActive: z.boolean().default(true),
});

const patchSchema = z
  .object({ discountRate: rate.optional(), isActive: z.boolean().optional() })
  .refine((p) => p.discountRate !== undefined || p.isActive !== undefined, 'Nothing to update');

const shape = (p) => ({
  code: p.code,
  discountRate: Number(p.discount_rate),
  isActive: Boolean(p.is_active),
  usedCount: Number(p.used_count ?? 0),
  createdAt: p.created_at,
});

const load = async (conn, code) => {
  const [rows] = await conn.query(
    `SELECT pc.*, (SELECT COUNT(*) FROM orders o WHERE o.promo_code = pc.code AND o.status <> 'cancelled') AS used_count
       FROM promo_codes pc${code ? ' WHERE pc.code = ?' : ''}
      ORDER BY pc.created_at DESC, pc.id DESC`,
    code ? [code] : [],
  );
  return rows.map(shape);
};

const codeParam = (value) => String(value).trim().toUpperCase();

router.get('/promo-codes', async (req, res) => {
  ok(res, { promoCodes: await load(pool) });
});

router.post('/promo-codes', async (req, res) => {
  const body = parse(createSchema, req.body);
  try {
    await pool.query('INSERT INTO promo_codes (code, discount_rate, is_active) VALUES (?, ?, ?)', [
      body.code,
      body.discountRate,
      body.isActive,
    ]);
  } catch (err) {
    if (isDuplicate(err)) throw fieldError(409, 'code', 'That code already exists');
    throw err;
  }
  const [promoCode] = await load(pool, body.code);
  ok(res, { promoCode }, 'Promo code created', 201);
});

router.patch('/promo-codes/:code', async (req, res) => {
  const body = parse(patchSchema, req.body);
  const code = codeParam(req.params.code);
  const sets = [];
  const params = [];
  if (body.discountRate !== undefined) {
    sets.push('discount_rate = ?');
    params.push(body.discountRate);
  }
  if (body.isActive !== undefined) {
    sets.push('is_active = ?');
    params.push(body.isActive);
  }
  const [result] = await pool.query(`UPDATE promo_codes SET ${sets.join(', ')} WHERE code = ?`, [...params, code]);
  if (result.affectedRows === 0) throw new HttpError(404, 'Promo code not found');
  const [promoCode] = await load(pool, code);
  ok(res, { promoCode }, 'Promo code saved');
});

router.delete('/promo-codes/:code', async (req, res) => {
  const [result] = await pool.query('DELETE FROM promo_codes WHERE code = ?', [codeParam(req.params.code)]);
  if (result.affectedRows === 0) throw new HttpError(404, 'Promo code not found');
  ok(res, null, 'Promo code deleted');
});

export default router;
