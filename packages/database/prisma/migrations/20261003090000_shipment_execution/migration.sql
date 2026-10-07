-- Shipments carry a customer order to the customer's hands.
--
-- Until now a shipment was a mirror of an ERP order's export milestones
-- (ready, shipped, vessel departed, arrived at port) and stopped at the port.
-- It now belongs to a CRM customer order as well, says how it travels (a
-- local truck, or a sea container), carries the load plan worked out in the
-- Cargo Loader, and runs on to the two things the customer actually signs
-- for: delivery, and the proof of delivery (POD).
--
--   LOCAL_TRUCK    READY_FOR_DELIVERY -> SHIPPED -> DELIVERED -> POD_RECEIVED
--   SEA_CONTAINER  READY_FOR_DELIVERY -> SHIPPED -> VESSEL_DEPARTED
--                  -> ARRIVED_AT_PORT_OF_DISCHARGE -> DELIVERED -> POD_RECEIVED
--
-- Existing shipments are ERP export shipments, so they are SEA_CONTAINER.

ALTER TABLE shipments ALTER COLUMN erp_order_id DROP NOT NULL;

ALTER TABLE shipments
  ADD COLUMN IF NOT EXISTS customer_order_id uuid REFERENCES customer_orders(customer_order_id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS transport_mode_code text NOT NULL DEFAULT 'SEA_CONTAINER',
  ADD COLUMN IF NOT EXISTS planned_dispatch_date date,
  ADD COLUMN IF NOT EXISTS load_plan_jsonb jsonb,
  ADD COLUMN IF NOT EXISTS vehicle_ref text,
  ADD COLUMN IF NOT EXISTS container_no text,
  ADD COLUMN IF NOT EXISTS seal_no text,
  ADD COLUMN IF NOT EXISTS driver_name text,
  ADD COLUMN IF NOT EXISTS driver_phone text,
  ADD COLUMN IF NOT EXISTS dispatched_at timestamptz(6),
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz(6),
  ADD COLUMN IF NOT EXISTS received_by_name text,
  ADD COLUMN IF NOT EXISTS delivery_condition_code text,
  ADD COLUMN IF NOT EXISTS delivery_notes text,
  ADD COLUMN IF NOT EXISTS pod_received_at timestamptz(6),
  ADD COLUMN IF NOT EXISTS pod_reference text,
  ADD COLUMN IF NOT EXISTS pod_document_id uuid;

ALTER TABLE shipments DROP CONSTRAINT IF EXISTS shipments_milestone_check;
ALTER TABLE shipments
  ADD CONSTRAINT shipments_milestone_check CHECK (milestone_code IN (
    'READY_FOR_DELIVERY', 'SHIPPED', 'VESSEL_DEPARTED',
    'ARRIVED_AT_PORT_OF_DISCHARGE', 'DELIVERED', 'POD_RECEIVED')),
  ADD CONSTRAINT shipments_order_link_check
    CHECK (erp_order_id IS NOT NULL OR customer_order_id IS NOT NULL),
  ADD CONSTRAINT shipments_transport_mode_check
    CHECK (transport_mode_code IN ('LOCAL_TRUCK', 'SEA_CONTAINER')),
  ADD CONSTRAINT shipments_delivery_condition_check
    CHECK (delivery_condition_code IS NULL OR delivery_condition_code IN ('GOOD', 'DAMAGED', 'SHORT', 'REFUSED')),
  -- A delivery that was not clean has to say what went wrong.
  ADD CONSTRAINT shipments_delivery_notes_check
    CHECK (delivery_condition_code IS NULL OR delivery_condition_code = 'GOOD'
           OR NULLIF(btrim(delivery_notes), '') IS NOT NULL),
  ADD CONSTRAINT shipments_delivered_fields_check
    CHECK (milestone_code NOT IN ('DELIVERED', 'POD_RECEIVED')
           OR (delivered_at IS NOT NULL AND NULLIF(btrim(received_by_name), '') IS NOT NULL)),
  ADD CONSTRAINT shipments_pod_fields_check
    CHECK (milestone_code <> 'POD_RECEIVED'
           OR (pod_received_at IS NOT NULL AND (pod_document_id IS NOT NULL OR NULLIF(btrim(pod_reference), '') IS NOT NULL)));

CREATE INDEX IF NOT EXISTS shipments_customer_order_idx
  ON shipments(customer_order_id, created_at);

-- When the customer can expect it: set when the shipment is planned, and
-- revised at dispatch. The delivery calendar is built from these dates.
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS expected_delivery_date date;
CREATE INDEX IF NOT EXISTS shipments_expected_delivery_idx
  ON shipments(country_code, expected_delivery_date);
