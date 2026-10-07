CREATE TABLE "access_requests" (
  "id" UUID NOT NULL,
  "full_name" TEXT NOT NULL,
  "work_email" TEXT NOT NULL,
  "company_or_role" TEXT,
  "country_code" CHAR(2),
  "message" TEXT,
  "status_code" TEXT NOT NULL DEFAULT 'PENDING',
  "reviewed_by_user_id" UUID,
  "reviewed_at" TIMESTAMPTZ(6),
  "rejection_reason" TEXT,
  "created_user_id" UUID,
  "row_version" BIGINT NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "access_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "access_requests_status_check" CHECK ("status_code" IN ('PENDING', 'APPROVED', 'REJECTED'))
);

CREATE INDEX "access_requests_status_code_created_at_idx" ON "access_requests" ("status_code", "created_at");
