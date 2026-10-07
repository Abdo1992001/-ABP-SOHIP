import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { Server } from "node:http";
import { createApiClient, type components } from "@abp/api-client";
import { permissions } from "@abp/contracts";
import type { DatabaseClient } from "@abp/database";
import { AppModule } from "./app.module.js";
import { configureHttpApplication } from "./configure-http-app.js";
import { databaseClientToken } from "./platform/database.providers.js";

const proof = {
  ownerUserId: "84000000-0000-4000-8000-000000000001",
  ownerRoleId: "85000000-0000-4000-8000-000000000001",
  outsideUserId: "84000000-0000-4000-8000-000000000002",
  outsideRoleId: "85000000-0000-4000-8000-000000000002",
} as const;

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED");
  process.env.ABP_TEST_AUTH_ENABLED = "true";
  const application = await NestFactory.create(AppModule, { logger: false });
  configureHttpApplication(application);
  await application.listen(0, "127.0.0.1");
  try {
    const database = application.get<DatabaseClient>(databaseClientToken);
    await seedProofData(database);
    const address = (application.getHttpServer() as Server).address();
    assert(
      address !== null && typeof address !== "string",
      "HTTP_ADDRESS_MISSING",
    );
    const baseUrl = `http://127.0.0.1:${address.port.toString()}/api/v1`;
    const owner = createApiClient({
      baseUrl,
      fetch: proofFetch(proof.ownerUserId, "opportunity-owner-proof"),
    });
    const outside = createApiClient({
      baseUrl,
      fetch: proofFetch(proof.outsideUserId, "opportunity-outside-proof"),
    });
    const suffix = Date.now().toString();
    const account = await owner.POST("/accounts", {
      params: {
        header: { "Idempotency-Key": `opportunity-account-${suffix}` },
      },
      body: {
        canonicalName: `WS2-D Proof Customer ${suffix}`,
        countryCode: "EG",
      },
    });
    assert(
      account.response.status === 201 && account.data !== undefined,
      "OPPORTUNITY_ACCOUNT_CREATE_FAILED",
    );
    const created = await owner.POST("/opportunities", {
      params: { header: { "Idempotency-Key": `opportunity-create-${suffix}` } },
      body: {
        title: `Opportunity proof ${suffix}`,
        accountId: account.data.data.accountId,
        noProjectReasonCode: "DISCOVERY_PENDING",
        estimatedValue: "125000.00",
        currencyCode: "USD",
      },
    });
    assert(
      created.response.status === 201 && created.data !== undefined,
      `OPPORTUNITY_CREATE_FAILED_${created.response.status.toString()}`,
    );
    const opportunity = created.data.data;
    assert(
      opportunity.stageCode === "NEW_LEAD" &&
        opportunity.probabilityPct === "10",
      "STAGE_POLICY_DEFAULT_FAILED",
    );
    assert(
      created.response.headers.get("etag") === opportunity.rowVersion,
      "OPPORTUNITY_ETAG_FAILED",
    );
    const countryDenied = await outside.GET("/opportunities/{opportunityId}", {
      params: { path: { opportunityId: opportunity.opportunityId } },
    });
    assert(
      countryDenied.response.status === 404,
      "OPPORTUNITY_COUNTRY_SCOPE_FAILED",
    );
    const overridden = await owner.POST(
      "/opportunities/{opportunityId}/probability-overrides",
      {
        params: {
          path: { opportunityId: opportunity.opportunityId },
          header: {
            "If-Match": opportunity.rowVersion,
            "Idempotency-Key": `opportunity-override-${suffix}`,
          },
        },
        body: {
          probabilityPct: "60",
          reason: "Proof assessment",
          sourceMetadata: { sourceCode: "PROOF" },
        },
      },
    );
    assert(
      overridden.response.status === 200 &&
        overridden.data?.data.rowVersion === '"rv-2"',
      "PROBABILITY_OVERRIDE_FAILED",
    );
    const won = await owner.POST(
      "/opportunities/{opportunityId}/stage-transitions",
      {
        params: {
          path: { opportunityId: opportunity.opportunityId },
          header: {
            "If-Match": overridden.data.data.rowVersion,
            "Idempotency-Key": `opportunity-won-${suffix}`,
          },
        },
        body: { targetStageCode: "WON" },
      },
    );
    assert(
      won.response.status === 200 && won.data?.data.wonSnapshots.length === 1,
      "WON_SNAPSHOT_FAILED",
    );
    const stale = await owner.POST(
      "/opportunities/{opportunityId}/stage-transitions",
      {
        params: {
          path: { opportunityId: opportunity.opportunityId },
          header: {
            "If-Match": overridden.data.data.rowVersion,
            "Idempotency-Key": `opportunity-stale-${suffix}`,
          },
        },
        body: { targetStageCode: "HOT" },
      },
    );
    assert(
      stale.response.status === 412,
      "OPPORTUNITY_STALE_WRITE_NOT_REJECTED",
    );
    const reopened = await owner.POST(
      "/opportunities/{opportunityId}/stage-transitions",
      {
        params: {
          path: { opportunityId: opportunity.opportunityId },
          header: {
            "If-Match": won.data.data.rowVersion,
            "Idempotency-Key": `opportunity-reopen-${suffix}`,
          },
        },
        body: { targetStageCode: "HOT" },
      },
    );
    assert(reopened.data !== undefined, "REOPEN_RESPONSE_BODY_MISSING");
    const reopenedDetail = reopened.data
      .data as components["schemas"]["OpportunityDetail"];
    assert(
      reopened.response.status === 200 &&
        reopenedDetail.stageHistory.some(
          (entry) => entry.eventCode === "WON_REVERSED",
        ),
      "WON_REVERSAL_FAILED",
    );
    const lost = await owner.POST(
      "/opportunities/{opportunityId}/stage-transitions",
      {
        params: {
          path: { opportunityId: opportunity.opportunityId },
          header: {
            "If-Match": reopened.data.data.rowVersion,
            "Idempotency-Key": `opportunity-lost-${suffix}`,
          },
        },
        body: { targetStageCode: "LOST", lostReasonCode: "PROOF_LOST_REASON" },
      },
    );
    assert(
      lost.response.status === 200 &&
        lost.data?.data.lostReasonCode === "PROOF_LOST_REASON",
      "GOVERNED_LOST_REASON_FAILED",
    );
    const audit = await database.auditEvent.findMany({
      where: {
        resourceType: "OPPORTUNITY",
        resourceId: opportunity.opportunityId,
      },
      select: { actionCode: true },
    });
    for (const action of [
      "OPPORTUNITY_CREATED",
      "OPPORTUNITY_PROBABILITY_OVERRIDDEN",
      "OPPORTUNITY_STAGE_CHANGED",
    ])
      assert(
        audit.some((item) => item.actionCode === action),
        `AUDIT_${action}_MISSING`,
      );
    process.stdout.write("OPPORTUNITY_SLICE_PROOF_PASSED\n");
  } finally {
    await application.close();
    delete process.env.ABP_TEST_AUTH_ENABLED;
  }
}

function proofFetch(
  userId: string,
  sessionId: string,
): typeof globalThis.fetch {
  return async (input, init) => {
    const headers = new Headers(
      typeof input === "string" || input instanceof URL
        ? undefined
        : input.headers,
    );
    new Headers(init?.headers).forEach((value, key) => {
      headers.set(key, value);
    });
    headers.set("x-abp-test-user-id", userId);
    headers.set("x-abp-test-session-id", sessionId);
    return fetch(input, { ...init, headers });
  };
}

async function seedProofData(database: DatabaseClient): Promise<void> {
  await database.country.upsert({
    where: { code: "EG" },
    create: { code: "EG", name: "Egypt", continentCode: "AFRICA" },
    update: { name: "Egypt", continentCode: "AFRICA", active: true },
  });
  await database.country.upsert({
    where: { code: "AE" },
    create: { code: "AE", name: "United Arab Emirates", continentCode: "ASIA" },
    update: {
      name: "United Arab Emirates",
      continentCode: "ASIA",
      active: true,
    },
  });
  const ownerPermissions = [
    permissions.salesWorkspaceView,
    permissions.accountsView,
    permissions.accountsCreate,
    permissions.accountsEdit,
    permissions.opportunitiesView,
    permissions.opportunitiesCreate,
    permissions.opportunitiesEdit,
    permissions.opportunitiesProbabilityOverride,
  ];
  const outsidePermissions = [
    permissions.salesWorkspaceView,
    permissions.opportunitiesView,
  ];
  for (const code of [...new Set([...ownerPermissions, ...outsidePermissions])])
    await database.permission.upsert({
      where: { code },
      create: { code, description: code },
      update: {},
    });
  await upsertIdentity(
    database,
    proof.ownerUserId,
    proof.ownerRoleId,
    "WS2D_PROOF_OWNER",
    ownerPermissions,
    ["EG"],
  );
  await upsertIdentity(
    database,
    proof.outsideUserId,
    proof.outsideRoleId,
    "WS2D_PROOF_OUTSIDE",
    outsidePermissions,
    ["AE"],
  );
  const effectiveFrom = new Date("2000-01-01T00:00:00.000Z");
  for (const [stageCode, defaultProbabilityPct] of [
    ["NEW_LEAD", "10"],
    ["HOT", "50"],
    ["WON", "100"],
    ["LOST", "0"],
  ] as const) {
    await database.opportunityStagePolicy.upsert({
      where: { stageCode_effectiveFrom: { stageCode, effectiveFrom } },
      create: { stageCode, defaultProbabilityPct, effectiveFrom },
      update: {
        defaultProbabilityPct,
        effectiveTo: null,
        statusCode: "ACTIVE",
      },
    });
  }
  await database.opportunityLostReason.upsert({
    where: {
      lostReasonCode_effectiveFrom: {
        lostReasonCode: "PROOF_LOST_REASON",
        effectiveFrom,
      },
    },
    create: {
      lostReasonCode: "PROOF_LOST_REASON",
      displayName: "Proof governed lost reason",
      effectiveFrom,
    },
    update: {
      displayName: "Proof governed lost reason",
      effectiveTo: null,
      statusCode: "ACTIVE",
    },
  });
}

async function upsertIdentity(
  database: DatabaseClient,
  userId: string,
  roleId: string,
  roleCode: string,
  grantedPermissions: readonly string[],
  countries: readonly string[],
): Promise<void> {
  await database.role.upsert({
    where: { id: roleId },
    create: { id: roleId, code: roleCode, name: roleCode, workspace: "SALES" },
    update: { active: true, workspace: "SALES" },
  });
  for (const permissionCode of grantedPermissions)
    await database.rolePermission.upsert({
      where: { roleId_permissionCode: { roleId, permissionCode } },
      create: { roleId, permissionCode },
      update: {},
    });
  await database.appUser.upsert({
    where: { id: userId },
    create: {
      id: userId,
      externalSubject: `${roleCode.toLowerCase()}-subject`,
      displayName: roleCode,
      emailNormalized: `${roleCode.toLowerCase()}@example.test`,
    },
    update: { active: true, authStatusCode: "ACTIVE" },
  });
  await database.userProfile.upsert({
    where: { userId },
    create: { userId, displayName: roleCode },
    update: { displayName: roleCode },
  });
  await database.userRole.upsert({
    where: { userId_roleId: { userId, roleId } },
    create: { userId, roleId },
    update: {},
  });
  for (const countryCode of countries)
    await database.userCountryAccess.upsert({
      where: { userId_countryCode: { userId, countryCode } },
      create: { userId, countryCode, grantedBy: userId },
      update: { statusCode: "ACTIVE", validTo: null },
    });
}

function assert(condition: boolean, code: string): asserts condition {
  if (!condition) throw new Error(code);
}
void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
});
