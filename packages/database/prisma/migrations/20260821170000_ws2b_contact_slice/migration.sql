-- WS2-B Contact vertical slice. Contact-only grants remain intersected with
-- Account Country Scope and never grant Customer 360 access.

CREATE TABLE "contacts" (
  "contact_id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "account_id" UUID NOT NULL,
  "display_name" TEXT NOT NULL,
  "job_title" TEXT,
  "status_code" TEXT NOT NULL DEFAULT 'ACTIVE',
  "row_version" BIGINT NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by_user_id" UUID,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by_user_id" UUID,
  CONSTRAINT "contacts_pkey" PRIMARY KEY ("contact_id"),
  CONSTRAINT "contacts_status_check" CHECK ("status_code" IN ('ACTIVE', 'INACTIVE', 'ARCHIVED')),
  CONSTRAINT "contacts_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("account_id") ON DELETE RESTRICT,
  CONSTRAINT "contacts_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_users"("id") ON DELETE RESTRICT,
  CONSTRAINT "contacts_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "app_users"("id") ON DELETE RESTRICT
);

CREATE INDEX "contacts_account_status_updated_id_idx" ON "contacts"("account_id", "status_code", "updated_at" DESC, "contact_id");
CREATE INDEX "contacts_display_name_idx" ON "contacts"("display_name");

CREATE TABLE "contact_channels" (
  "contact_channel_id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "contact_id" UUID NOT NULL,
  "channel_type_code" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "normalized_value" TEXT NOT NULL,
  "is_primary" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by_user_id" UUID,
  CONSTRAINT "contact_channels_pkey" PRIMARY KEY ("contact_channel_id"),
  CONSTRAINT "contact_channels_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("contact_id") ON DELETE CASCADE,
  CONSTRAINT "contact_channels_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_users"("id") ON DELETE RESTRICT,
  CONSTRAINT "contact_channels_contact_type_normalized_key" UNIQUE ("contact_id", "channel_type_code", "normalized_value")
);

CREATE INDEX "contact_channels_normalized_value_idx" ON "contact_channels"("normalized_value");
CREATE UNIQUE INDEX "contact_channels_one_primary_type_idx" ON "contact_channels"("contact_id", "channel_type_code") WHERE "is_primary" = true;

CREATE TABLE "contact_shares" (
  "contact_share_id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "account_id" UUID NOT NULL,
  "recipient_user_id" UUID NOT NULL,
  "access_level_code" TEXT NOT NULL DEFAULT 'VIEW',
  "expires_at" TIMESTAMPTZ(6),
  "status_code" TEXT NOT NULL DEFAULT 'ACTIVE',
  "row_version" BIGINT NOT NULL DEFAULT 1,
  "created_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revoked_by_user_id" UUID,
  "revoked_at" TIMESTAMPTZ(6),
  CONSTRAINT "contact_shares_pkey" PRIMARY KEY ("contact_share_id"),
  CONSTRAINT "contact_shares_access_level_check" CHECK ("access_level_code" IN ('VIEW', 'COLLABORATE_EDIT')),
  CONSTRAINT "contact_shares_status_check" CHECK ("status_code" IN ('ACTIVE', 'REVOKED')),
  CONSTRAINT "contact_shares_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("account_id") ON DELETE RESTRICT,
  CONSTRAINT "contact_shares_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "app_users"("id") ON DELETE RESTRICT,
  CONSTRAINT "contact_shares_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_users"("id") ON DELETE RESTRICT,
  CONSTRAINT "contact_shares_revoked_by_user_id_fkey" FOREIGN KEY ("revoked_by_user_id") REFERENCES "app_users"("id") ON DELETE RESTRICT
);

CREATE INDEX "contact_shares_recipient_status_expiry_account_idx" ON "contact_shares"("recipient_user_id", "status_code", "expires_at", "account_id");

CREATE TABLE "contact_share_items" (
  "contact_share_item_id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "contact_share_id" UUID NOT NULL,
  "contact_id" UUID NOT NULL,
  CONSTRAINT "contact_share_items_pkey" PRIMARY KEY ("contact_share_item_id"),
  CONSTRAINT "contact_share_items_contact_share_id_fkey" FOREIGN KEY ("contact_share_id") REFERENCES "contact_shares"("contact_share_id") ON DELETE CASCADE,
  CONSTRAINT "contact_share_items_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("contact_id") ON DELETE RESTRICT,
  CONSTRAINT "contact_share_items_share_contact_key" UNIQUE ("contact_share_id", "contact_id")
);

CREATE INDEX "contact_share_items_contact_share_idx" ON "contact_share_items"("contact_id", "contact_share_id");

-- A selected Contact must belong to the Contact Share header Account. The
-- trigger is a database backstop; the service also validates before insert.
CREATE FUNCTION enforce_contact_share_account_match() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "contacts" c
    JOIN "contact_shares" s ON s."contact_share_id" = NEW."contact_share_id"
    WHERE c."contact_id" = NEW."contact_id"
      AND c."account_id" = s."account_id"
  ) THEN
    RAISE EXCEPTION 'CONTACT_SHARE_ACCOUNT_MISMATCH' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "contact_share_account_match_trg"
BEFORE INSERT OR UPDATE ON "contact_share_items"
FOR EACH ROW EXECUTE FUNCTION enforce_contact_share_account_match();
