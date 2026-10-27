-- Velior: production batches (2026-10-27). Stock purchases become batches
-- Velior has made: what each one costs (with an optional breakdown — oil,
-- bottles, packaging…) and whether it is still being made or has arrived.
-- Run once, after 005:
--   mysql -u <user> -p velior_fragrances < db/migrations/006_production.sql
-- Existing purchases count as received, with total = units × unit cost.

ALTER TABLE stock_purchases
  ADD COLUMN total_cost INT UNSIGNED NOT NULL DEFAULT 0 AFTER unit_cost,
  ADD COLUMN costs JSON NULL AFTER total_cost,
  ADD COLUMN status ENUM('ordered','received') NOT NULL DEFAULT 'received' AFTER purchased_on,
  ADD COLUMN received_on DATE NULL DEFAULT NULL AFTER status,
  ADD KEY idx_purchases_status (status);

UPDATE stock_purchases SET total_cost = qty * unit_cost, received_on = purchased_on;
