-- A quotation that was sent keeps its submission record when it later leaves
-- SENT. The earlier check required every non-SENT row to look never-submitted,
-- so superseding, expiring or cancelling a sent quotation failed the update.
ALTER TABLE quotations
  DROP CONSTRAINT quotations_submission_consistency_check;

ALTER TABLE quotations
  ADD CONSTRAINT quotations_submission_consistency_check
  CHECK (
    (status_code = 'SENT' AND commercial_state_code IN ('SUBMITTED', 'UNDER_NEGOTIATION') AND first_submitted_at IS NOT NULL)
    OR
    (status_code IN ('DRAFT', 'READY') AND commercial_state_code = 'NOT_SUBMITTED' AND first_submitted_at IS NULL)
    OR
    (status_code IN ('SUPERSEDED', 'EXPIRED', 'CANCELLED') AND (
      (commercial_state_code = 'NOT_SUBMITTED' AND first_submitted_at IS NULL)
      OR
      (commercial_state_code IN ('SUBMITTED', 'UNDER_NEGOTIATION') AND first_submitted_at IS NOT NULL)
    ))
  );
