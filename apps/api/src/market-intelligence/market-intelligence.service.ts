import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { permissions } from "@abp/contracts";
import {
  Prisma,
  type DatabaseClient,
  type TransactionClient,
  type TransactionManager,
} from "@abp/database";
import type { CustomerIdentity } from "../customer/customer-auth.js";
import { ApiProblem } from "../platform/api-exception.filter.js";
import { AuditService } from "../platform/audit.service.js";
import {
  databaseClientToken,
  transactionManagerToken,
} from "../platform/database.providers.js";
import type {
  CreateCompetitorDto,
  CreateMarketSignalDto,
  CreateRepeatBusinessRequestDto,
  CreateTargetAccountDto,
  CreateTargetMarketDto,
  CreateWatchlistEntryDto,
  IntelligenceListQuery,
  UpdateRepeatBusinessRequestDto,
} from "./market-intelligence.dto.js";
import { notify } from "../support/notify.js";

@Injectable()
export class MarketIntelligenceService {
  constructor(
    @Inject(databaseClientToken) private readonly db: DatabaseClient,
    @Inject(transactionManagerToken) private readonly txs: TransactionManager,
    private readonly audit: AuditService,
  ) {}

  async listSignals(identity: CustomerIdentity, query: IntelligenceListQuery) {
    this.require(identity, permissions.marketIntelligenceView);
    const countryCodes = scopedCountries(identity, query.countryCode);
    const where: Prisma.MarketSignalWhereInput = {
      statusCode: "ACTIVE",
      ...(countryCodes.length > 0
        ? { OR: [{ countryCode: null }, { countryCode: { in: countryCodes } }] }
        : {}),
      ...(query.search
        ? {
            AND: [
              {
                OR: [
                  { title: { contains: query.search, mode: "insensitive" } },
                  {
                    sourceName: { contains: query.search, mode: "insensitive" },
                  },
                  { summary: { contains: query.search, mode: "insensitive" } },
                ],
              },
            ],
          }
        : {}),
    };
    const [total, rows] = await this.db.$transaction([
      this.db.marketSignal.count({ where }),
      this.db.marketSignal.findMany({
        where,
        orderBy: [{ publishedDate: "desc" }, { createdAt: "desc" }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
    ]);
    return page(rows.map(signal), total, query);
  }

  createSignal(identity: CustomerIdentity, input: CreateMarketSignalDto) {
    this.require(identity, permissions.marketIntelligenceManage);
    requireCountry(identity, input.countryCode);
    if (
      input.classificationCode === "FACT" &&
      input.verificationCode !== "VERIFIED"
    ) {
      rule("FACT_REQUIRES_VERIFIED_EVIDENCE");
    }
    if (new Date(input.retrievedDate) < new Date(input.publishedDate)) {
      rule("RETRIEVED_DATE_BEFORE_PUBLISHED_DATE");
    }
    return this.txs.run(identity, async (tx) => {
      const row = await tx.marketSignal.create({
        data: {
          title: input.title.trim(),
          sourceName: input.sourceName.trim(),
          sourceUrl: input.sourceUrl ?? null,
          publishedDate: new Date(input.publishedDate),
          retrievedDate: new Date(input.retrievedDate),
          eventDate: input.eventDate ? new Date(input.eventDate) : null,
          evidence: input.evidence.trim(),
          evidenceHash: createHash("sha256")
            .update(input.evidence.trim())
            .digest("hex"),
          verificationCode: input.verificationCode,
          classificationCode: input.classificationCode,
          countryCode: input.countryCode ?? null,
          summary: input.summary ?? null,
          createdByUserId: identity.userId,
        },
      });
      await this.record(
        tx,
        identity,
        "MARKET_SIGNAL_CREATED",
        "MarketSignal",
        row.id,
        row.countryCode,
        {
          classificationCode: row.classificationCode,
          verificationCode: row.verificationCode,
          evidenceHash: row.evidenceHash,
        },
      );
      return { data: signal(row) };
    });
  }

  async listTargetMarkets(
    identity: CustomerIdentity,
    query: IntelligenceListQuery,
  ) {
    this.require(identity, permissions.targetMarketsView);
    const countries = scopedCountries(identity, query.countryCode);
    const where: Prisma.TargetMarketWhereInput = {
      statusCode: "ACTIVE",
      ...(countries.length ? { countryCode: { in: countries } } : {}),
      ...(query.search
        ? { name: { contains: query.search, mode: "insensitive" } }
        : {}),
    };
    const [total, rows] = await this.db.$transaction([
      this.db.targetMarket.count({ where }),
      this.db.targetMarket.findMany({
        where,
        orderBy: [{ priorityScore: "desc" }, { updatedAt: "desc" }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
    ]);
    return page(rows.map(targetMarket), total, query);
  }

  createTargetMarket(identity: CustomerIdentity, input: CreateTargetMarketDto) {
    this.require(identity, permissions.targetMarketsManage);
    requireCountry(identity, input.countryCode);
    return this.txs.run(identity, async (tx) => {
      const row = await tx.targetMarket.create({
        data: {
          name: input.name.trim(),
          countryCode: input.countryCode,
          segmentCode: input.segmentCode ?? null,
          rationale: input.rationale.trim(),
          priorityScore:
            input.priorityScore === undefined
              ? null
              : new Prisma.Decimal(input.priorityScore),
          rankingSource: input.rankingSource ?? "COMMERCIAL_REVIEW",
          createdByUserId: identity.userId,
        },
      });
      await this.record(
        tx,
        identity,
        "TARGET_MARKET_CREATED",
        "TargetMarket",
        row.id,
        row.countryCode,
        {
          priorityScore: row.priorityScore?.toString() ?? null,
          rankingSource: row.rankingSource,
        },
      );
      return { data: targetMarket(row) };
    });
  }

  async listTargetAccounts(
    identity: CustomerIdentity,
    query: IntelligenceListQuery,
  ) {
    this.require(identity, permissions.targetAccountsView);
    const countries = scopedCountries(identity, query.countryCode);
    const where: Prisma.TargetAccountWhereInput = {
      statusCode: "PROSPECT",
      ...(countries.length ? { countryCode: { in: countries } } : {}),
      ...(query.search
        ? { companyName: { contains: query.search, mode: "insensitive" } }
        : {}),
    };
    const [total, rows] = await this.db.$transaction([
      this.db.targetAccount.count({ where }),
      this.db.targetAccount.findMany({
        where,
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
    ]);
    return page(rows.map(targetAccount), total, query);
  }

  createTargetAccount(
    identity: CustomerIdentity,
    input: CreateTargetAccountDto,
  ) {
    this.require(identity, permissions.targetAccountsManage);
    requireCountry(identity, input.countryCode);
    return this.txs.run(identity, async (tx) => {
      if (input.sourceSignalId) {
        const source = await tx.marketSignal.findUnique({
          where: { id: input.sourceSignalId },
        });
        if (!source) missing("MARKET_SIGNAL_NOT_FOUND");
      }
      const row = await tx.targetAccount.create({
        data: {
          companyName: input.companyName.trim(),
          normalizedName: normalize(input.companyName),
          countryCode: input.countryCode,
          segmentCode: input.segmentCode ?? null,
          website: input.website ?? null,
          rationale: input.rationale.trim(),
          sourceSignalId: input.sourceSignalId ?? null,
          ownerUserId: input.ownerUserId ?? identity.userId,
          createdByUserId: identity.userId,
        },
      });
      await this.record(
        tx,
        identity,
        "TARGET_ACCOUNT_CREATED",
        "TargetAccount",
        row.id,
        row.countryCode,
        {
          statusCode: row.statusCode,
          sourceSignalId: row.sourceSignalId,
        },
      );
      return { data: targetAccount(row) };
    });
  }

  async prepareTargetAccount(
    identity: CustomerIdentity,
    id: string,
    kind: "CUSTOMER" | "OPPORTUNITY",
  ) {
    this.require(identity, permissions.targetAccountsPrepare);
    const row = await this.db.targetAccount.findUnique({ where: { id } });
    if (!row || !identity.countryCodes.has(row.countryCode.trim()))
      missing("TARGET_ACCOUNT_NOT_FOUND");
    const duplicate = await this.db.account.findFirst({
      where: {
        countryCode: row.countryCode,
        normalizedName: row.normalizedName,
      },
      select: { id: true, accountRef: true, canonicalName: true },
    });
    const prepared =
      kind === "CUSTOMER"
        ? {
            action: "PREPARE_CUSTOMER_CREATION",
            requiresConfirmation: true,
            createsBusinessRecord: false,
            duplicate,
            draft: {
              canonicalName: row.companyName,
              countryCode: row.countryCode.trim(),
              accountCategoryCode: row.segmentCode,
            },
          }
        : {
            action: "PREPARE_OPPORTUNITY_CREATION",
            requiresConfirmation: true,
            createsBusinessRecord: false,
            prerequisite: duplicate
              ? null
              : "CONFIRMED_CUSTOMER_ACCOUNT_REQUIRED",
            draft: {
              accountId: duplicate?.id ?? null,
              countryCode: row.countryCode.trim(),
              stageCode: "QUALIFICATION",
              sourceTargetAccountId: row.id,
            },
          };
    await this.txs.run(identity, (tx) =>
      this.record(
        tx,
        identity,
        `TARGET_ACCOUNT_${kind}_PREPARED`,
        "TargetAccount",
        row.id,
        row.countryCode,
        {
          requiresConfirmation: true,
          createsBusinessRecord: false,
          duplicateAccountId: duplicate?.id ?? null,
        },
      ),
    );
    return { data: prepared };
  }

  async listCompetitors(
    identity: CustomerIdentity,
    query: IntelligenceListQuery,
  ) {
    this.require(identity, permissions.competitorsView);
    const countries = scopedCountries(identity, query.countryCode);
    const where: Prisma.CompetitorWhereInput = {
      statusCode: "ACTIVE",
      ...(countries.length
        ? { OR: [{ countryCode: null }, { countryCode: { in: countries } }] }
        : {}),
      ...(query.search
        ? { name: { contains: query.search, mode: "insensitive" } }
        : {}),
    };
    const [total, rows] = await this.db.$transaction([
      this.db.competitor.count({ where }),
      this.db.competitor.findMany({
        where,
        orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
    ]);
    return page(rows.map(competitor), total, query);
  }

  createCompetitor(identity: CustomerIdentity, input: CreateCompetitorDto) {
    this.require(identity, permissions.competitorsManage);
    requireCountry(identity, input.countryCode);
    return this.txs.run(identity, async (tx) => {
      const row = await tx.competitor.create({
        data: {
          name: input.name.trim(),
          normalizedName: normalize(input.name),
          countryCode: input.countryCode ?? null,
          strengths: input.strengths ?? null,
          weaknesses: input.weaknesses ?? null,
          notes: input.notes ?? null,
          createdByUserId: identity.userId,
        },
      });
      await this.record(
        tx,
        identity,
        "COMPETITOR_CREATED",
        "Competitor",
        row.id,
        row.countryCode,
        {},
      );
      return { data: competitor(row) };
    });
  }

  async listWatchlist(
    identity: CustomerIdentity,
    query: IntelligenceListQuery,
  ) {
    this.require(identity, permissions.watchlistView);
    const where: Prisma.WatchlistEntryWhereInput = {
      createdByUserId: identity.userId,
      statusCode: "ACTIVE",
      ...(query.search
        ? { label: { contains: query.search, mode: "insensitive" } }
        : {}),
    };
    const [total, rows] = await this.db.$transaction([
      this.db.watchlistEntry.count({ where }),
      this.db.watchlistEntry.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
    ]);
    return page(rows, total, query);
  }

  createWatchlist(identity: CustomerIdentity, input: CreateWatchlistEntryDto) {
    this.require(identity, permissions.watchlistManage);
    return this.txs.run(identity, async (tx) => {
      await this.requireWatchResource(
        tx,
        identity,
        input.resourceType,
        input.resourceId,
      );
      const row = await tx.watchlistEntry.upsert({
        where: {
          createdByUserId_resourceType_resourceId: {
            createdByUserId: identity.userId,
            resourceType: input.resourceType,
            resourceId: input.resourceId,
          },
        },
        create: {
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          label: input.label.trim(),
          notes: input.notes ?? null,
          createdByUserId: identity.userId,
        },
        update: {
          label: input.label.trim(),
          notes: input.notes ?? null,
          statusCode: "ACTIVE",
        },
      });
      await this.record(
        tx,
        identity,
        "WATCHLIST_ENTRY_SAVED",
        "WatchlistEntry",
        row.id,
        null,
        {
          resourceType: row.resourceType,
          resourceId: row.resourceId,
        },
      );
      return { data: row };
    });
  }

  async removeWatchlist(identity: CustomerIdentity, id: string) {
    this.require(identity, permissions.watchlistManage);
    const row = await this.db.watchlistEntry.findFirst({
      where: { id, createdByUserId: identity.userId, statusCode: "ACTIVE" },
    });
    if (!row) missing("WATCHLIST_ENTRY_NOT_FOUND");
    await this.txs.run(identity, async (tx) => {
      await tx.watchlistEntry.update({
        where: { id },
        data: { statusCode: "REMOVED" },
      });
      await this.record(
        tx,
        identity,
        "WATCHLIST_ENTRY_REMOVED",
        "WatchlistEntry",
        id,
        null,
        {
          resourceType: row.resourceType,
          resourceId: row.resourceId,
        },
      );
    });
    return { data: { success: true, resourceId: id, statusCode: "REMOVED" } };
  }

  async listRepeatBusiness(
    identity: CustomerIdentity,
    query: IntelligenceListQuery,
  ) {
    this.require(identity, permissions.repeatBusinessView);
    const portal = identity.roles.some(({ code }) =>
      ["PORTAL_CUSTOMER", "CUSTOMER_PORTAL_USER"].includes(code),
    );
    const countries = scopedCountries(identity, query.countryCode);
    const where: Prisma.RepeatBusinessRequestWhereInput = portal
      ? { requestedByUserId: identity.userId }
      : {
          ...(countries.length
            ? { account: { countryCode: { in: countries } } }
            : {}),
          OR: [
            { assignedOwnerUserId: identity.userId },
            { account: { countryCode: { in: countries } } },
          ],
        };
    const [total, rows] = await this.db.$transaction([
      this.db.repeatBusinessRequest.count({ where }),
      this.db.repeatBusinessRequest.findMany({
        where,
        include: {
          account: {
            select: {
              id: true,
              accountRef: true,
              canonicalName: true,
              countryCode: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
    ]);
    return page(rows.map(repeatBusiness), total, query);
  }

  createRepeatBusiness(
    identity: CustomerIdentity,
    input: CreateRepeatBusinessRequestDto,
  ) {
    this.require(identity, permissions.repeatBusinessCreate);
    return this.txs.run(identity, async (tx) => {
      const account = await tx.account.findUnique({
        where: { id: input.accountId },
      });
      if (!account) missing("ACCOUNT_NOT_FOUND");
      const portal = identity.roles.some(({ code }) =>
        ["PORTAL_CUSTOMER", "CUSTOMER_PORTAL_USER"].includes(code),
      );
      if (!portal && !identity.countryCodes.has(account.countryCode.trim()))
        missing("ACCOUNT_NOT_FOUND");
      const row = await tx.repeatBusinessRequest.create({
        data: {
          accountId: account.id,
          subject: input.subject.trim(),
          description: input.description.trim(),
          requestedByUserId: identity.userId,
          assignedOwnerUserId: account.ownerUserId,
        },
      });
      await notify(tx, {
        recipientUserId: account.ownerUserId,
        typeCode: "REPEAT_BUSINESS_REQUEST",
        titleSafe: `Repeat business request: ${input.subject.trim()}`,
        bodySafe: `Customer ${account.canonicalName} submitted a repeat business request.`,
        resourceTypeCode: "REPEAT_BUSINESS_REQUEST",
        resourceId: row.id,
        actionCode: "OPEN_REPEAT_BUSINESS_REQUEST",
      });
      await this.record(
        tx,
        identity,
        "REPEAT_BUSINESS_REQUEST_CREATED",
        "RepeatBusinessRequest",
        row.id,
        account.countryCode,
        {
          accountId: account.id,
          assignedOwnerUserId: account.ownerUserId,
          createsOrder: false,
          createsOpportunity: false,
        },
      );
      return { data: repeatBusiness({ ...row, account }) };
    });
  }

  async updateRepeatBusiness(
    identity: CustomerIdentity,
    id: string,
    input: UpdateRepeatBusinessRequestDto,
  ) {
    this.require(identity, permissions.repeatBusinessManage);
    const existing = await this.db.repeatBusinessRequest.findUnique({
      where: { id },
      include: { account: true },
    });
    if (
      !existing ||
      !identity.countryCodes.has(existing.account.countryCode.trim())
    ) {
      missing("REPEAT_BUSINESS_REQUEST_NOT_FOUND");
    }
    return this.txs.run(identity, async (tx) => {
      const row = await tx.repeatBusinessRequest.update({
        where: { id },
        data: {
          statusCode: input.statusCode,
          salesResponse: input.salesResponse ?? null,
          rowVersion: { increment: 1 },
        },
        include: { account: true },
      });
      await this.record(
        tx,
        identity,
        "REPEAT_BUSINESS_REQUEST_UPDATED",
        "RepeatBusinessRequest",
        row.id,
        row.account.countryCode,
        {
          statusCode: row.statusCode,
          createsOrder: false,
          createsOpportunity: false,
        },
      );
      return { data: repeatBusiness(row) };
    });
  }

  private require(identity: CustomerIdentity, permission: string) {
    if (
      identity.deniedPermissions.has(permission) ||
      !identity.permissions.has(permission)
    ) {
      throw new ApiProblem({ status: 403, code: "FORBIDDEN" });
    }
  }

  private async requireWatchResource(
    tx: TransactionClient,
    identity: CustomerIdentity,
    type: string,
    id: string,
  ) {
    const row =
      type === "MARKET_SIGNAL"
        ? await tx.marketSignal.findUnique({ where: { id } })
        : type === "TARGET_MARKET"
          ? await tx.targetMarket.findUnique({ where: { id } })
          : type === "TARGET_ACCOUNT"
            ? await tx.targetAccount.findUnique({ where: { id } })
            : await tx.competitor.findUnique({ where: { id } });
    if (!row) missing("WATCHLIST_RESOURCE_NOT_FOUND");
    const country = "countryCode" in row ? row.countryCode?.trim() : null;
    if (country && !identity.countryCodes.has(country))
      missing("WATCHLIST_RESOURCE_NOT_FOUND");
  }

  private record(
    tx: TransactionClient,
    identity: CustomerIdentity,
    actionCode: string,
    resourceType: string,
    resourceId: string,
    countryCode: string | null,
    metadata: Record<string, unknown>,
  ) {
    return this.audit.record(tx, {
      actorUserId: identity.userId,
      actorSessionId: identity.sessionId,
      actionCode,
      resourceType,
      resourceId,
      workspace: "SALES",
      countryCode: countryCode?.trim() ?? null,
      metadata,
      traceId: identity.traceId,
      correlationId: identity.correlationId,
      source: "market-intelligence-api",
    });
  }
}

function scopedCountries(identity: CustomerIdentity, requested?: string) {
  if (requested && !identity.countryCodes.has(requested))
    missing("RESOURCE_NOT_FOUND");
  return requested ? [requested] : [...identity.countryCodes];
}
function requireCountry(identity: CustomerIdentity, country?: string) {
  if (country && !identity.countryCodes.has(country))
    missing("RESOURCE_NOT_FOUND");
}
function page<T>(items: T[], total: number, query: IntelligenceListQuery) {
  return {
    data: items,
    page: {
      number: query.page,
      size: query.limit,
      totalItems: total,
      totalPages: Math.ceil(total / query.limit),
    },
  };
}
function signal(row: Prisma.MarketSignalGetPayload<object>) {
  return {
    ...row,
    countryCode: row.countryCode?.trim() ?? null,
    publishedDate: row.publishedDate.toISOString().slice(0, 10),
    retrievedDate: row.retrievedDate.toISOString().slice(0, 10),
    eventDate: row.eventDate?.toISOString().slice(0, 10) ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    rowVersion: row.rowVersion.toString(),
  };
}
function targetMarket(row: Prisma.TargetMarketGetPayload<object>) {
  return {
    ...row,
    countryCode: row.countryCode.trim(),
    priorityScore: row.priorityScore?.toString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    rowVersion: row.rowVersion.toString(),
  };
}
function targetAccount(row: Prisma.TargetAccountGetPayload<object>) {
  return {
    ...row,
    countryCode: row.countryCode.trim(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    rowVersion: row.rowVersion.toString(),
  };
}
function competitor(row: Prisma.CompetitorGetPayload<object>) {
  return {
    ...row,
    countryCode: row.countryCode?.trim() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    rowVersion: row.rowVersion.toString(),
  };
}
function repeatBusiness(
  row: Prisma.RepeatBusinessRequestGetPayload<object> & {
    account: {
      id: string;
      accountRef: string;
      canonicalName: string;
      countryCode: string;
    };
  },
) {
  return {
    ...row,
    account: {
      id: row.account.id,
      accountRef: row.account.accountRef,
      canonicalName: row.account.canonicalName,
      countryCode: row.account.countryCode.trim(),
    },
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    rowVersion: row.rowVersion.toString(),
  };
}
function normalize(value: string) {
  return value.trim().toLocaleLowerCase("en").replace(/\s+/g, " ");
}
function missing(code: string): never {
  throw new ApiProblem({ status: 404, code });
}
function rule(code: string): never {
  throw new ApiProblem({ status: 422, code });
}
