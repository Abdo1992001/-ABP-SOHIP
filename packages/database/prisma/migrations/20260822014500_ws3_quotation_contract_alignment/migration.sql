ALTER TABLE quotations
  ADD COLUMN payment_terms_snapshot text,
  ADD COLUMN fx_rate_id uuid,
  ADD COLUMN fx_rate_snapshot numeric(18,8),
  ADD COLUMN fx_effective_at_snapshot timestamptz(6),
  ADD COLUMN calculation_version text NOT NULL DEFAULT 'v1',
  ADD COLUMN tax_amount numeric(18,4) NOT NULL DEFAULT 0;

ALTER TABLE quotations DROP CONSTRAINT quotations_status_check;
ALTER TABLE quotations ADD CONSTRAINT quotations_status_check CHECK (status_code IN ('DRAFT','READY','SENT','EXPIRED','CANCELLED'));
