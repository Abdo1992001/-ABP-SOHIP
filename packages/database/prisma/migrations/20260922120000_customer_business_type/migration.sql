ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS business_type_code text NOT NULL DEFAULT 'OTHER';

ALTER TABLE accounts
  DROP CONSTRAINT IF EXISTS accounts_business_type_code_check;

ALTER TABLE accounts
  ADD CONSTRAINT accounts_business_type_code_check
  CHECK (business_type_code IN ('FORMWORK', 'OTHER'));

CREATE INDEX IF NOT EXISTS accounts_business_type_status_idx
  ON accounts (business_type_code, record_status_code);
