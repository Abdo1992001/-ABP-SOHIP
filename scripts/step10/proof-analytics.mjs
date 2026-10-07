import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const readJson = (path) =>
  JSON.parse(readFileSync(resolve(root, path), "utf8"));
const metrics = readJson("docs/analytics/metric-registry.json").metrics;
const reports = readJson("docs/analytics/report-registry.json").reports;
const trace = readJson("docs/analytics/step-10-requirement-traceability.json");
const metricIds = new Set(metrics.map((item) => item.metricId));

if (metrics.length !== 72 || metricIds.size !== 72)
  throw new Error("METRIC_REGISTRY_INVALID");
if (
  reports.length !== 18 ||
  new Set(reports.map((item) => item.reportId)).size !== 18
)
  throw new Error("REPORT_REGISTRY_INVALID");
if (trace.total !== 328 || trace.mapped !== 328 || trace.unmapped !== 0)
  throw new Error("STEP10_TRACEABILITY_INVALID");
for (const report of reports) {
  if (
    !report.metricIds.length ||
    report.metricIds.some((id) => !metricIds.has(id))
  )
    throw new Error(`REPORT_METRIC_REFERENCE_INVALID:${report.reportId}`);
}
for (const metric of metrics) {
  for (const field of [
    "metricId",
    "metricVersion",
    "sourceLineage",
    "dateBasis",
    "authorization",
  ])
    if (!metric[field])
      throw new Error(`METRIC_CONTRACT_INCOMPLETE:${metric.metricId}:${field}`);
}

execFileSync("corepack", ["pnpm", "--filter", "@abp/api", "proof:analytics"], {
  cwd: root,
  env: {
    ...process.env,
    DATABASE_URL:
      process.env.DATABASE_URL ??
      "postgresql://abp:abp_local_only@localhost:5432/abp?schema=public",
  },
  stdio: "inherit",
  shell: process.platform === "win32",
});

const evidence = readJson("docs/evidence/d10-bi-proof.json");
if (evidence.technicalVerdict !== "PASS" || evidence.openDefects.length)
  throw new Error("D10_BI_RUNTIME_EVIDENCE_FAILED");
process.stdout.write("STEP10_REGISTRIES metrics=72 reports=18 PASS\n");
process.stdout.write("STEP10_TRACEABILITY 328/328 PASS\n");
process.stdout.write("D10_BI_EVIDENCE PASS\n");
process.stdout.write("PROOF_ANALYTICS PASS\n");
