-- Customer orders: the order the CRM books from an accepted quotation.
--
-- ERP orders stay what they are -- facts imported from the ERP, read-only. A
-- customer order is the CRM's own record of what the customer agreed to, made
-- from the accepted quotation and carried through confirmation, production,
-- readiness and hand-over. Receivables, shipments and work orders hang off it;
-- when the ERP later imports the same order it is linked by erp_order_id.

CREATE SEQUENCE IF NOT EXISTS customer_order_ref_seq START WITH 1 INCREMENT BY 1;

CREATE TABLE IF NOT EXISTS customer_orders (
  customer_order_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_ref text NOT NULL UNIQUE
    DEFAULT ('SO-' || lpad(nextval('customer_order_ref_seq')::text, 6, '0')),
  quotation_id uuid NOT NULL UNIQUE REFERENCES quotations(quotation_id) ON DELETE RESTRICT,
  account_id uuid NOT NULL REFERENCES accounts(account_id) ON DELETE RESTRICT,
  opportunity_id uuid REFERENCES opportunities(opportunity_id) ON DELETE RESTRICT,
  erp_order_id uuid REFERENCES erp_orders(erp_order_id) ON DELETE RESTRICT,
  country_code character(2) NOT NULL,
  currency_code character(3) NOT NULL,
  status_code text NOT NULL DEFAULT 'DRAFT'
    CHECK (status_code IN ('DRAFT', 'CONFIRMED', 'IN_PRODUCTION', 'READY', 'HANDED_OVER', 'CLOSED', 'CANCELLED')),
  customer_po_number text,
  requested_delivery_date date,
  delivery_terms text,
  delivery_point text,
  notes text,
  subtotal_amount numeric(18, 4) NOT NULL CHECK (subtotal_amount >= 0),
  adjustment_amount numeric(18, 4) NOT NULL DEFAULT 0,
  vat_rate numeric(9, 6) NOT NULL DEFAULT 0 CHECK (vat_rate >= 0),
  tax_amount numeric(18, 4) NOT NULL CHECK (tax_amount >= 0),
  total_amount numeric(18, 4) NOT NULL CHECK (total_amount >= 0),
  payment_schedule_jsonb jsonb,
  payment_terms_text text,
  amendment_no integer NOT NULL DEFAULT 0 CHECK (amendment_no >= 0),
  owner_user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  created_by_user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  confirmed_at timestamptz(6),
  confirmed_by_user_id uuid REFERENCES app_users(id) ON DELETE RESTRICT,
  handed_over_at timestamptz(6),
  handed_over_by_user_id uuid REFERENCES app_users(id) ON DELETE RESTRICT,
  closed_at timestamptz(6),
  closed_by_user_id uuid REFERENCES app_users(id) ON DELETE RESTRICT,
  cancelled_at timestamptz(6),
  cancelled_by_user_id uuid REFERENCES app_users(id) ON DELETE RESTRICT,
  cancel_reason text,
  row_version bigint NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT customer_orders_cancel_reason_check
    CHECK (status_code <> 'CANCELLED' OR NULLIF(btrim(cancel_reason), '') IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS customer_orders_account_created_idx
  ON customer_orders(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS customer_orders_country_status_updated_idx
  ON customer_orders(country_code, status_code, updated_at DESC);

CREATE TABLE IF NOT EXISTS customer_order_lines (
  customer_order_line_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_order_id uuid NOT NULL REFERENCES customer_orders(customer_order_id) ON DELETE CASCADE,
  quotation_line_id uuid REFERENCES quotation_lines(quotation_line_id) ON DELETE SET NULL,
  line_no integer NOT NULL CHECK (line_no > 0),
  product_id uuid REFERENCES products(product_id) ON DELETE RESTRICT,
  item_code text,
  description text NOT NULL,
  quantity numeric(18, 4) NOT NULL CHECK (quantity > 0),
  unit_code text NOT NULL,
  unit_price numeric(18, 4) NOT NULL CHECK (unit_price >= 0),
  discount_amount numeric(18, 4) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  line_total numeric(18, 4) NOT NULL CHECK (line_total >= 0),
  weight_kg numeric(18, 3),
  UNIQUE (customer_order_id, line_no)
);

CREATE TABLE IF NOT EXISTS customer_order_events (
  customer_order_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_order_id uuid NOT NULL REFERENCES customer_orders(customer_order_id) ON DELETE CASCADE,
  event_code text NOT NULL,
  from_status_code text,
  to_status_code text,
  note text,
  details jsonb,
  actor_user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS customer_order_events_order_created_idx
  ON customer_order_events(customer_order_id, created_at);

INSERT INTO permissions(permission_id, code, description) VALUES
  (gen_random_uuid(), 'sales-orders.create', 'Book a customer order from an accepted quotation'),
  (gen_random_uuid(), 'sales-orders.manage', 'Confirm, amend, hand over, close or cancel a customer order')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions(role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE (r.code IN ('SALES_MANAGER', 'SYSTEM_ADMIN') AND p.code IN ('sales-orders.view', 'sales-orders.create', 'sales-orders.manage'))
   OR (r.code = 'SALES_REP' AND p.code IN ('sales-orders.view', 'sales-orders.create'))
   OR (r.code IN ('LOGISTICS_COORDINATOR', 'FINANCE_ANALYST', 'OPERATIONS_ANALYST') AND p.code = 'sales-orders.view')
ON CONFLICT DO NOTHING;
