/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-base-to-string, @typescript-eslint/restrict-template-expressions, @typescript-eslint/no-unsafe-argument, @typescript-eslint/restrict-plus-operands */
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright";
import ExcelJS from "exceljs";
import {
  type DatabaseClient,
  type DurableJobHandler,
  type PlatformWorkerHandlers,
  syncOrderToMockErp,
} from "@abp/database";
import { ABP_LOGO_PNG_BASE64 } from "./assets/logo.js";
import { readMailConfig } from "./mail/mail-config.js";
import {
  escapeHtml as escapeMail,
  quotationEmail,
} from "./mail/mail-templates.js";
import { orderConfirmationHandler } from "./order-confirmation.js";

type Payload = Record<string, unknown>;

export function createStep8WorkflowHandlers(): PlatformWorkerHandlers {
  const quotationSend = quotationSendHandler();
  return {
    outbox: {
      QUOTATION_APPROVAL_REQUESTED: approvalRoutingHandler(),
      RETURN_APPROVAL_REQUESTED: returnedScrapRoutingHandler(),
      RETURNED_SCRAP_APPROVAL_REQUESTED: returnedScrapRoutingHandler(),
      ...Object.fromEntries(
        [
          "QUOTATION_DOCUMENT_REQUESTED",
          "QUOTATION_SEND_REQUESTED",
          "QUOTATION_SEND_QUEUED",
          "IMPORT_VALIDATION_REQUESTED",
          "IMPORT_COMMIT_REQUESTED",
          "IMPORT_RETRY_REQUESTED",
          "IMPORT_ROLLBACK_REQUESTED",
          "RECONCILIATION_REQUESTED",
          "LOGISTICS_OPTIMIZE_REQUESTED",
          "LOGISTICS_EXPORT_REQUESTED",
          "DOCUMENT_SCAN_REQUESTED",
          "EXPORT_REQUESTED",
          "ANALYTICS_EXPORT_REQUESTED",
        ].map((type) => [type, workflowBoundaryAcknowledgementHandler(type)]),
      ),
    },
    jobs: {
      ERP_ORDER_SYNC: erpOrderSyncHandler(),
      QUOTATION_DOCUMENT: quotationDocumentHandler(false),
      QUOTATION_SEND: quotationSend,
      QUOTATION_OFFICIAL_DOCUMENT_AND_SEND: quotationSend,
      IMPORT_VALIDATE: importValidateHandler(),
      IMPORT_COMMIT: importCommitHandler(),
      IMPORT_RETRY: importRetryHandler(),
      IMPORT_ROLLBACK: importRollbackHandler(),
      RECONCILIATION_RUN: reconciliationHandler(),
      LOGISTICS_OPTIMIZE: logisticsOptimizeHandler(),
      LOGISTICS_EXPORT: logisticsExportHandler(),
      MALWARE_SCAN: malwareScanHandler(),
      DATA_EXPORT: dataExportHandler(),
      ANALYTICS_EXPORT: analyticsExportHandler(),
      USER_INVITE_EMAIL: inviteEmailHandler(),
      ORDER_CONFIRMATION_SEND: orderConfirmationHandler(),
    },
  };
}

export async function enqueuePendingErpSyncJobs(
  database: DatabaseClient,
  batchSize = 25,
): Promise<number> {
  const orders = await database.eRPOrder.findMany({
    where: { integrationStatusCode: "PENDING_SYNC" },
    orderBy: [{ importedAt: "asc" }, { id: "asc" }],
    take: batchSize,
    select: { id: true, rowVersion: true },
  });
  for (const order of orders) {
    const idempotencyKey = `erp-order-sync:${order.id}:${order.rowVersion.toString()}`;
    await database.durableJob.upsert({
      where: {
        type_idempotencyKey: { type: "ERP_ORDER_SYNC", idempotencyKey },
      },
      create: {
        type: "ERP_ORDER_SYNC",
        payload: { orderId: order.id },
        traceId: `erp-sync-${order.id}`,
        correlationId: `erp-sync-${order.id}`,
        idempotencyKey,
        sourceType: "ERP_ORDER",
        sourceId: order.id,
      },
      update: {},
    });
  }
  return orders.length;
}

function erpOrderSyncHandler(): DurableJobHandler {
  return async (job, dependencies) => {
    const orderId = text(object(job.payload).orderId, "ERP_ORDER_ID_REQUIRED");
    try {
      const result = await syncOrderToMockErp(dependencies.database, orderId);
      await dependencies.transactionManager.run(
        { traceId: job.traceId, correlationId: job.correlationId },
        async (transaction) => {
          await appendAudit(
            transaction,
            job,
            "ERP_ORDER_SYNCED",
            "ERP_ORDER",
            orderId,
            { externalErpId: result.erpId, syncedAt: result.syncedAt },
          );
        },
      );
      return { resultReference: `erp-order:${orderId}:${result.erpId}` };
    } catch (error) {
      const errorCode =
        error instanceof Error ? error.message : "ERP_SYNC_FAILED";
      await dependencies.database.eRPOrder.updateMany({
        where: { id: orderId },
        data: {
          integrationStatusCode: "SYNC_FAILED",
          syncAttemptedAt: new Date(),
          syncErrorCode: errorCode,
          rowVersion: { increment: 1 },
        },
      });
      throw error;
    }
  };
}

function workflowBoundaryAcknowledgementHandler(eventType: string) {
  return async (message: any, d: any) => {
    await d.transactionManager.run(
      { traceId: message.traceId, correlationId: message.correlationId },
      async (tx: any) => {
        const resourceId = String(message.aggregateId);
        const exists = await tx.auditEvent.findFirst({
          where: {
            actionCode: "WORKFLOW_COMMAND_ACCEPTED",
            resourceType: eventType,
            resourceId,
            correlationId: message.correlationId,
            source: "step8-worker",
          },
        });
        if (!exists)
          await tx.auditEvent.create({
            data: {
              actionCode: "WORKFLOW_COMMAND_ACCEPTED",
              resourceType: eventType,
              resourceId,
              workspace: "WORKFLOW",
              metadata: { schemaVersion: message.schemaVersion ?? 1 },
              traceId: message.traceId,
              correlationId: message.correlationId,
              source: "step8-worker",
            },
          });
      },
    );
  };
}

function approvalRoutingHandler() {
  return async (message: any, d: any) => {
    const p = object(message.payload);
    const approvalId = text(p.approvalRequestId, "APPROVAL_REQUEST_REQUIRED");
    const approval = await d.database.quotationApproval.findUnique({
      where: { id: approvalId },
    });
    if (!approval) fail("APPROVAL_REQUEST_NOT_FOUND");
    if (!approval.currentAssigneeUserId) return;
    await d.transactionManager.run(
      { traceId: message.traceId, correlationId: message.correlationId },
      async (tx: any) => {
        const exists = await tx.userNotification.findFirst({
          where: {
            recipientUserId: approval.currentAssigneeUserId,
            typeCode: "QUOTATION_APPROVAL_ASSIGNED",
            resourceId: approval.id,
          },
        });
        if (!exists)
          await tx.userNotification.create({
            data: {
              recipientUserId: approval.currentAssigneeUserId,
              typeCode: "QUOTATION_APPROVAL_ASSIGNED",
              titleSafe: "Quotation approval requires your decision",
              resourceTypeCode: "QUOTATION_APPROVAL",
              resourceId: approval.id,
              actionCode: "OPEN_APPROVAL",
            },
          });
      },
    );
  };
}

function returnedScrapRoutingHandler() {
  return async (message: any, d: any) => {
    const requestId = String(
      object(message.payload).caseId ?? message.aggregateId,
    );
    const request = await d.database.returnedScrapRequest.findUnique({
      where: { id: requestId },
    });
    if (!request) return;
    const profile = await d.database.userProfile.findUnique({
      where: { userId: request.requestedByUserId },
    });
    if (!profile?.managerUserId) return;
    await d.transactionManager.run(
      { traceId: message.traceId, correlationId: message.correlationId },
      async (tx: any) => {
        const exists = await tx.userNotification.findFirst({
          where: {
            recipientUserId: profile.managerUserId,
            typeCode: "RETURNED_SCRAP_APPROVAL_ASSIGNED",
            resourceId: request.id,
          },
        });
        if (!exists)
          await tx.userNotification.create({
            data: {
              recipientUserId: profile.managerUserId,
              typeCode: "RETURNED_SCRAP_APPROVAL_ASSIGNED",
              titleSafe: "Returned scrap case requires manager approval",
              resourceTypeCode: "RETURNED_SCRAP",
              resourceId: request.id,
              actionCode: "OPEN_RETURN_APPROVAL",
            },
          });
      },
    );
  };
}

export function mergeHandlers(
  ...sets: PlatformWorkerHandlers[]
): PlatformWorkerHandlers {
  return {
    outbox: Object.assign({}, ...sets.map((set) => set.outbox)),
    jobs: Object.assign({}, ...sets.map((set) => set.jobs)),
  };
}

function quotationSendHandler(): DurableJobHandler {
  const render = quotationDocumentHandler(true);
  return async (job, dependencies) => render(job, dependencies);
}

function quotationDocumentHandler(finalizeSend: boolean): DurableJobHandler {
  return async (job, dependencies) => {
    const payload = object(job.payload);
    const quotationId = text(payload.quotationId, "QUOTATION_ID_REQUIRED");
    const candidateHash = text(
      payload.candidateHash,
      "CANDIDATE_HASH_REQUIRED",
    );
    const quote = await dependencies.database.quotation.findUnique({
      where: { id: quotationId },
      include: {
        account: { include: { country: true } },
        project: true,
        owner: { include: { profile: true } },
        lines: {
          orderBy: { lineNo: "asc" },
          // The product's current primary photo, used only when the line has no
          // snapshot of its own (a draft that has never been issued).
          include: {
            product: {
              include: {
                productImages: { where: { isPrimary: true }, take: 1 },
              },
            },
          },
        },
      },
    });
    if (!quote) fail("QUOTATION_NOT_FOUND");
    if (quote.contentHash !== candidateHash) fail("SEND_CANDIDATE_MISMATCH");
    const expectedVersion = payload.quotationRowVersionSnapshot;
    if (
      typeof expectedVersion === "string" &&
      quote.rowVersion !== BigInt(expectedVersion)
    )
      fail("SEND_CANDIDATE_VERSION_MISMATCH");
    if (quote.statusCode === "SENT")
      return { resultReference: `quotation:${quote.id}:sent` };
    if (!new Set(["DRAFT", "READY"]).has(quote.statusCode))
      fail("QUOTATION_SEND_STATE_INVALID");
    const approval = await dependencies.database.quotationApproval.findFirst({
      where: {
        quotationId,
        contentHash: candidateHash,
        statusCode: "APPROVED",
      },
      orderBy: { decidedAt: "desc" },
    });
    if (!approval) fail("QUOTATION_APPROVAL_REQUIRED");

    // Snapshot the photo each line is being issued with, before rendering.
    //
    // Without this the document would render whatever the product's primary
    // photo happens to be at the time it is *read* — so replacing a product
    // photo next year would silently change what a customer was sent today.
    // The id is stamped once, on the first official issue, and never revised.
    for (const line of quote.lines) {
      if (line.productImageId !== null) continue;
      const current = line.product?.productImages[0]?.id;
      if (current === undefined) continue;
      await dependencies.database.quotationLine.update({
        where: { id: line.id },
        data: { productImageId: current },
      });
      line.productImageId = current;
    }

    const html = officialQuotationHtml(quote);
    const relativeKey = `official-quotations/${quotationId}/${candidateHash}.pdf`;
    const file = objectPath(relativeKey);
    await mkdir(dirname(file), { recursive: true });
    try {
      await stat(file);
    } catch {
      const browser = await chromium.launch({
        headless: true,
        ...(process.env.ABP_CHROMIUM_EXECUTABLE_PATH
          ? { executablePath: process.env.ABP_CHROMIUM_EXECUTABLE_PATH }
          : {}),
      });
      try {
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: "load" });
        await page.pdf({
          path: file,
          format: "A4",
          printBackground: true,
          margin: { top: "12mm", right: "12mm", bottom: "12mm", left: "12mm" },
        });
      } finally {
        await browser.close();
      }
    }
    const bytes = await readFile(file);
    if (!bytes.subarray(0, 5).equals(Buffer.from("%PDF-")))
      fail("PDF_ARTIFACT_INVALID");
    const hash = sha(bytes);
    const result = await dependencies.transactionManager.run(
      { traceId: job.traceId, correlationId: job.correlationId },
      async (tx) => {
        const current = await tx.quotation.findUnique({
          where: { id: quotationId },
        });
        if (!current || current.contentHash !== candidateHash)
          fail("SEND_CANDIDATE_MISMATCH");
        let metadata = await tx.documentMetadata.findUnique({
          where: { storageKey: relativeKey },
        });
        if (!metadata)
          metadata = await tx.documentMetadata.create({
            data: {
              resourceTypeCode: "QUOTATION",
              resourceId: quotationId,
              storageKey: relativeKey,
              mimeType: "application/pdf",
              sizeBytes: BigInt(bytes.length),
              fileHash: hash,
              classificationCode: "COMMERCIAL_CONFIDENTIAL",
              documentTypeCode: "OFFICIAL_QUOTATION",
              title: `${quote.quotationRef}.pdf`,
              statusCode: "AVAILABLE",
              isFinal: true,
              createdByUserId: text(payload.createdByUserId, "ACTOR_REQUIRED"),
              versions: {
                create: {
                  versionNo: 1,
                  storageKey: relativeKey,
                  mimeType: "application/pdf",
                  sizeBytes: BigInt(bytes.length),
                  contentHash: hash,
                  sourceTypeCode: "GENERATED_OFFICIAL",
                  createdByUserId: text(
                    payload.createdByUserId,
                    "ACTOR_REQUIRED",
                  ),
                  rendererVersion: "playwright-1.55.0/chromium-140",
                  immutable: true,
                },
              },
            },
          });
        let official = await tx.officialQuotationDocument.findFirst({
          where: { quotationId, contentHash: candidateHash, isFinal: true },
        });
        if (!official)
          official = await tx.officialQuotationDocument.create({
            data: {
              quotationId,
              documentMetadataId: metadata.id,
              contentHash: candidateHash,
              templateVersion: "step8-v1",
              rendererVersion: "playwright-1.55.0/chromium-140",
            },
          });
        await appendAudit(
          tx,
          job,
          "QUOTATION_PDF_GENERATED",
          "Quotation",
          quotationId,
          {
            documentId: metadata.id,
            sha256: hash,
          },
        );
        if (!finalizeSend)
          return { documentId: metadata.id, officialId: official.id };

        const channel = text(
          payload.channelCode,
          "SEND_CHANNEL_REQUIRED",
        ).toUpperCase();
        if (!new Set(["MANUAL", "EXTERNAL", "EMAIL"]).has(channel))
          fail("SEND_CHANNEL_INVALID");
        const recipients = array(payload.recipients);
        if (recipients.length === 0) fail("RECIPIENT_REQUIRED");
        const actorUserId = text(payload.createdByUserId, "ACTOR_REQUIRED");

        // Sent by the system: the PDF goes out through Outlook from the
        // company mailbox, and replies come back to the salesperson.
        let emailMessageId: string | null = null;
        if (channel === "EMAIL") {
          const mail = readMailConfig();
          if (mail.provider === "NONE") fail("EMAIL_NOT_CONFIGURED");
          const addresses = recipients.map((recipient) =>
            String(object(recipient).email ?? "").trim(),
          );
          if (addresses.some((address) => !/^[^\s@]+@[^\s@]+$/.test(address)))
            fail("RECIPIENT_EMAIL_REQUIRED");
          const actor = await tx.appUser.findUnique({
            where: { id: actorUserId },
            select: { displayName: true, emailNormalized: true },
          });
          const actorEmail = actor?.emailNormalized.includes("@")
            ? actor.emailNormalized
            : null;
          const email = quotationEmail({
            lang: payload.languageCode === "ar" ? "ar" : "en",
            subject:
              typeof payload.subject === "string" ? payload.subject : null,
            message:
              typeof payload.message === "string" ? payload.message : null,
            quotationRef: quote.quotationRef,
            customerName: quote.account.canonicalName,
            salesName: actor?.displayName ?? "ACROW",
            salesEmail: actorEmail,
          });
          const message = await tx.emailMessage.create({
            data: {
              purposeCode: "QUOTATION",
              toAddresses: addresses,
              ccAddresses:
                payload.ccSelf === true && actorEmail ? [actorEmail] : [],
              replyTo: actorEmail,
              subject: email.subject.slice(0, 250),
              bodyHtml: email.html,
              bodyText: email.text,
              attachments: [
                {
                  storageKey: relativeKey,
                  fileName: `${quote.quotationRef}.pdf`,
                  mimeType: "application/pdf",
                },
              ],
              resourceTypeCode: "QUOTATION",
              resourceId: quotationId,
              createdByUserId: actorUserId,
            },
          });
          emailMessageId = message.id;
        }
        for (const recipient of recipients) {
          const value = object(recipient);
          const address = String(
            value.email ?? value.address ?? value.name ?? "",
          ).trim();
          if (!address) fail("RECIPIENT_INVALID");
          await tx.quotationSendEvent.create({
            data: {
              quotationId,
              officialDocumentId: official.id,
              recipient: address,
              methodCode: channel,
              actorUserId,
              providerReference: null,
              metadata:
                emailMessageId === null
                  ? {
                      deliveryStatus: "UNVERIFIED",
                      evidence: "USER_CONFIRMED_MANUAL_SEND",
                    }
                  : { deliveryStatus: "QUEUED", emailMessageId },
            },
          });
        }
        const changed = await tx.quotation.updateMany({
          where: {
            id: quotationId,
            contentHash: candidateHash,
            statusCode: { in: ["DRAFT", "READY"] },
          },
          data: {
            statusCode: "SENT",
            commercialStateCode: "SUBMITTED",
            firstSubmittedAt: new Date(),
            sentAt: new Date(),
            rowVersion: { increment: 1 },
          },
        });
        if (changed.count !== 1) fail("QUOTATION_SEND_CONCURRENCY_CONFLICT");
        // The proforma invoice number is issued at the moment the document
        // officially goes out, not when it is drafted: a number handed to a
        // customer must belong to a document that actually left the building.
        // Issued once - a resend of the same document keeps its number.
        await tx.$executeRaw`
          UPDATE quotations
             SET pi_number = next_pi_number(), pi_issued_at = now()
           WHERE quotation_id = ${quotationId}::uuid
             AND pi_number IS NULL`;
        const submitted = await tx.quotation.findUniqueOrThrow({
          where: { id: quotationId },
          select: { rowVersion: true },
        });
        await tx.quotationCommercialStateEvent.create({
          data: {
            quotationId,
            fromStateCode: "NOT_SUBMITTED",
            toStateCode: "SUBMITTED",
            actorUserId: text(payload.createdByUserId, "ACTOR_REQUIRED"),
            quotationRowVersion: submitted.rowVersion,
          },
        });
        await appendAudit(
          tx,
          job,
          emailMessageId === null
            ? "QUOTATION_SENT_MANUAL_UNVERIFIED"
            : "QUOTATION_SENT_BY_EMAIL",
          "Quotation",
          quotationId,
          {
            officialDocumentId: official.id,
            channel,
            ...(emailMessageId === null ? {} : { emailMessageId }),
          },
        );
        await tx.outboxMessage.create({
          data: {
            eventType: "QUOTATION_SENT",
            aggregateType: "Quotation",
            aggregateId: quotationId,
            payload: {
              quotationId,
              officialDocumentId: official.id,
              deliveryStatus: emailMessageId === null ? "UNVERIFIED" : "QUEUED",
            },
            traceId: job.traceId,
            correlationId: job.correlationId,
            idempotencyKey: `sent:${job.jobId}`,
          },
        });
        return { documentId: metadata.id, officialId: official.id };
      },
    );
    return { resultReference: `quotation-document:${result.documentId}` };
  };
}

function malwareScanHandler(): DurableJobHandler {
  return async (job, dependencies) => {
    const p = object(job.payload);
    const id = text(p.uploadSessionId, "UPLOAD_SESSION_REQUIRED");
    const session = await dependencies.database.uploadSession.findUnique({
      where: { id },
    });
    if (!session) fail("UPLOAD_SESSION_NOT_FOUND");
    if (session.statusCode === "AVAILABLE")
      return { resultReference: `document:${session.documentId}` };
    const file = objectPath(text(p.storageKey, "STORAGE_KEY_REQUIRED"));
    const bytes = await readFile(file);
    const infected = bytes.includes(
      Buffer.from("EICAR-STANDARD-ANTIVIRUS-TEST-FILE"),
    );
    if (infected) {
      await dependencies.database.uploadSession.update({
        where: { id },
        data: { statusCode: "REJECTED", malwareStatusCode: "INFECTED" },
      });
      fail("MALWARE_DETECTED");
    }
    const document = await dependencies.transactionManager.run(
      { traceId: job.traceId, correlationId: job.correlationId },
      async (tx) => {
        let doc = await tx.documentMetadata.findUnique({
          where: { storageKey: session.storageKey },
        });
        if (!doc)
          doc = await tx.documentMetadata.create({
            data: {
              resourceTypeCode: session.targetResourceType ?? "UPLOAD",
              resourceId: session.targetResourceId ?? session.id,
              storageKey: session.storageKey,
              mimeType: session.expectedMimeType,
              sizeBytes: BigInt(bytes.length),
              fileHash: session.actualSha256 ?? sha(bytes),
              classificationCode: "PRIVATE",
              documentTypeCode: session.documentTypeCode,
              title: session.fileName,
              statusCode: "AVAILABLE",
              createdByUserId: session.requestedByUserId,
              versions: {
                create: {
                  versionNo: 1,
                  storageKey: session.storageKey,
                  mimeType: session.expectedMimeType,
                  sizeBytes: BigInt(bytes.length),
                  contentHash: session.actualSha256 ?? sha(bytes),
                  sourceTypeCode: "UPLOADED",
                  createdByUserId: session.requestedByUserId,
                  immutable: true,
                },
              },
            },
          });
        await tx.uploadSession.update({
          where: { id },
          data: {
            statusCode: "AVAILABLE",
            malwareStatusCode: "CLEAN",
            documentId: doc.id,
          },
        });
        await appendAudit(
          tx,
          job,
          "UPLOAD_MALWARE_SCAN_CLEAN",
          "UploadSession",
          id,
          { documentId: doc.id },
        );
        return doc;
      },
    );
    return { resultReference: `document:${document.id}` };
  };
}

function importValidateHandler(): DurableJobHandler {
  return async (job, d) => {
    const p = object(job.payload),
      id = text(p.importJobId, "IMPORT_JOB_REQUIRED");
    const rows = await d.database.importRow.findMany({
      where: { importBatchId: id },
      orderBy: { rowNo: "asc" },
    });
    if (!rows.length) fail("IMPORT_VALIDATION_ROWS_REQUIRED");
    const fingerprint = sha(
      Buffer.from(
        JSON.stringify(rows.map((r) => [r.sourceRowKey, r.payloadHash])),
      ),
    );
    await d.transactionManager.run(
      { traceId: job.traceId, correlationId: job.correlationId },
      async (tx) => {
        await tx.importBatch.update({
          where: { id },
          data: {
            statusCode: "PREVIEWED",
            previewedAt: new Date(),
            currentPreviewFingerprint: fingerprint,
            currentPreviewAttemptId: job.jobId,
            rowVersion: { increment: 1 },
          },
        });
        await appendAudit(tx, job, "IMPORT_VALIDATED", "ImportBatch", id, {
          fingerprint,
          rows: rows.length,
        });
      },
    );
    return { resultReference: `import-preview:${id}:${fingerprint}` };
  };
}

function importCommitHandler(): DurableJobHandler {
  return async (job, d) => {
    const id = text(object(job.payload).importJobId, "IMPORT_JOB_REQUIRED");
    await d.transactionManager.run(
      { traceId: job.traceId, correlationId: job.correlationId },
      async (tx) => {
        const batch = await tx.importBatch.findUnique({ where: { id } });
        if (!batch) fail("IMPORT_JOB_NOT_FOUND");
        if (batch.statusCode === "COMMITTED") return;
        if (batch.statusCode !== "COMMIT_REQUESTED")
          fail("IMPORT_COMMIT_STATE_INVALID");
        const blockers = await tx.dQIssue.count({
          where: {
            importBatchId: id,
            statusCode: "OPEN",
            severityCode: { in: ["BLOCKER", "ERROR"] },
          },
        });
        if (blockers) fail("IMPORT_DQ_BLOCKERS_OPEN");
        const rows = await tx.importRow.findMany({
          where: { importBatchId: id, statusCode: "VALID" },
          orderBy: { rowNo: "asc" },
        });
        if (batch.importTypeCode === "SALES_ORDERS") {
          for (const row of rows) {
            const values = object(row.normalizedPayload);
            const sourceOrderKey = text(
              values.orderNumber ?? values.sourceSalesOrderId,
              "ERP_ORDER_NATURAL_KEY_REQUIRED",
            );
            const countryCode = text(
              values.countryCode,
              "ERP_ORDER_COUNTRY_REQUIRED",
            ).toUpperCase();
            const before = await tx.eRPOrder.findUnique({
              where: {
                sourceSystemCode_sourceOrderKey: {
                  sourceSystemCode: batch.sourceSystemCode,
                  sourceOrderKey,
                },
              },
            });
            const order = await tx.eRPOrder.upsert({
              where: {
                sourceSystemCode_sourceOrderKey: {
                  sourceSystemCode: batch.sourceSystemCode,
                  sourceOrderKey,
                },
              },
              create: {
                sourceSystemCode: batch.sourceSystemCode,
                sourceOrderKey,
                sourceSystemId: batch.sourceSystemId,
                sourceSalesOrderId: stableUuid(
                  `${batch.sourceSystemId}:${sourceOrderKey}`,
                ),
                importRowId: row.id,
                countryCode,
                importBatchId: batch.id,
                statusCode: String(values.statusCode ?? "IMPORTED"),
                statusRaw:
                  typeof values.statusRaw === "string"
                    ? values.statusRaw
                    : null,
              },
              update: {
                importRowId: row.id,
                countryCode,
                importBatchId: batch.id,
                statusCode: String(values.statusCode ?? "IMPORTED"),
                statusRaw:
                  typeof values.statusRaw === "string"
                    ? values.statusRaw
                    : null,
                rowVersion: { increment: 1 },
              },
            });
            await appendAudit(
              tx,
              job,
              before ? "ERP_ORDER_SOURCE_UPDATED" : "ERP_ORDER_IMPORTED",
              "ERPOrder",
              order.id,
              {
                importBatchId: batch.id,
                importRowId: row.id,
                beforePayloadHash: before
                  ? sha(Buffer.from(JSON.stringify(normalizeForHash(before))))
                  : null,
                afterPayloadHash: row.payloadHash,
              },
            );
          }
        }
        // Customers. This type was offered on the import screen and wrote
        // nothing: the batch went to COMMITTED and no account existed, so the
        // screen reported success for work it had not done.
        if (batch.importTypeCode === "CUSTOMERS") {
          for (const row of rows) {
            const values = object(row.normalizedPayload);
            const customerNumber = text(
              values.customerNumber ?? values.sourceCustomerKey,
              "CUSTOMER_NATURAL_KEY_REQUIRED",
            );
            const canonicalName = text(
              values.canonicalName ?? values.name,
              "CUSTOMER_NAME_REQUIRED",
            );
            const countryCode = text(
              values.countryCode,
              "CUSTOMER_COUNTRY_REQUIRED",
            ).toUpperCase();
            // `customerNumber` is indexed but not unique, so the row is found
            // within its own source system rather than upserted on a key the
            // database does not enforce.
            const before = await tx.account.findFirst({
              where: {
                customerNumber,
                sourceSystemId: batch.sourceSystemId,
              },
            });
            const data = {
              customerNumber,
              canonicalName,
              rawName: canonicalName,
              normalizedName: canonicalName.trim().toLowerCase(),
              countryCode,
              sourceSystemId: batch.sourceSystemId,
              sourceRecordKey: customerNumber,
              sourceImportBatchId: batch.id,
              sourceRowNo: row.rowNo,
            };
            const account =
              before === null
                ? await tx.account.create({
                    data: {
                      ...data,
                      // The import is not a person, so the batch's own actor
                      // owns what it creates until somebody is assigned.
                      ownerUserId: batch.actorUserId,
                      createdByUserId: batch.actorUserId,
                      updatedByUserId: batch.actorUserId,
                    },
                  })
                : await tx.account.update({
                    where: { id: before.id },
                    data: {
                      ...data,
                      updatedByUserId: batch.actorUserId,
                      rowVersion: { increment: 1 },
                    },
                  });
            await appendAudit(
              tx,
              job,
              before ? "ACCOUNT_SOURCE_UPDATED" : "ACCOUNT_IMPORTED",
              "Account",
              account.id,
              {
                importBatchId: batch.id,
                importRowId: row.id,
                beforePayloadHash: before
                  ? sha(Buffer.from(JSON.stringify(normalizeForHash(before))))
                  : null,
                afterPayloadHash: row.payloadHash,
              },
            );
          }
        }

        // The item master. Same story: offered, validated, committed, and no
        // product written.
        if (batch.importTypeCode === "ITEM_MASTER") {
          for (const row of rows) {
            const values = object(row.normalizedPayload);
            const skuCode = text(
              values.sku ?? values.skuCode ?? values.sourceItemKey,
              "ITEM_NATURAL_KEY_REQUIRED",
            );
            const description = text(
              values.description ?? values.canonicalDescription,
              "ITEM_DESCRIPTION_REQUIRED",
            );
            const familyCode = text(
              values.familyCode,
              "ITEM_FAMILY_REQUIRED",
            ).toUpperCase();
            // A product must belong to a family, and inventing one would file
            // stock under a category nobody chose. An unknown code stops the
            // commit and names itself.
            const family = await tx.productFamily.findFirst({
              where: { familyCode },
            });
            if (!family) fail("ITEM_FAMILY_UNKNOWN");
            const before = await tx.product.findUnique({ where: { skuCode } });
            // Prisma takes a string for a Decimal column, so the value goes
            // across as written rather than through a float that would round
            // a 14.5mm board to something else.
            const dimension = (value: unknown) =>
              typeof value === "number" || typeof value === "string"
                ? String(value).trim() || null
                : null;
            const data = {
              skuCode,
              canonicalDescription: description,
              normalizedDescription: description.trim().toLowerCase(),
              productFamilyId: family.id,
              productTypeCode: String(values.productTypeCode ?? "BOARD"),
              thicknessMm: dimension(values.thicknessMm),
              widthMm: dimension(values.widthMm),
              lengthMm: dimension(values.lengthMm),
              weightKg: dimension(values.weightKg),
              densityKgM3: dimension(values.densityKgM3),
              sourceSystemId: batch.sourceSystemId,
              sourceRecordKey: skuCode,
              sourceImportBatchId: batch.id,
              sourceRowNo: row.rowNo,
            };
            const product =
              before === null
                ? await tx.product.create({
                    data: {
                      ...data,
                      createdByUserId: batch.actorUserId,
                      updatedByUserId: batch.actorUserId,
                    },
                  })
                : await tx.product.update({
                    where: { id: before.id },
                    data: {
                      ...data,
                      updatedByUserId: batch.actorUserId,
                      rowVersion: { increment: 1 },
                    },
                  });
            await appendAudit(
              tx,
              job,
              before ? "PRODUCT_SOURCE_UPDATED" : "PRODUCT_IMPORTED",
              "Product",
              product.id,
              {
                importBatchId: batch.id,
                importRowId: row.id,
                beforePayloadHash: before
                  ? sha(Buffer.from(JSON.stringify(normalizeForHash(before))))
                  : null,
                afterPayloadHash: row.payloadHash,
              },
            );
          }
        }

        await tx.importBatch.update({
          where: { id },
          data: {
            statusCode: "COMMITTED",
            committedAt: new Date(),
            completedAt: new Date(),
            rowVersion: { increment: 1 },
          },
        });
        await appendAudit(tx, job, "IMPORT_COMMITTED", "ImportBatch", id, {
          atomic: true,
        });
        await tx.outboxMessage.create({
          data: {
            eventType: "IMPORT_COMMITTED",
            aggregateType: "ImportBatch",
            aggregateId: id,
            payload: { importBatchId: id },
            traceId: job.traceId,
            correlationId: job.correlationId,
            idempotencyKey: `committed:${job.jobId}`,
          },
        });
      },
    );
    return { resultReference: `import:${id}:committed` };
  };
}

function importRetryHandler(): DurableJobHandler {
  return async (job, d) => {
    const p = object(job.payload),
      stage = String(p.stageCode ?? "VALIDATE");
    const handlers: Record<string, DurableJobHandler> = {
      VALIDATE: importValidateHandler(),
      COMMIT: importCommitHandler(),
      ROLLBACK: importRollbackHandler(),
    };
    const handler = handlers[stage];
    if (!handler) fail("IMPORT_RETRY_STAGE_INVALID");
    return handler(job, d);
  };
}

function importRollbackHandler(): DurableJobHandler {
  return async (job, d) => {
    const id = text(object(job.payload).importJobId, "IMPORT_JOB_REQUIRED");
    await d.transactionManager.run(
      { traceId: job.traceId, correlationId: job.correlationId },
      async (tx) => {
        const batch = await tx.importBatch.findUnique({ where: { id } });
        if (!batch) fail("IMPORT_JOB_NOT_FOUND");
        if (batch.statusCode === "ROLLED_BACK") return;
        if (!new Set(["ROLLBACK_REQUESTED", "COMMITTED"]).has(batch.statusCode))
          fail("IMPORT_ROLLBACK_STATE_INVALID");
        const downstream = await tx.eRPOrder.count({
          where: { importBatchId: id },
        });
        if (downstream) fail("IMPORT_ROLLBACK_DOWNSTREAM_REFERENCES");
        await tx.importBatch.update({
          where: { id },
          data: {
            statusCode: "ROLLED_BACK",
            rolledBackAt: new Date(),
            rowVersion: { increment: 1 },
          },
        });
        await appendAudit(tx, job, "IMPORT_ROLLED_BACK", "ImportBatch", id, {
          atomic: true,
        });
      },
    );
    return { resultReference: `import:${id}:rolled-back` };
  };
}

function reconciliationHandler(): DurableJobHandler {
  return async (job, d) => {
    const id = text(object(job.payload).runId, "RECONCILIATION_RUN_REQUIRED");
    await d.transactionManager.run(
      { traceId: job.traceId, correlationId: job.correlationId },
      async (tx) => {
        const run = await tx.reconciliationRun.findUnique({ where: { id } });
        if (!run) fail("RECONCILIATION_RUN_NOT_FOUND");
        if (run.statusCode === "COMPLETED") return;
        const openIssues = await tx.dQIssue.count({
          where: { statusCode: "OPEN" },
        });
        await tx.reconciliationRun.update({
          where: { id },
          data: {
            statusCode: "COMPLETED",
            startedAt: run.startedAt ?? new Date(),
            completedAt: new Date(),
            summary: {
              openDataQualityIssues: openIssues,
              mutationMode: "NONE",
            },
          },
        });
        await appendAudit(
          tx,
          job,
          "RECONCILIATION_COMPLETED",
          "ReconciliationRun",
          id,
          { openIssues },
        );
      },
    );
    return { resultReference: `reconciliation:${id}:completed` };
  };
}

function logisticsOptimizeHandler(): DurableJobHandler {
  return async (job, d) => {
    const p = object(job.payload),
      runId = text(p.optimizerRunId, "OPTIMIZER_RUN_REQUIRED");
    await d.transactionManager.run(
      { traceId: job.traceId, correlationId: job.correlationId },
      async (tx) => {
        const run = await tx.logisticsOptimizerRun.findUnique({
          where: { id: runId },
        });
        if (!run) fail("OPTIMIZER_RUN_NOT_FOUND");
        if (run.statusCode === "SUCCEEDED") return;
        const version = await tx.logisticsPlanVersion.findUnique({
          where: { id: run.planVersionId },
        });
        if (!version) fail("LOGISTICS_VERSION_NOT_FOUND");
        if (
          version.rowVersion !== run.planRowVersionSnapshot ||
          (version.sourceSnapshotHash ?? "") !== run.inputHash
        ) {
          await tx.logisticsOptimizerRun.update({
            where: { id: runId },
            data: {
              statusCode: "STALE",
              invalidatedAt: new Date(),
              finishedAt: new Date(),
              errorCode: "OPTIMIZER_HASH_MISMATCH",
            },
          });
          return;
        }
        const lines = await tx.logisticsPlanLine.findMany({
          where: { planVersionId: version.id },
        });
        const units = await tx.logisticsTransportUnit.findMany({
          where: { planVersionId: version.id },
        });
        if (!lines.length || !units.length) fail("LOGISTICS_INPUT_INCOMPLETE");
        await tx.logisticsOptimizerRun.update({
          where: { id: runId },
          data: {
            statusCode: "SUCCEEDED",
            startedAt: new Date(),
            finishedAt: new Date(),
            appliedAt: new Date(),
            resultSummary: {
              lineCount: lines.length,
              unitCount: units.length,
              orientation: "FLAT_ON_FACE",
              rotations: [0, 90],
            },
          },
        });
        await tx.logisticsPlanVersion.update({
          where: { id: version.id },
          data: { derivedResultsStatusCode: "VALID" },
        });
        await appendAudit(
          tx,
          job,
          "LOGISTICS_OPTIMIZER_APPLIED",
          "LogisticsOptimizerRun",
          runId,
          { inputHash: run.inputHash },
        );
      },
    );
    return { resultReference: `optimizer:${runId}` };
  };
}

function logisticsExportHandler(): DurableJobHandler {
  return async (job, d) => {
    const p = object(job.payload),
      exportId = text(p.exportEventId, "LOGISTICS_EXPORT_REQUIRED");
    const row = await d.database.logisticsExport.findUnique({
      where: { id: exportId },
    });
    if (!row) fail("LOGISTICS_EXPORT_NOT_FOUND");
    const lines = await d.database.logisticsPlanLine.findMany({
      where: { planVersionId: row.planVersionId },
    });
    const body = [
      "lineId,qty,lengthMm,widthMm,thicknessMm,orientation",
      ...lines.map((x) =>
        [
          x.id,
          x.qty,
          x.lengthMm,
          x.widthMm,
          x.thicknessMm,
          x.orientationCode,
        ].join(","),
      ),
    ].join("\n");
    const key = `logistics-exports/${exportId}.csv`,
      file = objectPath(key);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, body, "utf8");
    await d.transactionManager.run(
      { traceId: job.traceId, correlationId: job.correlationId },
      async (tx) => {
        await tx.logisticsExport.update({
          where: { id: exportId },
          data: { statusCode: "COMPLETED", completedAt: new Date() },
        });
        await appendAudit(
          tx,
          job,
          "LOGISTICS_EXPORT_COMPLETED",
          "LogisticsExport",
          exportId,
          { storageKey: key, rows: lines.length },
        );
      },
    );
    return { resultReference: `local-object:${key}` };
  };
}

type ExportCell = string | number;
interface ExportDataset {
  code: string;
  title: string;
  headers: string[];
  rows: ExportCell[][];
}

/**
 * What each export type actually contains. Adding a dataset is adding an entry
 * here; asking for one that does not exist fails loudly rather than quietly
 * handing back somebody else's data.
 *
 * Every query is filtered to the country scope the request was authorised
 * for — the scope is re-derived from live grants at run time, not trusted
 * from the queued payload.
 */
export async function exportDataset(
  database: DatabaseClient,
  exportTypeCode: string,
  scope: string[],
): Promise<ExportDataset> {
  const code = exportTypeCode.trim().toUpperCase();
  if (code === "ACCOUNTS" || code === "") {
    const accounts = await database.account.findMany({
      where: { countryCode: { in: scope } },
      select: {
        id: true,
        accountRef: true,
        canonicalName: true,
        countryCode: true,
        recordStatusCode: true,
        createdAt: true,
      },
      orderBy: { canonicalName: "asc" },
    });
    return {
      code: "ACCOUNTS",
      title: "Accounts",
      headers: [
        "accountId",
        "accountRef",
        "canonicalName",
        "countryCode",
        "recordStatus",
        "createdAt",
      ],
      rows: accounts.map((x) => [
        x.id,
        x.accountRef,
        x.canonicalName,
        x.countryCode.trim(),
        x.recordStatusCode,
        x.createdAt.toISOString(),
      ]),
    };
  }
  if (code === "QUOTATIONS") {
    const quotations = await database.quotation.findMany({
      where: { countryCode: { in: scope } },
      select: {
        id: true,
        quotationRef: true,
        statusCode: true,
        countryCode: true,
        currencyCode: true,
        subtotalAmount: true,
        taxAmount: true,
        totalAmount: true,
        expiresOn: true,
        createdAt: true,
        account: { select: { canonicalName: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return {
      code: "QUOTATIONS",
      title: "Quotations",
      headers: [
        "quotationId",
        "quotationRef",
        "customer",
        "status",
        "country",
        "currency",
        "subtotal",
        "vat",
        "grandTotal",
        "validUntil",
        "createdAt",
      ],
      rows: quotations.map((q) => [
        q.id,
        q.quotationRef,
        q.account.canonicalName,
        q.statusCode,
        q.countryCode.trim(),
        q.currencyCode?.trim() ?? "",
        Number(q.subtotalAmount),
        Number(q.taxAmount),
        Number(q.totalAmount),
        q.expiresOn?.toISOString().slice(0, 10) ?? "",
        q.createdAt.toISOString(),
      ]),
    };
  }
  if (code === "OPPORTUNITIES") {
    const opportunities = await database.opportunity.findMany({
      where: { countryCode: { in: scope }, cancelledAt: null },
      select: {
        id: true,
        opportunityRef: true,
        title: true,
        stageCode: true,
        countryCode: true,
        currencyCode: true,
        estimatedValue: true,
        expectedCloseDate: true,
        createdAt: true,
        account: { select: { canonicalName: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return {
      code: "OPPORTUNITIES",
      title: "Opportunities",
      headers: [
        "opportunityId",
        "opportunityRef",
        "customer",
        "title",
        "stage",
        "country",
        "currency",
        "estimatedValue",
        "expectedClose",
        "createdAt",
      ],
      rows: opportunities.map((o) => [
        o.id,
        o.opportunityRef,
        o.account.canonicalName,
        o.title ?? "",
        o.stageCode,
        o.countryCode.trim(),
        o.currencyCode?.trim() ?? "",
        Number(o.estimatedValue ?? 0),
        o.expectedCloseDate?.toISOString().slice(0, 10) ?? "",
        o.createdAt.toISOString(),
      ]),
    };
  }
  fail("EXPORT_TYPE_NOT_SUPPORTED");
}

function dataExportHandler(): DurableJobHandler {
  return async (job, d) => {
    const event = await d.database.exportEvent.findFirst({
      where: { jobId: job.jobId },
    });
    if (!event) fail("EXPORT_EVENT_NOT_FOUND");
    if (event.statusCode === "COMPLETED")
      return { resultReference: `document:${event.documentId}` };
    const current = await d.database.userCountryAccess.findMany({
      where: {
        userId: event.userId,
        statusCode: "ACTIVE",
        validFrom: { lte: new Date() },
        OR: [{ validTo: null }, { validTo: { gt: new Date() } }],
      },
      select: { countryCode: true },
    });
    const scope = event.countryCodes.filter((c) =>
      current.some((x) => x.countryCode.trim() === c.trim()),
    );
    // Whatever was asked for is what gets exported. This used to build the
    // accounts CSV regardless of the dataset or the format on the request, so
    // asking for quotations as a spreadsheet returned a CSV of customers --
    // and it returned it successfully, which is the worst way to be wrong.
    const dataset = await exportDataset(
      d.database,
      event.exportTypeCode,
      scope,
    );
    const format = event.formatCode === "XLSX" ? "XLSX" : "CSV";
    let bytes: Buffer;
    let extension: string;
    let mimeType: string;
    if (format === "XLSX") {
      const workbook = new ExcelJS.Workbook();
      workbook.created = new Date();
      const sheet = workbook.addWorksheet(dataset.title, {
        views: [{ state: "frozen", ySplit: 1 }],
      });
      sheet.addRow(dataset.headers);
      for (const row of dataset.rows) sheet.addRow(row);
      sheet.getRow(1).font = { bold: true };
      sheet.columns.forEach((column) => {
        column.width = 24;
      });
      bytes = Buffer.from(await workbook.xlsx.writeBuffer());
      extension = "xlsx";
      mimeType =
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    } else {
      const body = [
        dataset.headers.map((header) => csv(header)).join(","),
        ...dataset.rows.map((row) =>
          row
            .map((cell) =>
              typeof cell === "number" ? String(cell) : csv(cell),
            )
            .join(","),
        ),
      ].join("\n");
      bytes = Buffer.from(body, "utf8");
      extension = "csv";
      mimeType = "text/csv";
    }
    const key = `exports/${event.id}.${extension}`,
      file = objectPath(key);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, bytes);
    await d.transactionManager.run(
      { traceId: job.traceId, correlationId: job.correlationId },
      async (tx) => {
        const doc = await tx.documentMetadata.create({
          data: {
            resourceTypeCode: "EXPORT",
            resourceId: event.id,
            storageKey: key,
            mimeType,
            sizeBytes: BigInt(bytes.length),
            fileHash: sha(bytes),
            classificationCode: "PRIVATE",
            documentTypeCode: "DATA_EXPORT",
            title: `${event.exportTypeCode}.${extension}`,
            statusCode: "AVAILABLE",
            createdByUserId: event.userId,
            versions: {
              create: {
                versionNo: 1,
                storageKey: key,
                mimeType,
                sizeBytes: BigInt(bytes.length),
                contentHash: sha(bytes),
                sourceTypeCode: "GENERATED_WORKING",
                createdByUserId: event.userId,
                immutable: true,
              },
            },
          },
        });
        await tx.exportEvent.update({
          where: { id: event.id },
          data: {
            statusCode: "COMPLETED",
            documentId: doc.id,
            rowCount: BigInt(dataset.rows.length),
            completedAt: new Date(),
          },
        });
        await appendAudit(
          tx,
          job,
          "DATA_EXPORT_COMPLETED",
          "ExportEvent",
          event.id,
          {
            documentId: doc.id,
            capturedScope: event.countryCodes,
            effectiveScope: scope,
            dataset: dataset.code,
            format,
            rows: dataset.rows.length,
          },
        );
      },
    );
    return { resultReference: `export:${event.id}` };
  };
}

function analyticsExportHandler(): DurableJobHandler {
  return async (job, d) => {
    const event = await d.database.exportEvent.findFirst({
      where: { jobId: job.jobId },
    });
    if (!event || event.resourceTypeCode !== "ANALYTICS_REPORT")
      fail("ANALYTICS_EXPORT_EVENT_NOT_FOUND");
    if (event.statusCode === "COMPLETED")
      return { resultReference: `document:${event.documentId}` };
    const payload = object(job.payload);
    const snapshot = object(payload.semanticSnapshot);
    const metrics = array(snapshot.metrics).map((value) => object(value));
    const current = await d.database.userCountryAccess.findMany({
      where: {
        userId: event.userId,
        statusCode: "ACTIVE",
        validFrom: { lte: new Date() },
        OR: [{ validTo: null }, { validTo: { gt: new Date() } }],
      },
      select: { countryCode: true },
    });
    const effective = event.countryCodes.filter((country) =>
      current.some(({ countryCode }) => countryCode.trim() === country.trim()),
    );
    if (effective.length !== event.countryCodes.length)
      fail("ANALYTICS_EXPORT_SCOPE_CHANGED_RETRY");
    const rows = metrics.map((metric) => [
      String(metric.metricId ?? ""),
      String(metric.metricVersion ?? ""),
      String(metric.name ?? ""),
      metric.value === null ? "" : String(metric.value ?? ""),
      String(metric.currency ?? metric.unit ?? ""),
      String(metric.basis ?? ""),
      String(metric.asOf ?? snapshot.asOf ?? ""),
    ]);
    const format = event.formatCode;
    let bytes: Buffer;
    let extension: string;
    let mimeType: string;
    if (format === "XLSX") {
      const workbook = new ExcelJS.Workbook();
      workbook.creator = "ABP Commercial System";
      workbook.created = new Date(
        String(snapshot.generatedAt ?? snapshot.asOf),
      );
      const sheet = workbook.addWorksheet("Governed Metrics", {
        views: [{ state: "frozen", ySplit: 1 }],
      });
      sheet.addRow([
        "metricId",
        "metricVersion",
        "name",
        "value",
        "unitOrCurrency",
        "basis",
        "asOf",
      ]);
      rows.forEach((row) => sheet.addRow(row));
      sheet.columns.forEach((column) => {
        column.width = 24;
      });
      bytes = Buffer.from(await workbook.xlsx.writeBuffer());
      extension = "xlsx";
      mimeType =
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    } else if (format === "PDF") {
      const html = analyticsReportHtml(snapshot, rows);
      const browser = await chromium.launch({
        headless: true,
        ...(process.env.ABP_CHROMIUM_EXECUTABLE_PATH
          ? { executablePath: process.env.ABP_CHROMIUM_EXECUTABLE_PATH }
          : {}),
      });
      try {
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: "load" });
        bytes = Buffer.from(
          await page.pdf({
            format: "A4",
            landscape: true,
            printBackground: true,
          }),
        );
      } finally {
        await browser.close();
      }
      extension = "pdf";
      mimeType = "application/pdf";
    } else {
      const body = [
        "metricId,metricVersion,name,value,unitOrCurrency,basis,asOf",
        ...rows.map((row) => row.map((value) => csv(value)).join(",")),
      ].join("\n");
      bytes = Buffer.from(body, "utf8");
      extension = "csv";
      mimeType = "text/csv";
    }
    const key = `analytics-exports/${event.id}.${extension}`;
    const file = objectPath(key);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, bytes);
    await d.transactionManager.run(
      { traceId: job.traceId, correlationId: job.correlationId },
      async (tx) => {
        const doc = await tx.documentMetadata.create({
          data: {
            resourceTypeCode: "ANALYTICS_REPORT",
            resourceId: event.id,
            storageKey: key,
            mimeType,
            sizeBytes: BigInt(bytes.length),
            fileHash: sha(bytes),
            classificationCode: "COMMERCIAL_CONFIDENTIAL",
            documentTypeCode: "ANALYTICS_REPORT_EXPORT",
            title: `${event.exportTypeCode}.${extension}`,
            statusCode: "AVAILABLE",
            isFinal: true,
            createdByUserId: event.userId,
            versions: {
              create: {
                versionNo: 1,
                storageKey: key,
                mimeType,
                sizeBytes: BigInt(bytes.length),
                contentHash: sha(bytes),
                sourceTypeCode: "GENERATED_SEMANTIC_REPORT",
                createdByUserId: event.userId,
                immutable: true,
                rendererVersion: "step10-semantic-export-1.0.0",
              },
            },
          },
        });
        await tx.exportEvent.update({
          where: { id: event.id },
          data: {
            statusCode: "COMPLETED",
            documentId: doc.id,
            rowCount: BigInt(rows.length),
            completedAt: new Date(),
          },
        });
        await appendAudit(
          tx,
          job,
          "ANALYTICS_EXPORT_COMPLETED",
          "AnalyticsReport",
          event.id,
          {
            reportId: event.exportTypeCode,
            reportVersion: payload.reportVersion,
            asOf: payload.asOf,
            format,
            rows: rows.length,
            capturedScope: event.countryCodes,
          },
        );
      },
    );
    return { resultReference: `analytics-export:${event.id}` };
  };
}

function analyticsReportHtml(snapshot: Payload, rows: string[][]): string {
  const body = rows
    .map(
      (row) =>
        `<tr>${row.map((value) => `<td>${escapeHtml(value)}</td>`).join("")}</tr>`,
    )
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:'Segoe UI',Arial,sans-serif;color:#172033}table{border-collapse:collapse;width:100%;font-size:10px}th,td{border:1px solid #ccd2dc;padding:5px;text-align:start}h1{color:#8d1025}</style></head><body><h1>${escapeHtml(snapshot.reportId)} · ${escapeHtml(snapshot.name)}</h1><p>asOf: ${escapeHtml(snapshot.asOf)} · currency: ${escapeHtml(snapshot.currency)}</p><table><thead><tr><th>Metric ID</th><th>Version</th><th>Name</th><th>Value</th><th>Unit</th><th>Basis</th><th>asOf</th></tr></thead><tbody>${body}</tbody></table></body></html>`;
}

/**
 * The invitation: where to sign in and with which user name. Never a
 * password -- the administrator hands over the first one, and the person is
 * asked to change it.
 */
function inviteEmailHandler(): DurableJobHandler {
  return async (job, dependencies) => {
    const mail = readMailConfig();
    if (mail.provider === "NONE")
      fail("IDENTITY_EMAIL_PROVIDER_NOT_CONFIGURED_USE_MANUAL_INVITE");
    const userId = text(object(job.payload).userId, "USER_ID_REQUIRED");
    const person = await dependencies.database.appUser.findUnique({
      where: { id: userId },
      select: {
        displayName: true,
        emailNormalized: true,
        usernameNormalized: true,
      },
    });
    if (!person?.emailNormalized.includes("@")) fail("USER_EMAIL_MISSING");
    const name = escapeMail(person.displayName);
    const login = escapeMail(
      person.usernameNormalized ?? person.emailNormalized,
    );
    const url = escapeMail(mail.appUrl);
    await dependencies.database.emailMessage.create({
      data: {
        purposeCode: "INVITATION",
        toAddresses: [person.emailNormalized],
        subject: "Your ABP Commercial account",
        bodyHtml: `<div style="font-family:'Segoe UI',Arial,sans-serif;color:#14213D;max-width:600px"><p style="font-size:18px;font-weight:700;border-bottom:3px solid #C8102E;padding-bottom:8px">ACROW · ABP Commercial</p><p>Hello ${name},</p><p>An account has been opened for you on ABP Commercial.</p><p>Sign in at <a href="${url}">${url}</a> with the user name <b>${login}</b>.</p><p>Your administrator will give you your first password; you will be asked to choose your own when you sign in.</p></div>`,
        bodyText: `Hello ${person.displayName},

An account has been opened for you on ABP Commercial. Sign in at ${mail.appUrl} with the user name ${person.usernameNormalized ?? person.emailNormalized}. Your administrator will give you your first password.`,
        resourceTypeCode: "USER",
        resourceId: userId,
      },
    });
    return { resultReference: `invite:${userId}` };
  };
}

const PAYMENT_TERMS_LABELS: Record<string, string> = {
  ADVANCE_100: "100% in advance.",
  ADVANCE_50_50: "50% advance, 50% before delivery.",
  NET_30: "Net 30 days from invoice date.",
  NET_60: "Net 60 days from invoice date.",
  LC_AT_SIGHT: "Letter of Credit at sight.",
};

/**
 * The delivery point depends on the incoterm: DDP delivers to the customer's
 * site, CIF to the customer's port, FOB hands over at ours.
 *
 * Whatever the salesperson typed on the quotation wins; these are the fallbacks
 * for a quotation where that field was left empty, so the document still reads
 * correctly rather than printing a blank delivery point.
 */
const INCOTERM_DELIVERY: Record<
  string,
  (q: {
    project: { addressText: string | null; city: string | null } | null;
    account: { country: { name: string } };
    deliveryAddress?: string | null;
    portOfLoading?: string | null;
    portOfDischarge?: string | null;
  }) => {
    label: string;
    point: string;
  }
> = {
  DDP: (q) => ({
    label: "DDP — Delivered Duty Paid",
    point:
      blank(q.deliveryAddress) ??
      q.project?.addressText ??
      (q.project?.city
        ? `${q.project.city}, ${q.account.country.name}`
        : q.account.country.name),
  }),
  CIF: (q) => ({
    label: "CIF — Cost, Insurance & Freight",
    point: blank(q.portOfDischarge)
      ? `${String(blank(q.portOfDischarge))}, ${q.account.country.name}`
      : `Destination port, ${q.account.country.name}`,
  }),
  FOB: (q) => ({
    label: "FOB — Free On Board",
    point: blank(q.portOfLoading)
      ? `ABP Storeyard — Wady Houf, Helwan, Egypt (port of loading: ${String(blank(q.portOfLoading))}, Egypt)`
      : "ABP Storeyard — Wady Houf, Helwan, Egypt (port of loading: Alexandria, Egypt)",
  }),
};

function money(value: unknown, currency: string): string {
  const amount = Number(value ?? 0);
  return `${currency} ${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function officialQuotationHtml(q: any): string {
  const currency: string =
    typeof q.currencyCode === "string" ? q.currencyCode : "EGP";
  const isProforma = q.documentTypeCode === "PROFORMA_INVOICE";
  const docTitle = isProforma ? "PROFORMA INVOICE" : "QUOTATION";
  const docNoLabel = isProforma ? "PI No." : "Quotation No.";
  const issueDate = new Date(q.createdAt).toLocaleDateString("en-GB", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
  const validUntil = q.expiresOn
    ? new Date(q.expiresOn).toLocaleDateString("en-GB", {
        year: "numeric",
        month: "short",
        day: "2-digit",
      })
    : null;
  const paymentTerms =
    q.customPaymentTerms ??
    (q.paymentTermsCode
      ? PAYMENT_TERMS_LABELS[q.paymentTermsCode]
      : undefined) ??
    "As agreed with ABP Sales.";
  const delivery = q.incotermCode
    ? INCOTERM_DELIVERY[q.incotermCode]?.(q)
    : undefined;
  const piNumber = typeof q.piNumber === "string" ? q.piNumber : null;

  // The engineering snapshot carries what the customer is entitled to read:
  // the reference, the delivered weight per piece and the weight of the whole
  // line. It also carries the internal rate per kilogram, which the customer
  // is NOT entitled to read -- nothing below ever touches it (spec SS20).
  const snapshotOf = (l: any): Record<string, unknown> =>
    l.priceSnapshot !== null && typeof l.priceSnapshot === "object"
      ? (l.priceSnapshot as Record<string, unknown>)
      : {};
  const numberOr = (value: unknown): number | null => {
    const parsed = typeof value === "string" ? Number(value) : value;
    return typeof parsed === "number" && Number.isFinite(parsed)
      ? parsed
      : null;
  };
  const stringOr = (value: unknown): string | null =>
    typeof value === "string" && value.trim() !== "" ? value.trim() : null;
  const weightPerPiece = (l: any): number | null =>
    numberOr(snapshotOf(l).weightPerPieceKg);
  const lineWeight = (l: any): number | null =>
    numberOr(snapshotOf(l).totalWeightKg);
  const lineReference = (l: any): string | null =>
    stringOr(snapshotOf(l).reference) ?? stringOr(snapshotOf(l).cadMark);
  // 49250.88 / 351792 is 14%, but in binary it is 14.000000000000002, and a
  // customer reading "VAT (14.00%)" on one quotation and "VAT (14%)" on the
  // next will ask which one is right. Round first, then drop the zeros.
  const pct = (value: number): string => {
    const rounded = Math.round(value * 100) / 100;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
  };
  const kg = (value: number): string =>
    value.toLocaleString("en-US", {
      minimumFractionDigits: 3,
      maximumFractionDigits: 3,
    });
  // Columns earn their width. A quotation with no references, no weights or no
  // discounts does not carry empty columns across an A4 page for them.
  const showRefs = q.lines.some((l: any) => lineReference(l) !== null);
  const showWeights = q.lines.some((l: any) => weightPerPiece(l) !== null);
  const showDiscount = q.lines.some((l: any) => Number(l.discountAmount) > 0);
  // The ERP item code sits beside the description it belongs to, so the
  // customer's purchasing team and our warehouse read the same line.
  const itemCode = (l: any): string | null => {
    const code: unknown = l.product?.skuCode ?? l.product?.barcode ?? null;
    return typeof code === "string" && code.trim() !== "" ? code : null;
  };
  const showCodes = q.lines.some((l: any) => itemCode(l) !== null);
  const totalWeightKg = q.lines.reduce(
    (sum: number, l: any) => sum + (lineWeight(l) ?? 0),
    0,
  );
  const lineRowHtml = (l: any, rowNo: number) => {
    const gross = Number(l.qty) * Number(l.unitPrice);
    const discountPct =
      gross > 0 ? (Number(l.discountAmount) / gross) * 100 : 0;
    // The photo comes from the product this line actually sells, not one fixed
    // image for the whole document: a quotation with a board and a welding
    // machine on it must show a board and a welding machine.
    //
    // The line records which image it was issued with (productImageId), so the
    // rendered document does not change if someone later replaces the product
    // photo. If the line has no snapshot, the product's current primary is used
    // and recorded by the caller at issue time.
    // `l` is untyped here (the whole renderer takes `any`), so the id is
    // narrowed to a string before it is put into a URL.
    const rawImageId: unknown =
      l.productImageId ?? l.product?.productImages?.[0]?.id ?? null;
    const imageId = typeof rawImageId === "string" ? rawImageId : null;
    const imageCell =
      imageId === null
        ? ""
        : `<img class="line-photo" src="${escapeHtml(absoluteImageUrl(imageId))}" alt="" />`;
    const perPiece = weightPerPiece(l);
    const total = lineWeight(l);
    return `<tr>
        <td class="num">${rowNo}</td>
        <td class="photo">${imageCell}</td>
        ${showRefs ? `<td class="center">${escapeHtml(lineReference(l) ?? "—")}</td>` : ""}
        ${showCodes ? `<td class="center">${escapeHtml(itemCode(l) ?? "—")}</td>` : ""}
        <td>${escapeHtml(l.description)}</td>
        <td class="num">${Number(l.qty).toLocaleString("en-US")}</td>
        <td class="center">${escapeHtml(l.unitCode)}</td>
        ${showWeights ? `<td class="num">${perPiece === null ? "—" : kg(perPiece)}</td>` : ""}
        ${showWeights ? `<td class="num">${total === null ? "—" : kg(total)}</td>` : ""}
        <td class="num">${money(l.unitPrice, currency)}</td>
        ${showDiscount ? `<td class="num">${discountPct > 0 ? `${discountPct.toFixed(1)}%` : "—"}</td>` : ""}
        <td class="num strong">${money(l.lineTotal, currency)}</td>
      </tr>`;
  };
  const itemsTableHtml = (linesForTable: any[]) => `<table class="items">
    <thead>
      <tr>
        <th>#</th>
        <th class="photo"></th>
        ${showRefs ? `<th class="center">Ref.</th>` : ""}
        ${showCodes ? `<th class="center">Item Code</th>` : ""}
        <th>Description</th>
        <th class="num">Qty</th>
        <th class="center">Unit</th>
        ${showWeights ? `<th class="num">Weight / Pc (kg)</th>` : ""}
        ${showWeights ? `<th class="num">Total Weight (kg)</th>` : ""}
        <th class="num">Unit Price</th>
        ${showDiscount ? `<th class="num">Disc. %</th>` : ""}
        <th class="num">Total</th>
      </tr>
    </thead>
    <tbody>${linesForTable.map((l, i) => lineRowHtml(l, i + 1)).join("")}</tbody>
  </table>`;
  // Spec SS19: the customer sees how the number was reached, line by line --
  // subtotal, what came off it, what VAT was charged on, and the total. A
  // discount stated without the percentage it represents is an argument
  // waiting to happen.
  const totalsTableHtml = (
    subtotal: number,
    tax: number,
    grand: number,
    grandLabel = "Grand Total",
    adjustment = 0,
    weightKg = 0,
  ) => {
    const net = subtotal + adjustment;
    const discountPct =
      subtotal > 0 ? (Math.abs(adjustment) / subtotal) * 100 : 0;
    const vatPct = net > 0 ? (tax / net) * 100 : 0;
    const adjustmentLabel =
      adjustment < 0
        ? `Discount${discountPct > 0 ? ` (${pct(discountPct)}%)` : ""}`
        : "Adjustment";
    return `<table class="totals">
    ${weightKg > 0 ? `<tr><td>Total Weight</td><td>${kg(weightKg)} kg</td></tr>` : ""}
    <tr><td>Subtotal (excl. VAT)</td><td>${money(subtotal, currency)}</td></tr>
    ${adjustment !== 0 ? `<tr><td>${adjustmentLabel}</td><td>${money(adjustment, currency)}</td></tr>` : ""}
    ${adjustment !== 0 ? `<tr><td>Net Amount</td><td>${money(net, currency)}</td></tr>` : ""}
    <tr><td>VAT${vatPct > 0 ? ` (${pct(vatPct)}%)` : ""}</td><td>${money(tax, currency)}</td></tr>
    <tr class="grand-total"><td>${grandLabel}</td><td>${money(grand, currency)}</td></tr>
  </table>`;
  };

  const sectionLabels: string[] = [];
  for (const l of q.lines) {
    const label = (l.sectionLabel ?? "").trim();
    if (label && !sectionLabels.includes(label)) sectionLabels.push(label);
  }
  const overallVatRate =
    Number(q.subtotalAmount) > 0
      ? Number(q.taxAmount) / Number(q.subtotalAmount)
      : 0;
  let itemsHtml: string;
  if (sectionLabels.length === 0) {
    // No sections in use — single flat table, matching the original layout.
    itemsHtml = `<h2 class="section-title">Pricing / Description of Goods</h2>
  ${itemsTableHtml(q.lines)}
  ${totalsTableHtml(
    Number(q.subtotalAmount),
    Number(q.taxAmount),
    Number(q.totalAmount),
    "Grand Total",
    Number(q.adjustmentAmount),
    totalWeightKg,
  )}`;
  } else {
    const sectionBlocks = sectionLabels
      .map((label, index) => {
        const sectionLines = q.lines.filter(
          (l: any) => (l.sectionLabel ?? "").trim() === label,
        );
        const sectionSubtotal = sectionLines.reduce(
          (sum: number, l: any) => sum + Number(l.lineTotal),
          0,
        );
        const sectionTax = sectionSubtotal * overallVatRate;
        const letter = String.fromCharCode(65 + index);
        return `<h2 class="section-title">${letter} — ${escapeHtml(label)}</h2>
  ${itemsTableHtml(sectionLines)}
  ${totalsTableHtml(sectionSubtotal, sectionTax, sectionSubtotal + sectionTax)}`;
      })
      .join("");
    const unlabeled = q.lines.filter(
      (l: any) => !(l.sectionLabel ?? "").trim(),
    );
    const unlabeledBlock =
      unlabeled.length > 0
        ? (() => {
            const sectionSubtotal = unlabeled.reduce(
              (sum: number, l: any) => sum + Number(l.lineTotal),
              0,
            );
            const sectionTax = sectionSubtotal * overallVatRate;
            return `<h2 class="section-title">Other Items</h2>
  ${itemsTableHtml(unlabeled)}
  ${totalsTableHtml(sectionSubtotal, sectionTax, sectionSubtotal + sectionTax)}`;
          })()
        : "";
    itemsHtml = `${sectionBlocks}${unlabeledBlock}
  <h2 class="section-title grand">Grand Total — All Sections</h2>
  ${totalsTableHtml(Number(q.subtotalAmount), Number(q.taxAmount), Number(q.totalAmount), "Grand Total", Number(q.adjustmentAmount), totalWeightKg)}`;
  }

  const ownerName = escapeHtml(q.owner?.displayName ?? "");
  const ownerPhone = escapeHtml(q.owner?.profile?.phone ?? "");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<style>
  @page { size: A4; margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  body {
    font-family: 'Segoe UI', Arial, sans-serif;
    color: #1a1c2e;
    font-size: 11px;
    line-height: 1.5;
    margin: 0;
  }
  .doc-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    border-bottom: 3px solid #0e0b53;
    padding-bottom: 12px;
    margin-bottom: 18px;
  }
  .doc-header img { height: 46px; }
  .doc-title { text-align: end; }
  .doc-title h1 {
    margin: 0;
    font-size: 22px;
    letter-spacing: 0.06em;
    color: #0e0b53;
  }
  .doc-title .doc-ref {
    margin-top: 4px;
    font-size: 13px;
    font-weight: 700;
    color: #c81d25;
  }
  .info-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0 28px;
    margin-bottom: 16px;
  }
  .info-grid dl { margin: 0; }
  .info-grid dt {
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #6b7280;
    margin-top: 8px;
  }
  .info-grid dt:first-child { margin-top: 0; }
  .info-grid dd {
    margin: 1px 0 0;
    font-size: 12px;
    font-weight: 600;
    color: #1a1c2e;
  }
  h2.section-title {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #ffffff;
    background: #0e0b53;
    padding: 6px 10px;
    margin: 18px 0 0;
  }
  h2.section-title.grand {
    background: #c81d25;
    margin-top: 24px;
  }
  table.items {
    width: 100%;
    border-collapse: collapse;
    margin-top: 0;
  }
  table.items th {
    background: #f4f6fb;
    border: 1px solid #dfe3ee;
    padding: 6px 8px;
    font-size: 9.5px;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: #4b5563;
    text-align: start;
  }
  table.items td {
    border: 1px solid #dfe3ee;
    padding: 6px 8px;
  }
  table.items td.num { text-align: end; font-variant-numeric: tabular-nums; }
  table.items td.center { text-align: center; }
  /* The photo confirms the right product was picked; it must not crowd out the
     description, and it must not break the row height when absent. */
  table.items th.photo { width: 58px; }
  table.items td.photo { width: 58px; padding: 4px; }
  table.items td.photo img.line-photo {
    display: block;
    width: 50px;
    height: 50px;
    object-fit: contain;
    border: 1px solid #e3e3ea;
    border-radius: 4px;
    background: #fff;
  }
  table.items td.strong { font-weight: 700; }
  .totals {
    width: 260px;
    margin-inline-start: auto;
    margin-top: 0;
    border: 1px solid #dfe3ee;
    border-top: none;
  }
  .totals tr td { padding: 6px 10px; font-size: 11px; }
  .totals tr td:last-child { text-align: end; font-variant-numeric: tabular-nums; }
  .totals tr.grand-total td {
    background: #0e0b53;
    color: #fff;
    font-weight: 700;
    font-size: 13px;
  }
  .terms-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px 28px;
    padding: 10px;
    border: 1px solid #dfe3ee;
    border-top: none;
  }
  .terms-grid dt {
    font-size: 9px;
    text-transform: uppercase;
    color: #6b7280;
    margin-top: 6px;
  }
  .terms-grid dd { margin: 1px 0 0; font-size: 11px; font-weight: 600; }
  .signoff {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0 28px;
    margin-top: 26px;
  }
  .signoff .block { border-top: 1px solid #1a1c2e; padding-top: 6px; }
  .signoff .label {
    font-size: 9px;
    text-transform: uppercase;
    color: #6b7280;
    margin-bottom: 22px;
  }
  .signoff .line { font-size: 11px; margin-top: 14px; color: #6b7280; }
  .footer {
    margin-top: 30px;
    padding-top: 10px;
    border-top: 1px solid #dfe3ee;
    text-align: center;
    font-size: 9.5px;
    color: #6b7280;
  }
  .footer strong { color: #0e0b53; }
</style>
</head>
<body>
  <div class="doc-header">
    <img src="data:image/png;base64,${ABP_LOGO_PNG_BASE64}" alt="ACROW Building Products" />
    <div class="doc-title">
      <h1>${docTitle}</h1>
      <div class="doc-ref">${escapeHtml(q.quotationRef)}</div>
    </div>
  </div>

  <div class="info-grid">
    <dl>
      <dt>Customer</dt>
      <dd>${escapeHtml(q.account.canonicalName)}</dd>
      <dt>Project</dt>
      <dd>${escapeHtml(q.project?.name ?? "General Use")}</dd>
      <dt>Sales Engineer</dt>
      <dd>${ownerName}${ownerPhone ? ` &nbsp;·&nbsp; ${ownerPhone}` : ""}</dd>
    </dl>
    <dl>
      <dt>${docNoLabel}</dt>
      <dd>${escapeHtml(q.quotationRef)}</dd>
      ${
        piNumber === null
          ? ""
          : `<dt>PI No.</dt>
      <dd>${escapeHtml(piNumber)}</dd>`
      }
      <dt>Date</dt>
      <dd>${issueDate}</dd>
      <dt>Currency</dt>
      <dd>${currency}</dd>
    </dl>
  </div>

  ${itemsHtml}

  <h2 class="section-title">Commercial Terms</h2>
  <div class="terms-grid">
    <dt>Payment</dt>
    <dd>${escapeHtml(paymentTerms)}</dd>
    <dt>Offer Validity</dt>
    <dd>${validUntil ? `Until ${validUntil}` : "As stated at send time."}</dd>
    ${
      delivery
        ? `<dt>Delivery Terms</dt>
    <dd>${escapeHtml(delivery.label)}</dd>
    <dt>Delivery Point</dt>
    <dd>${escapeHtml(delivery.point)}</dd>`
        : `<dt>Delivery</dt>
    <dd>According to agreed schedule.</dd>`
    }
  </div>

  <div class="signoff">
    <div class="block">
      <div class="label">Prepared By</div>
      <div class="line">${ownerName}</div>
    </div>
    <div class="block">
      <div class="label">Client Acceptance — Name / Signature / Company Stamp</div>
      <div class="line">&nbsp;</div>
    </div>
  </div>

  <div class="footer">
    <strong>ACROW BUILDING PRODUCTS</strong><br />
    Wady Houf Industrial Zone, Helwan, Egypt &nbsp;·&nbsp; Tel: (+202) 23254529 &nbsp;·&nbsp; Fax: (+202) 23671347 &nbsp;·&nbsp; a.b.p@acrow.co
  </div>
</body>
</html>`;
}

async function appendAudit(
  tx: any,
  job: { jobId: string; traceId: string; correlationId: string },
  actionCode: string,
  resourceType: string,
  resourceId: string,
  metadata: Record<string, unknown>,
) {
  await tx.auditEvent.create({
    data: {
      actorUserId: null,
      actorSessionId: null,
      actionCode,
      resourceType,
      resourceId,
      workspace: "WORKFLOW",
      countryCode: null,
      metadata: { ...metadata, jobId: job.jobId },
      traceId: job.traceId,
      correlationId: job.correlationId,
      source: "step8-worker",
    },
  });
}

function object(value: unknown): Payload {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    fail("WORKFLOW_PAYLOAD_INVALID");
  return value as Payload;
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) fail("WORKFLOW_PAYLOAD_ARRAY_INVALID");
  return value;
}
function text(value: unknown, code: string): string {
  if (typeof value !== "string" || value.length === 0) fail(code);
  return value;
}
function fail(code: string): never {
  throw Object.assign(new Error(code), { code });
}
function sha(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
function stableUuid(value: string): string {
  const h = createHash("sha256").update(value).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
function normalizeForHash(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_key, item: unknown) =>
      typeof item === "bigint" ? item.toString() : item,
    ),
  ) as unknown;
}
function objectPath(key: string): string {
  return resolve(
    process.env.ABP_LOCAL_OBJECT_ROOT ?? ".tmp/object-storage",
    key,
  );
}
function csv(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
function escapeHtml(value: unknown): string {
  return String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ] ?? c,
  );
}

/**
 * Absolute URL for a product photo inside the generated document.
 *
 * The document is rendered server-side and may be opened outside the app, so a
 * root-relative path would resolve against whatever host opens it.
 */
function absoluteImageUrl(imageId: string) {
  const base = (
    process.env.ABP_PUBLIC_BASE_URL ?? "http://localhost:8080"
  ).replace(/\/+$/, "");
  return `${base}/api/v1/product-images/${imageId}/content`;
}

/** Empty and whitespace-only both mean "not filled in". */
function blank(value: string | null | undefined) {
  const text = (value ?? "").trim();
  return text === "" ? null : text;
}
