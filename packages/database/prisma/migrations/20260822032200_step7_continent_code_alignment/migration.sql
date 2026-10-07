ALTER TABLE countries DROP CONSTRAINT IF EXISTS countries_continent_fkey;
ALTER TABLE continents ALTER COLUMN code TYPE text USING btrim(code);
INSERT INTO continents(code,name,active) VALUES
  ('AFRICA','Africa',true),
  ('ASIA','Asia',true),
  ('EUROPE','Europe',true),
  ('NORTH_AMERICA','North America',true),
  ('SOUTH_AMERICA','South America',true),
  ('OCEANIA','Oceania',true),
  ('ANTARCTICA','Antarctica',true)
ON CONFLICT(code) DO UPDATE SET name=EXCLUDED.name, active=true;
ALTER TABLE countries
  ADD CONSTRAINT countries_continent_fkey FOREIGN KEY (continent_code)
  REFERENCES continents(code) ON DELETE RESTRICT;
