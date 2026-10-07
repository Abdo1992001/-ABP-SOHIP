import { spawnSync } from "node:child_process";

if (process.env.TEST_DATABASE_URL === undefined) {
  throw new Error("TEST_DATABASE_URL is required for proof:authorization");
}

const windows = process.platform === "win32";
const result = spawnSync(
  windows ? (process.env.ComSpec ?? "cmd.exe") : "corepack",
  windows
    ? [
        "/d",
        "/s",
        "/c",
        "corepack pnpm exec vitest run src/customer/customer.integration.test.ts",
      ]
    : [
        "pnpm",
        "exec",
        "vitest",
        "run",
        "src/customer/customer.integration.test.ts",
      ],
  { cwd: process.cwd(), env: process.env, encoding: "utf8", stdio: "inherit" },
);

if (result.status !== 0) process.exit(result.status ?? 1);

console.log(
  JSON.stringify({
    proof: "authorization",
    database: "postgresql",
    assertions:
      "country-scope, deny, sharing, transfer, merge, IDOR, field-projection, audit, concurrency, cross-workspace",
    result: "PASS",
  }),
);
