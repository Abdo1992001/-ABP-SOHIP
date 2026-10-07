import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { Server } from "node:http";
import { createApiClient } from "@abp/api-client";
import { permissions } from "@abp/contracts";
import type { DatabaseClient } from "@abp/database";
import { AppModule } from "./app.module.js";
import { configureHttpApplication } from "./configure-http-app.js";
import { databaseClientToken } from "./platform/database.providers.js";

const proof = {
  owner: "8a000000-0000-4000-8000-000000000001",
  outsider: "8a000000-0000-4000-8000-000000000002",
  role: "8b000000-0000-4000-8000-000000000001",
  outsiderRole: "8b000000-0000-4000-8000-000000000002",
} as const;

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED");
  process.env.ABP_TEST_AUTH_ENABLED = "true";
  const app = await NestFactory.create(AppModule, { logger: false });
  configureHttpApplication(app);
  await app.listen(0, "127.0.0.1");
  try {
    const db = app.get<DatabaseClient>(databaseClientToken);
    await seed(db);
    const address = (app.getHttpServer() as Server).address();
    assert(
      address !== null && typeof address !== "string",
      "HTTP_ADDRESS_MISSING",
    );
    const baseUrl = `http://127.0.0.1:${address.port.toString()}/api/v1`;
    const owner = createApiClient({ baseUrl, fetch: proofFetch(proof.owner) });
    const outsider = createApiClient({
      baseUrl,
      fetch: proofFetch(proof.outsider),
    });
    const suffix = Date.now().toString();
    const account = await db.account.create({
      data: {
        accountRef: `ACT-${suffix}`,
        canonicalName: `Activity proof ${suffix}`,
        normalizedName: `activity proof ${suffix}`,
        countryCode: "EG",
        ownerUserId: proof.owner,
        createdByUserId: proof.owner,
        updatedByUserId: proof.owner,
      },
    });
    const created = await owner.POST("/activities", {
      params: { header: { "Idempotency-Key": `activity-create-${suffix}` } },
      body: {
        typeCode: "FOLLOW_UP",
        subject: "Proof activity",
        dueAt: "2026-12-30T10:00:00.000Z",
        links: [
          {
            resourceTypeCode: "ACCOUNT",
            resourceId: account.id,
            isPrimary: true,
          },
        ],
      },
    });
    assert(
      created.response.status === 201 && created.data !== undefined,
      "ACTIVITY_CREATE_FAILED",
    );
    const activityId = created.data.data.activityId;
    const tag = created.response.headers.get("etag");
    assert(tag === '"rv-1"', "ACTIVITY_ETAG_CREATE_FAILED");
    const denied = await outsider.GET("/activities/{activityId}", {
      params: { path: { activityId } },
    });
    assert(denied.response.status === 403, "ACTIVITY_WORKSPACE_DENIAL_FAILED");
    const [updated, stale] = await Promise.all([
      owner.PATCH("/activities/{activityId}", {
        params: { path: { activityId }, header: { "If-Match": tag } },
        body: { subject: "Proof updated" },
      }),
      owner.PATCH("/activities/{activityId}", {
        params: { path: { activityId }, header: { "If-Match": tag } },
        body: { subject: "Stale write" },
      }),
    ]);
    assert(
      [updated.response.status, stale.response.status].sort().join(",") ===
        "200,412",
      "ACTIVITY_ETAG_RACE_FAILED",
    );
    const winner = updated.response.status === 200 ? updated : stale;
    const currentTag = winner.response.headers.get("etag");
    assert(currentTag !== null, "ACTIVITY_ETAG_UPDATE_MISSING");
    const completed = await owner.POST("/activities/{activityId}/complete", {
      params: {
        path: { activityId },
        header: { "Idempotency-Key": `activity-complete-${suffix}` },
      },
      body: { expectedRowVersion: currentTag, outcomeCode: "DONE" },
    });
    assert(
      completed.response.status === 200 &&
        completed.data?.data.taskStatusCode === "COMPLETED",
      "ACTIVITY_COMPLETE_FAILED",
    );
    const audit = await db.auditEvent.findMany({
      where: { resourceType: "ACTIVITY", resourceId: activityId },
      select: { actionCode: true },
    });
    assert(
      audit.some((item) => item.actionCode === "ACTIVITY_CREATED") &&
        audit.some((item) => item.actionCode === "ACTIVITY_COMPLETED"),
      "ACTIVITY_AUDIT_MISSING",
    );
    process.stdout.write("ACTIVITY_SLICE_PROOF_PASSED\n");
  } finally {
    await app.close();
    delete process.env.ABP_TEST_AUTH_ENABLED;
  }
}
function proofFetch(userId: string): typeof globalThis.fetch {
  return async (input, init) => {
    const headers = new Headers(
      input instanceof Request ? input.headers : undefined,
    );
    new Headers(init?.headers).forEach((value, key) => {
      headers.set(key, value);
    });
    headers.set("x-abp-test-user-id", userId);
    return fetch(input, { ...init, headers });
  };
}
async function seed(db: DatabaseClient): Promise<void> {
  await db.country.upsert({
    where: { code: "EG" },
    create: { code: "EG", name: "Egypt", continentCode: "AFRICA" },
    update: { active: true },
  });
  for (const code of Object.values(permissions))
    await db.permission.upsert({
      where: { code },
      create: { code, description: code },
      update: {},
    });
  await db.role.upsert({
    where: { code: "ACTIVITY_PROOF_SALES" },
    create: {
      id: proof.role,
      code: "ACTIVITY_PROOF_SALES",
      name: "Activity Proof Sales",
      workspace: "SALES",
    },
    update: {},
  });
  await db.role.upsert({
    where: { code: "ACTIVITY_PROOF_LOGISTICS" },
    create: {
      id: proof.outsiderRole,
      code: "ACTIVITY_PROOF_LOGISTICS",
      name: "Activity Proof Logistics",
      workspace: "LOGISTICS",
    },
    update: {},
  });
  for (const permissionCode of [
    permissions.salesWorkspaceView,
    permissions.activitiesView,
    permissions.activitiesCreate,
    permissions.activitiesEdit,
    permissions.activitiesCancel,
  ])
    await db.rolePermission.upsert({
      where: { roleId_permissionCode: { roleId: proof.role, permissionCode } },
      create: { roleId: proof.role, permissionCode },
      update: {},
    });
  for (const [id, subject, roleId] of [
    [proof.owner, "activity-proof-owner", proof.role],
    [proof.outsider, "activity-proof-outsider", proof.outsiderRole],
  ] as const) {
    await db.appUser.upsert({
      where: { id },
      create: {
        id,
        externalSubject: subject,
        displayName: subject,
        emailNormalized: `${subject}@example.test`,
      },
      update: {},
    });
    await db.userProfile.upsert({
      where: { userId: id },
      create: { userId: id, displayName: subject },
      update: {},
    });
    await db.userRole.upsert({
      where: { userId_roleId: { userId: id, roleId } },
      create: { userId: id, roleId },
      update: {},
    });
  }
  await db.userCountryAccess.upsert({
    where: { userId_countryCode: { userId: proof.owner, countryCode: "EG" } },
    create: { userId: proof.owner, countryCode: "EG", grantedBy: proof.owner },
    update: { statusCode: "ACTIVE" },
  });
}
function assert(value: unknown, code: string): asserts value {
  if (!value) throw new Error(code);
}
void main();
