ALTER TABLE logistics_plans ALTER COLUMN source_id DROP NOT NULL;
ALTER TABLE logistics_plans ADD COLUMN plan_ref text;
UPDATE logistics_plans SET plan_ref = 'LP-' || upper(substr(replace(logistics_plan_id::text,'-',''),1,12)) WHERE plan_ref IS NULL;
ALTER TABLE logistics_plans ALTER COLUMN plan_ref SET NOT NULL;
ALTER TABLE logistics_plans ADD CONSTRAINT logistics_plans_plan_ref_key UNIQUE(plan_ref);
ALTER TABLE logistics_plans ADD COLUMN selected_version_id uuid;

ALTER TABLE logistics_plan_versions
  ADD COLUMN status_code text NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN source_snapshot_hash text,
  ADD COLUMN input_snapshot_jsonb jsonb,
  ADD COLUMN constraints_snapshot_jsonb jsonb,
  ADD COLUMN completeness_mode_code text NOT NULL DEFAULT 'COMPLETE',
  ADD COLUMN derived_results_status_code text NOT NULL DEFAULT 'NONE',
  ADD COLUMN derived_results_invalidated_at timestamptz(6),
  ADD COLUMN row_version bigint NOT NULL DEFAULT 1,
  ADD COLUMN created_by_user_id uuid;
UPDATE logistics_plan_versions v SET created_by_user_id=p.created_by_user_id FROM logistics_plans p WHERE p.logistics_plan_id=v.logistics_plan_id;
ALTER TABLE logistics_plan_versions ALTER COLUMN created_by_user_id SET NOT NULL;
ALTER TABLE logistics_plan_versions ADD CONSTRAINT logistics_plan_versions_status_check CHECK(status_code IN ('DRAFT','OPTIMIZING','VALIDATED','SELECTED','ARCHIVED'));
ALTER TABLE logistics_plan_versions ADD CONSTRAINT logistics_plan_versions_completeness_check CHECK(completeness_mode_code IN ('COMPLETE','PARTIAL'));

CREATE TABLE logistics_plan_lines (
  plan_line_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), plan_version_id uuid NOT NULL REFERENCES logistics_plan_versions(logistics_plan_version_id) ON DELETE CASCADE,
  product_id uuid, qty numeric(18,4) NOT NULL CHECK(qty>0), length_mm numeric(18,4) NOT NULL CHECK(length_mm>0), width_mm numeric(18,4) NOT NULL CHECK(width_mm>0),
  thickness_mm numeric(18,4) NOT NULL CHECK(thickness_mm>0), weight_kg numeric(18,4) CHECK(weight_kg IS NULL OR weight_kg>=0), orientation_code text NOT NULL DEFAULT 'FLAT_ON_FACE' CHECK(orientation_code='FLAT_ON_FACE')
);
CREATE INDEX logistics_plan_lines_version_idx ON logistics_plan_lines(plan_version_id);
CREATE TABLE logistics_plan_transport_units (
  plan_transport_unit_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), plan_version_id uuid NOT NULL REFERENCES logistics_plan_versions(logistics_plan_version_id) ON DELETE CASCADE,
  template_id uuid, instance_no integer NOT NULL CHECK(instance_no>0), name_snapshot text,
  length_mm_snapshot numeric(18,4) NOT NULL CHECK(length_mm_snapshot>0), width_mm_snapshot numeric(18,4) NOT NULL CHECK(width_mm_snapshot>0),
  height_mm_snapshot numeric(18,4) NOT NULL CHECK(height_mm_snapshot>0), max_weight_kg_snapshot numeric(18,4) NOT NULL CHECK(max_weight_kg_snapshot>0), created_at timestamptz(6) NOT NULL DEFAULT now(), UNIQUE(plan_version_id,instance_no)
);
CREATE TABLE logistics_optimizer_runs (
  optimizer_run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), plan_version_id uuid NOT NULL REFERENCES logistics_plan_versions(logistics_plan_version_id) ON DELETE RESTRICT,
  algorithm_code text NOT NULL DEFAULT 'ABP_FLAT_SHELF', algorithm_version text NOT NULL DEFAULT '1.0.0', objective_code text NOT NULL, input_hash text NOT NULL,
  plan_row_version_snapshot bigint NOT NULL, constraints_hash text, input_summary_jsonb jsonb, result_summary_jsonb jsonb, status_code text NOT NULL DEFAULT 'QUEUED', job_id uuid,
  started_at timestamptz(6), finished_at timestamptz(6), error_code text, invalidated_at timestamptz(6), applied_at timestamptz(6), created_by_user_id uuid NOT NULL, created_at timestamptz(6) NOT NULL DEFAULT now(),
  CHECK(status_code IN ('QUEUED','RUNNING','SUCCEEDED','FAILED','CANCELLED'))
);
CREATE INDEX logistics_optimizer_runs_version_idx ON logistics_optimizer_runs(plan_version_id,created_at DESC);
CREATE TABLE logistics_validation_results (
  validation_result_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), plan_version_id uuid NOT NULL REFERENCES logistics_plan_versions(logistics_plan_version_id) ON DELETE CASCADE,
  rule_code text NOT NULL, severity_code text NOT NULL, message text NOT NULL, context_jsonb jsonb, created_at timestamptz(6) NOT NULL DEFAULT now(), CHECK(severity_code IN ('INFO','WARNING','ERROR','BLOCKER'))
);
CREATE INDEX logistics_validation_results_version_idx ON logistics_validation_results(plan_version_id,created_at DESC);
CREATE TABLE logistics_exports (
  export_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), plan_version_id uuid NOT NULL REFERENCES logistics_plan_versions(logistics_plan_version_id) ON DELETE RESTRICT,
  user_id uuid NOT NULL, format_code text NOT NULL CHECK(format_code IN ('PDF','XLSX','PNG')), include_validation boolean NOT NULL DEFAULT false,
  status_code text NOT NULL DEFAULT 'PENDING', job_id uuid, created_at timestamptz(6) NOT NULL DEFAULT now(), completed_at timestamptz(6), failure_code text
);

ALTER TABLE logistics_placements ADD COLUMN plan_transport_unit_id uuid REFERENCES logistics_plan_transport_units(plan_transport_unit_id) ON DELETE CASCADE;
ALTER TABLE logistics_placements ADD COLUMN plan_line_id uuid REFERENCES logistics_plan_lines(plan_line_id) ON DELETE CASCADE;
ALTER TABLE logistics_placements ADD COLUMN stack_qty numeric(18,4) NOT NULL DEFAULT 1 CHECK(stack_qty>0);
ALTER TABLE logistics_placements ADD CONSTRAINT logistics_placements_rotation_check CHECK(rotation_deg IN (0,90));
