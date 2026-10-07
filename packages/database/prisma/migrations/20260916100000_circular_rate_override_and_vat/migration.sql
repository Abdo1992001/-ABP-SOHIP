-- Circular work is commercially part of the curved family, but it is not the
-- same rate: the spec gives it its own default (120 EGP/kg) and its own
-- quotation-level override. Until now a circular line silently inherited the
-- curved override, so discounting curved work discounted circular work too.
ALTER TABLE "quotations" ADD COLUMN "circular_price_per_kg_override" DECIMAL(14,4);

-- Egyptian VAT is 14%. Without an active policy the server computes zero tax
-- and every quotation totals to its own subtotal, which is a number no
-- customer is actually being asked to pay. Seeded only when nothing is
-- already active, so an environment that has set its own rate is untouched.
INSERT INTO "tax_policies" (
  "tax_policy_id",
  "tax_code",
  "version_no",
  "tax_rate_pct",
  "effective_from",
  "effective_to",
  "status_code",
  "created_by_user_id",
  "created_at"
)
SELECT
  gen_random_uuid(),
  'VAT',
  1,
  14,
  now(),
  NULL,
  'ACTIVE',
  COALESCE(
    (SELECT "id" FROM "app_users" ORDER BY "created_at" LIMIT 1),
    '00000000-0000-0000-0000-000000000000'::uuid
  ),
  now()
WHERE NOT EXISTS (
  SELECT 1 FROM "tax_policies"
  WHERE "tax_code" = 'VAT'
    AND "status_code" = 'ACTIVE'
    AND ("effective_to" IS NULL OR "effective_to" > now())
);
