ALTER TABLE activities
  ADD COLUMN occurred_at timestamptz(6),
  ADD COLUMN scheduled_at timestamptz(6),
  ADD COLUMN outcome_code text;
