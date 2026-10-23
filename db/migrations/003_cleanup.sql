-- Velior: go-live cleanup (2026-10-07). Run once, after 002_admin.sql:
--   mysql -u <user> -p velior_fragrances < db/migrations/003_cleanup.sql
-- Deploy the matching API code first or together — it no longer reads is_dummy.

-- Test order and test contact messages from development.
DELETE FROM orders WHERE order_number = 'D07M10Y26O1003';   -- its order_items go with it (ON DELETE CASCADE)
DELETE FROM contact_messages WHERE id IN (1, 2, 3);

-- Every order so far was a test (Ambron 6, Sylvie 8 are test leftovers):
-- back to the seeded 10. Set real counts in the admin's Restock afterwards.
UPDATE products SET stock = 10;

-- First real order becomes ...O1001, first message id 1.
ALTER TABLE orders AUTO_INCREMENT = 1001;
ALTER TABLE contact_messages AUTO_INCREMENT = 1;

-- The seeded catalogue and FIRST10 are the real ones now; no dummy flag.
ALTER TABLE products DROP COLUMN is_dummy;
ALTER TABLE promo_codes DROP COLUMN is_dummy;
