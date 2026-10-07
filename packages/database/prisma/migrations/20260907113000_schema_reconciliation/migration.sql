-- DropForeignKey
ALTER TABLE "activities" DROP CONSTRAINT "activities_account_id_fkey";

-- DropForeignKey
ALTER TABLE "activities" DROP CONSTRAINT "activities_country_code_fkey";

-- DropForeignKey
ALTER TABLE "activities" DROP CONSTRAINT "activities_owner_user_id_fkey";

-- DropForeignKey
ALTER TABLE "activity_history" DROP CONSTRAINT "activity_history_activity_id_fkey";

-- DropForeignKey
ALTER TABLE "activity_history" DROP CONSTRAINT "activity_history_actor_user_id_fkey";

-- DropForeignKey
ALTER TABLE "activity_links" DROP CONSTRAINT "activity_links_activity_id_fkey";

-- DropForeignKey
ALTER TABLE "activity_reminders" DROP CONSTRAINT "activity_reminders_activity_id_fkey";

-- DropForeignKey
ALTER TABLE "app_sessions" DROP CONSTRAINT "app_sessions_user_id_fkey";

-- DropForeignKey
ALTER TABLE "capacity_estimates" DROP CONSTRAINT "capacity_estimates_capacity_rate_id_fkey";

-- DropForeignKey
ALTER TABLE "capacity_estimates" DROP CONSTRAINT "capacity_estimates_run_fkey";

-- DropForeignKey
ALTER TABLE "cheques" DROP CONSTRAINT "cheques_account_id_fkey";

-- DropForeignKey
ALTER TABLE "cheques" DROP CONSTRAINT "cheques_created_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "cheques" DROP CONSTRAINT "cheques_payment_id_fkey";

-- DropForeignKey
ALTER TABLE "client_customer_bindings" DROP CONSTRAINT "client_customer_bindings_account_id_fkey";

-- DropForeignKey
ALTER TABLE "client_customer_bindings" DROP CONSTRAINT "client_customer_bindings_created_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "client_customer_bindings" DROP CONSTRAINT "client_customer_bindings_external_client_identity_id_fkey";

-- DropForeignKey
ALTER TABLE "client_customer_bindings" DROP CONSTRAINT "client_customer_bindings_revoked_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "company_targets" DROP CONSTRAINT "company_targets_created_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "complaints" DROP CONSTRAINT "complaints_account_id_fkey";

-- DropForeignKey
ALTER TABLE "complaints" DROP CONSTRAINT "complaints_product_fk";

-- DropForeignKey
ALTER TABLE "contact_channels" DROP CONSTRAINT "contact_channels_contact_id_fkey";

-- DropForeignKey
ALTER TABLE "contact_channels" DROP CONSTRAINT "contact_channels_created_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "contact_share_items" DROP CONSTRAINT "contact_share_items_contact_id_fkey";

-- DropForeignKey
ALTER TABLE "contact_share_items" DROP CONSTRAINT "contact_share_items_contact_share_id_fkey";

-- DropForeignKey
ALTER TABLE "contact_shares" DROP CONSTRAINT "contact_shares_account_id_fkey";

-- DropForeignKey
ALTER TABLE "contact_shares" DROP CONSTRAINT "contact_shares_created_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "contact_shares" DROP CONSTRAINT "contact_shares_recipient_user_id_fkey";

-- DropForeignKey
ALTER TABLE "contact_shares" DROP CONSTRAINT "contact_shares_revoked_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "contacts" DROP CONSTRAINT "contacts_account_id_fkey";

-- DropForeignKey
ALTER TABLE "contacts" DROP CONSTRAINT "contacts_created_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "contacts" DROP CONSTRAINT "contacts_updated_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "countries" DROP CONSTRAINT "countries_continent_fkey";

-- DropForeignKey
ALTER TABLE "customer_segment_assignments" DROP CONSTRAINT "customer_segment_assignments_account_id_fkey";

-- DropForeignKey
ALTER TABLE "customer_segment_assignments" DROP CONSTRAINT "customer_segment_assignments_created_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "customer_segment_assignments" DROP CONSTRAINT "customer_segment_assignments_customer_segment_id_fkey";

-- DropForeignKey
ALTER TABLE "customer_segment_definitions" DROP CONSTRAINT "customer_segment_definitions_archived_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "customer_segment_definitions" DROP CONSTRAINT "customer_segment_definitions_created_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "document_metadata" DROP CONSTRAINT "document_metadata_created_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "document_template_versions" DROP CONSTRAINT "document_template_versions_template_id_fkey";

-- DropForeignKey
ALTER TABLE "document_versions" DROP CONSTRAINT "document_versions_document_id_fkey";

-- DropForeignKey
ALTER TABLE "dq_issues" DROP CONSTRAINT "dq_issues_import_batch_id_fkey";

-- DropForeignKey
ALTER TABLE "dq_issues" DROP CONSTRAINT "dq_issues_resolved_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "erp_order_lines" DROP CONSTRAINT "erp_order_lines_erp_order_id_fkey";

-- DropForeignKey
ALTER TABLE "erp_order_lines" DROP CONSTRAINT "erp_order_lines_import_row_id_fkey";

-- DropForeignKey
ALTER TABLE "erp_order_lines" DROP CONSTRAINT "erp_order_lines_product_id_fkey";

-- DropForeignKey
ALTER TABLE "erp_orders" DROP CONSTRAINT "erp_orders_account_id_fkey";

-- DropForeignKey
ALTER TABLE "erp_orders" DROP CONSTRAINT "erp_orders_import_batch_id_fkey";

-- DropForeignKey
ALTER TABLE "erp_orders" DROP CONSTRAINT "erp_orders_project_id_fkey";

-- DropForeignKey
ALTER TABLE "external_client_identities" DROP CONSTRAINT "external_client_identities_provisioned_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "fx_rates" DROP CONSTRAINT "fx_rates_changed_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "fx_rates" DROP CONSTRAINT "fx_rates_supersedes_fx_rate_id_fkey";

-- DropForeignKey
ALTER TABLE "geography_classification_rules" DROP CONSTRAINT "geography_classification_rules_country_code_fkey";

-- DropForeignKey
ALTER TABLE "import_batches" DROP CONSTRAINT "import_batches_actor_user_id_fkey";

-- DropForeignKey
ALTER TABLE "import_rows" DROP CONSTRAINT "import_rows_import_batch_id_fkey";

-- DropForeignKey
ALTER TABLE "logistics_exports" DROP CONSTRAINT "logistics_exports_plan_version_id_fkey";

-- DropForeignKey
ALTER TABLE "logistics_optimizer_runs" DROP CONSTRAINT "logistics_optimizer_runs_plan_version_id_fkey";

-- DropForeignKey
ALTER TABLE "logistics_placements" DROP CONSTRAINT "logistics_placements_logistics_plan_version_id_fkey";

-- DropForeignKey
ALTER TABLE "logistics_placements" DROP CONSTRAINT "logistics_placements_plan_line_id_fkey";

-- DropForeignKey
ALTER TABLE "logistics_placements" DROP CONSTRAINT "logistics_placements_plan_transport_unit_id_fkey";

-- DropForeignKey
ALTER TABLE "logistics_plan_lines" DROP CONSTRAINT "logistics_plan_lines_plan_version_id_fkey";

-- DropForeignKey
ALTER TABLE "logistics_plan_transport_units" DROP CONSTRAINT "logistics_plan_transport_units_plan_version_id_fkey";

-- DropForeignKey
ALTER TABLE "logistics_plan_versions" DROP CONSTRAINT "logistics_plan_versions_logistics_plan_id_fkey";

-- DropForeignKey
ALTER TABLE "logistics_plans" DROP CONSTRAINT "logistics_plans_country_code_fkey";

-- DropForeignKey
ALTER TABLE "logistics_plans" DROP CONSTRAINT "logistics_plans_created_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "logistics_validation_results" DROP CONSTRAINT "logistics_validation_results_plan_version_id_fkey";

-- DropForeignKey
ALTER TABLE "official_quotation_documents" DROP CONSTRAINT "official_quotation_documents_document_metadata_id_fkey";

-- DropForeignKey
ALTER TABLE "official_quotation_documents" DROP CONSTRAINT "official_quotation_documents_quotation_id_fkey";

-- DropForeignKey
ALTER TABLE "opportunities" DROP CONSTRAINT "opportunities_account_id_fkey";

-- DropForeignKey
ALTER TABLE "opportunities" DROP CONSTRAINT "opportunities_country_code_fkey";

-- DropForeignKey
ALTER TABLE "opportunities" DROP CONSTRAINT "opportunities_created_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "opportunities" DROP CONSTRAINT "opportunities_owner_user_id_fkey";

-- DropForeignKey
ALTER TABLE "opportunities" DROP CONSTRAINT "opportunities_project_id_fkey";

-- DropForeignKey
ALTER TABLE "opportunities" DROP CONSTRAINT "opportunities_updated_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "opportunity_probability_overrides" DROP CONSTRAINT "opportunity_probability_overrides_created_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "opportunity_probability_overrides" DROP CONSTRAINT "opportunity_probability_overrides_opportunity_id_fkey";

-- DropForeignKey
ALTER TABLE "opportunity_stage_transitions" DROP CONSTRAINT "opportunity_stage_transitions_actor_user_id_fkey";

-- DropForeignKey
ALTER TABLE "opportunity_stage_transitions" DROP CONSTRAINT "opportunity_stage_transitions_opportunity_id_fkey";

-- DropForeignKey
ALTER TABLE "opportunity_won_snapshots" DROP CONSTRAINT "opportunity_won_snapshots_opportunity_id_fkey";

-- DropForeignKey
ALTER TABLE "opportunity_won_snapshots" DROP CONSTRAINT "opportunity_won_snapshots_stage_transition_id_fkey";

-- DropForeignKey
ALTER TABLE "payment_allocations" DROP CONSTRAINT "payment_allocations_created_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "payment_allocations" DROP CONSTRAINT "payment_allocations_payment_id_fkey";

-- DropForeignKey
ALTER TABLE "payment_allocations" DROP CONSTRAINT "payment_allocations_sales_order_id_fkey";

-- DropForeignKey
ALTER TABLE "payment_terms" DROP CONSTRAINT "payment_terms_created_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "payments" DROP CONSTRAINT "payments_account_id_fkey";

-- DropForeignKey
ALTER TABLE "payments" DROP CONSTRAINT "payments_correction_of_payment_id_fkey";

-- DropForeignKey
ALTER TABLE "payments" DROP CONSTRAINT "payments_created_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "payments" DROP CONSTRAINT "payments_erp_order_id_fkey";

-- DropForeignKey
ALTER TABLE "payments" DROP CONSTRAINT "payments_voided_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "price_overrides" DROP CONSTRAINT "price_overrides_approved_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "price_overrides" DROP CONSTRAINT "price_overrides_quotation_id_fkey";

-- DropForeignKey
ALTER TABLE "price_overrides" DROP CONSTRAINT "price_overrides_quotation_line_id_fkey";

-- DropForeignKey
ALTER TABLE "price_overrides" DROP CONSTRAINT "price_overrides_requested_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "pricing_base_configs" DROP CONSTRAINT "pricing_base_configs_created_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "pricing_guardrails" DROP CONSTRAINT "pricing_guardrails_created_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "pricing_guardrails" DROP CONSTRAINT "pricing_guardrails_product_family_id_fkey";

-- DropForeignKey
ALTER TABLE "pricing_guardrails" DROP CONSTRAINT "pricing_guardrails_product_id_fkey";

-- DropForeignKey
ALTER TABLE "pricing_rules" DROP CONSTRAINT "pricing_rules_product_id_fkey";

-- DropForeignKey
ALTER TABLE "products" DROP CONSTRAINT "products_archived_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "products" DROP CONSTRAINT "products_created_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "products" DROP CONSTRAINT "products_product_family_id_fkey";

-- DropForeignKey
ALTER TABLE "products" DROP CONSTRAINT "products_updated_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "project_contact_roles" DROP CONSTRAINT "project_contact_roles_contact_id_fkey";

-- DropForeignKey
ALTER TABLE "project_contact_roles" DROP CONSTRAINT "project_contact_roles_project_party_id_fkey";

-- DropForeignKey
ALTER TABLE "project_parties" DROP CONSTRAINT "project_parties_account_fkey";

-- DropForeignKey
ALTER TABLE "project_parties" DROP CONSTRAINT "project_parties_project_fkey";

-- DropForeignKey
ALTER TABLE "project_work_references" DROP CONSTRAINT "project_work_references_project_fkey";

-- DropForeignKey
ALTER TABLE "projects" DROP CONSTRAINT "projects_archived_by_fkey";

-- DropForeignKey
ALTER TABLE "projects" DROP CONSTRAINT "projects_country_fkey";

-- DropForeignKey
ALTER TABLE "projects" DROP CONSTRAINT "projects_created_by_fkey";

-- DropForeignKey
ALTER TABLE "projects" DROP CONSTRAINT "projects_owner_fkey";

-- DropForeignKey
ALTER TABLE "projects" DROP CONSTRAINT "projects_updated_by_fkey";

-- DropForeignKey
ALTER TABLE "quotation_acceptances" DROP CONSTRAINT "quotation_acceptances_quotation_id_fkey";

-- DropForeignKey
ALTER TABLE "quotation_adjustments" DROP CONSTRAINT "quotation_adjustments_quotation_id_fkey";

-- DropForeignKey
ALTER TABLE "quotation_approvals" DROP CONSTRAINT "quotation_approvals_decided_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "quotation_approvals" DROP CONSTRAINT "quotation_approvals_quotation_fk";

-- DropForeignKey
ALTER TABLE "quotation_approvals" DROP CONSTRAINT "quotation_approvals_quotation_id_fkey";

-- DropForeignKey
ALTER TABLE "quotation_approvals" DROP CONSTRAINT "quotation_approvals_requested_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "quotation_commercial_state_events" DROP CONSTRAINT "quotation_commercial_state_events_actor_user_id_fkey";

-- DropForeignKey
ALTER TABLE "quotation_commercial_state_events" DROP CONSTRAINT "quotation_commercial_state_events_quotation_id_fkey";

-- DropForeignKey
ALTER TABLE "quotation_lines" DROP CONSTRAINT "quotation_lines_price_rule_id_fkey";

-- DropForeignKey
ALTER TABLE "quotation_lines" DROP CONSTRAINT "quotation_lines_product_id_fkey";

-- DropForeignKey
ALTER TABLE "quotation_lines" DROP CONSTRAINT "quotation_lines_quotation_id_fkey";

-- DropForeignKey
ALTER TABLE "quotation_send_events" DROP CONSTRAINT "quotation_send_events_actor_user_id_fkey";

-- DropForeignKey
ALTER TABLE "quotation_send_events" DROP CONSTRAINT "quotation_send_events_official_document_id_fkey";

-- DropForeignKey
ALTER TABLE "quotation_send_events" DROP CONSTRAINT "quotation_send_events_quotation_id_fkey";

-- DropForeignKey
ALTER TABLE "quotations" DROP CONSTRAINT "quotations_account_id_fkey";

-- DropForeignKey
ALTER TABLE "quotations" DROP CONSTRAINT "quotations_country_code_fkey";

-- DropForeignKey
ALTER TABLE "quotations" DROP CONSTRAINT "quotations_created_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "quotations" DROP CONSTRAINT "quotations_opportunity_id_fkey";

-- DropForeignKey
ALTER TABLE "quotations" DROP CONSTRAINT "quotations_owner_user_id_fkey";

-- DropForeignKey
ALTER TABLE "quotations" DROP CONSTRAINT "quotations_project_id_fkey";

-- DropForeignKey
ALTER TABLE "quotations" DROP CONSTRAINT "quotations_supersedes_quotation_id_fkey";

-- DropForeignKey
ALTER TABLE "quotations" DROP CONSTRAINT "quotations_updated_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "reconciliation_runs" DROP CONSTRAINT "reconciliation_runs_import_batch_id_fkey";

-- DropForeignKey
ALTER TABLE "returned_scrap_items" DROP CONSTRAINT "returned_scrap_items_original_quotation_line_id_fkey";

-- DropForeignKey
ALTER TABLE "returned_scrap_items" DROP CONSTRAINT "returned_scrap_items_product_id_fkey";

-- DropForeignKey
ALTER TABLE "returned_scrap_items" DROP CONSTRAINT "returned_scrap_items_returned_scrap_request_id_fkey";

-- DropForeignKey
ALTER TABLE "returned_scrap_requests" DROP CONSTRAINT "returned_scrap_requests_account_id_fkey";

-- DropForeignKey
ALTER TABLE "returned_scrap_requests" DROP CONSTRAINT "returned_scrap_requests_approved_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "returned_scrap_requests" DROP CONSTRAINT "returned_scrap_requests_country_code_fkey";

-- DropForeignKey
ALTER TABLE "returned_scrap_requests" DROP CONSTRAINT "returned_scrap_requests_finalized_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "returned_scrap_requests" DROP CONSTRAINT "returned_scrap_requests_original_quotation_id_fkey";

-- DropForeignKey
ALTER TABLE "returned_scrap_requests" DROP CONSTRAINT "returned_scrap_requests_policy_id_fkey";

-- DropForeignKey
ALTER TABLE "returned_scrap_requests" DROP CONSTRAINT "returned_scrap_requests_rejected_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "returned_scrap_requests" DROP CONSTRAINT "returned_scrap_requests_requested_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "shipment_milestone_events" DROP CONSTRAINT "shipment_milestone_events_actor_user_id_fkey";

-- DropForeignKey
ALTER TABLE "shipment_milestone_events" DROP CONSTRAINT "shipment_milestone_events_shipment_id_fkey";

-- DropForeignKey
ALTER TABLE "shipments" DROP CONSTRAINT "shipments_country_code_fkey";

-- DropForeignKey
ALTER TABLE "shipments" DROP CONSTRAINT "shipments_created_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "shipments" DROP CONSTRAINT "shipments_erp_order_id_fkey";

-- DropForeignKey
ALTER TABLE "shipments" DROP CONSTRAINT "shipments_updated_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "target_allocations" DROP CONSTRAINT "target_allocations_company_target_id_fkey";

-- DropForeignKey
ALTER TABLE "target_allocations" DROP CONSTRAINT "target_allocations_created_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "tax_policies" DROP CONSTRAINT "tax_policies_created_by_user_id_fkey";

-- DropIndex
DROP INDEX "capacity_estimates_source_idx";

-- DropIndex
DROP INDEX "capacity_rates_resolution_idx";

-- DropIndex
DROP INDEX "cheques_account_status_due_idx";

-- DropIndex
DROP INDEX "company_targets_year_version_idx";

-- DropIndex
DROP INDEX "complaints_product_created_idx";

-- DropIndex
DROP INDEX "dq_issues_batch_idx";

-- DropIndex
DROP INDEX "dq_issues_import_status_idx";

-- DropIndex
DROP INDEX "dq_issues_open_idx";

-- DropIndex
DROP INDEX "erp_order_lines_product_dq_idx";

-- DropIndex
DROP INDEX "erp_orders_account_dq_idx";

-- DropIndex
DROP INDEX "erp_orders_batch_idx";

-- DropIndex
DROP INDEX "erp_orders_pending_sync_idx";

-- DropIndex
DROP INDEX "fx_rates_one_effective_version_idx";

-- DropIndex
DROP INDEX "fx_rates_resolution_idx";

-- DropIndex
DROP INDEX "import_batches_status_created_idx";

-- DropIndex
DROP INDEX "import_rows_source_key_idx";

-- DropIndex
DROP INDEX "logistics_placements_version_stack_idx";

-- DropIndex
DROP INDEX "logistics_plans_scope_idx";

-- DropIndex
DROP INDEX "logistics_plans_source_idx";

-- DropIndex
DROP INDEX "payment_terms_active_idx";

-- DropIndex
DROP INDEX "payments_account_status_idx";

-- DropIndex
DROP INDEX "pricing_base_configs_effective_idx";

-- DropIndex
DROP INDEX "pricing_configurations_effective_idx";

-- DropIndex
DROP INDEX "pricing_guardrails_resolution_idx";

-- DropIndex
DROP INDEX "reconciliation_runs_batch_idx";

-- DropIndex
DROP INDEX "returned_scrap_items_original_line_idx";

-- DropIndex
DROP INDEX "returned_scrap_requests_account_status_idx";

-- DropIndex
DROP INDEX "returned_scrap_requests_scope_idx";

-- Drop the legacy three-column uniqueness constraint. PostgreSQL owns the
-- backing index through the constraint, so the constraint must be removed.
ALTER TABLE "target_allocations"
  DROP CONSTRAINT "target_allocations_company_target_id_allocation_type_code_p_key";

-- DropIndex
DROP INDEX "tax_policies_active_idx";

-- AlterTable
ALTER TABLE "activities" ALTER COLUMN "activity_id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "activity_history" ALTER COLUMN "activity_history_id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "activity_links" ALTER COLUMN "activity_link_id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "activity_reminders" ALTER COLUMN "activity_reminder_id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ai_rule_outputs" ALTER COLUMN "ai_rule_output_id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "app_sessions" ALTER COLUMN "absolute_expires_at" SET DEFAULT (CURRENT_TIMESTAMP + '12 hours'::interval);

-- AlterTable
ALTER TABLE "capacity_estimate_runs" ALTER COLUMN "capacity_estimate_run_id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "capacity_estimates" ALTER COLUMN "capacity_estimate_id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "capacity_rates" ALTER COLUMN "capacity_rate_id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "cheques" ALTER COLUMN "cheque_id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "client_customer_bindings" ALTER COLUMN "client_customer_binding_id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "company_targets" ALTER COLUMN "company_target_id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "complaints" ALTER COLUMN "complaint_id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "contact_channels" ALTER COLUMN "contact_channel_id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "contact_share_items" ALTER COLUMN "contact_share_item_id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "contact_shares" ALTER COLUMN "contact_share_id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "contacts" ALTER COLUMN "contact_id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "customer_segment_assignments" ALTER COLUMN "customer_segment_assignment_id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "customer_segment_definitions" ALTER COLUMN "customer_segment_id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "document_links" ALTER COLUMN "document_link_id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "document_metadata" ALTER COLUMN "document_metadata_id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "document_template_versions" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "document_templates" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "dq_issues" ALTER COLUMN "dq_issue_id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "erp_order_lines" ALTER COLUMN "erp_order_line_id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "erp_orders" ALTER COLUMN "erp_order_id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "export_events" ALTER COLUMN "export_event_id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "external_client_identities" ALTER COLUMN "external_client_identity_id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "fx_rates" ALTER COLUMN "fx_rate_id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "geography_classification_rules" ALTER COLUMN "geography_classification_rule_id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "import_batches" ALTER COLUMN "import_batch_id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "import_rows" ALTER COLUMN "import_row_id" DROP DEFAULT,
ALTER COLUMN "normalized_payload" DROP DEFAULT;

-- AlterTable
ALTER TABLE "item_mappings" ALTER COLUMN "item_mapping_id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "logistics_exports" ALTER COLUMN "export_event_id" DROP DEFAULT,
ALTER COLUMN "status_code" SET DEFAULT 'DRAFT';

-- AlterTable
ALTER TABLE "logistics_optimizer_runs" ALTER COLUMN "optimizer_run_id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "logistics_placements" ALTER COLUMN "logistics_placement_id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "logistics_plan_lines" ALTER COLUMN "plan_line_id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "logistics_plan_transport_units" ALTER COLUMN "plan_transport_unit_id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "logistics_plan_versions" ALTER COLUMN "logistics_plan_version_id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "logistics_plans" ALTER COLUMN "logistics_plan_id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "logistics_validation_results" ALTER COLUMN "validation_result_id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "official_quotation_documents" ALTER COLUMN "official_quotation_document_id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "opportunities" ALTER COLUMN "opportunity_id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "opportunity_lost_reasons" ALTER COLUMN "opportunity_lost_reason_id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "opportunity_probability_overrides" ALTER COLUMN "opportunity_probability_override_id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "opportunity_stage_policies" ALTER COLUMN "opportunity_stage_policy_id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "opportunity_stage_transitions" ALTER COLUMN "opportunity_stage_transition_id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "opportunity_won_snapshots" ALTER COLUMN "opportunity_won_snapshot_id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "payment_allocations" ALTER COLUMN "payment_allocation_id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "payment_terms" ALTER COLUMN "payment_term_id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "payments" ALTER COLUMN "payment_id" DROP DEFAULT,
ALTER COLUMN "payment_date" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "permissions" ALTER COLUMN "permission_id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "price_overrides" ALTER COLUMN "price_override_id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "pricing_base_configs" ALTER COLUMN "pricing_base_config_id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "pricing_configurations" ALTER COLUMN "pricing_configuration_id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "pricing_guardrails" ALTER COLUMN "pricing_guardrail_id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "pricing_rules" ALTER COLUMN "pricing_rule_id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "product_families" DROP COLUMN "is_active",
ALTER COLUMN "product_family_id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "products" ALTER COLUMN "product_id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "project_contact_roles" ALTER COLUMN "project_contact_role_id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "project_parties" ALTER COLUMN "project_party_id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "project_work_references" ALTER COLUMN "project_work_reference_id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "projects" ALTER COLUMN "project_id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "quotation_acceptances" ALTER COLUMN "quotation_acceptance_id" DROP DEFAULT,
ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "quotation_adjustments" ALTER COLUMN "quotation_adjustment_id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "quotation_approvals" ALTER COLUMN "quotation_approval_id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "quotation_commercial_state_events" ALTER COLUMN "quotation_commercial_state_event_id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "quotation_lines" ALTER COLUMN "quotation_line_id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "quotation_send_events" ALTER COLUMN "quotation_send_event_id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "quotations" ALTER COLUMN "quotation_id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "reconciliation_issues" ALTER COLUMN "reconciliation_issue_id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "reconciliation_runs" ALTER COLUMN "reconciliation_run_id" DROP DEFAULT,
ALTER COLUMN "started_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "returned_scrap_items" ALTER COLUMN "returned_scrap_item_id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "returned_scrap_requests" ALTER COLUMN "returned_scrap_request_id" DROP DEFAULT,
ALTER COLUMN "status_code" SET DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE "security_events" ALTER COLUMN "security_event_id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "shipment_milestone_events" ALTER COLUMN "shipment_milestone_event_id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "shipments" ALTER COLUMN "shipment_id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "source_items" ALTER COLUMN "source_item_id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "target_allocations" ALTER COLUMN "target_allocation_id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "tax_policies" ALTER COLUMN "tax_policy_id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "upload_sessions" ALTER COLUMN "upload_session_id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "user_notifications" ALTER COLUMN "notification_id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "user_preferences" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AddForeignKey
ALTER TABLE "app_sessions" ADD CONSTRAINT "app_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_archived_by_user_id_fkey" FOREIGN KEY ("archived_by_user_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_product_family_id_fkey" FOREIGN KEY ("product_family_id") REFERENCES "product_families"("product_family_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("product_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("account_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("opportunity_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("project_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_supersedes_quotation_id_fkey" FOREIGN KEY ("supersedes_quotation_id") REFERENCES "quotations"("quotation_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_lines" ADD CONSTRAINT "quotation_lines_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "quotations"("quotation_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_lines" ADD CONSTRAINT "quotation_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("product_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_lines" ADD CONSTRAINT "quotation_lines_price_rule_id_fkey" FOREIGN KEY ("price_rule_id") REFERENCES "pricing_rules"("pricing_rule_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_adjustments" ADD CONSTRAINT "quotation_adjustments_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "quotations"("quotation_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("account_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_links" ADD CONSTRAINT "activity_links_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "activities"("activity_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_history" ADD CONSTRAINT "activity_history_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "activities"("activity_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_reminders" ADD CONSTRAINT "activity_reminders_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "activities"("activity_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_country_code_fkey" FOREIGN KEY ("country_code") REFERENCES "countries"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_commercial_owner_user_id_fkey" FOREIGN KEY ("commercial_owner_user_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_archived_by_user_id_fkey" FOREIGN KEY ("archived_by_user_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_parties" ADD CONSTRAINT "project_parties_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("project_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_parties" ADD CONSTRAINT "project_parties_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("account_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_contact_roles" ADD CONSTRAINT "project_contact_roles_project_party_id_fkey" FOREIGN KEY ("project_party_id") REFERENCES "project_parties"("project_party_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_work_references" ADD CONSTRAINT "project_work_references_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("project_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("account_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("project_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_country_code_fkey" FOREIGN KEY ("country_code") REFERENCES "countries"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_stage_transitions" ADD CONSTRAINT "opportunity_stage_transitions_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("opportunity_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_probability_overrides" ADD CONSTRAINT "opportunity_probability_overrides_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("opportunity_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_won_snapshots" ADD CONSTRAINT "opportunity_won_snapshots_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("opportunity_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("account_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_channels" ADD CONSTRAINT "contact_channels_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("contact_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_shares" ADD CONSTRAINT "contact_shares_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("account_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_shares" ADD CONSTRAINT "contact_shares_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_shares" ADD CONSTRAINT "contact_shares_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_shares" ADD CONSTRAINT "contact_shares_revoked_by_user_id_fkey" FOREIGN KEY ("revoked_by_user_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_share_items" ADD CONSTRAINT "contact_share_items_contact_share_id_fkey" FOREIGN KEY ("contact_share_id") REFERENCES "contact_shares"("contact_share_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_share_items" ADD CONSTRAINT "contact_share_items_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("contact_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_approvals" ADD CONSTRAINT "quotation_approvals_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "quotations"("quotation_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_acceptances" ADD CONSTRAINT "quotation_acceptances_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "quotations"("quotation_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "document_metadata"("document_metadata_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_template_versions" ADD CONSTRAINT "document_template_versions_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "document_templates"("document_template_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("account_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp_orders" ADD CONSTRAINT "erp_orders_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("account_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("account_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cheques" ADD CONSTRAINT "cheques_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("account_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "returned_scrap_requests" ADD CONSTRAINT "returned_scrap_requests_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("account_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "activity_history_activity_id_occurred_at_activity_history_id_id" RENAME TO "activity_history_activity_id_occurred_at_activity_history_i_idx";

-- RenameIndex
ALTER INDEX "capacity_estimate_runs_scope_idx" RENAME TO "capacity_estimate_runs_country_code_created_at_capacity_est_idx";

-- RenameIndex
ALTER INDEX "capacity_estimate_runs_source_idx" RENAME TO "capacity_estimate_runs_source_type_code_source_resource_id_idx";

-- RenameIndex
ALTER INDEX "capacity_estimates_run_idx" RENAME TO "capacity_estimates_estimate_run_id_idx";

-- RenameIndex
ALTER INDEX "client_customer_bindings_account_status_idx" RENAME TO "client_customer_bindings_account_id_status_code_idx";

-- RenameIndex
ALTER INDEX "client_customer_bindings_identity_effective_idx" RENAME TO "client_customer_bindings_external_client_identity_id_status_idx";

-- RenameIndex
ALTER INDEX "contact_share_items_contact_share_idx" RENAME TO "contact_share_items_contact_id_contact_share_id_idx";

-- RenameIndex
ALTER INDEX "customer_segment_assignments_account_effective_idx" RENAME TO "customer_segment_assignments_account_id_effective_from_effe_idx";

-- RenameIndex
ALTER INDEX "customer_segment_assignments_segment_effective_idx" RENAME TO "customer_segment_assignments_customer_segment_id_effective__idx";

-- RenameIndex
ALTER INDEX "customer_segment_definitions_status_code_idx" RENAME TO "customer_segment_definitions_status_code_segment_code_idx";

-- RenameIndex
ALTER INDEX "document_metadata_resource_idx" RENAME TO "document_metadata_resource_type_code_resource_id_idx";

-- RenameIndex
ALTER INDEX "document_template_versions_template_id_status_code_version_no_i" RENAME TO "document_template_versions_template_id_status_code_version__idx";

-- RenameIndex
ALTER INDEX "document_templates_document_type_code_language_code_brand_code_" RENAME TO "document_templates_document_type_code_language_code_brand_c_idx";

-- RenameIndex
ALTER INDEX "erp_orders_country_imported_idx" RENAME TO "erp_orders_country_code_imported_at_erp_order_id_idx";

-- RenameIndex
ALTER INDEX "erp_orders_source_ids_key" RENAME TO "erp_orders_source_system_id_source_sales_order_id_key";

-- RenameIndex
ALTER INDEX "external_client_identities_status_email_idx" RENAME TO "external_client_identities_status_code_email_normalized_idx";

-- RenameIndex
ALTER INDEX "geography_classification_rules_country_effective_idx" RENAME TO "geography_classification_rules_country_code_effective_from__idx";

-- RenameIndex
ALTER INDEX "item_mappings_source_status_idx" RENAME TO "item_mappings_source_item_id_status_code_mapped_at_idx";

-- RenameIndex
ALTER INDEX "logistics_optimizer_runs_version_idx" RENAME TO "logistics_optimizer_runs_plan_version_id_created_at_idx";

-- RenameIndex
ALTER INDEX "logistics_plan_lines_version_idx" RENAME TO "logistics_plan_lines_plan_version_id_idx";

-- RenameIndex
ALTER INDEX "logistics_validation_results_version_idx" RENAME TO "logistics_validation_results_plan_version_id_created_at_idx";

-- RenameIndex
ALTER INDEX "official_quotation_documents_history_idx" RENAME TO "official_quotation_documents_quotation_id_generated_at_idx";

-- RenameIndex
ALTER INDEX "opportunities_project_idx" RENAME TO "opportunities_project_id_idx";

-- RenameIndex
ALTER INDEX "opportunity_probability_overrides_history_idx" RENAME TO "opportunity_probability_overrides_opportunity_id_created_at_idx";

-- RenameIndex
ALTER INDEX "opportunity_stage_transitions_history_idx" RENAME TO "opportunity_stage_transitions_opportunity_id_occurred_at_op_idx";

-- RenameIndex
ALTER INDEX "opportunity_won_snapshots_history_idx" RENAME TO "opportunity_won_snapshots_opportunity_id_won_at_opportunity_idx";

-- RenameIndex
ALTER INDEX "payment_allocations_payment_idx" RENAME TO "payment_allocations_payment_id_idx";

-- RenameIndex
ALTER INDEX "price_overrides_quotation_status_idx" RENAME TO "price_overrides_quotation_id_status_code_idx";

-- RenameIndex
ALTER INDEX "pricing_rules_resolution_idx" RENAME TO "pricing_rules_product_id_country_code_currency_code_status__idx";

-- RenameIndex
ALTER INDEX "quotation_acceptances_quote_accepted_idx" RENAME TO "quotation_acceptances_quotation_id_accepted_at_idx";

-- RenameIndex
ALTER INDEX "quotation_approvals_history_idx" RENAME TO "quotation_approvals_quotation_id_requested_at_idx";

-- RenameIndex
ALTER INDEX "quotation_approvals_pending_idx" RENAME TO "quotation_approvals_status_code_requested_at_idx";

-- RenameIndex
ALTER INDEX "quotation_commercial_events_quote_occurred_idx" RENAME TO "quotation_commercial_state_events_quotation_id_occurred_at__idx";

-- RenameIndex
ALTER INDEX "quotation_send_events_history_idx" RENAME TO "quotation_send_events_quotation_id_sent_at_idx";

-- RenameIndex
ALTER INDEX "quotations_account_status_idx" RENAME TO "quotations_account_id_status_code_idx";

-- RenameIndex
ALTER INDEX "quotations_country_status_updated_idx" RENAME TO "quotations_country_code_status_code_updated_at_quotation_id_idx";

-- RenameIndex
ALTER INDEX "reconciliation_issues_run_status_idx" RENAME TO "reconciliation_issues_run_id_status_code_reconciliation_iss_idx";

-- RenameIndex
ALTER INDEX "shipment_milestone_events_shipment_recorded_idx" RENAME TO "shipment_milestone_events_shipment_id_recorded_at_shipment__idx";

-- RenameIndex
ALTER INDEX "shipments_country_milestone_updated_idx" RENAME TO "shipments_country_code_milestone_code_updated_at_shipment_i_idx";

-- RenameIndex
ALTER INDEX "shipments_erp_order_created_idx" RENAME TO "shipments_erp_order_id_created_at_shipment_id_idx";

-- Align the surviving four-column constraint name with Prisma's canonical
-- generated name after removing the legacy constraint above.
ALTER TABLE "target_allocations"
  RENAME CONSTRAINT "target_allocations_versioned_key"
  TO "target_allocations_company_target_id_allocation_type_code_p_key";
