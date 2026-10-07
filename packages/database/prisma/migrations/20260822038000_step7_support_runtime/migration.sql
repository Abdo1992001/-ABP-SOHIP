CREATE SEQUENCE IF NOT EXISTS complaint_ref_seq;

ALTER TABLE roles ADD COLUMN is_system_protected boolean NOT NULL DEFAULT false;
ALTER TABLE roles ADD COLUMN row_version bigint NOT NULL DEFAULT 1;
ALTER TABLE permissions ADD COLUMN permission_id uuid NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX permissions_permission_id_key ON permissions(permission_id);
ALTER TABLE project_parties ADD COLUMN status_code text NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE project_parties ADD COLUMN row_version bigint NOT NULL DEFAULT 1;

CREATE TABLE project_contact_roles (
  project_contact_role_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_party_id uuid NOT NULL REFERENCES project_parties(project_party_id) ON DELETE RESTRICT,
  contact_id uuid NOT NULL REFERENCES contacts(contact_id) ON DELETE RESTRICT,
  role_code text NOT NULL,
  status_code text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_contact_roles_party_contact_role_key UNIQUE(project_party_id, contact_id, role_code)
);
CREATE INDEX project_contact_roles_contact_id_project_party_id_idx ON project_contact_roles(contact_id, project_party_id);

CREATE TABLE upload_sessions (
  upload_session_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), requested_by_user_id uuid NOT NULL,
  document_type_code text NOT NULL, file_name text NOT NULL, expected_mime_type text NOT NULL,
  expected_size_bytes bigint NOT NULL, storage_key text NOT NULL UNIQUE, target_resource_type text,
  target_resource_id uuid, status_code text NOT NULL DEFAULT 'PENDING_UPLOAD', actual_sha256 text,
  malware_scan_status_code text, document_id uuid, expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
);
CREATE INDEX upload_sessions_requested_by_user_id_status_code_created_at_idx ON upload_sessions(requested_by_user_id, status_code, created_at);

CREATE TABLE document_links (
  document_link_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), document_id uuid NOT NULL,
  resource_type_code text NOT NULL, resource_id uuid NOT NULL, relationship_type_code text NOT NULL,
  created_by_user_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_links_unique UNIQUE(document_id, resource_type_code, resource_id, relationship_type_code)
);
CREATE INDEX document_links_resource_type_code_resource_id_idx ON document_links(resource_type_code, resource_id);

CREATE TABLE export_events (
  export_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
  export_type_code text NOT NULL, format_code text NOT NULL, resource_type_code text,
  filter_summary_jsonb jsonb, country_codes text[] NOT NULL, status_code text NOT NULL DEFAULT 'QUEUED',
  job_id uuid NOT NULL, document_id uuid, row_count bigint, failure_code text,
  created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
);
CREATE INDEX export_events_user_id_created_at_idx ON export_events(user_id, created_at);

CREATE TABLE user_preferences (
  user_id uuid PRIMARY KEY, preferences_jsonb jsonb NOT NULL DEFAULT '{}'::jsonb,
  schema_version integer NOT NULL DEFAULT 1, row_version bigint NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_notifications (
  notification_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), recipient_user_id uuid NOT NULL,
  type_code text NOT NULL, title_safe text NOT NULL, body_safe text, resource_type_code text,
  resource_id uuid, action_code text, read_at timestamptz, expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX user_notifications_recipient_user_id_read_at_created_at_idx ON user_notifications(recipient_user_id, read_at, created_at DESC);

CREATE TABLE ai_rule_outputs (
  ai_rule_output_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), recipient_user_id uuid NOT NULL,
  rule_code text NOT NULL, rule_version text NOT NULL, resource_type_code text NOT NULL,
  resource_id uuid NOT NULL, country_code char(2), output_type_code text NOT NULL,
  score_numeric numeric(18,6), output_jsonb jsonb NOT NULL, explanation_jsonb jsonb,
  generated_at timestamptz NOT NULL DEFAULT now(), valid_until timestamptz,
  status_code text NOT NULL DEFAULT 'ACTIVE'
);
CREATE INDEX ai_rule_outputs_recipient_user_id_status_code_generated_at_idx ON ai_rule_outputs(recipient_user_id, status_code, generated_at DESC);

CREATE TABLE complaints (
  complaint_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  complaint_ref text NOT NULL UNIQUE DEFAULT ('CMP-'::text || lpad(nextval('complaint_ref_seq')::text, 8, '0')),
  account_id uuid NOT NULL REFERENCES accounts(account_id) ON DELETE RESTRICT,
  project_id uuid, sales_order_id uuid, contact_id uuid, country_code char(2) NOT NULL,
  complaint_type_code text NOT NULL, severity_code text, status_code text NOT NULL DEFAULT 'OPEN',
  owner_user_id uuid NOT NULL, description text NOT NULL, resolution text,
  row_version bigint NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX complaints_country_code_status_code_updated_at_idx ON complaints(country_code, status_code, updated_at DESC);
CREATE INDEX complaints_account_id_created_at_idx ON complaints(account_id, created_at);

CREATE TABLE security_events (
  security_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_type_code text NOT NULL,
  actor_user_id uuid, subject_user_id uuid, resource_type_code text, resource_id uuid,
  metadata_jsonb jsonb, trace_id text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX security_events_created_at_idx ON security_events(created_at DESC);

ALTER TABLE document_metadata ADD COLUMN IF NOT EXISTS document_type_code text NOT NULL DEFAULT 'GENERAL';
ALTER TABLE document_metadata ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE document_metadata ADD COLUMN IF NOT EXISTS status_code text NOT NULL DEFAULT 'AVAILABLE';
