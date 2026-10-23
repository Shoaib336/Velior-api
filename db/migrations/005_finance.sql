-- Velior: sales channels, stock costs, expenses and partner stores (2026-10-10).
-- Run once, after 004:
--   mysql -u <user> -p velior_fragrances < db/migrations/005_finance.sql
-- Existing orders become "online" with no recorded cost (they count as 0 in
-- cost of goods until stock purchases give products a unit cost).

ALTER TABLE orders
  ADD COLUMN channel ENUM('online','local') NOT NULL DEFAULT 'online' AFTER payment_method,
  ADD KEY idx_orders_channel (channel);

ALTER TABLE products
  ADD COLUMN unit_cost INT UNSIGNED NOT NULL DEFAULT 0 AFTER stock;

ALTER TABLE order_items
  ADD COLUMN unit_cost INT UNSIGNED NOT NULL DEFAULT 0 AFTER unit_price;

CREATE TABLE IF NOT EXISTS stock_purchases (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  product_id INT UNSIGNED DEFAULT NULL,
  product_name VARCHAR(120) NOT NULL,
  qty INT UNSIGNED NOT NULL,
  unit_cost INT UNSIGNED NOT NULL,
  supplier VARCHAR(120) NOT NULL DEFAULT '',
  note VARCHAR(200) NOT NULL DEFAULT '',
  purchased_on DATE NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_purchases_on (purchased_on),
  CONSTRAINT fk_purchase_product FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS expenses (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  spent_on DATE NOT NULL,
  category VARCHAR(40) NOT NULL,
  amount INT UNSIGNED NOT NULL,
  note VARCHAR(200) NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_expenses_on (spent_on)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS partner_stores (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(120) NOT NULL,
  city VARCHAR(80) NOT NULL DEFAULT '',
  contact_name VARCHAR(120) NOT NULL DEFAULT '',
  phone VARCHAR(20) NOT NULL DEFAULT '',
  address VARCHAR(300) NOT NULL DEFAULT '',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
