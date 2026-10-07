ALTER TABLE "app_sessions"
  ADD COLUMN "token_hash" TEXT,
  ADD COLUMN "csrf_token_hash" TEXT,
  ADD COLUMN "privileged" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "policy_version_snapshot" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "auth_time" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "absolute_expires_at" TIMESTAMPTZ(6);

UPDATE "app_sessions" SET "absolute_expires_at" = "expires_at" WHERE "absolute_expires_at" IS NULL;
ALTER TABLE "app_sessions" ALTER COLUMN "absolute_expires_at" SET NOT NULL;
ALTER TABLE "app_sessions" ALTER COLUMN "absolute_expires_at" SET DEFAULT (CURRENT_TIMESTAMP + INTERVAL '12 hours');
CREATE UNIQUE INDEX "app_sessions_token_hash_key" ON "app_sessions"("token_hash");

CREATE TABLE "request_rate_limits" (
  "bucket_key" TEXT NOT NULL,
  "request_count" INTEGER NOT NULL DEFAULT 0,
  "window_start" TIMESTAMPTZ(6) NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "request_rate_limits_pkey" PRIMARY KEY ("bucket_key"),
  CONSTRAINT "request_rate_limits_count_check" CHECK ("request_count" >= 0)
);
CREATE INDEX "request_rate_limits_expiry_idx" ON "request_rate_limits"("expires_at");
