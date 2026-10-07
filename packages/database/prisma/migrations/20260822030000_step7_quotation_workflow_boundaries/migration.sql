ALTER TABLE quotation_approvals
  ADD COLUMN IF NOT EXISTS required_authority_tier integer,
  ADD COLUMN IF NOT EXISTS current_assignee_user_id uuid,
  ADD COLUMN IF NOT EXISTS quotation_row_version_snapshot bigint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS calculation_version_snapshot text NOT NULL DEFAULT 'v1',
  ADD COLUMN IF NOT EXISTS invalidated_at timestamptz(6),
  ADD COLUMN IF NOT EXISTS invalidation_reason_code text;

CREATE TABLE IF NOT EXISTS quotation_acceptances (
  quotation_acceptance_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id uuid NOT NULL REFERENCES quotations(quotation_id) ON DELETE RESTRICT,
  evidence_type_code text NOT NULL,
  document_id uuid,
  external_reference text,
  accepted_at timestamptz(6) NOT NULL,
  verified_by_user_id uuid,
  status_code text NOT NULL DEFAULT 'VALID',
  created_at timestamptz(6) NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT quotation_acceptances_evidence_check
    CHECK (document_id IS NOT NULL OR nullif(btrim(external_reference), '') IS NOT NULL),
  CONSTRAINT quotation_acceptances_status_check
    CHECK (status_code IN ('VALID', 'REVOKED', 'REPLACED'))
);

CREATE INDEX IF NOT EXISTS quotation_acceptances_quote_accepted_idx
  ON quotation_acceptances (quotation_id, accepted_at);
