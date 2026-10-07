ALTER TABLE erp_orders
  ADD COLUMN integration_status_code text NOT NULL DEFAULT 'NOT_REQUIRED',
  ADD COLUMN external_erp_id text,
  ADD COLUMN sync_attempted_at timestamptz(6),
  ADD COLUMN sync_error_code text;

ALTER TABLE erp_orders
  ADD CONSTRAINT erp_orders_integration_status_check
  CHECK (
    integration_status_code IN (
      'NOT_REQUIRED',
      'PENDING_SYNC',
      'SYNCING',
      'SYNCED',
      'SYNC_FAILED'
    )
  );

CREATE UNIQUE INDEX erp_orders_external_erp_id_key
  ON erp_orders(external_erp_id)
  WHERE external_erp_id IS NOT NULL;

CREATE INDEX erp_orders_pending_sync_idx
  ON erp_orders(integration_status_code, imported_at, erp_order_id);
