-- The ACROW BOARD workbook's MASTER SETTINGS tab, as company defaults.
--
-- Four of these settings had no home in the system at all, and one of them
-- ("Regular Column Closure Allowance") drives a rule that changes every
-- rectangular column quotation: a column of A × B is cut as
-- A / B / A+20 / B+20, because the two closing panels lap the thickness of
-- their neighbours. Quoting it as A/B/A/B is 40 mm of panel short on every
-- column and the formwork does not close.
ALTER TABLE "pricing_base_configs" ADD COLUMN "max_panel_width_mm" DECIMAL(12,3);
ALTER TABLE "pricing_base_configs" ADD COLUMN "max_panel_length_mm" DECIMAL(12,3);
ALTER TABLE "pricing_base_configs" ADD COLUMN "default_column_height_mm" DECIMAL(12,3);
ALTER TABLE "pricing_base_configs" ADD COLUMN "column_closure_allowance_mm" DECIMAL(12,3);

-- A rate carried at four decimals cannot represent 2500 / 32.14944 exactly
-- enough to reproduce the workbook to the piastre: 4.32 kg comes out at
-- 335.92 instead of 335.93. The CRM and the sheet have to agree digit for
-- digit or nobody will trust either, so the rates get eight.
ALTER TABLE "pricing_base_configs" ALTER COLUMN "standard_price_per_kg" TYPE DECIMAL(18,8);
ALTER TABLE "pricing_base_configs" ALTER COLUMN "curved_price_per_kg" TYPE DECIMAL(18,8);
ALTER TABLE "pricing_base_configs" ALTER COLUMN "circular_price_per_kg" TYPE DECIMAL(18,8);
ALTER TABLE "quotations" ALTER COLUMN "standard_price_per_kg_override" TYPE DECIMAL(18,8);
ALTER TABLE "quotations" ALTER COLUMN "curved_price_per_kg_override" TYPE DECIMAL(18,8);
ALTER TABLE "quotations" ALTER COLUMN "circular_price_per_kg_override" TYPE DECIMAL(18,8);

-- Supersede the active basis rather than editing it: this table is versioned
-- and effective-dated precisely so an already-issued quotation keeps the
-- numbers it was issued on.
--
-- The values are the workbook's MASTER SETTINGS as of this migration:
--   Density 600 kg/m³ (not 720 — the workbook's master, and what every
--     weight on its REGULAR COLUMNS quotation is computed from)
--   Standard rate entered as BOARD PRICE 2,500.00 over a 32.14944 kg
--     reference board -> 77.76185215 EGP/kg
--   Curved / circular 120.00 EGP/kg
UPDATE "pricing_base_configs"
SET "effective_to" = now()
WHERE "effective_to" IS NULL;

INSERT INTO "pricing_base_configs" (
  "pricing_base_config_id",
  "standard_board_price",
  "currency_code",
  "standard_weight_kg",
  "standard_price_per_kg",
  "curved_price_per_kg",
  "circular_price_per_kg",
  "default_density_kg_m3",
  "default_thickness_mm",
  "reference_board_width_mm",
  "reference_board_length_mm",
  "default_discount_pct",
  "max_panel_width_mm",
  "max_panel_length_mm",
  "default_column_height_mm",
  "column_closure_allowance_mm",
  "effective_from",
  "effective_to",
  "created_by_user_id",
  "created_at"
)
SELECT
  gen_random_uuid(),
  2500,
  'EGP',
  32.14944,
  77.76185215,
  120,
  120,
  600,
  18,
  1220,
  2440,
  0,
  1220,
  2000,
  4000,
  20,
  now(),
  NULL,
  COALESCE(
    (SELECT "id" FROM "app_users" ORDER BY "created_at" LIMIT 1),
    '00000000-0000-0000-0000-000000000000'::uuid
  ),
  now();
