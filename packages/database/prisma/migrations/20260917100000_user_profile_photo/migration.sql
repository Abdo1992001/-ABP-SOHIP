-- Let a person put a face to their name.
--
-- Storage follows the mechanism this system already uses for product images:
-- the bytes go to the object store under storage/profile-photos and only the
-- reference metadata lives here. The image itself is never a column.
--
-- One photo per person, so these are columns on the profile rather than a
-- table of their own: a second table would buy a history nobody asked for.

ALTER TABLE user_profiles ADD COLUMN photo_storage_key  text;
ALTER TABLE user_profiles ADD COLUMN photo_content_type text;
ALTER TABLE user_profiles ADD COLUMN photo_size_bytes   integer;
ALTER TABLE user_profiles ADD COLUMN photo_sha256       text;
-- The cache buster. A photo served from a stable URL would keep showing the
-- old face until a hard refresh, so the client appends this and the browser
-- treats a replacement as a different resource.
ALTER TABLE user_profiles ADD COLUMN photo_updated_at   timestamptz(6);

ALTER TABLE user_profiles
  ADD CONSTRAINT user_profiles_photo_complete_check
  CHECK (
    (photo_storage_key IS NULL AND photo_content_type IS NULL
      AND photo_size_bytes IS NULL AND photo_sha256 IS NULL
      AND photo_updated_at IS NULL)
    OR
    (photo_storage_key IS NOT NULL AND photo_content_type IS NOT NULL
      AND photo_size_bytes IS NOT NULL AND photo_sha256 IS NOT NULL
      AND photo_updated_at IS NOT NULL)
  );
