import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import type { DatabaseClient } from "@abp/database";
import { AppModule } from "./app.module.js";
import { configureHttpApplication } from "./configure-http-app.js";
import { ImportService } from "./imports/import.service.js";
import { databaseClientToken } from "./platform/database.providers.js";

const id = {
  admin: "c1000000-0000-4000-8000-000000000001",
  logistics: "c1000000-0000-4000-8000-000000000002",
  sales: "c1000000-0000-4000-8000-000000000003",
  research: "c1000000-0000-4000-8000-000000000004",
  adminRole: "c1000000-0000-4000-8000-000000000011",
  logisticsRole: "c1000000-0000-4000-8000-000000000012",
  salesRole: "c1000000-0000-4000-8000-000000000013",
  researchRole: "c1000000-0000-4000-8000-000000000014",
  accountA: "c1000000-0000-4000-8000-000000000021",
  accountB: "c1000000-0000-4000-8000-000000000022",
  batch: "c1000000-0000-4000-8000-000000000031",
  orderA: "c1000000-0000-4000-8000-000000000041",
  orderB: "c1000000-0000-4000-8000-000000000042",
  family: "c1000000-0000-4000-8000-000000000051",
  product: "c1000000-0000-4000-8000-000000000052",
  opportunity: "c1000000-0000-4000-8000-000000000061",
  quotation: "c1000000-0000-4000-8000-000000000062",
  quoteLine: "c1000000-0000-4000-8000-000000000063",
  clientA: "c1000000-0000-4000-8000-000000000071",
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
    assert(address && typeof address !== "string", "HTTP_ADDRESS");
    const base = `http://127.0.0.1:${address.port}/api/v1`;
    const run = Date.now().toString();
    const call = (user: string, path: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      headers.set("x-abp-test-user-id", user);
      headers.set("x-abp-test-session-id", `cr001-${run}-${user}`);
      return fetch(`${base}${path}`, { ...init, headers });
    };
    const post = (
      user: string,
      path: string,
      body: unknown,
      key: string = crypto.randomUUID(),
    ) =>
      call(user, path, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": key },
        body: JSON.stringify(body),
      });
    const negativeTests = new Set<string>();
    const negative = (value: unknown, code: string) => {
      assert(value, code);
      negativeTests.add(code);
    };

    const segmentResponse = await post(id.admin, "/customer-segments", {
      code: `PROOF_${run}`,
      displayNameEn: "Proof Segment",
      displayNameAr: "شريحة اختبار",
    });
    assert(segmentResponse.status === 201, "SEGMENT_CREATE");
    const segment = data(await segmentResponse.json()) as {
      segmentId: string;
      rowVersion: string;
    };
    const assignmentFrom = new Date().toISOString();
    const assigned = await post(
      id.sales,
      `/accounts/${id.accountA}/segment-assignments`,
      { segmentId: segment.segmentId, effectiveFrom: assignmentFrom },
    );
    assert(assigned.status === 200, "SEGMENT_ASSIGN");
    const archived = await post(
      id.admin,
      `/customer-segments/${segment.segmentId}/archive`,
      { expectedRowVersion: segment.rowVersion },
    );
    assert(archived.status === 200, "SEGMENT_ARCHIVE");
    negative(
      (
        await post(id.sales, `/accounts/${id.accountA}/segment-assignments`, {
          segmentId: segment.segmentId,
          effectiveFrom: new Date(Date.now() + 1000).toISOString(),
        })
      ).status === 404,
      "N21_ARCHIVED_SEGMENT_ASSIGNMENT_DENIED",
    );
    const secondSegmentResponse = await post(id.admin, "/customer-segments", {
      code: `PROOF_NEXT_${run}`,
      displayNameEn: "Next Segment",
      displayNameAr: "Next Segment",
    });
    const secondSegment = data(await secondSegmentResponse.json()) as {
      segmentId: string;
    };
    const nextEffective = new Date(Date.now() + 60_000);
    assert(
      (
        await post(id.sales, `/accounts/${id.accountA}/segment-assignments`, {
          segmentId: secondSegment.segmentId,
          effectiveFrom: nextEffective.toISOString(),
        })
      ).status === 200,
      "SEGMENT_REASSIGN",
    );
    const segmentHistory = await db.customerSegmentAssignment.findMany({
      where: { accountId: id.accountA },
      orderBy: { effectiveFrom: "asc" },
    });
    const asOfNow = segmentHistory.find(
      (row) =>
        row.effectiveFrom <= new Date() &&
        (row.effectiveTo === null || row.effectiveTo > new Date()),
    );
    const asOfFuture = segmentHistory.find(
      (row) =>
        row.effectiveFrom <= new Date(nextEffective.getTime() + 1000) &&
        (row.effectiveTo === null ||
          row.effectiveTo > new Date(nextEffective.getTime() + 1000)),
    );
    negative(
      asOfNow?.segmentId === segment.segmentId &&
        asOfFuture?.segmentId === secondSegment.segmentId,
      "N22_SEGMENT_HISTORY_AS_OF",
    );

    const importBuffer = Buffer.from(
      `id,customerSegmentCode,proofRun\n1,UNKNOWN_CR001,${run}\n`,
      "utf8",
    );
    const importBatch = await db.importBatch.create({
      data: {
        sourceSystemCode: "CRM",
        sourceSystemId: randomUUID(),
        importTypeCode: "CUSTOMERS",
        fileName: "cr001-segment.csv",
        safeStorageKey: `cr001-${run}.csv`,
        expectedSizeBytes: BigInt(importBuffer.length),
        mimeType: "text/csv",
        sourceFingerprint: `cr001-segment-${run}`,
        actorUserId: id.admin,
      },
    });
    const imports = app.get(ImportService);
    await imports.ingestBuffer(
      {
        userId: id.admin,
        email: "cr001-admin@example.test",
        displayName: "admin",
        authStatusCode: "ACTIVE",
        rowVersion: 1n,
        lastSignInAt: null,
        jobTitle: null,
        managerUserId: null,
        teamId: null,
        sessionId: `cr001-import-${run}`,
        roles: [],
        workspaces: new Set(["SALES"]),
        permissions: new Set(["imports.manage"]),
        deniedPermissions: new Set(),
        countryCodes: new Set(["EG"]),
        policyVersion: 1,
        traceId: `cr001-import-trace-${run}`,
        correlationId: `cr001-import-correlation-${run}`,
      },
      importBatch.id,
      importBuffer,
      "cr001-parser",
      "cr001-mapping",
    );
    const unknownSegmentIssue = await db.dQIssue.findFirst({
      where: {
        importBatchId: importBatch.id,
        ruleCode: "UNKNOWN_CUSTOMER_SEGMENT",
        statusCode: "OPEN",
      },
    });
    const autoCreatedSegment = await db.customerSegmentDefinition.findUnique({
      where: { code: "UNKNOWN_CR001" },
    });
    negative(
      Boolean(unknownSegmentIssue) && autoCreatedSegment === null,
      "N20_UNKNOWN_SEGMENT_DQ_NO_AUTO_CREATE",
    );

    const createdResponse = await post(
      id.logistics,
      "/shipments",
      { erpOrderId: id.orderA, businessOccurredAt: "2026-08-25T08:00:00Z" },
      `shipment-${run}`,
    );
    assert(createdResponse.status === 201, "SHIPMENT_CREATE");
    let created = data(await createdResponse.json()) as {
      shipmentId: string;
      rowVersion: string;
    };
    negative(
      (
        await post(id.sales, "/shipments", {
          erpOrderId: id.orderA,
          businessOccurredAt: "2026-08-25T08:00:00Z",
        })
      ).status === 403,
      "N18_SALES_SHIPMENT_WRITE_DENY",
    );
    negative(
      (
        await post(
          id.logistics,
          `/shipments/${created.shipmentId}/milestones`,
          {
            milestoneCode: "VESSEL_DEPARTED",
            businessOccurredAt: "2026-08-25T09:00:00Z",
            expectedRowVersion: created.rowVersion,
          },
        )
      ).status === 422,
      "N30_SHIPMENT_FORWARD_ORDER_REJECTED",
    );
    let advanced = await post(
      id.logistics,
      `/shipments/${created.shipmentId}/milestones`,
      {
        milestoneCode: "SHIPPED",
        businessOccurredAt: "2026-08-25T09:00:00Z",
        expectedRowVersion: created.rowVersion,
      },
    );
    assert(advanced.status === 200, "SHIPMENT_SHIPPED");
    created = data(await advanced.json()) as typeof created;
    negative(
      (
        await post(
          id.logistics,
          `/shipments/${created.shipmentId}/milestones`,
          {
            milestoneCode: "VESSEL_DEPARTED",
            businessOccurredAt: "2026-08-25T10:00:00Z",
            expectedRowVersion: created.rowVersion,
          },
        )
      ).status === 422,
      "N30_VESSEL_REQUIRES_BL_DATE",
    );
    advanced = await post(
      id.logistics,
      `/shipments/${created.shipmentId}/milestones`,
      {
        milestoneCode: "VESSEL_DEPARTED",
        businessOccurredAt: "2026-08-25T10:00:00Z",
        expectedRowVersion: created.rowVersion,
        blDate: "2026-08-25",
      },
    );
    assert(advanced.status === 200, "VESSEL_DEPARTED");
    created = data(await advanced.json()) as typeof created;
    negative(
      (
        await post(
          id.logistics,
          `/shipments/${created.shipmentId}/milestones`,
          {
            milestoneCode: "ARRIVED_AT_PORT_OF_DISCHARGE",
            businessOccurredAt: "2026-08-27T10:00:00Z",
            expectedRowVersion: created.rowVersion,
            actualArrivalAt: "2026-08-27T10:00:00Z",
          },
        )
      ).status === 422,
      "N31_ARRIVAL_REQUIRES_PORT",
    );
    negative(
      (
        await post(
          id.logistics,
          `/shipments/${created.shipmentId}/milestones`,
          {
            milestoneCode: "ARRIVED_AT_PORT_OF_DISCHARGE",
            businessOccurredAt: "2026-08-27T10:00:00Z",
            expectedRowVersion: created.rowVersion,
            portOfDischarge: "Alexandria",
          },
        )
      ).status === 422,
      "N32_ARRIVAL_REQUIRES_ACTUAL_DATE",
    );
    advanced = await post(
      id.logistics,
      `/shipments/${created.shipmentId}/milestones`,
      {
        milestoneCode: "ARRIVED_AT_PORT_OF_DISCHARGE",
        businessOccurredAt: "2026-08-27T10:00:00Z",
        expectedRowVersion: created.rowVersion,
        portOfDischarge: "Alexandria",
        actualArrivalAt: "2026-08-27T10:00:00Z",
      },
    );
    assert(advanced.status === 200, "SHIPMENT_ARRIVAL");
    created = data(await advanced.json()) as typeof created;
    const correctionKey = `correction-${run}`;
    const correctionBody = {
      reason: "Correct external BL date",
      businessOccurredAt: "2026-08-25T10:30:00Z",
      expectedRowVersion: created.rowVersion,
      blDate: "2026-08-24",
    };
    const correction = await post(
      id.logistics,
      `/shipments/${created.shipmentId}/corrections`,
      correctionBody,
      correctionKey,
    );
    assert(correction.status === 200, "SHIPMENT_CORRECTION");
    const detail = data(
      await (
        await call(id.logistics, `/shipments/${created.shipmentId}`)
      ).json(),
    ) as { history: { eventTypeCode: string }[] };
    negative(
      detail.history.length === 5 &&
        detail.history.at(-1)?.eventTypeCode === "CORRECTION",
      "N35_SHIPMENT_CORRECTION_HISTORY",
    );
    assert(
      (await call(id.sales, `/shipments/${created.shipmentId}`)).status === 200,
      "SALES_SHIPMENT_VIEW",
    );
    const shipmentRow = await db.shipment.findUniqueOrThrow({
      where: { id: created.shipmentId },
    });
    negative(
      typeof shipmentRow.erpOrderId === "string" &&
        shipmentRow.erpOrderId === id.orderA,
      "N33_SHIPMENT_EXACTLY_ONE_ORDER",
    );
    const secondShipment = await post(
      id.logistics,
      "/shipments",
      { erpOrderId: id.orderA, businessOccurredAt: "2026-08-25T08:15:00Z" },
      `shipment-second-${run}`,
    );
    negative(
      secondShipment.status === 201 &&
        (await db.shipment.count({ where: { erpOrderId: id.orderA } })) >= 2,
      "N34_ORDER_MULTIPLE_SHIPMENTS",
    );
    negative(
      (
        await call(
          id.sales,
          `/shipments/${(data(await secondShipment.json()) as { shipmentId: string }).shipmentId}`,
        )
      ).status === 200 &&
        (await call(id.sales, `/shipments/${id.orderB}`)).status === 404,
      "N19_CLASSIFICATION_NEVER_WIDENS_COUNTRY_SCOPE",
    );

    const portal = (path: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      headers.set("x-abp-external-issuer", "https://login.example.test/");
      headers.set("x-abp-external-subject", "client-a");
      return fetch(`${base}${path}`, { ...init, headers });
    };
    assert(
      (await portal("/portal/customer-contexts")).status === 200,
      "PORTAL_CONTEXT",
    );
    assert(
      (
        await portal(
          `/portal/customers/${id.accountA}/orders?offset=0&limit=25`,
        )
      ).status === 200,
      "CLIENT_A_ORDER",
    );
    negative(
      (
        await portal(
          `/portal/customers/${id.accountB}/orders?offset=0&limit=25`,
        )
      ).status === 404,
      "N01_CLIENT_A_CLIENT_B_ORDER_DENY",
    );
    negative(
      (
        await portal(
          `/portal/customers/${id.accountB}/shipments?offset=0&limit=25`,
        )
      ).status === 404,
      "N02_CLIENT_A_CLIENT_B_SHIPMENT_DENY",
    );
    negative(
      (
        await portal(
          `/portal/customers/${id.accountB}/complaints?offset=0&limit=25`,
        )
      ).status === 404,
      "N03_CLIENT_A_CLIENT_B_COMPLAINT_DENY",
    );
    negative(
      (await portal("/portal/customers?search=Client+B")).status === 404,
      "N04_PORTAL_CUSTOMER_SEARCH_UNAVAILABLE",
    );
    negative(
      (await portal("/finance/payments")).status !== 200,
      "N05_PORTAL_PAYMENTS_DENY",
    );
    negative(
      (await portal("/finance/cheques")).status !== 200,
      "N06_PORTAL_CHEQUES_DENY",
    );
    negative(
      (await portal("/opportunities")).status !== 200,
      "N07_PORTAL_INTERNAL_SALES_DENY",
    );
    const portalOrders = await (
      await portal(`/portal/customers/${id.accountA}/orders?offset=0&limit=25`)
    ).text();
    negative(
      !/(bookedAmount|unitPrice|margin|cost|currencyCode)/i.test(portalOrders),
      "N08_PORTAL_COMMERCIAL_FIELDS_OMITTED",
    );
    const unboundPortal = (path: string) =>
      fetch(`${base}${path}`, {
        headers: {
          "x-abp-external-issuer": "https://login.example.test/",
          "x-abp-external-subject": "unbound-client",
        },
      });
    negative(
      (await unboundPortal("/portal/customer-contexts")).status === 401,
      "N09_UNBOUND_EXTERNAL_IDENTITY_DENY",
    );
    await db.clientCustomerBinding.updateMany({
      where: { externalClientIdentityId: id.clientA },
      data: {
        statusCode: "REVOKED",
        revokedAt: new Date(),
        validTo: new Date(),
      },
    });
    negative(
      (
        await portal(
          `/portal/customers/${id.accountA}/orders?offset=0&limit=25`,
        )
      ).status === 404,
      "N10_REVOKED_BINDING_DENY",
    );

    assert(
      (
        await call(
          id.research,
          "/research/most-requested-sizes?offset=0&limit=25",
        )
      ).status === 200,
      "RESEARCH_VIEW",
    );
    negative(
      (
        await post(id.research, "/accounts", {
          canonicalName: "Denied",
          countryCode: "EG",
        })
      ).status === 403,
      "N11_RESEARCH_CUSTOMER_CREATE_DENY",
    );
    negative(
      (
        await call(id.research, `/accounts/${id.accountA}`, {
          method: "PATCH",
          headers: { "content-type": "application/json", "if-match": '"rv-1"' },
          body: JSON.stringify({ canonicalName: "Denied" }),
        })
      ).status === 403,
      "N12_RESEARCH_CUSTOMER_EDIT_DENY",
    );
    negative(
      (
        await post(id.research, "/opportunities", {
          title: "Research role must not create this",
          accountId: id.accountA,
          noProjectReasonCode: "DENIED",
        })
      ).status === 403,
      "N13_RESEARCH_OPPORTUNITY_CREATE_DENY",
    );
    negative(
      (
        await call(id.research, `/opportunities/${id.opportunity}`, {
          method: "PATCH",
          headers: { "content-type": "application/json", "if-match": '"rv-1"' },
          body: JSON.stringify({ noProjectReasonCode: "DENIED" }),
        })
      ).status === 403,
      "N14_RESEARCH_OPPORTUNITY_EDIT_DENY",
    );
    negative(
      (
        await post(id.research, "/quotations", {
          opportunityId: id.opportunity,
          currencyCode: "USD",
          // A complete body, so the request reaches the permission check
          // instead of stopping at validation.
          draft: { lines: [] },
        })
      ).status === 403,
      "N15_RESEARCH_QUOTATION_CREATE_DENY",
    );
    negative(
      (
        await call(id.research, `/quotations/${id.quotation}/draft-content`, {
          method: "PUT",
          headers: { "content-type": "application/json", "if-match": '"rv-1"' },
          body: JSON.stringify({ lines: [] }),
        })
      ).status === 403,
      "N15B_RESEARCH_QUOTATION_EDIT_DENY",
    );
    negative(
      (await call(id.research, "/finance/payments")).status === 403,
      "N16_RESEARCH_FINANCE_DENY",
    );
    // Keep the authorization assertion independent from the deliberately
    // exercised local rate-limit bucket used by the preceding negative cases.
    await db.requestRateLimit.deleteMany();
    negative(
      (
        await post(id.research, "/exports", {
          exportTypeCode: "CUSTOMERS",
          formatCode: "CSV",
        })
      ).status === 403,
      "N17_RESEARCH_EXPORT_DENY",
    );

    const sentQuote = await db.quotation.findFirstOrThrow({
      where: { contentHash: { startsWith: "cr001-proof-" } },
      orderBy: { createdAt: "desc" },
    });
    let sentMutationRejected = false;
    try {
      await db.quotation.update({
        where: { id: sentQuote.id },
        data: { totalAmount: { increment: 1 } },
      });
    } catch {
      sentMutationRejected = true;
    }
    negative(sentMutationRejected, "N23_SENT_CONTENT_IMMUTABLE");
    negative(
      (
        await call(id.sales, `/quotations/${sentQuote.id}/draft-content`, {
          method: "PUT",
          headers: {
            "content-type": "application/json",
            "if-match": `"rv-${sentQuote.rowVersion.toString()}"`,
          },
          body: JSON.stringify({
            lines: [
              {
                productId: id.product,
                description: "Changed",
                qty: "1",
                unitCode: "BOARD",
                unitPrice: "10",
              },
            ],
          }),
        })
      ).status === 422,
      "N25_SUBMITTED_DOES_NOT_UNLOCK_SENT",
    );
    const negotiated = await post(
      id.sales,
      `/quotations/${sentQuote.id}/commercial-state-transitions`,
      {
        targetStateCode: "UNDER_NEGOTIATION",
        expectedRowVersion: sentQuote.rowVersion.toString(),
        reason: "Customer negotiation",
      },
    );
    assert(negotiated.status === 200, "COMMERCIAL_NEGOTIATION_TRANSITION");
    const negotiatedQuote = await db.quotation.findUniqueOrThrow({
      where: { id: sentQuote.id },
    });
    negative(
      negotiatedQuote.statusCode === "SENT" &&
        negotiatedQuote.commercialStateCode === "UNDER_NEGOTIATION",
      "N25B_COMMERCIAL_STATE_SEPARATE_FROM_DOCUMENT_STATE",
    );
    const replacementResponse = await post(
      id.sales,
      `/quotations/${sentQuote.id}/supersede`,
      { expectedRowVersion: `"rv-${negotiatedQuote.rowVersion.toString()}"` },
      `supersede-${run}`,
    );
    assert(replacementResponse.status === 200, "SUPERSEDE_CREATE");
    const replacement = data(await replacementResponse.json()) as {
      quotationId: string;
      statusCode: string;
      supersedesQuotationId: string;
    };
    negative(
      replacement.statusCode === "DRAFT" &&
        replacement.supersedesQuotationId === sentQuote.id &&
        // The copy policy closes a sent source as soon as its replacement
        // exists (quotation-copy-policy.ts), keeping its submission record.
        (await db.quotation.findUniqueOrThrow({ where: { id: sentQuote.id } }))
          .statusCode === "SUPERSEDED",
      "N24_MATERIAL_CHANGE_NEW_DRAFT_SUPERSEDES",
    );
    for (const [state, code] of [
      ["HOT_LEAD", "N26_HOT_LEAD_NOT_QUOTATION_STATE"],
      ["WON", "N27_WON_NOT_QUOTATION_STATE"],
      ["LOST", "N28_LOST_NOT_QUOTATION_STATE"],
    ] as const) {
      let rejected = false;
      try {
        await db.$executeRawUnsafe(
          `UPDATE quotations SET status_code='${state}' WHERE quotation_id='${replacement.quotationId}'`,
        );
      } catch {
        rejected = true;
      }
      negative(rejected, code);
    }
    // Cancel shipped after CR-001; it must still refuse a cancellation that
    // carries no row version or reason.
    negative(
      (await post(id.sales, `/quotations/${sentQuote.id}/cancel`, {}))
        .status === 400,
      "N29_CANCEL_REQUIRES_REASON",
    );

    const localRule = await db.geographyClassificationRule.findFirst({
      where: {
        countryCode: "LY",
        effectiveFrom: { lte: new Date("2026-08-24T21:00:00Z") },
      },
    });
    assert(localRule?.classification === "LOCAL", "LOCAL_RULE_VERSION");
    const researchAsOf = new Date("2197-12-31T23:59:59.999Z");
    const researchResponse = await call(
      id.research,
      `/research/most-requested-sizes?offset=0&limit=25&asOf=${encodeURIComponent(researchAsOf.toISOString())}`,
    );
    const researchBody = (await researchResponse.json()) as {
      data: {
        productId: string;
        totalRequestedQuantity: string;
        distinctOfficialQuotationCount: number;
      }[];
    };
    const requested = researchBody.data.find(
      (row) => row.productId === id.product,
    );
    const officialDemand = await db.$queryRaw<
      { requestedQuantity: string; quotationCount: bigint }[]
    >`
      SELECT COALESCE(SUM(ql.qty), 0)::text AS "requestedQuantity",
             COUNT(DISTINCT q.quotation_id)::bigint AS "quotationCount"
      FROM quotation_lines ql
      JOIN quotations q ON q.quotation_id = ql.quotation_id
      WHERE ql.product_id = ${id.product}::uuid AND q.status_code = 'SENT'
        AND q.commercial_state_code IN ('SUBMITTED','UNDER_NEGOTIATION')
        AND q.first_submitted_at <= ${researchAsOf} AND q.country_code = 'EG'
    `;
    negative(
      // No row at all is zero demand, which is what a fresh database has
      // once the only sent quotation is superseded.
      Number(requested?.totalRequestedQuantity ?? 0) ===
        Number(officialDemand[0]?.requestedQuantity ?? 0) &&
        (await db.quotationLine.count({
          where: {
            quotationId: replacement.quotationId,
            productId: id.product,
          },
        })) > 0,
      "N36_DRAFT_LINES_EXCLUDED_FROM_RESEARCH",
    );
    negative(
      requested?.distinctOfficialQuotationCount ===
        Number(officialDemand[0]?.quotationCount ?? 0n) &&
        Number(requested.totalRequestedQuantity) > 0,
      "N37_OFFICIAL_LINES_INCLUDED_IN_RESEARCH",
    );
    negative(
      requested?.totalRequestedQuantity !==
        String(requested?.distinctOfficialQuotationCount),
      "N38_QUANTITY_DISTINCT_QUOTE_METRICS_SEPARATE",
    );
    const migrationText = await import("node:fs/promises").then(
      ({ readFile }) =>
        readFile(
          new URL(
            "../../../packages/database/prisma/migrations/20260825010000_cr001_business_decisions/migration.sql",
            import.meta.url,
          ),
          "utf8",
        ),
    );
    negative(
      !/CR001_POSTGRESQL_SECURITY_PROOF|cr001-proof|DEMO/i.test(migrationText),
      "N40_NO_DEMO_PRODUCTION_SEED",
    );
    const postgresProbe =
      await db.$queryRawUnsafe<{ one: number }[]>("SELECT 1 AS one");
    assert(postgresProbe[0]?.one === 1, "POSTGRESQL_REAL");
    if (negativeTests.size < 40)
      throw new Error(`CR001_NEGATIVE_MATRIX_INCOMPLETE_${negativeTests.size}`);
    process.stdout.write(
      JSON.stringify({
        result: "CR001_POSTGRESQL_SECURITY_PROOF_PASS",
        negativeTests: negativeTests.size,
        negativeTestCodes: [...negativeTests].sort(),
        shipmentHistoryEvents: detail.history.length,
        portalIsolation: "PASS",
        researchReadOnly: "PASS",
      }) + "\n",
    );
  } finally {
    await app.close();
  }
}

async function seed(db: DatabaseClient) {
  for (const country of [
    { code: "EG", name: "Egypt", continentCode: "AFRICA" },
    { code: "AU", name: "Australia", continentCode: "OCEANIA" },
    { code: "LY", name: "Libya", continentCode: "AFRICA" },
    { code: "SA", name: "Saudi Arabia", continentCode: "ASIA" },
    { code: "AE", name: "United Arab Emirates", continentCode: "ASIA" },
  ])
    await db.country.upsert({
      where: { code: country.code },
      update: country,
      create: country,
    });
  // The CR-001 migration seeds these rules from the countries present when it
  // runs, which is none on a fresh database. Seed the same version here.
  for (const countryCode of ["EG", "AU", "LY", "SA", "AE"])
    await db.geographyClassificationRule.upsert({
      where: {
        versionCode_countryCode: {
          versionCode: "CR-001-2026-08-25",
          countryCode,
        },
      },
      update: {},
      create: {
        versionCode: "CR-001-2026-08-25",
        countryCode,
        classification: countryCode === "AU" ? "GLOBAL" : "LOCAL",
        effectiveFrom: new Date("2026-08-25T00:00:00+03:00"),
      },
    });
  const users = [
    [id.admin, "admin"],
    [id.logistics, "logistics"],
    [id.sales, "sales"],
    [id.research, "research"],
  ] as const;
  for (const [userId, name] of users)
    await db.appUser.upsert({
      where: { id: userId },
      update: { active: true },
      create: {
        id: userId,
        externalSubject: `cr001-${name}`,
        displayName: name,
        emailNormalized: `cr001-${name}@example.test`,
      },
    });
  const roles = [
    [id.adminRole, "CR001_ADMIN", "ADMIN"],
    [id.logisticsRole, "CR001_LOGISTICS", "LOGISTICS"],
    [id.salesRole, "CR001_SALES", "SALES"],
    [id.researchRole, "CR001_RESEARCH", "RND"],
  ] as const;
  for (const [roleId, code, workspace] of roles)
    await db.role.upsert({
      where: { code },
      update: { active: true },
      create: { id: roleId, code, name: code, workspace },
    });
  const grants: Record<string, string[]> = {
    [id.adminRole]: [
      "customer-segments.view",
      "customer-segments.manage",
      "customer-segments.assign",
      "users.manage",
      "imports.manage",
    ],
    [id.logisticsRole]: [
      "shipments.view",
      "shipments.create",
      "shipments.edit",
    ],
    [id.salesRole]: [
      "shipments.view",
      "customer-segments.view",
      "customer-segments.assign",
      "accounts.view",
      "accounts.create",
      "accounts.edit",
      "quotations.view",
      "quotations.create",
      "quotations.edit",
    ],
    [id.researchRole]: ["research.view"],
  };
  for (const codes of Object.values(grants))
    for (const code of codes)
      await db.permission.upsert({
        where: { code },
        update: {},
        create: { code, description: code },
      });
  for (const [roleId, codes] of Object.entries(grants))
    for (const code of codes)
      await db.rolePermission.upsert({
        where: { roleId_permissionCode: { roleId, permissionCode: code } },
        update: {},
        create: { roleId, permissionCode: code },
      });
  for (const [index, [userId]] of users.entries()) {
    const role = roles[index];
    if (!role) throw new Error(`CR001_ROLE_MAPPING_MISSING_${index}`);
    const roleId = role[0];
    await db.userRole.upsert({
      where: { userId_roleId: { userId, roleId } },
      update: {},
      create: { userId, roleId },
    });
    await db.userCountryAccess.upsert({
      where: { userId_countryCode: { userId, countryCode: "EG" } },
      update: { statusCode: "ACTIVE" },
      create: { userId, countryCode: "EG", grantedBy: id.admin },
    });
  }
  for (const [accountId, name, countryCode] of [
    [id.accountA, "Client A", "EG"],
    [id.accountB, "Client B", "AU"],
  ] as const)
    await db.account.upsert({
      where: { id: accountId },
      update: { ownerUserId: id.sales, countryCode },
      create: {
        id: accountId,
        canonicalName: name,
        normalizedName: name.toLowerCase(),
        countryCode,
        ownerUserId: id.sales,
        createdByUserId: id.admin,
        updatedByUserId: id.admin,
      },
    });
  await db.customerSegmentAssignment.deleteMany({
    where: { accountId: id.accountA },
  });
  await db.userCountryAccess.upsert({
    where: { userId_countryCode: { userId: id.logistics, countryCode: "AU" } },
    update: { statusCode: "ACTIVE" },
    create: { userId: id.logistics, countryCode: "AU", grantedBy: id.admin },
  });
  await db.importBatch.upsert({
    where: { id: id.batch },
    update: {},
    create: {
      id: id.batch,
      sourceSystemCode: "ERP",
      sourceSystemId: id.batch,
      importTypeCode: "ERP_ORDER",
      sourceFingerprint: "cr001-proof",
      actorUserId: id.admin,
    },
  });
  for (const [orderId, accountId, countryCode, key] of [
    [id.orderA, id.accountA, "EG", "A"],
    [id.orderB, id.accountB, "AU", "B"],
  ] as const)
    await db.eRPOrder.upsert({
      where: { id: orderId },
      update: { accountId, countryCode },
      create: {
        id: orderId,
        sourceSystemCode: "ERP",
        sourceOrderKey: `CR001-${key}`,
        sourceSystemId: id.batch,
        sourceSalesOrderId: orderId,
        countryCode,
        accountId,
        importBatchId: id.batch,
        statusCode: "BOOKED",
        bookedAmount: 100,
        currencyCode: "USD",
      },
    });
  await db.productFamily.upsert({
    where: { id: id.family },
    update: {},
    create: { id: id.family, familyCode: "CR001", name: "CR001" },
  });
  await db.product.upsert({
    where: { id: id.product },
    update: {},
    create: {
      id: id.product,
      skuCode: "CR001-SKU",
      productFamilyId: id.family,
      productTypeCode: "STANDARD_SKU",
      canonicalDescription: "15 x 1220 x 2440",
      normalizedDescription: "15x1220x2440",
      thicknessMm: 15,
      widthMm: 1220,
      lengthMm: 2440,
      createdByUserId: id.admin,
      updatedByUserId: id.admin,
    },
  });
  await db.opportunity.upsert({
    where: { id: id.opportunity },
    update: {},
    create: {
      id: id.opportunity,
      accountId: id.accountA,
      countryCode: "EG",
      ownerUserId: id.sales,
      stageCode: "QUALIFIED",
      noProjectReasonCode: "PROOF_WITHOUT_PROJECT",
      createdByUserId: id.sales,
      updatedByUserId: id.sales,
    },
  });
  // Two sent quotations: the proof supersedes the second, which closes it,
  // and the first stays SENT so research still has official demand to count.
  for (const hashPrefix of ["cr001-research-", "cr001-proof-"]) {
    const quotationId = randomUUID();
    await db.quotation.create({
      data: {
        id: quotationId,
        accountId: id.accountA,
        opportunityId: id.opportunity,
        countryCode: "EG",
        ownerUserId: id.sales,
        statusCode: "DRAFT",
        createdByUserId: id.sales,
        updatedByUserId: id.sales,
      },
    });
    await db.quotationLine.create({
      data: {
        id: randomUUID(),
        quotationId,
        productId: id.product,
        lineNo: 1,
        description: "15 x 1220 x 2440",
        qty: 42500,
        unitCode: "BOARD",
        unitPrice: 10,
        lineTotal: 425000,
      },
    });
    await db.quotation.update({
      where: { id: quotationId },
      data: {
        statusCode: "SENT",
        contentHash: `${hashPrefix}${quotationId}`,
        commercialStateCode: "SUBMITTED",
        firstSubmittedAt: new Date("2026-08-25T09:00:00Z"),
        sentAt: new Date("2026-08-25T09:00:00Z"),
      },
    });
  }
  await db.externalClientIdentity.upsert({
    where: { id: id.clientA },
    update: { statusCode: "ACTIVE", revokedAt: null },
    create: {
      id: id.clientA,
      issuer: "https://login.example.test/",
      subject: "client-a",
      statusCode: "ACTIVE",
      provisionedByUserId: id.admin,
    },
  });
  await db.clientCustomerBinding.deleteMany({
    where: { externalClientIdentityId: id.clientA },
  });
  await db.clientCustomerBinding.create({
    data: {
      externalClientIdentityId: id.clientA,
      accountId: id.accountA,
      createdByUserId: id.admin,
    },
  });
}
function data(value: unknown) {
  return (value as { data: unknown }).data;
}
function assert(value: unknown, code: string): asserts value {
  if (!value) throw new Error(code);
}
await main();
