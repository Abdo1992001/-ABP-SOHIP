import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { permissions } from "@abp/contracts";
import {
  Prisma,
  type DatabaseClient,
  type TransactionClient,
  type TransactionManager,
} from "@abp/database";
import {
  hasWorkspace,
  type CustomerIdentity,
} from "../customer/customer-auth.js";
import { ApiProblem } from "../platform/api-exception.filter.js";
import {
  databaseClientToken,
  transactionManagerToken,
} from "../platform/database.providers.js";
import type {
  CreateTemplateDto,
  CreateTemplateVersionDto,
  TemplateListQuery,
  TemplateVersionTransitionDto,
  UpdateTemplateVersionDto,
} from "./templates.dto.js";

@Injectable()
export class TemplatesService {
  constructor(
    @Inject(databaseClientToken) private readonly db: DatabaseClient,
    @Inject(transactionManagerToken) private readonly txs: TransactionManager,
  ) {}

  async list(i: CustomerIdentity, q: TemplateListQuery) {
    this.view(i);
    const where: Prisma.DocumentTemplateWhereInput = {
      ...(q.statusCode ? { statusCode: q.statusCode } : {}),
      ...(q.documentTypeCode ? { documentTypeCode: q.documentTypeCode } : {}),
      ...(q.languageCode ? { languageCode: q.languageCode } : {}),
      ...(q.brandCode ? { brandCode: q.brandCode } : {}),
      ...(q.search
        ? {
            OR: [
              { code: { contains: q.search, mode: "insensitive" } },
              { name: { contains: q.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    const [total, rows] = await this.db.$transaction([
      this.db.documentTemplate.count({ where }),
      this.db.documentTemplate.findMany({
        where,
        orderBy: [{ code: "asc" }],
        skip: q.offset,
        take: q.limit,
        include: { versions: { orderBy: { versionNo: "desc" } } },
      }),
    ]);
    return {
      data: rows.map(templateDto),
      meta: page(q.offset, q.limit, total, rows.length),
    };
  }

  async create(
    i: CustomerIdentity,
    key: string | undefined,
    b: CreateTemplateDto,
  ) {
    this.manage(i);
    const k = needKey(key);
    const requestHash = hash(b);
    return this.txs.run(i, async (tx) => {
      const replay = await tx.commandIdempotency.findUnique({
        where: {
          actorUserId_operationCode_idempotencyKey: {
            actorUserId: i.userId,
            operationCode: "post_admin_document_templates",
            idempotencyKey: k,
          },
        },
      });
      if (replay) {
        if (replay.requestHash !== requestHash)
          conflict("IDEMPOTENCY_KEY_REUSED");
        return {
          data: templateDto(
            await tx.documentTemplate.findUniqueOrThrow({
              where: { id: replay.responseResourceId },
              include: { versions: true },
            }),
          ),
        };
      }
      const row = await tx.documentTemplate.create({
        data: { ...b, createdByUserId: i.userId },
        include: { versions: true },
      });
      await remember(
        tx,
        i,
        "post_admin_document_templates",
        k,
        requestHash,
        row.id,
      );
      await audit(
        tx,
        i,
        "DOCUMENT_TEMPLATE_CREATED",
        "DocumentTemplate",
        row.id,
        { code: row.code },
      );
      return { data: templateDto(row) };
    });
  }

  async get(i: CustomerIdentity, id: string) {
    this.view(i);
    const row = await this.db.documentTemplate.findUnique({
      where: { id },
      include: { versions: { orderBy: { versionNo: "desc" } } },
    });
    if (!row) missing();
    return { data: templateDto(row) };
  }

  async versions(i: CustomerIdentity, id: string) {
    this.view(i);
    if (!(await this.db.documentTemplate.findUnique({ where: { id } })))
      missing();
    const rows = await this.db.documentTemplateVersion.findMany({
      where: { templateId: id },
      orderBy: { versionNo: "desc" },
    });
    return {
      data: rows.map(versionDto),
      meta: page(0, Math.max(rows.length, 1), rows.length, rows.length),
    };
  }

  async createVersion(
    i: CustomerIdentity,
    id: string,
    key: string | undefined,
    b: CreateTemplateVersionDto,
  ) {
    this.manage(i);
    const k = needKey(key);
    const requestHash = hash({ id, b });
    return this.txs.run(i, async (tx) => {
      const template = await tx.documentTemplate.findUnique({ where: { id } });
      if (!template) missing();
      const replay = await tx.commandIdempotency.findUnique({
        where: {
          actorUserId_operationCode_idempotencyKey: {
            actorUserId: i.userId,
            operationCode: "post_admin_document_templates_versions",
            idempotencyKey: k,
          },
        },
      });
      if (replay) {
        if (replay.requestHash !== requestHash)
          conflict("IDEMPOTENCY_KEY_REUSED");
        return {
          data: versionDto(
            await tx.documentTemplateVersion.findUniqueOrThrow({
              where: { id: replay.responseResourceId },
            }),
          ),
        };
      }
      const max = await tx.documentTemplateVersion.aggregate({
        where: { templateId: id },
        _max: { versionNo: true },
      });
      const row = await tx.documentTemplateVersion.create({
        data: {
          templateId: id,
          versionNo: (max._max.versionNo ?? 0) + 1,
          content: b.content,
          contentHash: hashText(b.content),
          languageCode: b.languageCode ?? template.languageCode,
          brandCode: b.brandCode ?? template.brandCode,
          createdByUserId: i.userId,
        },
      });
      await remember(
        tx,
        i,
        "post_admin_document_templates_versions",
        k,
        requestHash,
        row.id,
      );
      await audit(
        tx,
        i,
        "DOCUMENT_TEMPLATE_VERSION_CREATED",
        "DocumentTemplateVersion",
        row.id,
        {
          templateId: id,
          versionNo: row.versionNo,
          contentHash: row.contentHash,
        },
      );
      return { data: versionDto(row) };
    });
  }

  async updateVersion(
    i: CustomerIdentity,
    id: string,
    ifMatch: string | undefined,
    key: string | undefined,
    b: UpdateTemplateVersionDto,
  ) {
    this.manage(i);
    const expected = etagVersion(ifMatch);
    const k = needKey(key);
    const requestHash = hash({ id, b, expected: expected.toString() });
    return this.txs.run(i, async (tx) => {
      const old = await tx.documentTemplateVersion.findUnique({
        where: { id },
      });
      if (!old) missing();
      if (old.statusCode !== "DRAFT")
        conflict("PUBLISHED_TEMPLATE_VERSION_IMMUTABLE");
      const replay = await tx.commandIdempotency.findUnique({
        where: {
          actorUserId_operationCode_idempotencyKey: {
            actorUserId: i.userId,
            operationCode: "patch_admin_document_template_version",
            idempotencyKey: k,
          },
        },
      });
      if (replay) {
        if (replay.requestHash !== requestHash)
          conflict("IDEMPOTENCY_KEY_REUSED");
        const row = await tx.documentTemplateVersion.findUniqueOrThrow({
          where: { id },
        });
        return { data: versionDto(row), etag: etag(row.rowVersion) };
      }
      const changed = await tx.documentTemplateVersion.updateMany({
        where: { id, rowVersion: expected, statusCode: "DRAFT" },
        data: {
          content: b.content,
          contentHash: hashText(b.content),
          rowVersion: { increment: 1 },
        },
      });
      if (changed.count !== 1) precondition();
      const row = await tx.documentTemplateVersion.findUniqueOrThrow({
        where: { id },
      });
      await remember(
        tx,
        i,
        "patch_admin_document_template_version",
        k,
        requestHash,
        id,
      );
      await audit(
        tx,
        i,
        "DOCUMENT_TEMPLATE_DRAFT_UPDATED",
        "DocumentTemplateVersion",
        id,
        { contentHash: row.contentHash },
      );
      return { data: versionDto(row), etag: etag(row.rowVersion) };
    });
  }

  async transition(
    i: CustomerIdentity,
    id: string,
    ifMatch: string | undefined,
    key: string | undefined,
    b: TemplateVersionTransitionDto,
  ) {
    this.manage(i);
    const expected = etagVersion(ifMatch);
    const k = needKey(key);
    const requestHash = hash({ id, b, expected: expected.toString() });
    return this.txs.run(i, async (tx) => {
      const old = await tx.documentTemplateVersion.findUnique({
        where: { id },
      });
      if (!old) missing();
      const operation = "post_admin_document_template_version_transition";
      const replay = await tx.commandIdempotency.findUnique({
        where: {
          actorUserId_operationCode_idempotencyKey: {
            actorUserId: i.userId,
            operationCode: operation,
            idempotencyKey: k,
          },
        },
      });
      if (replay) {
        if (replay.requestHash !== requestHash)
          conflict("IDEMPOTENCY_KEY_REUSED");
        const row = await tx.documentTemplateVersion.findUniqueOrThrow({
          where: { id },
        });
        return { data: versionDto(row), etag: etag(row.rowVersion) };
      }
      if (b.targetStatusCode === "ACTIVATE") {
        if (old.statusCode !== "DRAFT") conflict("TEMPLATE_TRANSITION_INVALID");
        await tx.documentTemplateVersion.updateMany({
          where: { templateId: old.templateId, statusCode: "ACTIVE" },
          data: {
            statusCode: "ARCHIVED",
            archivedAt: new Date(),
            archivedByUserId: i.userId,
            rowVersion: { increment: 1 },
          },
        });
      } else if (old.statusCode !== "ACTIVE")
        conflict("TEMPLATE_TRANSITION_INVALID");
      const now = new Date();
      const changed = await tx.documentTemplateVersion.updateMany({
        where: { id, rowVersion: expected },
        data:
          b.targetStatusCode === "ACTIVATE"
            ? {
                statusCode: "ACTIVE",
                activatedAt: now,
                activatedByUserId: i.userId,
                rowVersion: { increment: 1 },
              }
            : {
                statusCode: "ARCHIVED",
                archivedAt: now,
                archivedByUserId: i.userId,
                rowVersion: { increment: 1 },
              },
      });
      if (changed.count !== 1) precondition();
      const row = await tx.documentTemplateVersion.findUniqueOrThrow({
        where: { id },
      });
      await remember(tx, i, operation, k, requestHash, id);
      await audit(
        tx,
        i,
        `DOCUMENT_TEMPLATE_${b.targetStatusCode}D`,
        "DocumentTemplateVersion",
        id,
        { reason: b.reason, contentHash: row.contentHash },
      );
      return { data: versionDto(row), etag: etag(row.rowVersion) };
    });
  }

  async preview(i: CustomerIdentity, id: string) {
    this.view(i);
    const row = await this.db.documentTemplateVersion.findUnique({
      where: { id },
      include: { template: true },
    });
    if (!row) missing();
    const sample = {
      quotationNumber: "Q-DEMO-0001",
      customerName: "Sample Customer",
      validUntil: "2099-12-31",
    };
    const rendered = Object.entries(sample).reduce(
      (text, [key, value]) => text.replaceAll(`{{${key}}}`, value),
      row.content,
    );
    return {
      data: {
        templateVersionId: row.id,
        versionNo: row.versionNo,
        contentHash: row.contentHash,
        languageCode: row.languageCode,
        brandCode: row.brandCode,
        previewModeCode: "DETERMINISTIC_SAMPLE",
        renderedContent: rendered,
        sample,
      },
    };
  }

  /**
   * `identity.workspaces` is the raw set derived from the user's roles, and
   * the SYSTEM_ADMIN role's own workspace column is SALES -- so asking it for
   * "ADMIN" said no to the one account that can reach everything, and the
   * document-templates screen answered 403 to the administrator the sidebar
   * had just offered it to. `hasWorkspace()` is the check that knows a system
   * administrator holds every workspace.
   */
  private view(i: CustomerIdentity) {
    if (!hasWorkspace(i, "ADMIN") || !allowed(i, permissions.documentsView))
      forbidden();
  }
  private manage(i: CustomerIdentity) {
    if (!hasWorkspace(i, "ADMIN") || !allowed(i, permissions.documentsCreate))
      forbidden();
  }
}

function templateDto(
  r: Prisma.DocumentTemplateGetPayload<{ include: { versions: true } }>,
) {
  const active = r.versions.find((v) => v.statusCode === "ACTIVE") ?? null;
  return {
    templateId: r.id,
    code: r.code,
    name: r.name,
    documentTypeCode: r.documentTypeCode,
    languageCode: r.languageCode,
    brandCode: r.brandCode,
    statusCode: r.statusCode,
    rowVersion: r.rowVersion.toString(),
    activeVersion: active ? versionDto(active) : null,
    versionCount: r.versions.length,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}
function versionDto(r: Prisma.DocumentTemplateVersionGetPayload<object>) {
  return {
    templateVersionId: r.id,
    templateId: r.templateId,
    versionNo: r.versionNo,
    statusCode: r.statusCode,
    content: r.content,
    contentHash: r.contentHash,
    languageCode: r.languageCode,
    brandCode: r.brandCode,
    createdByUserId: r.createdByUserId,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    activatedByUserId: r.activatedByUserId,
    activatedAt: r.activatedAt?.toISOString() ?? null,
    archivedByUserId: r.archivedByUserId,
    archivedAt: r.archivedAt?.toISOString() ?? null,
    rowVersion: r.rowVersion.toString(),
  };
}
function allowed(i: CustomerIdentity, p: string) {
  return i.permissions.has(p) && !i.deniedPermissions.has(p);
}
function needKey(k: string | undefined) {
  if (!k || k.length < 8 || k.length > 200)
    throw new ApiProblem({ status: 400, code: "IDEMPOTENCY_KEY_REQUIRED" });
  return k;
}
function etagVersion(v: string | undefined) {
  const m = /^(?:W\/)?\"?(?:rv-)?(\d+)\"?$/.exec(v ?? "");
  if (!m) throw new ApiProblem({ status: 400, code: "IF_MATCH_REQUIRED" });
  return BigInt(m[1]!);
}
function etag(v: bigint) {
  return `\"rv-${v.toString()}\"`;
}
function hash(v: unknown) {
  return createHash("sha256").update(JSON.stringify(v)).digest("hex");
}
function hashText(v: string) {
  return createHash("sha256").update(v).digest("hex");
}
function page(offset: number, limit: number, total: number, count: number) {
  return {
    page: Math.floor(offset / limit) + 1,
    offset,
    limit,
    total,
    hasNext: offset + count < total,
  };
}
function missing(): never {
  throw new ApiProblem({ status: 404, code: "DOCUMENT_TEMPLATE_NOT_FOUND" });
}
function forbidden(): never {
  throw new ApiProblem({ status: 403, code: "FORBIDDEN" });
}
function conflict(code: string): never {
  throw new ApiProblem({ status: 409, code });
}
function precondition(): never {
  throw new ApiProblem({ status: 412, code: "ROW_VERSION_MISMATCH" });
}
async function remember(
  tx: TransactionClient,
  i: CustomerIdentity,
  op: string,
  key: string,
  requestHash: string,
  id: string,
) {
  await tx.commandIdempotency.create({
    data: {
      actorUserId: i.userId,
      operationCode: op,
      idempotencyKey: key,
      requestHash,
      responseResourceId: id,
    },
  });
}
async function audit(
  tx: TransactionClient,
  i: CustomerIdentity,
  actionCode: string,
  resourceType: string,
  resourceId: string,
  metadata: Record<string, unknown>,
) {
  await tx.auditEvent.create({
    data: {
      actorUserId: i.userId,
      actorSessionId: i.sessionId,
      actionCode,
      resourceType,
      resourceId,
      workspace: "ADMIN",
      countryCode: null,
      metadata: metadata as Prisma.InputJsonValue,
      traceId: i.traceId,
      correlationId: i.correlationId,
      source: "template-api",
    },
  });
}
