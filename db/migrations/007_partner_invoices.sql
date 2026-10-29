-- Velior: partner invoices (2026-10-27). Each delivery of stock to a partner
-- store is an invoice ("batch") numbered per store; payments the store makes
-- against it are recorded one by one, so the admin sees what was supplied,
-- billed, received and still pending — per invoice and per month.
-- Run once, after 006:
--   mysql -u <user> -p velior_fragrances < db/migrations/007_partner_invoices.sql

CREATE TABLE IF NOT EXISTS partner_invoices (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  store_id INT UNSIGNED NOT NULL,
  invoice_no INT UNSIGNED NOT NULL,            -- 1, 2, 3… per store
  issued_on DATE NOT NULL,
  items_count INT UNSIGNED NOT NULL DEFAULT 0,
  total INT UNSIGNED NOT NULL DEFAULT 0,
  note VARCHAR(200) NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_partner_invoice_no (store_id, invoice_no),
  KEY idx_partner_invoices_issued (issued_on),
  CONSTRAINT fk_partner_invoice_store FOREIGN KEY (store_id) REFERENCES partner_stores (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS partner_invoice_items (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  invoice_id INT UNSIGNED NOT NULL,
  product_id INT UNSIGNED DEFAULT NULL,
  slug VARCHAR(60) NOT NULL,
  product_name VARCHAR(120) NOT NULL,
  size_label VARCHAR(30) NOT NULL,
  qty INT UNSIGNED NOT NULL,
  unit_price INT UNSIGNED NOT NULL,
  unit_cost INT UNSIGNED NOT NULL DEFAULT 0,   -- product's unit cost when supplied
  PRIMARY KEY (id),
  KEY idx_partner_items_invoice (invoice_id),
  CONSTRAINT fk_partner_item_invoice FOREIGN KEY (invoice_id) REFERENCES partner_invoices (id) ON DELETE CASCADE,
  CONSTRAINT fk_partner_item_product FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS partner_payments (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  invoice_id INT UNSIGNED NOT NULL,
  amount INT UNSIGNED NOT NULL,
  paid_on DATE NOT NULL,
  note VARCHAR(200) NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_partner_payments_invoice (invoice_id),
  CONSTRAINT fk_partner_payment_invoice FOREIGN KEY (invoice_id) REFERENCES partner_invoices (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
