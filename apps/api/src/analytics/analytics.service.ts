import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { Prisma, type DatabaseClient } from "@abp/database";
import type { CustomerIdentity } from "../customer/customer-auth.js";
import { ApiProblem } from "../platform/api-exception.filter.js";
import { databaseClientToken } from "../platform/database.providers.js";
import { productMetricAvailability } from "./product-metric-availability.js";
import type {
  AnalyticsDrilldownQueryDto,
  AnalyticsExportDto,
  AnalyticsQueryDto,
} from "./analytics.dto.js";
import {
  metricRegistry,
  reportRegistry,
} from "./authoritative-registry.generated.js";

const cr001MetricRegistry = [
  {
    metricId: "MET-CUST-006",
    metricVersion: "1.0.0",
    name: "Booked Value by Customer Segment",
    description:
      "Commercial-clean ERP booked value grouped by the customer segment effective when each order was imported.",
    domain: "Customer",
    measureType: "MONEY",
    sourceEntities: [
      "ERP Order Facts",
      "Customer Segment Assignment",
      "Customer Segment Definition",
    ],
    sourceFacts: ["ERP Order Facts", "Effective-dated Customer Segment"],
    sourceLineage: {
      authority: "PostgreSQL operational SSOT",
      fact: "ERP Order Facts + effective-dated Customer Segment Assignment",
      contractDelta: "CR-001/DG-01",
    },
    dateBasis: "ERP order importedAt with segment assignment as-of importedAt",
    currencyBasis: "USD commercial-clean booked amount",
    aggregation:
      "SUM booked_amount grouped by the assignment effective at imported_at; no assignment is UNCLASSIFIED.",
    filters: ["asOf", "from", "to", "countryCode", "segment"],
    dimensions: ["customerSegment", "country"],
    exclusions: [
      "DATA_CONFLICT",
      "records outside effective Country Scope",
      "permission DENY",
    ],
    dqBehavior:
      "Unknown import segment codes create DQ issues and are never auto-created; unassigned facts remain UNCLASSIFIED.",
    countryScopeBehavior:
      "ERP source rows are constrained before aggregation; segment classification never widens authorization.",
    authorization: {
      viewPermission: "reports.commercial",
      drilldownPermission: "reports.commercial",
      exportPermission: "data.export",
    },
    drilldownSupport: true,
    exportSupport: true,
    zeroDenominatorBehavior: "ZERO",
    roundingRule:
      "Decimal authority; preserve 4 decimals, presentation may round explicitly.",
    status: "ACTIVE",
    guard:
      "CR-001 LOCKED: customer segments are canonical, admin-configurable, auditable, and effective-dated.",
  },
] as const;

const effectiveMetricRegistry = [...metricRegistry, ...cr001MetricRegistry];
const effectiveReportRegistry = reportRegistry.map((report) =>
  report.reportId === "RPT-007"
    ? {
        ...report,
        reportVersion: "1.1.0",
        description:
          "Effective-dated Customer Segment booked-value analytics plus governed product and price intelligence.",
        metricIds: [...report.metricIds, "MET-CUST-006"],
        dimensions: [...report.dimensions, "customerSegment"],
      }
    : report,
);

type MetricDefinition = (typeof effectiveMetricRegistry)[number];
type ReportDefinition = (typeof effectiveReportRegistry)[number];
type Breakdown = { key: string; label: string; value: string; count?: number };
type Calculation = {
  value: string | null;
  unit: string;
  basis: string;
  availability: "AVAILABLE" | "UNAVAILABLE";
  unavailableReason?: string;
  breakdown?: Breakdown[];
  dqContext?: { excludedDataConflict: number; unclassified: number };
};
type Context = {
  asOf: Date;
  from: Date;
  to: Date;
  countries: string[];
  currency: "USD" | "EGP";
};

@Injectable()
export class AnalyticsSemanticService {
  constructor(
    @Inject(databaseClientToken) private readonly db: DatabaseClient,
  ) {}

  metricDefinitions(identity: CustomerIdentity) {
    return {
      data: effectiveMetricRegistry.filter((item) =>
        this.allowed(identity, item.authorization.viewPermission),
      ),
      meta: { total: effectiveMetricRegistry.length, projected: true },
    };
  }

  reportDefinitions(identity: CustomerIdentity) {
    return {
      data: effectiveReportRegistry.filter((item) =>
        this.allowed(identity, item.permissions.view),
      ),
      meta: { total: effectiveReportRegistry.length, projected: true },
    };
  }

  async metric(
    identity: CustomerIdentity,
    metricId: string,
    query: AnalyticsQueryDto,
  ) {
    const definition = this.metricDefinition(metricId);
    this.require(identity, definition.authorization.viewPermission);
    const context = this.context(identity, query);
    const calculated = await this.calculate(identity, definition, context);
    const converted = await this.convert(calculated, context);
    return {
      data: this.metricResult(definition, converted, context),
    };
  }

  async report(
    identity: CustomerIdentity,
    reportId: string,
    query: AnalyticsQueryDto,
  ) {
    const definition = this.reportDefinition(reportId);
    this.require(identity, definition.permissions.view);
    const context = this.context(identity, query);
    const permitted = definition.metricIds
      .map((metricId) => this.metricDefinition(metricId))
      .filter((metric) =>
        this.allowed(identity, metric.authorization.viewPermission),
      );
    const metrics = [];
    for (const metric of permitted) {
      const result = await this.convert(
        await this.calculate(identity, metric, context),
        context,
      );
      metrics.push(this.metricResult(metric, result, context));
    }
    return {
      data: {
        reportId: definition.reportId,
        reportVersion: definition.reportVersion,
        name: definition.name,
        asOf: context.asOf.toISOString(),
        generatedAt: new Date().toISOString(),
        currency: context.currency,
        scope: { countryCodes: context.countries },
        filters: this.filters(context),
        metrics,
        dqContext: mergeDq(metrics),
      },
    };
  }

  async drilldown(
    identity: CustomerIdentity,
    reportId: string,
    query: AnalyticsDrilldownQueryDto,
  ) {
    const definition = this.reportDefinition(reportId);
    this.require(identity, definition.permissions.drilldown);
    if (query.metricId) {
      if (!(definition.metricIds as readonly string[]).includes(query.metricId))
        rule("METRIC_NOT_IN_REPORT");
      this.require(
        identity,
        this.metricDefinition(query.metricId).authorization.drilldownPermission,
      );
    }
    const context = this.context(identity, query);
    const result = await this.drilldownRows(
      identity,
      definition,
      context,
      query.offset,
      query.limit,
      query.sort,
      query.metricId,
      query.stageCode,
    );
    return {
      data: result.rows,
      meta: {
        offset: query.offset,
        limit: query.limit,
        total: result.total,
        hasNext: query.offset + result.rows.length < result.total,
        reportId,
        reportVersion: definition.reportVersion,
        asOf: context.asOf.toISOString(),
        countryCodes: context.countries,
      },
    };
  }

  async export(
    identity: CustomerIdentity,
    reportId: string,
    idempotencyKey: string,
    body: AnalyticsExportDto,
  ) {
    const definition = this.reportDefinition(reportId);
    this.require(identity, definition.permissions.view);
    this.require(identity, definition.permissions.export);
    this.require(identity, "exports.create");
    if (!idempotencyKey || idempotencyKey.length > 200)
      bad("IDEMPOTENCY_KEY_REQUIRED");
    if (
      !(definition.exportFormats as readonly string[]).includes(body.formatCode)
    )
      rule("REPORT_FORMAT_NOT_SUPPORTED");
    const context = this.context(identity, body);
    const request = {
      reportId,
      reportVersion: definition.reportVersion,
      metricVersions: definition.metricIds.map((metricId) => ({
        metricId,
        metricVersion: this.metricDefinition(metricId).metricVersion,
      })),
      formatCode: body.formatCode,
      asOf: context.asOf.toISOString(),
      from: context.from.toISOString(),
      to: context.to.toISOString(),
      currency: context.currency,
      countryCodes: context.countries,
    };
    const requestHash = sha(request);
    const replay = await this.db.commandIdempotency.findUnique({
      where: {
        actorUserId_operationCode_idempotencyKey: {
          actorUserId: identity.userId,
          operationCode: "ANALYTICS_EXPORT_CREATE",
          idempotencyKey,
        },
      },
    });
    if (replay) {
      if (replay.requestHash !== requestHash)
        conflict("IDEMPOTENCY_KEY_REUSED");
      return this.exportStatus(identity, replay.responseResourceId);
    }
    const semanticSnapshot = (await this.report(identity, reportId, body)).data;
    const row = await this.db.$transaction(async (tx) => {
      const job = await tx.durableJob.create({
        data: {
          type: "ANALYTICS_EXPORT",
          status: "PENDING",
          payload: { ...request, semanticSnapshot },
          sourceType: "ANALYTICS_REPORT",
          traceId: identity.traceId,
          correlationId: identity.correlationId,
          idempotencyKey: `analytics-export:${identity.userId}:${idempotencyKey}`,
        },
      });
      const exported = await tx.exportEvent.create({
        data: {
          userId: identity.userId,
          exportTypeCode: reportId,
          formatCode: body.formatCode,
          resourceTypeCode: "ANALYTICS_REPORT",
          filterSummary: request,
          countryCodes: context.countries,
          jobId: job.id,
        },
      });
      await tx.commandIdempotency.create({
        data: {
          actorUserId: identity.userId,
          operationCode: "ANALYTICS_EXPORT_CREATE",
          idempotencyKey,
          requestHash,
          responseResourceId: exported.id,
        },
      });
      await tx.outboxMessage.create({
        data: {
          eventType: "ANALYTICS_EXPORT_REQUESTED",
          aggregateType: "ANALYTICS_EXPORT",
          aggregateId: exported.id,
          payload: { exportId: exported.id, jobId: job.id, ...request },
          traceId: identity.traceId,
          correlationId: identity.correlationId,
          idempotencyKey: `analytics-export:${exported.id}`,
        },
      });
      await tx.auditEvent.create({
        data: {
          actorUserId: identity.userId,
          actorSessionId: identity.sessionId,
          actionCode: "ANALYTICS_EXPORT_QUEUED",
          resourceType: "ANALYTICS_REPORT",
          resourceId: exported.id,
          workspace: "ANALYTICS",
          metadata: request,
          traceId: identity.traceId,
          correlationId: identity.correlationId,
          source: "analytics-api",
        },
      });
      return exported;
    });
    return {
      data: {
        exportId: row.id,
        reportId,
        jobId: row.jobId,
        status: row.statusCode,
        asOf: context.asOf.toISOString(),
      },
    };
  }

  async exportStatus(identity: CustomerIdentity, exportId: string) {
    this.require(identity, "exports.view");
    const row = await this.db.exportEvent.findFirst({
      where: { id: exportId, userId: identity.userId },
    });
    if (!row) missing("ANALYTICS_EXPORT_NOT_FOUND");
    const job = await this.db.durableJob.findUnique({
      where: { id: row.jobId },
      select: { status: true, errorCode: true, finishedAt: true },
    });
    const status =
      row.statusCode === "COMPLETED"
        ? "COMPLETED"
        : job?.status === "DEAD"
          ? "FAILED"
          : job?.status === "PROCESSING"
            ? "RUNNING"
            : row.statusCode;
    return {
      data: {
        exportId: row.id,
        reportId: row.exportTypeCode,
        jobId: row.jobId,
        formatCode: row.formatCode,
        status,
        documentId: row.documentId,
        failureCode:
          row.failureCode ?? (job?.status === "DEAD" ? job.errorCode : null),
        createdAt: row.createdAt.toISOString(),
        completedAt:
          row.completedAt?.toISOString() ??
          job?.finishedAt?.toISOString() ??
          null,
      },
    };
  }

  private metricResult(
    definition: MetricDefinition,
    calculation: Calculation,
    context: Context,
  ) {
    return {
      metricId: definition.metricId,
      metricVersion: definition.metricVersion,
      name: definition.name,
      value: calculation.value,
      unit: calculation.unit,
      currency: definition.measureType === "MONEY" ? context.currency : null,
      basis: calculation.basis,
      asOf: context.asOf.toISOString(),
      source: definition.sourceLineage,
      scope: { countryCodes: context.countries },
      filters: this.filters(context),
      generatedAt: new Date().toISOString(),
      availability: calculation.availability,
      ...(calculation.unavailableReason
        ? { unavailableReason: calculation.unavailableReason }
        : {}),
      ...(calculation.breakdown ? { breakdown: calculation.breakdown } : {}),
      dqContext: calculation.dqContext ?? {
        excludedDataConflict: 0,
        unclassified: 0,
      },
    };
  }

  private async calculate(
    identity: CustomerIdentity,
    definition: MetricDefinition,
    context: Context,
  ): Promise<Calculation> {
    const id = definition.metricId;
    if (id.startsWith("MET-TGT-"))
      return this.targetMetric(identity, id, context);
    if (id.startsWith("MET-PIPE-")) return this.pipelineMetric(id, context);
    if (id.startsWith("MET-QUOTE-")) return this.quotationMetric(id, context);
    if (id.startsWith("MET-CUST-")) return this.customerMetric(id, context);
    if (id.startsWith("MET-GEO-")) return this.geographyMetric(id, context);
    if (id.startsWith("MET-GROUP-")) return this.groupMetric(id, context);
    if (id.startsWith("MET-ERP-")) return this.erpMetric(id, context);
    if (id.startsWith("MET-LOG-")) return this.logisticsMetric(id, context);
    if (id.startsWith("MET-CAP-")) return this.capacityMetric(id, context);
    if (id.startsWith("MET-DQ-")) return this.dqMetric(id, context);
    if (id.startsWith("MET-FX-")) return this.fxMetric(id, context);
    if (id.startsWith("MET-PAY-")) return this.paymentMetric(id, context);
    if (id.startsWith("MET-CHQ-")) return this.chequeMetric(context);
    if (id.startsWith("MET-RET-")) return this.returnMetric(id, context);
    if (id.startsWith("MET-CMP-")) return this.complaintMetric(id, context);
    if (id.startsWith("MET-AI-")) return this.aiMetric(identity, id, context);
    if (id.startsWith("MET-PROD-")) return this.productMetric(id, context);
    if (id.startsWith("MET-PRICE-")) return this.priceMetric(id, context);
    return unavailable(
      definition.currencyBasis,
      "Authoritative source columns required for this governed metric are not populated in the current selected scope.",
    );
  }

  private async targetMetric(
    identity: CustomerIdentity,
    id: string,
    context: Context,
  ): Promise<Calculation> {
    const year = context.asOf.getUTCFullYear();
    const target = await this.db.companyTarget.findFirst({
      where: {
        targetYear: year,
        companyCode: "ACROW",
        statusCode: "ACTIVE",
        effectiveFrom: { lte: context.asOf },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: context.asOf } }],
      },
      orderBy: { version: "desc" },
    });
    const won = await this.activeWon(
      context,
      id === "MET-TGT-006" ? identity : null,
    );
    if (id === "MET-TGT-003" || id === "MET-TGT-006")
      return available(
        won,
        "USD",
        "latest active immutable WON snapshot per opportunity",
      );
    if (!target) return unavailable("USD", "COMPANY_TARGET_NOT_CONFIGURED");
    if (id === "MET-TGT-001")
      return available(
        target.amountUsd,
        "USD",
        "active ACROW company target version",
      );
    if (id === "MET-TGT-002") {
      const sum = await this.db.targetAllocation.aggregate({
        where: {
          companyTargetId: target.id,
          effectiveFrom: { lte: context.asOf },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: context.asOf } }],
          periodStart: { lte: context.to },
          periodEnd: { gte: context.from },
        },
        _sum: { amountUsd: true },
      });
      if (!sum._sum.amountUsd)
        return unavailable("USD", "TARGET_ALLOCATION_NOT_CONFIGURED");
      return available(
        sum._sum.amountUsd,
        "USD",
        "stored effective target allocations",
      );
    }
    if (id === "MET-TGT-004")
      return available(
        target.amountUsd.sub(won),
        "USD",
        "target minus active WON contribution",
      );
    if (target.amountUsd.isZero())
      return unavailable("Percent", "ZERO_TARGET_DENOMINATOR");
    return available(
      won.div(target.amountUsd).mul(100).toDecimalPlaces(4),
      "Percent",
      "active WON contribution divided by target",
    );
  }

  private async activeWon(context: Context, identity: CustomerIdentity | null) {
    const ownerIds = identity ? await this.contributionOwners(identity) : null;
    const ownerPredicate = ownerIds
      ? Prisma.sql`AND o.owner_user_id IN (${Prisma.join(ownerIds)})`
      : Prisma.empty;
    const rows = await this.db.$queryRaw<{ value: string }[]>(Prisma.sql`
      WITH latest_won AS (
        SELECT DISTINCT ON (s.opportunity_id) s.value
        FROM opportunity_won_snapshots s
        JOIN opportunities o ON o.opportunity_id = s.opportunity_id
        WHERE o.stage_code = 'WON'
          AND s.currency_code = 'USD'
          AND s.won_at >= ${context.from}
          AND s.won_at <= ${context.to}
          AND o.country_code IN (${Prisma.join(context.countries)})
          ${ownerPredicate}
        ORDER BY s.opportunity_id, s.won_at DESC, s.opportunity_won_snapshot_id DESC
      ) SELECT COALESCE(SUM(value), 0)::text AS value FROM latest_won
    `);
    return new Prisma.Decimal(rows[0]?.value ?? 0);
  }

  private async contributionOwners(identity: CustomerIdentity) {
    const owners = [identity.userId];
    if (
      identity.permissions.has("sales.management.view") &&
      !identity.deniedPermissions.has("sales.management.view")
    ) {
      const reports = await this.db.userProfile.findMany({
        where: { managerUserId: identity.userId },
        select: { userId: true },
      });
      owners.push(...reports.map((row) => row.userId));
    }
    return owners;
  }

  private async pipelineMetric(
    id: string,
    context: Context,
  ): Promise<Calculation> {
    const where = {
      countryCode: { in: context.countries },
      updatedAt: { lte: context.asOf },
    };
    if (id === "MET-PIPE-001") {
      const rows = await this.db.opportunity.groupBy({
        by: ["stageCode"],
        where,
        _count: true,
        orderBy: { stageCode: "asc" },
      });
      return available(
        rows.reduce((sum, row) => sum + row._count, 0),
        "Count",
        "canonical opportunity current stage",
        rows.map((row) => ({
          key: row.stageCode,
          label: row.stageCode,
          value: String(row._count),
          count: row._count,
        })),
      );
    }
    if (id === "MET-PIPE-002" || id === "MET-PIPE-003") {
      const rows = await this.db.opportunity.findMany({
        where: {
          ...where,
          currencyCode: "USD",
          stageCode: { notIn: ["WON", "LOST"] },
        },
        select: { estimatedValue: true, probabilityPct: true },
      });
      const value = rows.reduce(
        (sum, row) =>
          sum.add(
            id === "MET-PIPE-003"
              ? (row.estimatedValue ?? zero())
                  .mul(row.probabilityPct ?? zero())
                  .div(100)
              : (row.estimatedValue ?? zero()),
          ),
        zero(),
      );
      return available(
        value,
        "USD",
        id === "MET-PIPE-003"
          ? "traceable effective probability"
          : "open opportunity authoritative value",
      );
    }
    if (id === "MET-PIPE-005") {
      // Conversion is measured against the deals that are still real, not
      // against the ones already buried. A deal under negotiation has not been
      // lost — counting it in the denominator is what makes the number move
      // while the quarter is still running, and excluding LOST stops a tidy-up
      // of dead leads from flattering the rate.
      //
      //   Won / (Won + active negotiation stages)
      //
      // WON is taken over the reporting window; the in-play stages are counted
      // as they stand today, because that is what "still open" means.
      const wonCount = await this.db.opportunity.count({
        where: {
          stageCode: "WON",
          wonAt: { gte: context.from, lte: context.to },
          countryCode: { in: context.countries },
          cancelledAt: null,
        },
      });
      const inPlayCount = await this.db.opportunity.count({
        where: {
          stageCode: {
            in: [
              "NEGOTIATION",
              // Backward-compatible aliases found in older imported data.
              "HOT_LEAD",
              "UNDER_NEGOTIATION",
            ],
          },
          countryCode: { in: context.countries },
          cancelledAt: null,
        },
      });
      const cohort = wonCount + inPlayCount;
      if (cohort === 0) return unavailable("Percent", "ZERO_LIVE_COHORT");
      return available(
        new Prisma.Decimal(wonCount).div(cohort).mul(100).toDecimalPlaces(4),
        "Percent",
        "WON / (WON + active negotiation stages) live cohort",
      );
    }
    if (id === "MET-PIPE-004")
      return unavailable("Percent", "STAGE_PAIR_FILTER_REQUIRED");
    if (id === "MET-PIPE-006") {
      const rows = await this.db.$queryRaw<{ value: string }[]>(Prisma.sql`
        SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (${context.asOf}::timestamptz - t.occurred_at)) / 86400), 0)::text AS value
        FROM opportunities o
        JOIN LATERAL (
          SELECT occurred_at FROM opportunity_stage_transitions st
          WHERE st.opportunity_id = o.opportunity_id
            AND st.occurred_at <= ${context.asOf}
          ORDER BY occurred_at DESC LIMIT 1
        ) t ON true
        WHERE o.stage_code NOT IN ('WON','LOST')
          AND o.country_code IN (${Prisma.join(context.countries)})
      `);
      return available(
        rows[0]?.value ?? "0",
        "Days",
        "days since latest stage transition for open opportunities",
      );
    }
    const rows = await this.db.$queryRaw<
      { covered: bigint; total: bigint; overdue: bigint }[]
    >(Prisma.sql`
      SELECT COUNT(DISTINCT o.opportunity_id) FILTER (WHERE future.activity_id IS NOT NULL) AS covered,
             COUNT(DISTINCT o.opportunity_id) AS total,
             COUNT(DISTINCT overdue.activity_id) AS overdue
      FROM opportunities o
      LEFT JOIN activity_links l ON l.resource_type_code = 'OPPORTUNITY' AND l.resource_id = o.opportunity_id
      LEFT JOIN activities future ON future.activity_id = l.activity_id AND future.due_at > ${context.asOf} AND future.task_status_code NOT IN ('COMPLETED','CANCELLED')
      LEFT JOIN activities overdue ON overdue.activity_id = l.activity_id AND overdue.due_at <= ${context.asOf} AND overdue.task_status_code NOT IN ('COMPLETED','CANCELLED')
      WHERE o.stage_code NOT IN ('WON','LOST') AND o.country_code IN (${Prisma.join(context.countries)})
    `);
    const total = Number(rows[0]?.total ?? 0);
    if (total === 0) return unavailable("Percent", "ZERO_OPEN_OPPORTUNITIES");
    return available(
      new Prisma.Decimal(Number(rows[0]?.covered ?? 0))
        .div(total)
        .mul(100)
        .toDecimalPlaces(4),
      "Percent",
      "open opportunities with future activity",
      [
        {
          key: "OVERDUE",
          label: "Overdue follow-ups",
          value: String(rows[0]?.overdue ?? 0),
        },
      ],
    );
  }

  private async quotationMetric(
    id: string,
    context: Context,
  ): Promise<Calculation> {
    const base = {
      countryCode: { in: context.countries },
      createdAt: { lte: context.asOf },
    };
    if (id === "MET-QUOTE-001") {
      const rows = await this.db.quotation.groupBy({
        by: ["statusCode"],
        where: base,
        _count: true,
        orderBy: { statusCode: "asc" },
      });
      return available(
        rows.reduce((sum, row) => sum + row._count, 0),
        "Count",
        "independent quotation records by status",
        rows.map((row) => ({
          key: row.statusCode,
          label: row.statusCode,
          value: String(row._count),
          count: row._count,
        })),
      );
    }
    if (id === "MET-QUOTE-002") {
      const count = await this.db.quotation.count({
        where: {
          countryCode: { in: context.countries },
          sentAt: { gte: context.from, lte: context.to },
        },
      });
      return available(count, "Count", "persisted sent_at evidence");
    }
    if (id === "MET-QUOTE-003") {
      const count = await this.db.quotation.count({
        where: { ...base, supersedesQuotationId: { not: null } },
      });
      return available(
        count,
        "Count",
        "supersedes_quotation_id; no formal revisions",
      );
    }
    if (id === "MET-QUOTE-005") {
      const [accepted, sent] = await Promise.all([
        this.db.quotationAcceptance.count({
          where: {
            acceptedAt: { gte: context.from, lte: context.to },
            quotation: { countryCode: { in: context.countries } },
          },
        }),
        this.db.quotation.count({
          where: {
            countryCode: { in: context.countries },
            sentAt: { gte: context.from, lte: context.to },
          },
        }),
      ]);
      if (sent === 0) return unavailable("Percent", "ZERO_SENT_DENOMINATOR");
      return available(
        new Prisma.Decimal(accepted).div(sent).mul(100).toDecimalPlaces(4),
        "Percent",
        "accepted evidence / eligible SENT quotations",
      );
    }
    return unavailable(
      "Count",
      "DETAILED_PRICING_CLASSIFICATION_FILTER_REQUIRED",
    );
  }

  private async customerMetric(
    id: string,
    context: Context,
  ): Promise<Calculation> {
    const base = {
      countryCode: { in: context.countries },
      createdAt: { lte: context.asOf },
    };
    if (id === "MET-CUST-001")
      return available(
        await this.db.account.count({ where: base }),
        "Count",
        "distinct canonical account IDs",
      );
    if (id === "MET-CUST-002") {
      const threshold = new Date(context.asOf.getTime() - 30 * 86_400_000);
      const rows = await this.db.$queryRaw<{ value: bigint }[]>(Prisma.sql`
        SELECT COUNT(*)::bigint AS value FROM accounts a
        WHERE a.country_code IN (${Prisma.join(context.countries)})
          AND a.record_status_code = 'ACTIVE'
          AND NOT EXISTS (SELECT 1 FROM opportunities o WHERE o.account_id = a.account_id AND o.stage_code NOT IN ('WON','LOST'))
          AND NOT EXISTS (SELECT 1 FROM activities act WHERE act.account_id = a.account_id AND act.created_at >= ${threshold})
      `);
      return available(
        rows[0]?.value ?? 0,
        "Count",
        "30-day dormant rule with open-opportunity exception",
      );
    }
    const since =
      id === "MET-CUST-004"
        ? new Date(context.asOf.getTime() - 365 * 86_400_000)
        : context.from;
    if (id === "MET-CUST-003" || id === "MET-CUST-004") {
      const rows = await this.db.$queryRaw<
        { key: string; label: string; value: string }[]
      >(Prisma.sql`
        SELECT e.account_id::text AS key,
               a.canonical_name AS label,
               COALESCE(SUM(e.booked_amount), 0)::text AS value
        FROM erp_orders e
        JOIN accounts a ON a.account_id = e.account_id
        WHERE e.account_id IS NOT NULL
          AND e.country_code IN (${Prisma.join(context.countries)})
          AND e.dq_status_code = 'VALID'
          AND e.currency_code = 'USD'
          AND e.imported_at >= ${since}
          AND e.imported_at <= ${context.to}
        GROUP BY e.account_id, a.canonical_name
        ORDER BY SUM(e.booked_amount) DESC, e.account_id
      `);
      return available(
        rows.reduce((sum, row) => sum.add(row.value), zero()),
        "USD",
        id === "MET-CUST-004"
          ? "rolling 12M booked commercial-clean basis"
          : "selected-window booked commercial-clean basis",
        rows,
      );
    }
    if (id === "MET-CUST-006") {
      const rows = await this.db.$queryRaw<
        { key: string; label: string; value: string; count: number }[]
      >(Prisma.sql`
        SELECT COALESCE(segment.segment_code, 'UNCLASSIFIED') AS key,
               COALESCE(segment.display_name_en, 'Unclassified') AS label,
               COALESCE(SUM(e.booked_amount), 0)::text AS value,
               COUNT(*)::int AS count
        FROM erp_orders e
        LEFT JOIN LATERAL (
          SELECT d.segment_code, d.display_name_en
          FROM customer_segment_assignments assignment
          JOIN customer_segment_definitions d
            ON d.customer_segment_id = assignment.customer_segment_id
          WHERE assignment.account_id = e.account_id
            AND assignment.effective_from <= e.imported_at
            AND (assignment.effective_to IS NULL OR assignment.effective_to > e.imported_at)
          ORDER BY assignment.effective_from DESC, assignment.customer_segment_assignment_id DESC
          LIMIT 1
        ) segment ON TRUE
        WHERE e.country_code IN (${Prisma.join(context.countries)})
          AND e.dq_status_code = 'VALID'
          AND e.currency_code = 'USD'
          AND e.booked_amount IS NOT NULL
          AND e.imported_at >= ${context.from}
          AND e.imported_at <= ${context.to}
          AND e.imported_at <= ${context.asOf}
        GROUP BY segment.segment_code, segment.display_name_en
        ORDER BY SUM(e.booked_amount) DESC, key
      `);
      return {
        ...available(
          rows.reduce((sum, row) => sum.add(row.value), zero()),
          "USD",
          "commercial-clean booked value by segment effective at ERP importedAt",
          rows,
        ),
        dqContext: {
          excludedDataConflict: await this.db.eRPOrder.count({
            where: {
              countryCode: { in: context.countries },
              dqStatusCode: "DATA_CONFLICT",
              importedAt: { gte: context.from, lte: context.to },
            },
          }),
          unclassified:
            rows.find((row) => row.key === "UNCLASSIFIED")?.count ?? 0,
        },
      };
    }
    return unavailable("Days", "CUSTOMER_SELECTION_REQUIRED");
  }

  private async geographyMetric(
    id: string,
    context: Context,
  ): Promise<Calculation> {
    if (["MET-GEO-001", "MET-GEO-002", "MET-GEO-003"].includes(id)) {
      const rows = await this.db.$queryRaw<
        { market: string; value: bigint }[]
      >(Prisma.sql`
        SELECT CASE WHEN a.hq_country_code IS NULL THEN 'UNCLASSIFIED' WHEN a.hq_country_code IN ('EG', 'LY', 'SA', 'AE') THEN 'LOCAL' ELSE 'GLOBAL' END AS market,
               COUNT(DISTINCT a.account_id)::bigint AS value
        FROM accounts a
        WHERE a.country_code IN (${Prisma.join(context.countries)}) AND a.created_at <= ${context.asOf}
        GROUP BY market
      `);
      const wanted =
        id === "MET-GEO-001"
          ? "LOCAL"
          : id === "MET-GEO-002"
            ? "GLOBAL"
            : "UNCLASSIFIED";
      return available(
        rows.find((row) => row.market === wanted)?.value ?? 0,
        "Count",
        "canonical HQ country classification",
        rows.map((row) => ({
          key: row.market,
          label: row.market,
          value: String(row.value),
        })),
      );
    }
    const rows = await this.db.$queryRaw<
      { key: string; label: string; value: string }[]
    >(Prisma.sql`
      SELECT ${id === "MET-GEO-004" ? Prisma.sql`COALESCE(e.country_code, 'UNCLASSIFIED')` : Prisma.sql`COALESCE(c.continent_code, 'UNCLASSIFIED')`} AS key,
             ${id === "MET-GEO-004" ? Prisma.sql`COALESCE(c.name, e.country_code, 'UNCLASSIFIED')` : Prisma.sql`COALESCE(c.continent_code, 'UNCLASSIFIED')`} AS label,
             COALESCE(SUM(e.booked_amount),0)::text AS value
      FROM erp_orders e LEFT JOIN countries c ON c.code = e.country_code
      WHERE e.country_code IN (${Prisma.join(context.countries)}) AND e.dq_status_code = 'VALID' AND e.currency_code = 'USD'
        AND e.imported_at >= ${context.from} AND e.imported_at <= ${context.to}
      GROUP BY key, label ORDER BY SUM(e.booked_amount) DESC, key
    `);
    return available(
      rows.reduce((sum, row) => sum.add(row.value), zero()),
      "USD",
      "commercial-clean Booked value by protected geography",
      rows,
    );
  }

  private async groupMetric(
    id: string,
    context: Context,
  ): Promise<Calculation> {
    if (id === "MET-GROUP-001") {
      const rows = await this.db.$queryRaw<{ value: bigint }[]>(Prisma.sql`
        SELECT COUNT(DISTINCT a.country_code)::bigint AS value
        FROM account_group_memberships gm JOIN accounts a ON a.account_id = gm.account_id
        WHERE a.country_code IN (${Prisma.join(context.countries)})
          AND (gm.valid_from IS NULL OR gm.valid_from <= ${context.asOf}::date)
          AND (gm.valid_to IS NULL OR gm.valid_to >= ${context.asOf}::date)
      `);
      return available(
        rows[0]?.value ?? 0,
        "Count",
        "effective-dated group membership data",
      );
    }
    const rows = await this.db.$queryRaw<
      { key: string; value: string }[]
    >(Prisma.sql`
      SELECT g.group_code AS key, COALESCE(SUM(e.booked_amount),0)::text AS value
      FROM erp_orders e JOIN account_group_memberships gm ON gm.account_id=e.account_id
      JOIN group_networks g ON g.group_network_id=gm.group_network_id
      WHERE e.country_code IN (${Prisma.join(context.countries)}) AND e.dq_status_code='VALID' AND e.currency_code='USD'
        AND e.imported_at >= ${context.from} AND e.imported_at <= ${context.to}
        AND (gm.valid_from IS NULL OR gm.valid_from <= e.order_date)
        AND (gm.valid_to IS NULL OR gm.valid_to >= e.order_date)
      GROUP BY g.group_code ORDER BY g.group_code
    `);
    return available(
      rows.reduce((sum, row) => sum.add(row.value), zero()),
      "USD",
      "one commercial fact through effective group membership",
      rows.map((row) => ({ key: row.key, label: row.key, value: row.value })),
    );
  }

  private async erpMetric(id: string, context: Context): Promise<Calculation> {
    const conflicts = await this.db.eRPOrder.count({
      where: {
        countryCode: { in: context.countries },
        dqStatusCode: "DATA_CONFLICT",
        importedAt: { gte: context.from, lte: context.to },
      },
    });
    const dqContext = { excludedDataConflict: conflicts, unclassified: 0 };
    if (id === "MET-ERP-001")
      return {
        ...available(
          await this.erpAmount("booked_amount", context),
          "USD",
          "commercial-clean booked fact",
        ),
        dqContext,
      };
    if (id === "MET-ERP-002")
      return {
        ...available(
          await this.erpAmount("shipped_amount", context),
          "USD",
          "actual imported shipped evidence; never order status proxy",
        ),
        dqContext,
      };
    if (id === "MET-ERP-003")
      return {
        ...available(
          await this.erpAmount("invoiced_amount", context),
          "USD",
          "actual imported invoice evidence",
        ),
        dqContext,
      };
    if (id === "MET-ERP-004") {
      const rows = await this.db.$queryRaw<{ value: string }[]>(Prisma.sql`
        SELECT COALESCE(SUM(COALESCE(total_amount, booked_amount)),0)::text AS value FROM erp_orders
        WHERE country_code IN (${Prisma.join(context.countries)}) AND dq_status_code='VALID' AND currency_code='USD'
          AND interfaced_at IS NOT NULL AND interfaced_at >= ${context.from} AND interfaced_at <= ${context.to}
      `);
      return {
        ...available(
          rows[0]?.value ?? "0",
          "USD",
          "independent persisted interface evidence",
        ),
        dqContext,
      };
    }
    if (id === "MET-ERP-005") {
      const rows = await this.db.$queryRaw<{ value: string }[]>(Prisma.sql`
        SELECT COALESCE(SUM(l.qty_remaining),0)::text AS value
        FROM erp_order_lines l JOIN erp_orders e ON e.erp_order_id=l.erp_order_id
        WHERE e.country_code IN (${Prisma.join(context.countries)}) AND e.dq_status_code='VALID' AND l.dq_status_code='VALID'
          AND l.qty_remaining IS NOT NULL AND e.imported_at <= ${context.asOf}
      `);
      return {
        ...available(
          rows[0]?.value ?? "0",
          "Quantity",
          "canonical source qty_remaining; not Ordered minus Shipped",
        ),
        dqContext,
      };
    }
    if (id === "MET-ERP-006")
      return {
        ...available(
          await this.db.eRPOrder.count({
            where: {
              countryCode: { in: context.countries },
              dqStatusCode: "VALID",
              importedAt: { gte: context.from, lte: context.to },
            },
          }),
          "Count",
          "distinct canonical ERP order IDs",
        ),
        dqContext,
      };
    const [total, matchedRows] = await Promise.all([
      this.db.sourceItem.count(),
      this.db.itemMapping.findMany({
        where: { statusCode: "ACTIVE" },
        distinct: ["sourceItemId"],
        select: { sourceItemId: true },
      }),
    ]);
    const matched = matchedRows.length;
    if (total === 0) return unavailable("Percent", "ZERO_IMPORTED_ITEM_VALUES");
    return {
      ...available(
        new Prisma.Decimal(matched).div(total).mul(100).toDecimalPlaces(4),
        "Percent",
        "matched unique source items / total source items",
      ),
      dqContext,
    };
  }

  private async erpAmount(
    column: "booked_amount" | "shipped_amount" | "invoiced_amount",
    context: Context,
  ) {
    const rows = await this.db.$queryRaw<{ value: string }[]>(Prisma.sql`
      SELECT COALESCE(SUM(${Prisma.raw(column)}),0)::text AS value FROM erp_orders
      WHERE country_code IN (${Prisma.join(context.countries)}) AND dq_status_code='VALID' AND currency_code='USD'
        AND imported_at >= ${context.from} AND imported_at <= ${context.to}
    `);
    return rows[0]?.value ?? "0";
  }

  private async logisticsMetric(
    id: string,
    context: Context,
  ): Promise<Calculation> {
    const planWhere = {
      countryCode: { in: context.countries },
      createdAt: { gte: context.from, lte: context.to },
    };
    if (id === "MET-LOG-001")
      return available(
        await this.db.logisticsPlan.count({ where: planWhere }),
        "Count",
        "persisted planning scenarios only",
      );
    const planIds = await this.db.logisticsPlan
      .findMany({ where: planWhere, select: { id: true } })
      .then((rows) => rows.map((row) => row.id));
    const versionIds = await this.db.logisticsPlanVersion
      .findMany({
        where: { logisticsPlanId: { in: planIds } },
        select: { id: true },
      })
      .then((rows) => rows.map((row) => row.id));
    if (versionIds.length === 0)
      return available(
        0,
        id === "MET-LOG-003" ? "kg" : "Count",
        "no qualifying planning scenarios",
      );
    if (id === "MET-LOG-002") {
      const sum = await this.db.logisticsPlanLine.aggregate({
        where: { planVersionId: { in: versionIds } },
        _sum: { qty: true },
      });
      return available(
        sum._sum.qty ?? zero(),
        "Boards",
        "persisted plan line quantities",
      );
    }
    if (id === "MET-LOG-003") {
      const rows = await this.db.logisticsPlanLine.findMany({
        where: { planVersionId: { in: versionIds } },
        select: { qty: true, weightKg: true },
      });
      return available(
        rows.reduce(
          (sum, row) => sum.add((row.weightKg ?? zero()).mul(row.qty)),
          zero(),
        ),
        "kg",
        "persisted plan line weight snapshots",
      );
    }
    if (id === "MET-LOG-004")
      return available(
        await this.db.logisticsTransportUnit.count({
          where: { planVersionId: { in: versionIds } },
        }),
        "Units",
        "persisted planning transport units; not shipments",
      );
    if (id === "MET-LOG-007")
      return available(
        await this.db.logisticsValidationResult.count({
          where: { planVersionId: { in: versionIds } },
        }),
        "Count",
        "persisted validation rule results",
      );
    return unavailable(
      "Percent",
      "SELECTED_PLAN_TEMPLATE_DENOMINATOR_REQUIRED",
    );
  }

  private async capacityMetric(
    id: string,
    context: Context,
  ): Promise<Calculation> {
    const category =
      id === "MET-CAP-001"
        ? "STANDARD"
        : id === "MET-CAP-002"
          ? "ORDINARY"
          : "CURVED";
    const runs = await this.db.capacityEstimateRun.findMany({
      where: { countryCode: { in: context.countries } },
      select: { id: true },
    });
    const rows = await this.db.capacityEstimate.aggregate({
      where: {
        categoryCode: category,
        calculatedAt: { gte: context.from, lte: context.to },
        estimateRunId: { in: runs.map((run) => run.id) },
      },
      _sum: { estimatedDays: true, durationHours: true },
    });
    const value = rows._sum.estimatedDays ?? zero();
    return available(
      value,
      "Days",
      `${category} estimate only; ${String(category === "STANDARD" ? 900 : category === "ORDINARY" ? 700 : 600)} boards/day and 24h/day`,
      [
        {
          key: "HOURS",
          label: "Estimated hours",
          value: (rows._sum.durationHours ?? zero()).toString(),
        },
      ],
    );
  }

  private async dqMetric(id: string, context: Context): Promise<Calculation> {
    if (id === "MET-DQ-001")
      return available(
        await this.db.dQIssue.count({
          where: { statusCode: "OPEN", createdAt: { lte: context.asOf } },
        }),
        "Count",
        "unresolved governed DQ issues",
      );
    const [total, classified] = await Promise.all([
      this.db.account.count({
        where: {
          countryCode: { in: context.countries },
          createdAt: { lte: context.asOf },
        },
      }),
      this.db.account.count({
        where: {
          countryCode: { in: context.countries },
          hqCountryCode: { not: null },
          createdAt: { lte: context.asOf },
        },
      }),
    ]);
    if (total === 0) return unavailable("Percent", "ZERO_CUSTOMERS");
    return available(
      new Prisma.Decimal(classified).div(total).mul(100).toDecimalPlaces(4),
      "Percent",
      "canonical HQ country coverage",
    );
  }

  private async fxMetric(id: string, context: Context): Promise<Calculation> {
    const rate = await this.fx(context.asOf);
    if (!rate)
      return unavailable(
        id === "MET-FX-001" ? "Rate" : "Hours",
        "FX_RATE_NOT_AVAILABLE",
      );
    if (id === "MET-FX-001")
      return available(rate.rate, "Rate", `effective USD/EGP FX ${rate.id}`);
    return available(
      new Prisma.Decimal(context.asOf.getTime() - rate.effectiveFrom.getTime())
        .div(3_600_000)
        .toDecimalPlaces(4),
      "Hours",
      "elapsed time since effective FX version",
    );
  }

  private async paymentMetric(
    id: string,
    context: Context,
  ): Promise<Calculation> {
    const payments = await this.db.payment.findMany({
      where: {
        account: { countryCode: { in: context.countries } },
        statusCode: { not: "VOIDED" },
        paymentDate: { gte: context.from, lte: context.to },
        currencyCode: context.currency,
      },
      select: { id: true, amount: true },
    });
    const received = payments.reduce((sum, row) => sum.add(row.amount), zero());
    if (id === "MET-PAY-001")
      return available(
        received,
        context.currency,
        "valid received payment facts; not revenue",
      );
    const allocation = await this.db.paymentAllocation.aggregate({
      where: { paymentId: { in: payments.map((row) => row.id) } },
      _sum: { allocatedAmount: true },
    });
    const allocated = allocation._sum.allocatedAmount ?? zero();
    return available(
      id === "MET-PAY-002" ? allocated : received.sub(allocated),
      context.currency,
      id === "MET-PAY-002"
        ? "valid payment allocations"
        : "received minus allocations in the same currency",
    );
  }

  private async chequeMetric(context: Context): Promise<Calculation> {
    const count = await this.db.cheque.count({
      where: {
        account: { countryCode: { in: context.countries } },
        currencyCode: context.currency,
        dueOn: { lte: context.asOf },
        statusCode: { notIn: ["CLEARED", "CANCELLED"] },
      },
    });
    return available(count, "Count", "current cheque lifecycle and due date");
  }

  private async returnMetric(
    id: string,
    context: Context,
  ): Promise<Calculation> {
    const where = {
      countryCode: { in: context.countries },
      finalizedAt: { gte: context.from, lte: context.to },
      statusCode: "FINALIZED",
    };
    if (id === "MET-RET-001") {
      const sum = await this.db.returnedScrapRequest.aggregate({
        where,
        _sum: { benefitValueAmount: true },
      });
      return available(
        sum._sum.benefitValueAmount ?? zero(),
        "Original currency",
        "finalized 25% original-purchase-price benefit",
      );
    }
    if (id === "MET-RET-002") {
      const rows = await this.db.returnedScrapRequest.groupBy({
        by: ["benefitTypeCode"],
        where,
        _count: true,
        _sum: { benefitValueAmount: true },
      });
      return available(
        rows.reduce(
          (sum, row) => sum.add(row._sum.benefitValueAmount ?? zero()),
          zero(),
        ),
        "Original currency",
        "finalized CREDIT vs REPLACEMENT distribution",
        rows.map((row) => ({
          key: row.benefitTypeCode,
          label: row.benefitTypeCode,
          value: (row._sum.benefitValueAmount ?? zero()).toString(),
          count: row._count,
        })),
      );
    }
    return unavailable(
      "Quantity",
      "RETURN_ELIGIBILITY_LEDGER_SELECTION_REQUIRED",
    );
  }

  private async complaintMetric(
    id: string,
    context: Context,
  ): Promise<Calculation> {
    if (id === "MET-CMP-001")
      return available(
        await this.db.complaint.count({
          where: {
            countryCode: { in: context.countries },
            statusCode: { not: "CLOSED" },
            createdAt: { lte: context.asOf },
          },
        }),
        "Count",
        "non-terminal complaint facts",
      );
    const rows = await this.db.$queryRaw<{ value: string }[]>(Prisma.sql`
      SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (${context.asOf}::timestamptz-created_at))/86400),0)::text AS value
      FROM complaints WHERE country_code IN (${Prisma.join(context.countries)}) AND status_code <> 'CLOSED'
    `);
    return available(rows[0]?.value ?? "0", "Days", "open complaint age as-of");
  }

  /**
   * Product metrics, over the ERP order lines.
   *
   * Six are declared. Three of them can be computed from what the import
   * actually carries, and three cannot — for three *different* reasons. They
   * used to share one sentence, inherited from the catch-all at the bottom of
   * `calculate`, which said the source columns "are not populated in the
   * current selected scope". That reads as a data or period problem, and sent
   * a reader looking for rows that were never the issue: two of these need a
   * classification the product master does not carry at all, and a third
   * needs a column that is null on every one of the 2,927 products. Each now
   * says which.
   */
  private async productMetric(
    id: string,
    context: Context,
  ): Promise<Calculation> {
    // Why each of these cannot be computed lives in its own module, so that
    // "every metric says which" is something a test checks rather than a
    // comment that claims it.
    const availability = productMetricAvailability(id);
    if (!availability.computed)
      return unavailable(availability.unit, availability.reason);

    // Shipped weight, exact and estimated. The line carries both an imported
    // unit weight and a calculated one; the estimate is only counted where no
    // exact weight exists, so the two never double-count the same line.
    const exact = id === "MET-PROD-005";
    if (exact || id === "MET-PROD-006") {
      const rows = await this.db.$queryRaw<{ value: string; lines: bigint }[]>(
        exact
          ? Prisma.sql`
        SELECT COALESCE(SUM(l.unit_weight_kg * l.qty_shipped),0)::text AS value,
               COUNT(*) AS lines
        FROM erp_order_lines l JOIN erp_orders e ON e.erp_order_id = l.erp_order_id
        WHERE e.country_code IN (${Prisma.join(context.countries)})
          AND e.dq_status_code='VALID' AND l.dq_status_code='VALID'
          AND l.unit_weight_kg IS NOT NULL AND l.qty_shipped > 0
          AND e.imported_at >= ${context.from} AND e.imported_at <= ${context.to}
      `
          : Prisma.sql`
        SELECT COALESCE(SUM(l.calculated_weight_kg * l.qty_shipped),0)::text AS value,
               COUNT(*) AS lines
        FROM erp_order_lines l JOIN erp_orders e ON e.erp_order_id = l.erp_order_id
        WHERE e.country_code IN (${Prisma.join(context.countries)})
          AND e.dq_status_code='VALID' AND l.dq_status_code='VALID'
          AND l.calculated_weight_kg IS NOT NULL AND l.unit_weight_kg IS NULL
          AND l.qty_shipped > 0
          AND e.imported_at >= ${context.from} AND e.imported_at <= ${context.to}
      `,
      );
      const row = rows[0];
      if (row === undefined || Number(row.lines) === 0)
        return unavailable(
          "Quantity",
          exact ? "ZERO_EXACT_WEIGHT_LINES" : "ZERO_ESTIMATED_WEIGHT_LINES",
        );
      return available(
        row.value,
        "Quantity",
        exact
          ? "imported unit weight x shipped quantity"
          : "calculated weight x shipped quantity, only where no exact weight exists",
      );
    }
    return unavailable("Quantity", "UNKNOWN_PRODUCT_METRIC");
  }

  /**
   * What a product has actually been sold for: last, min, max and average of
   * the unit selling price on matched ERP sales lines. The breakdown carries
   * the four so a reader sees the spread, not just a mean that hides it.
   */
  private async priceMetric(
    id: string,
    context: Context,
  ): Promise<Calculation> {
    if (id !== "MET-PRICE-001")
      return unavailable("USD", "UNKNOWN_PRICE_METRIC");
    const rows = await this.db.$queryRaw<
      {
        last_price: string | null;
        min_price: string | null;
        max_price: string | null;
        avg_price: string | null;
        lines: bigint;
      }[]
    >(Prisma.sql`
      SELECT
        (ARRAY_AGG(l.unit_selling_price ORDER BY COALESCE(l.booked_date, e.imported_at::date) DESC))[1]::text AS last_price,
        MIN(l.unit_selling_price)::text AS min_price,
        MAX(l.unit_selling_price)::text AS max_price,
        ROUND(AVG(l.unit_selling_price), 4)::text AS avg_price,
        COUNT(*) AS lines
      FROM erp_order_lines l JOIN erp_orders e ON e.erp_order_id = l.erp_order_id
      WHERE e.country_code IN (${Prisma.join(context.countries)})
        AND e.dq_status_code='VALID' AND l.dq_status_code='VALID'
        AND l.product_id IS NOT NULL
        AND l.unit_selling_price IS NOT NULL
        -- Free-of-charge lines are not a price anybody paid. There are 328 of
        -- them against 2,336 priced lines, and counting them puts the lowest
        -- price at zero and drags the average down by about 14% (962 to 843),
        -- which is the difference between "what we charge" and "what we
        -- invoiced including the samples we gave away".
        AND l.unit_selling_price > 0
        AND e.imported_at >= ${context.from} AND e.imported_at <= ${context.to}
    `);
    const row = rows[0];
    if (row === undefined || Number(row.lines) === 0)
      return unavailable("USD", "ZERO_MATCHED_PRICED_LINES");
    return {
      ...available(
        row.last_price ?? "0",
        "USD",
        "last paid unit price on matched ERP sales lines, excluding free-of-charge lines",
      ),
      breakdown: [
        { key: "LAST", label: "Last paid", value: row.last_price ?? "0" },
        { key: "MIN", label: "Lowest paid", value: row.min_price ?? "0" },
        { key: "MAX", label: "Highest paid", value: row.max_price ?? "0" },
        { key: "AVG", label: "Average paid", value: row.avg_price ?? "0" },
      ],
    };
  }

  private async aiMetric(
    identity: CustomerIdentity,
    id: string,
    context: Context,
  ): Promise<Calculation> {
    const where = {
      recipientUserId: identity.userId,
      countryCode: { in: context.countries },
      statusCode: "ACTIVE",
      generatedAt: { lte: context.asOf },
      OR: [{ validUntil: null }, { validUntil: { gt: context.asOf } }],
    };
    if (id === "MET-AI-001")
      return available(
        await this.db.aiRuleOutput.count({
          where: { ...where, outputTypeCode: "HIGH_PRIORITY" },
        }),
        "Count",
        "fresh persisted advisory outputs only",
      );
    const aggregate = await this.db.aiRuleOutput.aggregate({
      where,
      _avg: { scoreNumeric: true },
    });
    if (!aggregate._avg.scoreNumeric)
      return unavailable("Score", "NO_RULE_SCORE_OUTPUT");
    return available(
      aggregate._avg.scoreNumeric,
      "Rule Score",
      "versioned deterministic rule output; not ML probability",
    );
  }

  private async convert(
    calculation: Calculation,
    context: Context,
  ): Promise<Calculation> {
    if (
      context.currency !== "EGP" ||
      calculation.availability === "UNAVAILABLE" ||
      calculation.unit !== "USD" ||
      calculation.value === null
    )
      return calculation;
    const rate = await this.fx(context.asOf);
    if (!rate) return unavailable("EGP", "FX_RATE_NOT_AVAILABLE");
    return {
      ...calculation,
      value: new Prisma.Decimal(calculation.value)
        .mul(rate.rate)
        .toDecimalPlaces(4)
        .toString(),
      unit: "EGP",
      basis: `${calculation.basis}; converted using FX ${rate.id}`,
    };
  }

  private fx(asOf: Date) {
    return this.db.fXRate.findFirst({
      where: {
        baseCurrencyCode: "USD",
        quoteCurrencyCode: "EGP",
        statusCode: "ACTIVE",
        effectiveFrom: { lte: asOf },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: asOf } }],
      },
      orderBy: [{ effectiveFrom: "desc" }, { version: "desc" }],
    });
  }

  private async drilldownRows(
    identity: CustomerIdentity,
    report: ReportDefinition,
    context: Context,
    offset: number,
    limit: number,
    sort: string,
    metricId?: string,
    stageCode?: string,
  ) {
    const order = sort.endsWith("_asc") ? "asc" : "desc";
    if (metricId?.startsWith("MET-QUOTE-")) {
      const where = {
        countryCode: { in: context.countries },
        createdAt: { lte: context.asOf },
      };
      const [total, quotes] = await Promise.all([
        this.db.quotation.count({ where }),
        this.db.quotation.findMany({
          where,
          skip: offset,
          take: limit,
          orderBy: [{ createdAt: order }, { id: "asc" }],
          select: {
            id: true,
            quotationRef: true,
            accountId: true,
            statusCode: true,
            currencyCode: true,
            totalAmount: true,
            sentAt: true,
          },
        }),
      ]);
      return {
        total,
        rows: quotes.map((q) => ({
          ...q,
          totalAmount: q.totalAmount.toString(),
        })),
      };
    }
    if (report.reportId === "RPT-006" || metricId?.startsWith("MET-ERP-")) {
      const where = {
        countryCode: { in: context.countries },
        dqStatusCode: "VALID",
        importedAt: { gte: context.from, lte: context.to },
      };
      const [total, rows] = await Promise.all([
        this.db.eRPOrder.count({ where }),
        this.db.eRPOrder.findMany({
          where,
          skip: offset,
          take: limit,
          orderBy: [{ importedAt: order }, { id: "asc" }],
          select: {
            id: true,
            sourceOrderKey: true,
            countryCode: true,
            orderDate: true,
            statusCode: true,
            currencyCode: true,
            bookedAmount: true,
            shippedAmount: true,
            invoicedAmount: true,
            interfacedAt: true,
            importedAt: true,
          },
        }),
      ]);
      return {
        total,
        rows: rows.map((row) => ({
          ...row,
          bookedAmount: row.bookedAmount?.toString() ?? null,
          shippedAmount: row.shippedAmount?.toString() ?? null,
          invoicedAmount: row.invoicedAmount?.toString() ?? null,
        })),
      };
    }
    if (["RPT-002", "RPT-003", "RPT-005"].includes(report.reportId)) {
      const where = {
        countryCode: { in: context.countries },
        createdAt: { lte: context.asOf },
      };
      const [total, rows] = await Promise.all([
        this.db.account.count({ where }),
        this.db.account.findMany({
          where,
          skip: offset,
          take: limit,
          orderBy: [{ updatedAt: order }, { id: "asc" }],
          select: {
            id: true,
            accountRef: true,
            canonicalName: true,
            countryCode: true,
            hqCountryCode: true,
            accountCategoryCode: true,
            recordStatusCode: true,
          },
        }),
      ]);
      return { total, rows };
    }
    if (
      report.reportId === "RPT-004" ||
      metricId?.startsWith("MET-PIPE-") ||
      metricId?.startsWith("MET-TGT-")
    ) {
      const where = {
        countryCode: { in: context.countries },
        updatedAt: { lte: context.asOf },
        ...(stageCode || metricId?.startsWith("MET-TGT-")
          ? { stageCode: stageCode ?? "WON" }
          : {}),
      };
      const [total, rows] = await Promise.all([
        this.db.opportunity.count({ where }),
        this.db.opportunity.findMany({
          where,
          skip: offset,
          take: limit,
          orderBy: [{ updatedAt: order }, { id: "asc" }],
          select: {
            id: true,
            opportunityRef: true,
            accountId: true,
            projectId: true,
            countryCode: true,
            ownerUserId: true,
            stageCode: true,
            estimatedValue: true,
            currencyCode: true,
            probabilityPct: true,
            expectedCloseDate: true,
            lostReasonCode: true,
            wonAt: true,
          },
        }),
      ]);
      return {
        total,
        rows: rows.map((row) => ({
          ...row,
          estimatedValue: row.estimatedValue?.toString() ?? null,
          probabilityPct: row.probabilityPct?.toString() ?? null,
        })),
      };
    }
    if (["RPT-010", "RPT-011", "RPT-018"].includes(report.reportId)) {
      this.require(identity, "reports.finance");
      const where = {
        account: { countryCode: { in: context.countries } },
        paymentDate: { gte: context.from, lte: context.to },
      };
      const [total, rows] = await Promise.all([
        this.db.payment.count({ where }),
        this.db.payment.findMany({
          where,
          skip: offset,
          take: limit,
          orderBy: [{ paymentDate: order }, { id: "asc" }],
          select: {
            id: true,
            accountId: true,
            amount: true,
            currencyCode: true,
            statusCode: true,
            paymentDate: true,
            paymentMethodCode: true,
          },
        }),
      ]);
      return {
        total,
        rows: rows.map((row) => ({ ...row, amount: row.amount.toString() })),
      };
    }
    return { total: 0, rows: [] };
  }

  private metricDefinition(metricId: string): MetricDefinition {
    const definition = effectiveMetricRegistry.find(
      (item) => item.metricId === metricId,
    );
    if (!definition) missing("METRIC_NOT_FOUND");
    return definition;
  }

  private reportDefinition(reportId: string): ReportDefinition {
    const definition = effectiveReportRegistry.find(
      (item) => item.reportId === reportId,
    );
    if (!definition) missing("REPORT_NOT_FOUND");
    return definition;
  }

  private context(
    identity: CustomerIdentity,
    query: AnalyticsQueryDto,
  ): Context {
    const asOf = query.asOf ? new Date(query.asOf) : new Date();
    const from = query.from
      ? new Date(query.from)
      : new Date(Date.UTC(asOf.getUTCFullYear(), 0, 1));
    const to = query.to ? new Date(query.to) : asOf;
    if (
      ![asOf, from, to].every((date) => Number.isFinite(date.getTime())) ||
      from > to ||
      to > asOf
    )
      rule("INVALID_ANALYTICS_DATE_RANGE");
    const granted = [...identity.countryCodes]
      .map((code) => code.trim())
      .sort();
    if (granted.length === 0) forbid();
    let countries = granted;
    if (query.countryCode) {
      const requested = query.countryCode.toUpperCase();
      if (!granted.includes(requested)) forbid();
      countries = [requested];
    }
    return { asOf, from, to, countries, currency: query.currency };
  }

  private filters(context: Context) {
    return {
      from: context.from.toISOString(),
      to: context.to.toISOString(),
      currency: context.currency,
      countryCodes: context.countries,
    };
  }

  private allowed(identity: CustomerIdentity, permission: string) {
    return (
      identity.permissions.has(permission) &&
      !identity.deniedPermissions.has(permission)
    );
  }

  private require(identity: CustomerIdentity, permission: string) {
    if (!this.allowed(identity, permission)) forbid();
  }
}

function available(
  value: Prisma.Decimal | bigint | number | string,
  unit: string,
  basis: string,
  breakdown?: Breakdown[],
): Calculation {
  return {
    value: value instanceof Prisma.Decimal ? value.toString() : String(value),
    unit,
    basis,
    availability: "AVAILABLE",
    ...(breakdown ? { breakdown } : {}),
  };
}
function unavailable(unit: string, reason: string): Calculation {
  return {
    value: null,
    unit,
    basis: "UNAVAILABLE",
    availability: "UNAVAILABLE",
    unavailableReason: reason,
  };
}
function zero() {
  return new Prisma.Decimal(0);
}
function sha(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function mergeDq(
  metrics: {
    dqContext: { excludedDataConflict: number; unclassified: number };
  }[],
) {
  return metrics.reduce(
    (acc, item) => ({
      excludedDataConflict: Math.max(
        acc.excludedDataConflict,
        item.dqContext.excludedDataConflict,
      ),
      unclassified: Math.max(acc.unclassified, item.dqContext.unclassified),
    }),
    { excludedDataConflict: 0, unclassified: 0 },
  );
}
function bad(code: string): never {
  throw new ApiProblem({ status: 400, code });
}
function forbid(): never {
  throw new ApiProblem({ status: 403, code: "FORBIDDEN" });
}
function missing(code: string): never {
  throw new ApiProblem({ status: 404, code });
}
function conflict(code: string): never {
  throw new ApiProblem({ status: 409, code });
}
function rule(code: string): never {
  throw new ApiProblem({ status: 422, code });
}
