import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { dirname, resolve, relative, isAbsolute } from "node:path";
import { Inject, Injectable } from "@nestjs/common";
import {
  Prisma,
  type DatabaseClient,
  type TransactionClient,
  type TransactionManager,
} from "@abp/database";
import { ApiProblem } from "../platform/api-exception.filter.js";
import {
  databaseClientToken,
  transactionManagerToken,
} from "../platform/database.providers.js";
import type { CustomerIdentity } from "../customer/customer-auth.js";
import type {
  CompleteUploadDto,
  CreateExportDto,
  CreateUploadDto,
  DocumentListQuery,
  LinkDocumentDto,
} from "./documents.dto.js";
const allowed = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "video/mp4",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
@Injectable()
export class DocumentsService {
  constructor(
    @Inject(databaseClientToken) private readonly db: DatabaseClient,
    @Inject(transactionManagerToken) private readonly txs: TransactionManager,
  ) {}
  async list(i: CustomerIdentity, q: DocumentListQuery) {
    this.require(i, "documents.view");
    const [accounts, projects, quotations, complaints, shipments] =
      await Promise.all([
        this.db.account.findMany({
          where: { countryCode: { in: [...i.countryCodes] } },
          select: { id: true },
        }),
        this.db.project.findMany({
          where: { countryCode: { in: [...i.countryCodes] } },
          select: { id: true },
        }),
        this.db.quotation.findMany({
          where: { countryCode: { in: [...i.countryCodes] } },
          select: { id: true },
        }),
        this.db.complaint.findMany({
          where: { countryCode: { in: [...i.countryCodes] } },
          select: { id: true },
        }),
        this.db.shipment.findMany({
          where: { countryCode: { in: [...i.countryCodes] } },
          select: { id: true },
        }),
      ]);
    const where: Prisma.DocumentMetadataWhereInput = {
      OR: [
        { createdByUserId: i.userId },
        {
          resourceTypeCode: "ACCOUNT",
          resourceId: { in: accounts.map((x) => x.id) },
        },
        {
          resourceTypeCode: "PROJECT",
          resourceId: { in: projects.map((x) => x.id) },
        },
        {
          resourceTypeCode: "QUOTATION",
          resourceId: { in: quotations.map((x) => x.id) },
        },
        {
          resourceTypeCode: "COMPLAINT",
          resourceId: { in: complaints.map((x) => x.id) },
        },
        {
          resourceTypeCode: "SHIPMENT",
          resourceId: { in: shipments.map((x) => x.id) },
        },
      ],
      ...(q.search
        ? { title: { contains: q.search, mode: "insensitive" } }
        : {}),
      ...(q.documentTypeCode ? { documentTypeCode: q.documentTypeCode } : {}),
      ...(q.resourceTypeCode ? { resourceTypeCode: q.resourceTypeCode } : {}),
      ...(q.resourceId ? { resourceId: q.resourceId } : {}),
      ...(q.statusCode ? { statusCode: q.statusCode } : {}),
      ...(q.official ? { isFinal: q.official === "true" } : {}),
    };
    const [total, rows] = await this.db.$transaction([
      this.db.documentMetadata.count({ where }),
      this.db.documentMetadata.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        skip: q.offset,
        take: q.limit,
        include: { versions: { orderBy: { versionNo: "desc" }, take: 1 } },
      }),
    ]);
    return {
      data: rows.map(documentListDto),
      meta: {
        page: Math.floor(q.offset / q.limit) + 1,
        offset: q.offset,
        limit: q.limit,
        total,
        hasNext: q.offset + rows.length < total,
      },
    };
  }
  async upload(i: CustomerIdentity, key: string, b: CreateUploadDto) {
    this.require(i, "documents.create");
    needKey(key);
    if (!allowed.has(b.mimeType))
      throw new ApiProblem({ status: 415, code: "UNSUPPORTED_MEDIA_TYPE" });
    const limit = b.mimeType.startsWith("image/")
      ? 10 * 1024 * 1024
      : 25 * 1024 * 1024;
    if (b.sizeBytes > limit)
      throw new ApiProblem({ status: 413, code: "FILE_TOO_LARGE" });
    if (/[\\/]/.test(b.fileName) || b.fileName.includes(".."))
      rule("UNSAFE_FILE_NAME");
    if (b.targetResourceType && b.targetResourceId)
      await this.resource(i, b.targetResourceType, b.targetResourceId);
    const h = hash({ b }),
      replay = await this.replay(i, "DOCUMENT_UPLOAD_CREATE", key, h);
    if (replay) {
      const row = await this.db.uploadSession.findUnique({
        where: { id: replay },
      });
      if (!row) missing();
      return { data: upload(row) };
    }
    const id = randomUUID(),
      storageKey = `uploads/${id}`;
    return this.txs.run(i, async (tx) => {
      const row = await tx.uploadSession.create({
        data: {
          id,
          requestedByUserId: i.userId,
          documentTypeCode: b.documentTypeCode,
          fileName: b.fileName,
          expectedMimeType: b.mimeType,
          expectedSizeBytes: BigInt(b.sizeBytes),
          storageKey,
          targetResourceType: b.targetResourceType ?? null,
          targetResourceId: b.targetResourceId ?? null,
          expiresAt: new Date(Date.now() + 5 * 60_000),
        },
      });
      await tx.commandIdempotency.create({
        data: {
          actorUserId: i.userId,
          operationCode: "DOCUMENT_UPLOAD_CREATE",
          idempotencyKey: key,
          requestHash: h,
          responseResourceId: id,
        },
      });
      await audit(
        tx,
        i,
        "DOCUMENT_UPLOAD_SESSION_CREATED",
        "UPLOAD_SESSION",
        id,
        null,
        { storageKey, expectedSizeBytes: b.sizeBytes },
      );
      return { data: upload(row) };
    });
  }
  async complete(
    i: CustomerIdentity,
    id: string,
    key: string,
    b: CompleteUploadDto,
  ) {
    this.require(i, "documents.create");
    needKey(key);
    const row = await this.db.uploadSession.findFirst({
      where: { id, requestedByUserId: i.userId },
    });
    if (!row) missing();
    if (row.expiresAt < new Date())
      throw new ApiProblem({ status: 409, code: "UPLOAD_SESSION_EXPIRED" });
    if (row.statusCode !== "PENDING_UPLOAD" && row.statusCode !== "SCANNING")
      throw new ApiProblem({ status: 409, code: "UPLOAD_STATE_INVALID" });
    if (row.statusCode === "SCANNING")
      return { data: upload(row), status: 202 };
    const file = resolve(
      process.env.ABP_LOCAL_OBJECT_ROOT ?? ".tmp/object-storage",
      row.storageKey,
    );
    let info;
    try {
      info = await stat(file);
    } catch {
      throw new ApiProblem({ status: 409, code: "UPLOAD_OBJECT_NOT_FOUND" });
    }
    if (BigInt(info.size) !== row.expectedSizeBytes)
      rule("UPLOAD_SIZE_MISMATCH");
    const detected = detectMime(await readFile(file));
    if (detected !== row.expectedMimeType) rule("UPLOAD_MIME_MISMATCH");
    const actual = await sha(file);
    if (b.actualSha256 && b.actualSha256.toLowerCase() !== actual)
      rule("UPLOAD_HASH_MISMATCH");
    const h = hash({ id, actual }),
      replay = await this.replay(i, "DOCUMENT_UPLOAD_COMPLETE", key, h);
    if (replay) {
      const x = await this.db.uploadSession.findUniqueOrThrow({
        where: { id },
      });
      return { data: upload(x), status: 202 };
    }
    return this.txs.run(i, async (tx) => {
      const job = await tx.durableJob.create({
        data: {
          type: "MALWARE_SCAN",
          status: "PENDING",
          payload: {
            uploadSessionId: id,
            storageKey: row.storageKey,
            mimeType: row.expectedMimeType,
          },
          traceId: i.traceId,
          correlationId: i.correlationId,
          idempotencyKey: `scan:${id}`,
          sourceType: "UPLOAD_SESSION",
          sourceId: id,
        },
      });
      const x = await tx.uploadSession.update({
        where: { id },
        data: {
          statusCode: "SCANNING",
          actualSha256: actual,
          malwareStatusCode: "PENDING",
          completedAt: new Date(),
        },
      });
      await tx.commandIdempotency.create({
        data: {
          actorUserId: i.userId,
          operationCode: "DOCUMENT_UPLOAD_COMPLETE",
          idempotencyKey: key,
          requestHash: h,
          responseResourceId: id,
        },
      });
      await tx.outboxMessage.create({
        data: {
          eventType: "DOCUMENT_SCAN_REQUESTED",
          aggregateType: "UPLOAD_SESSION",
          aggregateId: id,
          payload: { uploadSessionId: id, jobId: job.id },
          traceId: i.traceId,
          correlationId: i.correlationId,
          idempotencyKey: `scan:${id}`,
        },
      });
      await audit(tx, i, "DOCUMENT_SCAN_QUEUED", "UPLOAD_SESSION", id, null, {
        jobId: job.id,
      });
      return { data: upload(x), status: 202 };
    });
  }
  async uploadStatus(i: CustomerIdentity, id: string) {
    this.require(i, "documents.create");
    const row = await this.db.uploadSession.findFirst({
      where: { id, requestedByUserId: i.userId },
    });
    if (!row) missing();
    return { data: upload(row) };
  }
  async writeContent(
    i: CustomerIdentity,
    id: string,
    key: string,
    body: Buffer,
  ) {
    this.require(i, "documents.create");
    needKey(key);
    if (!Buffer.isBuffer(body) || body.length === 0)
      rule("UPLOAD_CONTENT_REQUIRED");
    const row = await this.db.uploadSession.findFirst({
      where: { id, requestedByUserId: i.userId },
    });
    if (!row) missing();
    if (row.expiresAt < new Date())
      throw new ApiProblem({ status: 409, code: "UPLOAD_SESSION_EXPIRED" });
    if (row.statusCode !== "PENDING_UPLOAD")
      throw new ApiProblem({ status: 409, code: "UPLOAD_STATE_INVALID" });
    if (BigInt(body.length) !== row.expectedSizeBytes)
      rule("UPLOAD_SIZE_MISMATCH");
    const root = resolve(
      process.env.ABP_LOCAL_OBJECT_ROOT ?? ".tmp/object-storage",
    );
    const file = resolve(root, row.storageKey);
    if (!file.startsWith(root)) rule("UNSAFE_FILE_NAME");
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, body);
    return { data: upload(row) };
  }
  async document(i: CustomerIdentity, id: string) {
    this.require(i, "documents.view");
    const row = await this.db.documentMetadata.findUnique({ where: { id } });
    if (!row) missing();
    await this.authorizeDocument(i, row);
    const links = await this.db.documentLink.findMany({
      where: { documentId: id },
      orderBy: { createdAt: "asc" },
    });
    return { data: documentDetailDto(row, links) };
  }
  async versions(i: CustomerIdentity, id: string) {
    this.require(i, "documents.view");
    const document = await this.db.documentMetadata.findUnique({
      where: { id },
    });
    if (!document) missing();
    await this.authorizeDocument(i, document);
    const rows = await this.db.documentVersion.findMany({
      where: { documentId: id },
      orderBy: { versionNo: "desc" },
    });
    return {
      data: rows.map(documentVersionDto),
      meta: {
        page: 1,
        offset: 0,
        limit: Math.max(rows.length, 1),
        total: rows.length,
        hasNext: false,
      },
    };
  }
  async download(i: CustomerIdentity, id: string) {
    await this.document(i, id);
    const row = await this.db.documentMetadata.findUniqueOrThrow({
      where: { id },
    });
    if (row.statusCode !== "AVAILABLE")
      throw new ApiProblem({ status: 409, code: "DOCUMENT_NOT_AVAILABLE" });
    const expires = new Date(Date.now() + 5 * 60_000);
    return {
      data: {
        url: `/api/v1/documents/${id}/content`,
        expiresAt: expires.toISOString(),
        fileName: row.title ?? `${id}.${extension(row.mimeType)}`,
        mimeType: row.mimeType,
      },
    };
  }
  async content(i: CustomerIdentity, id: string) {
    await this.document(i, id);
    const row = await this.db.documentMetadata.findUniqueOrThrow({
      where: { id },
    });
    if (row.statusCode !== "AVAILABLE")
      throw new ApiProblem({ status: 409, code: "DOCUMENT_NOT_AVAILABLE" });
    let root: string;
    let file: string;
    try {
      root = await realpath(
        resolve(process.env.ABP_LOCAL_OBJECT_ROOT ?? ".tmp/object-storage"),
      );
      file = await realpath(resolve(root, row.storageKey));
      if (!(await stat(file)).isFile()) throw new Error("NOT_A_FILE");
    } catch {
      throw new ApiProblem({ status: 404, code: "DOCUMENT_CONTENT_NOT_FOUND" });
    }
    const local = relative(root, file);
    if (local.startsWith("..") || isAbsolute(local))
      throw new ApiProblem({
        status: 403,
        code: "DOCUMENT_STORAGE_PATH_INVALID",
      });
    return {
      stream: createReadStream(file),
      mimeType: row.mimeType,
      fileName: row.title ?? `${id}.${extension(row.mimeType)}`,
    };
  }
  async link(i: CustomerIdentity, id: string, key: string, b: LinkDocumentDto) {
    this.require(i, "documents.link");
    needKey(key);
    const row = await this.db.documentMetadata.findUnique({ where: { id } });
    if (!row || row.statusCode !== "AVAILABLE") missing();
    await this.authorizeDocument(i, row);
    await this.resource(i, b.resourceTypeCode, b.resourceId);
    const h = hash({ id, b }),
      replay = await this.replay(i, "DOCUMENT_LINK_CREATE", key, h);
    if (!replay)
      await this.txs.run(i, async (tx) => {
        const link = await tx.documentLink.create({
          data: { documentId: id, ...b, createdByUserId: i.userId },
        });
        await tx.commandIdempotency.create({
          data: {
            actorUserId: i.userId,
            operationCode: "DOCUMENT_LINK_CREATE",
            idempotencyKey: key,
            requestHash: h,
            responseResourceId: link.id,
          },
        });
        await audit(tx, i, "DOCUMENT_LINKED", "DOCUMENT", id, null, {
          linkId: link.id,
          resourceTypeCode: b.resourceTypeCode,
          resourceId: b.resourceId,
        });
      });
    return { data: documentDetailDto(row) };
  }
  async unlink(i: CustomerIdentity, id: string, t: string, key: string) {
    this.require(i, "documents.link");
    needKey(key);
    etag(t);
    const link = await this.db.documentLink.findUnique({ where: { id } });
    if (!link) missing();
    await this.resource(i, link.resourceTypeCode, link.resourceId);
    const h = hash({ id, t }),
      replay = await this.replay(i, "DOCUMENT_LINK_DELETE", key, h);
    if (!replay)
      await this.txs.run(i, async (tx) => {
        await tx.documentLink.delete({ where: { id } });
        await tx.commandIdempotency.create({
          data: {
            actorUserId: i.userId,
            operationCode: "DOCUMENT_LINK_DELETE",
            idempotencyKey: key,
            requestHash: h,
            responseResourceId: id,
          },
        });
        await audit(tx, i, "DOCUMENT_UNLINKED", "DOCUMENT_LINK", id, null, {
          documentId: link.documentId,
        });
      });
    return {
      data: { success: true, resourceId: id, statusCode: "UNLINKED" },
      etag: '"rv-2"',
    };
  }
  async createExport(i: CustomerIdentity, key: string, b: CreateExportDto) {
    this.require(i, "exports.create");
    if (
      i.deniedPermissions.has("data.export") ||
      !i.permissions.has("data.export")
    )
      forbid();
    needKey(key);
    const h = hash({ b, countries: [...i.countryCodes].sort() }),
      replay = await this.replay(i, "EXPORT_CREATE", key, h);
    if (replay) return this.exportRow(i, replay);
    return this.txs.run(i, async (tx) => {
      const job = await tx.durableJob.create({
        data: {
          type: "DATA_EXPORT",
          status: "PENDING",
          payload: { ...b, countryCodes: [...i.countryCodes] },
          traceId: i.traceId,
          correlationId: i.correlationId,
          idempotencyKey: `export:${key}`,
          sourceType: "EXPORT",
        },
      });
      const row = await tx.exportEvent.create({
        data: {
          userId: i.userId,
          exportTypeCode: b.exportTypeCode,
          formatCode: b.formatCode,
          resourceTypeCode: b.resourceTypeCode ?? null,
          filterSummary: b.filters,
          countryCodes: [...i.countryCodes],
          jobId: job.id,
        },
      });
      await tx.commandIdempotency.create({
        data: {
          actorUserId: i.userId,
          operationCode: "EXPORT_CREATE",
          idempotencyKey: key,
          requestHash: h,
          responseResourceId: row.id,
        },
      });
      await tx.outboxMessage.create({
        data: {
          eventType: "EXPORT_REQUESTED",
          aggregateType: "EXPORT",
          aggregateId: row.id,
          payload: { exportId: row.id, jobId: job.id },
          traceId: i.traceId,
          correlationId: i.correlationId,
          idempotencyKey: `export:${row.id}`,
        },
      });
      await audit(tx, i, "EXPORT_QUEUED", "EXPORT", row.id, null, {
        formatCode: b.formatCode,
        countryCodes: [...i.countryCodes],
      });
      return exportDto(row);
    });
  }
  async exportStatus(i: CustomerIdentity, id: string) {
    this.require(i, "exports.view");
    return { data: await this.exportRow(i, id) };
  }
  private async exportRow(i: CustomerIdentity, id: string) {
    const row = await this.db.exportEvent.findFirst({
      where: { id, userId: i.userId },
    });
    if (!row) missing();
    return exportDto(row);
  }
  private async authorizeDocument(
    i: CustomerIdentity,
    row: {
      createdByUserId: string;
      resourceTypeCode: string;
      resourceId: string;
    },
  ) {
    if (row.createdByUserId === i.userId) return;
    await this.resource(i, row.resourceTypeCode, row.resourceId);
  }
  private async resource(i: CustomerIdentity, type: string, id: string) {
    const t = type.toUpperCase();
    let country: string | null = null;
    if (t === "ACCOUNT")
      country =
        (
          await this.db.account.findUnique({
            where: { id },
            select: { countryCode: true },
          })
        )?.countryCode ?? null;
    else if (t === "PROJECT")
      country =
        (
          await this.db.project.findUnique({
            where: { id },
            select: { countryCode: true },
          })
        )?.countryCode ?? null;
    else if (t === "QUOTATION")
      country =
        (
          await this.db.quotation.findUnique({
            where: { id },
            select: { countryCode: true },
          })
        )?.countryCode ?? null;
    else if (t === "COMPLAINT")
      country =
        (
          await this.db.complaint.findUnique({
            where: { id },
            select: { countryCode: true },
          })
        )?.countryCode ?? null;
    // A shipment carries its signed delivery note (the POD).
    else if (t === "SHIPMENT")
      country =
        (
          await this.db.shipment.findUnique({
            where: { id },
            select: { countryCode: true },
          })
        )?.countryCode ?? null;
    else rule("UNSUPPORTED_RESOURCE_TYPE");
    if (!country || !i.countryCodes.has(country.trim())) missing();
  }
  private require(i: CustomerIdentity, p: string) {
    if (i.deniedPermissions.has(p) || !i.permissions.has(p)) forbid();
  }
  private replay(i: CustomerIdentity, op: string, key: string, h: string) {
    return this.db.commandIdempotency
      .findUnique({
        where: {
          actorUserId_operationCode_idempotencyKey: {
            actorUserId: i.userId,
            operationCode: op,
            idempotencyKey: key,
          },
        },
      })
      .then((x) => {
        if (x && x.requestHash !== h)
          throw new ApiProblem({ status: 409, code: "IDEMPOTENCY_KEY_REUSED" });
        return x?.responseResourceId ?? null;
      });
  }
}
const hash = (x: unknown) =>
  createHash("sha256").update(JSON.stringify(x)).digest("hex");
async function sha(path: string) {
  return new Promise<string>((ok, no) => {
    const h = createHash("sha256"),
      s = createReadStream(path);
    s.on("data", (d) => h.update(d));
    s.on("error", no);
    s.on("end", () => {
      ok(h.digest("hex"));
    });
  });
}
function upload(x: {
  id: string;
  requestedByUserId: string;
  expectedMimeType: string;
  expectedSizeBytes: bigint;
  storageKey: string;
  statusCode: string;
  malwareStatusCode: string | null;
  expiresAt: Date;
  fileName: string;
  actualSha256: string | null;
  completedAt: Date | null;
  documentId: string | null;
}) {
  return {
    uploadSessionId: x.id,
    requestedByUserId: x.requestedByUserId,
    expectedMimeType: x.expectedMimeType,
    expectedSizeBytes: Number(x.expectedSizeBytes),
    storageKey: x.storageKey,
    statusCode: x.statusCode,
    malwareScanStatusCode: x.malwareStatusCode,
    verifiedAt: null,
    fileName: x.fileName,
    expectedSha256: null,
    actualMimeType: null,
    actualSizeBytes: x.completedAt ? Number(x.expectedSizeBytes) : null,
    actualSha256: x.actualSha256,
    uploadedAt: x.completedAt?.toISOString() ?? null,
    failureCode: null,
    expiresAt: x.expiresAt.toISOString(),
    documentVersionId: x.documentId,
    scanStartedAt: x.completedAt?.toISOString() ?? null,
    scanCompletedAt: null,
    statusUrl: `/api/v1/documents/uploads/${x.id}`,
  };
}
function documentDetailDto(
  x: Prisma.DocumentMetadataGetPayload<object>,
  links?: Prisma.DocumentLinkGetPayload<object>[],
) {
  return {
    documentId: x.id,
    resourceTypeCode: x.resourceTypeCode,
    resourceId: x.resourceId,
    documentTypeCode: x.documentTypeCode,
    title: x.title,
    mimeType: x.mimeType,
    sizeBytes: Number(x.sizeBytes),
    contentHash: x.fileHash,
    classificationCode: x.classificationCode,
    statusCode: x.statusCode,
    official: x.isFinal,
    immutable: x.isFinal,
    createdByUserId: x.createdByUserId,
    createdAt: x.createdAt.toISOString(),
    // Only present on the reads that include them; a link that cannot be
    // read cannot be removed, which is how these became write-only.
    ...(links === undefined
      ? {}
      : {
          links: links.map((link) => ({
            linkId: link.id,
            documentId: link.documentId,
            resourceTypeCode: link.resourceTypeCode,
            resourceId: link.resourceId,
            relationshipTypeCode: link.relationshipTypeCode,
            createdByUserId: link.createdByUserId,
            createdAt: link.createdAt.toISOString(),
          })),
        }),
  };
}
function documentListDto(
  x: Prisma.DocumentMetadataGetPayload<{ include: { versions: true } }>,
) {
  return {
    documentId: x.id,
    resourceTypeCode: x.resourceTypeCode,
    resourceId: x.resourceId,
    documentTypeCode: x.documentTypeCode,
    displayName: x.title,
    version: x.versions[0]?.versionNo ?? 1,
    statusCode: x.statusCode,
    official: x.isFinal,
    immutable: x.isFinal,
    createdByUserId: x.createdByUserId,
    createdAt: x.createdAt.toISOString(),
  };
}
function documentVersionDto(x: Prisma.DocumentVersionGetPayload<object>) {
  return {
    documentVersionId: x.id,
    documentId: x.documentId,
    versionNo: x.versionNo,
    mimeType: x.mimeType,
    sizeBytes: Number(x.sizeBytes),
    contentHash: x.contentHash,
    sourceTypeCode: x.sourceTypeCode,
    createdByUserId: x.createdByUserId,
    createdAt: x.createdAt.toISOString(),
    templateVersionId: x.templateVersionId,
    rendererVersion: x.rendererVersion,
    immutable: x.immutable,
  };
}
function exportDto(x: {
  id: string;
  userId: string;
  exportTypeCode: string;
  resourceTypeCode: string | null;
  filterSummary: unknown;
  rowCount: bigint | null;
  documentId: string | null;
  statusCode: string;
  failureCode: string | null;
  createdAt: Date;
  completedAt: Date | null;
}) {
  return {
    exportEventId: x.id,
    userId: x.userId,
    exportTypeCode: x.exportTypeCode,
    resourceTypeCode: x.resourceTypeCode,
    filterSummaryJsonb: x.filterSummary as Record<string, unknown> | null,
    rowCount: x.rowCount === null ? null : Number(x.rowCount),
    documentId: x.documentId,
    statusCode: x.statusCode,
    failureCode: x.failureCode,
    createdAt: x.createdAt.toISOString(),
    completedAt: x.completedAt?.toISOString() ?? null,
    statusUrl: `/api/v1/exports/${x.id}`,
  };
}
function extension(m: string) {
  return m === "application/pdf"
    ? "pdf"
    : m === "image/png"
      ? "png"
      : m === "image/jpeg"
        ? "jpg"
        : "bin";
}
function detectMime(content: Buffer): string {
  if (content.subarray(0, 5).toString("ascii") === "%PDF-")
    return "application/pdf";
  if (
    content
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "image/png";
  if (content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff)
    return "image/jpeg";
  if (content[0] === 0x50 && content[1] === 0x4b) {
    const archiveText = content.toString("latin1");
    if (archiveText.includes("word/"))
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    if (archiveText.includes("xl/"))
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  if (!content.includes(0)) return "text/csv";
  return "application/octet-stream";
}
function etag(v: string) {
  if (!/^(?:W\/)?\"?rv-\d+\"?$/.test(v.trim()))
    throw new ApiProblem({ status: 400, code: "IF_MATCH_REQUIRED" });
}
function needKey(x: string) {
  if (!x || x.length > 200)
    throw new ApiProblem({ status: 400, code: "IDEMPOTENCY_KEY_REQUIRED" });
}
function missing(): never {
  throw new ApiProblem({ status: 404, code: "RESOURCE_NOT_FOUND" });
}
function rule(c: string): never {
  throw new ApiProblem({ status: 422, code: c });
}
function forbid(): never {
  throw new ApiProblem({ status: 403, code: "FORBIDDEN" });
}
async function audit(
  tx: TransactionClient,
  i: CustomerIdentity,
  a: string,
  t: string,
  id: string,
  c: string | null,
  m: Record<string, unknown>,
) {
  const metadata = m as Prisma.InputJsonValue;
  await tx.auditEvent.create({
    data: {
      actorUserId: i.userId,
      actorSessionId: i.sessionId,
      actionCode: a,
      resourceType: t,
      resourceId: id,
      workspace: "PLATFORM",
      countryCode: c,
      metadata,
      traceId: i.traceId,
      correlationId: i.correlationId,
      source: "API",
    },
  });
}
