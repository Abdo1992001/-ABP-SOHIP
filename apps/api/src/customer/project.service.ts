import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { components } from "@abp/api-client";
import { permissions } from "@abp/contracts";
import {
  AuditRepository,
  type DatabaseClient,
  Prisma,
  TransactionManager,
  type TransactionClient,
} from "@abp/database";
import { ApiProblem } from "../platform/api-exception.filter.js";
import {
  auditRepositoryToken,
  databaseClientToken,
  transactionManagerToken,
} from "../platform/database.providers.js";
import { CustomerAccessService } from "./customer-access.service.js";
import {
  canUseManagerContext,
  isSystemAdmin,
  type CustomerIdentity,
} from "./customer-auth.js";
import { classifyMarketScope } from "./market-scope.js";
import type {
  ArchiveProjectDto,
  AddProjectPartyDto,
  AddProjectContactRoleDto,
  CreateProjectDto,
  ProjectListQuery,
  UpdateProjectDto,
} from "./project.dto.js";

type ProjectDetail = components["schemas"]["ProjectDetail"];
type ProjectListItem = components["schemas"]["ProjectListItem"];
type ProjectListEnvelope = components["schemas"]["ProjectListEnvelope"];
type ProjectGeography = components["schemas"]["ProjectGeography"];

const projectDetailInclude = {
  country: true,
  parties: {
    include: { account: true },
    orderBy: [{ primaryFlag: "desc" }, { createdAt: "asc" }, { id: "asc" }],
  },
} satisfies Prisma.ProjectInclude;

type ProjectWithDetail = Prisma.ProjectGetPayload<{
  include: typeof projectDetailInclude;
}>;

@Injectable()
export class ProjectService {
  constructor(
    @Inject(databaseClientToken) private readonly database: DatabaseClient,
    @Inject(transactionManagerToken)
    private readonly transactions: TransactionManager,
    @Inject(auditRepositoryToken) private readonly audit: AuditRepository,
    private readonly access: CustomerAccessService,
  ) {}

  async list(
    identity: CustomerIdentity,
    query: ProjectListQuery,
  ): Promise<ProjectListEnvelope> {
    this.access.requirePermission(identity, permissions.projectsView);
    const offset = query.offset ?? (query.page - 1) * query.limit;
    const where: Prisma.ProjectWhereInput = {
      countryCode: { in: [...identity.countryCodes] },
      ...(query.countryCode === undefined
        ? {}
        : { countryCode: query.countryCode }),
      ...(query.archiveState === "ALL"
        ? {}
        : { recordStatusCode: query.archiveState }),
      ...(query.accountId === undefined
        ? {}
        : { parties: { some: { accountId: query.accountId } } }),
      ...(query.stageCode === undefined ? {} : { stageCode: query.stageCode }),
      ...(query.search === undefined || query.search.trim() === ""
        ? {}
        : {
            OR: [
              { normalizedName: { contains: normalizeName(query.search) } },
              {
                projectRef: {
                  contains: query.search.trim(),
                  mode: "insensitive" as const,
                },
              },
              {
                city: {
                  contains: query.search.trim(),
                  mode: "insensitive" as const,
                },
              },
            ],
          }),
      AND: [{ OR: projectContextWhere(identity, "VIEW") }],
    };
    const [total, projects] = await this.database.$transaction([
      this.database.project.count({ where }),
      this.database.project.findMany({
        where,
        include: projectDetailInclude,
        orderBy: projectOrderBy(query.sort),
        skip: offset,
        take: query.limit,
      }),
    ]);
    return {
      data: projects.map(toListItem),
      meta: {
        page: Math.floor(offset / query.limit) + 1,
        offset,
        limit: query.limit,
        total,
        hasNext: offset + projects.length < total,
      },
    };
  }

  async get(
    identity: CustomerIdentity,
    projectId: string,
  ): Promise<ProjectDetail> {
    this.access.requirePermission(identity, permissions.projectsView);
    const project = await this.database.project.findFirst({
      where: viewableProjectWhere(identity, projectId),
      include: projectDetailInclude,
    });
    if (project === null) this.notFound();
    return toDetail(project);
  }

  async create(
    identity: CustomerIdentity,
    input: CreateProjectDto,
    idempotencyKey: string,
  ): Promise<ProjectDetail> {
    this.access.requireCountry(identity, input.countryCode);
    this.access.requirePermission(identity, permissions.projectsCreate);
    requireIdempotencyKey(idempotencyKey);
    const requestHash = hashJson({
      name: input.name,
      countryCode: input.countryCode,
      city: input.city ?? null,
      region: input.region ?? null,
      addressText: input.addressText ?? null,
      primaryAccountId: input.primaryAccountId,
      primaryRoleCode: input.primaryRoleCode,
    });
    const replay = await this.findIdempotency(
      identity,
      "PROJECT_CREATE",
      idempotencyKey,
      requestHash,
    );
    if (replay !== null) return this.get(identity, replay);

    const primaryAccount = await this.database.account.findFirst({
      where: {
        id: input.primaryAccountId,
        countryCode: { in: [...identity.countryCodes] },
        recordStatusCode: "ACTIVE",
        OR: accountContextWhere(identity, "COLLABORATE_EDIT"),
      },
    });
    if (primaryAccount === null) this.notFound();

    return this.transactions.run(identity, async (tx) => {
      await requireCountry(tx, input.countryCode);
      const project = await tx.project.create({
        data: {
          name: input.name.trim(),
          normalizedName: normalizeName(input.name),
          countryCode: input.countryCode,
          city: cleanOptional(input.city),
          region: cleanOptional(input.region),
          addressText: cleanOptional(input.addressText),
          commercialOwnerUserId: identity.userId,
          createdByUserId: identity.userId,
          updatedByUserId: identity.userId,
          parties: {
            create: {
              accountId: primaryAccount.id,
              roleCode: input.primaryRoleCode,
              primaryFlag: true,
            },
          },
        },
        include: projectDetailInclude,
      });
      await rememberIdempotency(
        tx,
        identity,
        "PROJECT_CREATE",
        idempotencyKey,
        requestHash,
        project.id,
      );
      const detail = toDetail(project);
      await this.appendAudit(
        tx,
        identity,
        "PROJECT_CREATED",
        project,
        null,
        detail,
        null,
      );
      return detail;
    });
  }

  async update(
    identity: CustomerIdentity,
    projectId: string,
    expectedTag: string,
    input: UpdateProjectDto,
  ): Promise<ProjectDetail> {
    this.access.requirePermission(identity, permissions.projectsEdit);
    const expectedVersion = parseRowVersion(expectedTag);
    const before = await this.database.project.findFirst({
      where: editableProjectWhere(identity, projectId),
      include: projectDetailInclude,
    });
    if (before === null) this.notFound();

    const outcome = await this.transactions.run(identity, async (tx) => {
      const changed = await tx.project.updateMany({
        where: {
          id: projectId,
          rowVersion: expectedVersion,
          recordStatusCode: "ACTIVE",
        },
        data: {
          ...(input.name == null
            ? {}
            : {
                name: input.name.trim(),
                normalizedName: normalizeName(input.name),
              }),
          ...(input.city === undefined
            ? {}
            : { city: cleanOptional(input.city) }),
          ...(input.region === undefined
            ? {}
            : { region: cleanOptional(input.region) }),
          ...(input.addressText === undefined
            ? {}
            : { addressText: cleanOptional(input.addressText) }),
          ...(input.stageCode === undefined
            ? {}
            : { stageCode: cleanOptional(input.stageCode) }),
          updatedByUserId: identity.userId,
          rowVersion: { increment: 1 },
        },
      });
      if (changed.count !== 1) {
        const current = await tx.project.findUnique({
          where: { id: projectId },
        });
        return { conflictVersion: current?.rowVersion } as const;
      }
      const updated = await tx.project.findUniqueOrThrow({
        where: { id: projectId },
        include: projectDetailInclude,
      });
      const detail = toDetail(updated);
      await this.appendAudit(
        tx,
        identity,
        "PROJECT_UPDATED",
        updated,
        toDetail(before),
        detail,
        null,
      );
      return { detail } as const;
    });
    if ("conflictVersion" in outcome) {
      this.concurrency(projectId, expectedTag, outcome.conflictVersion);
    }
    return outcome.detail;
  }

  async archive(
    identity: CustomerIdentity,
    projectId: string,
    expectedTag: string,
    idempotencyKey: string,
    input: ArchiveProjectDto,
  ): Promise<ProjectDetail> {
    this.access.requirePermission(identity, permissions.projectsArchive);
    requireIdempotencyKey(idempotencyKey);
    const expectedVersion = parseRowVersion(expectedTag);
    const requestHash = hashJson({
      projectId,
      expectedTag,
      reason: input.reason,
    });
    const replay = await this.findIdempotency(
      identity,
      "PROJECT_ARCHIVE",
      idempotencyKey,
      requestHash,
    );
    if (replay !== null) return this.get(identity, replay);
    const before = await this.database.project.findFirst({
      where: editableProjectWhere(identity, projectId),
      include: projectDetailInclude,
    });
    if (before === null) this.notFound();

    const outcome = await this.transactions.run(
      identity,
      async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT project_id FROM projects WHERE project_id = ${projectId}::uuid FOR UPDATE`,
        );
        const activeWork = await tx.projectWorkReference.count({
          where: { projectId, statusCode: "ACTIVE" },
        });
        if (activeWork > 0) {
          throw new ApiProblem({
            status: 409,
            code: "PROJECT_HAS_ACTIVE_WORK",
            ruleErrors: [
              {
                code: "PROJECT_ARCHIVE_ACTIVE_WORK",
                messageKey: "errors.project.archive_active_work",
                params: { activeWorkCount: activeWork },
              },
            ],
          });
        }
        const changed = await tx.project.updateMany({
          where: {
            id: projectId,
            rowVersion: expectedVersion,
            recordStatusCode: "ACTIVE",
          },
          data: {
            recordStatusCode: "ARCHIVED",
            archivedAt: new Date(),
            archivedByUserId: identity.userId,
            updatedByUserId: identity.userId,
            rowVersion: { increment: 1 },
          },
        });
        if (changed.count !== 1) {
          const current = await tx.project.findUnique({
            where: { id: projectId },
          });
          return { conflictVersion: current?.rowVersion } as const;
        }
        await rememberIdempotency(
          tx,
          identity,
          "PROJECT_ARCHIVE",
          idempotencyKey,
          requestHash,
          projectId,
        );
        const archived = await tx.project.findUniqueOrThrow({
          where: { id: projectId },
          include: projectDetailInclude,
        });
        const detail = toDetail(archived);
        await this.appendAudit(
          tx,
          identity,
          "PROJECT_ARCHIVED",
          archived,
          toDetail(before),
          detail,
          { reason: input.reason.trim() },
        );
        return { detail } as const;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    if ("conflictVersion" in outcome) {
      this.concurrency(projectId, expectedTag, outcome.conflictVersion);
    }
    return outcome.detail;
  }

  async addParty(
    identity: CustomerIdentity,
    projectId: string,
    key: string,
    input: AddProjectPartyDto,
  ) {
    this.access.requirePermission(identity, permissions.projectsEdit);
    requireIdempotencyKey(key);
    const project = await this.database.project.findFirst({
      where: editableProjectWhere(identity, projectId),
    });
    if (!project) this.notFound();
    const account = await this.database.account.findFirst({
      where: {
        id: input.accountId,
        countryCode: project.countryCode,
        recordStatusCode: "ACTIVE",
        OR: accountContextWhere(identity, "COLLABORATE_EDIT"),
      },
    });
    if (!account) this.notFound();
    const requestHash = hashJson({ projectId, input });
    const replay = await this.findIdempotency(
      identity,
      "PROJECT_PARTY_ADD",
      key,
      requestHash,
    );
    if (replay) {
      const row = await this.database.projectParty.findUnique({
        where: { id: replay },
      });
      if (!row) this.notFound();
      return { data: toParty(row), etag: formatRowVersion(row.rowVersion) };
    }
    return this.transactions.run(identity, async (tx) => {
      if (input.primaryFlag)
        await tx.projectParty.updateMany({
          where: { projectId, statusCode: "ACTIVE" },
          data: { primaryFlag: false, rowVersion: { increment: 1 } },
        });
      const existing = await tx.projectParty.findUnique({
        where: {
          projectId_accountId_roleCode: {
            projectId,
            accountId: input.accountId,
            roleCode: input.roleCode,
          },
        },
      });
      if (existing?.statusCode === "ACTIVE")
        throw new ApiProblem({ status: 409, code: "PROJECT_PARTY_EXISTS" });
      const row = existing
        ? await tx.projectParty.update({
            where: { id: existing.id },
            data: {
              statusCode: "ACTIVE",
              primaryFlag: input.primaryFlag,
              rowVersion: { increment: 1 },
            },
          })
        : await tx.projectParty.create({
            data: {
              projectId,
              accountId: input.accountId,
              roleCode: input.roleCode,
              primaryFlag: input.primaryFlag,
            },
          });
      await rememberIdempotency(
        tx,
        identity,
        "PROJECT_PARTY_ADD",
        key,
        requestHash,
        row.id,
      );
      await this.audit.append(tx, {
        actorUserId: identity.userId,
        actorSessionId: identity.sessionId,
        actionCode: "PROJECT_PARTY_ADDED",
        resourceType: "PROJECT_PARTY",
        resourceId: row.id,
        workspace: "SALES",
        countryCode: project.countryCode.trim(),
        afterSnapshot: toParty(row),
        traceId: identity.traceId,
        correlationId: identity.correlationId,
        source: "API",
      });
      return { data: toParty(row), etag: formatRowVersion(row.rowVersion) };
    });
  }

  async removeParty(
    identity: CustomerIdentity,
    partyId: string,
    tag: string,
    key: string,
  ) {
    this.access.requirePermission(identity, permissions.projectsEdit);
    requireIdempotencyKey(key);
    const expected = parseRowVersion(tag);
    const party = await this.database.projectParty.findFirst({
      where: { id: partyId, statusCode: "ACTIVE" },
      include: { project: true },
    });
    if (
      !party ||
      !(await this.database.project.findFirst({
        where: editableProjectWhere(identity, party.projectId),
      }))
    )
      this.notFound();
    const requestHash = hashJson({ partyId, tag });
    const replay = await this.findIdempotency(
      identity,
      "PROJECT_PARTY_REMOVE",
      key,
      requestHash,
    );
    if (replay)
      return {
        data: { success: true, resourceId: replay, statusCode: "ENDED" },
        etag: formatRowVersion(party.rowVersion),
      };
    const activeCount = await this.database.projectParty.count({
      where: { projectId: party.projectId, statusCode: "ACTIVE" },
    });
    if (activeCount <= 1)
      throw new ApiProblem({
        status: 409,
        code: "PROJECT_PRIMARY_PARTY_REQUIRED",
      });
    const changed = await this.database.projectParty.updateMany({
      where: { id: partyId, rowVersion: expected, statusCode: "ACTIVE" },
      data: {
        statusCode: "ENDED",
        primaryFlag: false,
        rowVersion: { increment: 1 },
      },
    });
    if (changed.count !== 1) this.concurrency(partyId, tag, party.rowVersion);
    const updated = await this.database.projectParty.findUniqueOrThrow({
      where: { id: partyId },
    });
    await this.transactions.run(identity, async (tx) => {
      await rememberIdempotency(
        tx,
        identity,
        "PROJECT_PARTY_REMOVE",
        key,
        requestHash,
        partyId,
      );
      await this.audit.append(tx, {
        actorUserId: identity.userId,
        actorSessionId: identity.sessionId,
        actionCode: "PROJECT_PARTY_ENDED",
        resourceType: "PROJECT_PARTY",
        resourceId: partyId,
        workspace: "SALES",
        countryCode: party.project.countryCode.trim(),
        beforeSnapshot: toParty(party),
        afterSnapshot: toParty(updated),
        traceId: identity.traceId,
        correlationId: identity.correlationId,
        source: "API",
      });
    });
    return {
      data: { success: true, resourceId: partyId, statusCode: "ENDED" },
      etag: formatRowVersion(updated.rowVersion),
    };
  }

  async addContactRole(
    identity: CustomerIdentity,
    partyId: string,
    key: string,
    input: AddProjectContactRoleDto,
  ) {
    this.access.requirePermission(identity, permissions.projectsEdit);
    requireIdempotencyKey(key);
    const party = await this.database.projectParty.findFirst({
      where: { id: partyId, statusCode: "ACTIVE" },
      include: { project: true },
    });
    if (
      !party ||
      !(await this.database.project.findFirst({
        where: editableProjectWhere(identity, party.projectId),
      }))
    )
      this.notFound();
    const contact = await this.database.contact.findFirst({
      where: {
        id: input.contactId,
        accountId: party.accountId,
        statusCode: "ACTIVE",
      },
    });
    if (!contact) this.notFound();
    const requestHash = hashJson({ partyId, input });
    const replay = await this.findIdempotency(
      identity,
      "PROJECT_CONTACT_ROLE_ADD",
      key,
      requestHash,
    );
    if (replay) {
      const row = await this.database.projectContactRole.findUnique({
        where: { id: replay },
      });
      if (!row) this.notFound();
      return toContactRole(row);
    }
    return this.transactions.run(identity, async (tx) => {
      const row = await tx.projectContactRole.create({
        data: {
          projectPartyId: partyId,
          contactId: input.contactId,
          roleCode: input.roleCode,
        },
      });
      await rememberIdempotency(
        tx,
        identity,
        "PROJECT_CONTACT_ROLE_ADD",
        key,
        requestHash,
        row.id,
      );
      await this.audit.append(tx, {
        actorUserId: identity.userId,
        actorSessionId: identity.sessionId,
        actionCode: "PROJECT_CONTACT_ROLE_ADDED",
        resourceType: "PROJECT_CONTACT_ROLE",
        resourceId: row.id,
        workspace: "SALES",
        countryCode: party.project.countryCode.trim(),
        afterSnapshot: toContactRole(row),
        traceId: identity.traceId,
        correlationId: identity.correlationId,
        source: "API",
      });
      return toContactRole(row);
    });
  }

  private async findIdempotency(
    identity: CustomerIdentity,
    operationCode: string,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<string | null> {
    const existing = await this.database.commandIdempotency.findUnique({
      where: {
        actorUserId_operationCode_idempotencyKey: {
          actorUserId: identity.userId,
          operationCode,
          idempotencyKey,
        },
      },
    });
    if (existing === null) return null;
    if (existing.requestHash !== requestHash) {
      throw new ApiProblem({ status: 409, code: "IDEMPOTENCY_KEY_REUSED" });
    }
    return existing.responseResourceId;
  }

  private async appendAudit(
    tx: TransactionClient,
    identity: CustomerIdentity,
    actionCode: string,
    project: ProjectWithDetail,
    before: ProjectDetail | null,
    after: ProjectDetail,
    metadata: Readonly<Record<string, unknown>> | null,
  ): Promise<void> {
    await this.audit.append(tx, {
      actorUserId: identity.userId,
      actorSessionId: identity.sessionId,
      actionCode,
      resourceType: "PROJECT",
      resourceId: project.id,
      workspace: "SALES",
      countryCode: project.countryCode.trim(),
      beforeSnapshot: before,
      afterSnapshot: after,
      metadata,
      traceId: identity.traceId,
      correlationId: identity.correlationId,
      source: "API",
    });
  }

  private concurrency(
    projectId: string,
    expected: string,
    current?: bigint,
  ): never {
    throw new ApiProblem({
      status: 412,
      code: "CONCURRENCY_CONFLICT",
      conflict: {
        currentRowVersion:
          current === undefined ? "rv-unknown" : formatRowVersion(current),
        expectedRowVersion: expected,
        resource: { resourceType: "PROJECT", resourceId: projectId },
      },
    });
  }

  private notFound(): never {
    throw new ApiProblem({ status: 404, code: "RESOURCE_NOT_FOUND" });
  }
}

function viewableProjectWhere(
  identity: CustomerIdentity,
  projectId: string,
): Prisma.ProjectWhereInput {
  return {
    id: projectId,
    countryCode: { in: [...identity.countryCodes] },
    AND: [{ OR: projectContextWhere(identity, "VIEW") }],
  };
}

function toParty(row: {
  id: string;
  projectId: string;
  accountId: string;
  roleCode: string;
  primaryFlag: boolean;
}) {
  return {
    projectPartyId: row.id,
    projectId: row.projectId,
    accountId: row.accountId,
    roleCode: row.roleCode,
    primaryFlag: row.primaryFlag,
  };
}

function toContactRole(row: {
  id: string;
  projectPartyId: string;
  contactId: string;
  roleCode: string;
}) {
  return {
    projectContactRoleId: row.id,
    projectPartyId: row.projectPartyId,
    contactId: row.contactId,
    roleCode: row.roleCode,
  };
}

function editableProjectWhere(
  identity: CustomerIdentity,
  projectId: string,
): Prisma.ProjectWhereInput {
  return {
    id: projectId,
    recordStatusCode: "ACTIVE",
    countryCode: { in: [...identity.countryCodes] },
    AND: [{ OR: projectContextWhere(identity, "COLLABORATE_EDIT") }],
  };
}

export function projectContextWhere(
  identity: CustomerIdentity,
  accessLevel: "VIEW" | "COLLABORATE_EDIT",
): Prisma.ProjectWhereInput[] {
  // `[{}]` inside an `OR` array matches nothing in Prisma, not everything —
  // `{ id: { not: "00000000-0000-0000-0000-000000000000" } }` is the always-true fix.
  if (isSystemAdmin(identity))
    return [{ id: { not: "00000000-0000-0000-0000-000000000000" } }];
  const userId = identity.userId;
  return [
    { commercialOwnerUserId: userId },
    ...(canUseManagerContext(identity)
      ? [{ commercialOwner: { profile: { is: { managerUserId: userId } } } }]
      : []),
    {
      parties: {
        some: { account: { OR: accountContextWhere(identity, accessLevel) } },
      },
    },
  ];
}

function accountContextWhere(
  identity: CustomerIdentity,
  accessLevel: "VIEW" | "COLLABORATE_EDIT",
): Prisma.AccountWhereInput[] {
  // `[{}]` inside an `OR` array matches nothing in Prisma, not everything —
  // `{ id: { not: "00000000-0000-0000-0000-000000000000" } }` is the always-true fix.
  if (isSystemAdmin(identity))
    return [{ id: { not: "00000000-0000-0000-0000-000000000000" } }];
  const userId = identity.userId;
  const now = new Date();
  const levels =
    accessLevel === "VIEW"
      ? ["VIEW", "COLLABORATE_EDIT"]
      : ["COLLABORATE_EDIT"];
  return [
    { ownerUserId: userId },
    ...(canUseManagerContext(identity)
      ? [{ owner: { profile: { is: { managerUserId: userId } } } }]
      : []),
    {
      shares: {
        some: {
          recipientUserId: userId,
          statusCode: "ACTIVE",
          accessLevelCode: { in: levels },
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
      },
    },
  ];
}

function toListItem(project: ProjectWithDetail): ProjectListItem {
  const primary = primaryParty(project);
  return {
    projectId: project.id,
    projectRef: project.projectRef,
    name: project.name,
    geography: toGeography(project.country),
    primaryAccount: toAccountReference(primary.account),
    city: project.city,
    region: project.region,
    stageCode: project.stageCode,
    commercialOwnerUserId: project.commercialOwnerUserId,
    recordStatusCode: toRecordStatus(project.recordStatusCode),
    updatedAt: project.updatedAt.toISOString(),
  };
}

function toDetail(project: ProjectWithDetail): ProjectDetail {
  return {
    projectId: project.id,
    projectRef: project.projectRef,
    name: project.name,
    geography: toGeography(project.country),
    city: project.city,
    region: project.region,
    addressText: project.addressText,
    stageCode: project.stageCode,
    commercialOwnerUserId: project.commercialOwnerUserId,
    parties: project.parties.map((party) => ({
      projectPartyId: party.id,
      account: toAccountReference(party.account),
      roleCode: party.roleCode,
      primaryFlag: party.primaryFlag,
      // The party's own concurrency token, not the project's. Removing a party
      // takes it in If-Match, so leaving it off the response made that
      // endpoint impossible to call correctly from any client.
      rowVersion: formatRowVersion(party.rowVersion),
    })),
    recordStatusCode: toRecordStatus(project.recordStatusCode),
    archivedAt: project.archivedAt?.toISOString() ?? null,
    rowVersion: formatRowVersion(project.rowVersion),
  };
}

function primaryParty(project: ProjectWithDetail) {
  const primary = project.parties.find(({ primaryFlag }) => primaryFlag);
  if (primary === undefined) throw new Error("PROJECT_PRIMARY_PARTY_MISSING");
  return primary;
}

function toAccountReference(account: {
  id: string;
  accountRef: string;
  canonicalName: string;
}) {
  return {
    accountId: account.id,
    accountRef: account.accountRef,
    canonicalName: account.canonicalName,
  };
}

function toGeography(country: {
  code: string;
  name: string;
  continentCode: string;
}): ProjectGeography {
  return {
    country: {
      countryCode: country.code.trim(),
      displayName: country.name,
      continent: toContinent(country.continentCode),
      marketScope: classifyMarketScope(country.code),
    },
    continent: toContinent(country.continentCode),
    marketScope: classifyMarketScope(country.code),
  };
}

function projectOrderBy(
  sort: string,
): Prisma.ProjectOrderByWithRelationInput[] {
  const [field, direction] = sort.split(":") as [string, "asc" | "desc"];
  return [{ [field]: direction }, { id: "asc" }];
}

function normalizeName(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("en");
}

function cleanOptional(value: string | null | undefined): string | null {
  if (value == null) return null;
  const cleaned = value.trim();
  return cleaned === "" ? null : cleaned;
}

function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function formatRowVersion(value: bigint): string {
  return `"rv-${value.toString()}"`;
}

function parseRowVersion(value: string): bigint {
  const match = /^"rv-([1-9][0-9]*)"$/.exec(value);
  if (match?.[1] === undefined) {
    throw new ApiProblem({ status: 400, code: "INVALID_IF_MATCH" });
  }
  return BigInt(match[1]);
}

function requireIdempotencyKey(value: string): void {
  if (value.length < 8 || value.length > 200) {
    throw new ApiProblem({ status: 400, code: "INVALID_IDEMPOTENCY_KEY" });
  }
}

async function requireCountry(
  tx: TransactionClient,
  code: string,
): Promise<void> {
  const country = await tx.country.findFirst({ where: { code, active: true } });
  if (country === null) {
    throw new ApiProblem({ status: 422, code: "UNKNOWN_COUNTRY" });
  }
}

async function rememberIdempotency(
  tx: TransactionClient,
  identity: CustomerIdentity,
  operationCode: string,
  idempotencyKey: string,
  requestHash: string,
  responseResourceId: string,
): Promise<void> {
  await tx.commandIdempotency.create({
    data: {
      actorUserId: identity.userId,
      operationCode,
      idempotencyKey,
      requestHash,
      responseResourceId,
    },
  });
}

function toContinent(value: string): ProjectGeography["continent"] {
  const allowed = new Set([
    "AFRICA",
    "ASIA",
    "EUROPE",
    "NORTH_AMERICA",
    "SOUTH_AMERICA",
    "OCEANIA",
  ]);
  if (!allowed.has(value)) throw new Error("INVALID_CONTINENT_IN_DATABASE");
  return value as ProjectGeography["continent"];
}

function toRecordStatus(value: string): "ACTIVE" | "ARCHIVED" {
  if (value !== "ACTIVE" && value !== "ARCHIVED") {
    throw new Error("INVALID_PROJECT_STATUS_IN_DATABASE");
  }
  return value;
}
