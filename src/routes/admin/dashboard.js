// The dashboard: the money figures from the client's sales sheet for a date
// range, then what needs action now. "Sales" are orders that weren't
// cancelled (online, local and PR) plus invoices to partner stores; each sold
// line carries the purchase price it was sold at, so cost and margin are
// exact for the period.
import { Router } from 'express';
import pool from '../../db.js';
import { ok } from '../../lib/http.js';
import { addDays, dayKey, eachDay, presetRange, startOf } from '../../lib/dates.js';
import { loadSettings } from '../../lib/settings.js';
import { withItems } from '../../lib/orders.js';

const router = Router();

const RANGES = ['7d', '30d', '90d', 'month', 'all'];

const n = Number;

/**
 * The window to compare against: for "this month", the same days of last
 * month (1st → today's date, clamped); otherwise the same number of days
 * just before the range.
 */
const previousRange = (preset, range) => {
  const from = startOf(range.from);
  const to = startOf(range.to);
  if (preset === 'month') {
    const lastOfPrev = new Date(from.getFullYear(), from.getMonth(), 0).getDate();
    return {
      start: new Date(from.getFullYear(), from.getMonth() - 1, 1),
      end: new Date(from.getFullYear(), from.getMonth() - 1, Math.min(to.getDate(), lastOfPrev) + 1),
    };
  }
  const days = eachDay(range.from, range.to).length;
  return { start: addDays(from, -days), end: from };
};

/** "All time" starts at the first order, invoice or expense (today when there are none). */
const firstDay = async () => {
  const [[row]] = await pool.query(
    `SELECT (SELECT MIN(placed_at) FROM orders) AS ordered,
            (SELECT MIN(issued_on) FROM partner_invoices) AS invoiced,
            (SELECT MIN(spent_on) FROM expenses) AS spent`,
  );
  // DATE columns come back as "YYYY-MM-DD", so day keys compare as strings.
  const days = [row.ordered && dayKey(new Date(row.ordered)), row.invoiced, row.spent].filter(Boolean);
  return days.length ? days.sort()[0] : dayKey(new Date());
};

/**
 * Sales in [start, end): per channel (online / local / pr from orders, plus
 * "partner" for partner-store invoices) → { sale, cost, count, units }.
 */
const salesBetween = async (start, end) => {
  const [orders] = await pool.query(
    `SELECT o.channel, COUNT(*) AS count, SUM(o.total) AS sale, SUM(o.items_count) AS units, SUM(c.cost) AS cost
       FROM orders o
       LEFT JOIN (SELECT order_id, SUM(qty * unit_cost) AS cost FROM order_items GROUP BY order_id) c ON c.order_id = o.id
      WHERE o.status <> 'cancelled' AND o.placed_at >= ? AND o.placed_at < ?
      GROUP BY o.channel`,
    [start, end],
  );
  // Invoices carry a calendar date, not a time.
  const [[partner]] = await pool.query(
    `SELECT COUNT(*) AS count, COALESCE(SUM(i.total), 0) AS sale, COALESCE(SUM(i.items_count), 0) AS units,
            COALESCE(SUM(c.cost), 0) AS cost
       FROM partner_invoices i
       LEFT JOIN (SELECT invoice_id, SUM(qty * unit_cost) AS cost FROM partner_invoice_items GROUP BY invoice_id) c
              ON c.invoice_id = i.id
      WHERE i.issued_on >= ? AND i.issued_on < ?`,
    [dayKey(start), dayKey(end)],
  );
  const blank = { sale: 0, cost: 0, count: 0, units: 0 };
  const channels = { online: { ...blank }, local: { ...blank }, pr: { ...blank } };
  for (const r of orders) {
    channels[r.channel] = { sale: n(r.sale), cost: n(r.cost ?? 0), count: n(r.count), units: n(r.units) };
  }
  channels.partner = { sale: n(partner.sale), cost: n(partner.cost), count: n(partner.count), units: n(partner.units) };
  const total = (key) => Object.values(channels).reduce((sum, c) => sum + c[key], 0);
  return { channels, sale: total('sale'), cost: total('cost'), count: total('count'), units: total('units') };
};

/**
 * All-time money position. Cash in: online orders once delivered (cash on
 * delivery), local sales when entered (paid on the spot), partner payments,
 * money investors put in. Cash out: every production batch, every expense,
 * investor withdrawals and profit paid to investors. Receivable: what
 * partner stores still owe plus open online orders not yet delivered.
 */
const cashPosition = async () => {
  const [[orders]] = await pool.query(
    `SELECT COALESCE(SUM(CASE WHEN channel = 'online' AND status = 'delivered' THEN total
                              WHEN channel = 'local' AND status <> 'cancelled' THEN total ELSE 0 END), 0) AS received,
            COALESCE(SUM(CASE WHEN channel = 'online' AND status IN ('confirmed', 'in_progress') THEN total ELSE 0 END), 0) AS open
       FROM orders`,
  );
  const [[partners]] = await pool.query(
    `SELECT COALESCE((SELECT SUM(total) FROM partner_invoices), 0) AS billed,
            COALESCE((SELECT SUM(amount) FROM partner_payments), 0) AS paid`,
  );
  const [[out]] = await pool.query(
    `SELECT COALESCE((SELECT SUM(total_cost) FROM stock_purchases), 0) AS production,
            COALESCE((SELECT SUM(amount) FROM expenses), 0) AS expenses`,
  );
  const [[investors]] = await pool.query(
    `SELECT COALESCE((SELECT SUM(amount) FROM investor_investments WHERE kind = 'invest'), 0) AS invested,
            COALESCE((SELECT SUM(amount) FROM investor_investments WHERE kind = 'withdraw'), 0) AS withdrawn,
            COALESCE((SELECT SUM(amount) FROM investor_payouts), 0) AS profitPaid`,
  );
  const cashIn = n(orders.received) + n(partners.paid) + n(investors.invested);
  const cashOut = n(out.production) + n(out.expenses) + n(investors.withdrawn) + n(investors.profitPaid);
  const partnerDue = Math.max(0, n(partners.billed) - n(partners.paid));
  return {
    cashInHand: cashIn - cashOut,
    cashIn,
    cashOut,
    production: n(out.production),
    investors: { invested: n(investors.invested), withdrawn: n(investors.withdrawn), profitPaid: n(investors.profitPaid) },
    receivable: partnerDue + n(orders.open),
    receivableFrom: { partners: partnerDue, orders: n(orders.open) },
  };
};

router.get('/dashboard', async (req, res) => {
  const preset = RANGES.includes(req.query.range) ? req.query.range : 'month';
  const range = preset === 'all' ? { from: await firstDay(), to: dayKey(new Date()) } : presetRange(preset);
  const start = startOf(range.from);
  const end = addDays(startOf(range.to), 1);

  const sales = await salesBetween(start, end);
  const [[{ spent }]] = await pool.query(
    'SELECT COALESCE(SUM(amount), 0) AS spent FROM expenses WHERE spent_on >= ? AND spent_on <= ?',
    [range.from, range.to],
  );
  const expenses = n(spent);
  const profit = sales.sale - sales.cost;

  let saleChange = null;
  if (preset !== 'all') {
    const previous = previousRange(preset, range);
    const before = (await salesBetween(previous.start, previous.end)).sale;
    // 0.14 = up 14% on the previous period; null when there's nothing to compare.
    if (before > 0) saleChange = Math.round(((sales.sale - before) / before) * 1000) / 1000;
  }

  const [stores] = await pool.query(
    'SELECT COALESCE(SUM(is_active = 1), 0) AS active, COUNT(*) AS total FROM partner_stores',
  );
  const [recent] = await pool.query('SELECT * FROM orders ORDER BY placed_at DESC, id DESC LIMIT 10');
  const [[awaiting]] = await pool.query(
    `SELECT COALESCE(SUM(status = 'confirmed'), 0) AS newOrders,
            COALESCE(SUM(status = 'in_progress'), 0) AS inProgress
       FROM orders`,
  );
  const [[{ unread }]] = await pool.query('SELECT COUNT(*) AS unread FROM contact_messages WHERE is_read = 0');

  // Low stock is per size of a live product.
  const settings = await loadSettings();
  const [lowStock] = await pool.query(
    `SELECT p.slug, p.name, ps.label AS size, ps.stock
       FROM product_sizes ps JOIN products p ON p.id = ps.product_id
      WHERE p.is_active = 1 AND ps.is_active = 1 AND ps.stock <= ?
      ORDER BY ps.stock, p.name, ps.id`,
    [settings.store.lowStockThreshold],
  );

  ok(res, {
    range,
    finance: {
      netSale: sales.sale,
      netPurchase: sales.cost,
      totalOrders: sales.count,
      units: sales.units,
      expenses,
      netPurchaseWithExpenses: sales.cost + expenses,
      profit,
      profitAfterExpenses: profit - expenses,
      saleChange,
      // Where the sales went: the sheet's "To" column.
      byChannel: sales.channels,
      ...(await cashPosition()),
    },
    recentOrders: await withItems(recent, pool, { admin: true }),
    lowStock,
    awaiting: { newOrders: n(awaiting.newOrders), inProgress: n(awaiting.inProgress) },
    unreadMessages: unread,
    partnerStores: { active: n(stores[0].active), total: n(stores[0].total) },
  });
});

export default router;
