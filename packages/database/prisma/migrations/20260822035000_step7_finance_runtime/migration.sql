ALTER TABLE fx_rates ADD COLUMN changed_by_user_id uuid REFERENCES app_users(id) ON DELETE RESTRICT;
ALTER TABLE fx_rates ADD COLUMN supersedes_fx_rate_id uuid REFERENCES fx_rates(fx_rate_id) ON DELETE RESTRICT;
ALTER TABLE fx_rates ADD COLUMN reason text;
ALTER TABLE fx_rates ADD COLUMN created_at timestamptz(6) NOT NULL DEFAULT now();
UPDATE fx_rates SET status_code='APPROVED' WHERE status_code='ACTIVE';
CREATE UNIQUE INDEX fx_rates_one_effective_version_idx ON fx_rates(base_currency_code,quote_currency_code,effective_from);

ALTER TABLE payments ADD COLUMN payment_date date NOT NULL DEFAULT CURRENT_DATE;
ALTER TABLE payments ADD COLUMN payment_method_code text;
ALTER TABLE payments ADD COLUMN raw_reference text;
ALTER TABLE payments ADD COLUMN source_type_code text NOT NULL DEFAULT 'IMPORT';
ALTER TABLE payments ADD COLUMN created_by_user_id uuid REFERENCES app_users(id) ON DELETE RESTRICT;
ALTER TABLE payments ADD COLUMN created_at timestamptz(6) NOT NULL DEFAULT now();
ALTER TABLE payments ADD COLUMN row_version bigint NOT NULL DEFAULT 1;
ALTER TABLE payments ADD COLUMN voided_at timestamptz(6);
ALTER TABLE payments ADD COLUMN voided_by_user_id uuid REFERENCES app_users(id) ON DELETE RESTRICT;
ALTER TABLE payments ADD COLUMN void_reason text;
ALTER TABLE payments ADD COLUMN correction_of_payment_id uuid REFERENCES payments(payment_id) ON DELETE RESTRICT;
ALTER TABLE payments ADD CONSTRAINT payments_source_type_check CHECK(source_type_code IN ('IMPORT','MANUAL'));
ALTER TABLE payments ADD CONSTRAINT payments_status_check CHECK(status_code IN ('ACTIVE','VOID'));
CREATE TABLE payment_allocations (
 payment_allocation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), payment_id uuid NOT NULL REFERENCES payments(payment_id) ON DELETE RESTRICT,
 sales_order_id uuid REFERENCES erp_orders(erp_order_id) ON DELETE RESTRICT, allocated_amount numeric(18,4) NOT NULL CHECK(allocated_amount>0), reason text,
 created_by_user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT, created_at timestamptz(6) NOT NULL DEFAULT now()
);
CREATE INDEX payment_allocations_payment_idx ON payment_allocations(payment_id);

ALTER TABLE cheques ADD COLUMN bank_name text;
ALTER TABLE cheques ADD COLUMN issue_date date;
ALTER TABLE cheques ADD COLUMN deposited_at timestamptz(6);
ALTER TABLE cheques ADD COLUMN cleared_at timestamptz(6);
ALTER TABLE cheques ADD COLUMN bounced_at timestamptz(6);
ALTER TABLE cheques ADD COLUMN cancelled_at timestamptz(6);
ALTER TABLE cheques ADD COLUMN row_version bigint NOT NULL DEFAULT 1;
ALTER TABLE cheques ADD COLUMN created_by_user_id uuid REFERENCES app_users(id) ON DELETE RESTRICT;
ALTER TABLE cheques ADD COLUMN created_at timestamptz(6) NOT NULL DEFAULT now();
ALTER TABLE cheques ADD COLUMN transition_reason text;
ALTER TABLE cheques ADD COLUMN evidence_document_id uuid;
ALTER TABLE cheques ADD CONSTRAINT cheques_status_check CHECK(status_code IN ('RECEIVED','DEPOSITED','CLEARED','BOUNCED','CANCELLED'));
