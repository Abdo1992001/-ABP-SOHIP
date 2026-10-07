-- The approval statuses the application writes, allowed by the table.
--
-- The table was created allowing only PENDING, APPROVED and REJECTED. The
-- workflow (Step 8) and the API contract also have:
--
--   INVALIDATED        — an approval request goes void when the quotation it
--                        was raised on is edited; the service marks it so on
--                        every draft save. `invalidated_at` was added for it
--                        in step 7, but the check was never widened, so saving
--                        any quotation with a pending approval failed with a
--                        database error and the edit was lost.
--   CHANGES_REQUESTED  — the approver's third decision besides approve and
--                        reject, which failed the same way.
--
-- A decided status still needs who decided and when; an invalidated one needs
-- when it was invalidated.

ALTER TABLE quotation_approvals DROP CONSTRAINT IF EXISTS quotation_approvals_check;

ALTER TABLE quotation_approvals ADD CONSTRAINT quotation_approvals_check CHECK (
  (
    status_code IN ('APPROVED', 'REJECTED', 'CHANGES_REQUESTED')
    AND decided_at IS NOT NULL
    AND decided_by_user_id IS NOT NULL
  )
  OR status_code = 'PENDING'
  OR (status_code = 'INVALIDATED' AND invalidated_at IS NOT NULL)
);
