-- Velior: stock and purchase price per size (2026-10-30). Until now a
-- product's sizes shared one stock figure, so 30 ML and 50 ML showed the
-- same units. Each size now keeps its own stock and its own purchase price
-- (average cost per unit); sales, partner invoices and production batches
-- move the stock of the size they name. Hand-entered sales can also be PR
-- (gifted, sale price 0) so their cost still counts.
-- Run once, after 007:
--   mysql -u <user> -p velior_fragrances < db/migrations/008_size_stock.sql
--
-- Existing figures: every size starts with its product's old shared stock
-- and cost — recount and set the real units per size in Stock Manager
-- afterwards. products.stock / products.unit_cost are no longer read.

ALTER TABLE product_sizes
  ADD COLUMN stock INT UNSIGNED NOT NULL DEFAULT 0 AFTER sale_price,
  ADD COLUMN unit_cost INT UNSIGNED NOT NULL DEFAULT 0 AFTER stock;

UPDATE product_sizes ps JOIN products p ON p.id = ps.product_id
   SET ps.stock = p.stock, ps.unit_cost = p.unit_cost;

-- Batches name the size they were made in; old ones go on the product's first size.
ALTER TABLE stock_purchases
  ADD COLUMN size_label VARCHAR(30) NOT NULL DEFAULT '' AFTER product_name;

UPDATE stock_purchases sp
   JOIN (SELECT product_id, MIN(id) AS first_id FROM product_sizes GROUP BY product_id) f ON f.product_id = sp.product_id
   JOIN product_sizes ps ON ps.id = f.first_id
   SET sp.size_label = ps.label;

ALTER TABLE orders
  MODIFY COLUMN channel ENUM('online','local','pr') NOT NULL DEFAULT 'online';

-- Old sales and partner invoices saved with purchase price 0 take their
-- size's current purchase price, so their profit isn't overstated. Safe to
-- run again later (only lines still at 0 change) — e.g. after setting each
-- size's purchase price in Stock Manager.
UPDATE order_items oi
  JOIN product_sizes ps ON ps.product_id = oi.product_id AND ps.label = oi.size_label
   SET oi.unit_cost = ps.unit_cost
 WHERE oi.unit_cost = 0;

UPDATE partner_invoice_items pii
  JOIN product_sizes ps ON ps.product_id = pii.product_id AND ps.label = pii.size_label
   SET pii.unit_cost = ps.unit_cost
 WHERE pii.unit_cost = 0;
