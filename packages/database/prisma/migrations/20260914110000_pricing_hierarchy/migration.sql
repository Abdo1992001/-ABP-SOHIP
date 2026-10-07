ALTER TABLE "pricing_base_configs" ADD COLUMN "standard_price_per_kg" DECIMAL(14,4);
ALTER TABLE "pricing_base_configs" ADD COLUMN "curved_price_per_kg" DECIMAL(14,4);
ALTER TABLE "pricing_base_configs" ADD COLUMN "circular_price_per_kg" DECIMAL(14,4);
ALTER TABLE "pricing_base_configs" ADD COLUMN "default_density_kg_m3" DECIMAL(14,4);
ALTER TABLE "pricing_base_configs" ADD COLUMN "default_thickness_mm" DECIMAL(12,3);
ALTER TABLE "pricing_base_configs" ADD COLUMN "reference_board_width_mm" DECIMAL(12,3);
ALTER TABLE "pricing_base_configs" ADD COLUMN "reference_board_length_mm" DECIMAL(12,3);
ALTER TABLE "pricing_base_configs" ADD COLUMN "default_discount_pct" DECIMAL(5,2);

ALTER TABLE "quotations" ADD COLUMN "standard_price_per_kg_override" DECIMAL(14,4);
ALTER TABLE "quotations" ADD COLUMN "curved_price_per_kg_override" DECIMAL(14,4);
ALTER TABLE "quotations" ADD COLUMN "density_override_kg_m3" DECIMAL(14,4);

-- Backfill the currently active pricing_base_configs row(s) with the ACROW
-- BOARD sheet's company defaults, so the system is never basis-less.
UPDATE "pricing_base_configs"
SET
  standard_price_per_kg = 90,
  curved_price_per_kg = 120,
  circular_price_per_kg = 120,
  default_density_kg_m3 = 720,
  default_thickness_mm = 18,
  reference_board_width_mm = 1220,
  reference_board_length_mm = 2440,
  default_discount_pct = 0
WHERE effective_to IS NULL;
