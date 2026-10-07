-- Complaints are routed, not just opened and closed.
--
-- Sales logs the complaint; Operations checks what actually happened (the
-- order, the load, the delivery) and either finds the cause itself or hands it
-- to Quality; Quality names the root cause; someone owns the corrective action
-- by a date; Sales confirms with the customer and closes it. Each stage has an
-- owner and a deadline, so a complaint that is sitting somewhere is visible as
-- sitting there.
--
-- The old IN_REVIEW status -- and IN_PROGRESS, which some imported cases carry
-- and which no transition ever accepted, leaving them stuck -- both meant
-- "someone is looking at it": they become OPERATIONS_REVIEW.

ALTER TABLE complaints
  ADD COLUMN IF NOT EXISTS customer_order_id uuid REFERENCES customer_orders(customer_order_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assignee_user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS stage_entered_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS stage_due_at timestamptz(6),
  ADD COLUMN IF NOT EXISTS operations_findings text,
  ADD COLUMN IF NOT EXISTS root_cause_code text,
  ADD COLUMN IF NOT EXISTS root_cause_detail text,
  ADD COLUMN IF NOT EXISTS corrective_action text,
  ADD COLUMN IF NOT EXISTS preventive_action text,
  ADD COLUMN IF NOT EXISTS solution_owner_user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS solution_due_date date,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz(6),
  ADD COLUMN IF NOT EXISTS closed_at timestamptz(6);

UPDATE complaints
SET status_code = 'OPERATIONS_REVIEW',
    stage_entered_at = updated_at,
    row_version = row_version + 1
WHERE status_code IN ('IN_REVIEW', 'IN_PROGRESS');

UPDATE complaints SET stage_entered_at = updated_at WHERE status_code <> 'OPERATIONS_REVIEW';
UPDATE complaints SET resolved_at = updated_at WHERE status_code IN ('RESOLVED', 'CLOSED') AND resolved_at IS NULL;
UPDATE complaints SET closed_at = updated_at WHERE status_code = 'CLOSED' AND closed_at IS NULL;

ALTER TABLE complaints
  ADD CONSTRAINT complaints_status_check CHECK (status_code IN
    ('OPEN', 'OPERATIONS_REVIEW', 'QUALITY_REVIEW', 'SOLUTION', 'RESOLVED', 'CLOSED')),
  ADD CONSTRAINT complaints_root_cause_check CHECK (root_cause_code IS NULL OR root_cause_code IN
    ('MATERIAL', 'PRODUCTION', 'PACKAGING', 'LOADING', 'TRANSPORT', 'SITE_HANDLING',
     'SPECIFICATION', 'DOCUMENTATION', 'BILLING', 'SERVICE', 'NOT_JUSTIFIED', 'OTHER'));

CREATE INDEX IF NOT EXISTS complaints_assignee_status_idx
  ON complaints(assignee_user_id, status_code);

CREATE TABLE IF NOT EXISTS complaint_events (
  complaint_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  complaint_id uuid NOT NULL REFERENCES complaints(complaint_id) ON DELETE CASCADE,
  event_code text NOT NULL,
  from_status_code text,
  to_status_code text,
  note text,
  details jsonb,
  actor_user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS complaint_events_complaint_created_idx
  ON complaint_events(complaint_id, created_at);

INSERT INTO permissions(permission_id, code, description) VALUES
  (gen_random_uuid(), 'complaints.operations-review', 'Investigate a complaint for Operations and route it to Quality or a solution'),
  (gen_random_uuid(), 'complaints.quality-review', 'Name the root cause of a complaint and set its corrective action')
ON CONFLICT (code) DO NOTHING;

-- Operations investigates; Quality review sits with R&D, which owns product
-- engineering. Both need to see the complaints they are routed.
INSERT INTO role_permissions(role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE (r.code = 'SYSTEM_ADMIN' AND p.code IN ('complaints.operations-review', 'complaints.quality-review'))
   OR (r.code = 'OPERATIONS_ANALYST' AND p.code IN ('complaints.view', 'complaints.operations-review'))
   OR (r.code = 'R_AND_D' AND p.code IN ('complaints.view', 'complaints.quality-review'))
ON CONFLICT DO NOTHING;

-- Give cases already on the route a deadline from when they entered their
-- stage, so the ones that were stuck show as late rather than as undated.
UPDATE complaints
SET stage_due_at = stage_entered_at + CASE status_code
    WHEN 'OPEN' THEN interval '24 hours'
    WHEN 'OPERATIONS_REVIEW' THEN interval '48 hours'
    WHEN 'RESOLVED' THEN interval '72 hours'
  END
WHERE stage_due_at IS NULL AND status_code IN ('OPEN', 'OPERATIONS_REVIEW', 'RESOLVED');
