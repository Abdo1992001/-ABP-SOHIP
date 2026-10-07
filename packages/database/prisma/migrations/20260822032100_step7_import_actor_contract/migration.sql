UPDATE import_batches
SET actor_user_id = (SELECT id FROM app_users ORDER BY id LIMIT 1)
WHERE actor_user_id IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM import_batches WHERE actor_user_id IS NULL) THEN
    RAISE EXCEPTION 'IMPORT_ACTOR_BACKFILL_REQUIRED';
  END IF;
END $$;

ALTER TABLE import_batches ALTER COLUMN actor_user_id SET NOT NULL;
