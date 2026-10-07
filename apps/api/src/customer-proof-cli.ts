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
  userId: "71000000-0000-4000-8000-000000000001",
  roleId: "72000000-0000-4000-8000-000000000001",
  sessionId: `customer-proof-${crypto.randomUUID()}`,
} as const;

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED");
  process.env.ABP_TEST_AUTH_ENABLED = "true";
  const application = await NestFactory.create(AppModule, { logger: false });
  configureHttpApplication(application);
  await application.listen(0, "127.0.0.1");
  try {
    const database = application.get<DatabaseClient>(databaseClientToken);
    await seedProofIdentity(database);
    const address = (application.getHttpServer() as Server).address();
    assert(
      address !== null && typeof address !== "string",
      "HTTP_ADDRESS_MISSING",
    );
    const client = createApiClient({
      baseUrl: `http://127.0.0.1:${address.port.toString()}/api/v1`,
      fetch: proofFetch,
    });

    const created = await client.POST("/accounts", {
      params: {
        header: { "Idempotency-Key": `proof-create-${Date.now().toString()}` },
      },
      body: { canonicalName: "WS2-A Proof Customer", countryCode: "EG" },
    });
    assert(
      created.response.status === 201 && created.data !== undefined,
      `CREATE_FAILED_${created.response.status.toString()}_${JSON.stringify(created.error)}`,
    );
    const accountId = created.data.data.accountId;
    assert(
      created.response.headers.get("etag") === created.data.data.rowVersion,
      "CREATE_ETAG_FAILED",
    );

    const fetched = await client.GET("/accounts/{accountId}", {
      params: { path: { accountId } },
    });
    assert(
      fetched.data?.data.geography.marketScope === "LOCAL",
      "SERVER_GEOGRAPHY_FAILED",
    );

    const updated = await client.PATCH("/accounts/{accountId}", {
      params: {
        path: { accountId },
        header: { "If-Match": created.data.data.rowVersion },
      },
      body: { canonicalName: "WS2-A Proof Customer Updated" },
    });
    assert(
      updated.response.status === 200 &&
        updated.data?.data.rowVersion === '"rv-2"',
      "UPDATE_FAILED",
    );
    const stale = await client.PATCH("/accounts/{accountId}", {
      params: {
        path: { accountId },
        header: { "If-Match": created.data.data.rowVersion },
      },
      body: { canonicalName: "Stale Write" },
    });
    assert(stale.response.status === 412, "STALE_WRITE_NOT_REJECTED");

    const listed = await client.GET("/accounts", {
      params: { query: { search: "proof customer", archiveState: "ACTIVE" } },
    });
    const listedData = listed.data as unknown as
      { data: readonly { accountId: string }[] } | undefined;
    assert(
      listedData?.data.some(({ accountId: id }) => id === accountId) === true,
      "LIST_FAILED",
    );

    const outside = await client.POST("/accounts", {
      params: {
        header: {
          "Idempotency-Key": `proof-outside-${Date.now().toString()}`,
        },
      },
      body: { canonicalName: "Forbidden Customer", countryCode: "AE" },
    });
    assert(outside.response.status === 403, "COUNTRY_SCOPE_FAILED");

    const archived = await client.POST("/accounts/{accountId}/archive", {
      params: {
        path: { accountId },
        header: {
          "If-Match": updated.data.data.rowVersion,
          "Idempotency-Key": `proof-archive-${Date.now().toString()}`,
        },
      },
      body: { reason: "WS2-A executable proof cleanup" },
    });
    assert(
      archived.response.status === 200 &&
        archived.data?.data.recordStatusCode === "ARCHIVED",
      "ARCHIVE_FAILED",
    );

    const audit = await database.auditEvent.findMany({
      where: { resourceType: "ACCOUNT", resourceId: accountId },
      select: { actionCode: true },
      orderBy: { occurredAt: "asc" },
    });
    assert(
      JSON.stringify(audit.map(({ actionCode }) => actionCode)) ===
        JSON.stringify([
          "ACCOUNT_CREATED",
          "ACCOUNT_UPDATED",
          "ACCOUNT_ARCHIVED",
        ]),
      "AUDIT_FAILED",
    );
    process.stdout.write("CUSTOMER_SLICE_PROOF_PASSED\n");
  } finally {
    await application.close();
    delete process.env.ABP_TEST_AUTH_ENABLED;
  }
}

const proofFetch: typeof globalThis.fetch = async (input, init) => {
  const headers = new Headers(
    input instanceof Request ? input.headers : undefined,
  );
  new Headers(init?.headers).forEach((value, key) => {
    headers.set(key, value);
  });
  headers.set("x-abp-test-user-id", proof.userId);
  headers.set("x-abp-test-session-id", proof.sessionId);
  return fetch(input, { ...init, headers });
};

async function seedProofIdentity(database: DatabaseClient): Promise<void> {
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
  const required = [
    permissions.salesWorkspaceView,
    permissions.accountsView,
    permissions.accountsCreate,
    permissions.accountsEdit,
    permissions.accountsArchive,
  ];
  for (const code of required) {
    await database.permission.upsert({
      where: { code },
      create: { code, description: code },
      update: {},
    });
  }
  await database.role.upsert({
    where: { id: proof.roleId },
    create: {
      id: proof.roleId,
      code: "WS2A_PROOF_SALES",
      name: "WS2-A Proof Sales",
      workspace: "SALES",
    },
    update: { active: true, workspace: "SALES" },
  });
  for (const permissionCode of required) {
    await database.rolePermission.upsert({
      where: {
        roleId_permissionCode: { roleId: proof.roleId, permissionCode },
      },
      create: { roleId: proof.roleId, permissionCode },
      update: {},
    });
  }
  await database.appUser.upsert({
    where: { id: proof.userId },
    create: {
      id: proof.userId,
      externalSubject: "ws2a-proof-subject",
      displayName: "WS2-A Proof User",
      emailNormalized: "ws2a-proof@example.test",
    },
    update: { active: true, authStatusCode: "ACTIVE" },
  });
  await database.userProfile.upsert({
    where: { userId: proof.userId },
    create: { userId: proof.userId, displayName: "WS2-A Proof User" },
    update: { displayName: "WS2-A Proof User" },
  });
  await database.userRole.upsert({
    where: { userId_roleId: { userId: proof.userId, roleId: proof.roleId } },
    create: { userId: proof.userId, roleId: proof.roleId },
    update: {},
  });
  await database.userCountryAccess.upsert({
    where: { userId_countryCode: { userId: proof.userId, countryCode: "EG" } },
    create: {
      userId: proof.userId,
      countryCode: "EG",
      grantedBy: proof.userId,
    },
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
