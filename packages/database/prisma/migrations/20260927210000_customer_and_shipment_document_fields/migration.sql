-- The boxes on a proforma invoice that nothing in the system could fill.
--
-- A proforma is a customs document. `A207-2026` in the archive carries the
-- buyer's postal address, their tax number, their own purchase-order number,
-- a lead time and the freight that turns EX-WORKS into CIF — and every one of
-- those boxes came out of this system blank, because no column held them.
--
-- They divide cleanly in two, and that is how they are stored:
--
--   * The buyer's address and tax number belong to the **customer**. They are
--     the same on every document that customer is ever sent, so they go on the
--     account and are typed once.
--   * The purchase-order number, the lead time and the freight belong to the
--     **shipment**. They differ from one order to the next for the same
--     customer, so they go on the quotation.
--
-- The buyer's telephone and e-mail are deliberately absent here: they already
-- exist, on `contact_channels`, and are already populated. They were missing
-- from the document, not from the database.

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS tax_number text;

COMMENT ON COLUMN accounts.address IS
  'Postal address as it is printed on the buyer block of a proforma invoice.';
COMMENT ON COLUMN accounts.tax_number IS
  'The customer''s tax registration number — NIP in Poland, and the equivalent elsewhere.';

ALTER TABLE quotations
  ADD COLUMN IF NOT EXISTS subject text,
  ADD COLUMN IF NOT EXISTS customer_po_number text,
  ADD COLUMN IF NOT EXISTS lead_time text,
  ADD COLUMN IF NOT EXISTS freight_amount numeric(18, 4);

COMMENT ON COLUMN quotations.subject IS
  'What the offer is for, printed under the header. Chosen from document_subjects.';
COMMENT ON COLUMN quotations.freight_amount IS
  'Freight and insurance, in the quotation currency. EX-WORKS plus this is CIF.';

-- The subject line, as a list rather than a free-text box.
--
-- Nearly every ABP offer is for ACROW Board, so the subject is a choice from a
-- short list with one default — not something to retype, and not something to
-- get subtly wrong ("Acrow board", "ACROW BOARDS"). A new subject is added
-- once, from the quotation screen, and is then on the list for everyone: the
-- list is the company's, the same way the delivery wording is.
CREATE TABLE IF NOT EXISTS document_subjects (
  document_subject_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_text        text        NOT NULL,
  is_default          boolean     NOT NULL DEFAULT false,
  is_active           boolean     NOT NULL DEFAULT true,
  sort_order          integer     NOT NULL DEFAULT 100,
  created_at          timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by_user_id  uuid REFERENCES app_users (id)
);

-- Case-insensitive, because "ACROW Board" and "Acrow board" are one subject
-- and a list that holds both is a list nobody trusts.
CREATE UNIQUE INDEX IF NOT EXISTS document_subjects_text_key
  ON document_subjects (lower(subject_text));

-- Exactly one default, enforced rather than hoped for.
CREATE UNIQUE INDEX IF NOT EXISTS document_subjects_one_default_idx
  ON document_subjects (is_default)
  WHERE is_default;

INSERT INTO document_subjects (subject_text, is_default, sort_order)
SELECT 'ACROW Board', true, 10
WHERE NOT EXISTS (SELECT 1 FROM document_subjects);
