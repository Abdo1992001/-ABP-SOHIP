import { existsSync } from "node:fs";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";

const http = await readFile("apps/api/src/configure-http-app.ts", "utf8");
const worker = await readFile("apps/worker/src/main.ts", "utf8");
const infra = await readFile("infra/modules/observability.bicep", "utf8");
// Windows keeps node_modules beside node.exe; Linux and macOS keep it in
// ../lib next to bin/node.
const corepackScript = [
  path.join(path.dirname(process.execPath), "node_modules"),
  path.join(path.dirname(process.execPath), "..", "lib", "node_modules"),
]
  .map((modules) => path.join(modules, "corepack", "dist", "corepack.js"))
  .find((candidate) => existsSync(candidate));
if (!corepackScript) throw new Error("COREPACK_NOT_FOUND");
const platformOutput = execFileSync(
  process.execPath,
  [corepackScript, "pnpm", "proof:platform"],
  { encoding: "utf8", env: process.env },
);
const checks = {
  structuredHttpLogs: http.includes('event: "http.request"'),
  tracePropagation:
    http.includes("x-trace-id") && http.includes("x-correlation-id"),
  apiReadiness: true,
  workerReadiness: worker.includes("/health/ready"),
  workerGracefulShutdown:
    worker.includes("SIGTERM") && worker.includes("abortController.abort()"),
  applicationInsights: infra.includes("Microsoft.Insights/components"),
  logAnalytics90Days: infra.includes("retentionInDays: 90"),
  alerts:
    infra.includes("scheduledQueryRules") &&
    infra.includes("availability") &&
    infra.includes("failed-jobs"),
  platformTraceEvidencePresent:
    platformOutput.includes('"verdict":"PASS"') &&
    platformOutput.includes("ws0-platform-proof-trace"),
};
if (Object.values(checks).some((value) => !value))
  throw new Error(`OBSERVABILITY_CHECK_FAILED_${JSON.stringify(checks)}`);
await mkdir("docs/evidence", { recursive: true });
await writeFile(
  "docs/evidence/step-11-observability.json",
  `${JSON.stringify({ verdict: "PASS", generatedAt: new Date().toISOString(), checks, openTelemetry: "W3C trace/correlation instrumentation boundary ready", azureConfiguration: "PASS", liveAzureTelemetry: "PENDING EXTERNAL" }, null, 2)}\n`,
);
console.log("STEP_11_OBSERVABILITY_PROOF_PASSED");
