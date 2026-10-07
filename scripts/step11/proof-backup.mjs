import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";

const started = Date.now();
const compose = (...args) =>
  execFileSync("docker", ["compose", ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
const databaseService = process.env.ABP_DATABASE_COMPOSE_SERVICE ?? "db";
// CI runs Postgres as a job service container rather than through Compose,
// so the workflow passes that container's id directly.
const container =
  process.env.ABP_DATABASE_CONTAINER ?? compose("ps", "-q", databaseService);
if (!container) throw new Error("POSTGRES_CONTAINER_NOT_RUNNING");
const suffix = Date.now().toString();
const restoreDatabase = `abp_step11_restore_${suffix}`;
const dump = `/tmp/abp-step11-${suffix}.dump`;
const docker = (...args) =>
  execFileSync("docker", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
let verification;
try {
  docker(
    "exec",
    container,
    "pg_dump",
    "-U",
    "abp",
    "-d",
    "abp",
    "-Fc",
    "-f",
    dump,
  );
  docker("exec", container, "createdb", "-U", "abp", restoreDatabase);
  docker(
    "exec",
    container,
    "pg_restore",
    "-U",
    "abp",
    "-d",
    restoreDatabase,
    "--no-owner",
    dump,
  );
  const raw = docker(
    "exec",
    container,
    "psql",
    "-U",
    "abp",
    "-d",
    restoreDatabase,
    "-At",
    "-c",
    "SELECT json_build_object('serverVersion',current_setting('server_version'),'tables',(SELECT count(*) FROM information_schema.tables WHERE table_schema='public'),'migrations',(SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL),'audit',(SELECT count(*) FROM audit_events));",
  );
  verification = JSON.parse(raw);
  if (verification.tables < 50 || verification.migrations < 30)
    throw new Error(`RESTORE_VERIFICATION_FAILED_${raw}`);
} finally {
  try {
    docker(
      "exec",
      container,
      "dropdb",
      "-U",
      "abp",
      "--if-exists",
      restoreDatabase,
    );
  } catch {
    // Best-effort cleanup after the proof result is already captured.
  }
  try {
    docker("exec", container, "rm", "-f", dump);
  } catch {
    // Best-effort removal of the temporary dump inside the test container.
  }
}
const evidence = {
  verdict: "PASS",
  environment: `isolated local PostgreSQL ${verification.serverVersion} restore database in Docker`,
  durationSeconds: Math.round((Date.now() - started) / 10) / 100,
  verification,
  destructiveTargetControl: {
    exactDatabase: restoreDatabase,
    productionTouched: false,
  },
  design: {
    rpoMinutes: 15,
    rtoHours: 4,
    pitrDays: 14,
    dailyRetentionDays: 35,
    monthlyRetentionMonths: 12,
  },
  liveAzureEvidence: "PENDING EXTERNAL",
};
await mkdir("docs/evidence", { recursive: true });
await writeFile(
  "docs/evidence/step-11-backup-restore.json",
  `${JSON.stringify(evidence, null, 2)}\n`,
);
console.log("STEP_11_BACKUP_RESTORE_PROOF_PASSED");
