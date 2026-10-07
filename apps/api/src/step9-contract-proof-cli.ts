import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { Server } from "node:http";
import { permissions } from "@abp/contracts";
import type { DatabaseClient } from "@abp/database";
import { AppModule } from "./app.module.js";
import { configureHttpApplication } from "./configure-http-app.js";
import { databaseClientToken } from "./platform/database.providers.js";

const ids = {
  user: "59000000-0000-4000-8000-000000000001",
  outsider: "59000000-0000-4000-8000-000000000002",
  adminRole: "59000000-0000-4000-8000-000000000003",
  financeRole: "59000000-0000-4000-8000-000000000004",
  operationsRole: "59000000-0000-4000-8000-000000000005",
  account: "59000000-0000-4000-8000-000000000006",
  upload: "59000000-0000-4000-8000-000000000007",
  job: "59000000-0000-4000-8000-000000000008",
  document: "59000000-0000-4000-8000-000000000009",
  documentVersion: "59000000-0000-4000-8000-000000000010",
  payment: "59000000-0000-4000-8000-000000000011",
  correction: "59000000-0000-4000-8000-000000000012",
  allocation: "59000000-0000-4000-8000-000000000013",
  importBatch: "59000000-0000-4000-8000-000000000014",
  dq: "59000000-0000-4000-8000-000000000015",
  reconciliation: "59000000-0000-4000-8000-000000000016",
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
    const address = (app.getHttpServer() as Server).address();
    assert(address && typeof address !== "string", "ADDRESS");
    const base = `http://127.0.0.1:${String(address.port)}/api/v1`,
      run = String(Date.now());
    const call = (user: string, path: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      headers.set("x-abp-test-user-id", user);
      headers.set("x-abp-test-session-id", `step9-${user.slice(-4)}-${run}`);
      return fetch(base + path, { ...init, headers });
    };
    const json = (
      path: string,
      body: unknown,
      headers: Record<string, string> = {},
      method = "POST",
    ) =>
      call(ids.user, path, {
        method,
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
      });
    const ok = async (response: Response, name: string, statuses = [200]) => {
      if (!statuses.includes(response.status))
        throw new Error(
          `${name}_${String(response.status)}_${await response.text()}`,
        );
      return response;
    };

    const createdTemplate = await ok(
      await json(
        "/admin/document-templates",
        {
          code: `QUOTE_${run}`,
          name: "Quotation",
          documentTypeCode: "OFFICIAL_QUOTATION",
          languageCode: "en",
          brandCode: "ACROW",
        },
        { "idempotency-key": `template-${run}` },
      ),
      "TEMPLATE_CREATE",
      [201],
    );
    const template = (await createdTemplate.json()) as {
      data: { templateId: string };
    };
    const createdVersion = await ok(
      await json(
        `/admin/document-templates/${template.data.templateId}/versions`,
        { content: "<h1>{{quotationNumber}}</h1><p>{{customerName}}</p>" },
        { "idempotency-key": `version-${run}` },
      ),
      "VERSION_CREATE",
      [201],
    );
    const version = (await createdVersion.json()) as {
      data: { templateVersionId: string; rowVersion: string };
    };
    const updated = await ok(
      await json(
        `/admin/document-template-versions/${version.data.templateVersionId}`,
        {
          content:
            "<h1>{{quotationNumber}}</h1><p>{{customerName}} {{validUntil}}</p>",
        },
        {
          "idempotency-key": `version-update-${run}`,
          "if-match": `"rv-${version.data.rowVersion}"`,
        },
        "PATCH",
      ),
      "VERSION_UPDATE",
    );
    const updatedBody = (await updated.json()) as {
      data: { rowVersion: string };
    };
    const preview = await ok(
      await call(
        ids.user,
        `/admin/document-template-versions/${version.data.templateVersionId}/preview`,
      ),
      "PREVIEW",
    );
    const previewBody = (await preview.json()) as {
      data: { renderedContent: string };
    };
    assert(
      previewBody.data.renderedContent.includes("Q-DEMO-0001"),
      "PREVIEW_NOT_RENDERED",
    );
    await ok(
      await json(
        `/admin/document-template-versions/${version.data.templateVersionId}/status-transitions`,
        { targetStatusCode: "ACTIVATE", reason: "approved proof" },
        {
          "idempotency-key": `version-active-${run}`,
          "if-match": `"rv-${updatedBody.data.rowVersion}"`,
        },
      ),
      "VERSION_ACTIVATE",
    );
    const immutable = await json(
      `/admin/document-template-versions/${version.data.templateVersionId}`,
      { content: "forbidden" },
      { "idempotency-key": `version-illegal-${run}`, "if-match": '"rv-3"' },
      "PATCH",
    );
    assert(immutable.status === 409, "PUBLISHED_VERSION_MUTATED");
    await ok(
      await call(
        ids.user,
        `/admin/document-templates/${template.data.templateId}/versions`,
      ),
      "VERSION_HISTORY",
    );

    const job = await ok(
      await call(ids.user, `/jobs/${ids.job}`),
      "JOB_STATUS",
    );
    const jobBody = (await job.json()) as { data: Record<string, unknown> };
    assert(
      !("payload" in jobBody.data) && !("errorMessage" in jobBody.data),
      "JOB_INTERNAL_LEAK",
    );
    assert(
      (await call(ids.outsider, `/jobs/${ids.job}`)).status === 404,
      "JOB_IDOR",
    );

    const payment = await ok(
      await call(ids.user, `/finance/payments/${ids.payment}`),
      "PAYMENT_DETAIL",
    );
    const paymentBody = (await payment.json()) as {
      data: { allocations: unknown[]; source: { rawReference: string } };
    };
    assert(
      paymentBody.data.allocations.length === 1 &&
        paymentBody.data.source.rawReference === "SENSITIVE-SOURCE",
      "PAYMENT_DETAIL_INCOMPLETE",
    );
    const payments = await ok(
      await call(ids.user, "/finance/payments?limit=100"),
      "PAYMENT_LIST",
    );
    const paymentsBody = (await payments.json()) as {
      data: Record<string, unknown>[];
    };
    const listItem = paymentsBody.data.find((x) => x.paymentId === ids.payment);
    assert(listItem && !("rawReference" in listItem), "PAYMENT_LIST_LEAK");

    const docs = await ok(
      await call(ids.user, "/documents?limit=100"),
      "DOCUMENT_LIST",
    );
    const docsBody = (await docs.json()) as { data: { documentId: string }[] };
    assert(
      docsBody.data.some((x) => x.documentId === ids.document),
      "DOCUMENT_LIST_MISSING",
    );
    const versions = await ok(
      await call(ids.user, `/documents/${ids.document}/versions`),
      "DOCUMENT_VERSIONS",
    );
    const versionsBody = (await versions.json()) as {
      data: { contentHash: string }[];
    };
    assert(
      versionsBody.data[0]?.contentHash === "step9-proof-hash",
      "DOCUMENT_PROVENANCE_MISSING",
    );

    const dq = await ok(
      await call(ids.user, "/data-quality/issues?statusCode=OPEN"),
      "GLOBAL_DQ",
    );
    const dqBody = (await dq.json()) as { data: { issueId: string }[] };
    assert(
      dqBody.data.some((x) => x.issueId === ids.dq),
      "DQ_QUEUE_MISSING",
    );
    const reconciliation = await ok(
      await call(ids.user, "/reconciliation-runs?limit=100"),
      "RECONCILIATION_HISTORY",
    );
    const reconciliationBody = (await reconciliation.json()) as {
      data: { reconciliationRunId: string }[];
    };
    assert(
      reconciliationBody.data.some(
        (x) => x.reconciliationRunId === ids.reconciliation,
      ),
      "RECONCILIATION_HISTORY_MISSING",
    );
    process.stdout.write(
      JSON.stringify(
        {
          CD_S9_001: "PASS",
          JOB_AUTHORIZATION: "PASS",
          TEMPLATE_IMMUTABILITY: "PASS",
          PAYMENT_PROJECTION: "PASS",
          DOCUMENT_VERSION_PROVENANCE: "PASS",
          GLOBAL_DQ: "PASS",
          RECONCILIATION_HISTORY: "PASS",
          POSTGRESQL: "PASS",
          operationsAdded: 14,
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
  for (const [id, externalSubject, displayName] of [
    [ids.user, "step9-proof", "Step 9 Proof"],
    [ids.outsider, "step9-outsider", "Step 9 Outsider"],
  ] as const)
    await db.appUser.upsert({
      where: { id },
      create: {
        id,
        externalSubject,
        displayName,
        emailNormalized: `${externalSubject}@example.test`,
      },
      update: { active: true, authStatusCode: "ACTIVE" },
    });
  for (const [id, code, workspace] of [
    [ids.adminRole, "STEP9_ADMIN", "ADMIN"],
    [ids.financeRole, "STEP9_FINANCE", "FINANCE"],
    [ids.operationsRole, "STEP9_OPERATIONS", "OPERATIONS"],
  ] as const) {
    await db.role.upsert({
      where: { id },
      create: { id, code, name: code, workspace },
      update: { active: true, workspace },
    });
    for (const permissionCode of Object.values(permissions))
      await db.rolePermission.upsert({
        where: { roleId_permissionCode: { roleId: id, permissionCode } },
        create: { roleId: id, permissionCode },
        update: {},
      });
    await db.userRole.upsert({
      where: { userId_roleId: { userId: ids.user, roleId: id } },
      create: { userId: ids.user, roleId: id },
      update: {},
    });
  }
  await db.userRole.upsert({
    where: { userId_roleId: { userId: ids.outsider, roleId: ids.adminRole } },
    create: { userId: ids.outsider, roleId: ids.adminRole },
    update: {},
  });
  for (const userId of [ids.user, ids.outsider])
    await db.userCountryAccess.upsert({
      where: { userId_countryCode: { userId, countryCode: "EG" } },
      create: { userId, countryCode: "EG", grantedBy: ids.user },
      update: { statusCode: "ACTIVE", validTo: null },
    });
  await db.account.upsert({
    where: { id: ids.account },
    create: {
      id: ids.account,
      canonicalName: "Step 9 Account",
      normalizedName: "step 9 account",
      countryCode: "EG",
      ownerUserId: ids.user,
    },
    update: { countryCode: "EG", ownerUserId: ids.user },
  });
  await db.uploadSession.upsert({
    where: { id: ids.upload },
    create: {
      id: ids.upload,
      requestedByUserId: ids.user,
      documentTypeCode: "GENERAL",
      fileName: "proof.pdf",
      expectedMimeType: "application/pdf",
      expectedSizeBytes: 1n,
      storageKey: `step9/${ids.upload}`,
      expiresAt: new Date(Date.now() + 3600000),
    },
    update: { requestedByUserId: ids.user },
  });
  await db.durableJob.upsert({
    where: { id: ids.job },
    create: {
      id: ids.job,
      type: "MALWARE_SCAN",
      status: "PROCESSING",
      payload: { secret: "never-return" },
      progress: 50,
      traceId: "step9-trace",
      correlationId: "step9-correlation",
      sourceType: "UPLOAD_SESSION",
      sourceId: ids.upload,
    },
    update: {
      status: "PROCESSING",
      sourceType: "UPLOAD_SESSION",
      sourceId: ids.upload,
    },
  });
  await db.documentMetadata.upsert({
    where: { id: ids.document },
    create: {
      id: ids.document,
      resourceTypeCode: "ACCOUNT",
      resourceId: ids.account,
      storageKey: `step9/${ids.document}`,
      mimeType: "application/pdf",
      sizeBytes: 10n,
      fileHash: "step9-proof-hash",
      classificationCode: "PRIVATE",
      documentTypeCode: "GENERAL",
      title: "Step 9 Proof",
      createdByUserId: ids.user,
      versions: {
        create: {
          id: ids.documentVersion,
          versionNo: 1,
          storageKey: `step9/${ids.document}/v1`,
          mimeType: "application/pdf",
          sizeBytes: 10n,
          contentHash: "step9-proof-hash",
          sourceTypeCode: "UPLOADED",
          createdByUserId: ids.user,
        },
      },
    },
    update: { resourceId: ids.account },
  });
  await db.payment.upsert({
    where: { id: ids.payment },
    create: {
      id: ids.payment,
      sourceSystemCode: "ERP",
      sourcePaymentKey: "STEP9-PAY",
      accountId: ids.account,
      amount: "100",
      currencyCode: "USD",
      statusCode: "ACTIVE",
      rawReference: "SENSITIVE-SOURCE",
      createdByUserId: ids.user,
    },
    update: { accountId: ids.account, rawReference: "SENSITIVE-SOURCE" },
  });
  await db.payment.upsert({
    where: { id: ids.correction },
    create: {
      id: ids.correction,
      sourceSystemCode: "MANUAL",
      sourcePaymentKey: "STEP9-CORRECTION",
      accountId: ids.account,
      amount: "10",
      currencyCode: "USD",
      statusCode: "ACTIVE",
      correctionOfPaymentId: ids.payment,
      createdByUserId: ids.user,
    },
    update: { correctionOfPaymentId: ids.payment },
  });
  await db.paymentAllocation.upsert({
    where: { id: ids.allocation },
    create: {
      id: ids.allocation,
      paymentId: ids.payment,
      allocatedAmount: "50",
      createdByUserId: ids.user,
    },
    update: { paymentId: ids.payment },
  });
  await db.importBatch.upsert({
    where: { id: ids.importBatch },
    create: {
      id: ids.importBatch,
      sourceSystemCode: "ERP",
      sourceSystemId: ids.account,
      importTypeCode: "SALES_ORDERS",
      sourceFingerprint: `step9-${ids.importBatch}`,
      actorUserId: ids.user,
    },
    update: { actorUserId: ids.user },
  });
  await db.dQIssue.upsert({
    where: { id: ids.dq },
    create: {
      id: ids.dq,
      importBatchId: ids.importBatch,
      sourceEntityCode: "ORDER",
      sourceRecordKey: "ROW-1",
      ruleCode: "DATA_CONFLICT",
      severityCode: "ERROR",
      message: "Proof conflict",
    },
    update: { importBatchId: ids.importBatch, statusCode: "OPEN" },
  });
  await db.reconciliationRun.upsert({
    where: { id: ids.reconciliation },
    create: {
      id: ids.reconciliation,
      importBatchId: ids.importBatch,
      reconciliationTypeCode: "ORDER",
      statusCode: "COMPLETED",
      summary: { mapped: 1, unmapped: 0 },
      createdByUserId: ids.user,
      startedAt: new Date(),
      completedAt: new Date(),
    },
    update: { createdByUserId: ids.user, statusCode: "COMPLETED" },
  });
}
function assert(value: unknown, code: string): asserts value {
  if (!value) throw new Error(code);
}
void main();
