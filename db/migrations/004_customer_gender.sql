-- Velior: customer gender on orders (asked at checkout). Run once, after 003:
--   mysql -u <user> -p velior_fragrances < db/migrations/004_customer_gender.sql
-- Older orders keep NULL (shown as "—" in the admin).

ALTER TABLE orders
  ADD COLUMN customer_gender ENUM('male','female') NULL DEFAULT NULL AFTER customer_name,
  ADD KEY idx_orders_gender (customer_gender);
