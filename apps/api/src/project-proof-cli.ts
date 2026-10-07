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
  ownerUserId: "82000000-0000-4000-8000-000000000001",
  ownerRoleId: "83000000-0000-4000-8000-000000000001",
  egyptUserId: "82000000-0000-4000-8000-000000000002",
  egyptRoleId: "83000000-0000-4000-8000-000000000002",
} as const;

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED");
  process.env.ABP_TEST_AUTH_ENABLED = "true";
  const application = await NestFactory.create(AppModule, { logger: false });
  configureHttpApplication(application);
  await application.listen(0, "127.0.0.1");
  try {
    const database = application.get<DatabaseClient>(databaseClientToken);
    await seedProofIdentities(database);
    const address = (application.getHttpServer() as Server).address();
    assert(
      address !== null && typeof address !== "string",
      "HTTP_ADDRESS_MISSING",
    );
    const baseUrl = `http://127.0.0.1:${address.port.toString()}/api/v1`;
    const owner = createApiClient({
      baseUrl,
      fetch: proofFetch(proof.ownerUserId, "project-owner-proof"),
    });
    const egyptOnly = createApiClient({
      baseUrl,
      fetch: proofFetch(proof.egyptUserId, "project-egypt-proof"),
    });
    const suffix = Date.now().toString();
    const account = await owner.POST("/accounts", {
      params: { header: { "Idempotency-Key": `project-account-${suffix}` } },
      body: {
        canonicalName: `WS2-C Egypt Customer ${suffix}`,
        countryCode: "EG",
      },
    });
    assert(account.data !== undefined, "PROJECT_PROOF_ACCOUNT_CREATE_FAILED");
    const accountId = account.data.data.accountId;
    await database.customerShare.create({
      data: {
        accountId,
        ownerUserIdSnapshot: proof.ownerUserId,
        recipientUserId: proof.egyptUserId,
        shareScopeCode: "ACCOUNT",
        accessLevelCode: "VIEW",
        createdByUserId: proof.ownerUserId,
      },
    });

    const created = await owner.POST("/projects", {
      params: { header: { "Idempotency-Key": `project-create-${suffix}` } },
      body: {
        name: `WS2-C Riyadh Project ${suffix}`,
        countryCode: "SA",
        city: "Riyadh",
        primaryAccountId: accountId,
        primaryRoleCode: "CONTRACTOR",
      },
    });
    assert(
      created.response.status === 201 && created.data !== undefined,
      `PROJECT_CREATE_FAILED_${created.response.status.toString()}`,
    );
    const project = created.data.data;
    assert(
      created.response.headers.get("etag") === project.rowVersion,
      "PROJECT_ETAG_FAILED",
    );
    assert(
      project.geography.country.countryCode === "SA" &&
        project.geography.continent === "ASIA" &&
        project.geography.marketScope === "GLOBAL",
      "PROJECT_SERVER_GEOGRAPHY_FAILED",
    );
    assert(!("normalizedName" in project), "PROJECT_NORMALIZED_NAME_LEAKED");

    const customerVisible = await egyptOnly.GET("/accounts/{accountId}", {
      params: { path: { accountId } },
    });
    assert(
      customerVisible.response.status === 200,
      "EGYPT_CUSTOMER_CONTEXT_FAILED",
    );
    const projectDenied = await egyptOnly.GET("/projects/{projectId}", {
      params: { path: { projectId: project.projectId } },
    });
    assert(
      projectDenied.response.status === 404,
      "PROJECT_COUNTRY_SCOPE_FAILED",
    );

    const updated = await owner.PATCH("/projects/{projectId}", {
      params: {
        path: { projectId: project.projectId },
        header: { "If-Match": project.rowVersion },
      },
      body: { city: "Riyadh North" },
    });
    assert(updated.data?.data.rowVersion === '"rv-2"', "PROJECT_UPDATE_FAILED");
    const stale = await owner.PATCH("/projects/{projectId}", {
      params: {
        path: { projectId: project.projectId },
        header: { "If-Match": project.rowVersion },
      },
      body: { city: "Stale Riyadh" },
    });
    assert(stale.response.status === 412, "PROJECT_STALE_WRITE_NOT_REJECTED");

    const workId = crypto.randomUUID();
    await database.projectWorkReference.create({
      data: {
        projectId: project.projectId,
        workTypeCode: "OPPORTUNITY",
        workId,
      },
    });
    const blocked = await owner.POST("/projects/{projectId}/archive", {
      params: {
        path: { projectId: project.projectId },
        header: {
          "If-Match": updated.data.data.rowVersion,
          "Idempotency-Key": `project-archive-blocked-${suffix}`,
        },
      },
      body: { reason: "Executable active work guard" },
    });
    assert(blocked.response.status === 409, "PROJECT_ACTIVE_WORK_GUARD_FAILED");
    await database.projectWorkReference.update({
      where: { workTypeCode_workId: { workTypeCode: "OPPORTUNITY", workId } },
      data: { statusCode: "RELEASED" },
    });
    const archived = await owner.POST("/projects/{projectId}/archive", {
      params: {
        path: { projectId: project.projectId },
        header: {
          "If-Match": updated.data.data.rowVersion,
          "Idempotency-Key": `project-archive-${suffix}`,
        },
      },
      body: { reason: "WS2-C executable proof cleanup" },
    });
    assert(
      archived.response.status === 200 &&
        archived.data?.data.recordStatusCode === "ARCHIVED" &&
        archived.data.data.rowVersion === '"rv-3"',
      "PROJECT_ARCHIVE_FAILED",
    );
    const audit = await database.auditEvent.findMany({
      where: { resourceType: "PROJECT", resourceId: project.projectId },
      select: { actionCode: true, beforeSnapshot: true, afterSnapshot: true },
      orderBy: { occurredAt: "asc" },
    });
    const actions = audit.map(({ actionCode }) => actionCode);
    for (const required of [
      "PROJECT_CREATED",
      "PROJECT_UPDATED",
      "PROJECT_ARCHIVED",
    ]) {
      assert(actions.includes(required), `AUDIT_${required}_MISSING`);
    }
    assert(
      !JSON.stringify(audit).includes("normalizedName"),
      "PROJECT_AUDIT_LEAKED_SEARCH_FIELD",
    );
    process.stdout.write("PROJECT_SLICE_PROOF_PASSED\n");
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
      input instanceof Request ? input.headers : undefined,
    );
    new Headers(init?.headers).forEach((value, key) => {
      headers.set(key, value);
    });
    headers.set("x-abp-test-user-id", userId);
    headers.set("x-abp-test-session-id", sessionId);
    return fetch(input, { ...init, headers });
  };
}

async function seedProofIdentities(database: DatabaseClient): Promise<void> {
  for (const country of [
    { code: "EG", name: "Egypt", continentCode: "AFRICA" },
    { code: "SA", name: "Saudi Arabia", continentCode: "ASIA" },
  ]) {
    await database.country.upsert({
      where: { code: country.code },
      create: country,
      update: { ...country, active: true },
    });
  }
  const ownerPermissions = [
    permissions.salesWorkspaceView,
    permissions.accountsView,
    permissions.accountsCreate,
    permissions.accountsEdit,
    permissions.projectsView,
    permissions.projectsCreate,
    permissions.projectsEdit,
    permissions.projectsArchive,
  ];
  const egyptPermissions = [
    permissions.salesWorkspaceView,
    permissions.accountsView,
    permissions.projectsView,
  ];
  for (const code of [...new Set([...ownerPermissions, ...egyptPermissions])]) {
    await database.permission.upsert({
      where: { code },
      create: { code, description: code },
      update: {},
    });
  }
  await upsertIdentity(database, {
    userId: proof.ownerUserId,
    roleId: proof.ownerRoleId,
    roleCode: "WS2C_PROOF_OWNER",
    displayName: "WS2-C Proof Owner",
    permissions: ownerPermissions,
    countries: ["EG", "SA"],
  });
  await upsertIdentity(database, {
    userId: proof.egyptUserId,
    roleId: proof.egyptRoleId,
    roleCode: "WS2C_PROOF_EGYPT",
    displayName: "WS2-C Egypt-only User",
    permissions: egyptPermissions,
    countries: ["EG"],
  });
}

async function upsertIdentity(
  database: DatabaseClient,
  input: {
    userId: string;
    roleId: string;
    roleCode: string;
    displayName: string;
    permissions: readonly string[];
    countries: readonly string[];
  },
): Promise<void> {
  await database.role.upsert({
    where: { id: input.roleId },
    create: {
      id: input.roleId,
      code: input.roleCode,
      name: input.displayName,
      workspace: "SALES",
    },
    update: { active: true, workspace: "SALES" },
  });
  for (const permissionCode of input.permissions) {
    await database.rolePermission.upsert({
      where: {
        roleId_permissionCode: { roleId: input.roleId, permissionCode },
      },
      create: { roleId: input.roleId, permissionCode },
      update: {},
    });
  }
  await database.appUser.upsert({
    where: { id: input.userId },
    create: {
      id: input.userId,
      externalSubject: `${input.roleCode.toLowerCase()}-subject`,
      displayName: input.displayName,
      emailNormalized: `${input.roleCode.toLowerCase()}@example.test`,
    },
    update: { active: true, authStatusCode: "ACTIVE" },
  });
  await database.userProfile.upsert({
    where: { userId: input.userId },
    create: { userId: input.userId, displayName: input.displayName },
    update: { displayName: input.displayName },
  });
  await database.userRole.upsert({
    where: { userId_roleId: { userId: input.userId, roleId: input.roleId } },
    create: { userId: input.userId, roleId: input.roleId },
    update: {},
  });
  for (const countryCode of input.countries) {
    await database.userCountryAccess.upsert({
      where: { userId_countryCode: { userId: input.userId, countryCode } },
      create: { userId: input.userId, countryCode, grantedBy: input.userId },
      update: { statusCode: "ACTIVE", validTo: null },
    });
  }
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
