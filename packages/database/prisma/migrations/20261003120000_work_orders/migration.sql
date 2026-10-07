-- Work orders: the factory's side of a customer order.
--
-- A confirmed order is planned onto a production line for a run of days.
-- The days come from the capacity rates already kept for each board category
-- (boards per day), so a planned end date is arithmetic, not a guess. Starting
-- the first work order puts the order into production; completing the last
-- one, after its quality check, makes the order ready to ship.

CREATE SEQUENCE IF NOT EXISTS work_order_ref_seq START WITH 1 INCREMENT BY 1;

CREATE TABLE IF NOT EXISTS work_orders (
  work_order_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_ref text NOT NULL UNIQUE
    DEFAULT ('WO-' || lpad(nextval('work_order_ref_seq')::text, 6, '0')),
  customer_order_id uuid NOT NULL REFERENCES customer_orders(customer_order_id) ON DELETE RESTRICT,
  account_id uuid NOT NULL REFERENCES accounts(account_id) ON DELETE RESTRICT,
  country_code character(2) NOT NULL,
  status_code text NOT NULL DEFAULT 'PLANNED'
    CHECK (status_code IN ('PLANNED', 'RELEASED', 'IN_PROGRESS', 'ON_HOLD', 'QC', 'COMPLETED', 'CANCELLED')),
  production_line_code text NOT NULL,
  capacity_category_code text NOT NULL,
  boards_per_day_snapshot integer CHECK (boards_per_day_snapshot IS NULL OR boards_per_day_snapshot > 0),
  quantity_planned numeric(18, 4) NOT NULL CHECK (quantity_planned > 0),
  quantity_produced numeric(18, 4) NOT NULL DEFAULT 0 CHECK (quantity_produced >= 0),
  quantity_rejected numeric(18, 4) NOT NULL DEFAULT 0 CHECK (quantity_rejected >= 0),
  planned_start_date date NOT NULL,
  planned_end_date date NOT NULL,
  actual_start_at timestamptz(6),
  actual_end_at timestamptz(6),
  priority_code text NOT NULL DEFAULT 'NORMAL'
    CHECK (priority_code IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
  notes text,
  qc_result_code text CHECK (qc_result_code IS NULL OR qc_result_code IN ('PASS', 'CONDITIONAL', 'FAIL')),
  qc_notes text,
  qc_by_user_id uuid REFERENCES app_users(id) ON DELETE RESTRICT,
  qc_at timestamptz(6),
  hold_reason text,
  cancel_reason text,
  created_by_user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  row_version bigint NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT work_orders_dates_check CHECK (planned_end_date >= planned_start_date),
  CONSTRAINT work_orders_cancel_reason_check
    CHECK (status_code <> 'CANCELLED' OR NULLIF(btrim(cancel_reason), '') IS NOT NULL),
  CONSTRAINT work_orders_completed_qc_check
    CHECK (status_code <> 'COMPLETED' OR qc_result_code IN ('PASS', 'CONDITIONAL'))
);
CREATE INDEX IF NOT EXISTS work_orders_order_idx ON work_orders(customer_order_id, created_at);
CREATE INDEX IF NOT EXISTS work_orders_schedule_idx
  ON work_orders(country_code, planned_start_date, planned_end_date);

CREATE TABLE IF NOT EXISTS work_order_events (
  work_order_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id uuid NOT NULL REFERENCES work_orders(work_order_id) ON DELETE CASCADE,
  event_code text NOT NULL,
  from_status_code text,
  to_status_code text,
  note text,
  details jsonb,
  actor_user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS work_order_events_order_idx ON work_order_events(work_order_id, created_at);

INSERT INTO permissions(permission_id, code, description) VALUES
  (gen_random_uuid(), 'work-orders.view', 'See work orders and the production schedule'),
  (gen_random_uuid(), 'work-orders.manage', 'Plan, release, start, hold and complete work orders'),
  (gen_random_uuid(), 'work-orders.qc', 'Record the quality check of a work order')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions(role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE (r.code IN ('SYSTEM_ADMIN', 'OPERATIONS_ANALYST') AND p.code IN ('work-orders.view', 'work-orders.manage', 'work-orders.qc'))
   OR (r.code = 'R_AND_D' AND p.code IN ('work-orders.view', 'work-orders.qc'))
   OR (r.code IN ('SALES_MANAGER', 'SALES_REP', 'LOGISTICS_COORDINATOR') AND p.code = 'work-orders.view')
ON CONFLICT DO NOTHING;
