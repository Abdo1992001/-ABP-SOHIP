CREATE SEQUENCE IF NOT EXISTS opportunity_ref_seq;

CREATE TABLE opportunity_stage_policies (
  opportunity_stage_policy_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_code text NOT NULL,
  default_probability_pct numeric(5,2) NOT NULL,
  effective_from timestamptz(6) NOT NULL,
  effective_to timestamptz(6),
  status_code text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT opportunity_stage_policies_probability_check CHECK (default_probability_pct >= 0 AND default_probability_pct <= 100),
  CONSTRAINT opportunity_stage_policies_status_check CHECK (status_code IN ('ACTIVE','INACTIVE')),
  CONSTRAINT opportunity_stage_policies_dates_check CHECK (effective_to IS NULL OR effective_to > effective_from)
);
CREATE INDEX opportunity_stage_policies_effective_idx ON opportunity_stage_policies(stage_code, status_code, effective_from, effective_to);

CREATE TABLE opportunity_lost_reasons (
  opportunity_lost_reason_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lost_reason_code text NOT NULL UNIQUE,
  display_name text NOT NULL,
  effective_from timestamptz(6) NOT NULL,
  effective_to timestamptz(6),
  status_code text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT opportunity_lost_reasons_name_check CHECK (length(btrim(display_name)) > 0),
  CONSTRAINT opportunity_lost_reasons_status_check CHECK (status_code IN ('ACTIVE','INACTIVE')),
  CONSTRAINT opportunity_lost_reasons_dates_check CHECK (effective_to IS NULL OR effective_to > effective_from)
);
CREATE INDEX opportunity_lost_reasons_effective_idx ON opportunity_lost_reasons(status_code, effective_from, effective_to);

CREATE TABLE opportunities (
  opportunity_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_ref text NOT NULL UNIQUE DEFAULT ('OPP-'::text || lpad(nextval('opportunity_ref_seq'::regclass)::text, 8, '0')),
  account_id uuid NOT NULL REFERENCES accounts(account_id) ON DELETE RESTRICT,
  project_id uuid REFERENCES projects(project_id) ON DELETE RESTRICT,
  country_code char(2) NOT NULL REFERENCES countries(code) ON DELETE RESTRICT,
  owner_user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  stage_code text NOT NULL,
  probability_pct numeric(5,2),
  probability_source_code text NOT NULL DEFAULT 'STAGE_DEFAULT',
  estimated_value numeric(18,2),
  currency_code char(3),
  expected_close_date date,
  no_project_reason_code text,
  lost_reason_code text,
  won_at timestamptz(6),
  won_value_snapshot numeric(18,2),
  row_version bigint NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  created_by_user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_by_user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  CONSTRAINT opportunities_probability_check CHECK (probability_pct IS NULL OR (probability_pct >= 0 AND probability_pct <= 100)),
  CONSTRAINT opportunities_probability_source_check CHECK (probability_source_code IN ('STAGE_DEFAULT','MANUAL_OVERRIDE')),
  CONSTRAINT opportunities_project_reason_check CHECK ((project_id IS NOT NULL AND no_project_reason_code IS NULL) OR (project_id IS NULL AND length(btrim(COALESCE(no_project_reason_code,''))) > 0)),
  CONSTRAINT opportunities_won_shape_check CHECK ((stage_code = 'WON' AND won_at IS NOT NULL AND won_value_snapshot IS NOT NULL AND estimated_value IS NOT NULL AND currency_code IS NOT NULL) OR stage_code <> 'WON'),
  CONSTRAINT opportunities_row_version_check CHECK (row_version > 0)
);
CREATE INDEX opportunities_country_stage_updated_idx ON opportunities(country_code, stage_code, updated_at DESC, opportunity_id);
CREATE INDEX opportunities_account_stage_idx ON opportunities(account_id, stage_code);
CREATE INDEX opportunities_project_idx ON opportunities(project_id);

CREATE TABLE opportunity_stage_transitions (
  opportunity_stage_transition_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id uuid NOT NULL REFERENCES opportunities(opportunity_id) ON DELETE RESTRICT,
  from_stage_code text,
  to_stage_code text NOT NULL,
  lost_reason_code text,
  event_code text NOT NULL DEFAULT 'STAGE_CHANGED',
  occurred_at timestamptz(6) NOT NULL DEFAULT now(),
  actor_user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  CONSTRAINT opportunity_stage_transitions_event_check CHECK (event_code IN ('STAGE_CHANGED','WON_REVERSED'))
);
CREATE INDEX opportunity_stage_transitions_history_idx ON opportunity_stage_transitions(opportunity_id, occurred_at, opportunity_stage_transition_id);

CREATE TABLE opportunity_probability_overrides (
  opportunity_probability_override_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id uuid NOT NULL REFERENCES opportunities(opportunity_id) ON DELETE RESTRICT,
  probability_pct numeric(5,2) NOT NULL,
  reason text NOT NULL,
  source_metadata jsonb NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  created_by_user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  CONSTRAINT opportunity_probability_overrides_probability_check CHECK (probability_pct >= 0 AND probability_pct <= 100),
  CONSTRAINT opportunity_probability_overrides_reason_check CHECK (length(btrim(reason)) > 0)
);
CREATE INDEX opportunity_probability_overrides_history_idx ON opportunity_probability_overrides(opportunity_id, created_at, opportunity_probability_override_id);

CREATE TABLE opportunity_won_snapshots (
  opportunity_won_snapshot_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id uuid NOT NULL REFERENCES opportunities(opportunity_id) ON DELETE RESTRICT,
  stage_transition_id uuid NOT NULL UNIQUE REFERENCES opportunity_stage_transitions(opportunity_stage_transition_id) ON DELETE RESTRICT,
  won_at timestamptz(6) NOT NULL,
  value numeric(18,2) NOT NULL,
  currency_code char(3) NOT NULL
);
CREATE INDEX opportunity_won_snapshots_history_idx ON opportunity_won_snapshots(opportunity_id, won_at, opportunity_won_snapshot_id);
