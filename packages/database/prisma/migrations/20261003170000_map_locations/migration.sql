-- An exact place for a customer or a project, dropped on the map by someone
-- who knows where it is. Without one, the map places a record by the district
-- or city named in its address, and failing that by its country.
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS latitude double precision,
  ADD COLUMN IF NOT EXISTS longitude double precision;
ALTER TABLE accounts
  ADD CONSTRAINT accounts_location_check CHECK (
    (latitude IS NULL AND longitude IS NULL)
    OR (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)
  );
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS latitude double precision,
  ADD COLUMN IF NOT EXISTS longitude double precision;
ALTER TABLE projects
  ADD CONSTRAINT projects_location_check CHECK (
    (latitude IS NULL AND longitude IS NULL)
    OR (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)
  );
