import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { Server } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DatabaseClient } from "@abp/database";
import { AppModule } from "./app.module.js";
import { configureHttpApplication } from "./configure-http-app.js";
import { databaseClientToken } from "./platform/database.providers.js";

const users = {
  customer: "71000000-0000-4000-8000-000000000001",
  pricing: "e7000000-0000-4000-8000-000000000001",
  analytics: "fa100000-0000-4000-8000-000000000001",
  logistics: "c1000000-0000-4000-8000-000000000002",
  sales: "c1000000-0000-4000-8000-000000000003",
  research: "c1000000-0000-4000-8000-000000000004",
  support: "f7700000-0000-4000-8000-000000000001",
};

const cr = {
  account: "c1000000-0000-4000-8000-000000000021",
  order: "c1000000-0000-4000-8000-000000000041",
  client: "c1000000-0000-4000-8000-000000000071",
  salesRole: "c1000000-0000-4000-8000-000000000013",
  logisticsRole: "c1000000-0000-4000-8000-000000000012",
};

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED");
  process.env.ABP_TEST_AUTH_ENABLED = "true";
  const app = await NestFactory.create(AppModule, { logger: false });
  configureHttpApplication(app);
  await app.listen(0, "127.0.0.1");
  try {
    const db = app.get<DatabaseClient>(databaseClientToken);
    // Local evidence runs must start from a deterministic rate-limit window.
    // This proof never runs with NODE_ENV=production.
    if (process.env.NODE_ENV === "production")
      throw new Error("PERFORMANCE_PROOF_FORBIDDEN_IN_PRODUCTION");
    await db.requestRateLimit.deleteMany();
    await db.rolePermission.upsert({
      where: {
        roleId_permissionCode: {
          roleId: cr.salesRole,
          permissionCode: "complaints.view",
        },
      },
      create: {
        roleId: cr.salesRole,
        permissionCode: "complaints.view",
      },
      update: {},
    });
    await db.rolePermission.upsert({
      where: {
        roleId_permissionCode: {
          roleId: cr.logisticsRole,
          permissionCode: "complaints.view",
        },
      },
      create: {
        roleId: cr.logisticsRole,
        permissionCode: "complaints.view",
      },
      update: {},
    });
    await db.externalClientIdentity.update({
      where: { id: cr.client },
      data: { statusCode: "ACTIVE", revokedAt: null },
    });
    await db.clientCustomerBinding.updateMany({
      where: { externalClientIdentityId: cr.client },
      data: {
        statusCode: "ACTIVE",
        revokedAt: null,
        validTo: null,
      },
    });
    const price = await db.pricingRule.findFirstOrThrow({
      where: { statusCode: "ACTIVE" },
      orderBy: { createdAt: "desc" },
    });
    const draft = await db.quotation.findFirstOrThrow({
      where: { statusCode: "DRAFT", ownerUserId: users.pricing },
      include: { lines: true },
      orderBy: { updatedAt: "desc" },
    });
    const address = (app.getHttpServer() as Server).address();
    if (!address || typeof address === "string")
      throw new Error("PERFORMANCE_ADDRESS_MISSING");
    const base = `http://127.0.0.1:${address.port}/api/v1`;
    const runId = Date.now();
    const call = async (
      user: string | null,
      route: string,
      init: RequestInit = {},
    ) => {
      const headers = new Headers(init.headers);
      if (user) {
        headers.set("x-abp-test-user-id", user);
        headers.set("x-abp-test-session-id", `step11-perf-${user}-${runId}`);
      }
      const response = await fetch(base + route, { ...init, headers });
      if (!response.ok)
        throw new Error(
          `PERFORMANCE_HTTP_${response.status}_${route}_${await response.text()}`,
        );
      return response;
    };
    const portal = async (route: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      headers.set("x-abp-external-issuer", "https://login.example.test/");
      headers.set("x-abp-external-subject", "client-a");
      const response = await fetch(base + route, { ...init, headers });
      if (!response.ok)
        throw new Error(
          `PERFORMANCE_PORTAL_HTTP_${response.status}_${route}_${await response.text()}`,
        );
      return response;
    };
    await call(null, "/health/live");
    const typical = await sample(60, () => call(null, "/health/live"));
    const search = await sample(40, () =>
      call(users.customer, "/accounts?search=proof&limit=25"),
    );
    const pricing = await sample(30, () =>
      call(users.pricing, "/pricing/resolve", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `perf-price-${crypto.randomUUID()}`,
        },
        body: JSON.stringify({
          productId: price.productId,
          qty: "10",
          currencyCode: price.currencyCode.trim(),
        }),
      }),
    );
    let currentVersion = `"rv-${draft.rowVersion.toString()}"`;
    const line = draft.lines[0];
    if (!line) throw new Error("PERFORMANCE_DRAFT_LINE_MISSING");
    const autosave = await sample(12, async () => {
      const response = await call(
        users.pricing,
        `/quotations/${draft.id}/draft-content`,
        {
          method: "PUT",
          headers: {
            "content-type": "application/json",
            "if-match": currentVersion,
          },
          body: JSON.stringify({
            lines: [
              {
                productId: line.productId,
                description: line.description,
                qty: line.qty.toString(),
                unitCode: line.unitCode,
                unitPrice: line.unitPrice.toString(),
                discountAmount: line.discountAmount.toString(),
              },
            ],
            paymentTermsCode: draft.paymentTermsCode,
            validFrom: draft.validFrom?.toISOString().slice(0, 10),
            expiresOn: draft.expiresOn?.toISOString().slice(0, 10),
          }),
        },
      );
      const body = (await response.json()) as { data: { rowVersion: string } };
      currentVersion = body.data.rowVersion;
      return response;
    });
    const at = encodeURIComponent("2197-12-31T23:59:59.999Z");
    const dashboard = await sample(20, () =>
      call(
        users.analytics,
        `/analytics/reports/RPT-006?asOf=${at}&currency=USD`,
      ),
    );
    const drilldown = await sample(12, () =>
      call(
        users.analytics,
        `/analytics/reports/RPT-006/drilldown?asOf=${at}&currency=USD&offset=0&limit=25&sort=date_desc`,
      ),
    );
    const topCustomers = await sample(10, () =>
      call(
        users.analytics,
        `/analytics/metrics/MET-CUST-003?asOf=${at}&currency=USD`,
      ),
    );
    const topCountries = await sample(10, () =>
      call(
        users.analytics,
        `/analytics/metrics/MET-GEO-004?asOf=${at}&currency=USD`,
      ),
    );
    const customerSegments = await sample(10, () =>
      call(
        users.analytics,
        `/analytics/metrics/MET-CUST-006?asOf=${at}&currency=USD`,
      ),
    );
    const shipment = await db.shipment.findFirstOrThrow({
      where: { erpOrderId: cr.order },
      orderBy: { createdAt: "desc" },
    });
    const shipmentList = await sample(10, () =>
      call(users.logistics, "/shipments?offset=0&limit=25"),
    );
    const shipmentDetail = await sample(10, () =>
      call(users.logistics, `/shipments/${shipment.id}`),
    );
    const complaintCreated = await portal(
      `/portal/customers/${cr.account}/complaints`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          complaintTypeCode: "PERFORMANCE_PROOF",
          description: "CR-001 performance proof complaint",
        }),
      },
    );
    const complaintBody = (await complaintCreated.json()) as {
      data: { complaintId: string };
    };
    if (!complaintBody.data.complaintId)
      throw new Error("PERFORMANCE_PORTAL_COMPLAINT_ID_MISSING");
    const supportComplaint = await db.complaint.findFirstOrThrow({
      where: { accountId: "f7700000-0000-4000-8000-000000000003" },
      orderBy: { createdAt: "desc" },
    });
    const complaintList = await sample(10, () =>
      call(users.support, "/complaints?offset=0&limit=25"),
    );
    const complaintDetail = await sample(10, () =>
      call(users.support, `/complaints/${supportComplaint.id}`),
    );
    const portalOrders = await sample(10, () =>
      portal(`/portal/customers/${cr.account}/orders?offset=0&limit=25`),
    );
    const portalShipments = await sample(10, () =>
      portal(`/portal/customers/${cr.account}/shipments?offset=0&limit=25`),
    );
    const portalComplaints = await sample(10, () =>
      portal(`/portal/customers/${cr.account}/complaints?offset=0&limit=25`),
    );
    const researchSizes = await sample(10, () =>
      call(
        users.research,
        `/research/most-requested-sizes?offset=0&limit=25&asOf=${at}`,
      ),
    );
    const evidence = {
      verdict: "PASS",
      workload: "ENGINEERING BASELINE",
      environment:
        "local PostgreSQL 17 / real NestJS HTTP / non-production fixtures",
      concurrency: 1,
      errorRate: 0,
      measuredAt: new Date().toISOString(),
      results: {
        typicalApi: typical,
        search,
        pricingPreview: pricing,
        quotationAutosave: autosave,
        dashboard,
        heavyDrilldown: drilldown,
        topCustomers,
        topCountries,
        customerSegments,
        shipmentList,
        shipmentDetail,
        complaintList,
        complaintDetail,
        portalOrders,
        portalShipments,
        portalComplaints,
        researchSizes,
      },
      targetsMs: {
        typicalApiP95: 500,
        searchP95: 800,
        pricingPreviewP95: 500,
        quotationAutosaveP95: 1000,
        dashboardP95: 2000,
        heavyDrilldownP95: 5000,
        cr001ReadP95: 2000,
      },
    };
    const failures = [
      typical.p95 > 500,
      search.p95 > 800,
      pricing.p95 > 500,
      autosave.p95 > 1000,
      dashboard.p95 > 2000,
      drilldown.p95 > 5000,
      ...[
        topCustomers,
        topCountries,
        customerSegments,
        shipmentList,
        shipmentDetail,
        complaintList,
        complaintDetail,
        portalOrders,
        portalShipments,
        portalComplaints,
        researchSizes,
      ].map((result) => result.p95 > 2000),
    ];
    if (failures.some(Boolean))
      throw new Error(`PERFORMANCE_TARGET_FAILED_${JSON.stringify(evidence)}`);
    const target = path.resolve("docs/evidence/step-11-performance.json");
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify(evidence, null, 2)}\n`);
    process.stdout.write("STEP_11_PERFORMANCE_PROOF_PASSED\n");
  } finally {
    await app.close();
  }
}

async function sample(count: number, operation: () => Promise<unknown>) {
  const durations: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const started = performance.now();
    await operation();
    durations.push(performance.now() - started);
  }
  durations.sort((a, b) => a - b);
  const percentile = (value: number) => {
    const duration =
      durations[
        Math.min(durations.length - 1, Math.ceil(durations.length * value) - 1)
      ];
    if (duration === undefined) throw new Error("PERFORMANCE_SAMPLE_REQUIRED");
    return Math.round(duration * 100) / 100;
  };
  return {
    requests: count,
    throughputRps:
      Math.round(
        (count / (durations.reduce((a, b) => a + b, 0) / 1000)) * 100,
      ) / 100,
    p50: percentile(0.5),
    p95: percentile(0.95),
    p99: percentile(0.99),
    errors: 0,
  };
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exitCode = 1;
});
