-- CD-WS2D-001: governed reference values are effective-dated, not mutable singleton rows.
ALTER TABLE opportunity_lost_reasons
  DROP CONSTRAINT IF EXISTS opportunity_lost_reasons_lost_reason_code_key;

CREATE UNIQUE INDEX opportunity_stage_policies_stage_effective_key
  ON opportunity_stage_policies (stage_code, effective_from);

CREATE UNIQUE INDEX opportunity_lost_reasons_code_effective_key
  ON opportunity_lost_reasons (lost_reason_code, effective_from);
