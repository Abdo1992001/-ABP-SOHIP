import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const scriptDir = resolve(fileURLToPath(new URL(".", import.meta.url)));
const repoRoot = resolve(scriptDir, "../..");
const blueprint = YAML.parse(
  await readFile(resolve(repoRoot, "render.yaml"), "utf8"),
);
const errors = [];
const expect = (condition, message) => {
  if (!condition) errors.push(message);
};
const byName = new Map(
  (blueprint.services ?? []).map((service) => [service.name, service]),
);
const database = (blueprint.databases ?? []).find(
  (candidate) => candidate.name === "abp-postgres-staging",
);

expect(byName.size === 3, "EXACTLY_THREE_STAGING_SERVICES_REQUIRED");
expect(database !== undefined, "STAGING_POSTGRES_REQUIRED");
expect(database?.postgresMajorVersion === "17", "POSTGRES_17_REQUIRED");
expect(
  Array.isArray(database?.ipAllowList) && database.ipAllowList.length === 0,
  "EXTERNAL_DB_ACCESS_MUST_BE_BLOCKED",
);

for (const [name, type, dockerfilePath] of [
  ["abp-api-staging", "web", "apps/api/Dockerfile"],
  ["abp-worker-staging", "worker", "apps/worker/Dockerfile"],
  ["abp-web-staging", "web", "apps/web/Dockerfile"],
]) {
  const service = byName.get(name);
  expect(service?.type === type, name + "_TYPE_INVALID");
  expect(service?.runtime === "docker", name + "_DOCKER_RUNTIME_REQUIRED");
  expect(
    service?.dockerfilePath === dockerfilePath,
    name + "_DOCKERFILE_INVALID",
  );
  expect(service?.dockerContext === ".", name + "_DOCKER_CONTEXT_INVALID");
  expect(
    service?.region === database?.region,
    name + "_MUST_SHARE_DATABASE_REGION",
  );
}

for (const name of ["abp-api-staging", "abp-worker-staging"]) {
  const databaseUrl = byName
    .get(name)
    ?.envVars?.find((variable) => variable.key === "DATABASE_URL");
  expect(
    databaseUrl?.fromDatabase?.name === "abp-postgres-staging",
    name + "_DATABASE_REFERENCE_INVALID",
  );
  expect(
    databaseUrl?.fromDatabase?.property === "connectionString",
    name + "_MUST_USE_PRIVATE_CONNECTION_STRING",
  );
}

expect(
  byName.get("abp-api-staging")?.preDeployCommand ===
    "corepack pnpm db:migrate:deploy",
  "API_MIGRATION_OWNER_REQUIRED",
);
expect(
  byName.get("abp-api-staging")?.healthCheckPath === "/api/v1/health/ready",
  "API_READINESS_HEALTH_CHECK_REQUIRED",
);
expect(
  byName.get("abp-web-staging")?.healthCheckPath === "/",
  "WEB_HEALTH_CHECK_REQUIRED",
);
expect(
  byName
    .get("abp-api-staging")
    ?.envVars?.some(
      (variable) =>
        variable.key === "ABP_ALLOWED_ORIGINS" && variable.sync === false,
    ),
  "API_ALLOWED_ORIGINS_MUST_BE_DASHBOARD_MANAGED",
);
expect(
  byName
    .get("abp-web-staging")
    ?.envVars?.some(
      (variable) =>
        variable.key === "ABP_API_BASE_URL" && variable.sync === false,
    ),
  "WEB_API_URL_MUST_BE_DASHBOARD_MANAGED",
);

if (errors.length > 0) {
  console.error(JSON.stringify({ result: "FAIL", errors }, null, 2));
  process.exitCode = 1;
} else {
  console.log(
    JSON.stringify({
      result: "PASS",
      environment: "STAGING",
      services: [...byName.keys()],
      database: database.name,
      postgresMajorVersion: database.postgresMajorVersion,
      externalDatabaseAccess: "BLOCKED",
      migrationOwner: "abp-api-staging",
    }),
  );
}
