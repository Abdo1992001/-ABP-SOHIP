-- The payment terms ABP's issued quotations actually carry.
--
-- The table held six terms, and the two the sales team reach for most were not
-- among them: the staged 30/35/35 that quotation 0X-Sep-ABP-2026 is written on,
-- and the advance-plus-balance-before-delivery split. The Quotation Studio
-- offered codes for them anyway, out of a list typed into the front end, and
-- the server — which checks that a term is a live row before it writes a draft
-- — refused every save that used one. A quotation that cannot be saved because
-- of a list the screen invented.
--
-- These rows come from the archive rather than from imagination: each one is a
-- terms line that appears on documents ABP has sent. The display text is the
-- wording those documents use, because it is printed verbatim.
--
-- `effective_from` is 2020-01-01 to match the terms already seeded, so nothing
-- has to be back-dated for an older quotation to reference one.
--
-- On a fresh database the table is still empty (the reference ETL fills it and
-- carries these three terms too), so there is no owner to record and nothing
-- to add: the insert is skipped rather than failing the whole deploy.

INSERT INTO payment_terms (
  payment_term_id,
  term_code,
  display_text,
  effective_from,
  effective_to,
  is_active,
  created_by_user_id,
  created_at
)
SELECT
  gen_random_uuid(),
  seeded.term_code,
  seeded.display_text,
  TIMESTAMPTZ '2020-01-01 00:00:00+00',
  NULL,
  TRUE,
  (SELECT created_by_user_id FROM payment_terms ORDER BY created_at LIMIT 1),
  NOW()
FROM (
  VALUES
    (
      'ADVANCE_30_35_35',
      '30% in advance, 35% after 30 days from the delivery date, and the remaining 35% after 60 days from the delivery date.'
    ),
    (
      'ADVANCE_50_BALANCE_BEFORE_DELIVERY',
      '50% advance, 50% before delivery.'
    ),
    (
      'ADVANCE_25_BALANCE_ON_DELIVERY',
      '25% advance, 75% on delivery.'
    )
) AS seeded(term_code, display_text)
-- Re-runnable, and it will not disturb a term somebody has since edited.
WHERE NOT EXISTS (
  SELECT 1 FROM payment_terms existing
  WHERE existing.term_code = seeded.term_code
)
AND EXISTS (SELECT 1 FROM payment_terms);
