CREATE TABLE "app_sessions" (
  "session_id" TEXT NOT NULL,
  "user_id" UUID NOT NULL,
  "status_code" TEXT NOT NULL DEFAULT 'ACTIVE',
  "issued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "revoked_at" TIMESTAMPTZ(6),
  "revoked_by_user_id" UUID,
  CONSTRAINT "app_sessions_pkey" PRIMARY KEY ("session_id"),
  CONSTRAINT "app_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE CASCADE
);

CREATE INDEX "app_sessions_user_status_expiry_idx"
  ON "app_sessions"("user_id", "status_code", "expires_at");
