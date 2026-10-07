-- Step 6 physical schema: forward-only, PostgreSQL 17/Azure Flexible Server compatible.
-- No production/MES, shipment, dispatch, delivery, POD, formal revision, personal target, or net-sales objects.

CREATE TABLE continents (code char(2) PRIMARY KEY, name text NOT NULL, active boolean NOT NULL DEFAULT true);
ALTER TABLE countries ADD CONSTRAINT countries_continent_fkey FOREIGN KEY (continent_code) REFERENCES continents(code) ON DELETE RESTRICT NOT VALID;

ALTER TABLE pricing_rules ADD COLUMN version integer NOT NULL DEFAULT 1, ADD COLUMN row_version bigint NOT NULL DEFAULT 1;
ALTER TABLE pricing_rules ADD CONSTRAINT pricing_rules_row_version_check CHECK (row_version > 0);
CREATE TABLE pricing_configurations (
  pricing_configuration_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), discount_approval_pct numeric(5,2) NOT NULL,
  effective_from timestamptz(6) NOT NULL, effective_to timestamptz(6), version integer NOT NULL DEFAULT 1, status_code text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz(6) NOT NULL DEFAULT now(), CHECK (discount_approval_pct BETWEEN 0 AND 100), CHECK (effective_to IS NULL OR effective_to > effective_from)
);
CREATE INDEX pricing_configurations_effective_idx ON pricing_configurations(status_code,effective_from,effective_to);

CREATE TABLE quotation_approvals (
  quotation_approval_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), quotation_id uuid NOT NULL REFERENCES quotations(quotation_id) ON DELETE RESTRICT,
  content_hash text NOT NULL, status_code text NOT NULL, requested_by_user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  requested_at timestamptz(6) NOT NULL DEFAULT now(), decided_by_user_id uuid REFERENCES app_users(id) ON DELETE RESTRICT, decided_at timestamptz(6), reason text, approval_snapshot jsonb,
  CHECK ((status_code IN ('APPROVED','REJECTED') AND decided_at IS NOT NULL AND decided_by_user_id IS NOT NULL) OR status_code = 'PENDING')
);
CREATE INDEX quotation_approvals_pending_idx ON quotation_approvals(status_code,requested_at);
CREATE INDEX quotation_approvals_history_idx ON quotation_approvals(quotation_id,requested_at);
CREATE TABLE document_metadata (
  document_metadata_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), resource_type_code text NOT NULL, resource_id uuid NOT NULL, storage_key text NOT NULL UNIQUE,
  mime_type text NOT NULL, size_bytes bigint NOT NULL, file_hash text NOT NULL, classification_code text NOT NULL, is_final boolean NOT NULL DEFAULT false,
  created_by_user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT, created_at timestamptz(6) NOT NULL DEFAULT now(), CHECK (size_bytes >= 0)
);
CREATE INDEX document_metadata_resource_idx ON document_metadata(resource_type_code,resource_id);
CREATE TABLE official_quotation_documents (
  official_quotation_document_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), quotation_id uuid NOT NULL REFERENCES quotations(quotation_id) ON DELETE RESTRICT,
  document_metadata_id uuid NOT NULL UNIQUE REFERENCES document_metadata(document_metadata_id) ON DELETE RESTRICT, content_hash text NOT NULL,
  template_version text NOT NULL, renderer_version text NOT NULL, generated_at timestamptz(6) NOT NULL DEFAULT now(), is_final boolean NOT NULL DEFAULT true
);
CREATE INDEX official_quotation_documents_history_idx ON official_quotation_documents(quotation_id,generated_at);
CREATE TABLE quotation_send_events (
  quotation_send_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), quotation_id uuid NOT NULL REFERENCES quotations(quotation_id) ON DELETE RESTRICT,
  official_document_id uuid NOT NULL REFERENCES official_quotation_documents(official_quotation_document_id) ON DELETE RESTRICT, recipient text NOT NULL,
  method_code text NOT NULL, actor_user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT, sent_at timestamptz(6) NOT NULL DEFAULT now(), provider_reference text, metadata jsonb
);
CREATE INDEX quotation_send_events_history_idx ON quotation_send_events(quotation_id,sent_at);

CREATE TABLE import_batches (
  import_batch_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_system_code text NOT NULL, source_fingerprint text NOT NULL, schema_fingerprint text,
  status_code text NOT NULL DEFAULT 'RECEIVED', actor_user_id uuid REFERENCES app_users(id) ON DELETE RESTRICT, created_at timestamptz(6) NOT NULL DEFAULT now(), completed_at timestamptz(6),
  UNIQUE(source_system_code,source_fingerprint)
);
CREATE INDEX import_batches_status_created_idx ON import_batches(status_code,created_at);
CREATE TABLE import_rows (
  import_row_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), import_batch_id uuid NOT NULL REFERENCES import_batches(import_batch_id) ON DELETE RESTRICT,
  source_row_key text NOT NULL, source_entity_code text NOT NULL, raw_payload jsonb NOT NULL, payload_hash text NOT NULL, status_code text NOT NULL DEFAULT 'RECEIVED',
  UNIQUE(import_batch_id,source_entity_code,source_row_key)
);
CREATE INDEX import_rows_source_key_idx ON import_rows(source_entity_code,source_row_key);
CREATE TABLE dq_issues (
  dq_issue_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), import_batch_id uuid REFERENCES import_batches(import_batch_id) ON DELETE RESTRICT,
  source_entity_code text NOT NULL, source_record_key text NOT NULL, rule_code text NOT NULL, severity_code text NOT NULL, status_code text NOT NULL DEFAULT 'OPEN',
  resolution text, resolved_by_user_id uuid REFERENCES app_users(id) ON DELETE RESTRICT, resolved_at timestamptz(6), created_at timestamptz(6) NOT NULL DEFAULT now()
);
CREATE INDEX dq_issues_open_idx ON dq_issues(status_code,severity_code,created_at); CREATE INDEX dq_issues_batch_idx ON dq_issues(import_batch_id);
CREATE TABLE reconciliation_runs (
  reconciliation_run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), import_batch_id uuid NOT NULL REFERENCES import_batches(import_batch_id) ON DELETE RESTRICT,
  status_code text NOT NULL DEFAULT 'PENDING', summary jsonb, started_at timestamptz(6) NOT NULL DEFAULT now(), completed_at timestamptz(6)
);
CREATE INDEX reconciliation_runs_batch_idx ON reconciliation_runs(import_batch_id,started_at);
CREATE TABLE erp_orders (
  erp_order_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_system_code text NOT NULL, source_order_key text NOT NULL,
  account_id uuid REFERENCES accounts(account_id) ON DELETE RESTRICT, project_id uuid REFERENCES projects(project_id) ON DELETE RESTRICT,
  import_batch_id uuid NOT NULL REFERENCES import_batches(import_batch_id) ON DELETE RESTRICT, currency_code char(3), status_code text NOT NULL,
  dq_status_code text NOT NULL DEFAULT 'VALID', booked_amount numeric(18,4), shipped_amount numeric(18,4), invoiced_amount numeric(18,4), interfaced_at timestamptz(6),
  row_version bigint NOT NULL DEFAULT 1, imported_at timestamptz(6) NOT NULL DEFAULT now(), UNIQUE(source_system_code,source_order_key), CHECK(row_version > 0)
);
CREATE INDEX erp_orders_account_dq_idx ON erp_orders(account_id,dq_status_code); CREATE INDEX erp_orders_batch_idx ON erp_orders(import_batch_id);
CREATE TABLE erp_order_lines (
  erp_order_line_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), erp_order_id uuid NOT NULL REFERENCES erp_orders(erp_order_id) ON DELETE RESTRICT,
  source_line_key text NOT NULL, product_id uuid REFERENCES products(product_id) ON DELETE RESTRICT, import_row_id uuid REFERENCES import_rows(import_row_id) ON DELETE RESTRICT,
  qty_booked numeric(18,4) NOT NULL DEFAULT 0, qty_shipped numeric(18,4) NOT NULL DEFAULT 0, qty_invoiced numeric(18,4) NOT NULL DEFAULT 0,
  qty_remaining numeric(18,4), dq_status_code text NOT NULL DEFAULT 'VALID', UNIQUE(erp_order_id,source_line_key),
  CHECK(qty_booked>=0 AND qty_shipped>=0 AND qty_invoiced>=0 AND (qty_remaining IS NULL OR qty_remaining>=0))
);
CREATE INDEX erp_order_lines_product_dq_idx ON erp_order_lines(product_id,dq_status_code);

CREATE TABLE capacity_rates (
  capacity_rate_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), category_code text NOT NULL, boards_per_day integer NOT NULL, hours_per_day integer NOT NULL DEFAULT 24,
  effective_from timestamptz(6) NOT NULL, effective_to timestamptz(6), version integer NOT NULL DEFAULT 1, status_code text NOT NULL DEFAULT 'ACTIVE',
  CHECK((category_code='STANDARD' AND boards_per_day=900) OR (category_code='ORDINARY' AND boards_per_day=700) OR (category_code='CURVED' AND boards_per_day=600)),
  CHECK(hours_per_day=24), CHECK(effective_to IS NULL OR effective_to>effective_from)
);
CREATE INDEX capacity_rates_resolution_idx ON capacity_rates(category_code,status_code,effective_from);
CREATE TABLE capacity_estimates (
  capacity_estimate_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_type_code text NOT NULL, source_id uuid NOT NULL, category_code text NOT NULL,
  requested_boards numeric(18,4) NOT NULL, estimated_days numeric(18,4) NOT NULL, capacity_rate_id uuid NOT NULL REFERENCES capacity_rates(capacity_rate_id) ON DELETE RESTRICT,
  calculated_at timestamptz(6) NOT NULL DEFAULT now(), CHECK(requested_boards>=0 AND estimated_days>=0)
);
CREATE INDEX capacity_estimates_source_idx ON capacity_estimates(source_type_code,source_id);
CREATE TABLE logistics_plans (
  logistics_plan_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_type_code text NOT NULL, source_id uuid NOT NULL, country_code char(2) NOT NULL REFERENCES countries(code) ON DELETE RESTRICT,
  status_code text NOT NULL DEFAULT 'DRAFT', row_version bigint NOT NULL DEFAULT 1, created_by_user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  created_at timestamptz(6) NOT NULL DEFAULT now(), CHECK(row_version>0)
);
CREATE INDEX logistics_plans_scope_idx ON logistics_plans(country_code,status_code); CREATE INDEX logistics_plans_source_idx ON logistics_plans(source_type_code,source_id);
CREATE TABLE logistics_plan_versions (
  logistics_plan_version_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), logistics_plan_id uuid NOT NULL REFERENCES logistics_plans(logistics_plan_id) ON DELETE RESTRICT,
  version_no integer NOT NULL, vehicle_profile jsonb, created_at timestamptz(6) NOT NULL DEFAULT now(), UNIQUE(logistics_plan_id,version_no), CHECK(version_no>0)
);
CREATE TABLE logistics_placements (
  logistics_placement_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), logistics_plan_version_id uuid NOT NULL REFERENCES logistics_plan_versions(logistics_plan_version_id) ON DELETE RESTRICT,
  demand_source_type_code text NOT NULL, demand_source_id uuid NOT NULL, x numeric(18,4) NOT NULL, y numeric(18,4) NOT NULL, z numeric(18,4) NOT NULL,
  length numeric(18,4) NOT NULL, width numeric(18,4) NOT NULL, height numeric(18,4) NOT NULL, rotation_deg integer NOT NULL, stack_order integer NOT NULL,
  CHECK(rotation_deg IN(0,90)), CHECK(length>0 AND width>0 AND height>0)
);
CREATE INDEX logistics_placements_version_stack_idx ON logistics_placements(logistics_plan_version_id,stack_order);

CREATE TABLE fx_rates (
  fx_rate_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), base_currency_code char(3) NOT NULL, quote_currency_code char(3) NOT NULL, rate numeric(24,12) NOT NULL,
  effective_from timestamptz(6) NOT NULL, effective_to timestamptz(6), version integer NOT NULL DEFAULT 1, source_code text NOT NULL, status_code text NOT NULL DEFAULT 'ACTIVE',
  row_version bigint NOT NULL DEFAULT 1, CHECK(base_currency_code<>quote_currency_code), CHECK(rate>0), CHECK(effective_to IS NULL OR effective_to>effective_from), CHECK(row_version>0)
);
CREATE INDEX fx_rates_resolution_idx ON fx_rates(base_currency_code,quote_currency_code,status_code,effective_from);
CREATE TABLE payments (
  payment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_system_code text NOT NULL, source_payment_key text NOT NULL,
  account_id uuid REFERENCES accounts(account_id) ON DELETE RESTRICT, erp_order_id uuid REFERENCES erp_orders(erp_order_id) ON DELETE RESTRICT,
  amount numeric(18,4) NOT NULL, currency_code char(3) NOT NULL, status_code text NOT NULL, imported_at timestamptz(6) NOT NULL DEFAULT now(),
  UNIQUE(source_system_code,source_payment_key), CHECK(amount>=0)
);
CREATE INDEX payments_account_status_idx ON payments(account_id,status_code);
CREATE TABLE cheques (
  cheque_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_system_code text NOT NULL, source_cheque_key text NOT NULL,
  payment_id uuid REFERENCES payments(payment_id) ON DELETE RESTRICT, account_id uuid REFERENCES accounts(account_id) ON DELETE RESTRICT, cheque_number text,
  amount numeric(18,4) NOT NULL, currency_code char(3) NOT NULL, due_on date, status_code text NOT NULL, UNIQUE(source_system_code,source_cheque_key), CHECK(amount>=0)
);
CREATE INDEX cheques_account_status_due_idx ON cheques(account_id,status_code,due_on);
CREATE TABLE returned_scrap_requests (
  returned_scrap_request_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL REFERENCES accounts(account_id) ON DELETE RESTRICT,
  status_code text NOT NULL DEFAULT 'PENDING', benefit_type_code text NOT NULL, requested_by_user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  requested_at timestamptz(6) NOT NULL DEFAULT now(), approved_by_user_id uuid REFERENCES app_users(id) ON DELETE RESTRICT, approved_at timestamptz(6), row_version bigint NOT NULL DEFAULT 1,
  CHECK(benefit_type_code IN('CREDIT','REPLACEMENT')), CHECK(status_code<>'APPROVED' OR (approved_by_user_id IS NOT NULL AND approved_at IS NOT NULL)), CHECK(row_version>0)
);
CREATE INDEX returned_scrap_requests_account_status_idx ON returned_scrap_requests(account_id,status_code);
CREATE TABLE returned_scrap_items (
  returned_scrap_item_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), returned_scrap_request_id uuid NOT NULL REFERENCES returned_scrap_requests(returned_scrap_request_id) ON DELETE RESTRICT,
  original_quotation_line_id uuid NOT NULL REFERENCES quotation_lines(quotation_line_id) ON DELETE RESTRICT, eligible_returned_qty numeric(18,4) NOT NULL,
  original_purchase_unit_price numeric(18,4) NOT NULL, benefit_rate numeric(5,4) NOT NULL DEFAULT 0.25, benefit_amount numeric(18,4) NOT NULL, benefit_type_code text NOT NULL,
  CHECK(eligible_returned_qty>0 AND original_purchase_unit_price>=0 AND benefit_rate=0.25 AND benefit_amount>=0 AND benefit_type_code IN('CREDIT','REPLACEMENT'))
);
CREATE INDEX returned_scrap_items_original_line_idx ON returned_scrap_items(original_quotation_line_id);
CREATE TABLE company_targets (
  company_target_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), period_start date NOT NULL, period_end date NOT NULL, amount_usd numeric(18,4) NOT NULL,
  version integer NOT NULL DEFAULT 1, status_code text NOT NULL DEFAULT 'ACTIVE', effective_from timestamptz(6) NOT NULL, effective_to timestamptz(6),
  UNIQUE(period_start,period_end,version), CHECK(period_end>=period_start AND amount_usd>=0 AND (effective_to IS NULL OR effective_to>effective_from))
);
CREATE TABLE target_allocations (
  target_allocation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_target_id uuid NOT NULL REFERENCES company_targets(company_target_id) ON DELETE RESTRICT,
  allocation_type_code text NOT NULL, period_start date NOT NULL, period_end date NOT NULL, amount_usd numeric(18,4) NOT NULL,
  UNIQUE(company_target_id,allocation_type_code,period_start), CHECK(period_end>=period_start AND amount_usd>=0)
);

CREATE FUNCTION reject_pricing_rule_overlap() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status_code='ACTIVE' AND EXISTS (SELECT 1 FROM pricing_rules p WHERE p.pricing_rule_id<>NEW.pricing_rule_id AND p.status_code='ACTIVE' AND p.product_id=NEW.product_id AND p.currency_code=NEW.currency_code AND p.country_code IS NOT DISTINCT FROM NEW.country_code AND tstzrange(p.effective_from,p.effective_to,'[)') && tstzrange(NEW.effective_from,NEW.effective_to,'[)')) THEN RAISE EXCEPTION 'PRICING_RULE_EFFECTIVE_RANGE_OVERLAP' USING ERRCODE='23P01'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER pricing_rules_no_overlap BEFORE INSERT OR UPDATE ON pricing_rules FOR EACH ROW EXECUTE FUNCTION reject_pricing_rule_overlap();
CREATE FUNCTION reject_fx_rate_overlap() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status_code='ACTIVE' AND EXISTS (SELECT 1 FROM fx_rates f WHERE f.fx_rate_id<>NEW.fx_rate_id AND f.status_code='ACTIVE' AND f.base_currency_code=NEW.base_currency_code AND f.quote_currency_code=NEW.quote_currency_code AND tstzrange(f.effective_from,f.effective_to,'[)') && tstzrange(NEW.effective_from,NEW.effective_to,'[)')) THEN RAISE EXCEPTION 'FX_RATE_EFFECTIVE_RANGE_OVERLAP' USING ERRCODE='23P01'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER fx_rates_no_overlap BEFORE INSERT OR UPDATE ON fx_rates FOR EACH ROW EXECUTE FUNCTION reject_fx_rate_overlap();
CREATE FUNCTION reject_sent_quotation_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status_code='SENT' AND (NEW.account_id,NEW.opportunity_id,NEW.project_id,NEW.country_code,NEW.currency_code,NEW.payment_terms_snapshot,NEW.fx_rate_id,NEW.fx_rate_snapshot,NEW.valid_from,NEW.expires_on,NEW.subtotal_amount,NEW.adjustment_amount,NEW.tax_amount,NEW.total_amount,NEW.content_hash) IS DISTINCT FROM (OLD.account_id,OLD.opportunity_id,OLD.project_id,OLD.country_code,OLD.currency_code,OLD.payment_terms_snapshot,OLD.fx_rate_id,OLD.fx_rate_snapshot,OLD.valid_from,OLD.expires_on,OLD.subtotal_amount,OLD.adjustment_amount,OLD.tax_amount,OLD.total_amount,OLD.content_hash) THEN RAISE EXCEPTION 'SENT_QUOTATION_IS_IMMUTABLE' USING ERRCODE='55000'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER quotations_sent_immutable BEFORE UPDATE ON quotations FOR EACH ROW EXECUTE FUNCTION reject_sent_quotation_mutation();
CREATE FUNCTION reject_sent_quotation_child_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE qid uuid; BEGIN qid:=COALESCE(NEW.quotation_id,OLD.quotation_id); IF EXISTS(SELECT 1 FROM quotations WHERE quotation_id=qid AND status_code='SENT') THEN RAISE EXCEPTION 'SENT_QUOTATION_CONTENT_IS_IMMUTABLE' USING ERRCODE='55000'; END IF; RETURN COALESCE(NEW,OLD); END; $$;
CREATE TRIGGER quotation_lines_sent_immutable BEFORE UPDATE OR DELETE ON quotation_lines FOR EACH ROW EXECUTE FUNCTION reject_sent_quotation_child_mutation();
CREATE TRIGGER quotation_adjustments_sent_immutable BEFORE UPDATE OR DELETE ON quotation_adjustments FOR EACH ROW EXECUTE FUNCTION reject_sent_quotation_child_mutation();
CREATE FUNCTION reject_final_document_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.is_final THEN RAISE EXCEPTION 'FINAL_DOCUMENT_IS_IMMUTABLE' USING ERRCODE='55000'; END IF; RETURN NEW; END; $$;
CREATE TRIGGER official_quotation_documents_final_immutable BEFORE UPDATE OR DELETE ON official_quotation_documents FOR EACH ROW EXECUTE FUNCTION reject_final_document_mutation();

