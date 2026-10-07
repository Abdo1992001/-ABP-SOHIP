-- CR-001 additive implementation. Forward-only; no prior migration is rewritten.
CREATE SEQUENCE IF NOT EXISTS shipment_ref_seq START WITH 1 INCREMENT BY 1;

ALTER TABLE quotations
  ADD COLUMN commercial_state_code text NOT NULL DEFAULT 'NOT_SUBMITTED',
  ADD COLUMN first_submitted_at timestamptz(6);

ALTER TABLE quotations
  ADD CONSTRAINT quotations_commercial_state_check
  CHECK (commercial_state_code IN ('NOT_SUBMITTED', 'SUBMITTED', 'UNDER_NEGOTIATION'));

ALTER TABLE complaints ADD COLUMN product_id uuid;
ALTER TABLE complaints ADD CONSTRAINT complaints_product_fk
  FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE RESTRICT;
CREATE INDEX complaints_product_created_idx ON complaints(product_id, created_at DESC);

CREATE TABLE customer_segment_definitions (
  customer_segment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  segment_code text NOT NULL UNIQUE,
  display_name_en text NOT NULL,
  display_name_ar text NOT NULL,
  status_code text NOT NULL DEFAULT 'ACTIVE' CHECK (status_code IN ('ACTIVE', 'ARCHIVED')),
  row_version bigint NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by_user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  archived_at timestamptz(6),
  archived_by_user_id uuid REFERENCES app_users(id) ON DELETE RESTRICT
);
CREATE INDEX customer_segment_definitions_status_code_idx
  ON customer_segment_definitions(status_code, segment_code);

CREATE TABLE customer_segment_assignments (
  customer_segment_assignment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(account_id) ON DELETE RESTRICT,
  customer_segment_id uuid NOT NULL REFERENCES customer_segment_definitions(customer_segment_id) ON DELETE RESTRICT,
  effective_from timestamptz(6) NOT NULL,
  effective_to timestamptz(6),
  source_code text NOT NULL DEFAULT 'MANUAL',
  source_reference text,
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by_user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  CONSTRAINT customer_segment_assignment_range_check CHECK (effective_to IS NULL OR effective_to > effective_from)
);
CREATE UNIQUE INDEX customer_segment_assignments_one_current_idx
  ON customer_segment_assignments(account_id) WHERE effective_to IS NULL;
CREATE INDEX customer_segment_assignments_account_effective_idx
  ON customer_segment_assignments(account_id, effective_from, effective_to);
CREATE INDEX customer_segment_assignments_segment_effective_idx
  ON customer_segment_assignments(customer_segment_id, effective_from, effective_to);

CREATE TABLE quotation_commercial_state_events (
  quotation_commercial_state_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id uuid NOT NULL REFERENCES quotations(quotation_id) ON DELETE RESTRICT,
  from_state_code text NOT NULL,
  to_state_code text NOT NULL,
  occurred_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actor_user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  quotation_row_version bigint NOT NULL,
  reason text,
  CONSTRAINT quotation_commercial_event_state_check CHECK (
    from_state_code IN ('NOT_SUBMITTED', 'SUBMITTED', 'UNDER_NEGOTIATION') AND
    to_state_code IN ('SUBMITTED', 'UNDER_NEGOTIATION')
  )
);
CREATE INDEX quotation_commercial_events_quote_occurred_idx
  ON quotation_commercial_state_events(quotation_id, occurred_at, quotation_commercial_state_event_id);

CREATE TABLE shipments (
  shipment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_ref text NOT NULL UNIQUE DEFAULT ('SHP-' || lpad(nextval('shipment_ref_seq')::text, 8, '0')),
  erp_order_id uuid NOT NULL REFERENCES erp_orders(erp_order_id) ON DELETE RESTRICT,
  country_code char(2) NOT NULL REFERENCES countries(code) ON DELETE RESTRICT,
  milestone_code text NOT NULL DEFAULT 'READY_FOR_DELIVERY',
  bl_date date,
  port_of_discharge text,
  actual_arrival_at timestamptz(6),
  row_version bigint NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by_user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  updated_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by_user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  CONSTRAINT shipments_milestone_check CHECK (milestone_code IN (
    'READY_FOR_DELIVERY','SHIPPED','VESSEL_DEPARTED','ARRIVED_AT_PORT_OF_DISCHARGE'
  )),
  CONSTRAINT shipments_departure_bl_check CHECK (
    milestone_code NOT IN ('VESSEL_DEPARTED','ARRIVED_AT_PORT_OF_DISCHARGE') OR bl_date IS NOT NULL
  ),
  CONSTRAINT shipments_arrival_fields_check CHECK (
    milestone_code <> 'ARRIVED_AT_PORT_OF_DISCHARGE' OR
    (port_of_discharge IS NOT NULL AND btrim(port_of_discharge) <> '' AND actual_arrival_at IS NOT NULL)
  )
);
CREATE INDEX shipments_erp_order_created_idx ON shipments(erp_order_id, created_at, shipment_id);
CREATE INDEX shipments_country_milestone_updated_idx ON shipments(country_code, milestone_code, updated_at, shipment_id);

CREATE TABLE shipment_milestone_events (
  shipment_milestone_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id uuid NOT NULL REFERENCES shipments(shipment_id) ON DELETE RESTRICT,
  event_type_code text NOT NULL DEFAULT 'MILESTONE' CHECK (event_type_code IN ('MILESTONE','CORRECTION')),
  from_milestone_code text,
  to_milestone_code text NOT NULL,
  business_occurred_at timestamptz(6) NOT NULL,
  recorded_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actor_user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  previous_snapshot_jsonb jsonb,
  new_snapshot_jsonb jsonb NOT NULL,
  reason text
);
CREATE INDEX shipment_milestone_events_shipment_recorded_idx
  ON shipment_milestone_events(shipment_id, recorded_at, shipment_milestone_event_id);

CREATE TABLE external_client_identities (
  external_client_identity_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issuer text NOT NULL,
  subject text NOT NULL,
  display_name text,
  email_normalized text,
  status_code text NOT NULL DEFAULT 'ACTIVE' CHECK (status_code IN ('ACTIVE','REVOKED')),
  provisioned_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  provisioned_by_user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  revoked_at timestamptz(6),
  row_version bigint NOT NULL DEFAULT 1,
  UNIQUE (issuer, subject)
);
CREATE INDEX external_client_identities_status_email_idx
  ON external_client_identities(status_code, email_normalized);

CREATE TABLE client_customer_bindings (
  client_customer_binding_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_client_identity_id uuid NOT NULL REFERENCES external_client_identities(external_client_identity_id) ON DELETE RESTRICT,
  account_id uuid NOT NULL REFERENCES accounts(account_id) ON DELETE RESTRICT,
  status_code text NOT NULL DEFAULT 'ACTIVE' CHECK (status_code IN ('ACTIVE','REVOKED')),
  valid_from timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  valid_to timestamptz(6),
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by_user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  revoked_at timestamptz(6),
  revoked_by_user_id uuid REFERENCES app_users(id) ON DELETE RESTRICT,
  row_version bigint NOT NULL DEFAULT 1,
  CONSTRAINT client_customer_binding_range_check CHECK (valid_to IS NULL OR valid_to > valid_from)
);
CREATE UNIQUE INDEX client_customer_bindings_one_active_idx
  ON client_customer_bindings(external_client_identity_id, account_id) WHERE status_code = 'ACTIVE';
CREATE INDEX client_customer_bindings_identity_effective_idx
  ON client_customer_bindings(external_client_identity_id, status_code, valid_from, valid_to);
CREATE INDEX client_customer_bindings_account_status_idx
  ON client_customer_bindings(account_id, status_code);

CREATE TABLE geography_classification_rules (
  geography_classification_rule_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_code text NOT NULL,
  country_code char(2) NOT NULL REFERENCES countries(code) ON DELETE RESTRICT,
  classification text NOT NULL CHECK (classification IN ('LOCAL','GLOBAL')),
  effective_from timestamptz(6) NOT NULL,
  effective_to timestamptz(6),
  source_code text NOT NULL DEFAULT 'CR-001',
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(version_code, country_code),
  CONSTRAINT geography_rule_range_check CHECK (effective_to IS NULL OR effective_to > effective_from)
);
CREATE INDEX geography_classification_rules_country_effective_idx
  ON geography_classification_rules(country_code, effective_from, effective_to);

INSERT INTO geography_classification_rules(version_code, country_code, classification, effective_from)
SELECT 'CR-001-2026-08-25', code,
       CASE WHEN btrim(code) IN ('EG','LY','SA','AE') THEN 'LOCAL' ELSE 'GLOBAL' END,
       TIMESTAMPTZ '2026-08-25 00:00:00+03'
FROM countries
ON CONFLICT (version_code, country_code) DO NOTHING;

INSERT INTO permissions(permission_id, code, description) VALUES
  (gen_random_uuid(), 'customer-segments.view', 'View governed customer segments'),
  (gen_random_uuid(), 'customer-segments.assign', 'Assign existing active customer segments'),
  (gen_random_uuid(), 'customer-segments.manage', 'Create and archive customer segment taxonomy'),
  (gen_random_uuid(), 'shipments.view', 'View shipment tracking projection'),
  (gen_random_uuid(), 'shipments.create', 'Create shipment tracking against an ERP order'),
  (gen_random_uuid(), 'shipments.edit', 'Record shipment milestones and corrections'),
  (gen_random_uuid(), 'research.view', 'View restricted R&D intelligence')
ON CONFLICT (code) DO NOTHING;

INSERT INTO roles(id, code, name, workspace, active, is_system_protected)
VALUES (gen_random_uuid(), 'R_AND_D', 'Research and Development', 'RND', true, true)
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions(role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE (r.code = 'SALES_MANAGER' AND p.code IN ('customer-segments.view','customer-segments.assign','customer-segments.manage','shipments.view'))
   OR (r.code IN ('SALES_USER','SALES_SUPPORT') AND p.code IN ('customer-segments.view','customer-segments.assign','shipments.view'))
   OR (r.code IN ('LOGISTICS','LOGISTICS_PLANNER') AND p.code IN ('shipments.view','shipments.create','shipments.edit'))
   OR (r.code = 'R_AND_D' AND p.code IN ('research.view','complaints.view'))
ON CONFLICT DO NOTHING;
