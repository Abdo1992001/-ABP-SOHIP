ALTER TABLE "countries"
  ALTER COLUMN "continent_code" TYPE TEXT USING btrim("continent_code");

ALTER TABLE "countries"
  ADD CONSTRAINT "countries_continent_code_check"
  CHECK ("continent_code" IN ('AFRICA', 'ASIA', 'EUROPE', 'NORTH_AMERICA', 'SOUTH_AMERICA', 'OCEANIA'));

ALTER TABLE "app_users"
  ADD COLUMN "email_normalized" TEXT,
  ADD COLUMN "auth_status_code" TEXT NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "auth_provider" TEXT NOT NULL DEFAULT 'SSO',
  ADD COLUMN "last_sign_in_at" TIMESTAMPTZ(6),
  ADD COLUMN "row_version" BIGINT NOT NULL DEFAULT 1;

UPDATE "app_users"
SET "email_normalized" = lower("external_subject") || '@technical.invalid'
WHERE "email_normalized" IS NULL;

ALTER TABLE "app_users"
  ALTER COLUMN "email_normalized" SET NOT NULL,
  ADD CONSTRAINT "app_users_auth_status_code_check"
    CHECK ("auth_status_code" IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'DISABLED', 'LOCKED')),
  ADD CONSTRAINT "app_users_row_version_check" CHECK ("row_version" >= 1);

CREATE UNIQUE INDEX "app_users_email_normalized_key" ON "app_users"("email_normalized");

ALTER TABLE "user_country_access"
  ADD COLUMN "valid_from" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "valid_to" TIMESTAMPTZ(6),
  ADD COLUMN "status_code" TEXT NOT NULL DEFAULT 'ACTIVE',
  ADD CONSTRAINT "user_country_access_status_code_check"
    CHECK ("status_code" IN ('ACTIVE', 'REVOKED', 'EXPIRED')),
  ADD CONSTRAINT "user_country_access_validity_check"
    CHECK ("valid_to" IS NULL OR "valid_to" > "valid_from");

CREATE INDEX "user_country_access_effective_idx"
  ON "user_country_access"("user_id", "status_code", "valid_from", "valid_to");

CREATE TABLE "user_profiles" (
  "user_id" UUID NOT NULL,
  "display_name" TEXT NOT NULL,
  "job_title" TEXT,
  "manager_user_id" UUID,
  "team_id" UUID,
  "phone" TEXT,
  CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("user_id"),
  CONSTRAINT "user_profiles_not_self_manager_check" CHECK ("manager_user_id" IS NULL OR "manager_user_id" <> "user_id")
);

CREATE INDEX "user_profiles_manager_user_id_user_id_idx"
  ON "user_profiles"("manager_user_id", "user_id");

CREATE TABLE "user_permission_overrides" (
  "override_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "permission_code" TEXT NOT NULL,
  "effect_code" TEXT NOT NULL,
  "valid_from" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "valid_to" TIMESTAMPTZ(6),
  "reason" TEXT NOT NULL,
  CONSTRAINT "user_permission_overrides_pkey" PRIMARY KEY ("override_id"),
  CONSTRAINT "user_permission_overrides_effect_code_check" CHECK ("effect_code" IN ('ALLOW', 'DENY')),
  CONSTRAINT "user_permission_overrides_validity_check" CHECK ("valid_to" IS NULL OR "valid_to" > "valid_from")
);

CREATE INDEX "user_permission_overrides_user_permission_effect_idx"
  ON "user_permission_overrides"("user_id", "permission_code", "effect_code");

CREATE SEQUENCE "account_ref_seq" START 1;

CREATE TABLE "accounts" (
  "account_id" UUID NOT NULL,
  "account_ref" TEXT NOT NULL DEFAULT ('ACC-' || lpad(nextval('account_ref_seq')::text, 8, '0')),
  "customer_number" TEXT,
  "raw_name" TEXT,
  "canonical_name" TEXT NOT NULL,
  "normalized_name" TEXT NOT NULL,
  "country_code" CHAR(2) NOT NULL,
  "hq_country_code" CHAR(2),
  "account_category_code" TEXT,
  "owner_user_id" UUID NOT NULL,
  "default_currency_code" CHAR(3),
  "source_system_id" UUID,
  "source_record_key" TEXT,
  "record_status_code" TEXT NOT NULL DEFAULT 'ACTIVE',
  "archived_at" TIMESTAMPTZ(6),
  "archived_by_user_id" UUID,
  "row_version" BIGINT NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by_user_id" UUID,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  "updated_by_user_id" UUID,
  CONSTRAINT "accounts_pkey" PRIMARY KEY ("account_id"),
  CONSTRAINT "accounts_record_status_code_check" CHECK ("record_status_code" IN ('ACTIVE', 'ARCHIVED')),
  CONSTRAINT "accounts_archive_consistency_check" CHECK (
    ("record_status_code" = 'ACTIVE' AND "archived_at" IS NULL AND "archived_by_user_id" IS NULL)
    OR
    ("record_status_code" = 'ARCHIVED' AND "archived_at" IS NOT NULL AND "archived_by_user_id" IS NOT NULL)
  ),
  CONSTRAINT "accounts_row_version_check" CHECK ("row_version" >= 1)
);

CREATE UNIQUE INDEX "accounts_account_ref_key" ON "accounts"("account_ref");
CREATE INDEX "accounts_owner_status_updated_id_idx"
  ON "accounts"("owner_user_id", "record_status_code", "updated_at" DESC, "account_id");
CREATE INDEX "accounts_country_owner_idx" ON "accounts"("country_code", "owner_user_id");
CREATE INDEX "accounts_normalized_name_idx" ON "accounts"("normalized_name");
CREATE INDEX "accounts_customer_number_idx" ON "accounts"("customer_number");
CREATE INDEX "accounts_active_search_idx"
  ON "accounts"("normalized_name", "account_id") WHERE "record_status_code" = 'ACTIVE';

CREATE TABLE "customer_shares" (
  "customer_share_id" UUID NOT NULL,
  "account_id" UUID NOT NULL,
  "owner_user_id_snapshot" UUID NOT NULL,
  "recipient_user_id" UUID NOT NULL,
  "share_scope_code" TEXT NOT NULL,
  "access_level_code" TEXT NOT NULL DEFAULT 'VIEW',
  "expires_at" TIMESTAMPTZ(6),
  "status_code" TEXT NOT NULL DEFAULT 'ACTIVE',
  "created_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revoked_by_user_id" UUID,
  "revoked_at" TIMESTAMPTZ(6),
  CONSTRAINT "customer_shares_pkey" PRIMARY KEY ("customer_share_id"),
  CONSTRAINT "customer_shares_status_code_check" CHECK ("status_code" IN ('ACTIVE', 'REVOKED', 'EXPIRED')),
  CONSTRAINT "customer_shares_access_level_code_check" CHECK ("access_level_code" IN ('VIEW', 'COLLABORATE_EDIT'))
);

CREATE INDEX "customer_shares_recipient_status_expiry_account_idx"
  ON "customer_shares"("recipient_user_id", "status_code", "expires_at", "account_id");
CREATE UNIQUE INDEX "customer_shares_active_unique"
  ON "customer_shares"("account_id", "recipient_user_id", "share_scope_code")
  WHERE "status_code" = 'ACTIVE';

CREATE TABLE "group_networks" (
  "group_network_id" UUID NOT NULL,
  "group_code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "group_type_code" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "group_networks_pkey" PRIMARY KEY ("group_network_id")
);

CREATE UNIQUE INDEX "group_networks_group_code_key" ON "group_networks"("group_code");

CREATE TABLE "account_group_memberships" (
  "membership_id" UUID NOT NULL,
  "account_id" UUID NOT NULL,
  "group_network_id" UUID NOT NULL,
  "valid_from" DATE,
  "valid_to" DATE,
  "source_ref" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by_user_id" UUID,
  CONSTRAINT "account_group_memberships_pkey" PRIMARY KEY ("membership_id"),
  CONSTRAINT "account_group_memberships_validity_check" CHECK ("valid_to" IS NULL OR "valid_from" IS NULL OR "valid_to" >= "valid_from")
);

CREATE INDEX "account_group_memberships_account_validity_idx"
  ON "account_group_memberships"("account_id", "valid_from", "valid_to");
CREATE INDEX "account_group_memberships_network_account_idx"
  ON "account_group_memberships"("group_network_id", "account_id");

CREATE TABLE "command_idempotency" (
  "id" UUID NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "operation_code" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "request_hash" TEXT NOT NULL,
  "response_resource_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "command_idempotency_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "command_idempotency_actor_operation_key"
  ON "command_idempotency"("actor_user_id", "operation_code", "idempotency_key");

ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_manager_user_id_fkey"
  FOREIGN KEY ("manager_user_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "user_permission_overrides" ADD CONSTRAINT "user_permission_overrides_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_permission_overrides" ADD CONSTRAINT "user_permission_overrides_permission_code_fkey"
  FOREIGN KEY ("permission_code") REFERENCES "permissions"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_country_code_fkey"
  FOREIGN KEY ("country_code") REFERENCES "countries"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_hq_country_code_fkey"
  FOREIGN KEY ("hq_country_code") REFERENCES "countries"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_owner_user_id_fkey"
  FOREIGN KEY ("owner_user_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_updated_by_user_id_fkey"
  FOREIGN KEY ("updated_by_user_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_archived_by_user_id_fkey"
  FOREIGN KEY ("archived_by_user_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_shares" ADD CONSTRAINT "customer_shares_account_id_fkey"
  FOREIGN KEY ("account_id") REFERENCES "accounts"("account_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_shares" ADD CONSTRAINT "customer_shares_owner_snapshot_fkey"
  FOREIGN KEY ("owner_user_id_snapshot") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_shares" ADD CONSTRAINT "customer_shares_recipient_user_id_fkey"
  FOREIGN KEY ("recipient_user_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_shares" ADD CONSTRAINT "customer_shares_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_shares" ADD CONSTRAINT "customer_shares_revoked_by_user_id_fkey"
  FOREIGN KEY ("revoked_by_user_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "account_group_memberships" ADD CONSTRAINT "account_group_memberships_account_id_fkey"
  FOREIGN KEY ("account_id") REFERENCES "accounts"("account_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "account_group_memberships" ADD CONSTRAINT "account_group_memberships_group_network_id_fkey"
  FOREIGN KEY ("group_network_id") REFERENCES "group_networks"("group_network_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "account_group_memberships" ADD CONSTRAINT "account_group_memberships_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "command_idempotency" ADD CONSTRAINT "command_idempotency_actor_user_id_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
