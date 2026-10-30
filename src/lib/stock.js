// Stock lives on each product size (50 ML and 30 ML count separately).
// Sales, partner invoices and production batches move the units of the size
// they name; these helpers lock the size rows, check and move the units.
import { HttpError } from './http.js';

const keyOf = (productId, size) => `${productId}|${size}`;

/** [{ productId, size, qty }] with repeats of a size merged. */
const merge = (lines) => {
  const units = new Map();
  for (const { productId, size, qty } of lines) {
    const key = keyOf(productId, size);
    units.set(key, { productId, size, qty: (units.get(key)?.qty ?? 0) + qty });
  }
  return [...units.values()];
};

/**
 * Locks every size of the given products.
 * → Map "productId|label" → { product_id, label, stock, unit_cost, name }
 */
export const lockSizes = async (conn, productIds) => {
  if (productIds.length === 0) return new Map();
  const [rows] = await conn.query(
    `SELECT ps.product_id, ps.label, ps.stock, ps.unit_cost, p.name
       FROM product_sizes ps JOIN products p ON p.id = ps.product_id
      WHERE ps.product_id IN (?) ORDER BY ps.id FOR UPDATE`,
    [productIds],
  );
  return new Map(rows.map((r) => [keyOf(r.product_id, r.label), r]));
};

export const sizeOf = (sizes, productId, size) => sizes.get(keyOf(productId, size));

/**
 * Takes the lines' units off their sizes — 409 naming the first size that's
 * short. Sizes no longer in the catalogue are skipped (callers check new
 * lines against the catalogue first). `prefix` leads the message, e.g.
 * "Can't reopen: ".
 */
export const takeStock = async (conn, lines, { prefix = '' } = {}) => {
  const units = merge(lines);
  const sizes = await lockSizes(conn, [...new Set(units.map((u) => u.productId))]);
  for (const u of units) {
    const s = sizeOf(sizes, u.productId, u.size);
    if (s && s.stock < u.qty) {
      const name = `${s.name} ${s.label}`;
      throw new HttpError(409, `${prefix}${s.stock > 0 ? `Only ${s.stock} of ${name} in stock` : `${name} is out of stock`}`);
    }
  }
  for (const u of units) {
    await conn.query('UPDATE product_sizes SET stock = stock - ? WHERE product_id = ? AND label = ?', [
      u.qty,
      u.productId,
      u.size,
    ]);
  }
};

/** Puts the lines' units back on their sizes. */
export const returnStock = async (conn, lines) => {
  for (const u of merge(lines)) {
    await conn.query('UPDATE product_sizes SET stock = stock + ? WHERE product_id = ? AND label = ?', [
      u.qty,
      u.productId,
      u.size,
    ]);
  }
};

/** An order's or invoice's lines as stock lines (lines of deleted products skipped). */
export const linesOf = async (conn, table, column, id) => {
  const [rows] = await conn.query(
    `SELECT product_id, size_label, qty FROM ${table} WHERE ${column} = ? AND product_id IS NOT NULL`,
    [id],
  );
  return rows.map((r) => ({ productId: r.product_id, size: r.size_label, qty: r.qty }));
};
