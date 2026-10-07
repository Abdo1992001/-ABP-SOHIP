import { Inject, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { permissions } from "@abp/contracts";
import {
  Prisma,
  type DatabaseClient,
  type TransactionClient,
  type TransactionManager,
} from "@abp/database";
import {
  hasWorkspace,
  isSystemAdmin,
  type CustomerIdentity,
} from "../customer/customer-auth.js";
import { ApiProblem } from "../platform/api-exception.filter.js";
import { AuditService } from "../platform/audit.service.js";
import {
  databaseClientToken,
  transactionManagerToken,
} from "../platform/database.providers.js";
import { clampDate } from "./target-window.js";
import type {
  SetPersonTargetDto,
  SetTargetDto,
  SetTargetPeriodsDto,
} from "./targets.dto.js";
@Injectable()
export class TargetsService {
  constructor(
    @Inject(databaseClientToken) private readonly db: DatabaseClient,
    @Inject(transactionManagerToken) private readonly txs: TransactionManager,
    private readonly audit: AuditService,
  ) {}
  async getCurrent(i: CustomerIdentity) {
    this.require(i, permissions.targetsView);
    const row = await this.db.companyTarget.findFirst({
      where: {
        statusCode: "ACTIVE",
        effectiveFrom: { lte: new Date() },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: new Date() } }],
      },
      orderBy: [{ targetYear: "desc" }, { version: "desc" }],
    });
    if (!row) missing("COMPANY_TARGET_NOT_FOUND");
    return {
      data: await targetData(this.db, row),
      analyticsMetadata: metadata(
        "company-target-config",
        "Company target configuration",
      ),
    };
  }
  async set(
    i: CustomerIdentity,
    ifMatch: string | undefined,
    key: string | undefined,
    yearRaw: string,
    b: SetTargetDto,
  ) {
    this.requireManage(i);
    const year = parseYear(yearRaw),
      expected = parseEtag(ifMatch, true);
    key = requireKey(key);
    const amount = new Prisma.Decimal(b.annualTargetAmount);
    if (!amount.isPositive()) rule("TARGET_AMOUNT_INVALID");
    return this.txs.run(
      i,
      async (tx) => {
        const current = await tx.companyTarget.findFirst({
          where: { targetYear: year, statusCode: "ACTIVE" },
          orderBy: { version: "desc" },
        });
        if ((current?.rowVersion ?? 0n) !== expected) precondition();
        const requestHash = hash({ year, b }),
          replay = await this.replay(
            tx,
            i,
            "put_company_target",
            key,
            requestHash,
          );
        if (replay) {
          const row = await tx.companyTarget.findUniqueOrThrow({
            where: { id: replay },
          });
          return {
            data: await targetData(tx, row),
            etag: etag(row.rowVersion),
            analyticsMetadata: metadata(
              "company-target-config",
              "Company target configuration",
            ),
          };
        }
        const now = new Date();
        if (current)
          await tx.companyTarget.update({
            where: { id: current.id },
            data: { statusCode: "INACTIVE", effectiveTo: now },
          });
        const version =
          (
            await tx.companyTarget.aggregate({
              where: { targetYear: year },
              _max: { version: true },
            })
          )._max.version ?? 0;
        const row = await tx.companyTarget.create({
          data: {
            targetYear: year,
            periodStart: new Date(`${year}-01-01T00:00:00Z`),
            periodEnd: new Date(`${year}-12-31T00:00:00Z`),
            amountUsd: amount,
            version: version + 1,
            statusCode: "ACTIVE",
            effectiveFrom: now,
            companyCode: "ACROW",
            baseCurrencyCode: "USD",
            createdByUserId: i.userId,
            rowVersion: (current?.rowVersion ?? 0n) + 1n,
          },
        });
        await this.remember(
          tx,
          i,
          "put_company_target",
          key,
          requestHash,
          row.id,
        );
        await this.record(tx, i, "COMPANY_TARGET_VERSION_CREATED", row.id, {
          year,
          version: row.version,
          amountUsd: amount.toString(),
        });
        return {
          data: await targetData(tx, row),
          etag: etag(row.rowVersion),
          analyticsMetadata: metadata(
            "company-target-config",
            "Company target configuration",
          ),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
  async setPeriods(
    i: CustomerIdentity,
    ifMatch: string | undefined,
    key: string | undefined,
    yearRaw: string,
    b: SetTargetPeriodsDto,
  ) {
    this.requireManage(i);
    const year = parseYear(yearRaw),
      expected = parseEtag(ifMatch);
    key = requireKey(key);
    validatePeriods(year, b);
    return this.txs.run(
      i,
      async (tx) => {
        const target = await tx.companyTarget.findFirst({
          where: { targetYear: year, statusCode: "ACTIVE" },
          orderBy: { version: "desc" },
        });
        if (!target) missing("COMPANY_TARGET_NOT_FOUND");
        if (target.rowVersion !== expected) precondition();
        const requestHash = hash({ year, b }),
          replay = await this.replay(
            tx,
            i,
            "put_company_target_periods",
            key,
            requestHash,
          );
        if (replay) {
          const row = await tx.companyTarget.findUniqueOrThrow({
            where: { id: replay },
          });
          return {
            data: await targetData(tx, row),
            etag: etag(row.rowVersion),
            analyticsMetadata: metadata(
              "company-target-config",
              "Company target configuration",
            ),
          };
        }
        const now = new Date(),
          version =
            (
              await tx.targetAllocation.aggregate({
                where: { companyTargetId: target.id },
                _max: { version: true },
              })
            )._max.version ?? 0;
        await tx.targetAllocation.updateMany({
          where: { companyTargetId: target.id, effectiveTo: null },
          data: { effectiveTo: now },
        });
        for (const p of b.periods)
          await tx.targetAllocation.create({
            data: {
              companyTargetId: target.id,
              allocationTypeCode: p.periodTypeCode,
              periodStart: new Date(p.periodStart),
              periodEnd: new Date(p.periodEnd),
              amountUsd: p.targetAmount,
              version: version + 1,
              effectiveFrom: now,
              createdByUserId: i.userId,
            },
          });
        const row = await tx.companyTarget.update({
          where: { id: target.id },
          data: { rowVersion: { increment: 1 } },
        });
        await this.remember(
          tx,
          i,
          "put_company_target_periods",
          key,
          requestHash,
          target.id,
        );
        await this.record(
          tx,
          i,
          "COMPANY_TARGET_PERIODS_VERSIONED",
          target.id,
          { year, version: version + 1, count: b.periods.length },
        );
        return {
          data: await targetData(tx, row),
          etag: etag(row.rowVersion),
          analyticsMetadata: metadata(
            "company-target-config",
            "Company target configuration",
          ),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
  async performance(i: CustomerIdentity, yearRaw: string) {
    this.require(i, permissions.targetsView);
    const year = parseYear(yearRaw),
      target = await this.db.companyTarget.findFirst({
        where: { targetYear: year, statusCode: "ACTIVE" },
        orderBy: { version: "desc" },
      });
    if (!target) missing("COMPANY_TARGET_NOT_FOUND");
    const start = new Date(`${year}-01-01T00:00:00Z`),
      end = new Date(`${year + 1}-01-01T00:00:00Z`),
      won = await activeWonAmount(this.db, start, end, [...i.countryCodes]),
      allocations = await activePeriods(this.db, target.id);

    // A target is only meaningful next to what was actually invoiced. WON
    // opportunities are the pipeline's own answer, and while the CRM is still
    // being populated that answer is zero — which made the whole dashboard
    // read as broken even though the company had sold a quarter of a billion
    // pounds that year. Realised sales come from the ERP order history and are
    // reported alongside, never merged into, the WON figure.
    const fx = await usdEgpRate(this.db, end);
    const realisedByPeriod = await realisedSalesByMonth(this.db, start, end, [
      ...i.countryCodes,
    ]);
    const toBase = (egp: Prisma.Decimal) =>
      fx.rate.isZero() ? new Prisma.Decimal(0) : egp.div(fx.rate);
    const realisedEgp = [...realisedByPeriod.values()].reduce(
      (sum, amount) => sum.add(amount),
      new Prisma.Decimal(0),
    );
    const realised = toBase(realisedEgp);

    const periods = [];
    for (const p of allocations) {
      const pWon = await activeWonAmount(
        this.db,
        p.periodStart,
        endOfDay(p.periodEnd),
        [...i.countryCodes],
      );
      const pRealisedEgp = sumRealisedBetween(
        realisedByPeriod,
        p.periodStart,
        p.periodEnd,
      );
      periods.push({
        ...performancePeriod(p.periodStart, p.periodEnd, p.amountUsd, pWon),
        realisedAmount: toBase(pRealisedEgp).toDecimalPlaces(4).toString(),
        realisedAmountEgp: pRealisedEgp.toDecimalPlaces(2).toString(),
        realisedAchievementPct: pct(toBase(pRealisedEgp), p.amountUsd),
      });
    }
    return {
      data: {
        year,
        baseCurrencyCode: "USD",
        targetAmount: target.amountUsd.toString(),
        wonAmount: won.toString(),
        remainingAmount: Prisma.Decimal.max(
          target.amountUsd.sub(won),
          0,
        ).toString(),
        achievementPct: pct(won, target.amountUsd),
        realisedAmount: realised.toDecimalPlaces(4).toString(),
        realisedAmountEgp: realisedEgp.toDecimalPlaces(2).toString(),
        realisedAchievementPct: pct(realised, target.amountUsd),
        realisedRemainingAmount: Prisma.Decimal.max(
          target.amountUsd.sub(realised),
          0,
        ).toString(),
        // The rate the conversion above used, and when it took effect, so the
        // reader can tell today's dollar from last month's.
        fxRate: fx.rate.toString(),
        fxEffectiveAt: fx.effectiveAt ? fx.effectiveAt.toISOString() : null,
        fxSourceCode: fx.sourceCode,
        periods,
      },
      analyticsMetadata: metadata(
        "company-target-performance-v2",
        "Opportunity WON snapshots in USD; realised sales from ERP order history in EGP converted at the effective USD/EGP rate",
      ),
    };
  }
  /**
   * Everyone who sells, with their target and where they stand against it.
   *
   * "Everyone who sells" is anybody holding a sales rep or sales manager role
   * who is not a system administrator -- a manager who also carries accounts
   * has a target like anyone else; an administrator account does not sell.
   * A manager sees the whole list; anyone else sees only their own line.
   */
  async people(
    i: CustomerIdentity,
    yearRaw: string,
    fromRaw?: string,
    toRaw?: string,
  ) {
    this.require(i, permissions.targetsView);
    const year = parseYear(yearRaw);
    const manager =
      isSystemAdmin(i) ||
      (i.permissions.has(permissions.salesManagementView) &&
        !i.deniedPermissions.has(permissions.salesManagementView));
    const sellers = await this.db.appUser.findMany({
      where: {
        active: true,
        ...(manager ? {} : { id: i.userId }),
        roles: {
          some: { role: { code: { in: ["SALES_REP", "SALES_MANAGER"] } } },
        },
        NOT: { roles: { some: { role: { code: "SYSTEM_ADMIN" } } } },
      },
      select: { id: true, displayName: true },
      orderBy: { displayName: "asc" },
    });
    const ids = sellers.map((s) => s.id);
    // Won is counted in the window asked for -- this month, the quarter --
    // and never outside the year the target belongs to.
    const yearStart = new Date(`${String(year)}-01-01T00:00:00Z`);
    const yearEnd = new Date(`${String(year + 1)}-01-01T00:00:00Z`);
    const start = clampDate(fromRaw, yearStart, yearStart, yearEnd);
    const end = clampDate(toRaw, yearEnd, yearStart, yearEnd);
    if (start === null || end === null || end < start)
      throw new ApiProblem({ status: 400, code: "TARGET_WINDOW_INVALID" });
    const fx = await usdEgpRate(this.db, yearEnd);
    const [targets, won, pipeline] = await Promise.all([
      this.db.salesPersonTarget.findMany({
        where: { targetYear: year, userId: { in: ids } },
      }),
      wonByOwner(this.db, start, end, ids),
      pipelineByOwner(this.db, ids),
    ]);
    const toEgp = (usd: Prisma.Decimal) => usd.mul(fx.rate).toDecimalPlaces(2);
    return {
      data: sellers.map((seller) => {
        const target = targets.find((t) => t.userId === seller.id);
        const wonUsd = won.get(seller.id) ?? new Prisma.Decimal(0);
        const open = pipeline.get(seller.id);
        return {
          userId: seller.id,
          displayName: seller.displayName,
          targetEgp: target ? target.amountEgp.toString() : null,
          wonEgp: toEgp(wonUsd).toString(),
          pipelineEgp: toEgp(
            open?.weightedUsd ?? new Prisma.Decimal(0),
          ).toString(),
          openOpportunities: open?.count ?? 0,
        };
      }),
      meta: {
        year,
        from: start.toISOString(),
        to: end.toISOString(),
        fxRate: fx.rate.toString(),
        fxEffectiveAt: fx.effectiveAt?.toISOString() ?? null,
      },
    };
  }

  /** A manager sets one person's target for the year; null clears it. */
  async setPerson(
    i: CustomerIdentity,
    yearRaw: string,
    userId: string,
    input: SetPersonTargetDto,
  ) {
    this.requireManage(i);
    const year = parseYear(yearRaw);
    const seller = await this.db.appUser.findFirst({
      where: { id: userId, active: true },
      select: { id: true },
    });
    if (!seller) missing("USER_NOT_FOUND");
    const before = await this.db.salesPersonTarget.findUnique({
      where: { targetYear_userId: { targetYear: year, userId } },
    });
    if (input.amountEgp == null) {
      if (before)
        await this.db.salesPersonTarget.delete({
          where: { targetYear_userId: { targetYear: year, userId } },
        });
      return { data: { userId, year, targetEgp: null } };
    }
    const amount = new Prisma.Decimal(input.amountEgp);
    const row = await this.db.salesPersonTarget.upsert({
      where: { targetYear_userId: { targetYear: year, userId } },
      create: {
        targetYear: year,
        userId,
        amountEgp: amount,
        updatedByUserId: i.userId,
      },
      update: {
        amountEgp: amount,
        updatedByUserId: i.userId,
        updatedAt: new Date(),
      },
    });
    return { data: { userId, year, targetEgp: row.amountEgp.toString() } };
  }

  private require(i: CustomerIdentity, p: string) {
    if (
      !hasWorkspace(i, "SALES") ||
      i.deniedPermissions.has(p) ||
      !i.permissions.has(p)
    )
      forbidden();
  }
  private requireManage(i: CustomerIdentity) {
    this.require(i, permissions.targetsManage);
    if (
      i.deniedPermissions.has(permissions.salesManagementView) ||
      !i.permissions.has(permissions.salesManagementView)
    )
      forbidden();
  }
  private replay(
    tx: TransactionClient,
    i: CustomerIdentity,
    op: string,
    key: string,
    h: string,
  ) {
    return tx.commandIdempotency
      .findUnique({
        where: {
          actorUserId_operationCode_idempotencyKey: {
            actorUserId: i.userId,
            operationCode: op,
            idempotencyKey: key,
          },
        },
      })
      .then((r) => {
        if (r && r.requestHash !== h) conflict("IDEMPOTENCY_KEY_REUSED");
        return r?.responseResourceId;
      });
  }
  private remember(
    tx: TransactionClient,
    i: CustomerIdentity,
    op: string,
    key: string,
    h: string,
    id: string,
  ) {
    return tx.commandIdempotency.create({
      data: {
        actorUserId: i.userId,
        operationCode: op,
        idempotencyKey: key,
        requestHash: h,
        responseResourceId: id,
      },
    });
  }
  private record(
    tx: TransactionClient,
    i: CustomerIdentity,
    actionCode: string,
    id: string,
    metadata: Record<string, unknown>,
  ) {
    return this.audit.record(tx, {
      actorUserId: i.userId,
      actorSessionId: i.sessionId,
      actionCode,
      resourceType: "CompanyTarget",
      resourceId: id,
      workspace: "SALES",
      countryCode: null,
      metadata,
      traceId: i.traceId,
      correlationId: i.correlationId,
      source: "targets-api",
    });
  }
}
async function activePeriods(
  db: DatabaseClient | TransactionClient,
  id: string,
) {
  const rows = await db.targetAllocation.findMany({
    where: { companyTargetId: id, effectiveTo: null },
    orderBy: [{ periodStart: "asc" }, { allocationTypeCode: "asc" }],
  });
  return rows;
}
async function targetData(
  db: DatabaseClient | TransactionClient,
  r: Prisma.CompanyTargetGetPayload<object>,
) {
  const periods = await activePeriods(db, r.id);
  return {
    target: {
      companySalesTargetId: r.id,
      targetYear: r.targetYear,
      companyCode: r.companyCode,
      baseCurrencyCode: r.baseCurrencyCode.trim(),
      annualTargetAmount: r.amountUsd.toString(),
      statusCode: r.statusCode,
      createdByUserId: r.createdByUserId,
      rowVersion: r.rowVersion.toString(),
    },
    periods: periods.map((p) => ({
      periodTypeCode: p.allocationTypeCode,
      periodStart: p.periodStart.toISOString().slice(0, 10),
      periodEnd: p.periodEnd.toISOString().slice(0, 10),
      targetAmount: p.amountUsd.toString(),
    })),
  };
}
/**
 * The USD/EGP rate in force at `at`. The newest ACTIVE rate effective on or
 * before that moment wins; if the table is empty the caller gets a zero rate
 * and every converted figure comes out zero, which is visibly wrong rather
 * than quietly wrong.
 */
async function usdEgpRate(
  db: DatabaseClient,
  at: Date,
): Promise<{
  rate: Prisma.Decimal;
  effectiveAt: Date | null;
  sourceCode: string | null;
}> {
  const row = await db.fXRate.findFirst({
    where: {
      baseCurrencyCode: "USD",
      quoteCurrencyCode: "EGP",
      statusCode: "ACTIVE",
      effectiveFrom: { lte: at },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
    },
    orderBy: { effectiveFrom: "desc" },
  });
  return {
    rate: row ? row.rate : new Prisma.Decimal(0),
    effectiveAt: row ? row.effectiveFrom : null,
    sourceCode: row ? row.sourceCode : null,
  };
}

/** Realised ERP sales in EGP, bucketed by the first day of each month. */
async function realisedSalesByMonth(
  db: DatabaseClient,
  from: Date,
  to: Date,
  countryCodes: string[],
): Promise<Map<string, Prisma.Decimal>> {
  const scope =
    countryCodes.length > 0
      ? Prisma.sql`o.country_code IN (${Prisma.join(countryCodes)})`
      : Prisma.sql`FALSE`;
  const rows = await db.$queryRaw<{ bucket: Date; amount: string }[]>(
    Prisma.sql`
      SELECT date_trunc('month', o.order_date) AS bucket,
             COALESCE(SUM(l.line_amount_egp), 0)::text AS amount
      FROM erp_orders o
      JOIN erp_order_lines l ON l.erp_order_id = o.erp_order_id
      WHERE o.order_date >= ${from} AND o.order_date < ${to}
        AND NOT o.is_intercompany
        AND ${scope}
      GROUP BY 1`,
  );
  const map = new Map<string, Prisma.Decimal>();
  for (const row of rows) {
    if (!row.bucket) continue;
    map.set(
      row.bucket.toISOString().slice(0, 7),
      new Prisma.Decimal(row.amount),
    );
  }
  return map;
}

/** Sums the monthly buckets a target period covers, inclusive of both ends. */
function sumRealisedBetween(
  buckets: Map<string, Prisma.Decimal>,
  start: Date,
  end: Date,
): Prisma.Decimal {
  let total = new Prisma.Decimal(0);
  const cursor = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1),
  );
  const last = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1);
  while (cursor.getTime() <= last) {
    const amount = buckets.get(cursor.toISOString().slice(0, 7));
    if (amount) total = total.add(amount);
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return total;
}

function performancePeriod(
  start: Date,
  end: Date,
  target: Prisma.Decimal,
  won: Prisma.Decimal,
) {
  return {
    periodStart: start.toISOString().slice(0, 10),
    periodEnd: end.toISOString().slice(0, 10),
    targetAmount: target.toString(),
    wonAmount: won.toString(),
    remainingAmount: Prisma.Decimal.max(target.sub(won), 0).toString(),
    achievementPct: pct(won, target),
  };
}
function pct(won: Prisma.Decimal, target: Prisma.Decimal) {
  return target.isZero()
    ? null
    : won.div(target).mul(100).toDecimalPlaces(4).toString();
}

/** Won in the window, by owner: the latest won snapshot of each opportunity. */
async function wonByOwner(
  db: DatabaseClient,
  from: Date,
  to: Date,
  ownerIds: string[],
): Promise<Map<string, Prisma.Decimal>> {
  if (ownerIds.length === 0) return new Map();
  const rows = await db.$queryRaw<
    { owner: string; value: string }[]
  >(Prisma.sql`
    WITH latest_won AS (
      SELECT DISTINCT ON (s.opportunity_id) o.owner_user_id AS owner, s.value
      FROM opportunity_won_snapshots s
      JOIN opportunities o ON o.opportunity_id = s.opportunity_id
      WHERE o.stage_code = 'WON'
        AND s.currency_code = 'USD'
        AND s.won_at >= ${from}
        AND s.won_at < ${to}
        AND o.owner_user_id::text IN (${Prisma.join(ownerIds)})
      ORDER BY s.opportunity_id, s.won_at DESC, s.opportunity_won_snapshot_id DESC
    )
    SELECT owner::text AS owner, COALESCE(SUM(value), 0)::text AS value
    FROM latest_won GROUP BY owner
  `);
  return new Map(rows.map((r) => [r.owner, new Prisma.Decimal(r.value)]));
}

/** Open pipeline by owner: value x probability, as the company's is weighted. */
async function pipelineByOwner(
  db: DatabaseClient,
  ownerIds: string[],
): Promise<Map<string, { weightedUsd: Prisma.Decimal; count: number }>> {
  if (ownerIds.length === 0) return new Map();
  const rows = await db.$queryRaw<
    { owner: string; value: string; n: number }[]
  >(Prisma.sql`
    SELECT owner_user_id::text AS owner,
           COALESCE(SUM(estimated_value * COALESCE(probability_pct, 0) / 100), 0)::text AS value,
           COUNT(*)::int AS n
    FROM opportunities
    WHERE stage_code NOT IN ('WON', 'LOST')
      AND currency_code = 'USD'
      AND owner_user_id::text IN (${Prisma.join(ownerIds)})
    GROUP BY owner_user_id
  `);
  return new Map(
    rows.map((r) => [
      r.owner,
      { weightedUsd: new Prisma.Decimal(r.value), count: r.n },
    ]),
  );
}

async function activeWonAmount(
  db: DatabaseClient,
  from: Date,
  to: Date,
  countryCodes: string[],
) {
  if (countryCodes.length === 0) return new Prisma.Decimal(0);
  const rows = await db.$queryRaw<{ value: string }[]>(Prisma.sql`
    WITH latest_won AS (
      SELECT DISTINCT ON (s.opportunity_id) s.value
      FROM opportunity_won_snapshots s
      JOIN opportunities o ON o.opportunity_id = s.opportunity_id
      WHERE o.stage_code = 'WON'
        AND s.currency_code = 'USD'
        AND s.won_at >= ${from}
        AND s.won_at < ${to}
        AND o.country_code IN (${Prisma.join(countryCodes)})
      ORDER BY s.opportunity_id, s.won_at DESC, s.opportunity_won_snapshot_id DESC
    )
    SELECT COALESCE(SUM(value), 0)::text AS value FROM latest_won
  `);
  return new Prisma.Decimal(rows[0]?.value ?? 0);
}

function endOfDay(value: Date) {
  return new Date(value.getTime() + 86_400_000);
}
function metadata(metricId: string, basis: string) {
  return {
    metricId,
    metricVersion: "1.0.0",
    asOf: new Date().toISOString(),
    source: "ABP PostgreSQL",
    currency: "USD",
    basis,
    scope: "ACROW company only",
  };
}
function validatePeriods(year: number, b: SetTargetPeriodsDto) {
  const seen = new Set<string>();
  for (const p of b.periods) {
    const start = new Date(p.periodStart),
      end = new Date(p.periodEnd),
      amount = new Prisma.Decimal(p.targetAmount);
    if (
      start.getUTCFullYear() !== year ||
      end.getUTCFullYear() !== year ||
      end < start ||
      !amount.isPositive()
    )
      rule("TARGET_PERIOD_INVALID");
    const key = `${p.periodTypeCode}:${p.periodStart}`;
    if (seen.has(key)) rule("TARGET_PERIOD_DUPLICATE");
    seen.add(key);
  }
}
function parseYear(v: string) {
  if (!/^\d{4}$/.test(v))
    throw new ApiProblem({ status: 400, code: "TARGET_YEAR_INVALID" });
  return Number(v);
}
function hash(v: unknown) {
  return createHash("sha256").update(JSON.stringify(v)).digest("hex");
}
function requireKey(k: string | undefined) {
  if (!k || k.length < 8 || k.length > 200)
    throw new ApiProblem({ status: 400, code: "IDEMPOTENCY_KEY_REQUIRED" });
  return k;
}
function parseEtag(v: string | undefined, allowZero = false) {
  const m = v?.match(/^(?:W\/)?"(\d+)"$/);
  if (!m) throw new ApiProblem({ status: 428, code: "IF_MATCH_REQUIRED" });
  const n = BigInt(m[1]!);
  if (!allowZero && n === 0n) precondition();
  return n;
}
function etag(v: bigint) {
  return `"${v.toString()}"`;
}
function missing(code: string): never {
  throw new ApiProblem({ status: 404, code });
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
function rule(code: string): never {
  throw new ApiProblem({ status: 422, code });
}
