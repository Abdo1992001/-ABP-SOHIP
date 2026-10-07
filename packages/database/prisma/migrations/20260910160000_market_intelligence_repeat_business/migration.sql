CREATE TABLE "market_signals" (
  "market_signal_id" UUID NOT NULL,
  "title" TEXT NOT NULL,
  "source_name" TEXT NOT NULL,
  "source_url" TEXT,
  "published_date" DATE NOT NULL,
  "retrieved_date" DATE NOT NULL,
  "event_date" DATE,
  "evidence" TEXT NOT NULL,
  "evidence_hash" TEXT NOT NULL,
  "verification_code" TEXT NOT NULL DEFAULT 'UNVERIFIED',
  "classification_code" TEXT NOT NULL DEFAULT 'UNVERIFIED',
  "country_code" CHAR(2),
  "summary" TEXT,
  "status_code" TEXT NOT NULL DEFAULT 'ACTIVE',
  "created_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  "row_version" BIGINT NOT NULL DEFAULT 1,
  CONSTRAINT "market_signals_pkey" PRIMARY KEY ("market_signal_id"),
  CONSTRAINT "market_signals_classification_check" CHECK ("classification_code" IN ('FACT', 'FORECAST', 'OPINION', 'UNVERIFIED')),
  CONSTRAINT "market_signals_verification_check" CHECK ("verification_code" IN ('VERIFIED', 'UNVERIFIED', 'REJECTED')),
  CONSTRAINT "market_signals_fact_requires_verification_check" CHECK ("classification_code" <> 'FACT' OR "verification_code" = 'VERIFIED')
);

CREATE TABLE "target_markets" (
  "target_market_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "country_code" CHAR(2) NOT NULL,
  "segment_code" TEXT,
  "rationale" TEXT NOT NULL,
  "priority_score" DECIMAL(6,2),
  "ranking_source" TEXT NOT NULL DEFAULT 'COMMERCIAL_REVIEW',
  "status_code" TEXT NOT NULL DEFAULT 'ACTIVE',
  "created_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  "row_version" BIGINT NOT NULL DEFAULT 1,
  CONSTRAINT "target_markets_pkey" PRIMARY KEY ("target_market_id"),
  CONSTRAINT "target_markets_score_check" CHECK ("priority_score" IS NULL OR ("priority_score" >= 0 AND "priority_score" <= 100))
);

CREATE TABLE "target_accounts" (
  "target_account_id" UUID NOT NULL,
  "company_name" TEXT NOT NULL,
  "normalized_name" TEXT NOT NULL,
  "country_code" CHAR(2) NOT NULL,
  "segment_code" TEXT,
  "website" TEXT,
  "rationale" TEXT NOT NULL,
  "source_signal_id" UUID,
  "owner_user_id" UUID,
  "status_code" TEXT NOT NULL DEFAULT 'PROSPECT',
  "created_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  "row_version" BIGINT NOT NULL DEFAULT 1,
  CONSTRAINT "target_accounts_pkey" PRIMARY KEY ("target_account_id")
);

CREATE TABLE "competitors" (
  "competitor_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "normalized_name" TEXT NOT NULL,
  "country_code" CHAR(2),
  "strengths" TEXT,
  "weaknesses" TEXT,
  "notes" TEXT,
  "status_code" TEXT NOT NULL DEFAULT 'ACTIVE',
  "created_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  "row_version" BIGINT NOT NULL DEFAULT 1,
  CONSTRAINT "competitors_pkey" PRIMARY KEY ("competitor_id")
);

CREATE TABLE "watchlist_entries" (
  "watchlist_entry_id" UUID NOT NULL,
  "resource_type" TEXT NOT NULL,
  "resource_id" UUID NOT NULL,
  "label" TEXT NOT NULL,
  "notes" TEXT,
  "status_code" TEXT NOT NULL DEFAULT 'ACTIVE',
  "created_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "watchlist_entries_pkey" PRIMARY KEY ("watchlist_entry_id"),
  CONSTRAINT "watchlist_entries_resource_type_check" CHECK ("resource_type" IN ('MARKET_SIGNAL', 'TARGET_MARKET', 'TARGET_ACCOUNT', 'COMPETITOR'))
);

CREATE TABLE "repeat_business_requests" (
  "repeat_business_request_id" UUID NOT NULL,
  "account_id" UUID NOT NULL,
  "subject" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "requested_by_user_id" UUID NOT NULL,
  "assigned_owner_user_id" UUID NOT NULL,
  "status_code" TEXT NOT NULL DEFAULT 'SUBMITTED',
  "sales_response" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  "row_version" BIGINT NOT NULL DEFAULT 1,
  CONSTRAINT "repeat_business_requests_pkey" PRIMARY KEY ("repeat_business_request_id"),
  CONSTRAINT "repeat_business_requests_status_check" CHECK ("status_code" IN ('SUBMITTED', 'IN_REVIEW', 'PREPARED', 'CLOSED')),
  CONSTRAINT "repeat_business_requests_account_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("account_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "market_signals_country_classification_published_idx" ON "market_signals"("country_code", "classification_code", "published_date" DESC);
CREATE INDEX "market_signals_evidence_hash_idx" ON "market_signals"("evidence_hash");
CREATE UNIQUE INDEX "target_markets_country_name_key" ON "target_markets"("country_code", "name");
CREATE INDEX "target_markets_status_score_updated_idx" ON "target_markets"("status_code", "priority_score" DESC, "updated_at" DESC);
CREATE UNIQUE INDEX "target_accounts_country_normalized_name_key" ON "target_accounts"("country_code", "normalized_name");
CREATE INDEX "target_accounts_country_status_updated_idx" ON "target_accounts"("country_code", "status_code", "updated_at" DESC);
CREATE UNIQUE INDEX "competitors_normalized_name_country_key" ON "competitors"("normalized_name", "country_code");
CREATE INDEX "competitors_status_updated_idx" ON "competitors"("status_code", "updated_at" DESC);
CREATE UNIQUE INDEX "watchlist_entries_creator_type_resource_key" ON "watchlist_entries"("created_by_user_id", "resource_type", "resource_id");
CREATE INDEX "watchlist_entries_creator_status_updated_idx" ON "watchlist_entries"("created_by_user_id", "status_code", "updated_at" DESC);
CREATE INDEX "repeat_business_requests_account_status_created_idx" ON "repeat_business_requests"("account_id", "status_code", "created_at" DESC);
CREATE INDEX "repeat_business_requests_owner_status_created_idx" ON "repeat_business_requests"("assigned_owner_user_id", "status_code", "created_at" DESC);
