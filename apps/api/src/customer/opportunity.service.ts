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
import type {
  CreateOpportunityDto,
  OpportunityListQuery,
  ProbabilityOverrideDto,
  TransitionOpportunityDto,
  UpdateOpportunityDto,
} from "./opportunity.dto.js";

type Detail = components["schemas"]["OpportunityDetail"];
type ListItem = components["schemas"]["OpportunityListItem"];
type ListEnvelope = components["schemas"]["OpportunityListEnvelope"];
type MutationOutcome = { out: Detail } | { conflict: bigint | undefined };
const include = {
  account: true,
  project: true,
  transitions: { orderBy: { occurredAt: "asc" }, take: 200 },
  wonSnapshots: { orderBy: { wonAt: "asc" }, take: 200 },
} satisfies Prisma.OpportunityInclude;
type Full = Prisma.OpportunityGetPayload<{ include: typeof include }>;
/**
 * The commercial lifecycle of an opportunity, in order.
 *
 * This is deliberately NOT the quotation's status. An opportunity is the deal;
 * a quotation is a document about the deal. A deal can go back to
 * UNDER_NEGOTIATION after a quotation was already sent, and a sent quotation
 * does not become "won" - the opportunity does.
 */
export const opportunityStages = [
  "NEW_LEAD",
  "HOT_LEAD",
  "UNDER_NEGOTIATION",
  "WON",
  "LOST",
] as const;

/** Where a new opportunity starts. Must match a row in opportunity_stage_policies. */
const entryStageCode = "NEW_LEAD";

@Injectable()
export class OpportunityService {
  constructor(
    @Inject(databaseClientToken) private readonly db: DatabaseClient,
    @Inject(transactionManagerToken) private readonly txs: TransactionManager,
    @Inject(auditRepositoryToken) private readonly audit: AuditRepository,
    private readonly access: CustomerAccessService,
  ) {}
  async stagePolicies(i: CustomerIdentity) {
    this.access.requirePermission(i, permissions.opportunitiesView);
    const now = new Date();
    const data = await this.db.opportunityStagePolicy.findMany({
      where: {
        statusCode: "ACTIVE",
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
      },
      orderBy: { stageCode: "asc" },
    });
    return {
      data: data.map((x) => ({
        stageCode: x.stageCode,
        defaultProbabilityPct: x.defaultProbabilityPct.toString(),
        effectiveFrom: x.effectiveFrom.toISOString(),
        effectiveTo: x.effectiveTo?.toISOString() ?? null,
        statusCode: x.statusCode,
      })),
    };
  }
  async lostReasons(i: CustomerIdentity) {
    this.access.requirePermission(i, permissions.opportunitiesView);
    const now = new Date();
    const data = await this.db.opportunityLostReason.findMany({
      where: {
        statusCode: "ACTIVE",
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
      },
      orderBy: { lostReasonCode: "asc" },
    });
    return {
      data: data.map((x) => ({
        lostReasonCode: x.lostReasonCode,
        displayName: x.displayName,
        effectiveFrom: x.effectiveFrom.toISOString(),
        effectiveTo: x.effectiveTo?.toISOString() ?? null,
        statusCode: x.statusCode,
      })),
    };
  }
  async list(
    i: CustomerIdentity,
    q: OpportunityListQuery,
  ): Promise<ListEnvelope> {
    this.access.requirePermission(i, permissions.opportunitiesView);
    const offset = q.offset ?? (q.page - 1) * q.limit;
    const where: Prisma.OpportunityWhereInput = {
      countryCode: { in: [...i.countryCodes] },
      ...(q.accountId ? { accountId: q.accountId } : {}),
      ...(q.projectId ? { projectId: q.projectId } : {}),
      ...(q.stageCode ? { stageCode: q.stageCode } : {}),
      ...(q.search
        ? {
            OR: [
              {
                title: {
                  contains: q.search.trim(),
                  mode: "insensitive" as const,
                },
              },
              {
                opportunityRef: {
                  contains: q.search.trim(),
                  mode: "insensitive" as const,
                },
              },
            ],
          }
        : {}),
      AND: [{ OR: accountContext(i, "VIEW") }],
    };
    const [total, data] = await this.db.$transaction([
      this.db.opportunity.count({ where }),
      this.db.opportunity.findMany({
        where,
        include,
        skip: offset,
        take: q.limit,
        orderBy: order(q.sort),
      }),
    ]);
    return {
      data: data.map(toList),
      meta: {
        page: Math.floor(offset / q.limit) + 1,
        offset,
        limit: q.limit,
        total,
        hasNext: offset + data.length < total,
      },
    };
  }
  async get(i: CustomerIdentity, id: string): Promise<Detail> {
    this.access.requirePermission(i, permissions.opportunitiesView);
    const row = await this.db.opportunity.findFirst({
      where: visible(i, id),
      include,
    });
    if (!row) this.notFound();
    return toDetail(row);
  }
  async create(
    i: CustomerIdentity,
    input: CreateOpportunityDto,
    key: string,
  ): Promise<Detail> {
    this.access.requirePermission(i, permissions.opportunitiesCreate);
    needKey(key);
    const hash = hashJson(input);
    const replay = await this.replay(i, "OPPORTUNITY_CREATE", key, hash);
    if (replay) return this.get(i, replay);
    const account = await this.db.account.findFirst({
      where: {
        id: input.accountId,
        countryCode: { in: [...i.countryCodes] },
        recordStatusCode: "ACTIVE",
        OR: accountRecordContext(i, "COLLABORATE_EDIT"),
      },
    });
    if (!account) this.notFound();
    const noProjectReasonCode = input.noProjectReasonCode?.trim() ?? null;
    let project: null | { id: string; countryCode: string } = null;
    if (input.projectId) {
      project = await this.db.project.findFirst({
        where: {
          id: input.projectId,
          recordStatusCode: "ACTIVE",
          parties: { some: { accountId: account.id } },
          countryCode: { in: [...i.countryCodes] },
        },
      });
      if (!project)
        throw new ApiProblem({ status: 422, code: "PROJECT_NOT_ELIGIBLE" });
    } else if (noProjectReasonCode === null)
      throw new ApiProblem({ status: 422, code: "NO_PROJECT_REASON_REQUIRED" });
    const countryCode = project?.countryCode ?? account.countryCode;
    // The first stage of the funnel the rest of the system draws. It must match
    // the seeded stage policies, or creating an opportunity fails outright.
    const policy = await this.policy(entryStageCode);
    return this.txs.run(i, async (tx) => {
      const row = await tx.opportunity.create({
        data: {
          title: input.title.trim(),
          accountId: account.id,
          projectId: project?.id ?? null,
          countryCode,
          ownerUserId: i.userId,
          stageCode: entryStageCode,
          probabilityPct: policy.defaultProbabilityPct,
          estimatedValue: decimal(input.estimatedValue),
          currencyCode: input.currencyCode ?? null,
          expectedCloseDate: input.expectedCloseDate
            ? new Date(input.expectedCloseDate)
            : null,
          noProjectReasonCode: project ? null : noProjectReasonCode,
          createdByUserId: i.userId,
          updatedByUserId: i.userId,
          transitions: {
            create: {
              fromStageCode: null,
              toStageCode: entryStageCode,
              eventCode: "STAGE_CHANGED",
              actorUserId: i.userId,
            },
          },
        },
        include,
      });
      await remember(tx, i, "OPPORTUNITY_CREATE", key, hash, row.id);
      const out = toDetail(row);
      await this.log(tx, i, "OPPORTUNITY_CREATED", row, null, out, null);
      return out;
    });
  }
  async update(
    i: CustomerIdentity,
    id: string,
    tag: string,
    input: UpdateOpportunityDto,
  ): Promise<Detail> {
    this.access.requirePermission(i, permissions.opportunitiesEdit);
    const v = parse(tag);
    const before = await this.db.opportunity.findFirst({
      where: editable(i, id),
      include,
    });
    if (!before) this.notFound();
    if (before.stageCode === "WON")
      throw new ApiProblem({ status: 409, code: "WON_OPPORTUNITY_IMMUTABLE" });
    const project = await this.validateProject(
      i,
      before.accountId,
      input.projectId,
      input.noProjectReasonCode,
      before,
    );
    const outcome: MutationOutcome = await this.txs.run(i, async (tx) => {
      const data: Prisma.OpportunityUncheckedUpdateManyInput = {
        updatedByUserId: i.userId,
        rowVersion: { increment: 1 },
      };
      if (input.projectId !== undefined) {
        data.projectId = project?.id ?? null;
        data.countryCode = project?.countryCode ?? before.account.countryCode;
        data.noProjectReasonCode = project
          ? null
          : (input.noProjectReasonCode ?? null);
      }
      if (input.title !== undefined) data.title = input.title.trim();
      if (input.estimatedValue !== undefined)
        data.estimatedValue = decimal(input.estimatedValue);
      if (input.currencyCode !== undefined)
        data.currencyCode = input.currencyCode;
      if (input.expectedCloseDate !== undefined)
        data.expectedCloseDate = input.expectedCloseDate
          ? new Date(input.expectedCloseDate)
          : null;
      const ch = await tx.opportunity.updateMany({
        where: { id, rowVersion: v },
        data,
      });
      if (ch.count !== 1)
        return {
          conflict: (await tx.opportunity.findUnique({ where: { id } }))
            ?.rowVersion,
        };
      const row = await tx.opportunity.findUniqueOrThrow({
        where: { id },
        include,
      });
      const out = toDetail(row);
      await this.log(
        tx,
        i,
        "OPPORTUNITY_UPDATED",
        row,
        toDetail(before),
        out,
        null,
      );
      return { out };
    });
    if ("conflict" in outcome) this.conflict(id, tag, outcome.conflict);
    return outcome.out;
  }
  async transition(
    i: CustomerIdentity,
    id: string,
    tag: string,
    key: string,
    input: TransitionOpportunityDto,
  ): Promise<Detail> {
    this.access.requirePermission(i, permissions.opportunitiesEdit);
    needKey(key);
    const v = parse(tag),
      hash = hashJson({ id, tag, input });
    const replay = await this.replay(i, "OPPORTUNITY_TRANSITION", key, hash);
    if (replay) return this.get(i, replay);
    const before = await this.db.opportunity.findFirst({
      where: editable(i, id),
      include,
    });
    if (!before) this.notFound();
    const policy = await this.policy(input.targetStageCode);
    const lostReasonCode =
      input.targetStageCode === "LOST" ? (input.lostReasonCode ?? null) : null;
    if (input.targetStageCode === "LOST") {
      if (!lostReasonCode || !(await this.reason(lostReasonCode)))
        throw new ApiProblem({
          status: 422,
          code: "ACTIVE_LOST_REASON_REQUIRED",
        });
    } else if (input.lostReasonCode)
      throw new ApiProblem({ status: 422, code: "LOST_REASON_ONLY_FOR_LOST" });
    const winningValue = before.estimatedValue;
    const winningCurrencyCode = before.currencyCode;
    let winningSnapshot: {
      value: Prisma.Decimal;
      currencyCode: string;
    } | null = null;
    if (
      input.targetStageCode === "WON" &&
      (winningValue === null || winningCurrencyCode === null)
    )
      throw new ApiProblem({
        status: 422,
        code: "WON_VALUE_AND_CURRENCY_REQUIRED",
      });
    if (input.targetStageCode === "WON") {
      if (winningValue === null || winningCurrencyCode === null)
        throw new ApiProblem({
          status: 422,
          code: "WON_VALUE_AND_CURRENCY_REQUIRED",
        });
      winningSnapshot = {
        value: winningValue,
        currencyCode: winningCurrencyCode,
      };
    }
    const outcome: MutationOutcome = await this.txs.run(
      i,
      async (tx) => {
        const data: Prisma.OpportunityUncheckedUpdateManyInput = {
          stageCode: input.targetStageCode,
          lostReasonCode,
          probabilityPct: policy.defaultProbabilityPct,
          probabilitySourceCode: "STAGE_DEFAULT",
          updatedByUserId: i.userId,
          rowVersion: { increment: 1 },
        };
        if (input.targetStageCode === "WON") {
          data.wonAt = new Date();
          data.wonValueSnapshot = before.estimatedValue;
        } else if (before.stageCode === "WON") {
          data.wonAt = null;
        }
        const ch = await tx.opportunity.updateMany({
          where: { id, rowVersion: v },
          data,
        });
        if (ch.count !== 1)
          return {
            conflict: (await tx.opportunity.findUnique({ where: { id } }))
              ?.rowVersion,
          };
        const transition = await tx.opportunityStageTransition.create({
          data: {
            opportunityId: id,
            fromStageCode: before.stageCode,
            toStageCode: input.targetStageCode,
            lostReasonCode,
            eventCode: "STAGE_CHANGED",
            actorUserId: i.userId,
          },
        });
        if (before.stageCode === "WON" && input.targetStageCode !== "WON")
          await tx.opportunityStageTransition.create({
            data: {
              opportunityId: id,
              fromStageCode: "WON",
              toStageCode: input.targetStageCode,
              eventCode: "WON_REVERSED",
              actorUserId: i.userId,
            },
          });
        if (input.targetStageCode === "WON") {
          const snapshot = winningSnapshot;
          if (snapshot === null)
            throw new Error("WON_SNAPSHOT_PRECONDITION_FAILED");
          await tx.opportunityWonSnapshot.create({
            data: {
              opportunityId: id,
              stageTransitionId: transition.id,
              wonAt: new Date(),
              value: snapshot.value,
              currencyCode: snapshot.currencyCode,
            },
          });
        }
        await remember(tx, i, "OPPORTUNITY_TRANSITION", key, hash, id);
        const row = await tx.opportunity.findUniqueOrThrow({
          where: { id },
          include,
        });
        const out = toDetail(row);
        await this.log(
          tx,
          i,
          "OPPORTUNITY_STAGE_CHANGED",
          row,
          toDetail(before),
          out,
          { targetStageCode: input.targetStageCode },
        );
        return { out };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    if ("conflict" in outcome) this.conflict(id, tag, outcome.conflict);
    return outcome.out;
  }
  async overrideProbability(
    i: CustomerIdentity,
    id: string,
    tag: string,
    key: string,
    input: ProbabilityOverrideDto,
  ): Promise<Detail> {
    this.access.requirePermission(
      i,
      permissions.opportunitiesProbabilityOverride,
    );
    needKey(key);
    const v = parse(tag),
      hash = hashJson({ id, tag, input });
    const replay = await this.replay(
      i,
      "OPPORTUNITY_PROBABILITY_OVERRIDE",
      key,
      hash,
    );
    if (replay) return this.get(i, replay);
    const before = await this.db.opportunity.findFirst({
      where: editable(i, id),
      include,
    });
    if (!before) this.notFound();
    const val = decimal(input.probabilityPct);
    if (val === null || val.lessThan(0) || val.greaterThan(100))
      throw new ApiProblem({ status: 422, code: "INVALID_PROBABILITY" });
    return this.txs.run(i, async (tx) => {
      const ch = await tx.opportunity.updateMany({
        where: { id, rowVersion: v },
        data: {
          probabilityPct: val,
          probabilitySourceCode: "MANUAL_OVERRIDE",
          updatedByUserId: i.userId,
          rowVersion: { increment: 1 },
        },
      });
      if (ch.count !== 1)
        return this.conflict(
          id,
          tag,
          (await tx.opportunity.findUnique({ where: { id } }))?.rowVersion,
        );
      await tx.opportunityProbabilityOverride.create({
        data: {
          opportunityId: id,
          probabilityPct: val,
          reason: input.reason.trim(),
          sourceMetadata: {
            sourceCode: input.sourceMetadata.sourceCode,
            reference: input.sourceMetadata.reference ?? null,
          },
          createdByUserId: i.userId,
        },
      });
      await remember(tx, i, "OPPORTUNITY_PROBABILITY_OVERRIDE", key, hash, id);
      const row = await tx.opportunity.findUniqueOrThrow({
        where: { id },
        include,
      });
      const out = toDetail(row);
      await this.log(
        tx,
        i,
        "OPPORTUNITY_PROBABILITY_OVERRIDDEN",
        row,
        toDetail(before),
        out,
        {
          reason: input.reason.trim(),
          sourceCode: input.sourceMetadata.sourceCode,
        },
      );
      return out;
    });
  }
  /** See CancelOpportunityDto: cancelled is a separate outcome from lost. */
  async cancel(
    i: CustomerIdentity,
    id: string,
    key: string,
    input: { expectedRowVersion: string; reason: string },
  ): Promise<Detail> {
    this.access.requirePermission(i, permissions.opportunitiesEdit);
    needKey(key);
    const expected = parse(input.expectedRowVersion);
    const before = await this.db.opportunity.findFirst({
      where: editable(i, id),
    });
    if (!before) this.notFound();
    if (before.stageCode === "WON" || before.stageCode === "LOST")
      throw new ApiProblem({ status: 422, code: "OPPORTUNITY_ALREADY_CLOSED" });
    if (before.cancelledAt !== null)
      throw new ApiProblem({
        status: 422,
        code: "OPPORTUNITY_ALREADY_CANCELLED",
      });
    const reason = input.reason.trim();
    const changed = await this.db.opportunity.updateMany({
      where: { id, rowVersion: expected },
      data: {
        cancelledAt: new Date(),
        cancellationReason: reason,
        rowVersion: { increment: 1 },
      },
    });
    if (changed.count !== 1)
      throw new ApiProblem({ status: 412, code: "CONCURRENCY_CONFLICT" });
    return this.get(i, id);
  }

  private async policy(stage: string) {
    const now = new Date();
    const x = await this.db.opportunityStagePolicy.findFirst({
      where: {
        stageCode: stage,
        statusCode: "ACTIVE",
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
      },
      orderBy: { effectiveFrom: "desc" },
    });
    if (!x)
      throw new ApiProblem({
        status: 422,
        code: "STAGE_POLICY_NOT_CONFIGURED",
      });
    return x;
  }
  private async reason(code: string) {
    const now = new Date();
    return this.db.opportunityLostReason.findFirst({
      where: {
        lostReasonCode: code,
        statusCode: "ACTIVE",
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
      },
      orderBy: { effectiveFrom: "desc" },
    });
  }
  private async validateProject(
    i: CustomerIdentity,
    accountId: string,
    id: string | null | undefined,
    noProject: string | null | undefined,
    before: Full,
  ) {
    if (id === undefined) return before.project;
    if (id === null) {
      if (!noProject?.trim())
        throw new ApiProblem({
          status: 422,
          code: "NO_PROJECT_REASON_REQUIRED",
        });
      return null;
    }
    const p = await this.db.project.findFirst({
      where: {
        id,
        recordStatusCode: "ACTIVE",
        countryCode: { in: [...i.countryCodes] },
        parties: { some: { accountId } },
      },
    });
    if (!p) throw new ApiProblem({ status: 422, code: "PROJECT_NOT_ELIGIBLE" });
    return p;
  }
  private async replay(
    i: CustomerIdentity,
    op: string,
    key: string,
    hash: string,
  ) {
    const x = await this.db.commandIdempotency.findUnique({
      where: {
        actorUserId_operationCode_idempotencyKey: {
          actorUserId: i.userId,
          operationCode: op,
          idempotencyKey: key,
        },
      },
    });
    if (!x) return null;
    if (x.requestHash !== hash)
      throw new ApiProblem({ status: 409, code: "IDEMPOTENCY_KEY_REUSED" });
    return x.responseResourceId;
  }
  private async log(
    tx: TransactionClient,
    i: CustomerIdentity,
    action: string,
    row: Full,
    before: Detail | null,
    after: Detail,
    metadata: Readonly<Record<string, unknown>> | null,
  ) {
    await this.audit.append(tx, {
      actorUserId: i.userId,
      actorSessionId: i.sessionId,
      actionCode: action,
      resourceType: "OPPORTUNITY",
      resourceId: row.id,
      workspace: "SALES",
      countryCode: row.countryCode.trim(),
      beforeSnapshot: before,
      afterSnapshot: after,
      metadata,
      traceId: i.traceId,
      correlationId: i.correlationId,
      source: "API",
    });
  }
  private notFound(): never {
    throw new ApiProblem({ status: 404, code: "RESOURCE_NOT_FOUND" });
  }
  private conflict(id: string, e: string, c?: bigint): never {
    throw new ApiProblem({
      status: 412,
      code: "CONCURRENCY_CONFLICT",
      conflict: {
        currentRowVersion: c ? etag(c) : "rv-unknown",
        expectedRowVersion: e,
        resource: { resourceType: "OPPORTUNITY", resourceId: id },
      },
    });
  }
}
function visible(
  i: CustomerIdentity,
  id: string,
): Prisma.OpportunityWhereInput {
  return {
    id,
    countryCode: { in: [...i.countryCodes] },
    AND: [{ OR: accountContext(i, "VIEW") }],
  };
}
function editable(
  i: CustomerIdentity,
  id: string,
): Prisma.OpportunityWhereInput {
  return {
    id,
    countryCode: { in: [...i.countryCodes] },
    AND: [{ OR: accountContext(i, "COLLABORATE_EDIT") }],
  };
}
function accountContext(
  identity: CustomerIdentity,
  level: "VIEW" | "COLLABORATE_EDIT",
): Prisma.OpportunityWhereInput[] {
  // `[{}]` inside an `OR` array matches nothing in Prisma, not everything —
  // `{ id: { not: "00000000-0000-0000-0000-000000000000" } }` is the always-true fix.
  if (isSystemAdmin(identity))
    return [{ id: { not: "00000000-0000-0000-0000-000000000000" } }];
  const userId = identity.userId;
  const now = new Date(),
    levels =
      level === "VIEW" ? ["VIEW", "COLLABORATE_EDIT"] : ["COLLABORATE_EDIT"];
  return [
    { ownerUserId: userId },
    ...(canUseManagerContext(identity)
      ? [{ owner: { profile: { is: { managerUserId: userId } } } }]
      : []),
    {
      account: {
        OR: [
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
        ],
      },
    },
  ];
}
function accountRecordContext(
  identity: CustomerIdentity,
  level: "VIEW" | "COLLABORATE_EDIT",
): Prisma.AccountWhereInput[] {
  // `[{}]` inside an `OR` array matches nothing in Prisma, not everything —
  // `{ id: { not: "00000000-0000-0000-0000-000000000000" } }` is the always-true fix.
  if (isSystemAdmin(identity))
    return [{ id: { not: "00000000-0000-0000-0000-000000000000" } }];
  const userId = identity.userId;
  const now = new Date(),
    levels =
      level === "VIEW" ? ["VIEW", "COLLABORATE_EDIT"] : ["COLLABORATE_EDIT"];
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
function toList(x: Full): ListItem {
  return {
    opportunityId: x.id,
    opportunityRef: x.opportunityRef,
    title: x.title,
    accountId: x.accountId,
    projectId: x.projectId,
    countryCode: x.countryCode.trim(),
    ownerUserId: x.ownerUserId,
    stageCode: x.stageCode,
    cancelledAt: x.cancelledAt?.toISOString() ?? null,
    cancellationReason: x.cancellationReason,
    probabilityPct: x.probabilityPct?.toString() ?? null,
    probabilitySourceCode: x.probabilitySourceCode as
      "STAGE_DEFAULT" | "MANUAL_OVERRIDE",
    estimatedValue: x.estimatedValue?.toString() ?? null,
    currencyCode: x.currencyCode?.trim() ?? null,
    createdAt: x.createdAt.toISOString(),
    updatedAt: x.updatedAt.toISOString(),
    expectedCloseDate: x.expectedCloseDate?.toISOString().slice(0, 10) ?? null,
  };
}
function toDetail(x: Full): Detail {
  return {
    ...toList(x),
    noProjectReasonCode: x.noProjectReasonCode,
    lostReasonCode: x.lostReasonCode,
    wonAt: x.wonAt?.toISOString() ?? null,
    wonValueSnapshot: x.wonValueSnapshot?.toString() ?? null,
    stageHistory: x.transitions.map((t) => ({
      transitionId: t.id,
      fromStageCode: t.fromStageCode,
      toStageCode: t.toStageCode,
      lostReasonCode: t.lostReasonCode,
      occurredAt: t.occurredAt.toISOString(),
      actorUserId: t.actorUserId,
      eventCode: t.eventCode as "STAGE_CHANGED" | "WON_REVERSED",
    })),
    wonSnapshots: x.wonSnapshots.map((s) => ({
      wonSnapshotId: s.id,
      wonAt: s.wonAt.toISOString(),
      value: s.value.toString(),
      currencyCode: s.currencyCode.trim(),
      stageTransitionId: s.stageTransitionId,
    })),
    rowVersion: etag(x.rowVersion),
  };
}
function order(s: string): Prisma.OpportunityOrderByWithRelationInput[] {
  const [f, d] = s.split(":") as [string, "asc" | "desc"];
  return [{ [f]: d }, { id: "asc" }];
}
function etag(v: bigint) {
  return `"rv-${v.toString()}"`;
}
function parse(x: string) {
  const m = /^"rv-([1-9][0-9]*)"$/.exec(x);
  if (!m?.[1]) throw new ApiProblem({ status: 400, code: "INVALID_IF_MATCH" });
  return BigInt(m[1]);
}
function needKey(x: string) {
  if (x.length < 8 || x.length > 200)
    throw new ApiProblem({ status: 400, code: "INVALID_IDEMPOTENCY_KEY" });
}
function hashJson(x: unknown) {
  return createHash("sha256").update(JSON.stringify(x)).digest("hex");
}
function decimal(v: string | null | undefined) {
  return v == null ? null : new Prisma.Decimal(v);
}
async function remember(
  tx: TransactionClient,
  i: CustomerIdentity,
  op: string,
  key: string,
  hash: string,
  id: string,
) {
  await tx.commandIdempotency.create({
    data: {
      actorUserId: i.userId,
      operationCode: op,
      idempotencyKey: key,
      requestHash: hash,
      responseResourceId: id,
    },
  });
}
