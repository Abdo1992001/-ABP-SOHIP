ALTER TABLE erp_orders
  ADD COLUMN IF NOT EXISTS source_system_id uuid,
  ADD COLUMN IF NOT EXISTS source_sales_order_id uuid,
  ADD COLUMN IF NOT EXISTS import_row_id uuid,
  ADD COLUMN IF NOT EXISTS country_code char(2),
  ADD COLUMN IF NOT EXISTS order_date date,
  ADD COLUMN IF NOT EXISTS status_raw text,
  ADD COLUMN IF NOT EXISTS total_amount numeric(18,4),
  ADD COLUMN IF NOT EXISTS source_updated_at timestamptz(6);

UPDATE erp_orders
SET source_system_id = (
      substr(md5('source-system:' || source_system_code), 1, 8) || '-' ||
      substr(md5('source-system:' || source_system_code), 9, 4) || '-4' ||
      substr(md5('source-system:' || source_system_code), 14, 3) || '-8' ||
      substr(md5('source-system:' || source_system_code), 18, 3) || '-' ||
      substr(md5('source-system:' || source_system_code), 21, 12)
    )::uuid,
    source_sales_order_id = erp_order_id
WHERE source_system_id IS NULL OR source_sales_order_id IS NULL;

ALTER TABLE erp_orders
  ALTER COLUMN source_system_id SET NOT NULL,
  ALTER COLUMN source_sales_order_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS erp_orders_source_ids_key ON erp_orders(source_system_id, source_sales_order_id);
CREATE INDEX IF NOT EXISTS erp_orders_country_imported_idx ON erp_orders(country_code, imported_at DESC, erp_order_id);
