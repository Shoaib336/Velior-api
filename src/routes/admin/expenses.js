// Running costs (ads, shipping, packaging…). The dashboard subtracts them,
// with cost of goods, from revenue to get net profit.
import { Router } from 'express';
import { z } from 'zod';
import pool from '../../db.js';
import { HttpError, idParam, ok, paging, parse } from '../../lib/http.js';
import { dayKey, isDayKey } from '../../lib/dates.js';

const router = Router();

const schema = z.object({
  spentOn: z
    .string({ error: 'Pick the date' })
    .refine(isDayKey, 'Pick the date')
    .refine((d) => d <= dayKey(new Date()), "The date can't be in the future"),
  category: z.string({ error: 'Pick a category' }).trim().min(1, 'Pick a category').max(40),
  amount: z
    .number({ error: 'Enter how much was spent' })
    .int('The amount is whole rupees')
    .min(1, 'Enter how much was spent')
    .max(100_000_000, 'That amount is too large'),
  note: z.string().trim().max(200).default(''),
});

const shape = (e) => ({
  id: e.id,
  spentOn: e.spent_on,
  category: e.category,
  amount: e.amount,
  note: e.note,
  createdAt: e.created_at,
});

/** ?from&to (YYYY-MM-DD, inclusive)&category → { expenses, total, page, pageSize, sum } */
router.get('/expenses', async (req, res) => {
  const { page, pageSize, offset } = paging(req.query);
  const where = [];
  const params = [];
  if (isDayKey(req.query.from ?? '')) {
    where.push('spent_on >= ?');
    params.push(req.query.from);
  }
  if (isDayKey(req.query.to ?? '')) {
    where.push('spent_on <= ?');
    params.push(req.query.to);
  }
  if (req.query.category) {
    where.push('category = ?');
    params.push(String(req.query.category).slice(0, 40));
  }
  const sql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rows] = await pool.query(`SELECT * FROM expenses ${sql} ORDER BY spent_on DESC, id DESC LIMIT ? OFFSET ?`, [
    ...params,
    pageSize,
    offset,
  ]);
  const [[summary]] = await pool.query(`SELECT COUNT(*) AS total, COALESCE(SUM(amount), 0) AS sum FROM expenses ${sql}`, params);
  ok(res, { expenses: rows.map(shape), total: summary.total, sum: Number(summary.sum), page, pageSize });
});

// Month-wise totals for the Expenses page, newest month first:
// [{ month: "2026-10", count, total, byCategory: { Ads: 5000, … } }].
router.get('/expenses/months', async (req, res) => {
  const [rows] = await pool.query(
    `SELECT DATE_FORMAT(spent_on, '%Y-%m') AS month, category, COUNT(*) AS count, SUM(amount) AS total
       FROM expenses GROUP BY month, category ORDER BY month DESC, total DESC`,
  );
  const months = new Map();
  for (const r of rows) {
    const m = months.get(r.month) ?? { month: r.month, count: 0, total: 0, byCategory: {} };
    m.count += Number(r.count);
    m.total += Number(r.total);
    m.byCategory[r.category] = Number(r.total);
    months.set(r.month, m);
  }
  ok(res, { months: [...months.values()] });
});

router.post('/expenses', async (req, res) => {
  const body = parse(schema, req.body);
  const [inserted] = await pool.query('INSERT INTO expenses (spent_on, category, amount, note) VALUES (?, ?, ?, ?)', [
    body.spentOn,
    body.category,
    body.amount,
    body.note,
  ]);
  const [[row]] = await pool.query('SELECT * FROM expenses WHERE id = ?', [inserted.insertId]);
  ok(res, { expense: shape(row) }, 'Expense logged', 201);
});

router.delete('/expenses/:id', async (req, res) => {
  const [result] = await pool.query('DELETE FROM expenses WHERE id = ?', [idParam(req.params.id)]);
  if (result.affectedRows === 0) throw new HttpError(404, 'Expense not found');
  ok(res, null, 'Expense deleted');
});

export default router;
