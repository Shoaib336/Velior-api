// Investors: who has put money into Velior, their monthly profit share (a %
// of their net investment) and what has been paid out, month by month.
// Money in/out is a list of entries; a month's profit is due on the net
// investment at the end of that month (money put in during a month earns
// from that month), at the investor's current rate.
import { Router } from 'express';
import { z } from 'zod';
import pool, { transaction } from '../../db.js';
import { HttpError, idParam, ok, parse } from '../../lib/http.js';
import { dayKey, isDayKey } from '../../lib/dates.js';

const router = Router();

const rupees = (n) => Number(n).toLocaleString('en-US');
const thisMonth = () => dayKey(new Date()).slice(0, 7);

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
    .max(1_000_000_000, `The ${label} is too large`);

const fields = {
  name: z.string({ error: 'Enter the name' }).trim().min(2, 'Enter the name').max(120),
  phone: z
    .string()
    .trim()
    .regex(/^$|^[0-9+\s-]{10,20}$/, 'Enter a valid mobile number'),
  profitRate: z
    .number({ error: 'Enter the monthly profit %' })
    .min(0, "The profit % can't be negative")
    .max(100, 'The profit % can be at most 100')
    .transform((v) => Math.round(v * 100) / 100),
  note: z.string().trim().max(300),
  isActive: z.boolean(),
};

const investmentSchema = z.object({
  kind: z.enum(['invest', 'withdraw']).default('invest'),
  amount: amount('amount'),
  madeOn: day('date'),
  note: z.string().trim().max(200).default(''),
});

const createSchema = z.object({
  ...fields,
  phone: fields.phone.default(''),
  note: fields.note.default(''),
  isActive: fields.isActive.default(true),
  // The first investment can be entered with the investor.
  investment: investmentSchema.omit({ kind: true }).nullish(),
});

const patchSchema = z
  .object(fields)
  .partial()
  .refine((p) => Object.keys(p).length > 0, 'Nothing to update');

const payoutSchema = z.object({
  month: z
    .string({ error: 'Pick the month' })
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Pick the month')
    .refine((m) => m <= thisMonth(), "The month can't be in the future"),
  amount: amount('amount'),
  paidOn: day('payment date'),
  note: z.string().trim().max(200).default(''),
});

const COLUMNS = { name: 'name', phone: 'phone', profitRate: 'profit_rate', note: 'note', isActive: 'is_active' };

/** "2026-10" → "2026-11" */
const nextMonth = (m) => {
  const [y, mo] = m.split('-').map(Number);
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
};

/**
 * One investor with their totals and month-wise record (newest month first):
 * [{ month, investment, rate, due, paid, pending }] from the first entry's
 * month to this month.
 */
const shape = (inv, entries, payouts) => {
  const rate = Number(inv.profit_rate);
  const signed = (e) => (e.kind === 'withdraw' ? -e.amount : e.amount);
  const netInvestment = entries.reduce((n, e) => n + signed(e), 0);
  const invested = entries.filter((e) => e.kind === 'invest').reduce((n, e) => n + e.amount, 0);

  const months = [];
  if (entries.length) {
    const last = thisMonth();
    for (let m = entries[0].made_on.slice(0, 7); m <= last; m = nextMonth(m)) {
      const balance = entries.filter((e) => e.made_on.slice(0, 7) <= m).reduce((n, e) => n + signed(e), 0);
      const due = Math.round((balance * rate) / 100);
      const paid = payouts.filter((p) => p.month === m).reduce((n, p) => n + p.amount, 0);
      months.push({ month: m, investment: balance, rate, due, paid, pending: Math.max(0, due - paid) });
    }
    months.reverse();
  }
  // Payouts recorded for months before the first entry still count as paid.
  const totalPaid = payouts.reduce((n, p) => n + p.amount, 0);
  const totalDue = months.reduce((n, m) => n + m.due, 0);

  return {
    id: inv.id,
    name: inv.name,
    phone: inv.phone,
    profitRate: rate,
    note: inv.note,
    isActive: Boolean(inv.is_active),
    createdAt: inv.created_at,
    since: entries[0]?.made_on ?? null,
    totals: {
      invested,
      withdrawn: invested - netInvestment,
      netInvestment,
      monthlyProfit: Math.round((netInvestment * rate) / 100),
      due: totalDue,
      paid: totalPaid,
      pending: months.reduce((n, m) => n + m.pending, 0),
    },
    months,
    investments: entries
      .map((e) => ({ id: e.id, kind: e.kind, amount: e.amount, madeOn: e.made_on, note: e.note }))
      .reverse(),
    payouts: payouts
      .map((p) => ({ id: p.id, month: p.month, amount: p.amount, paidOn: p.paid_on, note: p.note }))
      .reverse(),
  };
};

/** Investor rows → shaped investors, each with its entries and payouts. */
const withHistory = async (rows, conn = pool) => {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [entries] = await conn.query(
    'SELECT * FROM investor_investments WHERE investor_id IN (?) ORDER BY made_on, id',
    [ids],
  );
  const [payouts] = await conn.query(
    'SELECT * FROM investor_payouts WHERE investor_id IN (?) ORDER BY month, paid_on, id',
    [ids],
  );
  return rows.map((r) =>
    shape(
      r,
      entries.filter((e) => e.investor_id === r.id),
      payouts.filter((p) => p.investor_id === r.id),
    ),
  );
};

const loadOne = async (id, conn = pool, { lock = false } = {}) => {
  const [rows] = await conn.query(`SELECT * FROM investors WHERE id = ?${lock ? ' FOR UPDATE' : ''}`, [id]);
  if (!rows[0]) throw new HttpError(404, 'Investor not found');
  return (await withHistory(rows, conn))[0];
};

router.get('/investors', async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM investors ORDER BY is_active DESC, name');
  const investors = await withHistory(rows);
  // The list carries totals only; the profile has the history.
  const listed = ({ id, name, phone, profitRate, note, isActive, createdAt, since, totals }) =>
    ({ id, name, phone, profitRate, note, isActive, createdAt, since, totals });
  ok(res, { investors: investors.map(listed) });
});

router.get('/investors/:id', async (req, res) => {
  ok(res, { investor: await loadOne(idParam(req.params.id)) });
});

router.post('/investors', async (req, res) => {
  const body = parse(createSchema, req.body);
  const id = await transaction(async (conn) => {
    const [inserted] = await conn.query(
      'INSERT INTO investors (name, phone, profit_rate, note, is_active) VALUES (?, ?, ?, ?, ?)',
      [body.name, body.phone, body.profitRate, body.note, body.isActive],
    );
    if (body.investment) {
      await conn.query(
        "INSERT INTO investor_investments (investor_id, kind, amount, made_on, note) VALUES (?, 'invest', ?, ?, ?)",
        [inserted.insertId, body.investment.amount, body.investment.madeOn, body.investment.note],
      );
    }
    return inserted.insertId;
  });
  ok(res, { investor: await loadOne(id) }, 'Investor added', 201);
});

router.patch('/investors/:id', async (req, res) => {
  const id = idParam(req.params.id);
  const body = parse(patchSchema, req.body);
  const keys = Object.keys(body);
  const [result] = await pool.query(
    `UPDATE investors SET ${keys.map((k) => `${COLUMNS[k]} = ?`).join(', ')} WHERE id = ?`,
    [...keys.map((k) => body[k]), id],
  );
  if (result.affectedRows === 0) throw new HttpError(404, 'Investor not found');
  ok(res, { investor: await loadOne(id) }, 'Investor saved');
});

// Only an investor with no money or payouts on record can be deleted.
router.delete('/investors/:id', async (req, res) => {
  const id = idParam(req.params.id);
  const [[{ n }]] = await pool.query(
    `SELECT (SELECT COUNT(*) FROM investor_investments WHERE investor_id = ?)
          + (SELECT COUNT(*) FROM investor_payouts WHERE investor_id = ?) AS n`,
    [id, id],
  );
  if (n > 0) throw new HttpError(409, 'This investor has investments or payouts on record — switch them off instead.');
  const [result] = await pool.query('DELETE FROM investors WHERE id = ?', [id]);
  if (result.affectedRows === 0) throw new HttpError(404, 'Investor not found');
  ok(res, null, 'Investor deleted');
});

// Money in (more investment) or out (a withdrawal — at most what's invested).
router.post('/investors/:id/investments', async (req, res) => {
  const id = idParam(req.params.id);
  const body = parse(investmentSchema, req.body);
  const investor = await transaction(async (conn) => {
    const current = await loadOne(id, conn, { lock: true });
    if (body.kind === 'withdraw' && body.amount > current.totals.netInvestment) {
      throw new HttpError(400, `Only Rs. ${rupees(current.totals.netInvestment)} is invested`, {
        amount: 'More than the net investment',
      });
    }
    await conn.query('INSERT INTO investor_investments (investor_id, kind, amount, made_on, note) VALUES (?, ?, ?, ?, ?)', [
      id,
      body.kind,
      body.amount,
      body.madeOn,
      body.note,
    ]);
    return loadOne(id, conn);
  });
  ok(res, { investor }, body.kind === 'withdraw' ? 'Withdrawal recorded' : 'Investment recorded', 201);
});

router.delete('/investor-investments/:id', async (req, res) => {
  const id = idParam(req.params.id);
  const [[row]] = await pool.query('SELECT investor_id FROM investor_investments WHERE id = ?', [id]);
  if (!row) throw new HttpError(404, 'Entry not found');
  await pool.query('DELETE FROM investor_investments WHERE id = ?', [id]);
  ok(res, { investor: await loadOne(row.investor_id) }, 'Entry removed');
});

router.post('/investors/:id/payouts', async (req, res) => {
  const id = idParam(req.params.id);
  const body = parse(payoutSchema, req.body);
  await loadOne(id);
  await pool.query('INSERT INTO investor_payouts (investor_id, month, amount, paid_on, note) VALUES (?, ?, ?, ?, ?)', [
    id,
    body.month,
    body.amount,
    body.paidOn,
    body.note,
  ]);
  ok(res, { investor: await loadOne(id) }, 'Profit payout recorded', 201);
});

router.delete('/investor-payouts/:id', async (req, res) => {
  const id = idParam(req.params.id);
  const [[row]] = await pool.query('SELECT investor_id FROM investor_payouts WHERE id = ?', [id]);
  if (!row) throw new HttpError(404, 'Payout not found');
  await pool.query('DELETE FROM investor_payouts WHERE id = ?', [id]);
  ok(res, { investor: await loadOne(row.investor_id) }, 'Payout removed');
});

export default router;
