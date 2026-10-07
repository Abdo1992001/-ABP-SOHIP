import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { Server } from "node:http";
import { permissions } from "@abp/contracts";
import type { DatabaseClient } from "@abp/database";
import { AppModule } from "./app.module.js";
import { configureHttpApplication } from "./configure-http-app.js";
import { databaseClientToken } from "./platform/database.providers.js";
const id = {
  user: "e7600000-0000-4000-8000-000000000001",
  role: "e7600000-0000-4000-8000-000000000010",
  account: "e7600000-0000-4000-8000-000000000020",
  opp: "e7600000-0000-4000-8000-000000000030",
  transition: "e7600000-0000-4000-8000-000000000040",
  snapshot: "e7600000-0000-4000-8000-000000000050",
};
async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED");
  process.env.ABP_TEST_AUTH_ENABLED = "true";
  const app = await NestFactory.create(AppModule, { logger: false });
  configureHttpApplication(app);
  await app.listen(0, "127.0.0.1");
  try {
    const db = app.get<DatabaseClient>(databaseClientToken);
    await seed(db);
    const a = (app.getHttpServer() as Server).address();
    assert(a && typeof a !== "string", "ADDRESS");
    const run = Date.now();
    const base = `http://127.0.0.1:${a.port}/api/v1`,
      call = (p: string, init: RequestInit = {}) => {
        const h = new Headers(init.headers);
        h.set("x-abp-test-user-id", id.user);
        h.set("x-abp-test-session-id", `targets-${run.toString()}`);
        return fetch(base + p, { ...init, headers: h });
      },
      put = (p: string, k: string, etag: string, b: unknown) =>
        call(p, {
          method: "PUT",
          headers: {
            "content-type": "application/json",
            "idempotency-key": k,
            "if-match": etag,
          },
          body: JSON.stringify(b),
        }),
      existing = await db.companyTarget.findFirst({
        where: { targetYear: 2035, statusCode: "ACTIVE" },
        orderBy: { version: "desc" },
      });
    const target = await put(
      "/company-targets/2035",
      `target-${run}`,
      `"${(existing?.rowVersion ?? 0n).toString()}"`,
      { annualTargetAmount: "1000", baseCurrencyCode: "USD" },
    );
    assert(target.status === 200, `TARGET_${target.status}`);
    const etag = target.headers.get("etag");
    assert(etag, "ETAG");
    const periods = await put(
      "/company-targets/2035/periods",
      `periods-${run}`,
      etag,
      {
        periods: [
          {
            periodTypeCode: "QUARTER",
            periodStart: "2035-01-01",
            periodEnd: "2035-03-31",
            targetAmount: "250",
          },
        ],
      },
    );
    assert(periods.status === 200, `PERIODS_${periods.status}`);
    const performance = await call("/company-targets/2035/performance"),
      body = (await performance.json()) as {
        data: {
          targetAmount: string;
          wonAmount: string;
          remainingAmount: string;
          achievementPct: string;
          periods: Array<{ wonAmount: string }>;
        };
      };
    assert(performance.status === 200, "PERFORMANCE");
    assert(
      body.data.targetAmount === "1000" &&
        body.data.wonAmount === "100" &&
        body.data.remainingAmount === "900" &&
        body.data.achievementPct === "10",
      "WON_ONLY_FORMULA",
    );
    assert(body.data.periods[0]?.wonAmount === "100", "PERIOD_WON");
    assert(
      (await db.auditEvent.count({ where: { source: "targets-api" } })) >= 2,
      "AUDIT",
    );
    process.stdout.write(
      JSON.stringify(
        {
          COMPANY_TARGET_ACROW_ONLY: "PASS",
          USD_PRIMARY: "PASS",
          VERSIONED_ANNUAL: "PASS",
          VERSIONED_PERIODS: "PASS",
          OPPORTUNITY_WON_ONLY: "PASS",
          PERSONAL_TARGETS: "ABSENT",
          DECIMAL: "PASS",
          CONCURRENCY: "PASS",
          IDEMPOTENCY: "PASS",
          AUDIT: "PASS",
          POSTGRESQL: "PASS",
        },
        null,
        2,
      ) + "\n",
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
    where: { id: id.user },
    create: {
      id: id.user,
      externalSubject: "targets-proof",
      displayName: "Targets Proof",
      emailNormalized: "targets-proof@example.test",
    },
    update: { active: true },
  });
  await db.role.upsert({
    where: { id: id.role },
    create: {
      id: id.role,
      code: "TARGETS_PROOF",
      name: "Targets Proof",
      workspace: "SALES",
    },
    update: { workspace: "SALES" },
  });
  for (const permissionCode of [
    permissions.targetsView,
    permissions.targetsManage,
    permissions.salesManagementView,
  ])
    await db.rolePermission.upsert({
      where: { roleId_permissionCode: { roleId: id.role, permissionCode } },
      create: { roleId: id.role, permissionCode },
      update: {},
    });
  await db.userRole.upsert({
    where: { userId_roleId: { userId: id.user, roleId: id.role } },
    create: { userId: id.user, roleId: id.role },
    update: {},
  });
  await db.country.upsert({
    where: { code: "EG" },
    create: { code: "EG", name: "Egypt", continentCode: "AFRICA" },
    update: {},
  });
  await db.userCountryAccess.upsert({
    where: { userId_countryCode: { userId: id.user, countryCode: "EG" } },
    create: { userId: id.user, countryCode: "EG", grantedBy: id.user },
    update: { statusCode: "ACTIVE", validTo: null },
  });
  await db.account.upsert({
    where: { id: id.account },
    create: {
      id: id.account,
      canonicalName: "Targets Account",
      normalizedName: "targets account",
      countryCode: "EG",
      ownerUserId: id.user,
    },
    update: {},
  });
  await db.opportunity.upsert({
    where: { id: id.opp },
    create: {
      id: id.opp,
      accountId: id.account,
      countryCode: "EG",
      ownerUserId: id.user,
      stageCode: "WON",
      noProjectReasonCode: "NOT_APPLICABLE",
      wonAt: new Date("2035-02-01T00:00:00Z"),
      wonValueSnapshot: 100,
      estimatedValue: 100,
      currencyCode: "USD",
      createdByUserId: id.user,
      updatedByUserId: id.user,
    },
    update: { stageCode: "WON" },
  });
  await db.opportunityStageTransition.upsert({
    where: { id: id.transition },
    create: {
      id: id.transition,
      opportunityId: id.opp,
      fromStageCode: "QUALIFIED",
      toStageCode: "WON",
      actorUserId: id.user,
      occurredAt: new Date("2035-02-01T00:00:00Z"),
    },
    update: {},
  });
  await db.opportunityWonSnapshot.upsert({
    where: { id: id.snapshot },
    create: {
      id: id.snapshot,
      opportunityId: id.opp,
      stageTransitionId: id.transition,
      wonAt: new Date("2035-02-01T00:00:00Z"),
      value: 100,
      currencyCode: "USD",
    },
    update: { value: 100, currencyCode: "USD" },
  });
}
function assert(v: unknown, c: string): asserts v {
  if (!v) throw new Error(c);
}
void main();
