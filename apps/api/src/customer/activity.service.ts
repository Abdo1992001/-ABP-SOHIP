import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { permissions } from "@abp/contracts";
import {
  AuditRepository,
  type DatabaseClient,
  TransactionManager,
} from "@abp/database";
import { ApiProblem } from "../platform/api-exception.filter.js";
import {
  auditRepositoryToken,
  databaseClientToken,
  transactionManagerToken,
} from "../platform/database.providers.js";
import {
  canUseManagerContext,
  isSystemAdmin,
  type CustomerIdentity,
} from "./customer-auth.js";
import { CustomerAccessService } from "./customer-access.service.js";
import type { ActivityListQuery, CreateActivityDto } from "./activity.dto.js";
import type { CompleteActivityDto } from "./activity.dto.js";
import type { RescheduleActivityDto } from "./activity.dto.js";
import type { UpdateActivityDto } from "./activity.dto.js";

@Injectable()
export class ActivityService {
  constructor(
    @Inject(databaseClientToken) private readonly db: DatabaseClient,
    @Inject(transactionManagerToken) private readonly txs: TransactionManager,
    @Inject(auditRepositoryToken) private readonly audit: AuditRepository,
    private readonly access: CustomerAccessService,
  ) {}
  async list(identity: CustomerIdentity, query: ActivityListQuery) {
    this.access.requirePermission(identity, permissions.activitiesView);
    // A meeting carries scheduledAt, a task carries dueAt. Filtering on dueAt
    // alone hid every meeting from the calendar, which is exactly the thing a
    // calendar exists to show — so a date window matches either column.
    const window = {
      ...(query.dueFrom ? { gte: new Date(query.dueFrom) } : {}),
      ...(query.dueTo ? { lt: new Date(query.dueTo) } : {}),
    };
    const where = {
      ...activityScope(identity, query.accountId),
      // Nested under AND, never spread as a second `OR`: activityScope already
      // uses `OR` for the ownership scope, and a sibling `OR` would replace it
      // and quietly widen who can see whose activities.
      ...(query.dueFrom || query.dueTo
        ? { AND: [{ OR: [{ dueAt: window }, { scheduledAt: window }] }] }
        : {}),
    };
    const [total, rows] = await this.db.$transaction([
      this.db.activity.count({ where }),
      this.db.activity.findMany({
        where,
        orderBy: [{ dueAt: "asc" }, { id: "asc" }],
        skip: query.offset,
        take: query.limit,
        include: { links: true },
      }),
    ]);
    return {
      data: rows.map(map),
      meta: {
        offset: query.offset,
        limit: query.limit,
        total,
        hasNext: query.offset + rows.length < total,
      },
    };
  }
  async get(identity: CustomerIdentity, id: string) {
    this.access.requirePermission(identity, permissions.activitiesView);
    const row = await this.db.activity.findFirst({
      where: { ...activityScope(identity), id },
      include: { links: true },
    });
    if (!row) throw new ApiProblem({ status: 404, code: "RESOURCE_NOT_FOUND" });
    return map(row);
  }
  async complete(
    identity: CustomerIdentity,
    id: string,
    key: string,
    input: CompleteActivityDto,
  ) {
    this.access.requirePermission(identity, permissions.activitiesEdit);
    if (key.length < 8)
      throw new ApiProblem({ status: 400, code: "INVALID_IDEMPOTENCY_KEY" });
    const version = parseEtag(input.expectedRowVersion);
    const requestHash = hashRequest({
      id,
      rowVersion: input.expectedRowVersion,
      input,
    });
    const replay = await this.findReplay(
      identity,
      "ACTIVITY_COMPLETE",
      key,
      requestHash,
    );
    if (replay) return this.get(identity, replay);
    const before = await this.db.activity.findFirst({
      where: { ...activityScope(identity), id },
    });
    if (!before)
      throw new ApiProblem({ status: 404, code: "RESOURCE_NOT_FOUND" });
    if (before.taskStatusCode !== "OPEN")
      throw new ApiProblem({ status: 409, code: "ACTIVITY_NOT_COMPLETABLE" });
    return this.txs.run(identity, async (tx) => {
      const result = await tx.activity.updateMany({
        where: { id, rowVersion: version },
        data: {
          taskStatusCode: "COMPLETED",
          completedAt: new Date(),
          notes: input.notes ?? before.notes,
          outcomeCode: input.outcomeCode ?? before.outcomeCode,
          rowVersion: { increment: 1 },
        },
      });
      if (result.count !== 1)
        throw new ApiProblem({ status: 412, code: "CONCURRENCY_CONFLICT" });
      await tx.activityHistory.create({
        data: {
          activityId: id,
          eventCode: "ACTIVITY_COMPLETED",
          reason: input.outcomeCode ?? null,
          actorUserId: identity.userId,
        },
      });
      await tx.commandIdempotency.create({
        data: idempotencyData(
          identity,
          "ACTIVITY_COMPLETE",
          key,
          requestHash,
          id,
        ),
      });
      const after = map(
        await tx.activity.findUniqueOrThrow({
          where: { id },
          include: { links: true },
        }),
      );
      await this.audit.append(
        tx,
        auditEvent(
          identity,
          "ACTIVITY_COMPLETED",
          id,
          before.countryCode,
          map(before),
          after,
        ),
      );
      return after;
    });
  }
  async reschedule(
    identity: CustomerIdentity,
    id: string,
    key: string,
    input: RescheduleActivityDto,
  ) {
    this.access.requirePermission(identity, permissions.activitiesEdit);
    if (key.length < 8)
      throw new ApiProblem({ status: 400, code: "INVALID_IDEMPOTENCY_KEY" });
    const version = parseEtag(input.expectedRowVersion);
    const requestHash = hashRequest({
      id,
      rowVersion: input.expectedRowVersion,
      input,
    });
    const replay = await this.findReplay(
      identity,
      "ACTIVITY_RESCHEDULE",
      key,
      requestHash,
    );
    if (replay) return this.get(identity, replay);
    const before = await this.db.activity.findFirst({
      where: { ...activityScope(identity), id },
    });
    if (!before)
      throw new ApiProblem({ status: 404, code: "RESOURCE_NOT_FOUND" });
    if (before.taskStatusCode !== "OPEN")
      throw new ApiProblem({ status: 409, code: "ACTIVITY_NOT_RESCHEDULABLE" });
    return this.txs.run(identity, async (tx) => {
      const result = await tx.activity.updateMany({
        where: { id, rowVersion: version },
        data: { dueAt: new Date(input.newDueAt), rowVersion: { increment: 1 } },
      });
      if (result.count !== 1)
        throw new ApiProblem({ status: 412, code: "CONCURRENCY_CONFLICT" });
      await tx.activityHistory.create({
        data: {
          activityId: id,
          eventCode: "ACTIVITY_RESCHEDULED",
          reason: input.reason ?? null,
          actorUserId: identity.userId,
        },
      });
      await tx.commandIdempotency.create({
        data: idempotencyData(
          identity,
          "ACTIVITY_RESCHEDULE",
          key,
          requestHash,
          id,
        ),
      });
      const after = map(
        await tx.activity.findUniqueOrThrow({
          where: { id },
          include: { links: true },
        }),
      );
      await this.audit.append(
        tx,
        auditEvent(
          identity,
          "ACTIVITY_RESCHEDULED",
          id,
          before.countryCode,
          map(before),
          after,
        ),
      );
      return after;
    });
  }
  async update(
    identity: CustomerIdentity,
    id: string,
    tag: string,
    input: UpdateActivityDto,
  ) {
    this.access.requirePermission(identity, permissions.activitiesEdit);
    const version = parseEtag(tag);
    const before = await this.db.activity.findFirst({
      where: { ...activityScope(identity), id },
    });
    if (!before)
      throw new ApiProblem({ status: 404, code: "RESOURCE_NOT_FOUND" });
    if (
      before.taskStatusCode === "COMPLETED" ||
      before.taskStatusCode === "CANCELLED"
    )
      throw new ApiProblem({ status: 409, code: "ACTIVITY_IMMUTABLE" });
    return this.txs.run(identity, async (tx) => {
      const changed = await tx.activity.updateMany({
        where: { id, rowVersion: version },
        data: {
          ...(input.subject !== undefined ? { subject: input.subject } : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          ...(input.scheduledAt !== undefined
            ? {
                scheduledAt: input.scheduledAt
                  ? new Date(input.scheduledAt)
                  : null,
              }
            : {}),
          ...(input.dueAt !== undefined
            ? { dueAt: input.dueAt ? new Date(input.dueAt) : null }
            : {}),
          ...(input.outcomeCode !== undefined
            ? { outcomeCode: input.outcomeCode }
            : {}),
          rowVersion: { increment: 1 },
        },
      });
      if (changed.count !== 1)
        throw new ApiProblem({ status: 412, code: "CONCURRENCY_CONFLICT" });
      await tx.activityHistory.create({
        data: {
          activityId: id,
          eventCode: "ACTIVITY_UPDATED",
          actorUserId: identity.userId,
        },
      });
      const after = map(
        await tx.activity.findUniqueOrThrow({
          where: { id },
          include: { links: true },
        }),
      );
      await this.audit.append(
        tx,
        auditEvent(
          identity,
          "ACTIVITY_UPDATED",
          id,
          before.countryCode,
          map(before),
          after,
        ),
      );
      return after;
    });
  }
  async create(
    identity: CustomerIdentity,
    input: CreateActivityDto,
    key: string,
  ) {
    this.access.requirePermission(identity, permissions.activitiesCreate);
    if (key.length < 8 || key.length > 200)
      throw new ApiProblem({ status: 400, code: "INVALID_IDEMPOTENCY_KEY" });
    const requestHash = hashRequest(input);
    const replay = await this.findReplay(
      identity,
      "ACTIVITY_CREATE",
      key,
      requestHash,
    );
    if (replay) return this.get(identity, replay);
    const primary =
      input.links.find((link) => link.isPrimary) ?? input.links[0];
    if (!primary || primary.resourceTypeCode.toUpperCase() !== "ACCOUNT")
      throw new ApiProblem({
        status: 422,
        code: "PRIMARY_ACCOUNT_LINK_REQUIRED",
      });
    const account = await this.db.account.findFirst({
      where: {
        id: primary.resourceId,
        countryCode: { in: [...identity.countryCodes] },
        recordStatusCode: "ACTIVE",
        OR: [
          { ownerUserId: identity.userId },
          ...(canUseManagerContext(identity)
            ? [
                {
                  owner: {
                    profile: { is: { managerUserId: identity.userId } },
                  },
                },
              ]
            : []),
        ],
      },
    });
    if (!account)
      throw new ApiProblem({ status: 404, code: "RESOURCE_NOT_FOUND" });
    return this.txs.run(identity, async (tx) => {
      const row = await tx.activity.create({
        data: {
          accountId: account.id,
          countryCode: account.countryCode,
          ownerUserId: identity.userId,
          typeCode: input.typeCode.trim().toUpperCase(),
          subject: input.subject ?? null,
          notes: input.notes ?? null,
          occurredAt: input.occurredAt ? new Date(input.occurredAt) : null,
          scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
          dueAt: input.dueAt ? new Date(input.dueAt) : null,
          taskStatusCode: input.dueAt ? "OPEN" : null,
          links: {
            create: input.links.map((link) => ({
              resourceTypeCode: link.resourceTypeCode.trim().toUpperCase(),
              resourceId: link.resourceId,
              isPrimary: link.isPrimary ?? false,
            })),
          },
          history: {
            create: {
              eventCode: "ACTIVITY_CREATED",
              actorUserId: identity.userId,
            },
          },
        },
        include: { links: true },
      });
      const out = map(row);
      await tx.commandIdempotency.create({
        data: idempotencyData(
          identity,
          "ACTIVITY_CREATE",
          key,
          requestHash,
          row.id,
        ),
      });
      await this.audit.append(tx, {
        actorUserId: identity.userId,
        actorSessionId: identity.sessionId,
        actionCode: "ACTIVITY_CREATED",
        resourceType: "ACTIVITY",
        resourceId: row.id,
        workspace: "SALES",
        countryCode: row.countryCode.trim(),
        beforeSnapshot: null,
        afterSnapshot: out,
        metadata: null,
        traceId: identity.traceId,
        correlationId: identity.correlationId,
        source: "API",
      });
      return out;
    });
  }
  async cancel(
    identity: CustomerIdentity,
    id: string,
    tag: string,
    key: string,
    reason: string,
  ) {
    this.access.requirePermission(identity, permissions.activitiesCancel);
    if (key.length < 8 || key.length > 200)
      throw new ApiProblem({ status: 400, code: "INVALID_IDEMPOTENCY_KEY" });
    const version = parseEtag(tag);
    const before = await this.db.activity.findFirst({
      where: {
        id,
        countryCode: { in: [...identity.countryCodes] },
        OR: [
          { ownerUserId: identity.userId },
          { account: { ownerUserId: identity.userId } },
          ...(canUseManagerContext(identity)
            ? [
                {
                  account: {
                    owner: {
                      profile: { is: { managerUserId: identity.userId } },
                    },
                  },
                },
              ]
            : []),
        ],
      },
      include: { reminders: true },
    });
    if (!before)
      throw new ApiProblem({ status: 404, code: "RESOURCE_NOT_FOUND" });
    if (
      before.taskStatusCode === "COMPLETED" ||
      before.taskStatusCode === "CANCELLED"
    )
      throw new ApiProblem({ status: 409, code: "ACTIVITY_NOT_CANCELLABLE" });
    const requestHash = hashRequest({ id, tag, reason });
    const replay = await this.findReplay(
      identity,
      "ACTIVITY_CANCEL",
      key,
      requestHash,
    );
    if (replay) return this.get(identity, replay);
    return this.txs.run(identity, async (tx) => {
      const changed = await tx.activity.updateMany({
        where: { id, rowVersion: version },
        data: {
          taskStatusCode: "CANCELLED",
          cancelledAt: new Date(),
          cancelReason: reason.trim(),
          rowVersion: { increment: 1 },
        },
      });
      if (changed.count !== 1)
        throw new ApiProblem({
          status: 412,
          code: "CONCURRENCY_CONFLICT",
          conflict: {
            currentRowVersion: '"rv-unknown"',
            expectedRowVersion: tag,
            resource: { resourceType: "ACTIVITY", resourceId: id },
          },
        });
      await tx.activityReminder.updateMany({
        where: { activityId: id, statusCode: "ACTIVE" },
        data: { statusCode: "CANCELLED", cancelledAt: new Date() },
      });
      await tx.activityHistory.create({
        data: {
          activityId: id,
          eventCode: "ACTIVITY_CANCELLED",
          reason: reason.trim(),
          actorUserId: identity.userId,
        },
      });
      await tx.commandIdempotency.create({
        data: idempotencyData(
          identity,
          "ACTIVITY_CANCEL",
          key,
          requestHash,
          id,
        ),
      });
      const row = await tx.activity.findUniqueOrThrow({
        where: { id },
        include: { links: true },
      });
      const out = map(row);
      await this.audit.append(tx, {
        actorUserId: identity.userId,
        actorSessionId: identity.sessionId,
        actionCode: "ACTIVITY_CANCELLED",
        resourceType: "ACTIVITY",
        resourceId: id,
        workspace: "SALES",
        countryCode: row.countryCode.trim(),
        beforeSnapshot: map(before),
        afterSnapshot: out,
        metadata: { reason: reason.trim(), remindersCancelled: true },
        traceId: identity.traceId,
        correlationId: identity.correlationId,
        source: "API",
      });
      return out;
    });
  }
  private async findReplay(
    identity: CustomerIdentity,
    operationCode: string,
    key: string,
    requestHash: string,
  ) {
    const prior = await this.db.commandIdempotency.findUnique({
      where: {
        actorUserId_operationCode_idempotencyKey: {
          actorUserId: identity.userId,
          operationCode,
          idempotencyKey: key,
        },
      },
    });
    if (!prior) return null;
    if (prior.requestHash !== requestHash)
      throw new ApiProblem({ status: 409, code: "IDEMPOTENCY_KEY_REUSED" });
    return prior.responseResourceId;
  }
}
function activityScope(identity: CustomerIdentity, accountId?: string) {
  const base = {
    countryCode: { in: [...identity.countryCodes] },
    ...(accountId ? { accountId } : {}),
  };
  if (isSystemAdmin(identity)) return base;
  return {
    ...base,
    OR: [
      { ownerUserId: identity.userId },
      { account: { ownerUserId: identity.userId } },
      ...(canUseManagerContext(identity)
        ? [
            {
              account: {
                owner: {
                  profile: { is: { managerUserId: identity.userId } },
                },
              },
            },
          ]
        : []),
    ],
  };
}
function parseEtag(value: string) {
  const found = /^"rv-([1-9][0-9]*)"$/.exec(value);
  const version = found?.[1];
  if (!version) throw new ApiProblem({ status: 400, code: "INVALID_IF_MATCH" });
  return BigInt(version);
}
function map(row: {
  id: string;
  countryCode: string;
  ownerUserId: string;
  typeCode: string;
  subject: string | null;
  notes: string | null;
  occurredAt: Date | null;
  scheduledAt: Date | null;
  dueAt: Date | null;
  taskStatusCode: string | null;
  outcomeCode: string | null;
  completedAt: Date | null;
  rowVersion: bigint;
  links?: {
    resourceTypeCode: string;
    resourceId: string;
    isPrimary: boolean;
  }[];
}) {
  return {
    activityId: row.id,
    countryCode: row.countryCode.trim(),
    ownerUserId: row.ownerUserId,
    typeCode: row.typeCode,
    subject: row.subject,
    notes: row.notes,
    occurredAt: row.occurredAt?.toISOString() ?? null,
    scheduledAt: row.scheduledAt?.toISOString() ?? null,
    dueAt: row.dueAt?.toISOString() ?? null,
    taskStatusCode: row.taskStatusCode,
    outcomeCode: row.outcomeCode,
    completedAt: row.completedAt?.toISOString() ?? null,
    // Without these a follow-up can be filed against a quotation but nothing
    // can ever show which quotation it is about.
    links: (row.links ?? []).map((link) => ({
      resourceTypeCode: link.resourceTypeCode,
      resourceId: link.resourceId,
      isPrimary: link.isPrimary,
    })),
    rowVersion: `"rv-${row.rowVersion.toString()}"`,
  };
}
function hashRequest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function idempotencyData(
  identity: CustomerIdentity,
  operationCode: string,
  key: string,
  requestHash: string,
  resourceId: string,
) {
  return {
    actorUserId: identity.userId,
    operationCode,
    idempotencyKey: key,
    requestHash,
    responseResourceId: resourceId,
  };
}
function auditEvent(
  identity: CustomerIdentity,
  actionCode: string,
  resourceId: string,
  countryCode: string,
  beforeSnapshot: ReturnType<typeof map>,
  afterSnapshot: ReturnType<typeof map>,
) {
  return {
    actorUserId: identity.userId,
    actorSessionId: identity.sessionId,
    actionCode,
    resourceType: "ACTIVITY",
    resourceId,
    workspace: "SALES",
    countryCode: countryCode.trim(),
    beforeSnapshot,
    afterSnapshot,
    metadata: null,
    traceId: identity.traceId,
    correlationId: identity.correlationId,
    source: "API" as const,
  };
}
