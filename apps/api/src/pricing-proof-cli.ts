import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { Server } from "node:http";
import { permissions } from "@abp/contracts";
import type { DatabaseClient } from "@abp/database";
import { AppModule } from "./app.module.js";
import { configureHttpApplication } from "./configure-http-app.js";
import { databaseClientToken } from "./platform/database.providers.js";

const ids = {
  user: "e7000000-0000-4000-8000-000000000001",
  deny: "e7000000-0000-4000-8000-000000000002",
  approver: "e7000000-0000-4000-8000-000000000003",
  role: "e7000000-0000-4000-8000-000000000010",
  denyRole: "e7000000-0000-4000-8000-000000000011",
  approverRole: "e7000000-0000-4000-8000-000000000012",
} as const;

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED");
  process.env.ABP_TEST_AUTH_ENABLED = "true";
  const app = await NestFactory.create(AppModule, { logger: false });
  configureHttpApplication(app);
  await app.listen(0, "127.0.0.1");
  try {
    const db = app.get<DatabaseClient>(databaseClientToken);
    const seeded = await seed(db);
    const address = (app.getHttpServer() as Server).address();
    assert(address && typeof address !== "string", "HTTP_ADDRESS_MISSING");
    const url = `http://127.0.0.1:${address.port.toString()}/api/v1`;
    const run = Date.now().toString();
    const call = (user: string, path: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      headers.set("x-abp-test-user-id", user);
      headers.set("x-abp-test-session-id", `pricing-${run}-${user}`);
      return fetch(`${url}${path}`, { ...init, headers });
    };
    const json = async (response: Response) =>
      response.json() as Promise<Record<string, unknown>>;
    process.stdout.write("PRICING_PROOF_PAYMENT_TERMS\n");
    const terms = await call(ids.user, "/payment-terms");
    assert(
      terms.status === 200,
      `PAYMENT_TERMS_FAILED_${terms.status.toString()}_${await terms.text()}`,
    );
    assert(
      (await call(ids.user, "/pricing/standard-board-basis")).status === 200,
      "STANDARD_BOARD_BASIS_FAILED",
    );
    process.stdout.write("PRICING_PROOF_RESOLVE\n");
    const resolved = await call(ids.user, "/pricing/resolve", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": `pricing-resolve-proof-${run}`,
      },
      body: JSON.stringify({
        productId: seeded.productId,
        qty: "1.2500",
        currencyCode: "USD",
      }),
    });
    const resolveBody = await json(resolved);
    assert(
      resolved.status === 201 || resolved.status === 200,
      `PRICING_RESOLVE_FAILED_${resolved.status.toString()}_${JSON.stringify(resolveBody)}`,
    );
    assert(
      (resolveBody.data as Record<string, unknown>).unitPrice === "120",
      `DECIMAL_RESOLUTION_FAILED_${JSON.stringify(resolveBody)}`,
    );
    process.stdout.write("PRICING_PROOF_GUARDRAIL\n");
    const guardrail = await call(ids.user, "/pricing/guardrails", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": `pricing-guardrail-proof-${run}`,
      },
      body: JSON.stringify({
        productId: seeded.productId,
        minPrice: "101.0000",
        referencePrice: "121.0000",
        maxPrice: "130.0000",
        currencyCode: "USD",
        effectiveFrom: "2026-01-01T00:00:00.000Z",
      }),
    });
    assert(guardrail.status === 201, "GUARDRAIL_CREATE_FAILED");
    process.stdout.write("PRICING_PROOF_TAX\n");
    const tax = await call(ids.user, "/tax-policies", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": `pricing-tax-proof-${run}`,
      },
      body: JSON.stringify({
        taxCode: "VAT",
        taxRatePct: "14.00",
        effectiveFrom: "2026-01-01T00:00:00.000Z",
      }),
    });
    assert(tax.status === 201, "TAX_POLICY_CREATE_FAILED");
    assert(
      (await call(ids.user, "/tax-policies")).status === 200,
      "TAX_POLICY_LIST_FAILED",
    );
    process.stdout.write("PRICING_PROOF_OVERRIDE\n");
    const override = await call(ids.user, "/pricing/manager-overrides", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": `pricing-override-proof-${run}`,
      },
      body: JSON.stringify({
        quotationId: seeded.quotationId,
        quotationLineId: seeded.lineId,
        expectedRowVersion: "1",
        requestedUnitPrice: "99.9900",
        reason: "Governed proof",
      }),
    });
    const overrideBody = await json(override);
    assert(
      override.status === 201 &&
        (overrideBody.data as Record<string, unknown>).statusCode === "PENDING",
      "PRICE_OVERRIDE_PENDING_FAILED",
    );
    process.stdout.write("PRICING_PROOF_DENY\n");
    const denied = await call(ids.deny, "/pricing/resolve", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": `pricing-denied-proof-${run}`,
      },
      body: JSON.stringify({
        productId: seeded.productId,
        qty: "1",
        currencyCode: "USD",
      }),
    });
    assert(denied.status === 403, "PRICING_DENY_WINS_FAILED");
    process.stdout.write("QUOTATION_PROOF_DRAFT\n");
    const quotations = await call(ids.user, "/quotations");
    assert(quotations.status === 200, "QUOTATION_LIST_FAILED");
    const createdQuote = await call(ids.user, "/quotations", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": `quotation-create-proof-${run}`,
      },
      body: JSON.stringify({
        opportunityId: seeded.opportunityId,
        currencyCode: "USD",
        draft: {
          lines: [
            {
              productId: seeded.productId,
              description: "Quote proof create line",
              qty: "1.0000",
              unitCode: "BOARD",
              unitPrice: "120.0000",
            },
          ],
        },
      }),
    });
    assert(
      createdQuote.status === 201,
      `QUOTATION_CREATE_FAILED_${createdQuote.status.toString()}_${await createdQuote.clone().text()}`,
    );
    const createdQuoteBody = await json(createdQuote);
    const createdQuoteData = createdQuoteBody.data as Record<string, unknown>;
    const createdQuoteId = createdQuoteData.quotationId;
    assert(
      typeof createdQuoteId === "string" &&
        typeof createdQuoteData.rowVersion === "string",
      "QUOTATION_CREATE_RESPONSE_INVALID",
    );
    // Cancel shipped after this proof was written; it must still refuse a
    // cancellation with no row version or reason.
    const unexplainedCancellation = await call(
      ids.user,
      `/quotations/${createdQuoteId}/cancel`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({}),
      },
    );
    assert(
      unexplainedCancellation.status === 400,
      "QUOTATION_CANCEL_WITHOUT_REASON_NOT_REJECTED",
    );
    const quotation = await call(
      ids.user,
      `/quotations/${seeded.draftQuotationId}`,
    );
    const quotationBody = await json(quotation);
    assert(quotation.status === 200, "QUOTATION_DETAIL_FAILED");
    const quotationTag = (quotationBody.data as Record<string, unknown>)
      .rowVersion;
    assert(typeof quotationTag === "string", "QUOTATION_ETAG_MISSING");
    const savedDraft = await call(
      ids.user,
      `/quotations/${seeded.draftQuotationId}/draft-content`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          "if-match": quotationTag,
        },
        body: JSON.stringify({
          lines: [
            {
              productId: seeded.productId,
              description: "Quote proof line",
              qty: "2.5000",
              unitCode: "BOARD",
              unitPrice: "120.0000",
              discountAmount: "5.0000",
            },
          ],
          paymentTermsCode: seeded.paymentTermsCode,
          validFrom: new Date().toISOString().slice(0, 10),
          expiresOn: new Date(Date.now() + 7 * 86_400_000)
            .toISOString()
            .slice(0, 10),
        }),
      },
    );
    const savedDraftBody = await json(savedDraft);
    assert(
      savedDraft.status === 200,
      `QUOTATION_DRAFT_SAVE_FAILED_${savedDraft.status.toString()}_${JSON.stringify(savedDraftBody)}`,
    );
    const savedDraftVersion = (savedDraftBody.data as Record<string, unknown>)
      .rowVersion;
    assert(
      typeof savedDraftVersion === "string",
      "QUOTATION_DRAFT_VERSION_MISSING",
    );
    process.stdout.write("QUOTATION_PROOF_WORKFLOW_BOUNDARIES\n");
    const prepared = await call(
      ids.user,
      `/quotations/${seeded.draftQuotationId}/prepare`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `quotation-prepare-proof-${run}`,
        },
        body: JSON.stringify({ expectedRowVersion: savedDraftVersion }),
      },
    );
    const preparedBody = await json(prepared);
    assert(
      prepared.status === 202 &&
        (preparedBody.data as Record<string, unknown>).ready === true,
      `QUOTATION_PREPARE_FAILED_${JSON.stringify(preparedBody)}`,
    );
    const preview = await call(
      ids.user,
      `/quotations/${seeded.draftQuotationId}/preview`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `quotation-preview-proof-${run}`,
        },
        body: JSON.stringify({
          expectedRowVersion: savedDraftVersion,
          locale: "en",
        }),
      },
    );
    const previewBody = await json(preview);
    assert(
      preview.status === 200 &&
        String(
          (previewBody.data as Record<string, unknown>).previewUrl,
        ).startsWith("data:text/html;base64,"),
      "QUOTATION_PREVIEW_FAILED",
    );
    const approvalResponse = await call(
      ids.user,
      `/quotations/${seeded.draftQuotationId}/approval-requests`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `quotation-approval-proof-${run}`,
        },
        body: JSON.stringify({
          expectedRowVersion: savedDraftVersion,
          comment: "Proof approval",
        }),
      },
    );
    const approvalBody = await json(approvalResponse);
    const approvalData = approvalBody.data as
      Record<string, unknown> | undefined;
    const approvalId = approvalData?.approvalRequestId;
    assert(
      approvalResponse.status === 200 && typeof approvalId === "string",
      `APPROVAL_REQUEST_FAILED_${approvalResponse.status.toString()}_${JSON.stringify(approvalBody)}`,
    );
    const approvalList = await call(ids.approver, "/approval-requests");
    assert(
      approvalList.status === 200,
      `APPROVAL_LIST_FAILED_${approvalList.status.toString()}_${await approvalList.text()}`,
    );
    assert(
      (await call(ids.approver, `/approval-requests/${approvalId}`)).status ===
        200,
      "APPROVAL_CONTEXT_FAILED",
    );
    const selfDecision = await call(
      ids.user,
      `/approval-requests/${approvalId}/decisions`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `self-approval-proof-${run}`,
        },
        body: JSON.stringify({ decision: "APPROVE" }),
      },
    );
    assert(selfDecision.status === 403, "SELF_APPROVAL_NOT_DENIED");
    const decision = await call(
      ids.approver,
      `/approval-requests/${approvalId}/decisions`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `approval-decision-proof-${run}`,
        },
        body: JSON.stringify({
          decision: "APPROVE",
          comment: "Approved proof",
        }),
      },
    );
    const decisionBody = await json(decision);
    assert(
      decision.status === 200 &&
        (decisionBody.data as Record<string, unknown>).statusCode ===
          "APPROVED",
      `APPROVAL_DECISION_FAILED_${JSON.stringify(decisionBody)}`,
    );
    const officialDocument = await call(
      ids.user,
      `/quotations/${seeded.draftQuotationId}/prepare`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `quotation-document-proof-${run}`,
        },
        body: JSON.stringify({ expectedRowVersion: savedDraftVersion }),
      },
    );
    const officialDocumentBody = await json(officialDocument);
    assert(
      officialDocument.status === 202 &&
        typeof (officialDocumentBody.data as Record<string, unknown>)
          .documentJobId === "string",
      `QUOTATION_DOCUMENT_BOUNDARY_FAILED_${JSON.stringify(officialDocumentBody)}`,
    );
    const queuedSend = await call(
      ids.user,
      `/quotations/${seeded.draftQuotationId}/send`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `quotation-send-proof-${run}`,
        },
        body: JSON.stringify({
          expectedRowVersion: savedDraftVersion,
          // Recorded as sent by hand: the proof runs without a mail server.
          channelCode: "MANUAL",
          recipients: [
            { name: "Buyer", email: "buyer@example.test", isPrimary: true },
          ],
        }),
      },
    );
    const sendBody = await json(queuedSend);
    assert(
      queuedSend.status === 202 &&
        (sendBody.data as Record<string, unknown>).statusCode === "QUEUED",
      `QUOTATION_SEND_BOUNDARY_FAILED_${JSON.stringify(sendBody)}`,
    );
    const sendJobId = (sendBody.data as Record<string, unknown>)
      .quotationSendJobId;
    assert(
      typeof sendJobId === "string" &&
        (await db.durableJob.findUnique({ where: { id: sendJobId } }))
          ?.status === "PENDING",
      "QUOTATION_SEND_JOB_NOT_PERSISTED",
    );
    const accepted = await call(
      ids.user,
      `/quotations/${seeded.sentQuotationId}/acceptances`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `quotation-acceptance-proof-${run}`,
        },
        body: JSON.stringify({
          evidenceTypeCode: "EMAIL",
          externalReference: `acceptance-${run}`,
          acceptedAt: new Date(Date.now() - 1000).toISOString(),
        }),
      },
    );
    const acceptedBody = await json(accepted);
    assert(
      accepted.status === 201 &&
        (
          (acceptedBody.data as Record<string, unknown>).opportunity as Record<
            string,
            unknown
          >
        ).stageCode === "WON",
      `QUOTATION_ACCEPTANCE_FAILED_${JSON.stringify(acceptedBody)}`,
    );
    assert(
      (await call(ids.user, `/quotations/${seeded.sentQuotationId}/documents`))
        .status === 200,
      "QUOTATION_DOCUMENT_LIST_FAILED",
    );
    process.stdout.write("ERP_READ_ONLY_PROOF\n");
    const orderList = await call(ids.user, "/sales-orders");
    assert(
      orderList.status === 200,
      `ERP_ORDER_LIST_FAILED_${orderList.status.toString()}`,
    );
    const orderDetail = await call(
      ids.user,
      `/sales-orders/${seeded.erpOrderId}`,
    );
    assert(orderDetail.status === 200, "ERP_ORDER_DETAIL_FAILED");
    const sourceDetail = await call(
      ids.user,
      `/sales-orders/${seeded.erpOrderId}/source`,
    );
    const sourceBody = await json(sourceDetail);
    assert(
      sourceDetail.status === 200 &&
        (sourceBody.data as Record<string, unknown>).rawOrderNumber ===
          seeded.erpOrderNumber,
      `ERP_ORDER_SOURCE_FAILED_${JSON.stringify(sourceBody)}`,
    );
    const superseded = await call(
      ids.user,
      `/quotations/${seeded.sentQuotationId}/supersede`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `quotation-supersede-proof-${run}`,
        },
        body: JSON.stringify({ expectedRowVersion: '"rv-1"' }),
      },
    );
    const supersededBody = await json(superseded);
    assert(
      superseded.status === 200 &&
        (supersededBody.data as Record<string, unknown>).statusCode ===
          "DRAFT" &&
        (supersededBody.data as Record<string, unknown>)
          .supersedesQuotationId === seeded.sentQuotationId,
      `QUOTATION_SUPERSEDE_FAILED_${superseded.status.toString()}_${JSON.stringify(supersededBody)}`,
    );
    const supersededId = (supersededBody.data as Record<string, unknown>)
      .quotationId;
    assert(typeof supersededId === "string", "SUPERSEDED_ID_MISSING");
    const chain = await call(
      ids.user,
      `/quotations/${supersededId}/supersession-chain`,
    );
    const chainBody = await json(chain);
    assert(
      chain.status === 200 &&
        (chainBody.data as Array<Record<string, unknown>>).length === 2,
      "QUOTATION_SUPERSESSION_CHAIN_FAILED",
    );
    const audit = await db.auditEvent.count({
      where: {
        resourceType: {
          in: ["PricingGuardrail", "TaxPolicy", "PriceOverride"],
        },
      },
    });
    assert(audit >= 3, "PRICING_AUDIT_FAILED");
    process.stdout.write("PRICING_API_PROOF_PASSED\n");
  } finally {
    await app.close();
    delete process.env.ABP_TEST_AUTH_ENABLED;
  }
}
async function seed(db: DatabaseClient) {
  const suffix = Date.now().toString();
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
  for (const [id, subject, roleId] of [
    [ids.user, "pricing-proof-user", ids.role],
    [ids.deny, "pricing-proof-denied", ids.denyRole],
    [ids.approver, "pricing-proof-approver", ids.approverRole],
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
    await db.role.upsert({
      where: { code: roleId },
      create: { id: roleId, code: roleId, name: roleId, workspace: "SALES" },
      update: {},
    });
    await db.userRole.upsert({
      where: { userId_roleId: { userId: id, roleId } },
      create: { userId: id, roleId },
      update: {},
    });
  }
  for (const permissionCode of [
    permissions.pricingView,
    permissions.pricingManage,
    permissions.pricingOverrideMin,
    permissions.pricingPolicyView,
    permissions.pricingPolicyManage,
    permissions.quotationsView,
    permissions.quotationsCreate,
    permissions.quotationsEdit,
    permissions.quotationsCancel,
    permissions.quotationsRequestApproval,
    permissions.quotationsSend,
    permissions.quotationsAccept,
    permissions.documentsView,
    permissions.approvalsView,
    permissions.approvalsDecide,
    permissions.salesOrdersView,
    permissions.importSourceView,
  ])
    await db.rolePermission.upsert({
      where: { roleId_permissionCode: { roleId: ids.role, permissionCode } },
      create: { roleId: ids.role, permissionCode },
      update: {},
    });
  for (const permissionCode of [
    permissions.approvalsView,
    permissions.approvalsDecide,
    permissions.quotationApprove,
  ])
    await db.rolePermission.upsert({
      where: {
        roleId_permissionCode: { roleId: ids.approverRole, permissionCode },
      },
      create: { roleId: ids.approverRole, permissionCode },
      update: {},
    });
  await db.userProfile.update({
    where: { userId: ids.user },
    data: { managerUserId: ids.approver },
  });
  const existingDeny = await db.userPermissionOverride.findFirst({
    where: {
      userId: ids.deny,
      permissionCode: permissions.pricingView,
      effectCode: "DENY",
    },
  });
  if (!existingDeny)
    await db.userPermissionOverride.create({
      data: {
        userId: ids.deny,
        permissionCode: permissions.pricingView,
        effectCode: "DENY",
        reason: "Pricing proof explicit deny",
      },
    });
  for (const userId of [ids.user, ids.deny, ids.approver])
    await db.userCountryAccess.upsert({
      where: { userId_countryCode: { userId, countryCode: "EG" } },
      create: { userId, countryCode: "EG", grantedBy: ids.user },
      update: { statusCode: "ACTIVE", validTo: null },
    });
  for (const userId of [ids.user, ids.deny, ids.approver])
    await db.appSession.upsert({
      where: { id: `test-${userId}` },
      create: {
        id: `test-${userId}`,
        userId,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
      update: {
        userId,
        statusCode: "ACTIVE",
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
  const family = await db.productFamily.upsert({
    where: { familyCode: "PRICING_PROOF" },
    create: { familyCode: "PRICING_PROOF", name: "Pricing Proof" },
    update: {},
  });
  const product = await db.product.create({
    data: {
      skuCode: `PR-P-${suffix}`,
      productFamilyId: family.id,
      productTypeCode: "STANDARD_SKU",
      canonicalDescription: "Pricing proof board",
      normalizedDescription: "pricing proof board",
      createdByUserId: ids.user,
      updatedByUserId: ids.user,
    },
  });
  const activeFrom = new Date("2026-01-01T00:00:00.000Z");
  await db.pricingRule.create({
    data: {
      productId: product.id,
      currencyCode: "USD",
      minPrice: "100.0000",
      referencePrice: "120.0000",
      maxPrice: "125.0000",
      effectiveFrom: activeFrom,
      sourceCode: "PROOF",
    },
  });
  const term = await db.paymentTerm.create({
    data: {
      termCode: `NET30-${suffix}`,
      displayText: "Net 30",
      effectiveFrom: activeFrom,
      createdByUserId: ids.user,
    },
  });
  await db.pricingBaseConfig.create({
    data: {
      standardBoardPrice: "330.0000",
      currencyCode: "USD",
      standardWeightKg: "33.0000",
      effectiveFrom: activeFrom,
      createdByUserId: ids.user,
    },
  });
  const account = await db.account.create({
    data: {
      canonicalName: `Pricing Proof ${suffix}`,
      normalizedName: `pricing proof ${suffix}`,
      countryCode: "EG",
      ownerUserId: ids.user,
      createdByUserId: ids.user,
      updatedByUserId: ids.user,
    },
  });
  const opportunity = await db.opportunity.create({
    data: {
      accountId: account.id,
      countryCode: "EG",
      ownerUserId: ids.user,
      stageCode: "QUALIFIED",
      noProjectReasonCode: "NOT_REQUIRED",
      createdByUserId: ids.user,
      updatedByUserId: ids.user,
    },
  });
  const quotation = await db.quotation.create({
    data: {
      accountId: account.id,
      opportunityId: opportunity.id,
      countryCode: "EG",
      ownerUserId: ids.user,
      currencyCode: "USD",
      createdByUserId: ids.user,
      updatedByUserId: ids.user,
    },
  });
  const line = await db.quotationLine.create({
    data: {
      quotationId: quotation.id,
      productId: product.id,
      lineNo: 1,
      description: "Pricing proof",
      qty: "1",
      unitCode: "BOARD",
      unitPrice: "120",
      lineTotal: "120",
    },
  });
  const draftQuotation = await db.quotation.create({
    data: {
      accountId: account.id,
      opportunityId: opportunity.id,
      countryCode: "EG",
      ownerUserId: ids.user,
      currencyCode: "USD",
      createdByUserId: ids.user,
      updatedByUserId: ids.user,
    },
  });
  const sentQuotation = await db.quotation.create({
    data: {
      accountId: account.id,
      opportunityId: opportunity.id,
      countryCode: "EG",
      ownerUserId: ids.user,
      currencyCode: "USD",
      statusCode: "SENT",
      sentAt: new Date(),
      commercialStateCode: "SUBMITTED",
      firstSubmittedAt: new Date(),
      contentHash: `proof-sent-${suffix}`,
      subtotalAmount: "120",
      totalAmount: "120",
      createdByUserId: ids.user,
      updatedByUserId: ids.user,
    },
  });
  await db.quotationLine.create({
    data: {
      quotationId: sentQuotation.id,
      productId: product.id,
      lineNo: 1,
      description: "Sent quotation proof",
      qty: "1",
      unitCode: "BOARD",
      unitPrice: "120",
      lineTotal: "120",
    },
  });
  const importBatch = await db.importBatch.create({
    data: {
      sourceSystemCode: "ERP",
      sourceSystemId: "e7000000-0000-4000-8000-000000000020",
      importTypeCode: "SALES_ORDERS",
      sourceFingerprint: `proof-${suffix}`,
      actorUserId: ids.user,
    },
  });
  const importRow = await db.importRow.create({
    data: {
      importBatchId: importBatch.id,
      sourceRowKey: `ERP-${suffix}`,
      sourceEntityCode: "SALES_ORDER",
      rowNo: 1,
      rawPayload: {
        orderNumber: `ERP-${suffix}`,
        customerNumber: "C-001",
        status: "Booked",
      },
      normalizedPayload: {
        orderNumber: `ERP-${suffix}`,
        customerNumber: "C-001",
        status: "Booked",
      },
      payloadHash: `hash-${suffix}`,
      statusCode: "COMMITTED",
    },
  });
  const erpOrder = await db.eRPOrder.create({
    data: {
      sourceSystemCode: "ERP",
      sourceOrderKey: `ERP-${suffix}`,
      sourceSystemId: "e7000000-0000-4000-8000-000000000020",
      sourceSalesOrderId: importRow.id,
      importRowId: importRow.id,
      accountId: account.id,
      importBatchId: importBatch.id,
      countryCode: "EG",
      orderDate: new Date(),
      statusRaw: "Booked",
      statusCode: "BOOKED",
      currencyCode: "USD",
      totalAmount: "500",
      bookedAmount: "500",
    },
  });
  await db.eRPOrderLine.create({
    data: {
      erpOrderId: erpOrder.id,
      sourceLineKey: "1",
      productId: product.id,
      importRowId: importRow.id,
      qtyBooked: "10",
      qtyShipped: "2",
      qtyInvoiced: "1",
      qtyRemaining: "8",
    },
  });
  return {
    productId: product.id,
    opportunityId: opportunity.id,
    quotationId: quotation.id,
    draftQuotationId: draftQuotation.id,
    sentQuotationId: sentQuotation.id,
    lineId: line.id,
    paymentTermsCode: term.termCode,
    erpOrderId: erpOrder.id,
    erpOrderNumber: erpOrder.sourceOrderKey,
  };
}
function assert(value: unknown, code: string): asserts value {
  if (!value) throw new Error(code);
}
void main();
