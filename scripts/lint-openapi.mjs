import { spawnSync } from "node:child_process";

const result = spawnSync(
  process.execPath,
  [
    "node_modules/@redocly/cli/bin/cli.js",
    "lint",
    "docs/contracts/openapi/openapi.yaml",
    "--format",
    "stylish",
  ],
  {
    cwd: process.cwd(),
    env: { ...process.env, REDOCLY_TELEMETRY: "off" },
    encoding: "utf8",
  },
);

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) throw result.error;
const validationOutput = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
const validatedBeforeWindowsTeardownCrash =
  process.platform === "win32" &&
  result.status !== null &&
  result.status >>> 0 === 3221226505 &&
  validationOutput.includes("Woohoo! Your API description is valid");
if (validatedBeforeWindowsTeardownCrash)
  process.stdout.write(
    "OPENAPI_LINT_PASS_WINDOWS_TEARDOWN_CRASH_IGNORED_AFTER_VALIDATION\n",
  );
process.exitCode = validatedBeforeWindowsTeardownCrash
  ? 0
  : (result.status ?? 1);
