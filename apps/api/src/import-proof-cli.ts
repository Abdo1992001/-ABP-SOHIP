/* eslint-disable @typescript-eslint/no-non-null-assertion */
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { Server } from "node:http";
import { permissions } from "@abp/contracts";
import type { DatabaseClient } from "@abp/database";
import { AppModule } from "./app.module.js";
import { configureHttpApplication } from "./configure-http-app.js";
import { ImportService } from "./imports/import.service.js";
import { databaseClientToken } from "./platform/database.providers.js";

const ids = {
  user: "e7100000-0000-4000-8000-000000000001",
  denied: "e7100000-0000-4000-8000-000000000002",
  other: "e7100000-0000-4000-8000-000000000003",
  role: "e7100000-0000-4000-8000-000000000010",
  deniedRole: "e7100000-0000-4000-8000-000000000011",
  product: "e7100000-0000-4000-8000-000000000020",
  family: "e7100000-0000-4000-8000-000000000021",
  sourceItem: "e7100000-0000-4000-8000-000000000022",
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
    const base = `http://127.0.0.1:${address.port}/api/v1`;
    const run = Date.now();
    const call = (user: string, path: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      headers.set("x-abp-test-user-id", user);
      headers.set("x-abp-test-session-id", `import-${run.toString()}-${user}`);
      return fetch(`${base}${path}`, { ...init, headers });
    };
    const post = (
      user: string,
      path: string,
      key: string,
      body: unknown,
      extra: Record<string, string> = {},
    ) =>
      call(user, path, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": key,
          ...extra,
        },
        body: JSON.stringify(body),
      });
    const csv = Buffer.from(`orderNumber,countryCode\nSO-VALID-${run},EG\n`);
    const created = await post(
      ids.user,
      "/import-jobs",
      `import-create-${run}`,
      {
        sourceSystemCode: "ERP",
        importTypeCode: "SALES_ORDERS",
        fileName: `orders-${run}.csv`,
        expectedSizeBytes: csv.length,
        mimeType: "text/csv",
      },
    );
    const body = (await created.json()) as { data: { importJobId: string } };
    assert(
      created.status === 201,
      `CREATE_${created.status}_${JSON.stringify(body)}`,
    );
    const importId = body.data.importJobId;
    const replay = await post(
      ids.user,
      "/import-jobs",
      `import-create-${run}`,
      {
        sourceSystemCode: "ERP",
        importTypeCode: "SALES_ORDERS",
        fileName: `orders-${run}.csv`,
        expectedSizeBytes: csv.length,
        mimeType: "text/csv",
      },
    );
    assert(replay.status === 201, "CREATE_REPLAY_FAILED");
    const importer = app.get(ImportService);
    const identity = await proofIdentity(db, ids.user);
    const preview = await importer.ingestBuffer(
      identity,
      importId,
      csv,
      "csv-v1",
      "sales-orders-v1",
    );
    assert(preview.data.statusCode === "PREVIEWED", "CSV_PREVIEW_FAILED");
    assert(
      (await call(ids.user, `/import-jobs/${importId}/rows`)).status === 200,
      "ROWS_FAILED",
    );
    assert(
      (await call(ids.other, `/import-jobs/${importId}`)).status === 404,
      "IMPORT_IDOR_FAILED",
    );
    const outsideCsv = Buffer.from(
      `orderNumber,countryCode\nSO-OUTSIDE-${run.toString()},AU\n`,
    );
    const outsideCreate = await post(
      ids.user,
      "/import-jobs",
      `import-outside-${run.toString()}`,
      {
        sourceSystemCode: "ERP",
        importTypeCode: "SALES_ORDERS",
        fileName: `outside-${run.toString()}.csv`,
        expectedSizeBytes: outsideCsv.length,
        mimeType: "text/csv",
      },
    );
    const outsideBody = (await outsideCreate.json()) as {
      data: { importJobId: string };
    };
    let countryDenied = false;
    try {
      await importer.ingestBuffer(
        identity,
        outsideBody.data.importJobId,
        outsideCsv,
        "csv-v1",
        "sales-orders-v1",
      );
    } catch (error) {
      countryDenied =
        typeof error === "object" &&
        error !== null &&
        "problem" in error &&
        (error as { problem?: { code?: string } }).problem?.code ===
          "COUNTRY_SCOPE_DENIED";
    }
    assert(countryDenied, "IMPORT_COUNTRY_SCOPE_FAILED");
    const commit = await post(
      ids.user,
      `/import-jobs/${importId}/commit`,
      `import-commit-${run}`,
      { previewFingerprint: preview.data.currentPreviewFingerprint },
    );
    const committed = (await commit.json()) as { data: { statusCode: string } };
    assert(
      commit.status === 200,
      `COMMIT_BOUNDARY_FAILED_${commit.status}_${JSON.stringify(committed)}`,
    );
    assert(
      committed.data.statusCode === "COMMIT_REQUESTED",
      "FAKE_COMMIT_STATUS",
    );
    const duplicateCommit = await post(
      ids.user,
      `/import-jobs/${importId}/commit`,
      `import-commit-${run}`,
      { previewFingerprint: preview.data.currentPreviewFingerprint },
    );
    assert(
      duplicateCommit.status === 200,
      `COMMIT_IDEMPOTENCY_FAILED_${duplicateCommit.status}_${await duplicateCommit.text()}`,
    );
    const invalidCsv = Buffer.from(
      `orderNumber,countryCode\nSO-BAD-${run.toString()},\n`,
    );
    const badCreate = await post(
      ids.user,
      "/import-jobs",
      `import-bad-${run}`,
      {
        sourceSystemCode: "ERP",
        importTypeCode: "SALES_ORDERS",
        fileName: `bad-${run}.csv`,
        expectedSizeBytes: invalidCsv.length,
        mimeType: "text/csv",
      },
    );
    const badBody = (await badCreate.json()) as {
      data: { importJobId: string };
    };
    await importer.ingestBuffer(
      identity,
      badBody.data.importJobId,
      invalidCsv,
      "csv-v1",
      "sales-orders-v1",
    );
    const issues = await call(
      ids.user,
      `/import-jobs/${badBody.data.importJobId}/issues`,
    );
    const issuesBody = (await issues.json()) as {
      data: Array<{ issueId: string }>;
    };
    assert(issuesBody.data.length === 1, "DQ_PERSISTENCE_FAILED");
    const resolved = await post(
      ids.user,
      `/data-quality/issues/${issuesBody.data[0]!.issueId}/resolve`,
      `dq-resolve-${run}`,
      { resolutionCode: "WAIVE", reason: "Governed proof" },
      { "if-match": '"rv-1"' },
    );
    assert(
      resolved.status === 200 && resolved.headers.get("etag") === '"rv-2"',
      "DQ_RESOLVE_FAILED",
    );
    const unresolved = await post(
      ids.user,
      "/item-resolver/resolve",
      `resolver-${run}`,
      {
        sourceSystemId: "e7000000-0000-4000-8000-000000000020",
        sourceItemKey: `missing-${run}`,
      },
    );
    const unresolvedBody = (await unresolved.json()) as {
      data: { statusCode: string };
    };
    assert(
      unresolvedBody.data.statusCode === "UNRESOLVED",
      "DATA_CONFLICT_FAILED",
    );
    const mapping = await post(
      ids.user,
      "/item-resolver/mappings",
      `mapping-${run}`,
      {
        sourceItemId: ids.sourceItem,
        productId: ids.product,
        mappingMethodCode: "MANUAL",
        confidencePct: "100",
        rationale: "Approved exact proof",
      },
    );
    assert(mapping.status === 201, "ITEM_MAPPING_FAILED");
    const exact = await post(
      ids.user,
      "/item-resolver/resolve",
      `resolver-exact-${run}`,
      {
        sourceSystemId: "e7000000-0000-4000-8000-000000000020",
        sourceItemKey: "SRC-PROOF",
      },
    );
    const exactBody = (await exact.json()) as { data: { statusCode: string } };
    assert(exactBody.data.statusCode === "EXACT", "ITEM_EXACT_FAILED");
    const reconciliation = await post(
      ids.user,
      "/reconciliation-runs",
      `recon-${run}`,
      {
        reconciliationTypeCode: "ORDER",
        sourceSystemId: "e7000000-0000-4000-8000-000000000020",
        filters: { countryCode: "EG" },
      },
    );
    assert(reconciliation.status === 202, "RECONCILIATION_BOUNDARY_FAILED");
    const reconciliationBody = (await reconciliation.json()) as {
      data: { reconciliationRunId: string; statusCode: string };
    };
    assert(
      reconciliationBody.data.statusCode === "PENDING",
      "FAKE_RECONCILIATION_STATUS",
    );
    assert(
      (
        await call(
          ids.user,
          `/reconciliation-runs/${reconciliationBody.data.reconciliationRunId}`,
        )
      ).status === 200,
      "RECONCILIATION_GET_FAILED",
    );
    assert(
      (await call(ids.denied, "/import-jobs")).status === 403,
      "CROSS_WORKSPACE_DENIAL_FAILED",
    );
    const [audit, outbox, jobs] = await Promise.all([
      db.auditEvent.count({ where: { source: "import-api" } }),
      db.outboxMessage.count({
        where: { aggregateType: { in: ["ImportJob", "ReconciliationRun"] } },
      }),
      db.durableJob.count({
        where: {
          sourceType: { in: ["ImportJob", "ReconciliationRun"] },
          status: "PENDING",
        },
      }),
    ]);
    assert(
      audit >= 5 && outbox >= 2 && jobs >= 2,
      "AUDIT_OUTBOX_JOB_PROOF_FAILED",
    );
    process.stdout.write(
      JSON.stringify(
        {
          ERP_IMPORT: "PASS",
          CSV: "PASS",
          XLSX: "PASS_BY_PARSER_TEST",
          DQ: "PASS",
          DATA_CONFLICT: "PASS",
          RECONCILIATION_BOUNDARY: "PASS",
          AUTHORIZATION: "PASS",
          COUNTRY_SCOPE: "PASS",
          IDOR: "PASS",
          IDEMPOTENCY: "PASS",
          AUDIT: "PASS",
          OUTBOX: "PASS",
          JOBS: "PASS",
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
  await db.country.upsert({
    where: { code: "EG" },
    create: { code: "EG", name: "Egypt", continentCode: "AFRICA" },
    update: {},
  });
  for (const [id, subject, email] of [
    [ids.user, "import-proof-user", "import-proof@example.test"],
    [ids.denied, "import-proof-denied", "import-proof-denied@example.test"],
    [ids.other, "import-proof-other", "import-proof-other@example.test"],
  ] as const)
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
  await db.role.upsert({
    where: { id: ids.role },
    create: {
      id: ids.role,
      code: "IMPORT_PROOF",
      name: "Import Proof",
      workspace: "SALES",
    },
    update: { workspace: "SALES" },
  });
  await db.role.upsert({
    where: { id: ids.deniedRole },
    create: {
      id: ids.deniedRole,
      code: "IMPORT_DENIED_PROOF",
      name: "Denied Proof",
      workspace: "LOGISTICS",
    },
    update: { workspace: "LOGISTICS" },
  });
  const importPermissions = [
    permissions.importsManage,
    permissions.importsView,
    permissions.importsCommit,
    permissions.importsRollback,
    permissions.dataQualityView,
    permissions.dataQualityManage,
    permissions.reconciliationRun,
    permissions.reconciliationView,
    permissions.reconciliationManage,
    permissions.itemResolverUse,
    permissions.itemResolverManage,
  ];
  for (const permissionCode of importPermissions) {
    await db.rolePermission.upsert({
      where: { roleId_permissionCode: { roleId: ids.role, permissionCode } },
      create: { roleId: ids.role, permissionCode },
      update: {},
    });
    await db.rolePermission.upsert({
      where: {
        roleId_permissionCode: { roleId: ids.deniedRole, permissionCode },
      },
      create: { roleId: ids.deniedRole, permissionCode },
      update: {},
    });
  }
  await db.userRole.upsert({
    where: { userId_roleId: { userId: ids.user, roleId: ids.role } },
    create: { userId: ids.user, roleId: ids.role },
    update: {},
  });
  await db.userRole.upsert({
    where: { userId_roleId: { userId: ids.other, roleId: ids.role } },
    create: { userId: ids.other, roleId: ids.role },
    update: {},
  });
  await db.userRole.upsert({
    where: { userId_roleId: { userId: ids.denied, roleId: ids.deniedRole } },
    create: { userId: ids.denied, roleId: ids.deniedRole },
    update: {},
  });
  for (const userId of [ids.user, ids.denied, ids.other])
    await db.userCountryAccess.upsert({
      where: { userId_countryCode: { userId, countryCode: "EG" } },
      create: { userId, countryCode: "EG", grantedBy: ids.user },
      update: { statusCode: "ACTIVE", validTo: null },
    });
  await db.productFamily.upsert({
    where: { id: ids.family },
    create: {
      id: ids.family,
      familyCode: "IMPORT_PROOF",
      name: "Import Proof",
    },
    update: {},
  });
  await db.product.upsert({
    where: { id: ids.product },
    create: {
      id: ids.product,
      skuCode: "IMPORT-PROOF-SKU",
      productFamilyId: ids.family,
      productTypeCode: "STANDARD_SKU",
      canonicalDescription: "Import Proof Product",
      normalizedDescription: "import proof product",
      createdByUserId: ids.user,
      updatedByUserId: ids.user,
    },
    update: {},
  });
  await db.sourceItem.upsert({
    where: { id: ids.sourceItem },
    create: {
      id: ids.sourceItem,
      sourceSystemId: "e7000000-0000-4000-8000-000000000020",
      sourceItemKey: "SRC-PROOF",
      sku: "IMPORT-PROOF-SKU",
      rawPayload: { source: "proof" },
    },
    update: {},
  });
}
async function proofIdentity(db: DatabaseClient, userId: string) {
  const user = await db.appUser.findUniqueOrThrow({
    where: { id: userId },
    include: {
      roles: { include: { role: { include: { permissions: true } } } },
      countries: true,
    },
  });
  return {
    userId: user.id,
    email: user.emailNormalized,
    displayName: user.displayName,
    authStatusCode: "ACTIVE" as const,
    rowVersion: user.rowVersion,
    lastSignInAt: user.lastSignInAt,
    jobTitle: null,
    managerUserId: null,
    teamId: null,
    sessionId: `test-${user.id}`,
    roles: user.roles.map(({ role }) => ({
      roleId: role.id,
      code: role.code,
      name: role.name,
      workspace: role.workspace,
    })),
    workspaces: new Set(user.roles.map(({ role }) => role.workspace)),
    permissions: new Set(
      user.roles.flatMap(({ role }) =>
        role.permissions.map((p) => p.permissionCode),
      ),
    ),
    deniedPermissions: new Set<string>(),
    countryCodes: new Set(user.countries.map((c) => c.countryCode.trim())),
    policyVersion: user.policyVersion,
    traceId: "import-proof-trace",
    correlationId: "import-proof-correlation",
  };
}
function assert(value: unknown, code: string): asserts value {
  if (!value) throw new Error(code);
}
void main();
