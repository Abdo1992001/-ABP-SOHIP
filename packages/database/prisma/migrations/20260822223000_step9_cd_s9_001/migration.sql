CREATE TABLE "document_versions" (
  "document_version_id" UUID PRIMARY KEY,
  "document_id" UUID NOT NULL REFERENCES "document_metadata"("document_metadata_id") ON DELETE RESTRICT,
  "version_no" INTEGER NOT NULL,
  "storage_key" TEXT NOT NULL UNIQUE,
  "mime_type" TEXT NOT NULL,
  "size_bytes" BIGINT NOT NULL,
  "content_hash" TEXT NOT NULL,
  "source_type_code" TEXT NOT NULL,
  "created_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "template_version_id" UUID,
  "renderer_version" TEXT,
  "immutable" BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT "document_versions_document_id_version_no_key" UNIQUE ("document_id", "version_no")
);

CREATE INDEX "document_versions_document_id_created_at_idx"
  ON "document_versions"("document_id", "created_at");

INSERT INTO "document_versions" (
  "document_version_id", "document_id", "version_no", "storage_key", "mime_type",
  "size_bytes", "content_hash", "source_type_code", "created_by_user_id", "created_at", "immutable"
)
SELECT gen_random_uuid(), "document_metadata_id", 1, "storage_key", "mime_type",
  "size_bytes", "file_hash", CASE WHEN "is_final" THEN 'GENERATED_OFFICIAL' ELSE 'UPLOADED' END,
  "created_by_user_id", "created_at", TRUE
FROM "document_metadata";

CREATE TABLE "document_templates" (
  "document_template_id" UUID PRIMARY KEY,
  "code" TEXT NOT NULL UNIQUE,
  "name" TEXT NOT NULL,
  "document_type_code" TEXT NOT NULL,
  "language_code" VARCHAR(10) NOT NULL,
  "brand_code" VARCHAR(50) NOT NULL,
  "status_code" TEXT NOT NULL DEFAULT 'ACTIVE',
  "row_version" BIGINT NOT NULL DEFAULT 1,
  "created_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "document_templates_document_type_code_language_code_brand_code_status_code_idx"
  ON "document_templates"("document_type_code", "language_code", "brand_code", "status_code");

CREATE TABLE "document_template_versions" (
  "document_template_version_id" UUID PRIMARY KEY,
  "template_id" UUID NOT NULL REFERENCES "document_templates"("document_template_id") ON DELETE RESTRICT,
  "version_no" INTEGER NOT NULL,
  "status_code" TEXT NOT NULL DEFAULT 'DRAFT',
  "content" TEXT NOT NULL,
  "content_hash" TEXT NOT NULL,
  "language_code" VARCHAR(10) NOT NULL,
  "brand_code" VARCHAR(50) NOT NULL,
  "created_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "activated_by_user_id" UUID,
  "activated_at" TIMESTAMPTZ(6),
  "archived_by_user_id" UUID,
  "archived_at" TIMESTAMPTZ(6),
  "row_version" BIGINT NOT NULL DEFAULT 1,
  CONSTRAINT "document_template_versions_template_id_version_no_key" UNIQUE ("template_id", "version_no")
);

CREATE INDEX "document_template_versions_template_id_status_code_version_no_idx"
  ON "document_template_versions"("template_id", "status_code", "version_no");
