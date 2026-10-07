CREATE SEQUENCE IF NOT EXISTS product_ref_seq;

CREATE TABLE product_families (
  product_family_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_code text NOT NULL UNIQUE,
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  CONSTRAINT product_families_code_not_blank CHECK (length(btrim(family_code)) > 0),
  CONSTRAINT product_families_name_not_blank CHECK (length(btrim(name)) > 0)
);

CREATE TABLE products (
  product_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_ref text NOT NULL UNIQUE DEFAULT ('PRD-'::text || lpad(nextval('product_ref_seq'::regclass)::text, 8, '0')),
  sku_code text UNIQUE,
  barcode text UNIQUE,
  product_family_id uuid NOT NULL REFERENCES product_families(product_family_id) ON DELETE RESTRICT,
  product_type_code text NOT NULL,
  canonical_description text NOT NULL,
  normalized_description text NOT NULL,
  thickness_mm numeric(12,3),
  width_mm numeric(12,3),
  length_mm numeric(12,3),
  weight_kg numeric(14,4),
  density_kg_m3 numeric(14,4),
  source_system_id uuid,
  source_record_key text,
  record_status_code text NOT NULL DEFAULT 'ACTIVE',
  archived_at timestamptz(6),
  archived_by_user_id uuid REFERENCES app_users(id) ON DELETE RESTRICT,
  row_version bigint NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  created_by_user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_by_user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  CONSTRAINT products_identifier_present CHECK (NULLIF(btrim(COALESCE(sku_code,'')), '') IS NOT NULL OR NULLIF(btrim(COALESCE(barcode,'')), '') IS NOT NULL),
  CONSTRAINT products_description_not_blank CHECK (length(btrim(canonical_description)) > 0),
  CONSTRAINT products_type_not_blank CHECK (length(btrim(product_type_code)) > 0),
  CONSTRAINT products_type_check CHECK (product_type_code IN ('STANDARD_SKU','CUSTOM_CONFIG')),
  CONSTRAINT products_status_check CHECK (record_status_code IN ('ACTIVE','ARCHIVED')),
  CONSTRAINT products_archive_shape_check CHECK (
    (record_status_code = 'ACTIVE' AND archived_at IS NULL AND archived_by_user_id IS NULL)
    OR (record_status_code = 'ARCHIVED' AND archived_at IS NOT NULL AND archived_by_user_id IS NOT NULL)
  ),
  CONSTRAINT products_dimensions_nonnegative_check CHECK (
    (thickness_mm IS NULL OR thickness_mm >= 0)
    AND (length_mm IS NULL OR length_mm >= 0)
    AND (width_mm IS NULL OR width_mm >= 0)
    AND (weight_kg IS NULL OR weight_kg >= 0)
    AND (density_kg_m3 IS NULL OR density_kg_m3 >= 0)
  ),
  CONSTRAINT products_row_version_check CHECK (row_version > 0),
  CONSTRAINT products_source_key_requires_system_check CHECK (source_record_key IS NULL OR source_system_id IS NOT NULL)
);

CREATE INDEX products_status_normalized_description_id_idx ON products(record_status_code, normalized_description, product_id);
CREATE INDEX products_family_type_status_idx ON products(product_family_id, product_type_code, record_status_code);
CREATE INDEX products_source_lineage_idx ON products(source_system_id, source_record_key);
