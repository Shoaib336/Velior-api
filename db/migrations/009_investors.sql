-- Velior: investors (2026-10-30). Who has put money into the brand, how
-- much, and the monthly profit share each is owed (a % of their net
-- investment). Money in/out is a list of entries (an investor can add more
-- or withdraw later); profit paid out is recorded per month, so every
-- investor's profile shows month by month what was due, paid and pending.
-- Run once, after 008:
--   mysql -u <user> -p velior_fragrances < db/migrations/009_investors.sql

CREATE TABLE IF NOT EXISTS investors (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(120) NOT NULL,
  phone VARCHAR(20) NOT NULL DEFAULT '',
  profit_rate DECIMAL(5,2) NOT NULL DEFAULT 0.00,  -- % of net investment paid each month
  note VARCHAR(300) NOT NULL DEFAULT '',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Money the investor put in ('invest') or took back ('withdraw').
CREATE TABLE IF NOT EXISTS investor_investments (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  investor_id INT UNSIGNED NOT NULL,
  kind ENUM('invest','withdraw') NOT NULL DEFAULT 'invest',
  amount INT UNSIGNED NOT NULL,
  made_on DATE NOT NULL,
  note VARCHAR(200) NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_investments_investor (investor_id, made_on),
  CONSTRAINT fk_investment_investor FOREIGN KEY (investor_id) REFERENCES investors (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Profit paid to the investor for a month ("2026-10"); several part-payments allowed.
CREATE TABLE IF NOT EXISTS investor_payouts (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  investor_id INT UNSIGNED NOT NULL,
  month CHAR(7) NOT NULL,
  amount INT UNSIGNED NOT NULL,
  paid_on DATE NOT NULL,
  note VARCHAR(200) NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_payouts_investor (investor_id, month),
  CONSTRAINT fk_payout_investor FOREIGN KEY (investor_id) REFERENCES investors (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
