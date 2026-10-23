// The dashboard: what needs action now, then sales for a date range.
// Revenue counts every order that wasn't cancelled.
import { Router } from 'express';
import pool from '../../db.js';
import { ok } from '../../lib/http.js';
import { addDays, dayKey, eachDay, presetRange, startOf } from '../../lib/dates.js';
import { loadSettings } from '../../lib/settings.js';
import { withItems } from '../../lib/orders.js';

const router = Router();

const RANGES = ['7d', '30d', '90d', 'month'];

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

/** Revenue (non-cancelled order totals) placed in [start, end). */
const revenueBetween = async (start, end) => {
  const [[row]] = await pool.query(
    `SELECT COALESCE(SUM(total), 0) AS revenue FROM orders
      WHERE status <> 'cancelled' AND placed_at >= ? AND placed_at < ?`,
    [start, end],
  );
  return Number(row.revenue);
};

router.get('/dashboard', async (req, res) => {
  const preset = RANGES.includes(req.query.range) ? req.query.range : '30d';
  const range = presetRange(preset);
  const start = startOf(range.from);
  const end = addDays(startOf(range.to), 1);

  // Per-order rows, bucketed into local days here rather than in SQL.
  const [placed] = await pool.query(
    `SELECT placed_at, total, items_count FROM orders
      WHERE status <> 'cancelled' AND placed_at >= ? AND placed_at < ?`,
    [start, end],
  );
  const byDay = new Map(eachDay(range.from, range.to).map((d) => [d, { date: d, revenue: 0, orders: 0 }]));
  let revenue = 0;
  let units = 0;
  for (const o of placed) {
    const day = byDay.get(dayKey(new Date(o.placed_at)));
    if (day) {
      day.revenue += o.total;
      day.orders += 1;
    }
    revenue += o.total;
    units += o.items_count;
  }

  const [topProducts] = await pool.query(
    `SELECT oi.slug, MAX(oi.product_name) AS name, SUM(oi.qty) AS units, SUM(oi.qty * oi.unit_price) AS revenue
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE o.status <> 'cancelled' AND o.placed_at >= ? AND o.placed_at < ?
      GROUP BY oi.slug ORDER BY units DESC, revenue DESC LIMIT 5`,
    [start, end],
  );

  // Cost of goods: each sold line at the unit cost it was sold with.
  const [[{ cogs }]] = await pool.query(
    `SELECT COALESCE(SUM(oi.qty * oi.unit_cost), 0) AS cogs
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE o.status <> 'cancelled' AND o.placed_at >= ? AND o.placed_at < ?`,
    [start, end],
  );
  const [[{ spent }]] = await pool.query(
    'SELECT COALESCE(SUM(amount), 0) AS spent FROM expenses WHERE spent_on >= ? AND spent_on <= ?',
    [range.from, range.to],
  );
  const previous = previousRange(preset, range);
  const previousRevenue = await revenueBetween(previous.start, previous.end);
  const [[stores]] = await pool.query(
    'SELECT COALESCE(SUM(is_active = 1), 0) AS active, COUNT(*) AS total FROM partner_stores',
  );

  const [recent] = await pool.query('SELECT * FROM orders ORDER BY placed_at DESC, id DESC LIMIT 10');
  const [[awaiting]] = await pool.query(
    `SELECT COALESCE(SUM(status = 'confirmed'), 0) AS newOrders,
            COALESCE(SUM(status = 'in_progress'), 0) AS inProgress
       FROM orders`,
  );
  const [[{ unread }]] = await pool.query('SELECT COUNT(*) AS unread FROM contact_messages WHERE is_read = 0');

  const settings = await loadSettings();
  const [lowStock] = await pool.query(
    `SELECT slug, name, stock FROM products
      WHERE is_active = 1 AND stock <= ? ORDER BY stock, name`,
    [settings.store.lowStockThreshold],
  );

  ok(res, {
    range,
    kpis: {
      revenue,
      orders: placed.length,
      units,
      avgOrder: placed.length ? Math.round(revenue / placed.length) : 0,
      costOfGoods: Number(cogs),
      expenses: Number(spent),
      netProfit: revenue - Number(cogs) - Number(spent),
      // 0.14 = up 14% on the previous period; null when there's nothing to compare.
      revenueChange: previousRevenue > 0 ? Math.round(((revenue - previousRevenue) / previousRevenue) * 1000) / 1000 : null,
    },
    salesByDay: [...byDay.values()],
    topProducts: topProducts.map((p) => ({
      slug: p.slug,
      name: p.name,
      units: Number(p.units),
      revenue: Number(p.revenue),
    })),
    recentOrders: await withItems(recent),
    lowStock,
    awaiting: { newOrders: Number(awaiting.newOrders), inProgress: Number(awaiting.inProgress) },
    unreadMessages: unread,
    partnerStores: { active: Number(stores.active), total: Number(stores.total) },
  });
});

export default router;
