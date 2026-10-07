CREATE SEQUENCE IF NOT EXISTS quotation_ref_seq;

CREATE TABLE pricing_rules (
  pricing_rule_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(product_id) ON DELETE RESTRICT,
  country_code char(2),
  currency_code char(3) NOT NULL,
  min_price numeric(18,4) NOT NULL,
  reference_price numeric(18,4) NOT NULL,
  max_price numeric(18,4) NOT NULL,
  effective_from timestamptz(6) NOT NULL,
  effective_to timestamptz(6),
  source_code text NOT NULL,
  status_code text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT pricing_rules_amounts_check CHECK (min_price >= 0 AND reference_price >= min_price AND max_price >= reference_price),
  CONSTRAINT pricing_rules_dates_check CHECK (effective_to IS NULL OR effective_to > effective_from),
  CONSTRAINT pricing_rules_status_check CHECK (status_code IN ('ACTIVE','INACTIVE'))
);
CREATE INDEX pricing_rules_resolution_idx ON pricing_rules(product_id, country_code, currency_code, status_code, effective_from, effective_to);

CREATE TABLE quotations (
  quotation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_ref text NOT NULL UNIQUE DEFAULT ('QTN-'::text || lpad(nextval('quotation_ref_seq'::regclass)::text, 8, '0')),
  account_id uuid NOT NULL REFERENCES accounts(account_id) ON DELETE RESTRICT,
  opportunity_id uuid NOT NULL REFERENCES opportunities(opportunity_id) ON DELETE RESTRICT,
  project_id uuid REFERENCES projects(project_id) ON DELETE RESTRICT,
  country_code char(2) NOT NULL REFERENCES countries(code) ON DELETE RESTRICT,
  owner_user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  status_code text NOT NULL DEFAULT 'DRAFT',
  currency_code char(3), payment_terms_code text, custom_payment_terms text,
  valid_from date, expires_on date,
  subtotal_amount numeric(18,4) NOT NULL DEFAULT 0,
  adjustment_amount numeric(18,4) NOT NULL DEFAULT 0,
  total_amount numeric(18,4) NOT NULL DEFAULT 0,
  content_hash text,
  supersedes_quotation_id uuid REFERENCES quotations(quotation_id) ON DELETE RESTRICT,
  sent_at timestamptz(6), row_version bigint NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  created_by_user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_by_user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  CONSTRAINT quotations_status_check CHECK (status_code IN ('DRAFT','PENDING_APPROVAL','APPROVED','SENT','CANCELLED')),
  CONSTRAINT quotations_sent_immutable_shape CHECK ((status_code = 'SENT' AND sent_at IS NOT NULL AND content_hash IS NOT NULL) OR status_code <> 'SENT'),
  CONSTRAINT quotations_validity_check CHECK (expires_on IS NULL OR valid_from IS NULL OR expires_on >= valid_from),
  CONSTRAINT quotations_row_version_check CHECK (row_version > 0)
);
CREATE INDEX quotations_country_status_updated_idx ON quotations(country_code, status_code, updated_at DESC, quotation_id);
CREATE INDEX quotations_account_status_idx ON quotations(account_id, status_code);

CREATE TABLE quotation_lines (
  quotation_line_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), quotation_id uuid NOT NULL REFERENCES quotations(quotation_id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(product_id) ON DELETE RESTRICT, line_no integer NOT NULL, description text NOT NULL,
  qty numeric(18,4) NOT NULL, unit_code text NOT NULL, unit_price numeric(18,4) NOT NULL,
  discount_amount numeric(18,4) NOT NULL DEFAULT 0, line_total numeric(18,4) NOT NULL,
  price_rule_id uuid REFERENCES pricing_rules(pricing_rule_id) ON DELETE RESTRICT, price_snapshot jsonb,
  CONSTRAINT quotation_lines_number_check CHECK (line_no > 0), CONSTRAINT quotation_lines_qty_check CHECK (qty > 0),
  CONSTRAINT quotation_lines_price_check CHECK (unit_price >= 0 AND discount_amount >= 0 AND line_total >= 0),
  UNIQUE (quotation_id, line_no)
);

CREATE TABLE quotation_adjustments (
  quotation_adjustment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), quotation_id uuid NOT NULL REFERENCES quotations(quotation_id) ON DELETE CASCADE,
  type_code text NOT NULL, mode_code text NOT NULL, value numeric(18,4) NOT NULL, label text,
  CONSTRAINT quotation_adjustments_mode_check CHECK (mode_code IN ('PERCENT','FIXED_AMOUNT')),
  CONSTRAINT quotation_adjustments_value_check CHECK (value >= 0)
);
