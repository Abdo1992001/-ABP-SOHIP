ALTER TABLE import_batches
  ADD COLUMN source_system_id uuid,
  ADD COLUMN import_type_code text,
  ADD COLUMN file_name text,
  ADD COLUMN safe_storage_key text,
  ADD COLUMN expected_size_bytes bigint,
  ADD COLUMN mime_type text,
  ADD COLUMN file_sha256 text,
  ADD COLUMN previewed_at timestamptz(6),
  ADD COLUMN committed_at timestamptz(6),
  ADD COLUMN rolled_back_at timestamptz(6),
  ADD COLUMN current_preview_attempt_id uuid,
  ADD COLUMN current_preview_fingerprint text,
  ADD COLUMN row_version bigint NOT NULL DEFAULT 1;

UPDATE import_batches SET
  source_system_id = (substr(md5('source-system:' || source_system_code),1,8)||'-'||substr(md5('source-system:' || source_system_code),9,4)||'-4'||substr(md5('source-system:' || source_system_code),14,3)||'-8'||substr(md5('source-system:' || source_system_code),18,3)||'-'||substr(md5('source-system:' || source_system_code),21,12))::uuid,
  import_type_code = 'LEGACY'
WHERE source_system_id IS NULL;
ALTER TABLE import_batches ALTER COLUMN source_system_id SET NOT NULL, ALTER COLUMN import_type_code SET NOT NULL;
ALTER TABLE import_batches ADD CONSTRAINT import_batches_size_check CHECK (expected_size_bytes IS NULL OR expected_size_bytes BETWEEN 1 AND 104857600), ADD CONSTRAINT import_batches_row_version_check CHECK (row_version > 0);

ALTER TABLE import_rows
  ADD COLUMN row_no bigint,
  ADD COLUMN natural_key text,
  ADD COLUMN normalized_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN issue_count integer NOT NULL DEFAULT 0;
WITH numbered AS (SELECT import_row_id, row_number() OVER (PARTITION BY import_batch_id ORDER BY import_row_id) AS rn FROM import_rows)
UPDATE import_rows r SET row_no=n.rn FROM numbered n WHERE r.import_row_id=n.import_row_id;
ALTER TABLE import_rows ALTER COLUMN row_no SET NOT NULL;
ALTER TABLE import_rows ADD CONSTRAINT import_rows_row_no_check CHECK (row_no > 0), ADD CONSTRAINT import_rows_issue_count_check CHECK (issue_count >= 0);

ALTER TABLE dq_issues
  ADD COLUMN import_row_id uuid,
  ADD COLUMN message text NOT NULL DEFAULT '',
  ADD COLUMN resolution_code text,
  ADD COLUMN mapping_target_id uuid,
  ADD COLUMN resource_type_code text,
  ADD COLUMN resource_id uuid,
  ADD COLUMN row_version bigint NOT NULL DEFAULT 1;
ALTER TABLE dq_issues ADD CONSTRAINT dq_issues_row_version_check CHECK (row_version > 0);
CREATE INDEX dq_issues_import_status_idx ON dq_issues(import_batch_id,status_code,dq_issue_id);

ALTER TABLE reconciliation_runs
  ALTER COLUMN import_batch_id DROP NOT NULL,
  ALTER COLUMN started_at DROP NOT NULL;
ALTER TABLE reconciliation_runs RENAME COLUMN completed_at TO finished_at;
ALTER TABLE reconciliation_runs RENAME COLUMN summary TO summary_jsonb;
ALTER TABLE reconciliation_runs
  ADD COLUMN reconciliation_type_code text,
  ADD COLUMN source_system_id uuid,
  ADD COLUMN filter_jsonb jsonb,
  ADD COLUMN created_by_user_id uuid,
  ADD COLUMN job_id uuid,
  ADD COLUMN created_at timestamptz(6) NOT NULL DEFAULT now();
UPDATE reconciliation_runs SET reconciliation_type_code='LEGACY', created_by_user_id=(SELECT id FROM app_users ORDER BY id LIMIT 1) WHERE reconciliation_type_code IS NULL;
ALTER TABLE reconciliation_runs ALTER COLUMN reconciliation_type_code SET NOT NULL, ALTER COLUMN created_by_user_id SET NOT NULL;

CREATE TABLE reconciliation_issues (
  reconciliation_issue_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_id uuid NOT NULL,
  issue_code text NOT NULL, severity_code text NOT NULL, source_key text, resource_type_code text,
  resource_id uuid, details_jsonb jsonb NOT NULL, status_code text NOT NULL DEFAULT 'OPEN',
  resolution_code text, resolution_reason text, resolved_by_user_id uuid, resolved_at timestamptz(6),
  row_version bigint NOT NULL DEFAULT 1 CHECK (row_version > 0)
);
CREATE INDEX reconciliation_issues_run_status_idx ON reconciliation_issues(run_id,status_code,reconciliation_issue_id);

CREATE TABLE source_items (
  source_item_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_system_id uuid NOT NULL,
  source_item_key text NOT NULL, sku text, barcode text, description text, raw_payload jsonb NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT now(), UNIQUE(source_system_id,source_item_key)
);
CREATE TABLE item_mappings (
  item_mapping_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_item_id uuid NOT NULL,
  product_id uuid NOT NULL, mapping_method_code text NOT NULL, confidence_pct numeric(5,2),
  mapped_by_user_id uuid, mapped_at timestamptz(6) NOT NULL DEFAULT now(), rationale text,
  status_code text NOT NULL DEFAULT 'ACTIVE',
  CONSTRAINT item_mappings_confidence_check CHECK (confidence_pct IS NULL OR confidence_pct BETWEEN 0 AND 100)
);
CREATE INDEX item_mappings_source_status_idx ON item_mappings(source_item_id,status_code,mapped_at DESC);
