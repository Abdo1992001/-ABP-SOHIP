-- Customer feedback, given without an account.
--
-- A customer opens the public feedback page, says who they are and how to
-- reach them, and gives something that ties them to us: an order number, a
-- quotation or proforma number, an item code. The reference matches them to
-- their account, and the account to the salesperson who is told about it.
-- Critical feedback, and problems rated two stars or fewer, open a complaint
-- straight away, so they go down the complaint route rather than sitting here.

CREATE SEQUENCE IF NOT EXISTS customer_feedback_ref_seq START WITH 1 INCREMENT BY 1;

CREATE TABLE IF NOT EXISTS customer_feedback (
  feedback_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feedback_ref text NOT NULL UNIQUE
    DEFAULT ('FB-' || lpad(nextval('customer_feedback_ref_seq')::text, 6, '0')),
  kind_code text NOT NULL CHECK (kind_code IN ('SATISFACTION', 'PROBLEM', 'SUGGESTION', 'QUESTION')),
  rating smallint CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
  is_critical boolean NOT NULL DEFAULT false,
  reference_type_code text NOT NULL
    CHECK (reference_type_code IN ('ORDER', 'QUOTATION', 'PROFORMA', 'ITEM_CODE', 'OTHER')),
  reference_text text NOT NULL,
  -- What the reference matched, if anything.
  account_id uuid REFERENCES accounts(account_id) ON DELETE SET NULL,
  customer_order_id uuid REFERENCES customer_orders(customer_order_id) ON DELETE SET NULL,
  quotation_id uuid REFERENCES quotations(quotation_id) ON DELETE SET NULL,
  product_id uuid REFERENCES products(product_id) ON DELETE SET NULL,
  salesperson_user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  country_code character(2),
  -- Who they are and how to reach them.
  contact_name text NOT NULL,
  company_name text,
  job_title text,
  phone text,
  email text,
  preferred_channel_code text CHECK (preferred_channel_code IS NULL OR preferred_channel_code IN ('PHONE', 'WHATSAPP', 'EMAIL')),
  consent_to_contact boolean NOT NULL DEFAULT true,
  message text NOT NULL,
  -- What we did about it.
  status_code text NOT NULL DEFAULT 'NEW'
    CHECK (status_code IN ('NEW', 'ACKNOWLEDGED', 'CONTACTED', 'CLOSED')),
  complaint_id uuid REFERENCES complaints(complaint_id) ON DELETE SET NULL,
  follow_up_note text,
  followed_up_by_user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  followed_up_at timestamptz(6),
  source_hash text,
  row_version bigint NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT customer_feedback_contact_check
    CHECK (NULLIF(btrim(phone), '') IS NOT NULL OR NULLIF(btrim(email), '') IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS customer_feedback_salesperson_idx
  ON customer_feedback(salesperson_user_id, status_code, created_at DESC);
CREATE INDEX IF NOT EXISTS customer_feedback_account_idx
  ON customer_feedback(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS customer_feedback_status_idx
  ON customer_feedback(status_code, created_at DESC);

INSERT INTO permissions(permission_id, code, description) VALUES
  (gen_random_uuid(), 'feedback.view', 'See customer feedback'),
  (gen_random_uuid(), 'feedback.manage', 'Follow up customer feedback and match it to a customer')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions(role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE (r.code IN ('SYSTEM_ADMIN', 'SALES_MANAGER', 'SALES_REP') AND p.code IN ('feedback.view', 'feedback.manage'))
   OR (r.code IN ('OPERATIONS_ANALYST', 'LOGISTICS_COORDINATOR', 'R_AND_D') AND p.code = 'feedback.view')
ON CONFLICT DO NOTHING;

-- What the feedback is about, in the complaint categories, so a complaint
-- opened from it lands in the right one.
ALTER TABLE customer_feedback ADD COLUMN IF NOT EXISTS topic_code text NOT NULL DEFAULT 'OTHER'
  CHECK (topic_code IN ('PRODUCT_QUALITY', 'DELIVERY_DELAY', 'DAMAGED_GOODS', 'BILLING', 'SERVICE', 'OTHER'));
