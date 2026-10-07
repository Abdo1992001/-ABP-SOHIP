import { Inject, Injectable } from "@nestjs/common";
import { Prisma, type DatabaseClient } from "@abp/database";
import { ApiProblem } from "../platform/api-exception.filter.js";
import { databaseClientToken } from "../platform/database.providers.js";
import {
  canUseManagerContext,
  hasWorkspace,
  isSystemAdmin,
  type CustomerIdentity,
} from "../customer/customer-auth.js";
import type {
  DismissDto,
  GenerateAdvisoryDto,
  MarkAllDto,
  PreferencesDto,
  ScopedQuery,
  SearchQuery,
} from "./insight.dto.js";
import { OpenAiAdvisoryService } from "./openai-advisory.service.js";
@Injectable()
export class InsightService {
  constructor(
    @Inject(databaseClientToken) private readonly db: DatabaseClient,
    private readonly externalAi: OpenAiAdvisoryService,
  ) {}
  async notifications(i: CustomerIdentity, q: ScopedQuery) {
    const s = skip(q),
      now = new Date(),
      where = {
        recipientUserId: i.userId,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      };
    const [total, rows, unreadCount] = await this.db.$transaction([
      this.db.userNotification.count({ where }),
      this.db.userNotification.findMany({
        where,
        skip: s,
        take: q.limit,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      }),
      this.db.userNotification.count({ where: { ...where, readAt: null } }),
    ]);
    return {
      data: rows.map(notification),
      meta: { ...meta(s, q.limit, total, rows.length), unreadCount },
    };
  }
  async read(i: CustomerIdentity, id: string) {
    const row = await this.db.userNotification.findFirst({
      where: { id, recipientUserId: i.userId },
    });
    if (!row) missing();
    await this.db.userNotification.update({
      where: { id },
      data: { readAt: row.readAt ?? new Date() },
    });
    return { data: { success: true, resourceId: id, statusCode: "READ" } };
  }
  async readAll(i: CustomerIdentity, b: MarkAllDto) {
    const before = b.before ? new Date(b.before) : new Date();
    await this.db.userNotification.updateMany({
      where: {
        recipientUserId: i.userId,
        readAt: null,
        createdAt: { lte: before },
      },
      data: { readAt: new Date() },
    });
    return { data: { success: true, statusCode: "READ" } };
  }
  async preferences(i: CustomerIdentity) {
    const row = await this.db.userPreference.upsert({
      where: { userId: i.userId },
      create: { userId: i.userId },
      update: {},
    });
    return { data: pref(row), etag: tag(row.rowVersion) };
  }
  async updatePreferences(i: CustomerIdentity, t: string, b: PreferencesDto) {
    if (Object.keys(b.preferences).length > 100) rule("PREFERENCES_TOO_LARGE");
    const expected = etag(t),
      n = await this.db.userPreference.updateMany({
        where: { userId: i.userId, rowVersion: expected },
        data: {
          preferences: b.preferences as Prisma.InputJsonValue,
          rowVersion: { increment: 1 },
        },
      });
    if (n.count !== 1) precondition();
    return this.preferences(i);
  }
  async advisories(i: CustomerIdentity, q: ScopedQuery) {
    this.require(i, "ai.advisory.view");
    const s = skip(q),
      where = {
        recipientUserId: i.userId,
        countryCode: { in: [...i.countryCodes] },
        statusCode: { in: ["ACTIVE", "STALE"] },
      };
    const [total, rows] = await this.db.$transaction([
      this.db.aiRuleOutput.count({ where }),
      this.db.aiRuleOutput.findMany({
        where,
        skip: s,
        take: q.limit,
        orderBy: [{ generatedAt: "desc" }, { id: "asc" }],
      }),
    ]);
    return {
      data: rows.map(advisory),
      meta: meta(s, q.limit, total, rows.length),
      analyticsMetadata: analytics(
        "ai-advisory",
        "Persisted advisory outputs; never authoritative decisions",
        i,
      ),
    };
  }

  async generateAdvisory(i: CustomerIdentity, input: GenerateAdvisoryDto) {
    this.require(i, "ai.advisory.view");
    const type = input.resourceTypeCode.trim().toUpperCase();
    const context = await this.advisoryContext(i, type, input.resourceId);
    if (!context) missing();
    let result: { text: string; responseId: string | null };
    try {
      result = await this.externalAi.generate(context);
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : "EXTERNAL_AI_ERROR";
      if (reason === "EXTERNAL_AI_DISABLED")
        throw new ApiProblem({
          status: 503,
          code: "DEPENDENCY_UNAVAILABLE",
          messageKey: "errors.external_ai_disabled",
        });
      throw new ApiProblem({
        status: 503,
        code: "DEPENDENCY_UNAVAILABLE",
        messageKey: "errors.external_ai_unavailable",
      });
    }
    const row = await this.db.aiRuleOutput.create({
      data: {
        recipientUserId: i.userId,
        ruleCode: "OPENAI_COMMERCIAL_ADVISORY",
        ruleVersion: process.env.OPENAI_MODEL ?? "gpt-5.2",
        resourceTypeCode: type,
        resourceId: input.resourceId,
        countryCode: [...i.countryCodes][0] ?? null,
        outputTypeCode: "EXTERNAL_REVIEW",
        outputJson: { text: result.text, provider: "OPENAI_RESPONSES" },
        explanationJson: {
          source: "OPENAI",
          responseId: result.responseId,
          authoritative: false,
        },
      },
    });
    await this.db.auditEvent.create({
      data: {
        actorUserId: i.userId,
        actorSessionId: i.sessionId,
        actionCode: "AI_EXTERNAL_ADVISORY_GENERATED",
        resourceType: "AI_RULE_OUTPUT",
        resourceId: row.id,
        workspace: "SALES",
        countryCode: row.countryCode,
        metadata: { provider: "OPENAI_RESPONSES", model: row.ruleVersion },
        traceId: i.traceId,
        correlationId: i.correlationId,
        source: "API",
      },
    });
    return { data: advisory(row) };
  }

  private async advisoryContext(
    i: CustomerIdentity,
    type: string,
    id: string,
  ): Promise<string | null> {
    const countries = [...i.countryCodes];
    if (type === "ACCOUNT") {
      const row = await this.db.account.findFirst({
        where: {
          id,
          countryCode: { in: countries },
          recordStatusCode: "ACTIVE",
        },
        select: {
          canonicalName: true,
          countryCode: true,
          accountCategoryCode: true,
          defaultCurrencyCode: true,
        },
      });
      return row
        ? `Review this commercial account. Country: ${row.countryCode}. Category: ${row.accountCategoryCode}. Currency: ${row.defaultCurrencyCode}. Use the account name only as a label: ${row.canonicalName}.`
        : null;
    }
    if (type === "TARGET_ACCOUNT") {
      const row = await this.db.targetAccount.findFirst({
        where: { id, countryCode: { in: countries } },
        select: {
          companyName: true,
          countryCode: true,
          segmentCode: true,
          rationale: true,
        },
      });
      return row
        ? `Review this researched target account. Country: ${row.countryCode}. Segment: ${row.segmentCode ?? "UNCLASSIFIED"}. Rationale: ${row.rationale}. Label: ${row.companyName}.`
        : null;
    }
    if (type === "OPPORTUNITY") {
      const row = await this.db.opportunity.findFirst({
        where: { id, countryCode: { in: countries } },
        select: {
          name: true,
          countryCode: true,
          stageCode: true,
          estimatedValue: true,
          currencyCode: true,
        },
      });
      return row
        ? `Review this sales opportunity. Country: ${row.countryCode}. Stage: ${row.stageCode}. Estimated value: ${row.estimatedValue?.toString() ?? "UNSPECIFIED"} ${row.currencyCode}. Label: ${row.name}.`
        : null;
    }
    return null;
  }
  async dismiss(i: CustomerIdentity, id: string, b: DismissDto) {
    this.require(i, "ai.advisory.view");
    const row = await this.db.aiRuleOutput.findFirst({
      where: {
        id,
        recipientUserId: i.userId,
        countryCode: { in: [...i.countryCodes] },
      },
    });
    if (!row) missing();
    await this.db.aiRuleOutput.update({
      where: { id },
      data: { statusCode: "DISMISSED" },
    });
    await this.db.auditEvent.create({
      data: {
        actorUserId: i.userId,
        actorSessionId: i.sessionId,
        actionCode: "AI_ADVISORY_DISMISSED",
        resourceType: "AI_RULE_OUTPUT",
        resourceId: id,
        workspace: "SALES",
        countryCode: row.countryCode,
        metadata: { reasonCode: b.reasonCode ?? null },
        traceId: i.traceId,
        correlationId: i.correlationId,
        source: "API",
      },
    });
    return { data: { success: true, resourceId: id, statusCode: "DISMISSED" } };
  }
  /**
   * The salesperson's work list.
   *
   * It is deliberately not "my activities": a work list that only knows about
   * activities misses the two things that actually lose deals — a quotation that
   * expires unanswered, and a draft that was never sent. Each item carries where
   * to go and act on it, because a queue you cannot act from is just a list of
   * regrets.
   */
  async queue(i: CustomerIdentity, q: ScopedQuery) {
    const now = new Date();
    const soon = new Date(now.getTime() + 14 * 86_400_000);
    const staleBefore = new Date(now.getTime() - 7 * 86_400_000);
    const countries = [...i.countryCodes];

    const [activities, expiring, staleDrafts] = await Promise.all([
      this.db.activity.findMany({
        where: {
          ownerUserId: i.userId,
          countryCode: { in: countries },
          taskStatusCode: { notIn: ["COMPLETED", "CANCELLED"] },
          OR: [{ dueAt: { not: null } }, { scheduledAt: { not: null } }],
        },
        include: { links: true },
        orderBy: [{ dueAt: "asc" }, { id: "asc" }],
        take: 200,
      }),
      this.db.quotation.findMany({
        where: {
          countryCode: { in: countries },
          statusCode: { in: ["SENT", "SUBMITTED", "UNDER_REVIEW"] },
          expiresOn: { not: null, lte: soon },
        },
        include: { account: { select: { canonicalName: true } } },
        orderBy: [{ expiresOn: "asc" }],
        take: 100,
      }),
      this.db.quotation.findMany({
        where: {
          countryCode: { in: countries },
          statusCode: "DRAFT",
          updatedAt: { lt: staleBefore },
        },
        include: { account: { select: { canonicalName: true } } },
        orderBy: [{ updatedAt: "asc" }],
        take: 50,
      }),
    ]);

    type Item = {
      sourceTypeCode: string;
      sourceId: string;
      actionCode: string;
      title: string;
      subtitle: string | null;
      href: string | null;
      dueAt: string | null;
      priorityCode: string;
      amount: string | null;
      currencyCode: string | null;
    };
    const items: Item[] = [];

    const endOfToday = new Date(now);
    endOfToday.setHours(23, 59, 59, 999);
    const priorityOf = (due: Date | null) => {
      if (due === null) return "NORMAL";
      if (due < now) return "OVERDUE";
      if (due <= endOfToday) return "TODAY";
      return "UPCOMING";
    };

    for (const activity of activities) {
      const due = activity.dueAt ?? activity.scheduledAt;
      // A follow-up filed against a quotation should open that quotation, not
      // the customer record — the quotation is what the conversation is about.
      const quotationLink = activity.links.find(
        (link) => link.resourceTypeCode === "QUOTATION",
      );
      const accountLink = activity.links.find(
        (link) => link.resourceTypeCode === "ACCOUNT",
      );
      items.push({
        sourceTypeCode: "ACTIVITY",
        sourceId: activity.id,
        actionCode: activity.typeCode === "MEETING" ? "MEETING" : "FOLLOW_UP",
        title: activity.subject ?? activity.typeCode,
        subtitle: null,
        href: quotationLink
          ? `/quotations/${quotationLink.resourceId}`
          : accountLink
            ? `/customers/${accountLink.resourceId}`
            : "/activities",
        dueAt: due?.toISOString() ?? null,
        priorityCode: priorityOf(due),
        amount: null,
        currencyCode: null,
      });
    }

    for (const quotation of expiring) {
      const due = quotation.expiresOn;
      items.push({
        sourceTypeCode: "QUOTATION",
        sourceId: quotation.id,
        actionCode: "QUOTATION_EXPIRING",
        title: quotation.quotationRef,
        subtitle: quotation.account?.canonicalName ?? null,
        href: `/quotations/${quotation.id}`,
        dueAt: due?.toISOString() ?? null,
        priorityCode: priorityOf(due),
        amount: quotation.totalAmount?.toString() ?? null,
        currencyCode: quotation.currencyCode,
      });
    }

    for (const quotation of staleDrafts) {
      items.push({
        sourceTypeCode: "QUOTATION",
        sourceId: quotation.id,
        actionCode: "DRAFT_NOT_SENT",
        title: quotation.quotationRef,
        subtitle: quotation.account?.canonicalName ?? null,
        href: `/quotations/${quotation.id}`,
        dueAt: quotation.updatedAt.toISOString(),
        priorityCode: "STALE",
        amount: quotation.totalAmount?.toString() ?? null,
        currencyCode: quotation.currencyCode,
      });
    }

    const rank: Record<string, number> = {
      OVERDUE: 0,
      TODAY: 1,
      STALE: 2,
      UPCOMING: 3,
      NORMAL: 4,
    };
    items.sort((a, b) => {
      const byPriority =
        (rank[a.priorityCode] ?? 9) - (rank[b.priorityCode] ?? 9);
      if (byPriority !== 0) return byPriority;
      return (a.dueAt ?? "").localeCompare(b.dueAt ?? "");
    });

    const start = skip(q);
    const page = items.slice(start, start + q.limit);
    return {
      data: page,
      meta: meta(start, q.limit, items.length, page.length),
      analyticsMetadata: analytics(
        "action-queue",
        "Due activities, expiring quotations and unsent drafts in effective scope",
        i,
      ),
    };
  }
  async search(i: CustomerIdentity, q: SearchQuery) {
    this.require(i, "search.use");
    const term = (q.search ?? q.q ?? "").trim();
    if (term.length < 2) rule("SEARCH_TERM_TOO_SHORT");
    const s = skip(q),
      take = Math.min(q.limit, 50);
    const accountAccess: Prisma.AccountWhereInput = {
      countryCode: { in: [...i.countryCodes] },
      recordStatusCode: "ACTIVE",
      // `[{}]` inside an `OR` array matches nothing in Prisma, not everything —
      // `{ id: { not: "00000000-0000-0000-0000-000000000000" } }` is the
      // always-true fix, matching accessContextWhere in customer.service.
      OR: isSystemAdmin(i)
        ? [{ id: { not: "00000000-0000-0000-0000-000000000000" } }]
        : [
            { ownerUserId: i.userId },
            {
              shares: {
                some: { recipientUserId: i.userId, statusCode: "ACTIVE" },
              },
            },
            ...(canUseManagerContext(i)
              ? [{ owner: { profile: { managerUserId: i.userId } } }]
              : []),
          ],
    };
    const accounts = await this.db.account.findMany({
      where: {
        ...accountAccess,
        AND: [
          {
            OR: [
              { canonicalName: { contains: term, mode: "insensitive" } },
              { accountRef: { contains: term, mode: "insensitive" } },
            ],
          },
        ],
      },
      take,
      orderBy: { updatedAt: "desc" },
    });
    const contacts = await this.db.contact.findMany({
      where: {
        statusCode: "ACTIVE",
        account: accountAccess,
        OR: [
          { displayName: { contains: term, mode: "insensitive" } },
          { jobTitle: { contains: term, mode: "insensitive" } },
          {
            account: {
              canonicalName: { contains: term, mode: "insensitive" },
            },
          },
        ],
      },
      take,
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      include: {
        account: {
          select: { canonicalName: true, accountRef: true },
        },
      },
    });
    const projects = await this.db.project.findMany({
      where: {
        countryCode: { in: [...i.countryCodes] },
        OR: isSystemAdmin(i)
          ? [{ id: { not: "00000000-0000-0000-0000-000000000000" } }]
          : [
              { commercialOwnerUserId: i.userId },
              {
                parties: {
                  some: { accountId: { in: accounts.map((x) => x.id) } },
                },
              },
            ],
        AND: [
          {
            OR: [
              { name: { contains: term, mode: "insensitive" } },
              { projectRef: { contains: term, mode: "insensitive" } },
            ],
          },
        ],
      },
      take,
      orderBy: { updatedAt: "desc" },
    });
    // A salesperson searches for a quote number or a deal far more often than
    // for a project, so both are part of global search.
    const opportunities = await this.db.opportunity.findMany({
      where: {
        countryCode: { in: [...i.countryCodes] },
        account: accountAccess,
        OR: [
          { title: { contains: term, mode: "insensitive" } },
          { opportunityRef: { contains: term, mode: "insensitive" } },
        ],
      },
      take,
      orderBy: { updatedAt: "desc" },
      include: { account: { select: { canonicalName: true } } },
    });
    const quotations = await this.db.quotation.findMany({
      where: {
        countryCode: { in: [...i.countryCodes] },
        account: accountAccess,
        quotationRef: { contains: term, mode: "insensitive" },
      },
      take,
      orderBy: { updatedAt: "desc" },
      include: { account: { select: { canonicalName: true } } },
    });
    // Products and order history are the two biggest things in this database,
    // and until they were searchable a user could see 2,900 products on a
    // dashboard and still have no way to look one up by name or code.
    const products = await this.db.product.findMany({
      where: {
        recordStatusCode: "ACTIVE",
        OR: [
          { canonicalDescription: { contains: term, mode: "insensitive" } },
          { skuCode: { contains: term, mode: "insensitive" } },
          { barcode: { contains: term, mode: "insensitive" } },
          { productRef: { contains: term, mode: "insensitive" } },
        ],
      },
      take,
      orderBy: [{ canonicalDescription: "asc" }],
    });
    const salesOrders = await this.db.eRPOrder.findMany({
      where: {
        countryCode: { in: [...i.countryCodes] },
        account: accountAccess,
        OR: [
          { sourceOrderKey: { contains: term, mode: "insensitive" } },
          { customerPoNumber: { contains: term, mode: "insensitive" } },
        ],
      },
      take,
      orderBy: [{ orderDate: "desc" }],
      include: { account: { select: { canonicalName: true } } },
    });

    const all = [
      ...accounts.map((x) => ({
        resourceTypeCode: "ACCOUNT",
        resourceId: x.id,
        primaryText: x.canonicalName,
        secondaryText: x.accountRef,
        badgeCode: x.accountCategoryCode,
      })),
      ...contacts.map((x) => ({
        resourceTypeCode: "CONTACT",
        resourceId: x.id,
        primaryText: x.displayName,
        secondaryText: `${x.account.canonicalName} · ${x.jobTitle ?? x.account.accountRef}`,
        badgeCode: x.jobTitle,
      })),
      ...projects.map((x) => ({
        resourceTypeCode: "PROJECT",
        resourceId: x.id,
        primaryText: x.name,
        secondaryText: x.projectRef,
        badgeCode: x.stageCode,
      })),
      ...quotations.map((x) => ({
        resourceTypeCode: "QUOTATION",
        resourceId: x.id,
        primaryText: x.quotationRef,
        secondaryText: x.account.canonicalName,
        badgeCode: x.statusCode,
      })),
      ...opportunities.map((x) => ({
        resourceTypeCode: "OPPORTUNITY",
        resourceId: x.id,
        primaryText: x.title ?? x.opportunityRef,
        secondaryText: `${x.account.canonicalName} · ${x.opportunityRef}`,
        badgeCode: x.stageCode,
      })),
      ...salesOrders.map((x) => ({
        resourceTypeCode: "SALES_ORDER",
        resourceId: x.id,
        primaryText: x.sourceOrderKey,
        secondaryText: x.account?.canonicalName ?? x.customerNameRaw ?? "",
        badgeCode: x.statusCode,
      })),
      ...products.map((x) => ({
        resourceTypeCode: "PRODUCT",
        resourceId: x.id,
        primaryText: x.canonicalDescription,
        secondaryText: x.barcode ?? x.skuCode ?? x.productRef,
        badgeCode: x.productStatusCode,
      })),
    ];
    return {
      data: all.slice(s, s + take),
      meta: meta(
        s,
        take,
        all.length,
        Math.min(take, Math.max(0, all.length - s)),
      ),
    };
  }
  async auditEvents(i: CustomerIdentity, q: ScopedQuery) {
    this.require(i, "audit.view");
    const s = skip(q),
      where = {
        OR: [
          { countryCode: { in: [...i.countryCodes] } },
          { actorUserId: i.userId },
        ],
      };
    const [total, rows] = await this.db.$transaction([
      this.db.auditEvent.count({ where }),
      this.db.auditEvent.findMany({
        where,
        skip: s,
        take: q.limit,
        orderBy: [{ occurredAt: "desc" }, { id: "asc" }],
      }),
    ]);
    return {
      data: rows.map((x) => ({
        auditEventId: x.id,
        actorUserId: x.actorUserId,
        actorTypeCode: x.actorUserId ? "USER" : "SYSTEM",
        resourceTypeCode: x.resourceType,
        resourceId: uuid(x.resourceId) ? x.resourceId : null,
        actionCode: x.actionCode,
        // The before/after columns are the audit trail's whole point: the
        // reader wants to know what moved, not just that something was saved.
        // They were being dropped here and `metadata` -- which most writers
        // never set -- was surfaced in their place under the name diffJsonb,
        // so the timeline had nothing to draw and rendered every event as a
        // bare line with a timestamp.
        diffJsonb: {
          ...(redact(x.metadata) ?? {}),
          ...(x.beforeSnapshot === null
            ? {}
            : { beforeSnapshot: redact(x.beforeSnapshot) }),
          ...(x.afterSnapshot === null
            ? {}
            : { afterSnapshot: redact(x.afterSnapshot) }),
        },
        reason: null,
        createdAt: x.occurredAt.toISOString(),
      })),
      meta: meta(s, q.limit, total, rows.length),
    };
  }
  async securityEvents(i: CustomerIdentity, q: ScopedQuery) {
    this.require(i, "security-audit.view", false);
    const s = skip(q),
      [total, rows] = await this.db.$transaction([
        this.db.securityEvent.count(),
        this.db.securityEvent.findMany({
          skip: s,
          take: q.limit,
          orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        }),
      ]);
    return {
      data: rows.map((x) => ({
        securityEventId: x.id,
        eventTypeCode: x.eventTypeCode,
        actorUserId: x.actorUserId,
        subjectUserId: x.subjectUserId,
        resourceTypeCode: x.resourceTypeCode,
        resourceId: x.resourceId,
        ipHash: null,
        userAgent: null,
        metadataJsonb: redact(x.metadata),
        traceId: x.traceId,
        createdAt: x.createdAt.toISOString(),
      })),
      meta: meta(s, q.limit, total, rows.length),
    };
  }
  async metrics(i: CustomerIdentity) {
    this.require(i, "reports.commercial");
    // Reported in EGP, not USD. The imported orders are a mix of EGP and USD,
    // and filtering to one of them reported a quarter of the order book while
    // presenting it as the whole of it.
    const where = {
      countryCode: { in: [...i.countryCodes] },
      dqStatusCode: "VALID",
    };
    const agg = await this.db.eRPOrder.aggregate({
        where,
        _sum: { bookedAmount: true, shippedAmount: true, invoicedAmount: true },
      }),
      pay = await this.db.payment.aggregate({
        where: {
          statusCode: { not: "VOIDED" },
          account: { countryCode: { in: [...i.countryCodes] } },
        },
        _sum: { amount: true },
      });
    const now = new Date().toISOString();
    return {
      data: {
        bookedAmount: agg._sum.bookedAmount?.toString() ?? "0",
        shippedAmount: agg._sum.shippedAmount?.toString() ?? "0",
        invoicedAmount: agg._sum.invoicedAmount?.toString() ?? "0",
        collectedAmount: pay._sum.amount?.toString() ?? "0",
        currencyCode: "EGP",
        asOf: now,
      },
      analyticsMetadata: analytics(
        "commercial-facts",
        "ERP evidence facts; amounts are not net sales",
        i,
      ),
    };
  }
  async report(i: CustomerIdentity, code: string, permission: string) {
    this.require(i, permission, code !== "FINANCE");
    if (
      code === "FINANCE" &&
      (i.deniedPermissions.has("payments.view") ||
        !i.permissions.has("payments.view"))
    )
      forbid();
    let series: {
      key: string;
      label: string;
      value: string;
      count: number | null;
    }[] = [];
    if (code === "PIPELINE") {
      const rows = await this.db.opportunity.groupBy({
        by: ["stageCode"],
        where: {
          countryCode: { in: [...i.countryCodes] },
          currencyCode: "USD",
        },
        _count: true,
        _sum: { estimatedValue: true },
      });
      series = rows.map((x) => ({
        key: x.stageCode,
        label: x.stageCode,
        value: x._sum.estimatedValue?.toString() ?? "0",
        count: x._count,
      }));
    } else if (code === "QUOTATIONS") {
      const rows = await this.db.quotation.groupBy({
        by: ["statusCode"],
        where: {
          countryCode: { in: [...i.countryCodes] },
          currencyCode: "USD",
        },
        _count: true,
        _sum: { totalAmount: true },
      });
      series = rows.map((x) => ({
        key: x.statusCode,
        label: x.statusCode,
        value: x._sum.totalAmount?.toString() ?? "0",
        count: x._count,
      }));
    } else if (code === "ORDERS") {
      const rows = await this.db.eRPOrder.groupBy({
        by: ["statusCode"],
        where: {
          countryCode: { in: [...i.countryCodes] },
          dqStatusCode: "VALID",
        },
        _count: true,
        _sum: { bookedAmount: true },
      });
      series = rows.map((x) => ({
        key: x.statusCode,
        label: x.statusCode,
        value: x._sum.bookedAmount?.toString() ?? "0",
        count: x._count,
      }));
    } else {
      const rows = await this.db.payment.groupBy({
        by: ["statusCode"],
        where: {
          currencyCode: "USD",
          statusCode: { not: "VOIDED" },
          account: { countryCode: { in: [...i.countryCodes] } },
        },
        _count: true,
        _sum: { amount: true },
      });
      series = rows.map((x) => ({
        key: x.statusCode,
        label: x.statusCode,
        value: x._sum.amount?.toString() ?? "0",
        count: x._count,
      }));
    }
    return {
      data: {
        reportCode: code,
        generatedAt: new Date().toISOString(),
        // Imported order history is compared in EGP; the pipeline and quotation
        // reports are still priced in USD.
        currencyCode: code === "ORDERS" ? "EGP" : "USD",
        metrics: {
          recordCount: series.reduce((a, x) => a + (x.count ?? 0), 0),
        },
        series,
      },
      analyticsMetadata: analytics(
        `report-${code.toLowerCase()}`,
        "Server-side governed aggregate",
        i,
      ),
    };
  }
  /**
   * Commercial history from the imported ERP sales orders.
   *
   * Amounts are summed in EGP (`line_amount_egp`), which is the one column in
   * the source export that is already converted to a single currency — summing
   * the mixed-currency `line_amount` would produce a number that means nothing.
   *
   * External and intercompany figures are kept apart everywhere. More than half
   * of these orders are to ACROW group companies; folding them into "sales"
   * would overstate the external market by a factor of two.
   */
  async salesHistory(
    i: CustomerIdentity,
    query: { from?: string; to?: string } = {},
  ) {
    this.require(i, "reports.orders");
    const countries = [...i.countryCodes];
    // A user with no country grants sees nothing, rather than everything.
    const countryScope = isSystemAdmin(i)
      ? Prisma.sql`TRUE`
      : Prisma.sql`o.country_code IN (${Prisma.join(countries.length > 0 ? countries : [" "])})`;
    // The dashboard's period switch reaches every panel, not just the target
    // cards: a "this month" view that still lists the year's top customers is
    // two different questions on one screen. Omitting the window keeps the
    // whole history, which is what every other caller wants.
    const from = query.from ? new Date(query.from) : null;
    const to = query.to ? new Date(query.to) : null;
    const reportingWindow =
      from && to
        ? Prisma.sql`AND o.order_date >= ${from} AND o.order_date < ${to}`
        : Prisma.empty;
    const scope = Prisma.sql`${countryScope} ${reportingWindow}`;

    const [totals] = await this.db.$queryRaw<
      {
        external_value: string | null;
        group_value: string | null;
        order_count: bigint;
        customer_count: bigint;
        item_count: bigint;
      }[]
    >(Prisma.sql`
      SELECT
        COALESCE(SUM(l.line_amount_egp) FILTER (WHERE NOT o.is_intercompany), 0)::text AS external_value,
        COALESCE(SUM(l.line_amount_egp) FILTER (WHERE o.is_intercompany), 0)::text     AS group_value,
        COUNT(DISTINCT o.erp_order_id)  AS order_count,
        COUNT(DISTINCT o.account_id)    AS customer_count,
        COUNT(l.erp_order_line_id)      AS item_count
      FROM erp_orders o
      JOIN erp_order_lines l ON l.erp_order_id = o.erp_order_id
      WHERE ${scope}`);

    const topCountries = await this.db.$queryRaw<
      {
        country_code: string;
        country_name: string;
        value: string;
        order_count: bigint;
      }[]
    >(Prisma.sql`
      SELECT o.country_code, c.name AS country_name,
             COALESCE(SUM(l.line_amount_egp), 0)::text AS value,
             COUNT(DISTINCT o.erp_order_id) AS order_count
      FROM erp_orders o
      JOIN erp_order_lines l ON l.erp_order_id = o.erp_order_id
      JOIN countries c ON c.code = o.country_code
      WHERE ${scope} AND NOT o.is_intercompany
      GROUP BY o.country_code, c.name
      ORDER BY SUM(l.line_amount_egp) DESC NULLS LAST
      -- The dashboard charts the top five and lets the reader open the rest,
      -- so the endpoint has to carry the rest. Ten was enough for a list and
      -- is not enough for a breakdown you can drill into.
      LIMIT 100`);

    const topCustomers = await this.db.$queryRaw<
      {
        account_id: string;
        name: string;
        country_code: string;
        relationship_type_code: string;
        value: string;
        order_count: bigint;
        last_order_date: Date | null;
      }[]
    >(Prisma.sql`
      SELECT a.account_id, a.canonical_name AS name, a.country_code,
             a.relationship_type_code,
             COALESCE(SUM(l.line_amount_egp), 0)::text AS value,
             COUNT(DISTINCT o.erp_order_id) AS order_count,
             MAX(o.order_date) AS last_order_date
      FROM erp_orders o
      JOIN accounts a ON a.account_id = o.account_id
      JOIN erp_order_lines l ON l.erp_order_id = o.erp_order_id
      WHERE ${scope}
      GROUP BY a.account_id, a.canonical_name, a.country_code, a.relationship_type_code
      ORDER BY SUM(l.line_amount_egp) DESC NULLS LAST
      LIMIT 100`);

    // Only items that resolved to a real product count here — a transportation
    // charge is not a product and must never appear in "top products sold".
    const topProducts = await this.db.$queryRaw<
      {
        product_id: string;
        description: string;
        quantity: string;
        value: string;
      }[]
    >(Prisma.sql`
      -- The item master genuinely contains several products with identical
      -- descriptions under different codes, so the code is appended: two rows
      -- reading exactly the same in a "top products" list look like a bug.
      SELECT p.product_id,
             p.canonical_description || ' · ' || COALESCE(p.barcode, p.sku_code, '') AS description,
             COALESCE(SUM(l.qty_booked), 0)::text        AS quantity,
             COALESCE(SUM(l.line_amount_egp), 0)::text   AS value
      FROM erp_order_lines l
      JOIN erp_orders o ON o.erp_order_id = l.erp_order_id
      JOIN products p ON p.product_id = l.product_id
      WHERE ${scope} AND l.item_classification_code = 'SELLABLE_PRODUCT'
      GROUP BY p.product_id, p.canonical_description, p.barcode, p.sku_code
      ORDER BY SUM(l.line_amount_egp) DESC NULLS LAST
      LIMIT 10`);

    const recentOrders = await this.db.$queryRaw<
      {
        order_id: string;
        order_number: string | null;
        account_id: string | null;
        account_name: string | null;
        country_code: string | null;
        order_date: Date | null;
        status_code: string;
        currency_code: string | null;
        value: string;
        line_count: number;
        is_intercompany: boolean;
      }[]
    >(Prisma.sql`
      SELECT o.erp_order_id AS order_id, o.order_number_raw AS order_number,
             o.account_id, a.canonical_name AS account_name, o.country_code,
             o.order_date, o.status_code, o.currency_code,
             COALESCE(o.total_amount_egp, 0)::text AS value,
             o.line_count, o.is_intercompany
      FROM erp_orders o
      LEFT JOIN accounts a ON a.account_id = o.account_id
      WHERE ${scope} AND o.order_date IS NOT NULL
      ORDER BY o.order_date DESC
      LIMIT 12`);

    const monthly = await this.db.$queryRaw<
      {
        period: string;
        external_value: string;
        group_value: string;
        order_count: bigint;
      }[]
    >(Prisma.sql`
      SELECT to_char(date_trunc('month', o.order_date), 'YYYY-MM') AS period,
             COALESCE(SUM(l.line_amount_egp) FILTER (WHERE NOT o.is_intercompany), 0)::text AS external_value,
             COALESCE(SUM(l.line_amount_egp) FILTER (WHERE o.is_intercompany), 0)::text     AS group_value,
             COUNT(DISTINCT o.erp_order_id) AS order_count
      FROM erp_orders o
      JOIN erp_order_lines l ON l.erp_order_id = o.erp_order_id
      WHERE ${scope} AND o.order_date IS NOT NULL
      GROUP BY 1
      ORDER BY 1 DESC
      LIMIT 24`);

    return {
      data: {
        currencyCode: "EGP",
        asOf: new Date().toISOString(),
        totals: {
          externalValue: totals?.external_value ?? "0",
          groupValue: totals?.group_value ?? "0",
          orderCount: Number(totals?.order_count ?? 0),
          customerCount: Number(totals?.customer_count ?? 0),
          itemCount: Number(totals?.item_count ?? 0),
        },
        topCountries: topCountries.map((row) => ({
          countryCode: row.country_code,
          countryName: row.country_name,
          value: row.value,
          orderCount: Number(row.order_count),
        })),
        topCustomers: topCustomers.map((row) => ({
          accountId: row.account_id,
          name: row.name,
          countryCode: row.country_code,
          relationshipTypeCode: row.relationship_type_code,
          value: row.value,
          orderCount: Number(row.order_count),
          lastOrderDate: row.last_order_date
            ? isoDate(row.last_order_date)
            : "",
        })),
        topProducts: topProducts.map((row) => ({
          productId: row.product_id,
          description: row.description,
          quantity: row.quantity,
          value: row.value,
        })),
        recentOrders: recentOrders.map((row) => ({
          orderId: row.order_id,
          orderNumber: row.order_number ?? "",
          accountId: row.account_id ?? "",
          accountName: row.account_name ?? "",
          countryCode: row.country_code ?? "",
          orderDate: row.order_date ? isoDate(row.order_date) : "",
          statusCode: row.status_code,
          currencyCode: row.currency_code ?? "EGP",
          value: row.value,
          lineCount: row.line_count,
          isIntercompany: row.is_intercompany,
        })),
        monthly: monthly
          .map((row) => ({
            period: row.period,
            externalValue: row.external_value,
            groupValue: row.group_value,
            orderCount: Number(row.order_count),
          }))
          .reverse(),
      },
      analyticsMetadata: analytics(
        "sales-history",
        "Imported ERP sales orders; external and intercompany separated",
        i,
      ),
    };
  }
  private require(i: CustomerIdentity, p: string, sales = true) {
    if (
      (sales && !hasWorkspace(i, "SALES")) ||
      i.deniedPermissions.has(p) ||
      !i.permissions.has(p)
    )
      forbid();
  }
}
const skip = (q: ScopedQuery) => q.offset ?? (q.page - 1) * q.limit;
const meta = (offset: number, limit: number, total: number, count: number) => ({
  page: Math.floor(offset / limit) + 1,
  offset,
  limit,
  total,
  hasNext: offset + count < total,
});
const tag = (x: bigint) => `\"rv-${x}\"`;
function etag(v: string) {
  const m = /^(?:W\/)?\"?rv-(\d+)\"?$/.exec(v.trim());
  if (!m) throw new ApiProblem({ status: 400, code: "IF_MATCH_REQUIRED" });
  return BigInt(m[1]!);
}
function notification(x: {
  id: string;
  recipientUserId: string;
  typeCode: string;
  titleSafe: string;
  bodySafe: string | null;
  resourceTypeCode: string | null;
  resourceId: string | null;
  actionCode: string | null;
  readAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
}) {
  return {
    notificationId: x.id,
    recipientUserId: x.recipientUserId,
    typeCode: x.typeCode,
    titleSafe: x.titleSafe,
    bodySafe: x.bodySafe,
    resourceTypeCode: x.resourceTypeCode,
    resourceId: x.resourceId,
    actionCode: x.actionCode,
    readAt: x.readAt?.toISOString() ?? null,
    expiresAt: x.expiresAt?.toISOString() ?? null,
    createdAt: x.createdAt.toISOString(),
  };
}
function pref(x: {
  userId: string;
  preferences: unknown;
  schemaVersion: number;
  updatedAt: Date;
  rowVersion: bigint;
}) {
  return {
    userId: x.userId,
    preferencesJsonb: x.preferences as Record<string, unknown>,
    schemaVersion: x.schemaVersion,
    updatedAt: x.updatedAt.toISOString(),
    rowVersion: x.rowVersion.toString(),
  };
}
function advisory(x: {
  id: string;
  ruleCode: string;
  ruleVersion: string;
  resourceTypeCode: string;
  resourceId: string;
  outputTypeCode: string;
  scoreNumeric: Prisma.Decimal | null;
  outputJson: unknown;
  explanationJson: unknown;
  generatedAt: Date;
  validUntil: Date | null;
  statusCode: string;
}) {
  return {
    aiRuleOutputId: x.id,
    ruleCode: x.ruleCode,
    ruleVersion: x.ruleVersion,
    resourceTypeCode: x.resourceTypeCode,
    resourceId: x.resourceId,
    outputTypeCode: x.outputTypeCode,
    scoreNumeric: x.scoreNumeric?.toString() ?? null,
    outputJsonb: x.outputJson as Record<string, unknown>,
    explanationJsonb: x.explanationJson as Record<string, unknown> | null,
    generatedAt: x.generatedAt.toISOString(),
    validUntil: x.validUntil?.toISOString() ?? null,
    statusCode: x.statusCode,
  };
}
function analytics(id: string, basis: string, i: CustomerIdentity) {
  return {
    metricId: id,
    metricVersion: "v1",
    asOf: new Date().toISOString(),
    source: "POSTGRESQL_SSOT",
    currency: null,
    basis,
    scope: `countries:${[...i.countryCodes].sort().join(",")}`,
  };
}
function redact(x: unknown) {
  return x && typeof x === "object"
    ? (JSON.parse(JSON.stringify(x)) as Record<string, unknown>)
    : null;
}
function uuid(x: string | null) {
  return !!x && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(x);
}
function missing(): never {
  throw new ApiProblem({ status: 404, code: "RESOURCE_NOT_FOUND" });
}
function rule(c: string): never {
  throw new ApiProblem({ status: 422, code: c });
}
function precondition(): never {
  throw new ApiProblem({ status: 412, code: "CONCURRENCY_CONFLICT" });
}
function forbid(): never {
  throw new ApiProblem({ status: 403, code: "FORBIDDEN" });
}
/** Postgres `date` columns arrive as Date at UTC midnight; keep just the day. */
function isoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}
