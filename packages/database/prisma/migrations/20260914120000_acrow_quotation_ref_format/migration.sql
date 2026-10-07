-- ACROW quotation numbering: <serial>-<Mon>-ABP-<YYYY> (e.g. 01-Sep-ABP-2026),
-- matching the reference format on the company's own quotation template. The
-- serial restarts every month, which is why a plain sequence can't produce it;
-- the counter table below keeps one row per Mon-YYYY period and the upsert
-- takes a row lock, so concurrent quotation creation can't hand out the same
-- number twice. Quotations created before this migration keep their existing
-- QTN-00000000 references — the two formats never collide.
CREATE TABLE IF NOT EXISTS quotation_ref_counter (
  period text PRIMARY KEY,
  last_serial integer NOT NULL
);

CREATE OR REPLACE FUNCTION next_quotation_ref() RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  now_utc timestamptz := now();
  period_month text := to_char(now_utc, 'Mon');
  period_year text := to_char(now_utc, 'YYYY');
  period_key text := period_month || '-' || period_year;
  serial integer;
BEGIN
  INSERT INTO quotation_ref_counter (period, last_serial)
  VALUES (period_key, 1)
  ON CONFLICT (period)
  DO UPDATE SET last_serial = quotation_ref_counter.last_serial + 1
  RETURNING last_serial INTO serial;

  RETURN lpad(serial::text, 2, '0')
    || '-' || period_month
    || '-ABP-' || period_year;
END;
$$;

ALTER TABLE quotations ALTER COLUMN quotation_ref SET DEFAULT next_quotation_ref();
