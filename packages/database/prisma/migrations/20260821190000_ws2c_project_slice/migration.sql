CREATE SEQUENCE IF NOT EXISTS project_ref_seq;

CREATE TABLE projects (
  project_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_ref text NOT NULL UNIQUE DEFAULT ('PRJ-'::text || lpad(nextval('project_ref_seq'::regclass)::text, 8, '0')),
  name text NOT NULL,
  normalized_name text NOT NULL,
  country_code char(2) NOT NULL,
  city text,
  region text,
  address_text text,
  stage_code text,
  commercial_owner_user_id uuid NOT NULL,
  record_status_code text NOT NULL DEFAULT 'ACTIVE',
  archived_at timestamptz(6),
  archived_by_user_id uuid,
  row_version bigint NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  created_by_user_id uuid NOT NULL,
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_by_user_id uuid NOT NULL,
  CONSTRAINT projects_country_fkey FOREIGN KEY (country_code) REFERENCES countries(code) ON DELETE RESTRICT,
  CONSTRAINT projects_owner_fkey FOREIGN KEY (commercial_owner_user_id) REFERENCES app_users(id) ON DELETE RESTRICT,
  CONSTRAINT projects_created_by_fkey FOREIGN KEY (created_by_user_id) REFERENCES app_users(id) ON DELETE RESTRICT,
  CONSTRAINT projects_updated_by_fkey FOREIGN KEY (updated_by_user_id) REFERENCES app_users(id) ON DELETE RESTRICT,
  CONSTRAINT projects_archived_by_fkey FOREIGN KEY (archived_by_user_id) REFERENCES app_users(id) ON DELETE RESTRICT,
  CONSTRAINT projects_name_not_blank CHECK (length(btrim(name)) > 0),
  CONSTRAINT projects_normalized_name_not_blank CHECK (length(btrim(normalized_name)) > 0),
  CONSTRAINT projects_record_status_check CHECK (record_status_code IN ('ACTIVE', 'ARCHIVED')),
  CONSTRAINT projects_archive_shape_check CHECK (
    (record_status_code = 'ACTIVE' AND archived_at IS NULL AND archived_by_user_id IS NULL)
    OR
    (record_status_code = 'ARCHIVED' AND archived_at IS NOT NULL AND archived_by_user_id IS NOT NULL)
  ),
  CONSTRAINT projects_row_version_positive CHECK (row_version > 0)
);

CREATE INDEX projects_country_status_updated_id_idx
  ON projects(country_code, record_status_code, updated_at DESC, project_id);
CREATE INDEX projects_owner_status_idx
  ON projects(commercial_owner_user_id, record_status_code);
CREATE INDEX projects_normalized_name_idx ON projects(normalized_name);

CREATE TABLE project_parties (
  project_party_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  account_id uuid NOT NULL,
  role_code text NOT NULL,
  primary_flag boolean NOT NULL DEFAULT false,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT project_parties_project_fkey FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE RESTRICT,
  CONSTRAINT project_parties_account_fkey FOREIGN KEY (account_id) REFERENCES accounts(account_id) ON DELETE RESTRICT,
  CONSTRAINT project_parties_role_not_blank CHECK (length(btrim(role_code)) > 0),
  CONSTRAINT project_parties_project_account_role_key UNIQUE (project_id, account_id, role_code)
);

CREATE UNIQUE INDEX project_parties_one_primary_idx
  ON project_parties(project_id) WHERE primary_flag;
CREATE INDEX project_parties_account_project_idx
  ON project_parties(account_id, project_id);

CREATE TABLE project_work_references (
  project_work_reference_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  work_type_code text NOT NULL,
  work_id uuid NOT NULL,
  status_code text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT project_work_references_project_fkey FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE RESTRICT,
  CONSTRAINT project_work_references_type_not_blank CHECK (length(btrim(work_type_code)) > 0),
  CONSTRAINT project_work_references_status_check CHECK (status_code IN ('ACTIVE', 'RELEASED')),
  CONSTRAINT project_work_references_type_work_key UNIQUE (work_type_code, work_id)
);

CREATE INDEX project_work_references_project_status_idx
  ON project_work_references(project_id, status_code);
