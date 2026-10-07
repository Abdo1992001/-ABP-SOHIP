import { execFileSync, spawnSync } from "node:child_process";

const containerName = process.env.ABP_UAT_DB_CONTAINER ?? "abp-uat-db";
const docker = process.platform === "win32" ? "docker.exe" : "docker";
const commandShell = process.env.ComSpec ?? "cmd.exe";

function runPnpm(args, environment) {
  const command =
    process.platform === "win32"
      ? [commandShell, ["/d", "/s", "/c", "corepack", "pnpm", ...args]]
      : ["corepack", ["pnpm", ...args]];
  process.stdout.write(`\n[uat] pnpm ${args.join(" ")}\n`);
  const result = spawnSync(command[0], command[1], {
    cwd: process.cwd(),
    env: environment,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`UAT command failed with status ${String(result.status)}`);
  }
}

const raw = execFileSync(docker, ["inspect", containerName], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "inherit"],
});
const [container] = JSON.parse(raw);
if (container?.State?.Running !== true) {
  throw new Error(`${containerName} is not running`);
}
const values = Object.fromEntries(
  (container.Config.Env ?? []).map((entry) => {
    const separator = entry.indexOf("=");
    return [entry.slice(0, separator), entry.slice(separator + 1)];
  }),
);
const hostPort = container.NetworkSettings?.Ports?.["5432/tcp"]?.[0]?.HostPort;
if (
  !values.POSTGRES_USER ||
  !values.POSTGRES_PASSWORD ||
  !values.POSTGRES_DB ||
  !hostPort
) {
  throw new Error(`${containerName} is missing PostgreSQL connection metadata`);
}
const databaseUrl = `postgresql://${encodeURIComponent(values.POSTGRES_USER)}:${encodeURIComponent(values.POSTGRES_PASSWORD)}@127.0.0.1:${hostPort}/${encodeURIComponent(values.POSTGRES_DB)}?schema=public`;
const environment = {
  ...process.env,
  NODE_ENV: "development",
  DATABASE_URL: databaseUrl,
  ABP_ALLOW_DEMO_SEED: "true",
  ABP_UAT_OUTPUT: "none",
};

runPnpm(["--filter", "@abp/contracts", "build"], environment);
runPnpm(["--filter", "@abp/database", "build"], environment);
runPnpm(
  [
    "--filter",
    "@abp/database",
    "exec",
    "prisma",
    "migrate",
    "deploy",
    "--config",
    "prisma.config.ts",
  ],
  environment,
);
runPnpm(["exec", "tsx", "packages/database/prisma/seed.ts"], environment);
runPnpm(["exec", "tsx", "scripts/uat/create-uat.ts"], environment);
process.stdout.write("\n[uat] migrations and idempotent demo data are ready\n");
