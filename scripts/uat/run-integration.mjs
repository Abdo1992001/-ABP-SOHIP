import { execFileSync, spawnSync } from "node:child_process";

const containerName = process.env.ABP_TEST_DB_CONTAINER ?? "abp-uat-db";
const testDatabase = process.env.ABP_TEST_DATABASE_NAME ?? "abp_test";
const docker = process.platform === "win32" ? "docker.exe" : "docker";
const commandShell = process.env.ComSpec ?? "cmd.exe";

function run(file, args, env = process.env) {
  process.stdout.write(`\n[integration] ${args.join(" ")}\n`);
  const result = spawnSync(file, args, {
    cwd: process.cwd(),
    env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${file} exited with status ${String(result.status)}`);
}

function runPnpm(args, env) {
  if (process.platform === "win32") {
    run(commandShell, ["/d", "/s", "/c", "corepack", "pnpm", ...args], env);
    return;
  }
  run("corepack", ["pnpm", ...args], env);
}

function inspectDatabaseContainer() {
  const raw = execFileSync(docker, ["inspect", containerName], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  const [container] = JSON.parse(raw);
  if (container?.State?.Running !== true)
    throw new Error(`${containerName} is not running`);
  const values = Object.fromEntries(
    (container.Config.Env ?? []).map((entry) => {
      const separator = entry.indexOf("=");
      return [entry.slice(0, separator), entry.slice(separator + 1)];
    }),
  );
  const hostPort =
    container.NetworkSettings?.Ports?.["5432/tcp"]?.[0]?.HostPort;
  if (!values.POSTGRES_USER || !values.POSTGRES_PASSWORD || !hostPort)
    throw new Error(
      `${containerName} is missing PostgreSQL connection metadata`,
    );
  return {
    username: values.POSTGRES_USER,
    password: values.POSTGRES_PASSWORD,
    hostPort,
  };
}

function ensureTestDatabase() {
  execFileSync(
    docker,
    [
      "exec",
      containerName,
      "sh",
      "-lc",
      `if ! psql -U "$POSTGRES_USER" -d postgres -Atc "select 1 from pg_database where datname='${testDatabase}'" | grep -qx 1; then createdb -U "$POSTGRES_USER" "${testDatabase}"; fi`,
    ],
    { stdio: "inherit" },
  );
}

const discovered = inspectDatabaseContainer();
ensureTestDatabase();
const testDatabaseUrl = `postgresql://${encodeURIComponent(discovered.username)}:${encodeURIComponent(discovered.password)}@127.0.0.1:${discovered.hostPort}/${testDatabase}?schema=public`;
const testEnvironment = {
  ...process.env,
  NODE_ENV: "test",
  DATABASE_URL: testDatabaseUrl,
  TEST_DATABASE_URL: testDatabaseUrl,
  ABP_TEST_AUTH_ENABLED: "true",
  ABP_PLATFORM_PROOF_ENABLED: "true",
  ABP_ALLOW_DEMO_SEED: "true",
};

runPnpm(["--filter", "@abp/contracts", "build"], testEnvironment);
runPnpm(["--filter", "@abp/database", "build"], testEnvironment);
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
  testEnvironment,
);
runPnpm(["test"], testEnvironment);
