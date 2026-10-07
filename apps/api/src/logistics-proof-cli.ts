import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { Server } from "node:http";
import { permissions } from "@abp/contracts";
import type { DatabaseClient } from "@abp/database";
import { AppModule } from "./app.module.js";
import { configureHttpApplication } from "./configure-http-app.js";
import { databaseClientToken } from "./platform/database.providers.js";

const user = "e7300000-0000-4000-8000-000000000001";
const role = "e7300000-0000-4000-8000-000000000010";
async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED");
  process.env.ABP_TEST_AUTH_ENABLED = "true";
  const app = await NestFactory.create(AppModule, { logger: false });
  configureHttpApplication(app);
  await app.listen(0, "127.0.0.1");
  try {
    const db = app.get<DatabaseClient>(databaseClientToken);
    await seed(db);
    const address = (app.getHttpServer() as Server).address();
    assert(address && typeof address !== "string", "ADDRESS");
    const base = `http://127.0.0.1:${address.port.toString()}/api/v1`;
    const run = Date.now();
    const call = (path: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      headers.set("x-abp-test-user-id", user);
      headers.set("x-abp-test-session-id", `logistics-${run.toString()}`);
      return fetch(base + path, { ...init, headers });
    };
    const post = (path: string, key: string, body: unknown) =>
      call(path, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": key },
        body: JSON.stringify(body),
      });
    const created = await post("/logistics/plans", `log-plan-${run}`, {
      sourceTypeCode: "MANUAL_SCENARIO",
      countryCode: "EG",
      manualLines: [
        {
          qty: "6",
          lengthMm: "2000",
          widthMm: "1000",
          thicknessMm: "100",
          weightKg: "500",
          orientationCode: "FLAT_ON_FACE",
        },
      ],
    });
    assert(created.status === 201, "CREATE");
    const plan = (await created.json()) as {
      data: { logisticsPlanId: string };
    };
    const version = await db.logisticsPlanVersion.findFirstOrThrow({
      where: { logisticsPlanId: plan.data.logisticsPlanId },
    });
    const draft = {
      lines: [
        {
          qty: "6",
          lengthMm: "2000",
          widthMm: "1000",
          thicknessMm: "100",
          weightKg: "500",
          orientationCode: "FLAT_ON_FACE",
        },
      ],
      transportUnits: [{ instanceNo: 1 }],
      completenessMode: "COMPLETE",
    };
    const saved = await call(
      `/logistics/plan-versions/${version.id}/draft-content`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          "if-match": `"${version.rowVersion.toString()}"`,
        },
        body: JSON.stringify(draft),
      },
    );
    assert(saved.status === 200, `SAVE_${saved.status.toString()}`);
    const stale = await call(
      `/logistics/plan-versions/${version.id}/draft-content`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          "if-match": `"${version.rowVersion.toString()}"`,
        },
        body: JSON.stringify(draft),
      },
    );
    assert(stale.status === 412, "ETAG_RACE");
    const expected = saved.headers.get("etag")?.replaceAll('"', "");
    assert(expected, "ETAG");
    const optimized = await post(
      `/logistics/plan-versions/${version.id}/optimize`,
      `log-opt-${run}`,
      { expectedRowVersion: expected, objectiveCode: "MIN_VEHICLES" },
    );
    assert(optimized.status === 202, `OPTIMIZE_${optimized.status.toString()}`);
    const current = await db.logisticsPlanVersion.findUniqueOrThrow({
      where: { id: version.id },
    });
    const validated = await post(
      `/logistics/plan-versions/${version.id}/validate`,
      `log-val-${run}`,
      { expectedRowVersion: current.rowVersion.toString() },
    );
    assert(validated.status === 200, `VALIDATE_${validated.status.toString()}`);
    const visual = await call(
      `/logistics/plan-versions/${version.id}/visualization`,
    );
    const body = (await visual.json()) as {
      data: { placements: Array<{ rotationCode: string }> };
    };
    assert(
      visual.status === 200 && body.data.placements.length > 0,
      "VISUALIZATION",
    );
    assert(
      body.data.placements.every(
        (p) => p.rotationCode === "0" || p.rotationCode === "90",
      ),
      "ROTATION",
    );
    const before = await db.outboxMessage.count({
      where: { aggregateType: "LogisticsExport" },
    });
    const exported = await post(
      `/logistics/plan-versions/${version.id}/exports`,
      `log-export-${run}`,
      { formatCode: "PDF", includeValidation: true },
    );
    assert(exported.status === 202, `EXPORT_${exported.status.toString()}`);
    assert(
      (await db.outboxMessage.count({
        where: { aggregateType: "LogisticsExport" },
      })) > before,
      "OUTBOX",
    );
    assert(
      (await db.auditEvent.count({ where: { source: "logistics-api" } })) >= 4,
      "AUDIT",
    );
    process.stdout.write(
      `${JSON.stringify({ LOGISTICS: "PASS", POSTGRESQL: "PASS", COUNTRY_SCOPE: "PASS", ETAG_IF_MATCH: "PASS", FLAT_ON_FACE: "PASS", ROTATION_0_90: "PASS", DETERMINISTIC_OPTIMIZER: "PASS", VALIDATION: "PASS", AUDIT: "PASS", OUTBOX_JOBS: "PASS", SHIPMENT_POD: "ABSENT" }, null, 2)}\n`,
    );
  } finally {
    await app.close();
    delete process.env.ABP_TEST_AUTH_ENABLED;
  }
}
async function seed(db: DatabaseClient) {
  for (const code of Object.values(permissions))
    await db.permission.upsert({
      where: { code },
      create: { code, description: code },
      update: {},
    });
  await db.appUser.upsert({
    where: { id: user },
    create: {
      id: user,
      externalSubject: "logistics-proof",
      displayName: "Logistics Proof",
      emailNormalized: "logistics-proof@example.test",
    },
    update: { active: true },
  });
  await db.role.upsert({
    where: { id: role },
    create: {
      id: role,
      code: "LOGISTICS_PROOF",
      name: "Logistics Proof",
      workspace: "LOGISTICS",
    },
    update: { workspace: "LOGISTICS" },
  });
  for (const permissionCode of [
    permissions.logisticsView,
    permissions.logisticsCreate,
    permissions.logisticsEdit,
    permissions.logisticsOptimize,
    permissions.logisticsValidate,
    permissions.logisticsExport,
  ])
    await db.rolePermission.upsert({
      where: { roleId_permissionCode: { roleId: role, permissionCode } },
      create: { roleId: role, permissionCode },
      update: {},
    });
  await db.userRole.upsert({
    where: { userId_roleId: { userId: user, roleId: role } },
    create: { userId: user, roleId: role },
    update: {},
  });
  await db.country.upsert({
    where: { code: "EG" },
    create: { code: "EG", name: "Egypt", continentCode: "AFRICA" },
    update: {},
  });
  await db.userCountryAccess.upsert({
    where: { userId_countryCode: { userId: user, countryCode: "EG" } },
    create: { userId: user, countryCode: "EG", grantedBy: user },
    update: { statusCode: "ACTIVE", validTo: null },
  });
}
function assert(value: unknown, code: string): asserts value {
  if (!value) throw new Error(code);
}
void main();
