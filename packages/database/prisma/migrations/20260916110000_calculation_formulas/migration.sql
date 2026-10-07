-- Pricing rules that are DATA, not code.
--
-- ACROW does not only sell by the kilogram: the same quotation may need a
-- price by square metre, by cubic metre, by linear metre, a flat price per
-- piece, or weight plus a fabrication charge. Shipping a release for each of
-- those is how a pricing system stops being used, so a formula is a stored
-- string evaluated by apps/api/src/quotation/formula-engine.ts.
CREATE TABLE "calculation_formulas" (
  "calculation_formula_id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "formula_key"            TEXT NOT NULL,
  "display_name"           TEXT NOT NULL,
  "arabic_label"           TEXT,
  "expression"             TEXT NOT NULL,
  "description"            TEXT,
  -- What the expression produces. Everything seeded here produces a unit
  -- price; the column exists so a later formula can produce a quantity or a
  -- weight without a migration.
  "result_variable"        TEXT NOT NULL DEFAULT 'unitPrice',
  -- The unit whoever picks this formula should enter `rate` in. A formula
  -- priced by square metre and one priced by kilogram both read `rate`, and
  -- the difference is only visible if the screen says so.
  "rate_unit_label"        TEXT,
  "status_code"            TEXT NOT NULL DEFAULT 'ACTIVE',
  "version_no"             INTEGER NOT NULL DEFAULT 1,
  "sort_order"             INTEGER NOT NULL DEFAULT 0,
  "created_by_user_id"     UUID,
  "created_at"             TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"             TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "calculation_formulas_pkey" PRIMARY KEY ("calculation_formula_id")
);

CREATE UNIQUE INDEX "calculation_formulas_key_key" ON "calculation_formulas"("formula_key");
CREATE INDEX "calculation_formulas_status_idx" ON "calculation_formulas"("status_code", "sort_order");

-- The specification's own worked examples, so the library is useful the
-- moment it exists. There is deliberately no waste-factor formula: ACROW cuts
-- every piece to the customer's dimensions and has no offcut to charge for.
INSERT INTO "calculation_formulas" (
  "formula_key", "display_name", "arabic_label", "expression", "description", "rate_unit_label", "sort_order"
) VALUES
  ('price_by_area', 'Price by area', 'السعر بالمتر المربع',
   'area * rate',
   'Delivered surface in square metres, multiplied by the rate.',
   'per m²', 10),
  ('price_by_volume', 'Price by volume', 'السعر بالمتر المكعب',
   'volume * rate',
   'Delivered volume in cubic metres, multiplied by the rate.',
   'per m³', 20),
  ('price_by_linear_metre', 'Price by linear metre', 'السعر بالمتر الطولي',
   'lengthM * rate',
   'Delivered length in metres, multiplied by the rate.',
   'per m', 30),
  ('price_per_piece', 'Fixed price per piece', 'سعر ثابت للقطعة',
   'rate',
   'A flat price for each delivered piece, whatever its dimensions.',
   'per piece', 40),
  ('weight_plus_fabrication', 'Weight plus fabrication', 'الوزن بالإضافة للتصنيع',
   'weight * rate + fabricationCost',
   'Delivered weight at the rate, plus a fabrication charge per piece.',
   'per kg', 50),
  ('boards_by_span', 'Boards a span needs', 'عدد الألواح للمسافة',
   'ceil(lengthM / 2.44) * rate',
   'How many standard 2.44 m boards the span needs, at a price per board.',
   'per board', 60);
