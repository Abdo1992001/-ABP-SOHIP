ALTER TABLE capacity_rates
  ADD COLUMN source_code text NOT NULL DEFAULT 'MASTER_SSOT',
  ADD COLUMN changed_by_user_id uuid,
  ADD COLUMN created_at timestamptz(6) NOT NULL DEFAULT now();
UPDATE capacity_rates SET changed_by_user_id='00000000-0000-4000-8000-000000000000'::uuid WHERE changed_by_user_id IS NULL;
ALTER TABLE capacity_rates ALTER COLUMN changed_by_user_id SET NOT NULL;

INSERT INTO capacity_rates(category_code,boards_per_day,hours_per_day,effective_from,source_code,changed_by_user_id)
SELECT v.category_code,v.boards_per_day,24,'2000-01-01T00:00:00Z','MASTER_SPECIFICATION_V3','00000000-0000-4000-8000-000000000000'::uuid
FROM (VALUES ('STANDARD',900),('ORDINARY',700),('CURVED',600)) v(category_code,boards_per_day)
WHERE NOT EXISTS (SELECT 1 FROM capacity_rates r WHERE r.category_code=v.category_code);

CREATE OR REPLACE FUNCTION reject_capacity_rate_overlap() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM capacity_rates r
    WHERE r.capacity_rate_id <> NEW.capacity_rate_id AND r.category_code=NEW.category_code
      AND r.status_code='ACTIVE' AND NEW.status_code='ACTIVE'
      AND tstzrange(r.effective_from,r.effective_to,'[)') && tstzrange(NEW.effective_from,NEW.effective_to,'[)')
  ) THEN RAISE EXCEPTION 'CAPACITY_RATE_EFFECTIVE_RANGE_OVERLAP' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER capacity_rates_no_overlap BEFORE INSERT OR UPDATE ON capacity_rates FOR EACH ROW EXECUTE FUNCTION reject_capacity_rate_overlap();

CREATE TABLE capacity_estimate_runs (
  capacity_estimate_run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type_code text NOT NULL,
  source_resource_id uuid,
  country_code char(2),
  start_at timestamptz(6),
  estimated_finish_at timestamptz(6),
  created_by_user_id uuid NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT capacity_estimate_runs_source_check CHECK (
    (source_type_code='MANUAL' AND source_resource_id IS NULL) OR
    (source_type_code IN ('QUOTATION','SALES_ORDER') AND source_resource_id IS NOT NULL)
  )
);
CREATE INDEX capacity_estimate_runs_scope_idx ON capacity_estimate_runs(country_code,created_at DESC,capacity_estimate_run_id);
CREATE INDEX capacity_estimate_runs_source_idx ON capacity_estimate_runs(source_type_code,source_resource_id);

ALTER TABLE capacity_estimates
  ALTER COLUMN source_id DROP NOT NULL,
  ADD COLUMN estimate_run_id uuid,
  ADD COLUMN rate_boards_per_day_snapshot numeric(18,4),
  ADD COLUMN duration_hours numeric(18,4),
  ADD COLUMN estimated_finish_at timestamptz(6);
INSERT INTO capacity_estimate_runs(capacity_estimate_run_id,source_type_code,source_resource_id,start_at,estimated_finish_at,created_by_user_id,created_at)
SELECT e.capacity_estimate_id,e.source_type_code,e.source_id,e.calculated_at,
       e.calculated_at + make_interval(secs => (e.estimated_days*24*3600)::double precision),
       '00000000-0000-4000-8000-000000000000'::uuid,e.calculated_at
FROM capacity_estimates e;
UPDATE capacity_estimates e SET
  estimate_run_id=e.capacity_estimate_id,
  rate_boards_per_day_snapshot=r.boards_per_day,
  duration_hours=e.estimated_days*24,
  estimated_finish_at=e.calculated_at + make_interval(secs => (e.estimated_days*24*3600)::double precision)
FROM capacity_rates r WHERE r.capacity_rate_id=e.capacity_rate_id;
ALTER TABLE capacity_estimates
  ALTER COLUMN estimate_run_id SET NOT NULL,
  ALTER COLUMN rate_boards_per_day_snapshot SET NOT NULL,
  ALTER COLUMN duration_hours SET NOT NULL,
  ADD CONSTRAINT capacity_estimates_run_fkey FOREIGN KEY(estimate_run_id) REFERENCES capacity_estimate_runs(capacity_estimate_run_id) ON DELETE RESTRICT,
  ADD CONSTRAINT capacity_estimates_duration_check CHECK(duration_hours>=0),
  ADD CONSTRAINT capacity_estimates_rate_snapshot_check CHECK(rate_boards_per_day_snapshot IN (900,700,600));
CREATE INDEX capacity_estimates_run_idx ON capacity_estimates(estimate_run_id);
