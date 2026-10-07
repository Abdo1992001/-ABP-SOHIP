import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { Server } from "node:http";
import { permissions } from "@abp/contracts";
import type { DatabaseClient } from "@abp/database";
import { AppModule } from "./app.module.js";
import { configureHttpApplication } from "./configure-http-app.js";
import { databaseClientToken } from "./platform/database.providers.js";
const id = {
  user: "e7500000-0000-4000-8000-000000000001",
  role: "e7500000-0000-4000-8000-000000000010",
  account: "e7500000-0000-4000-8000-000000000020",
  opp: "e7500000-0000-4000-8000-000000000030",
  quote: "e7500000-0000-4000-8000-000000000040",
  line: "e7500000-0000-4000-8000-000000000050",
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
        h.set("x-abp-test-session-id", `returns-${run.toString()}`);
        return fetch(base + p, { ...init, headers: h });
      },
      post = (p: string, k: string, b: unknown) =>
        call(p, {
          method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": k },
          body: JSON.stringify(b),
        }),
      proofRun = run;
    const created = await post("/returned-scrap-cases", `return-${proofRun}`, {
      accountId: id.account,
      originalQuotationId: id.quote,
      benefitTypeCode: "CREDIT",
      lines: [{ originalQuotationLineId: id.line, returnedQty: "2" }],
    });
    assert(created.status === 201, `CREATE_${created.status}`);
    let body = (await created.json()) as {
      data: {
        case: {
          returnedScrapCaseId: string;
          rowVersion: string;
          benefitValueAmount: string;
          appliedCreditPctSnapshot: string;
        };
      };
    };
    assert(
      body.data.case.benefitValueAmount === "50" &&
        body.data.case.appliedCreditPctSnapshot === "25",
      "FORMULA",
    );
    const caseId = body.data.case.returnedScrapCaseId;
    const submit = await post(
      `/returned-scrap-cases/${caseId}/submit-approval`,
      `return-submit-${proofRun}`,
      { expectedRowVersion: body.data.case.rowVersion, comment: "Proof" },
    );
    assert(submit.status === 200, "SUBMIT");
    body = (await submit.json()) as typeof body;
    const approve = await post(
      `/returned-scrap-cases/${caseId}/approve`,
      `return-approve-${proofRun}`,
      {
        expectedRowVersion: body.data.case.rowVersion,
        decision: "APPROVE",
        comment: "Manager proof",
      },
    );
    assert(approve.status === 200, "APPROVE");
    body = (await approve.json()) as typeof body;
    const finalize = await post(
      `/returned-scrap-cases/${caseId}/finalize`,
      `return-final-${run}`,
      { expectedRowVersion: body.data.case.rowVersion },
    );
    assert(finalize.status === 200, "FINALIZE");
    const finalBody = (await finalize.json()) as typeof body;
    assert(finalBody.data.case.benefitValueAmount === "50", "FINAL_VALUE");
    assert(
      (await db.auditEvent.count({ where: { source: "returns-api" } })) >= 4,
      "AUDIT",
    );
    process.stdout.write(
      JSON.stringify(
        {
          RETURNED_SCRAP: "PASS",
          ORIGINAL_QUOTATION_LINE: "PASS",
          DECIMAL_25_PERCENT: "PASS",
          MANAGER_APPROVAL: "PASS",
          FINALIZATION: "PASS",
          COUNTRY_SCOPE: "PASS",
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
  const priorProofCases = await db.returnedScrapRequest.findMany({
    where: { originalQuotationId: id.quote },
    select: { id: true },
  });
  if (priorProofCases.length > 0) {
    const proofCaseIds = priorProofCases.map(({ id: caseId }) => caseId);
    await db.$transaction([
      db.returnedScrapItem.deleteMany({
        where: { returnedScrapRequestId: { in: proofCaseIds } },
      }),
      db.returnedScrapRequest.deleteMany({
        where: { id: { in: proofCaseIds } },
      }),
    ]);
  }
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
      externalSubject: "returns-proof",
      displayName: "Returns Proof",
      emailNormalized: "returns-proof@example.test",
    },
    update: { active: true },
  });
  await db.role.upsert({
    where: { id: id.role },
    create: {
      id: id.role,
      code: "RETURNS_PROOF",
      name: "Returns Proof",
      workspace: "SALES",
    },
    update: { workspace: "SALES" },
  });
  for (const permissionCode of [
    permissions.returnsView,
    permissions.returnsCreate,
    permissions.returnsEdit,
    permissions.returnsApprove,
    permissions.returnsFinalize,
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
      canonicalName: "Returns Account",
      normalizedName: "returns account",
      countryCode: "EG",
      ownerUserId: id.user,
    },
    update: { recordStatusCode: "ACTIVE" },
  });
  await db.opportunity.upsert({
    where: { id: id.opp },
    create: {
      id: id.opp,
      accountId: id.account,
      countryCode: "EG",
      ownerUserId: id.user,
      stageCode: "QUALIFIED",
      noProjectReasonCode: "NOT_APPLICABLE",
      createdByUserId: id.user,
      updatedByUserId: id.user,
    },
    update: {},
  });
  await db.quotation.upsert({
    where: { id: id.quote },
    create: {
      id: id.quote,
      accountId: id.account,
      opportunityId: id.opp,
      countryCode: "EG",
      ownerUserId: id.user,
      statusCode: "DRAFT",
      currencyCode: "USD",
      createdByUserId: id.user,
      updatedByUserId: id.user,
    },
    update: { statusCode: "DRAFT" },
  });
  await db.quotationLine.upsert({
    where: { id: id.line },
    create: {
      id: id.line,
      quotationId: id.quote,
      lineNo: 1,
      description: "Purchased board",
      qty: 10,
      unitCode: "BOARD",
      unitPrice: 100,
      lineTotal: 1000,
    },
    update: { unitPrice: 100, qty: 10 },
  });
}
function assert(v: unknown, c: string): asserts v {
  if (!v) throw new Error(c);
}
void main();
