CREATE TABLE "tool_jobs" (
  "id" UUID NOT NULL,
  "tool_type_code" TEXT NOT NULL,
  "requested_by_user_id" UUID NOT NULL,
  "account_id" UUID,
  "project_id" UUID,
  "quotation_id" UUID,
  "input_snapshot" JSONB NOT NULL,
  "input_hash" TEXT NOT NULL,
  "status_code" TEXT NOT NULL DEFAULT 'QUEUED',
  "progress" INTEGER NOT NULL DEFAULT 0,
  "structured_result" JSONB,
  "artifact_document_id" UUID,
  "warnings" JSONB,
  "errors" JSONB,
  "error_message" TEXT,
  "reviewed_by_user_id" UUID,
  "approved_at" TIMESTAMPTZ(6),
  "applied_at" TIMESTAMPTZ(6),
  "started_at" TIMESTAMPTZ(6),
  "completed_at" TIMESTAMPTZ(6),
  "row_version" BIGINT NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "tool_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tool_jobs_status_check" CHECK ("status_code" IN ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'REVIEW_REQUIRED', 'APPLIED')),
  CONSTRAINT "tool_jobs_progress_check" CHECK ("progress" >= 0 AND "progress" <= 100),
  CONSTRAINT "tool_jobs_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "tool_jobs_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("account_id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "tool_jobs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("project_id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "tool_jobs_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "quotations"("quotation_id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "tool_jobs_artifact_document_id_fkey" FOREIGN KEY ("artifact_document_id") REFERENCES "document_metadata"("document_metadata_id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "tool_jobs_tool_type_code_status_code_idx" ON "tool_jobs" ("tool_type_code", "status_code");
CREATE INDEX "tool_jobs_account_id_idx" ON "tool_jobs" ("account_id");
CREATE INDEX "tool_jobs_project_id_idx" ON "tool_jobs" ("project_id");
CREATE INDEX "tool_jobs_quotation_id_idx" ON "tool_jobs" ("quotation_id");
