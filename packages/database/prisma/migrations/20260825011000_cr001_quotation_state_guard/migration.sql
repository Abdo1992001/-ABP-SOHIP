-- CR-001 keeps opportunity stages out of the quotation aggregate.
-- Cancellation remains a historical storage value only; no V1 command route exists.
ALTER TABLE quotations
  ADD CONSTRAINT quotations_document_state_check
  CHECK (status_code IN ('DRAFT', 'READY', 'SENT', 'EXPIRED', 'CANCELLED'));

UPDATE quotations
SET commercial_state_code = 'SUBMITTED',
    first_submitted_at = COALESCE(first_submitted_at, sent_at, updated_at, created_at)
WHERE status_code = 'SENT'
  AND (commercial_state_code = 'NOT_SUBMITTED' OR first_submitted_at IS NULL);

ALTER TABLE quotations
  ADD CONSTRAINT quotations_submission_consistency_check
  CHECK (
    (status_code = 'SENT' AND commercial_state_code IN ('SUBMITTED', 'UNDER_NEGOTIATION') AND first_submitted_at IS NOT NULL)
    OR
    (status_code <> 'SENT' AND commercial_state_code = 'NOT_SUBMITTED' AND first_submitted_at IS NULL)
  );
