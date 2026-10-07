import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptFile = fileURLToPath(import.meta.url);
const scriptDir = dirname(scriptFile);
const repoRoot = resolve(scriptDir, "../..");
const evidenceDir = resolve(repoRoot, ".tmp", "step1-evidence");
const localDb =
  "postgresql://abp:abp_local_only@localhost:5432/abp?schema=public";
await mkdir(evidenceDir, { recursive: true });

function runToLog({ command, args, env, logFile, displayCommand }) {
  const logPath = resolve(evidenceDir, logFile);
  const log = createWriteStream(logPath);
  const startedAt = new Date().toISOString();
  return new Promise((resolveResult) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env: { ...process.env, ...env },
      shell: false,
      windowsHide: true,
    });
    let spawnError = null;
    child.once("error", (error) => {
      spawnError = error.message;
      log.write(`${error.stack ?? error.message}\n`);
    });
    child.stdout?.pipe(log, { end: false });
    child.stderr?.pipe(log, { end: false });
    child.once("close", (exitCode, signal) => {
      log.end(() =>
        resolveResult({
          command: displayCommand ?? `${command} ${args.join(" ")}`,
          startedAt,
          finishedAt: new Date().toISOString(),
          exitCode,
          signal,
          spawnError,
          log: `.tmp/step1-evidence/${logFile}`,
          result: exitCode === 0 && spawnError === null ? "PASS" : "FAIL",
        }),
      );
    });
  });
}

async function inspectImage(tag, logFile) {
  const result = await runToLog({
    command: "docker.exe",
    args: ["image", "inspect", tag, "--format", "{{json .}}"],
    logFile,
  });
  if (result.result !== "PASS")
    return { ...result, imageId: null, repoTags: [], repoDigests: [] };
  const image = JSON.parse(
    await readFile(resolve(evidenceDir, logFile), "utf8"),
  );
  return {
    ...result,
    imageId: image.Id ?? null,
    repoTags: image.RepoTags ?? [],
    repoDigests: image.RepoDigests ?? [],
  };
}

const corepackEntrypoint =
  process.platform === "win32"
    ? resolve(
        process.env.ProgramFiles ?? "C:/Program Files",
        "nodejs",
        "node_modules",
        "corepack",
        "dist",
        "corepack.js",
      )
    : "corepack";
const commands = [
  {
    key: "pnpm-verify",
    command:
      process.platform === "win32" ? process.execPath : corepackEntrypoint,
    args:
      process.platform === "win32"
        ? [corepackEntrypoint, "pnpm", "verify"]
        : ["pnpm", "verify"],
    env: { DATABASE_URL: localDb, TEST_DATABASE_URL: localDb },
    logFile: "pnpm-verify.log",
    displayCommand: "corepack pnpm verify",
  },
  {
    key: "docker-api",
    command: "docker.exe",
    args: [
      "build",
      "-f",
      "apps/api/Dockerfile",
      "-t",
      "abp-api:step1-evidence",
      ".",
    ],
    logFile: "docker-api.log",
    tag: "abp-api:step1-evidence",
  },
  {
    key: "docker-worker",
    command: "docker.exe",
    args: [
      "build",
      "-f",
      "apps/worker/Dockerfile",
      "-t",
      "abp-worker:step1-evidence",
      ".",
    ],
    logFile: "docker-worker.log",
    tag: "abp-worker:step1-evidence",
  },
  {
    key: "docker-web",
    command: "docker.exe",
    args: [
      "build",
      "-f",
      "apps/web/Dockerfile",
      "-t",
      "abp-web:step1-evidence",
      ".",
    ],
    logFile: "docker-web.log",
    tag: "abp-web:step1-evidence",
  },
];

const summary = {};
for (const entry of commands) {
  const result = await runToLog(entry);
  if (entry.tag && result.result === "PASS") {
    result.inspect = await inspectImage(entry.tag, `${entry.key}-inspect.log`);
    if (result.inspect.result !== "PASS" || !result.inspect.imageId)
      result.result = "FAIL";
  }
  await writeFile(
    resolve(evidenceDir, `${entry.key}-result.json`),
    `${JSON.stringify(result, null, 2)}\n`,
  );
  summary[entry.key] = result;
  if (result.result !== "PASS") break;
}
await writeFile(
  resolve(evidenceDir, "step1-final-summary.json"),
  `${JSON.stringify(summary, null, 2)}\n`,
);
process.exitCode = Object.values(summary).some(
  (result) => result.result !== "PASS",
)
  ? 1
  : 0;
