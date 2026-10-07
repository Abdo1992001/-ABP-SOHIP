-- ERP sales-history ETL: the columns the Excel → canonical pipeline needs.
--
-- The pipeline is Excel -> ingestion -> staging (import_rows) -> cleaning ->
-- normalization -> matching -> entity resolution -> dedup -> validation
-- (dq_issues) -> canonical (accounts / products / erp_orders / erp_order_lines).
-- Staging and issue tables already existed; what was missing was (a) the
-- commercial facts on the order line, (b) the classification that says whether
-- an ordered item is even a product, and (c) the relationship type that keeps
-- group companies out of "external sales".

-- ---------------------------------------------------------------- accounts --
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS relationship_type_code text NOT NULL DEFAULT 'EXTERNAL_CUSTOMER',
  ADD COLUMN IF NOT EXISTS group_parent_name      text,
  ADD COLUMN IF NOT EXISTS source_import_batch_id uuid,
  ADD COLUMN IF NOT EXISTS source_row_no          bigint;

CREATE UNIQUE INDEX IF NOT EXISTS accounts_customer_number_key
  ON accounts (customer_number) WHERE customer_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS accounts_relationship_type_idx
  ON accounts (relationship_type_code, record_status_code);

-- ---------------------------------------------------------------- products --
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS item_classification_code text NOT NULL DEFAULT 'SELLABLE_PRODUCT',
  ADD COLUMN IF NOT EXISTS product_status_code      text NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS item_class_raw           text,
  ADD COLUMN IF NOT EXISTS sub_category             text,
  ADD COLUMN IF NOT EXISTS minor_category           text,
  ADD COLUMN IF NOT EXISTS item_prefix              text,
  ADD COLUMN IF NOT EXISTS on_hand_qty              numeric(18, 4),
  ADD COLUMN IF NOT EXISTS source_import_batch_id   uuid,
  ADD COLUMN IF NOT EXISTS source_row_no            bigint;

CREATE INDEX IF NOT EXISTS products_classification_status_idx
  ON products (item_classification_code, product_status_code, record_status_code);

-- -------------------------------------------------------------- erp_orders --
ALTER TABLE erp_orders
  ADD COLUMN IF NOT EXISTS order_number_raw       text,
  ADD COLUMN IF NOT EXISTS customer_number_raw    text,
  ADD COLUMN IF NOT EXISTS customer_name_raw      text,
  ADD COLUMN IF NOT EXISTS ship_to_raw            text,
  ADD COLUMN IF NOT EXISTS sales_rep              text,
  ADD COLUMN IF NOT EXISTS sales_channel          text,
  ADD COLUMN IF NOT EXISTS customer_po_number     text,
  ADD COLUMN IF NOT EXISTS order_type_raw         text,
  ADD COLUMN IF NOT EXISTS order_system           text,
  ADD COLUMN IF NOT EXISTS period_raw             text,
  ADD COLUMN IF NOT EXISTS line_count             integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_amount_egp       numeric(18, 4),
  ADD COLUMN IF NOT EXISTS is_intercompany        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS source_row_no          bigint;

CREATE INDEX IF NOT EXISTS erp_orders_account_date_idx
  ON erp_orders (account_id, order_date DESC);

CREATE INDEX IF NOT EXISTS erp_orders_intercompany_date_idx
  ON erp_orders (is_intercompany, order_date DESC);

-- --------------------------------------------------------- erp_order_lines --
ALTER TABLE erp_order_lines
  ADD COLUMN IF NOT EXISTS line_no                  integer,
  ADD COLUMN IF NOT EXISTS ordered_item_raw         text,
  ADD COLUMN IF NOT EXISTS item_description_raw     text,
  ADD COLUMN IF NOT EXISTS uom_code                 text,
  ADD COLUMN IF NOT EXISTS unit_selling_price       numeric(18, 4),
  ADD COLUMN IF NOT EXISTS unit_list_price          numeric(18, 4),
  ADD COLUMN IF NOT EXISTS line_amount              numeric(18, 4),
  ADD COLUMN IF NOT EXISTS line_amount_egp          numeric(18, 4),
  ADD COLUMN IF NOT EXISTS currency_code            char(3),
  ADD COLUMN IF NOT EXISTS fx_rate                  numeric(18, 6),
  ADD COLUMN IF NOT EXISTS line_status_raw          text,
  ADD COLUMN IF NOT EXISTS item_class_raw           text,
  ADD COLUMN IF NOT EXISTS item_classification_code text NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN IF NOT EXISTS match_status_code        text NOT NULL DEFAULT 'UNMATCHED',
  ADD COLUMN IF NOT EXISTS booked_date              date,
  ADD COLUMN IF NOT EXISTS request_date             date,
  ADD COLUMN IF NOT EXISTS schedule_ship_date       date,
  ADD COLUMN IF NOT EXISTS actual_shipment_date     date,
  ADD COLUMN IF NOT EXISTS unit_weight_kg           numeric(18, 4),
  ADD COLUMN IF NOT EXISTS calculated_weight_kg     numeric(18, 4),
  ADD COLUMN IF NOT EXISTS density_kg_m3            numeric(18, 4),
  ADD COLUMN IF NOT EXISTS source_import_batch_id   uuid,
  ADD COLUMN IF NOT EXISTS source_row_no            bigint;

CREATE INDEX IF NOT EXISTS erp_order_lines_order_idx  ON erp_order_lines (erp_order_id);
CREATE INDEX IF NOT EXISTS erp_order_lines_product_idx ON erp_order_lines (product_id);
CREATE INDEX IF NOT EXISTS erp_order_lines_match_idx   ON erp_order_lines (match_status_code, item_classification_code);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'erp_order_lines_erp_order_id_fkey'
  ) THEN
    ALTER TABLE erp_order_lines
      ADD CONSTRAINT erp_order_lines_erp_order_id_fkey
      FOREIGN KEY (erp_order_id) REFERENCES erp_orders (erp_order_id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'erp_order_lines_product_id_fkey'
  ) THEN
    ALTER TABLE erp_order_lines
      ADD CONSTRAINT erp_order_lines_product_id_fkey
      FOREIGN KEY (product_id) REFERENCES products (product_id) ON DELETE SET NULL;
  END IF;
END $$;

-- ---------------------------------------------------------- import_batches --
-- job_ref is the human-facing "IMP-001" on the staging report; summary holds the
-- counters (rows read, customers detected, countries detected, unmatched items,
-- warnings) so the report is reproducible long after the run.
CREATE SEQUENCE IF NOT EXISTS import_batch_ref_seq;

ALTER TABLE import_batches
  ADD COLUMN IF NOT EXISTS job_ref text,
  ADD COLUMN IF NOT EXISTS label   text,
  ADD COLUMN IF NOT EXISTS summary jsonb;

ALTER TABLE import_batches
  ALTER COLUMN job_ref SET DEFAULT ('IMP-' || lpad(nextval('import_batch_ref_seq')::text, 3, '0'));

UPDATE import_batches
   SET job_ref = 'IMP-' || lpad(nextval('import_batch_ref_seq')::text, 3, '0')
 WHERE job_ref IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS import_batches_job_ref_key ON import_batches (job_ref);

-- ------------------------------------------------------------- countries --
-- A row whose country cannot be normalized is parked on an explicit "unknown"
-- country and flagged for review. Filing it under the most common country in
-- the file instead would silently corrupt every per-country figure.
ALTER TABLE countries DROP CONSTRAINT IF EXISTS countries_continent_code_check;
ALTER TABLE countries ADD CONSTRAINT countries_continent_code_check
  CHECK (continent_code = ANY (ARRAY[
    'AFRICA','ASIA','EUROPE','NORTH_AMERICA','SOUTH_AMERICA','OCEANIA','UNKNOWN'
  ]));
