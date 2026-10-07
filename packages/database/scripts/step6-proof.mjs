import { Client } from "pg";
const url = process.env.DATABASE_URL;
if (!url?.startsWith("postgresql://"))
  throw new Error("DATABASE_URL must target PostgreSQL.");
const client = new Client({ connectionString: url });
const expectedTables = [
  "continents",
  "pricing_configurations",
  "quotation_approvals",
  "document_metadata",
  "official_quotation_documents",
  "quotation_send_events",
  "import_batches",
  "import_rows",
  "dq_issues",
  "reconciliation_runs",
  "erp_orders",
  "erp_order_lines",
  "capacity_rates",
  "capacity_estimates",
  "logistics_plans",
  "logistics_plan_versions",
  "logistics_placements",
  "shipments",
  "shipment_milestone_events",
  "fx_rates",
  "payments",
  "cheques",
  "returned_scrap_requests",
  "returned_scrap_items",
  "company_targets",
  "target_allocations",
];
const forbidden = [
  "quotation_revisions",
  "internal_sales_orders",
  "production_reservations",
  "production_orders",
  "work_orders",
  "routing",
  "work_centers",
  "qc_inspections",
  "mes_operations",
  "dispatches",
  "deliveries",
  "pods",
  "personal_targets",
  "net_commercial_sales",
];
const expectRejected = async (sql) => {
  let rejected = false;
  try {
    await client.query(sql);
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("Expected database constraint rejection.");
};
try {
  await client.connect();
  const version = (await client.query("SHOW server_version")).rows[0]
    .server_version;
  if (!version.startsWith("17."))
    throw new Error("PostgreSQL 17 required: " + version);
  const tables = await client.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name = ANY($1::text[])",
    [expectedTables],
  );
  const found = new Set(tables.rows.map((row) => row.table_name));
  const missing = expectedTables.filter((name) => !found.has(name));
  if (missing.length)
    throw new Error("Missing physical tables: " + missing.join(", "));
  const bad = await client.query(
    "SELECT relname FROM pg_class WHERE relkind IN ('r','p','v','m') AND relname = ANY($1::text[])",
    [forbidden],
  );
  if (bad.rows.length)
    throw new Error(
      "Forbidden physical objects: " +
        bad.rows.map((x) => x.relname).join(", "),
    );
  await expectRejected(
    "INSERT INTO capacity_rates(category_code,boards_per_day,effective_from) VALUES ('STANDARD',899,now())",
  );
  await expectRejected(
    "INSERT INTO fx_rates(base_currency_code,quote_currency_code,rate,effective_from,source_code) VALUES ('USD','USD',1,now(),'proof')",
  );
  await expectRejected(
    "INSERT INTO returned_scrap_items(returned_scrap_request_id,original_quotation_line_id,eligible_returned_qty,original_purchase_unit_price,benefit_amount,benefit_type_code) VALUES ('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-000000000000',1,1,.25,'CREDIT')",
  );
  await expectRejected(
    "INSERT INTO erp_order_lines(erp_order_id,source_line_key,qty_booked) VALUES ('00000000-0000-0000-0000-000000000000','proof',-1)",
  );
  const constraints = await client.query(
    "SELECT count(*)::int AS count FROM pg_constraint WHERE connamespace='public'::regnamespace",
  );
  const indexes = await client.query(
    "SELECT count(*)::int AS count FROM pg_indexes WHERE schemaname='public'",
  );
  const migrations = await client.query(
    "SELECT count(*)::int AS count FROM _prisma_migrations WHERE finished_at IS NOT NULL",
  );
  console.log(
    JSON.stringify({
      result: "PASS",
      postgresVersion: version,
      tables: found.size,
      constraints: constraints.rows[0].count,
      indexes: indexes.rows[0].count,
      migrations: migrations.rows[0].count,
      constraintTests: 4,
      forbiddenObjects: 0,
    }),
  );
} finally {
  await client.end();
}
