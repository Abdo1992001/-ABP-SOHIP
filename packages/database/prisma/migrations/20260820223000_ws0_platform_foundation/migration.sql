CREATE SCHEMA IF NOT EXISTS "public";

CREATE TABLE "countries" (
    "code" CHAR(2) NOT NULL,
    "name" TEXT NOT NULL,
    "continent_code" CHAR(2) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "countries_pkey" PRIMARY KEY ("code")
);

CREATE TABLE "app_users" (
    "id" UUID NOT NULL,
    "external_subject" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "policy_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "app_users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "user_country_access" (
    "user_id" UUID NOT NULL,
    "country_code" CHAR(2) NOT NULL,
    "granted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "granted_by" UUID NOT NULL,
    CONSTRAINT "user_country_access_pkey" PRIMARY KEY ("user_id", "country_code")
);

CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "workspace" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "permissions" (
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    CONSTRAINT "permissions_pkey" PRIMARY KEY ("code")
);

CREATE TABLE "role_permissions" (
    "role_id" UUID NOT NULL,
    "permission_code" TEXT NOT NULL,
    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id", "permission_code")
);

CREATE TABLE "user_roles" (
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "granted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("user_id", "role_id")
);

CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_user_id" UUID,
    "actor_session_id" TEXT,
    "action_code" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT,
    "workspace" TEXT NOT NULL,
    "country_code" CHAR(2),
    "before_snapshot" JSONB,
    "after_snapshot" JSONB,
    "metadata" JSONB,
    "trace_id" TEXT NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "audit_events_schema_version_check" CHECK ("schema_version" >= 1)
);

CREATE TABLE "outbox_messages" (
    "id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" TEXT NOT NULL,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "available_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(6),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "lease_owner" TEXT,
    "lease_expires_at" TIMESTAMPTZ(6),
    "last_error_code" TEXT,
    "last_error_message" TEXT,
    "trace_id" TEXT NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "idempotency_key" TEXT,
    CONSTRAINT "outbox_messages_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "outbox_messages_status_check" CHECK ("status" IN ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'DEAD')),
    CONSTRAINT "outbox_messages_attempts_check" CHECK ("attempts" >= 0 AND "max_attempts" >= 1),
    CONSTRAINT "outbox_messages_schema_version_check" CHECK ("schema_version" >= 1)
);

CREATE TABLE "durable_jobs" (
    "id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "payload" JSONB NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "available_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retry_at" TIMESTAMPTZ(6),
    "lease_owner" TEXT,
    "lease_expires_at" TIMESTAMPTZ(6),
    "started_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),
    "result_reference" TEXT,
    "error_code" TEXT,
    "error_message" TEXT,
    "trace_id" TEXT NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "idempotency_key" TEXT,
    "source_type" TEXT,
    "source_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "durable_jobs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "durable_jobs_status_check" CHECK ("status" IN ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'DEAD')),
    CONSTRAINT "durable_jobs_attempts_check" CHECK ("attempt_count" >= 0 AND "max_attempts" >= 1),
    CONSTRAINT "durable_jobs_progress_check" CHECK ("progress" BETWEEN 0 AND 100)
);

CREATE TABLE "platform_proof_runs" (
    "id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "trace_id" TEXT NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),
    CONSTRAINT "platform_proof_runs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "platform_proof_runs_status_check" CHECK ("status" IN ('REQUESTED', 'COMPLETED'))
);

CREATE UNIQUE INDEX "app_users_external_subject_key" ON "app_users"("external_subject");
CREATE INDEX "user_country_access_country_code_idx" ON "user_country_access"("country_code");
CREATE UNIQUE INDEX "roles_code_key" ON "roles"("code");
CREATE INDEX "audit_events_occurred_at_idx" ON "audit_events"("occurred_at");
CREATE INDEX "audit_events_resource_type_resource_id_idx" ON "audit_events"("resource_type", "resource_id");
CREATE INDEX "outbox_messages_status_available_at_idx" ON "outbox_messages"("status", "available_at");
CREATE INDEX "outbox_messages_lease_expires_at_idx" ON "outbox_messages"("lease_expires_at");
CREATE UNIQUE INDEX "outbox_messages_event_type_idempotency_key_key" ON "outbox_messages"("event_type", "idempotency_key");
CREATE INDEX "durable_jobs_status_available_at_idx" ON "durable_jobs"("status", "available_at");
CREATE INDEX "durable_jobs_lease_expires_at_idx" ON "durable_jobs"("lease_expires_at");
CREATE UNIQUE INDEX "durable_jobs_type_idempotency_key_key" ON "durable_jobs"("type", "idempotency_key");

ALTER TABLE "user_country_access" ADD CONSTRAINT "user_country_access_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_country_access" ADD CONSTRAINT "user_country_access_country_code_fkey" FOREIGN KEY ("country_code") REFERENCES "countries"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_code_fkey" FOREIGN KEY ("permission_code") REFERENCES "permissions"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "reject_audit_event_mutation"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'AUDIT_EVENTS_ARE_APPEND_ONLY' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "audit_events_append_only"
BEFORE UPDATE OR DELETE ON "audit_events"
FOR EACH ROW EXECUTE FUNCTION "reject_audit_event_mutation"();

REVOKE UPDATE, DELETE ON TABLE "audit_events" FROM PUBLIC;
