-- Quotation document lifecycle, proforma numbering, incoterm-driven shipping,
-- and product images.
--
-- The separation this encodes: an OPPORTUNITY has a commercial stage (new lead,
-- hot lead, under negotiation, won, lost) and a QUOTATION has a document status
-- (draft, ready, sent, superseded, expired, cancelled). They are not the same
-- axis. A deal can go back to negotiation after a quotation was already sent,
-- and a sent quotation never becomes "won" - the deal does.

-- ------------------------------------------------------------- quotations --
-- SUPERSEDED: a sent quotation is immutable, so a material change issues a new
-- quotation that points at the old one via supersedes_quotation_id, and the old
-- one is marked superseded rather than edited.
ALTER TABLE quotations DROP CONSTRAINT IF EXISTS quotations_status_check;
ALTER TABLE quotations DROP CONSTRAINT IF EXISTS quotations_document_state_check;
ALTER TABLE quotations ADD CONSTRAINT quotations_document_state_check
  CHECK (status_code = ANY (ARRAY[
    'DRAFT','READY','SENT','SUPERSEDED','EXPIRED','CANCELLED'
  ]));

ALTER TABLE quotations
  -- Proforma invoice number, issued only when the document is sent officially.
  -- Separate from quotation_ref: one quotation can become a PI, and the PI
  -- number is what the customer's finance department quotes back at you.
  ADD COLUMN IF NOT EXISTS pi_number            text,
  ADD COLUMN IF NOT EXISTS pi_issued_at         timestamptz(6),
  -- Shipping block. Which of these is meaningful depends on the incoterm:
  --   DDP -> delivery_address (we deliver to the customer's site)
  --   CIF -> port_of_discharge (we ship to the customer's port)
  --   FOB -> port_of_loading (the customer takes over at our port)
  ADD COLUMN IF NOT EXISTS delivery_address     text,
  ADD COLUMN IF NOT EXISTS port_of_loading      text,
  ADD COLUMN IF NOT EXISTS port_of_discharge    text,
  ADD COLUMN IF NOT EXISTS cancelled_at         timestamptz(6),
  ADD COLUMN IF NOT EXISTS cancellation_reason  text,
  ADD COLUMN IF NOT EXISTS superseded_at        timestamptz(6);

CREATE UNIQUE INDEX IF NOT EXISTS quotations_pi_number_key
  ON quotations (pi_number) WHERE pi_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS quotations_supersedes_idx
  ON quotations (supersedes_quotation_id);

-- Proforma invoice numbering, same shape as the quotation reference:
-- 01-Sep-ABP-PI-2026, restarting each month.
CREATE TABLE IF NOT EXISTS pi_ref_counter (
  period      text PRIMARY KEY,
  last_serial integer NOT NULL
);

CREATE OR REPLACE FUNCTION next_pi_number() RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  now_utc      timestamptz := now();
  period_month text := to_char(now_utc, 'Mon');
  period_year  text := to_char(now_utc, 'YYYY');
  period_key   text := period_month || '-' || period_year;
  serial       integer;
BEGIN
  INSERT INTO pi_ref_counter (period, last_serial) VALUES (period_key, 1)
  ON CONFLICT (period) DO UPDATE SET last_serial = pi_ref_counter.last_serial + 1
  RETURNING last_serial INTO serial;
  RETURN lpad(serial::text, 2, '0') || '-' || period_month || '-ABP-PI-' || period_year;
END; $$;

-- -------------------------------------------------------- opportunities --
-- Cancelled is not lost. "Lost" means a competitor won it and the reason is
-- worth recording; "cancelled" means the customer walked away from the whole
-- requirement, and forcing it into a lost-reason taxonomy pollutes win/loss.
ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS cancelled_at        timestamptz(6),
  ADD COLUMN IF NOT EXISTS cancellation_reason text;

-- --------------------------------------------------------- product images --
-- The image belongs to the product, not to the quotation. A quotation line
-- points at the product, and the officially issued document snapshots which
-- image it used - so re-issuing a product photo never silently rewrites what a
-- customer was already sent.
CREATE TABLE IF NOT EXISTS product_images (
  product_image_id uuid PRIMARY KEY,
  product_id       uuid NOT NULL REFERENCES products (product_id) ON DELETE CASCADE,
  storage_key      text NOT NULL UNIQUE,
  file_name        text NOT NULL,
  content_type     text NOT NULL,
  size_bytes       integer NOT NULL,
  sha256           text NOT NULL,
  is_primary       boolean NOT NULL DEFAULT true,
  uploaded_by_user_id uuid NOT NULL REFERENCES app_users (id) ON DELETE RESTRICT,
  created_at       timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT product_images_size_check CHECK (size_bytes > 0 AND size_bytes <= 10485760),
  CONSTRAINT product_images_type_check CHECK (
    content_type = ANY (ARRAY['image/png','image/jpeg','image/webp','image/gif'])
  )
);

CREATE INDEX IF NOT EXISTS product_images_product_idx ON product_images (product_id, is_primary);

-- Only one primary image per product; the rest are alternates.
CREATE UNIQUE INDEX IF NOT EXISTS product_images_primary_key
  ON product_images (product_id) WHERE is_primary;

ALTER TABLE quotation_lines
  ADD COLUMN IF NOT EXISTS product_image_id uuid REFERENCES product_images (product_image_id) ON DELETE SET NULL;
