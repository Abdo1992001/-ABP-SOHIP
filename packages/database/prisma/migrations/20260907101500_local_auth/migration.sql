ALTER TABLE "app_users"
  ADD COLUMN "username_normalized" TEXT,
  ADD COLUMN "password_hash" TEXT,
  ADD COLUMN "failed_login_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "locked_until" TIMESTAMPTZ(6),
  ADD COLUMN "password_changed_at" TIMESTAMPTZ(6),
  ADD COLUMN "must_change_password" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "mfa_required" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "mfa_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "mfa_secret_ciphertext" TEXT,
  ADD COLUMN "mfa_secret_iv" TEXT,
  ADD COLUMN "mfa_secret_auth_tag" TEXT,
  ADD COLUMN "mfa_secret_version" INTEGER;

CREATE UNIQUE INDEX "app_users_username_normalized_key" ON "app_users"("username_normalized");

CREATE TABLE "auth_challenges" (
  "challenge_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "token_hash" TEXT NOT NULL,
  "type_code" TEXT NOT NULL DEFAULT 'LOGIN_MFA',
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "consumed_at" TIMESTAMPTZ(6),
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "auth_challenges_pkey" PRIMARY KEY ("challenge_id"),
  CONSTRAINT "auth_challenges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "auth_challenges_token_hash_key" ON "auth_challenges"("token_hash");
CREATE INDEX "auth_challenges_user_id_type_code_expires_at_idx" ON "auth_challenges"("user_id", "type_code", "expires_at");

CREATE TABLE "mfa_recovery_codes" (
  "recovery_code_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "code_hash" TEXT NOT NULL,
  "used_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mfa_recovery_codes_pkey" PRIMARY KEY ("recovery_code_id"),
  CONSTRAINT "mfa_recovery_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "mfa_recovery_codes_user_id_code_hash_key" ON "mfa_recovery_codes"("user_id", "code_hash");
CREATE INDEX "mfa_recovery_codes_user_id_used_at_idx" ON "mfa_recovery_codes"("user_id", "used_at");
