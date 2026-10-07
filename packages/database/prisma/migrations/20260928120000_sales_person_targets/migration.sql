-- A target for each person who sells.
--
-- The company target is set per year and split by month and quarter, but not
-- by person: a salesperson opening the dashboard saw the company's 500 million
-- as their own, with nothing that said what was expected of them. The
-- presentation's claim that "each salesperson has their own target" was true
-- of no screen.
--
-- One figure per person per year, in the currency the company quotes in. It is
-- set by a sales manager; what it is measured against -- the person's won
-- opportunities and open pipeline -- is computed, never typed.
CREATE TABLE IF NOT EXISTS sales_person_targets (
  target_year        integer        NOT NULL CHECK (target_year BETWEEN 2000 AND 2100),
  user_id            uuid           NOT NULL REFERENCES app_users (id),
  amount_egp         numeric(18, 2) NOT NULL CHECK (amount_egp >= 0),
  updated_by_user_id uuid           REFERENCES app_users (id),
  updated_at         timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (target_year, user_id)
);
