CREATE OR REPLACE FUNCTION reject_fx_rate_overlap() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status_code='APPROVED' AND EXISTS (
    SELECT 1 FROM fx_rates f
    WHERE f.fx_rate_id<>NEW.fx_rate_id AND f.status_code='APPROVED'
      AND f.base_currency_code=NEW.base_currency_code AND f.quote_currency_code=NEW.quote_currency_code
      AND tstzrange(f.effective_from,f.effective_to,'[)') && tstzrange(NEW.effective_from,NEW.effective_to,'[)')
  ) THEN RAISE EXCEPTION 'FX_RATE_EFFECTIVE_RANGE_OVERLAP' USING ERRCODE='23P01'; END IF;
  RETURN NEW;
END $$;
