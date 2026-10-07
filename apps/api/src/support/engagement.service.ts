import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import {
  type DatabaseClient,
  type Prisma,
  type TransactionClient,
  type TransactionManager,
} from "@abp/database";
import { ApiProblem } from "../platform/api-exception.filter.js";
import { AuditService } from "../platform/audit.service.js";
import {
  databaseClientToken,
  transactionManagerToken,
} from "../platform/database.providers.js";
import {
  hasWorkspace,
  isSystemAdmin,
  type CustomerIdentity,
} from "../customer/customer-auth.js";
import {
  findMove,
  isLate,
  mayMake,
  missingFields,
  movesFor,
  stageDueAt,
} from "./complaint-flow.js";
import type {
  ComplaintListQuery,
  ComplaintTransitionDto,
  CreateComplaintDto,
  GroupMembershipDto,
  PageQuery,
  UpdateComplaintDto,
} from "./engagement.dto.js";

@Injectable()
export class EngagementService {
  constructor(
    @Inject(databaseClientToken) private readonly db: DatabaseClient,
    @Inject(transactionManagerToken) private readonly txs: TransactionManager,
    private readonly audit: AuditService,
  ) {}
  groups(i: CustomerIdentity, q: PageQuery) {
    this.require(i, "groups.view");
    const skip = q.offset ?? (q.page - 1) * q.limit;
    const where = {
      ...(q.search
        ? {
            OR: [
              {
                groupCode: { contains: q.search, mode: "insensitive" as const },
              },
              { name: { contains: q.search, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };
    return this.db
      .$transaction([
        this.db.groupNetwork.count({ where }),
        this.db.groupNetwork.findMany({
          where,
          skip,
          take: q.limit,
          orderBy: [{ name: "asc" }, { id: "asc" }],
        }),
      ])
      .then(([total, rows]) => ({
        data: rows.map(group),
        meta: meta(skip, q.limit, total, rows.length),
      }));
  }
  async addMembership(
    i: CustomerIdentity,
    groupId: string,
    key: string,
    b: GroupMembershipDto,
  ) {
    this.require(i, "groups.manage");
    needKey(key);
    const g = await this.db.groupNetwork.findFirst({
      where: { id: groupId, active: true },
    });
    if (!g) missing();
    const a = await this.account(i, b.accountId);
    const from = b.validFrom ? new Date(b.validFrom) : null,
      to = b.validTo ? new Date(b.validTo) : null;
    if (from && to && to < from) rule("INVALID_EFFECTIVE_RANGE");
    const h = hash({ groupId, b }),
      replay = await this.findReplay(i, "GROUP_MEMBERSHIP_ADD", key, h);
    if (replay) {
      const row = await this.db.accountGroupMembership.findUnique({
        where: { id: replay },
      });
      if (!row) missing();
      return { data: membership(row) };
    }
    return this.txs.run(i, async (tx) => {
      const row = await tx.accountGroupMembership.create({
        data: {
          groupNetworkId: groupId,
          accountId: a.id,
          validFrom: from,
          validTo: to,
          sourceRef: b.sourceRef ?? null,
          createdByUserId: i.userId,
        },
      });
      await remember(tx, i, "GROUP_MEMBERSHIP_ADD", key, h, row.id);
      await this.record(
        tx,
        i,
        "GROUP_MEMBERSHIP_ADDED",
        "GROUP_MEMBERSHIP",
        row.id,
        a.countryCode,
        membership(row),
      );
      return { data: membership(row) };
    });
  }
  async endMembership(
    i: CustomerIdentity,
    id: string,
    tag: string,
    key: string,
  ) {
    this.require(i, "groups.manage");
    needKey(key);
    const expected = etag(tag),
      row = await this.db.accountGroupMembership.findUnique({
        where: { id },
        include: { account: true },
      });
    if (!row || !i.countryCodes.has(row.account.countryCode.trim())) missing();
    const h = hash({ id, tag }),
      replay = await this.findReplay(i, "GROUP_MEMBERSHIP_END", key, h);
    if (replay)
      return {
        data: { success: true, resourceId: replay, statusCode: "ENDED" },
        etag: `\"rv-${expected}\"`,
      };
    const currentTag = BigInt(Math.floor(row.createdAt.getTime() / 1000));
    if (expected !== currentTag) precondition();
    const ended = await this.db.accountGroupMembership.update({
      where: { id },
      data: { validTo: new Date() },
    });
    await this.txs.run(i, async (tx) => {
      await remember(tx, i, "GROUP_MEMBERSHIP_END", key, h, id);
      await this.record(
        tx,
        i,
        "GROUP_MEMBERSHIP_ENDED",
        "GROUP_MEMBERSHIP",
        id,
        row.account.countryCode,
        membership(ended),
      );
    });
    return {
      data: { success: true, resourceId: id, statusCode: "ENDED" },
      etag: `\"rv-${BigInt(Math.floor(ended.createdAt.getTime() / 1000))}\"`,
    };
  }
  async complaints(i: CustomerIdentity, q: ComplaintListQuery) {
    this.requireComplaints(i, "complaints.view");
    const skip = q.offset ?? (q.page - 1) * q.limit;
    const where: Prisma.ComplaintWhereInput = {
      ...(q.accountId ? { accountId: q.accountId } : {}),
      ...(q.statusCode ? { statusCode: q.statusCode } : {}),
      ...(q.assignedToMe === "true" ? { assigneeUserId: i.userId } : {}),
      ...(q.overdue === "true"
        ? { statusCode: { not: "CLOSED" }, stageDueAt: { lt: new Date() } }
        : {}),
      countryCode: { in: [...i.countryCodes] },
      AND: [
        { OR: complaintContext(i) },
        ...(q.search
          ? [
              {
                OR: [
                  {
                    complaintRef: {
                      contains: q.search,
                      mode: "insensitive" as const,
                    },
                  },
                  {
                    description: {
                      contains: q.search,
                      mode: "insensitive" as const,
                    },
                  },
                  {
                    account: {
                      canonicalName: {
                        contains: q.search,
                        mode: "insensitive" as const,
                      },
                    },
                  },
                ],
              },
            ]
          : []),
      ],
    };
    const [total, rows] = await this.db.$transaction([
      this.db.complaint.count({ where }),
      this.db.complaint.findMany({
        where,
        skip,
        take: q.limit,
        include: { account: { select: { canonicalName: true } } },
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      }),
    ]);
    const names = await this.userNames(
      rows.flatMap((row) => [row.assigneeUserId, row.ownerUserId]),
    );
    const now = new Date();
    return {
      data: rows.map((row) => ({
        ...complaint(row, now),
        accountName: row.account.canonicalName,
        ownerName: names.get(row.ownerUserId) ?? null,
        assigneeName: row.assigneeUserId
          ? (names.get(row.assigneeUserId) ?? null)
          : null,
      })),
      meta: meta(skip, q.limit, total, rows.length),
    };
  }
  async complaint(i: CustomerIdentity, id: string) {
    this.requireComplaints(i, "complaints.view");
    const row = await this.db.complaint.findFirst({
      where: {
        id,
        countryCode: { in: [...i.countryCodes] },
        OR: complaintContext(i),
      },
      include: {
        account: { select: { canonicalName: true } },
        events: { orderBy: { createdAt: "asc" } },
      },
    });
    if (!row) missing();
    const names = await this.userNames([
      row.ownerUserId,
      row.assigneeUserId,
      row.solutionOwnerUserId,
      ...row.events.map((event) => event.actorUserId),
    ]);
    const order = row.customerOrderId
      ? await this.db.customerOrder.findUnique({
          where: { id: row.customerOrderId },
          select: { orderRef: true },
        })
      : null;
    const held = heldPermissions(i);
    const moves = movesFor(
      row.statusCode,
      held,
      row.solutionOwnerUserId === i.userId,
    );
    const now = new Date();
    return {
      data: {
        ...complaint(row, now),
        accountName: row.account.canonicalName,
        orderRef: order?.orderRef ?? null,
        ownerName: names.get(row.ownerUserId) ?? null,
        assigneeName: row.assigneeUserId
          ? (names.get(row.assigneeUserId) ?? null)
          : null,
        solutionOwnerName: row.solutionOwnerUserId
          ? (names.get(row.solutionOwnerUserId) ?? null)
          : null,
        canEditStage:
          row.statusCode !== "CLOSED" &&
          (held.has("complaints.edit") ||
            held.has("complaints.operations-review") ||
            held.has("complaints.quality-review")),
        allowedTransitions: moves.map((move) => ({
          targetStatusCode: move.to,
          back: move.back === true,
          requires: [...move.requires],
        })),
        events: row.events.map((event) => ({
          eventId: event.id,
          eventCode: event.eventCode,
          fromStatusCode: event.fromStatusCode,
          toStatusCode: event.toStatusCode,
          note: event.note,
          details: event.details ?? null,
          actorName: names.get(event.actorUserId) ?? null,
          createdAt: event.createdAt.toISOString(),
        })),
      },
      etag: tag(row.rowVersion),
    };
  }
  async createComplaint(
    i: CustomerIdentity,
    key: string,
    b: CreateComplaintDto,
  ) {
    this.requireComplaints(i, "complaints.create");
    needKey(key);
    const a = await this.account(i, b.accountId);
    if (
      b.contactId &&
      !(await this.db.contact.findFirst({
        where: { id: b.contactId, accountId: a.id },
      }))
    )
      missing();
    if (
      b.projectId &&
      !(await this.db.project.findFirst({
        where: { id: b.projectId, countryCode: a.countryCode },
      }))
    )
      missing();
    if (
      b.productId &&
      !(await this.db.product.findFirst({
        where: { id: b.productId, recordStatusCode: "ACTIVE" },
      }))
    )
      missing();
    if (
      b.customerOrderId &&
      !(await this.db.customerOrder.findFirst({
        where: { id: b.customerOrderId, accountId: a.id },
      }))
    )
      missing();
    const h = hash(b),
      replay = await this.findReplay(i, "COMPLAINT_CREATE", key, h);
    if (replay) return this.complaint(i, replay);
    const now = new Date();
    return this.txs.run(i, async (tx) => {
      const row = await tx.complaint.create({
        data: {
          ...b,
          severityCode: b.severityCode ?? null,
          projectId: b.projectId ?? null,
          salesOrderId: b.salesOrderId ?? null,
          contactId: b.contactId ?? null,
          productId: b.productId ?? null,
          customerOrderId: b.customerOrderId ?? null,
          countryCode: a.countryCode,
          ownerUserId: i.userId,
          assigneeUserId: i.userId,
          description: b.description.trim(),
          stageEnteredAt: now,
          stageDueAt: stageDueAt({
            stage: "OPEN",
            enteredAt: now,
            severityCode: b.severityCode ?? null,
          }),
        },
      });
      await tx.complaintEvent.create({
        data: {
          complaintId: row.id,
          eventCode: "LOGGED",
          toStatusCode: "OPEN",
          actorUserId: i.userId,
        },
      });
      await remember(tx, i, "COMPLAINT_CREATE", key, h, row.id);
      await this.record(
        tx,
        i,
        "COMPLAINT_CREATED",
        "COMPLAINT",
        row.id,
        a.countryCode,
        complaint(row, now),
      );
      return { data: complaint(row, now), etag: tag(row.rowVersion) };
    });
  }
  async updateComplaint(
    i: CustomerIdentity,
    id: string,
    t: string,
    b: UpdateComplaintDto,
  ) {
    this.requireAnyComplaintEdit(i);
    const expected = etag(t),
      before = await this.scopedComplaint(i, id);
    if (before.statusCode === "CLOSED") rule("COMPLAINT_CLOSED");
    await this.checkPeople(i, before.accountId, b);
    const stage = stageData(b);
    const n = await this.db.complaint.updateMany({
      where: { id, rowVersion: expected },
      data: {
        ...(b.severityCode !== undefined
          ? { severityCode: b.severityCode }
          : {}),
        ...(b.ownerUserId ? { ownerUserId: b.ownerUserId } : {}),
        ...(b.description !== undefined
          ? { description: b.description ?? before.description }
          : {}),
        ...stage,
        rowVersion: { increment: 1 },
      },
    });
    if (n.count !== 1) precondition();
    const row = await this.db.complaint.findUniqueOrThrow({ where: { id } });
    await this.txs.run(i, async (tx) => {
      const changed = Object.keys(b).filter(
        (field) => (b as Record<string, unknown>)[field] !== undefined,
      );
      if (changed.length > 0)
        await tx.complaintEvent.create({
          data: {
            complaintId: id,
            eventCode: "UPDATED",
            fromStatusCode: row.statusCode,
            toStatusCode: row.statusCode,
            details: { fields: changed },
            actorUserId: i.userId,
          },
        });
      await this.record(
        tx,
        i,
        "COMPLAINT_UPDATED",
        "COMPLAINT",
        id,
        row.countryCode,
        complaint(row, new Date()),
      );
    });
    return this.complaint(i, id);
  }
  async transitionComplaint(
    i: CustomerIdentity,
    id: string,
    key: string,
    b: ComplaintTransitionDto,
  ) {
    this.requireComplaints(i, "complaints.view");
    needKey(key);
    const h = hash({ id, b }),
      replay = await this.findReplay(i, "COMPLAINT_TRANSITION", key, h);
    if (replay) return this.complaint(i, replay);
    const before = await this.scopedComplaint(i, id);
    const move = findMove(before.statusCode, b.targetStatusCode);
    if (!move) rule("COMPLAINT_TRANSITION_INVALID");
    if (
      !mayMake(
        move,
        heldPermissions(i),
        before.solutionOwnerUserId === i.userId,
      )
    )
      throw new ApiProblem({ status: 403, code: "FORBIDDEN" });
    const values = {
      reason: b.reason,
      operationsFindings: b.operationsFindings ?? before.operationsFindings,
      rootCauseCode: b.rootCauseCode ?? before.rootCauseCode,
      rootCauseDetail: b.rootCauseDetail ?? before.rootCauseDetail,
      correctiveAction: b.correctiveAction ?? before.correctiveAction,
      solutionOwnerUserId: b.solutionOwnerUserId ?? before.solutionOwnerUserId,
      solutionDueDate:
        b.solutionDueDate ??
        before.solutionDueDate?.toISOString().slice(0, 10) ??
        null,
      resolution: b.resolution ?? before.resolution,
    };
    const absent = missingFields(move, values);
    if (absent.length > 0)
      throw new ApiProblem({
        status: 422,
        code: "COMPLAINT_STAGE_INCOMPLETE",
        params: { fields: absent.join(",") },
      });
    await this.checkPeople(i, before.accountId, b);
    const expected = BigInt(b.expectedRowVersion);
    const now = new Date();
    const to = move.to;
    // Who holds it next: the reviewer named for a review, the solution
    // owner for the solution, the complaint's own owner when it is back
    // with Sales to log or to confirm with the customer.
    const assignee =
      to === "SOLUTION"
        ? values.solutionOwnerUserId
        : to === "OPEN" || to === "RESOLVED"
          ? before.ownerUserId
          : to === "CLOSED"
            ? null
            : (b.assigneeUserId ?? null);
    await this.txs.run(i, async (tx) => {
      const n = await tx.complaint.updateMany({
        where: { id, rowVersion: expected },
        data: {
          ...stageData(b),
          statusCode: to,
          assigneeUserId: assignee,
          stageEnteredAt: now,
          stageDueAt: stageDueAt({
            stage: to,
            enteredAt: now,
            severityCode: before.severityCode,
            solutionDueDate: values.solutionDueDate,
          }),
          ...(to === "RESOLVED" ? { resolvedAt: now } : {}),
          ...(to === "CLOSED" ? { closedAt: now } : {}),
          // Sent back from RESOLVED: it is not resolved any more.
          ...(move.back && to === "SOLUTION" ? { resolvedAt: null } : {}),
          rowVersion: { increment: 1 },
        },
      });
      if (n.count !== 1) precondition();
      await tx.complaintEvent.create({
        data: {
          complaintId: id,
          eventCode: move.back ? "SENT_BACK" : "MOVED",
          fromStatusCode: before.statusCode,
          toStatusCode: to,
          note: blank(b.reason) ?? blank(b.note),
          details: {
            assigneeUserId: assignee,
            ...(to === "SOLUTION"
              ? {
                  rootCauseCode: values.rootCauseCode,
                  solutionDueDate: values.solutionDueDate,
                }
              : {}),
          },
          actorUserId: i.userId,
        },
      });
      await remember(tx, i, "COMPLAINT_TRANSITION", key, h, id);
      const row = await tx.complaint.findUniqueOrThrow({ where: { id } });
      await this.record(
        tx,
        i,
        "COMPLAINT_STATUS_CHANGED",
        "COMPLAINT",
        id,
        row.countryCode,
        {
          ...complaint(row, now),
          reason: b.reason ?? null,
          note: b.note ?? null,
        },
      );
    });
    return this.complaint(i, id);
  }
  /** The people a complaint is routed to must exist and be active. */
  private async checkPeople(
    i: CustomerIdentity,
    accountId: string,
    b: {
      assigneeUserId?: string | null;
      solutionOwnerUserId?: string | null;
      customerOrderId?: string | null;
    },
  ) {
    const ids = [b.assigneeUserId, b.solutionOwnerUserId].filter(
      (value): value is string => typeof value === "string",
    );
    if (ids.length > 0) {
      const found = await this.db.appUser.count({
        where: { id: { in: ids }, active: true },
      });
      if (found !== new Set(ids).size) rule("COMPLAINT_PERSON_NOT_FOUND");
    }
    if (
      b.customerOrderId &&
      !(await this.db.customerOrder.findFirst({
        where: {
          id: b.customerOrderId,
          accountId,
          countryCode: { in: [...i.countryCodes] },
        },
      }))
    )
      rule("COMPLAINT_ORDER_NOT_FOUND");
  }
  private async userNames(ids: (string | null)[]) {
    const wanted = [
      ...new Set(ids.filter((id): id is string => typeof id === "string")),
    ];
    if (wanted.length === 0) return new Map<string, string>();
    const users = await this.db.appUser.findMany({
      where: { id: { in: wanted } },
      select: { id: true, displayName: true },
    });
    return new Map(users.map((user) => [user.id, user.displayName]));
  }
  /**
   * Complaints are worked by Sales, Operations and Quality (R&D), so the
   * workspace gate admits all three; the permission still decides.
   */
  private requireComplaints(i: CustomerIdentity, p: string) {
    if (
      (!hasWorkspace(i, "SALES") && !hasWorkspace(i, "RND")) ||
      i.deniedPermissions.has(p) ||
      !i.permissions.has(p)
    )
      throw new ApiProblem({ status: 403, code: "FORBIDDEN" });
  }
  private requireAnyComplaintEdit(i: CustomerIdentity) {
    const held = heldPermissions(i);
    if (
      (!hasWorkspace(i, "SALES") && !hasWorkspace(i, "RND")) ||
      !(
        held.has("complaints.edit") ||
        held.has("complaints.operations-review") ||
        held.has("complaints.quality-review")
      )
    )
      throw new ApiProblem({ status: 403, code: "FORBIDDEN" });
  }
  private async account(i: CustomerIdentity, id: string) {
    const now = new Date(),
      a = await this.db.account.findFirst({
        where: {
          id,
          countryCode: { in: [...i.countryCodes] },
          recordStatusCode: "ACTIVE",
          OR: [
            { ownerUserId: i.userId },
            {
              shares: {
                some: {
                  recipientUserId: i.userId,
                  statusCode: "ACTIVE",
                  OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
                },
              },
            },
          ],
        },
      });
    if (!a) missing();
    return a;
  }
  private scopedComplaint(i: CustomerIdentity, id: string) {
    return this.db.complaint
      .findFirst({
        where: {
          id,
          countryCode: { in: [...i.countryCodes] },
          OR: complaintContext(i),
        },
      })
      .then((x) => x ?? missing());
  }
  private require(i: CustomerIdentity, p: string) {
    if (
      !hasWorkspace(i, "SALES") ||
      i.deniedPermissions.has(p) ||
      !i.permissions.has(p)
    )
      throw new ApiProblem({ status: 403, code: "FORBIDDEN" });
  }
  private findReplay(i: CustomerIdentity, op: string, key: string, h: string) {
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
  private record(
    tx: TransactionClient,
    i: CustomerIdentity,
    action: string,
    type: string,
    id: string,
    country: string,
    after: Record<string, unknown>,
  ) {
    return this.audit.record(tx, {
      actorUserId: i.userId,
      actorSessionId: i.sessionId,
      actionCode: action,
      resourceType: type,
      resourceId: id,
      workspace: "SALES",
      countryCode: country.trim(),
      afterSnapshot: after,
      traceId: i.traceId,
      correlationId: i.correlationId,
      source: "API",
    });
  }
}
const group = (x: {
  id: string;
  groupCode: string;
  name: string;
  groupTypeCode: string | null;
  active: boolean;
}) => ({
  groupNetworkId: x.id,
  groupCode: x.groupCode,
  name: x.name,
  groupTypeCode: x.groupTypeCode,
  isActive: x.active,
});
const membership = (x: {
  id: string;
  accountId: string;
  groupNetworkId: string;
  validFrom: Date | null;
  validTo: Date | null;
  sourceRef: string | null;
}) => ({
  membershipId: x.id,
  accountId: x.accountId,
  groupNetworkId: x.groupNetworkId,
  validFrom: x.validFrom?.toISOString().slice(0, 10) ?? null,
  validTo: x.validTo?.toISOString().slice(0, 10) ?? null,
  sourceRef: x.sourceRef,
});
const complaint = (x: Prisma.ComplaintGetPayload<object>, now: Date) => ({
  complaintId: x.id,
  complaintRef: x.complaintRef,
  accountId: x.accountId,
  projectId: x.projectId,
  salesOrderId: x.salesOrderId,
  customerOrderId: x.customerOrderId,
  contactId: x.contactId,
  productId: x.productId,
  countryCode: x.countryCode.trim(),
  complaintTypeCode: x.complaintTypeCode,
  channelCode: x.channelCode,
  severityCode: x.severityCode,
  statusCode: x.statusCode,
  ownerUserId: x.ownerUserId,
  assigneeUserId: x.assigneeUserId,
  description: x.description,
  resolution: x.resolution,
  operationsFindings: x.operationsFindings,
  rootCauseCode: x.rootCauseCode,
  rootCauseDetail: x.rootCauseDetail,
  correctiveAction: x.correctiveAction,
  preventiveAction: x.preventiveAction,
  solutionOwnerUserId: x.solutionOwnerUserId,
  solutionDueDate: x.solutionDueDate?.toISOString().slice(0, 10) ?? null,
  stageEnteredAt: x.stageEnteredAt.toISOString(),
  stageDueAt: x.stageDueAt?.toISOString() ?? null,
  isOverdue: isLate(x.stageDueAt, x.statusCode, now),
  resolvedAt: x.resolvedAt?.toISOString() ?? null,
  closedAt: x.closedAt?.toISOString() ?? null,
  createdAt: x.createdAt.toISOString(),
  updatedAt: x.updatedAt.toISOString(),
});
function heldPermissions(i: CustomerIdentity): Set<string> {
  return new Set(
    [...i.permissions].filter((code) => !i.deniedPermissions.has(code)),
  );
}
/** The stage fields a body carries, as a partial update. */
function stageData(b: {
  assigneeUserId?: string | null;
  customerOrderId?: string | null;
  operationsFindings?: string | null;
  rootCauseCode?: string | null;
  rootCauseDetail?: string | null;
  correctiveAction?: string | null;
  preventiveAction?: string | null;
  solutionOwnerUserId?: string | null;
  solutionDueDate?: string | null;
  resolution?: string | null;
}): Prisma.ComplaintUpdateManyMutationInput & {
  assigneeUserId?: string | null;
  customerOrderId?: string | null;
  solutionOwnerUserId?: string | null;
} {
  const text = (value: string | null | undefined) =>
    value === undefined ? undefined : blank(value);
  const out: Record<string, unknown> = {
    assigneeUserId: b.assigneeUserId,
    customerOrderId: b.customerOrderId,
    operationsFindings: text(b.operationsFindings),
    rootCauseCode: b.rootCauseCode,
    rootCauseDetail: text(b.rootCauseDetail),
    correctiveAction: text(b.correctiveAction),
    preventiveAction: text(b.preventiveAction),
    solutionOwnerUserId: b.solutionOwnerUserId,
    solutionDueDate:
      b.solutionDueDate === undefined
        ? undefined
        : b.solutionDueDate === null
          ? null
          : new Date(b.solutionDueDate.slice(0, 10)),
    resolution: text(b.resolution),
  };
  return Object.fromEntries(
    Object.entries(out).filter(([, value]) => value !== undefined),
  );
}
function blank(value: string | null | undefined): string | null {
  const text = value?.trim() ?? "";
  return text === "" ? null : text;
}
const meta = (offset: number, limit: number, total: number, count: number) => ({
  page: Math.floor(offset / limit) + 1,
  offset,
  limit,
  total,
  hasNext: offset + count < total,
});
function complaintContext(i: CustomerIdentity) {
  // `[{}]` inside an `OR` array matches nothing in Prisma, not everything —
  // `{ id: { not: "00000000-0000-0000-0000-000000000000" } }` is the always-true fix.
  if (isSystemAdmin(i))
    return [{ id: { not: "00000000-0000-0000-0000-000000000000" } }];
  // Operations and Quality work a shared queue: every complaint in their
  // countries is theirs to pick up, not only the ones on their own accounts.
  const held = heldPermissions(i);
  if (
    held.has("complaints.operations-review") ||
    held.has("complaints.quality-review")
  )
    return [{ id: { not: "00000000-0000-0000-0000-000000000000" } }];
  const now = new Date();
  return [
    { ownerUserId: i.userId },
    { assigneeUserId: i.userId },
    { solutionOwnerUserId: i.userId },
    { account: { ownerUserId: i.userId } },
    {
      account: {
        shares: {
          some: {
            recipientUserId: i.userId,
            statusCode: "ACTIVE",
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          },
        },
      },
    },
  ];
}
const hash = (x: unknown) =>
  createHash("sha256").update(JSON.stringify(x)).digest("hex");
const tag = (v: bigint) => `\"rv-${v}\"`;
function etag(v: string) {
  const m = /^(?:W\/)?\"?rv-(\d+)\"?$/.exec(v.trim());
  if (!m) throw new ApiProblem({ status: 400, code: "IF_MATCH_REQUIRED" });
  return BigInt(m[1]!);
}
function needKey(v: string) {
  if (!v || v.length > 200)
    throw new ApiProblem({ status: 400, code: "IDEMPOTENCY_KEY_REQUIRED" });
}
function missing(): never {
  throw new ApiProblem({ status: 404, code: "RESOURCE_NOT_FOUND" });
}
function rule(code: string): never {
  throw new ApiProblem({ status: 422, code });
}
function precondition(): never {
  throw new ApiProblem({ status: 412, code: "CONCURRENCY_CONFLICT" });
}
async function remember(
  tx: TransactionClient,
  i: CustomerIdentity,
  op: string,
  key: string,
  h: string,
  id: string,
) {
  await tx.commandIdempotency.create({
    data: {
      actorUserId: i.userId,
      operationCode: op,
      idempotencyKey: key,
      requestHash: h,
      responseResourceId: id,
    },
  });
}
