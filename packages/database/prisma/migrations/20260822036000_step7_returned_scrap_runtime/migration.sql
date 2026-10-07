CREATE TABLE returned_scrap_policies (
 policy_id uuid PRIMARY KEY, policy_code text NOT NULL UNIQUE, benefit_rate numeric(5,4) NOT NULL CHECK(benefit_rate=0.25),
 effective_from timestamptz(6) NOT NULL, effective_to timestamptz(6), status_code text NOT NULL DEFAULT 'ACTIVE'
);
INSERT INTO returned_scrap_policies(policy_id,policy_code,benefit_rate,effective_from,status_code)
VALUES('25000000-0000-4000-8000-000000000025','ORIGINAL_PURCHASE_25_PERCENT',0.25,'2020-01-01T00:00:00Z','ACTIVE');
ALTER TABLE returned_scrap_requests ADD COLUMN case_ref text;
UPDATE returned_scrap_requests SET case_ref='RSC-'||upper(substr(replace(returned_scrap_request_id::text,'-',''),1,12));
ALTER TABLE returned_scrap_requests ALTER COLUMN case_ref SET NOT NULL;
ALTER TABLE returned_scrap_requests ADD CONSTRAINT returned_scrap_requests_case_ref_key UNIQUE(case_ref);
ALTER TABLE returned_scrap_requests ADD COLUMN original_quotation_id uuid REFERENCES quotations(quotation_id) ON DELETE RESTRICT;
ALTER TABLE returned_scrap_requests ADD COLUMN country_code char(2) REFERENCES countries(code) ON DELETE RESTRICT;
ALTER TABLE returned_scrap_requests ADD COLUMN received_at timestamptz(6);
ALTER TABLE returned_scrap_requests ADD COLUMN policy_id uuid REFERENCES returned_scrap_policies(policy_id) ON DELETE RESTRICT;
ALTER TABLE returned_scrap_requests ADD COLUMN applied_credit_pct_snapshot numeric(5,2) NOT NULL DEFAULT 25 CHECK(applied_credit_pct_snapshot=25);
ALTER TABLE returned_scrap_requests ADD COLUMN assessed_base_amount numeric(18,4) NOT NULL DEFAULT 0 CHECK(assessed_base_amount>=0);
ALTER TABLE returned_scrap_requests ADD COLUMN benefit_value_amount numeric(18,4) NOT NULL DEFAULT 0 CHECK(benefit_value_amount>=0);
ALTER TABLE returned_scrap_requests ADD COLUMN currency_code_snapshot char(3);
ALTER TABLE returned_scrap_requests ADD COLUMN assessment_hash text;
ALTER TABLE returned_scrap_requests ADD COLUMN submitted_at timestamptz(6);
ALTER TABLE returned_scrap_requests ADD COLUMN finalized_at timestamptz(6);
ALTER TABLE returned_scrap_requests ADD COLUMN finalized_by_user_id uuid REFERENCES app_users(id) ON DELETE RESTRICT;
ALTER TABLE returned_scrap_requests ADD COLUMN rejected_at timestamptz(6);
ALTER TABLE returned_scrap_requests ADD COLUMN rejected_by_user_id uuid REFERENCES app_users(id) ON DELETE RESTRICT;
ALTER TABLE returned_scrap_requests ADD COLUMN rejection_reason text;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM returned_scrap_requests) THEN
    RAISE EXCEPTION 'RETURNED_SCRAP_AUTHORITATIVE_BACKFILL_REQUIRED';
  END IF;
END $$;
ALTER TABLE returned_scrap_requests ALTER COLUMN original_quotation_id SET NOT NULL;
ALTER TABLE returned_scrap_requests ALTER COLUMN country_code SET NOT NULL;
ALTER TABLE returned_scrap_requests ALTER COLUMN policy_id SET NOT NULL;
ALTER TABLE returned_scrap_requests ALTER COLUMN currency_code_snapshot SET NOT NULL;
ALTER TABLE returned_scrap_requests ADD CONSTRAINT returned_scrap_requests_status_v1_check CHECK(status_code IN('DRAFT','PENDING_APPROVAL','APPROVED','FINALIZED','REJECTED','CANCELLED'));
CREATE INDEX returned_scrap_requests_scope_idx ON returned_scrap_requests(country_code,status_code,requested_at DESC);
ALTER TABLE returned_scrap_items ADD COLUMN product_id uuid REFERENCES products(product_id) ON DELETE RESTRICT;
ALTER TABLE returned_scrap_items ADD COLUMN returned_qty numeric(18,4);
ALTER TABLE returned_scrap_items ADD COLUMN unit_code text;
ALTER TABLE returned_scrap_items ADD COLUMN eligible_base_amount numeric(18,4);
ALTER TABLE returned_scrap_items ADD COLUMN created_at timestamptz(6) NOT NULL DEFAULT now();
ALTER TABLE returned_scrap_items ALTER COLUMN returned_qty SET NOT NULL;
ALTER TABLE returned_scrap_items ALTER COLUMN eligible_base_amount SET NOT NULL;
ALTER TABLE returned_scrap_items ADD CONSTRAINT returned_scrap_items_qty_check CHECK(returned_qty>0 AND eligible_base_amount>=0);
