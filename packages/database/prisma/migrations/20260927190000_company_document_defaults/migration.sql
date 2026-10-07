-- The fields every ABP document carries and no quotation was storing.
--
-- The quotation template has boxes for a sales engineer, a mobile number,
-- delivery terms, a delivery point and an offer validity. Nothing in the system
-- held any of them, so five boxes on every document a customer receives came
-- out blank — and the sales team went back to typing them into a copy of the
-- spreadsheet, which is the habit the system exists to replace.
--
-- They belong with the other company defaults rather than on each quotation:
-- they are the same on every document the company issues, the delivery point
-- is a yard address, and the validity is a policy. A quotation that needs to
-- differ still overrides them on its own record.
--
-- `pricing_base_configs` is already the versioned, effective-dated table of
-- company defaults, so a change to any of these keeps its history the same way
-- a change to a rate does.

ALTER TABLE pricing_base_configs
  ADD COLUMN IF NOT EXISTS document_sales_engineer text,
  ADD COLUMN IF NOT EXISTS document_mobile text,
  ADD COLUMN IF NOT EXISTS document_delivery_terms text,
  ADD COLUMN IF NOT EXISTS document_delivery_point text,
  ADD COLUMN IF NOT EXISTS document_offer_validity text;

-- The values ABP's own issued documents carry, on the live row only. They are
-- read off the quotation template's sample and the archive, not invented: the
-- storeyard is the one printed on `001-Sep-ABP-2026`, and seven days is the
-- validity the sales team confirmed as the default.
--
-- The sales engineer and the mobile are deliberately left empty. They are the
-- writer's, not the company's: a customer with a question about a quotation
-- rings the person whose name is on it. Both are read from that person's own
-- profile, and these two columns are only a fallback for a colleague who has
-- no number on file or has chosen to hide it.
UPDATE pricing_base_configs
SET
  document_delivery_terms = COALESCE(
    document_delivery_terms,
    'According to agreed schedule.'
  ),
  document_delivery_point = COALESCE(
    document_delivery_point,
    'ABP Storeyard – Wadi Houf, Helwan.'
  ),
  document_offer_validity = COALESCE(document_offer_validity, '7 Days.')
WHERE effective_to IS NULL;
