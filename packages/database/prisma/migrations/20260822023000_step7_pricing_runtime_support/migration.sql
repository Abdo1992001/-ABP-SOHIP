-- Step 7 contract-completion storage for already-approved Pricing APIs.
CREATE TABLE payment_terms (
 payment_term_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), term_code text NOT NULL, display_text text NOT NULL,
 effective_from timestamptz(6) NOT NULL, effective_to timestamptz(6), is_active boolean NOT NULL DEFAULT true,
 created_by_user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT, created_at timestamptz(6) NOT NULL DEFAULT now(),
 UNIQUE(term_code,effective_from), CHECK(effective_to IS NULL OR effective_to>effective_from)
);
CREATE INDEX payment_terms_active_idx ON payment_terms(is_active,effective_from);
CREATE TABLE tax_policies (
 tax_policy_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tax_code text NOT NULL, version_no integer NOT NULL, tax_rate_pct numeric(5,2) NOT NULL,
 effective_from timestamptz(6) NOT NULL, effective_to timestamptz(6), status_code text NOT NULL DEFAULT 'ACTIVE',
 created_by_user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT, created_at timestamptz(6) NOT NULL DEFAULT now(),
 UNIQUE(tax_code,version_no), CHECK(tax_rate_pct BETWEEN 0 AND 100), CHECK(effective_to IS NULL OR effective_to>effective_from)
);
CREATE INDEX tax_policies_active_idx ON tax_policies(status_code,effective_from);
CREATE TABLE pricing_guardrails (
 pricing_guardrail_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), product_id uuid REFERENCES products(product_id) ON DELETE RESTRICT,
 product_family_id uuid REFERENCES product_families(product_family_id) ON DELETE RESTRICT, min_price numeric(18,4), reference_price numeric(18,4),
 max_price numeric(18,4), currency_code char(3) NOT NULL, effective_from timestamptz(6) NOT NULL, effective_to timestamptz(6),
 created_by_user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT, created_at timestamptz(6) NOT NULL DEFAULT now(),
 CHECK(product_id IS NOT NULL OR product_family_id IS NOT NULL), CHECK(min_price IS NULL OR min_price>=0), CHECK(reference_price IS NULL OR min_price IS NULL OR reference_price>=min_price), CHECK(max_price IS NULL OR reference_price IS NULL OR max_price>=reference_price), CHECK(effective_to IS NULL OR effective_to>effective_from)
);
CREATE INDEX pricing_guardrails_resolution_idx ON pricing_guardrails(product_id,product_family_id,currency_code,effective_from);
CREATE TABLE pricing_base_configs (
 pricing_base_config_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), standard_board_price numeric(18,4) NOT NULL, currency_code char(3) NOT NULL,
 standard_weight_kg numeric(14,4) NOT NULL, effective_from timestamptz(6) NOT NULL, effective_to timestamptz(6),
 created_by_user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT, created_at timestamptz(6) NOT NULL DEFAULT now(),
 CHECK(standard_board_price>=0 AND standard_weight_kg>0), CHECK(effective_to IS NULL OR effective_to>effective_from)
);
CREATE INDEX pricing_base_configs_effective_idx ON pricing_base_configs(currency_code,effective_from);
CREATE TABLE price_overrides (
 price_override_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), quotation_id uuid NOT NULL REFERENCES quotations(quotation_id) ON DELETE RESTRICT,
 quotation_line_id uuid REFERENCES quotation_lines(quotation_line_id) ON DELETE RESTRICT, requested_below_min_price numeric(18,4) NOT NULL,
 min_price_snapshot numeric(18,4) NOT NULL, currency_code char(3) NOT NULL, reason text NOT NULL, status_code text NOT NULL DEFAULT 'PENDING',
 approval_request_id uuid, requested_by_user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT, requested_at timestamptz(6) NOT NULL DEFAULT now(),
 approved_by_user_id uuid REFERENCES app_users(id) ON DELETE RESTRICT, approved_at timestamptz(6), applied_at timestamptz(6), row_version bigint NOT NULL DEFAULT 1,
 CHECK(requested_below_min_price>=0 AND min_price_snapshot>=0 AND requested_below_min_price<min_price_snapshot), CHECK(status_code IN('PENDING','APPROVED','REJECTED','APPLIED','CANCELLED')), CHECK(row_version>0)
);
CREATE INDEX price_overrides_quotation_status_idx ON price_overrides(quotation_id,status_code);
