import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { Server } from "node:http";
import { permissions } from "@abp/contracts";
import type { DatabaseClient } from "@abp/database";
import { AppModule } from "./app.module.js";
import { configureHttpApplication } from "./configure-http-app.js";
import { databaseClientToken } from "./platform/database.providers.js";

const ids = {
  sales: "e7200000-0000-4000-8000-000000000001",
  operations: "e7200000-0000-4000-8000-000000000002",
  denied: "e7200000-0000-4000-8000-000000000003",
  salesRole: "e7200000-0000-4000-8000-000000000010",
  operationsRole: "e7200000-0000-4000-8000-000000000011",
  deniedRole: "e7200000-0000-4000-8000-000000000012",
} as const;

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
    assert(address && typeof address !== "string", "HTTP_ADDRESS_MISSING");
    const base = `http://127.0.0.1:${address.port.toString()}/api/v1`;
    const run = Date.now().toString();
    const call = (user: string, path: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      headers.set("x-abp-test-user-id", user);
      headers.set("x-abp-test-session-id", `capacity-${run}-${user}`);
      return fetch(`${base}${path}`, { ...init, headers });
    };
    const post = (user: string, path: string, key: string, body: unknown) =>
      call(user, path, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": key,
        },
        body: JSON.stringify(body),
      });
    const estimate = await post(
      ids.sales,
      "/capacity/estimates",
      `capacity-estimate-${run}`,
      {
        sourceTypeCode: "MANUAL",
        sourceResourceId: null,
        startAt: "2030-01-01T00:00:00.000Z",
        items: [
          { categoryCode: "STANDARD", quantityBoards: "1350" },
          { categoryCode: "ORDINARY", quantityBoards: "700" },
          { categoryCode: "CURVED", quantityBoards: "600" },
        ],
      },
    );
    const body = (await estimate.json()) as {
      data: {
        capacityEstimateId: string;
        estimatedFinishAt: string | null;
        items: Array<{
          categoryCode: string;
          requiredDaysDecimal: string;
          durationHours: string;
          rateBoardsPerDaySnapshot: string;
        }>;
      };
    };
    assert(
      estimate.status === 201,
      `CAPACITY_ESTIMATE_${estimate.status.toString()}`,
    );
    assert(body.data.estimatedFinishAt === null, "MIXED_ETA_MUST_BE_NULL");
    const byCategory = new Map(
      body.data.items.map((item) => [item.categoryCode, item]),
    );
    assert(
      byCategory.get("STANDARD")?.requiredDaysDecimal === "1.5",
      "STANDARD_DAYS",
    );
    assert(
      byCategory.get("STANDARD")?.durationHours === "36",
      "STANDARD_HOURS",
    );
    assert(
      byCategory.get("STANDARD")?.rateBoardsPerDaySnapshot === "900",
      "STANDARD_RATE",
    );
    assert(
      byCategory.get("ORDINARY")?.durationHours === "24",
      "ORDINARY_HOURS",
    );
    assert(byCategory.get("CURVED")?.durationHours === "24", "CURVED_HOURS");
    const replay = await post(
      ids.sales,
      "/capacity/estimates",
      `capacity-estimate-${run}`,
      {
        sourceTypeCode: "MANUAL",
        sourceResourceId: null,
        startAt: "2030-01-01T00:00:00.000Z",
        items: [
          { categoryCode: "STANDARD", quantityBoards: "1350" },
          { categoryCode: "ORDINARY", quantityBoards: "700" },
          { categoryCode: "CURVED", quantityBoards: "600" },
        ],
      },
    );
    const replayBody = (await replay.json()) as {
      data: { capacityEstimateId: string };
    };
    assert(
      replayBody.data.capacityEstimateId === body.data.capacityEstimateId,
      "CAPACITY_IDEMPOTENCY",
    );
    assert(
      (
        await call(
          ids.sales,
          `/capacity/estimates/${body.data.capacityEstimateId}`,
        )
      ).status === 200,
      "CAPACITY_GET",
    );
    assert(
      (await call(ids.sales, "/capacity/rates/resolve?categoryCode=STANDARD"))
        .status === 200,
      "RATE_RESOLVE",
    );
    assert(
      (await call(ids.denied, "/capacity/rates")).status === 403,
      "CAPACITY_WORKSPACE_DENY",
    );
    const effectiveFrom = new Date(
      Date.now() + 10 * 365 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const rate = await post(
      ids.operations,
      "/capacity/rates",
      `capacity-rate-${run}`,
      {
        categoryCode: "STANDARD",
        boardsPerDay: "900",
        effectiveFrom,
        effectiveTo: null,
        sourceCode: "GOVERNED_PROOF",
      },
    );
    assert(
      rate.status === 201,
      `CAPACITY_RATE_CREATE_${rate.status.toString()}`,
    );
    const invalid = await post(
      ids.operations,
      "/capacity/rates",
      `capacity-invalid-${run}`,
      {
        categoryCode: "STANDARD",
        boardsPerDay: "875",
        effectiveFrom: new Date(
          Date.now() + 11 * 365 * 24 * 60 * 60 * 1000,
        ).toISOString(),
        effectiveTo: null,
        sourceCode: "REGRESSION_PROOF",
      },
    );
    assert(invalid.status === 422, "CAPACITY_875_REGRESSION_NOT_BLOCKED");
    const [audit, stored] = await Promise.all([
      db.auditEvent.count({ where: { source: "capacity-api" } }),
      db.capacityEstimate.count({
        where: { estimateRunId: body.data.capacityEstimateId },
      }),
    ]);
    assert(audit >= 2 && stored === 3, "CAPACITY_PERSISTENCE_AUDIT");
    process.stdout.write(
      `${JSON.stringify({ CAPACITY: "PASS", GOLDEN_1350_STANDARD: "1.5 days / 36 hours", ORDINARY: "700 / 24 hours", CURVED: "600 / 24 hours", MIXED_TOTAL_ETA: "NOT_INVENTED", ESTIMATE_ONLY: "PASS", VERSIONED_RATES: "PASS", AUTHORIZATION: "PASS", IDEMPOTENCY: "PASS", POSTGRESQL: "PASS" }, null, 2)}\n`,
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
  const users = [
    [ids.sales, "capacity-sales", "capacity-sales@example.test"],
    [ids.operations, "capacity-operations", "capacity-operations@example.test"],
    [ids.denied, "capacity-denied", "capacity-denied@example.test"],
  ] as const;
  for (const [id, subject, email] of users)
    await db.appUser.upsert({
      where: { id },
      create: {
        id,
        externalSubject: subject,
        displayName: subject,
        emailNormalized: email,
      },
      update: { active: true, authStatusCode: "ACTIVE" },
    });
  const roles = [
    [ids.salesRole, "CAPACITY_SALES_PROOF", "SALES"],
    [ids.operationsRole, "CAPACITY_OPERATIONS_PROOF", "OPERATIONS"],
    [ids.deniedRole, "CAPACITY_DENIED_PROOF", "FINANCE"],
  ] as const;
  for (const [id, code, workspace] of roles)
    await db.role.upsert({
      where: { id },
      create: { id, code, name: code, workspace },
      update: { workspace },
    });
  for (const permissionCode of [
    permissions.capacityView,
    permissions.capacityEstimate,
  ])
    await db.rolePermission.upsert({
      where: {
        roleId_permissionCode: { roleId: ids.salesRole, permissionCode },
      },
      create: { roleId: ids.salesRole, permissionCode },
      update: {},
    });
  for (const permissionCode of [
    permissions.capacityView,
    permissions.capacityEstimate,
    permissions.capacityManage,
  ])
    await db.rolePermission.upsert({
      where: {
        roleId_permissionCode: { roleId: ids.operationsRole, permissionCode },
      },
      create: { roleId: ids.operationsRole, permissionCode },
      update: {},
    });
  await db.rolePermission.upsert({
    where: {
      roleId_permissionCode: {
        roleId: ids.deniedRole,
        permissionCode: permissions.capacityView,
      },
    },
    create: {
      roleId: ids.deniedRole,
      permissionCode: permissions.capacityView,
    },
    update: {},
  });
  for (const [userId, roleId] of [
    [ids.sales, ids.salesRole],
    [ids.operations, ids.operationsRole],
    [ids.denied, ids.deniedRole],
  ] as const)
    await db.userRole.upsert({
      where: { userId_roleId: { userId, roleId } },
      create: { userId, roleId },
      update: {},
    });
  await db.country.upsert({
    where: { code: "EG" },
    create: { code: "EG", name: "Egypt", continentCode: "AFRICA" },
    update: {},
  });
  for (const userId of [ids.sales, ids.operations, ids.denied])
    await db.userCountryAccess.upsert({
      where: { userId_countryCode: { userId, countryCode: "EG" } },
      create: { userId, countryCode: "EG", grantedBy: ids.operations },
      update: { statusCode: "ACTIVE", validTo: null },
    });
}
function assert(value: unknown, code: string): asserts value {
  if (!value) throw new Error(code);
}
void main();
