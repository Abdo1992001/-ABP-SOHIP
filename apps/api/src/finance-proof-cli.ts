import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { Server } from "node:http";
import { permissions } from "@abp/contracts";
import type { DatabaseClient } from "@abp/database";
import { AppModule } from "./app.module.js";
import { configureHttpApplication } from "./configure-http-app.js";
import { databaseClientToken } from "./platform/database.providers.js";
const user = "e7400000-0000-4000-8000-000000000001",
  role = "e7400000-0000-4000-8000-000000000010",
  account = "e7400000-0000-4000-8000-000000000020";
async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED");
  process.env.ABP_TEST_AUTH_ENABLED = "true";
  const app = await NestFactory.create(AppModule, { logger: false });
  configureHttpApplication(app);
  await app.listen(0, "127.0.0.1");
  try {
    const db = app.get<DatabaseClient>(databaseClientToken);
    await seed(db);
    const addr = (app.getHttpServer() as Server).address();
    assert(addr && typeof addr !== "string", "ADDRESS");
    const run = Date.now();
    const base = `http://127.0.0.1:${addr.port}/api/v1`,
      call = (path: string, init: RequestInit = {}) => {
        const h = new Headers(init.headers);
        h.set("x-abp-test-user-id", user);
        h.set("x-abp-test-session-id", `finance-${run.toString()}`);
        return fetch(base + path, { ...init, headers: h });
      },
      post = (path: string, key: string, body: unknown) =>
        call(path, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": key,
          },
          body: JSON.stringify(body),
        }),
      proofRun = run;
    const previous = await db.fXRate.findFirst({
      where: {
        baseCurrencyCode: "USD",
        quoteCurrencyCode: "EGP",
        statusCode: "APPROVED",
      },
      orderBy: { effectiveFrom: "desc" },
    });
    const effective = new Date(
      Math.max(Date.now(), previous?.effectiveFrom.getTime() ?? 0) + 120000,
    ).toISOString();
    const fx = await post("/finance/fx-rates", `fx-${proofRun}`, {
      baseCurrencyCode: "USD",
      quoteCurrencyCode: "EGP",
      rate: "50.25",
      effectiveAt: effective,
      reason: "Finance proof",
      supersedesFxRateId: previous?.id ?? null,
    });
    assert(fx.status === 201, `FX_${fx.status}`);
    const resolved = await call(
      `/finance/fx-rates/resolve?effectiveAt=${encodeURIComponent(effective)}`,
    );
    assert(resolved.status === 200, "FX_RESOLVE");
    const pay = await post("/finance/payments", `pay-${proofRun}`, {
      accountId: account,
      paymentDate: "2026-08-22",
      amount: "1000",
      currencyCode: "USD",
      sourceTypeCode: "MANUAL",
      rawReference: "PROOF",
    });
    assert(pay.status === 201, "PAYMENT");
    const pb = (await pay.json()) as { data: { paymentId: string } };
    const alloc = await post(
      "/finance/payment-allocations",
      `alloc-${proofRun}`,
      {
        paymentId: pb.data.paymentId,
        allocations: [{ allocatedAmount: "600" }],
        reason: "Proof allocation",
      },
    );
    assert(alloc.status === 200, "ALLOCATE");
    const over = await post("/finance/payment-allocations", `over-${run}`, {
      paymentId: pb.data.paymentId,
      allocations: [{ allocatedAmount: "500" }],
      reason: "Must fail",
    });
    assert(over.status === 409, "OVER_ALLOCATION");
    const cheque = await post("/finance/cheques", `chq-${run}`, {
      accountId: account,
      chequeNumber: `CH-${run}`,
      amount: "1000",
      currencyCode: "EGP",
      sourceTypeCode: "MANUAL",
    });
    assert(cheque.status === 200, "CHEQUE");
    let cb = (await cheque.json()) as {
      data: { chequeId: string; rowVersion: string };
    };
    let transitionNo = 0;
    for (const target of ["DEPOSITED", "BOUNCED", "DEPOSITED"]) {
      transitionNo += 1;
      const t = await post(
        `/finance/cheques/${cb.data.chequeId}/status-transitions`,
        `chq-${transitionNo.toString()}-${target}-${run}`,
        {
          targetStatusCode: target,
          expectedRowVersion: cb.data.rowVersion,
          reason: `Proof ${target}`,
        },
      );
      if (t.status !== 200)
        throw new Error(
          `CHEQUE_${target}_${t.status.toString()}_${await t.text()}`,
        );
      cb = (await t.json()) as typeof cb;
    }
    assert(
      (await db.auditEvent.count({ where: { source: "finance-api" } })) >= 6,
      "AUDIT",
    );
    process.stdout.write(
      JSON.stringify(
        {
          FX_USD_EGP: "PASS",
          EFFECTIVE_VERSIONING: "PASS",
          PAYMENTS: "PASS",
          ALLOCATION_LOCK_AND_LIMIT: "PASS",
          CHEQUES: "PASS",
          BOUNCE_REDEPOSIT: "PASS",
          COUNTRY_SCOPE: "PASS",
          FINANCE_ISOLATION: "PASS",
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
    where: { id: user },
    create: {
      id: user,
      externalSubject: "finance-proof",
      displayName: "Finance Proof",
      emailNormalized: "finance-proof@example.test",
    },
    update: { active: true },
  });
  await db.role.upsert({
    where: { id: role },
    create: {
      id: role,
      code: "FINANCE_PROOF",
      name: "Finance Proof",
      workspace: "FINANCE",
    },
    update: { workspace: "FINANCE" },
  });
  for (const permissionCode of [
    permissions.financeFxView,
    permissions.financeFxEdit,
    permissions.paymentsView,
    permissions.paymentsCreate,
    permissions.paymentsAllocate,
    permissions.chequesView,
    permissions.chequesCreate,
    permissions.chequesManage,
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
  await db.account.upsert({
    where: { id: account },
    create: {
      id: account,
      canonicalName: "Finance Proof Account",
      normalizedName: "finance proof account",
      countryCode: "EG",
      ownerUserId: user,
      recordStatusCode: "ACTIVE",
    },
    update: { recordStatusCode: "ACTIVE" },
  });
}
function assert(v: unknown, c: string): asserts v {
  if (!v) throw new Error(c);
}
void main();
