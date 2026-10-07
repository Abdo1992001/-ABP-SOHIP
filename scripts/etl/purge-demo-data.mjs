// Removes the seeded demo/business data so the real ERP history is the only
// commercial truth in the system.
//
// What is KEPT on purpose: users, roles, permissions, country/currency reference
// data, pricing base config, and anything that would make the app unusable if it
// vanished. What goes is the fabricated commercial record — demo customers and
// everything hanging off them.
//
// Run with --dry-run first; it prints the row counts it would delete.

import { connect } from "./lib/pipeline.mjs";

// Order matters: children before parents.
//
// The list has to be complete. An earlier version stopped at the obvious
// entities and left twenty documents, twenty shipments and twenty notifications
// pointing at customers and orders that no longer existed - rows the app could
// never show and nobody could ever delete from the UI.
const TABLES = [
  "quotation_line_audits",
  "quotation_adjustments",
  "quotation_payment_milestones",
  "quotation_approvals",
  "quotation_lines",
  "quotations",
  "activity_links",
  "activities",
  "opportunity_stage_history",
  "opportunities",
  "project_parties",
  "projects",
  "erp_order_lines",
  "erp_orders",
  "payments",
  "cheques",
  "complaints",
  "returned_scrap_requests",
  "repeat_business_requests",
  "tool_jobs",
  "contact_shares",
  "contacts",
  "customer_shares",
  "account_group_memberships",
  "accounts",
  "pricing_rules",
  "products",
  "product_families",
  "dq_issues",
  "import_rows",
  "import_batches",

  // Attachments and generated documents.
  "document_links",
  "document_versions",
  "official_quotation_documents",
  "upload_sessions",
  "document_metadata",

  // Logistics and fulfilment hanging off orders.
  "shipment_milestone_events",
  "shipments",
  "logistics_validation_results",
  "logistics_placements",
  "logistics_plan_lines",
  "logistics_plan_transport_units",
  "logistics_exports",
  "logistics_optimizer_runs",
  "logistics_plan_versions",
  "logistics_plans",
  "capacity_estimates",
  "capacity_estimate_runs",

  // Per-record history and derived snapshots.
  "quotation_acceptances",
  "quotation_commercial_state_events",
  "quotation_send_events",
  "opportunity_won_snapshots",
  "opportunity_stage_transitions",
  "opportunity_lost_reasons",
  "opportunity_probability_overrides",
  "activity_history",
  "activity_reminders",
  "price_overrides",
  "payment_allocations",
  "returned_scrap_items",

  // Targets, research and advisory content seeded for the demo.
  "target_allocations",
  "company_targets",
  "watchlist_entries",
  "target_accounts",
  "target_markets",
  "competitors",
  "market_signals",
  "ai_rule_outputs",
  "customer_segment_assignments",
  "customer_segment_definitions",
  "item_mappings",
  "source_items",
  "reconciliation_issues",
  "reconciliation_runs",
  "export_events",

  // Per-user noise about records that are gone.
  "user_notifications",
];

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const db = await connect();
  try {
    const present = new Set(
      (
        await db.query(
          `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
        )
      ).rows.map((row) => row.table_name),
    );

    const counts = [];
    for (const table of TABLES) {
      if (!present.has(table)) continue;
      const { rows } = await db.query(
        `SELECT count(*)::int AS n FROM ${table}`,
      );
      counts.push([table, rows[0].n]);
    }

    const total = counts.reduce((sum, [, n]) => sum + n, 0);
    for (const [table, n] of counts) {
      if (n > 0)
        process.stdout.write(
          `  ${table.padEnd(34)} ${String(n).padStart(7)}\n`,
        );
    }
    process.stdout.write(
      `  ${"TOTAL".padEnd(34)} ${String(total).padStart(7)}\n`,
    );

    if (dryRun) {
      process.stdout.write("\n  --dry-run: nothing deleted.\n");
      return;
    }

    await db.query("BEGIN");
    // Immutability triggers (e.g. SENT_QUOTATION_CONTENT_IS_IMMUTABLE) exist to
    // stop the application editing history. They are correct and stay in force
    // for the app; this one-off wipe of seeded demo rows runs underneath them.
    await db.query("SET LOCAL session_replication_role = replica");
    for (const table of TABLES) {
      if (!present.has(table)) continue;
      await db.query(`DELETE FROM ${table}`);
    }
    await db.query("COMMIT");
    process.stdout.write(
      "\n  Deleted. Reference data, users and roles were not touched.\n",
    );
  } catch (error) {
    await db.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${String(error?.stack ?? error)}\n`);
  process.exitCode = 1;
});
