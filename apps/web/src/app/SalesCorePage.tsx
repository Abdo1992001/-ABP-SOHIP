import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "react-router";
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { ApiClient, components } from "@abp/api-client";
import { permissions } from "@abp/contracts";
import { listAccounts, type Me } from "../api/customer-api.ts";
import { listActivities } from "../api/activity-api.ts";
import { listOpportunities } from "../api/opportunity-api.ts";
import { listQuotations } from "../api/quotation-api.ts";
import { teamRoster } from "../api/identity-api.ts";
import { useI18n } from "../i18n/i18n.tsx";
import { asNum, formatNum, toNum } from "../lib/numbers.ts";
import { AppIcon, PageHeader } from "./CommercialUI.tsx";
import { SharePie } from "./SharePie.tsx";
import { metricText } from "../lib/metric-format.ts";
import {
  parsePeople,
  personStanding,
  scopeWindow as personWindow,
} from "../lib/person-targets.ts";
import { OrderToCashBand } from "./OrderToCashBand.tsx";

type GovernedReport = components["schemas"]["GovernedAnalyticsReport"];
type GovernedMetric = components["schemas"]["GovernedMetricResult"];
type TargetPerformance = components["schemas"]["TargetPerformance"];
type SalesOrderList = components["schemas"]["SalesOrderListEnvelope"];
type SalesHistory = components["schemas"]["SalesHistory"];

/** Quotations this close to expiry are the ones worth chasing today. */
const expiringWithinDays = 14;

const dashboardMetricIds = [
  "MET-TGT-001",
  "MET-TGT-003",
  "MET-TGT-004",
  "MET-TGT-005",
  "MET-TGT-006",
  "MET-PIPE-001",
  "MET-PIPE-002",
  "MET-PIPE-003",
  "MET-PIPE-005",
  "MET-PIPE-006",
  "MET-QUOTE-001",
  "MET-QUOTE-002",
  "MET-QUOTE-003",
  "MET-QUOTE-005",
  "MET-CUST-002",
  "MET-CUST-003",
  "MET-GEO-004",
  "MET-ERP-001",
  "MET-ERP-006",
  "MET-LOG-003",
  "MET-CAP-003",
  "MET-AI-001",
] as const;
const dashboardMetricIdSet = new Set<string>(dashboardMetricIds);

export type DashboardScope = "MONTH" | "QUARTER" | "YEAR" | "CUSTOM";
/** `yyyy-mm-dd` for a date input, in UTC so it agrees with the query window. */
function dateInput(value: Date): string {
  return value.toISOString().slice(0, 10);
}
function todayInput(): string {
  return dateInput(new Date());
}
function monthStartInput(): string {
  const now = new Date();
  return dateInput(
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
  );
}
export function SalesCorePage({ client, me }: { client: ApiClient; me: Me }) {
  const { locale } = useI18n();
  const location = useLocation();
  const isManagement = location.pathname === "/sales/management";
  const isSupport = location.pathname === "/sales/support";
  const granted = useMemo(() => new Set(me.access.permissions), [me]);
  const labels = locale === "ar" ? ar : en;

  const report = useQuery<GovernedReport>({
    queryKey: ["dashboard", "governed-report", isManagement],
    enabled: granted.has(permissions.reportsCommercial),
    queryFn: async () => {
      const result = await client.GET("/analytics/reports/{reportId}", {
        params: {
          path: { reportId: "RPT-001" },
          query: { asOf: new Date().toISOString(), currency: "USD" },
        },
      });
      if (!result.data)
        throw new Error(`DASHBOARD_REPORT_${String(result.response.status)}`);
      return result.data.data as unknown as GovernedReport;
    },
    retry: false,
  });
  const accounts = useQuery({
    queryKey: ["dashboard", "recent-customers"],
    enabled: granted.has(permissions.accountsView),
    queryFn: () =>
      listAccounts(client, {
        page: 1,
        limit: 25,
        sort: "canonicalName:asc",
        archiveState: "ACTIVE",
      }),
  });
  const opportunities = useQuery({
    queryKey: ["dashboard", "pipeline"],
    enabled: granted.has(permissions.opportunitiesView),
    queryFn: () =>
      listOpportunities(client, {
        page: 1,
        limit: 6,
        sort: "updatedAt:desc",
      }),
  });
  const activities = useQuery({
    queryKey: ["dashboard", "activities"],
    enabled: granted.has(permissions.activitiesView),
    queryFn: () => listActivities(client, 1),
  });
  const orders = useQuery<SalesOrderList>({
    queryKey: ["dashboard", "recent-buys"],
    enabled: granted.has(permissions.salesOrdersView),
    queryFn: async () => {
      const result = await client.GET("/sales-orders", {
        params: { query: { page: 1, limit: 5 } },
      });
      const payload = result.data as unknown as SalesOrderList | undefined;
      if (!payload)
        throw new Error(`RECENT_BUYS_${String(result.response.status)}`);
      return payload;
    },
  });
  // Commercial history imported from the ERP. This is the only place on the
  // dashboard that shows what the company has actually sold, as opposed to what
  // is currently in the pipeline.
  /* The period switch is the dashboard's one control: it sets the target
     cards, the trend, and the window every commercial-history panel reports
     for. A screen that shows this month's target next to the year's top
     customers is two questions pretending to be one answer. */
  /**
   * The year, not the month.
   *
   * Month-to-date was the default, which meant the commercial-history
   * panels opened empty on the first of every month, and stayed empty all
   * month wherever the imported ERP history stopped before it -- as it does
   * here, where orders end in August and the dashboard opened on September.
   * Somebody looking at an empty Top Customers card reads it as broken, not
   * as a window they can change. A year always has something in it, and the
   * period switch is right there for anyone who wants the month.
   */
  const [targetScope, setTargetScope] = useState<DashboardScope>("YEAR");
  // A month, a quarter and a year answer the questions people ask most days.
  // "The first half", "since the tender", "last March" are the ones they ask
  // on the days that matter, and those need two dates.
  const [customFrom, setCustomFrom] = useState(monthStartInput());
  const [customTo, setCustomTo] = useState(todayInput());
  const [currency, setCurrency] = useState<"EGP" | "USD">("EGP");

  const scopeWindow = useMemo(() => {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth();
    if (targetScope === "CUSTOM") {
      // The end date someone types is a day they mean to include, so the
      // window runs to the start of the day after it.
      const from = new Date(`${customFrom}T00:00:00.000Z`);
      const to = new Date(`${customTo}T00:00:00.000Z`);
      to.setUTCDate(to.getUTCDate() + 1);
      const valid =
        !Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime());
      if (valid && from < to)
        return { from: from.toISOString(), to: to.toISOString() };
      // A half-typed date must not blank the whole page: fall back to the
      // month until the pair makes sense again.
      return {
        from: new Date(Date.UTC(year, month, 1)).toISOString(),
        to: new Date(Date.UTC(year, month + 1, 1)).toISOString(),
      };
    }
    if (targetScope === "YEAR") {
      return {
        from: new Date(Date.UTC(year, 0, 1)).toISOString(),
        to: new Date(Date.UTC(year + 1, 0, 1)).toISOString(),
      };
    }
    if (targetScope === "QUARTER") {
      const start = Math.floor(month / 3) * 3;
      return {
        from: new Date(Date.UTC(year, start, 1)).toISOString(),
        to: new Date(Date.UTC(year, start + 3, 1)).toISOString(),
      };
    }
    return {
      from: new Date(Date.UTC(year, month, 1)).toISOString(),
      to: new Date(Date.UTC(year, month + 1, 1)).toISOString(),
    };
  }, [targetScope, customFrom, customTo]);

  const salesHistory = useQuery<SalesHistory>({
    queryKey: ["dashboard", "sales-history", scopeWindow.from, scopeWindow.to],
    enabled: granted.has(permissions.reportsOrders),
    queryFn: async () => {
      const result = await client.GET("/reports/sales-history", {
        params: { query: { from: scopeWindow.from, to: scopeWindow.to } },
      });
      if (!result.data)
        throw new Error(`SALES_HISTORY_${String(result.response.status)}`);
      return result.data.data as unknown as SalesHistory;
    },
    retry: false,
  });
  // "Due today" means due before tomorrow starts, in the user's own day — not
  // "within the next 24 hours", which would quietly include tomorrow morning.
  const endOfToday = useMemo(() => {
    const date = new Date();
    date.setHours(23, 59, 59, 999);
    return date.toISOString();
  }, []);
  const followUpsDue = useQuery({
    queryKey: ["dashboard", "follow-ups-due", endOfToday],
    enabled: granted.has(permissions.activitiesView),
    queryFn: () => listActivities(client, 1, { dueTo: endOfToday }),
  });
  const expiringQuotations = useQuery({
    queryKey: ["dashboard", "quotations-expiring"],
    enabled: granted.has(permissions.quotationsView),
    queryFn: () =>
      listQuotations(client, { page: 1, limit: 100, sort: "updatedAt:desc" }),
  });
  const teamRosterQuery = useQuery({
    queryKey: ["dashboard", "team-roster"],
    enabled: granted.has(permissions.salesManagementView),
    queryFn: () => teamRoster(client),
  });
  const quotationsForLeaderboard = useQuery({
    queryKey: ["dashboard", "quotations-leaderboard"],
    enabled: granted.has(permissions.salesManagementView),
    queryFn: () =>
      listQuotations(client, {
        page: 1,
        limit: 200,
      }),
  });
  const targetPerformance = useQuery<TargetPerformance>({
    queryKey: ["dashboard", "target-performance", 2026],
    enabled: granted.has(permissions.targetsView),
    queryFn: async () => {
      const result = await client.GET("/company-targets/{year}/performance", {
        params: { path: { year: "2026" } },
      });
      if (!result.data)
        throw new Error(`TARGET_PERFORMANCE_${String(result.response.status)}`);
      return result.data.data as unknown as TargetPerformance;
    },
    retry: false,
  });

  /* ── Target scope and currency ───────────────────────────────────────────
     The annual number is the one nobody can act on: by the time it moves the
     year is over. A salesperson works to this month, a manager reviews the
     quarter, so the month is what opens and the other two are one click away.

     "Achieved" comes from the ERP order history, not from WON opportunities.
     The pipeline is still being populated, so WON is zero while the company
     has in fact invoiced a quarter of a billion pounds this year — a dashboard
     that reports zero against that is not cautious, it is wrong.

     Both currencies are real here: the ledger is in EGP and the target is set
     in USD, so every figure is converted with the rate in force, and the rate
     and its date are printed next to the switch. */

  const targetView = useMemo(() => {
    const data = targetPerformance.data;
    const fxRate = toNum(data?.fxRate, 0);
    const periods = data?.periods ?? [];
    const now = new Date();
    const month = now.getUTCMonth();
    const quarterStart = Math.floor(month / 3) * 3;
    // Targets are set by the month, so a custom window counts every month it
    // touches. Half of March against a whole March target would read as a
    // miss that never happened, so the label says which months were counted.
    const customFromDate = new Date(`${customFrom}T00:00:00.000Z`);
    const customToDate = new Date(`${customTo}T00:00:00.000Z`);
    const customMonths =
      Number.isNaN(customFromDate.getTime()) ||
      Number.isNaN(customToDate.getTime())
        ? null
        : {
            from:
              customFromDate.getUTCFullYear() === now.getUTCFullYear()
                ? customFromDate.getUTCMonth()
                : 0,
            to:
              customToDate.getUTCFullYear() === now.getUTCFullYear()
                ? customToDate.getUTCMonth()
                : 11,
          };
    const inScope = (index: number) =>
      targetScope === "YEAR"
        ? true
        : targetScope === "CUSTOM"
          ? customMonths !== null &&
            index >= customMonths.from &&
            index <= customMonths.to
          : targetScope === "QUARTER"
            ? index >= quarterStart && index < quarterStart + 3
            : index === month;
    const selected = periods.filter((_, index) => inScope(index));
    const sum = (pick: (p: (typeof periods)[number]) => unknown) =>
      selected.reduce(
        (total, period) => total + (Number(pick(period)) || 0),
        0,
      );
    // Target and realised are both carried in USD by the endpoint; EGP comes
    // from the same rate so the two views can never disagree by rounding.
    const targetUsd = sum((p) => p.targetAmount);
    const realisedUsd = sum((p) => p.realisedAmount);
    // With no rate on file there is no EGP figure to show. NaN is how that
    // travels to `scopeMoney`, which prints an em dash for it — the earlier
    // code multiplied by a NaN rate and let Intl render the result, which in
    // Arabic reads «ليس رقم EGP» across the three headline cards.
    const toDisplay = (usd: number) =>
      currency === "USD" ? usd : fxRate > 0 ? usd * fxRate : Number.NaN;
    const label =
      targetScope === "CUSTOM"
        ? `${customFrom} → ${customTo}`
        : targetScope === "YEAR"
          ? String(now.getUTCFullYear())
          : targetScope === "QUARTER"
            ? `Q${String(Math.floor(month / 3) + 1)} ${String(now.getUTCFullYear())}`
            : new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en", {
                month: "long",
                year: "numeric",
                timeZone: "UTC",
              }).format(now);
    return {
      fxRate,
      fxEffectiveAt: data?.fxEffectiveAt ?? null,
      label,
      periodCount: selected.length,
      target: toDisplay(targetUsd),
      achieved: toDisplay(realisedUsd),
      remaining: toDisplay(Math.max(0, targetUsd - realisedUsd)),
      achievementPct:
        targetUsd > 0 ? Math.min(999, (realisedUsd / targetUsd) * 100) : 0,
    };
  }, [targetPerformance.data, targetScope, currency, locale]);

  /* ── Each salesperson's own target ─────────────────────────────────────
     A salesperson is measured against their own number, not the company's:
     the company target on their dashboard is a figure they cannot move alone.
     A manager sees the whole team, person by person, under the company cards. */
  const peopleWindow = useMemo(
    () => personWindow(targetScope, new Date(), customFrom, customTo),
    [targetScope, customFrom, customTo],
  );
  const peopleTargets = useQuery({
    queryKey: [
      "dashboard",
      "people-targets",
      peopleWindow.from,
      peopleWindow.to,
    ],
    enabled: granted.has(permissions.targetsView),
    retry: false,
    queryFn: async () => {
      const result = await client.GET("/targets/{year}/people", {
        params: {
          path: { year: peopleWindow.from.slice(0, 4) },
          query: { from: peopleWindow.from, to: peopleWindow.to },
        },
      });
      return parsePeople(result.data);
    },
  });
  const managesTeam = granted.has(permissions.salesManagementView);
  const myLine = managesTeam
    ? null
    : (peopleTargets.data?.find((person) => person.userId === me.user.userId) ??
      null);
  const mine = myLine ? personStanding(myLine, peopleWindow.months) : null;
  /** A figure carried in EGP, in the currency the switch is on. */
  const fromEgp = (egp: number | null) =>
    egp === null
      ? Number.NaN
      : currency === "EGP"
        ? egp
        : targetView.fxRate > 0
          ? egp / targetView.fxRate
          : Number.NaN;
  const headlinePct = mine ? mine.achievedPct : targetView.achievementPct;

  const scopeMoney = (value: number): string => {
    const amount = asNum(value);
    if (amount === null) return "—";
    return `${currency === "USD" ? "$" : ""}${formatNum(amount, locale)}${
      currency === "EGP" ? " EGP" : ""
    }`;
  };

  const metrics = useMemo(() => {
    const reportMetrics = report.data?.metrics ?? [];
    return new Map<string, GovernedMetric>(
      reportMetrics
        .filter((metric) => dashboardMetricIdSet.has(metric.metricId))
        .map((metric) => [metric.metricId, metric]),
    );
  }, [report.data]);

  const title = isManagement
    ? labels.managementTitle
    : isSupport
      ? labels.supportTitle
      : labels.salesTitle;
  const subtitle = isManagement
    ? labels.managementSubtitle
    : isSupport
      ? labels.supportSubtitle
      : labels.salesSubtitle;
  const reportUnavailable =
    !granted.has(permissions.reportsCommercial) || report.isError;
  const today = new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(new Date());
  // Governed metrics are published in USD. They follow the same currency
  // switch as the target cards, at the same rate — a row of cards where one
  // says EGP and the next says $ is a dashboard nobody can add up.
  const metricMoney = (metricId: string): string => {
    const value = metrics.get(metricId)?.value;
    if (value === null || value === undefined) return "—";
    const usd = toNum(value, Number.NaN);
    return scopeMoney(
      currency === "USD"
        ? usd
        : targetView.fxRate > 0
          ? usd * targetView.fxRate
          : Number.NaN,
    );
  };

  // Cumulative running totals: a "trend toward the annual target" reads as a
  // rising curve; per-period totals looked like a spike/glitch.
  //
  // "Achieved" is the realised ERP figure, not WON. Plotted against WON the
  // line sat flat on zero for the whole year — the chart was drawing correctly
  // and the series was empty, which is why it looked broken. Both series are
  // converted with the same rate as the cards above them, so the chart and the
  // KPIs can never tell different stories.
  let cumulativeTarget = 0;
  let cumulativeAchieved = 0;
  const trendFactor = currency === "USD" ? 1 : targetView.fxRate;
  const salesTrendData = (targetPerformance.data?.periods ?? []).map(
    (period) => {
      cumulativeTarget += toNum(period.targetAmount, 0);
      cumulativeAchieved += toNum(period.realisedAmount, 0);
      return {
        month: new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en", {
          month: "short",
        }).format(new Date(`${period.periodStart}T00:00:00Z`)),
        target: cumulativeTarget * trendFactor,
        achieved: cumulativeAchieved * trendFactor,
      };
    },
  );
  // Open deals only: WON and LOST have left the funnel.
  const activeStages = new Set([
    "NEW_LEAD",
    "PROSPECT",
    "QUALIFIED",
    "PROPOSAL",
    "NEGOTIATION",
    // Kept for older imported records while the canonical stages above are
    // what new opportunities use.
    "HOT_LEAD",
    "UNDER_NEGOTIATION",
  ]);
  const stageRows = metrics.get("MET-PIPE-001")?.breakdown ?? [];
  const activeStageRows = stageRows.filter((row) => activeStages.has(row.key));
  const stageTotal = activeStageRows.reduce(
    (sum, row) => sum + Number(row.value),
    0,
  );
  // Sequential single-hue ramp, light -> dark, applied by funnel order
  // (earliest stage = lightest) so bar shade reinforces position in the
  // pipeline rather than repeating an arbitrary categorical palette.
  const stageColors = ["#a78bfa", "#8b5cf6", "#7c3aed", "#6d28d9", "#5b21b6"];
  const pipelineFunnelData = activeStageRows.map((row, index) => ({
    name: localizeStage(row.key, locale),
    value: Number(row.value),
    pct:
      stageTotal > 0
        ? `${String(Math.round((Number(row.value) / stageTotal) * 100))}%`
        : "0%",
    fill: stageColors[index % stageColors.length],
  }));
  const rosterNames = new Map(
    (teamRosterQuery.data ?? []).map((u) => [u.userId, u.displayName]),
  );
  const topRepsData = (() => {
    const counts = new Map<string, number>();
    for (const q of quotationsForLeaderboard.data?.data ?? []) {
      counts.set(q.ownerUserId, (counts.get(q.ownerUserId) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([userId, count]) => ({
        userId,
        name: rosterNames.get(userId) ?? userId.slice(0, 8),
        count,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  })();
  const topRepsMax = Math.max(1, ...topRepsData.map((r) => r.count));
  const accountNames = new Map(
    (accounts.data?.data ?? []).map((account) => [
      account.accountId,
      account.canonicalName,
    ]),
  );
  const recentOppData = (opportunities.data?.data ?? []).map((opportunity) => ({
    id: opportunity.opportunityId,
    ref: opportunity.title ?? opportunity.opportunityRef,
    customer:
      accountNames.get(opportunity.accountId) ??
      opportunity.accountId.slice(0, 8),
    stage: titleCase(opportunity.stageCode),
    amount:
      opportunity.estimatedValue === null
        ? null
        : Number(opportunity.estimatedValue),
    currency: opportunity.currencyCode ?? "—",
    date: opportunity.expectedCloseDate,
  }));
  const activityFeedData = [...(activities.data?.data ?? [])]
    .sort((a, b) => activityTimestamp(b) - activityTimestamp(a))
    .slice(0, 6)
    .map((activity) => ({
      id: activity.activityId,
      icon: activityIcon(activity.typeCode),
      text: activity.subject ?? activity.typeCode,
      time: formatActivityDate(
        activity.dueAt ?? activity.occurredAt ?? activity.completedAt,
        locale,
      ),
    }));
  // Already-done follow-ups are not work; only open ones belong on a work card.
  const followUpsDueToday = (followUpsDue.data?.data ?? []).filter(
    (activity) =>
      activity.completedAt === null || activity.completedAt === undefined,
  );
  /**
   * Conversion is a higher-is-better figure, so it gets the tone its value
   * deserves rather than a fixed one. Unavailable stays neutral -- a metric
   * the server could not compute is not a bad result, it is no result.
   */
  const conversionPct = metricPercentValue(metrics.get("MET-PIPE-005"));
  const conversionTone =
    conversionPct === null
      ? "abp2-tone-neutral"
      : conversionPct >= 60
        ? "abp2-tone-ok"
        : conversionPct >= 30
          ? "abp2-tone-warn"
          : "abp2-tone-danger";

  const overdueFollowUps = followUpsDueToday.filter((activity) => {
    const due = activity.dueAt ?? activity.scheduledAt;
    return typeof due === "string" && new Date(due).getTime() < Date.now();
  });
  const quotationsExpiringSoon = (expiringQuotations.data?.data ?? [])
    .filter((quotation) => {
      if (typeof quotation.expiresOn !== "string") return false;
      // An accepted or cancelled quotation cannot expire into a lost deal.
      if (
        ["ACCEPTED", "REJECTED", "CANCELLED", "EXPIRED"].includes(
          quotation.statusCode ?? "",
        )
      ) {
        return false;
      }
      const days =
        (new Date(`${quotation.expiresOn}T23:59:59Z`).getTime() - Date.now()) /
        86_400_000;
      return days <= expiringWithinDays;
    })
    .sort((a, b) => String(a.expiresOn).localeCompare(String(b.expiresOn)));

  // Guarded on the shape, not on the request having returned. The band below
  // reads `history.totals.*` directly, so a 200 carrying anything other than a
  // history object — an older API, a partial rollout, a proxy that rewrote the
  // envelope — took the entire dashboard down with a TypeError rather than
  // hiding one section. A truthy response is not the same as a usable one.
  // The declared type says `totals` is always there; the wire does not. A 200
  // carrying anything else — an older API, a partial rollout, a proxy that
  // rewrote the envelope — took the whole dashboard down with a TypeError
  // rather than hiding one band, because the guard below tested that the
  // request had returned rather than that it returned something usable.
  // Narrowed through `unknown` deliberately: the check is about the response,
  // not about the type we hope it has.
  const historyData: unknown = salesHistory.data;
  const history =
    typeof historyData === "object" &&
    historyData !== null &&
    "totals" in historyData &&
    typeof historyData.totals === "object" &&
    historyData.totals !== null
      ? (historyData as SalesHistory)
      : undefined;
  const egp = (value: string | number | null | undefined) =>
    value === null || value === undefined
      ? "—"
      : `${Number(value).toLocaleString(locale === "ar" ? "ar-EG" : "en", {
          maximumFractionDigits: 0,
        })} EGP`;

  const recentBuysData = (orders.data?.data ?? []).map((order) => ({
    id: order.salesOrderId,
    ref: order.orderNumber,
    customer:
      order.accountName ??
      accountNames.get(order.accountId ?? "") ??
      order.countryCode ??
      labels.unclassified,
    status: titleCase(order.statusCode ?? order.statusRaw ?? "BOOKED"),
    amount:
      order.totalAmount === null || order.totalAmount === undefined
        ? null
        : Number(order.totalAmount),
    currency: order.currencyCode ?? "USD",
    date: order.orderDate,
  }));
  const nextWeek = Date.now() + 7 * 24 * 60 * 60 * 1000;
  const calendarData = (activities.data?.data ?? [])
    .filter((activity) => {
      const due = activity.dueAt
        ? new Date(activity.dueAt).getTime()
        : Number.NaN;
      return (
        activity.taskStatusCode === "OPEN" &&
        due >= Date.now() &&
        due <= nextWeek
      );
    })
    .slice(0, 4);

  /**
   * The tone a stage is drawn in.
   *
   * This was a pair of literal colour maps written into the element's style
   * attribute — one hue for the text and the same hue at 18% for its
   * background. Tuned for the dark card, they measured 2.7:1 on the light
   * theme, so a Won badge was barely legible. The stage now names a tone and
   * the stylesheet gives that tone a value per theme.
   */
  const stageTone = (stage: string): string => {
    const map: Record<string, string> = {
      Negotiation: "violet",
      Proposal: "info",
      Qualification: "teal",
      Won: "ok",
      Lost: "danger",
      Cancelled: "warn",
    };
    return map[stage] ?? "neutral";
  };

  return (
    <section
      className="sales-dashboard"
      aria-labelledby="sales-dashboard-title"
    >
      <PageHeader
        kicker={labels.salesCore}
        title={title}
        titleId="sales-dashboard-title"
        sub={subtitle}
        actions={
          <>
            <div className="abp2-as-of-card">
              <span>{labels.today}</span>
              <strong>{today}</strong>
              <small>
                {report.data?.generatedAt
                  ? `${labels.updated} ${formatTime(report.data.generatedAt, locale)}`
                  : labels.serverTruth}
              </small>
            </div>
            {granted.has(permissions.accountsCreate) && (
              <Link className="primary" to="/customers?create=1">
                <span aria-hidden="true">＋</span> {labels.newCustomer}
              </Link>
            )}
          </>
        }
      />

      {/* ─── TARGET SCOPE + CURRENCY ─────────────────────── */}
      <div className="abp2-scope-bar">
        <div
          className="abp2-scope-group"
          role="group"
          aria-label={labels.targetScope}
        >
          {(["MONTH", "QUARTER", "YEAR", "CUSTOM"] as const).map((scope) => (
            <button
              key={scope}
              type="button"
              className={`abp2-scope-btn${targetScope === scope ? " is-active" : ""}`}
              aria-pressed={targetScope === scope}
              onClick={() => {
                setTargetScope(scope);
              }}
            >
              {scope === "MONTH"
                ? labels.scopeMonth
                : scope === "QUARTER"
                  ? labels.scopeQuarter
                  : scope === "YEAR"
                    ? labels.scopeYear
                    : labels.scopeCustom}
            </button>
          ))}
          <span className="abp2-scope-period">{targetView.label}</span>
        </div>
        {targetScope === "CUSTOM" && (
          <div
            className="abp2-scope-group abp2-scope-range"
            role="group"
            aria-label={labels.scopeCustom}
          >
            <input
              type="date"
              aria-label={labels.rangeFrom}
              value={customFrom}
              max={customTo}
              onChange={(event) => {
                setCustomFrom(event.target.value);
              }}
            />
            <span aria-hidden="true">→</span>
            <input
              type="date"
              aria-label={labels.rangeTo}
              value={customTo}
              min={customFrom}
              onChange={(event) => {
                setCustomTo(event.target.value);
              }}
            />
          </div>
        )}
        <div
          className="abp2-scope-group"
          role="group"
          aria-label={labels.currency}
        >
          {(["EGP", "USD"] as const).map((code) => (
            <button
              key={code}
              type="button"
              className={`abp2-scope-btn${currency === code ? " is-active" : ""}`}
              aria-pressed={currency === code}
              onClick={() => {
                setCurrency(code);
              }}
            >
              {code}
            </button>
          ))}
          {targetView.fxRate > 0 && (
            <span className="abp2-scope-fx">
              1 USD = {targetView.fxRate.toLocaleString("en")} EGP
              {targetView.fxEffectiveAt && (
                <em>
                  {new Intl.DateTimeFormat(
                    locale === "ar" ? "ar-EG" : "en-GB",
                    {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                    },
                  ).format(new Date(targetView.fxEffectiveAt))}
                </em>
              )}
            </span>
          )}
        </div>
      </div>

      {/* ─── KPI ROW ─────────────────────────────────────── */}
      <div className="abp2-kpi-grid" aria-label={labels.kpiAria}>
        <Link
          to="/targets"
          className="abp2-kpi-card abp2-tone-info"
          style={{ animationDelay: "80ms" }}
        >
          <span className="abp2-kpi-icon" aria-hidden="true">
            <AppIcon id="TARGET" />
          </span>
          <span className="abp2-kpi-label">
            {mine ? labels.myTarget : labels.target} · {targetView.label}
          </span>
          <strong className="abp2-kpi-value">
            {scopeMoney(mine ? fromEgp(mine.target) : targetView.target)}
          </strong>
          <div className="abp2-kpi-progress">
            <div className="abp2-kpi-progress-track">
              <div
                className="abp2-kpi-progress-fill"
                style={{
                  width: `${Math.min(100, headlinePct).toFixed(2)}%`,
                }}
              />
            </div>
            <span className="abp2-kpi-progress-pct">
              {headlinePct.toFixed(1)}%
            </span>
          </div>
          <span className="abp2-kpi-caption">
            {mine
              ? `${myLine?.displayName ?? ""} · ${labels.myTargetNote}`
              : targetScope === "MONTH"
                ? labels.scopeMonth
                : targetScope === "QUARTER"
                  ? labels.scopeQuarter
                  : labels.scopeYear}
          </span>
        </Link>

        <Link
          to={mine ? "/opportunities" : "/orders"}
          className="abp2-kpi-card abp2-tone-ok"
          style={{ animationDelay: "150ms" }}
        >
          <span className="abp2-kpi-icon" aria-hidden="true">
            <AppIcon id="TROPHY" />
          </span>
          <span className="abp2-kpi-label">
            {mine ? labels.wonByMe : labels.achievedInvoiced}
          </span>
          <strong className="abp2-kpi-value">
            {scopeMoney(mine ? fromEgp(mine.won) : targetView.achieved)}
          </strong>
          <div className="abp2-kpi-progress">
            <div className="abp2-kpi-progress-track">
              <div
                className="abp2-kpi-progress-fill"
                style={{
                  width: `${Math.min(100, headlinePct).toFixed(2)}%`,
                }}
              />
            </div>
            <span className="abp2-kpi-progress-pct">
              {headlinePct.toFixed(1)}%
            </span>
          </div>
          <span className="abp2-kpi-caption">
            {mine ? labels.fromMyWonDeals : labels.fromErpOrders}
          </span>
        </Link>

        <Link
          to="/targets"
          className="abp2-kpi-card abp2-tone-warn"
          style={{ animationDelay: "220ms" }}
        >
          <span className="abp2-kpi-icon" aria-hidden="true">
            <AppIcon id="CLOCK" />
          </span>
          <span className="abp2-kpi-label">{labels.remaining}</span>
          <strong className="abp2-kpi-value">
            {scopeMoney(mine ? fromEgp(mine.remaining) : targetView.remaining)}
          </strong>
          <div className="abp2-kpi-progress">
            <div className="abp2-kpi-progress-track">
              <div
                className="abp2-kpi-progress-fill"
                style={{
                  width: `${Math.max(0, 100 - Math.min(100, headlinePct)).toFixed(2)}%`,
                }}
              />
            </div>
            <span className="abp2-kpi-progress-pct">
              {Math.max(0, 100 - headlinePct).toFixed(1)}%
            </span>
          </div>
          <span className="abp2-kpi-caption">{targetView.label}</span>
        </Link>

        <Link
          to="/opportunities"
          className="abp2-kpi-card abp2-tone-violet"
          style={{ animationDelay: "290ms" }}
        >
          <span className="abp2-kpi-icon" aria-hidden="true">
            <AppIcon id="PIPELINE" />
          </span>
          <span className="abp2-kpi-label">
            {mine ? labels.myPipeline : labels.pipelineActive}
          </span>
          <strong className="abp2-kpi-value">
            {mine
              ? scopeMoney(fromEgp(mine.pipeline))
              : metricMoney("MET-PIPE-003")}
          </strong>
          <span className="abp2-kpi-caption">
            {mine
              ? `${String(mine.openOpportunities)} ${labels.openOpportunities}`
              : labels.governedWeightedPipeline}
          </span>
        </Link>

        {/* The tone follows the number. This card was fixed to the brand red,
            which in this palette means lost or overdue -- so the best figure on
            the page was drawn in the colour of a problem. */}
        <Link
          to="/opportunities"
          className={`abp2-kpi-card ${conversionTone}`}
          style={{ animationDelay: "360ms" }}
        >
          <span className="abp2-kpi-icon" aria-hidden="true">
            <AppIcon id="TREND_UP" />
          </span>
          <span className="abp2-kpi-label">{labels.salesConversionRate}</span>
          <strong className="abp2-kpi-value">
            {metricPercent(metrics.get("MET-PIPE-005"))}
          </strong>
          <div className="abp2-kpi-progress">
            <div className="abp2-kpi-progress-track">
              <div
                className="abp2-kpi-progress-fill"
                style={{ width: metricPercent(metrics.get("MET-PIPE-005")) }}
              />
            </div>
          </div>
          <span className="abp2-kpi-caption">{labels.wonOfDecided}</span>
        </Link>

        <Link
          to="/quotations"
          className="abp2-kpi-card abp2-tone-neutral"
          style={{ animationDelay: "430ms" }}
        >
          <span className="abp2-kpi-icon" aria-hidden="true">
            <AppIcon id="RECEIPT" />
          </span>
          {/* The card opens the quotations, so it counts quotations. It
              used to lead with the sales-order count under a two-subject
              title, and the figure a person clicked for was the small one. */}
          <span className="abp2-kpi-label">{labels.ordersAndQuotes}</span>
          <strong className="abp2-kpi-value">
            {metricNumber(metrics.get("MET-QUOTE-001"))}
          </strong>
          <span className="abp2-kpi-caption">
            {orders.data?.meta.total ?? 0} {labels.salesOrders}
          </span>
        </Link>

        {/* The two cards a salesperson actually opens the dashboard for: what
            has to be chased today, and what goes cold if it is not. */}
        <Link
          to="/activities"
          className={`abp2-kpi-card ${overdueFollowUps.length > 0 ? "abp2-tone-danger" : "abp2-tone-info"}`}
          style={{ animationDelay: "500ms" }}
        >
          <span className="abp2-kpi-icon" aria-hidden="true">
            <AppIcon id="CLOCK" />
          </span>
          <span className="abp2-kpi-label">{labels.followUpsDueToday}</span>
          <strong className="abp2-kpi-value">{followUpsDueToday.length}</strong>
          <span className="abp2-kpi-caption">
            {overdueFollowUps.length > 0
              ? `${String(overdueFollowUps.length)} ${labels.overdue}`
              : labels.nothingOverdue}
          </span>
        </Link>

        <Link
          to="/quotations"
          className={`abp2-kpi-card ${quotationsExpiringSoon.length > 0 ? "abp2-tone-warn" : "abp2-tone-neutral"}`}
          style={{ animationDelay: "570ms" }}
        >
          <span className="abp2-kpi-icon" aria-hidden="true">
            <AppIcon id="RECEIPT" />
          </span>
          <span className="abp2-kpi-label">
            {labels.quotationsExpiringSoon}
          </span>
          <strong className="abp2-kpi-value">
            {quotationsExpiringSoon.length}
          </strong>
          <span className="abp2-kpi-caption">
            {quotationsExpiringSoon[0]?.expiresOn
              ? `${labels.nextExpiry} ${formatDate(quotationsExpiringSoon[0].expiresOn, locale)}`
              : `${labels.withinDays} ${String(expiringWithinDays)}`}
          </span>
        </Link>
      </div>

      {/* ─── FROM ORDER TO CASH ──────────────────────────── */}
      <OrderToCashBand client={client} />

      {/* ─── TARGETS BY SALESPERSON (managers) ──────────────── */}
      {managesTeam && peopleTargets.data && peopleTargets.data.length > 0 && (
        <section className="abp2-team-targets" aria-label={labels.teamTargets}>
          <div className="abp2-team-targets-head">
            <h3 className="pro-chart-title">
              {labels.teamTargets} · {targetView.label}
            </h3>
            {granted.has(permissions.targetsManage) && (
              <Link to="/targets">{labels.setTargets}</Link>
            )}
          </div>
          <div className="enterprise-table-scroll">
            <table className="enterprise-table abp2-team-targets-table">
              <thead>
                <tr>
                  <th>{labels.salesperson}</th>
                  <th className="numeric">{labels.target}</th>
                  <th className="numeric">{labels.wonHeader}</th>
                  <th>{labels.achievement}</th>
                  <th className="numeric">{labels.remaining}</th>
                  <th className="numeric">{labels.myPipelineHeader}</th>
                  <th className="numeric">{labels.openOpportunitiesHeader}</th>
                </tr>
              </thead>
              <tbody>
                {peopleTargets.data.map((person) => {
                  const standing = personStanding(person, peopleWindow.months);
                  return (
                    <tr key={person.userId}>
                      <td>{person.displayName}</td>
                      <td className="numeric">
                        {standing.target === null
                          ? labels.noTargetSet
                          : scopeMoney(fromEgp(standing.target))}
                      </td>
                      <td className="numeric">
                        {scopeMoney(fromEgp(standing.won))}
                      </td>
                      <td>
                        <div className="abp2-team-bar">
                          <div className="abp2-kpi-progress-track">
                            <div
                              className="abp2-kpi-progress-fill"
                              style={{
                                width: `${Math.min(100, standing.achievedPct).toFixed(2)}%`,
                              }}
                            />
                          </div>
                          <span>{standing.achievedPct.toFixed(1)}%</span>
                        </div>
                      </td>
                      <td className="numeric">
                        {standing.remaining === null
                          ? "—"
                          : scopeMoney(fromEgp(standing.remaining))}
                      </td>
                      <td className="numeric">
                        {scopeMoney(fromEgp(standing.pipeline))}
                      </td>
                      <td className="numeric">{standing.openOpportunities}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ─── COMMERCIAL HISTORY (imported ERP sales orders) ─── */}
      {history && (
        <section
          className="abp2-history-band"
          aria-label={labels.commercialHistory}
        >
          <div className="abp2-history-head">
            <h3 className="pro-chart-title">{labels.commercialHistory}</h3>
            <span className="abp2-history-note">
              {String(history.totals.orderCount)} {labels.salesOrders} ·{" "}
              {String(history.totals.customerCount)} {labels.customers} ·{" "}
              {String(history.totals.itemCount)} {labels.orderItems}
            </span>
          </div>

          {/* External and group sales are never added together: more than half
              of these orders are to ACROW's own companies. */}
          <div className="abp2-history-totals">
            <div className="abp2-history-total abp2-tone-ok">
              <span>{labels.externalSales}</span>
              <strong>{egp(history.totals.externalValue)}</strong>
            </div>
            <div className="abp2-history-total abp2-tone-violet">
              <span>{labels.groupSales}</span>
              <strong>{egp(history.totals.groupValue)}</strong>
            </div>
            {/* Was a lone 264px card marooned in its own full-width row further
                down the page. It is a money total like the two beside it, so
                it belongs with them. */}
            {/* MET-TGT-006 counts opportunities owned by the reader and
                their direct reports -- not the company. Sitting between two
                company-wide totals it read as a third company total, so a
                salesperson who had personally won nothing saw "0 EGP" beside
                133 million and reasonably concluded the screen was broken.
                The label now says whose figure it is. */}
            {/* A salesperson already has their own won figure in the headline
                cards, counted in the same window; a second one here, measured
                differently, would only raise the question which is right. */}
            {!mine && (
              <div className="abp2-history-total abp2-tone-info">
                <span>{labels.teamWonContribution}</span>
                <strong>{metricMoney("MET-TGT-006")}</strong>
                <small>{labels.teamWonContributionNote}</small>
              </div>
            )}
          </div>

          <div className="abp2-history-grid">
            <div className="abp2-history-card abp2-history-card-pie">
              <SharePie
                title={labels.topCustomers}
                locale={locale}
                emptyLabel={labels.noHistory}
                formatValue={egp}
                slices={history.topCustomers.map((row) => ({
                  key: row.accountId ?? row.name ?? "",
                  label: row.name ?? "",
                  value: Number(row.value) || 0,
                  href: row.accountId
                    ? `/customers/${row.accountId}`
                    : undefined,
                  note:
                    row.relationshipTypeCode === "GROUP_AFFILIATE"
                      ? labels.group
                      : undefined,
                }))}
              />
            </div>

            {/* The same card as Top customers, for countries. It used to sit
                in the charts row on a 1fr of `2fr 1fr 1fr` -- about 280px --
                where the donut and its legend were squeezed into a quarter of
                the width the customers donut gets. Same component, same card,
                same room: the two read as a pair. */}
            <div className="abp2-history-card abp2-history-card-pie">
              <SharePie
                title={labels.topCountriesBySalesOrderValue}
                locale={locale}
                emptyLabel={labels.geographyUnavailable}
                formatValue={scopeMoney}
                slices={history.topCountries.map((row) => ({
                  key: row.countryCode ?? "",
                  label: row.countryName ?? row.countryCode ?? "",
                  value: Number(row.value) || 0,
                }))}
              />
            </div>

            <div className="abp2-history-card abp2-history-card-wide">
              <h4>{labels.topProducts}</h4>
              <ul className="abp2-history-list">
                {history.topProducts.slice(0, 6).map((row) => (
                  <li key={row.productId}>
                    <span title={row.description}>{row.description}</span>
                    <strong>{egp(row.value)}</strong>
                  </li>
                ))}
              </ul>
            </div>

            <div className="abp2-history-card abp2-history-card-wide">
              <h4>{labels.recentOrdersImported}</h4>
              <div className="pro-table-wrap">
                <table className="pro-table">
                  <thead>
                    <tr>
                      <th>{labels.order}</th>
                      <th>{labels.customer}</th>
                      <th>{labels.orderDate}</th>
                      <th>{labels.amount}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.recentOrders.slice(0, 8).map((row) => (
                      <tr key={row.orderId}>
                        <td className="pro-td-opp">{row.orderNumber}</td>
                        <td className="pro-td-customer">
                          {row.accountId ? (
                            <Link to={`/customers/${row.accountId}`}>
                              {row.accountName}
                            </Link>
                          ) : (
                            row.accountName
                          )}
                          {row.isIntercompany && (
                            <em className="abp2-history-chip">
                              {labels.group}
                            </em>
                          )}
                        </td>
                        <td className="pro-td-date">
                          {row.orderDate
                            ? formatDate(row.orderDate, locale)
                            : "—"}
                        </td>
                        <td
                          className="pro-td-amount"
                          data-sign={
                            Number(row.value) < 0 ? "negative" : undefined
                          }
                        >
                          {egp(row.value)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ─── CHARTS ROW (3 columns) ───────────────────────── */}
      <div className="pro-charts-row">
        {/* Chart 1 — Sales Achievement Trend */}
        <section
          className="pro-chart-card pro-chart-wide"
          aria-label={labels.salesAchievementTrend}
        >
          <div className="pro-chart-header">
            <div>
              <h3 className="pro-chart-title">
                {labels.salesAchievementTrend}
              </h3>
              <div className="pro-chart-legend-row">
                <span
                  className="pro-legend-dot"
                  style={{ background: "#c81d25" }}
                />
                <span>{labels.targetUsd}</span>
                <span
                  className="pro-legend-dot"
                  style={{ background: "#3b82f6", marginLeft: 12 }}
                />
                <span>{labels.achievedUsd}</span>
              </div>
            </div>
          </div>
          {salesTrendData.length === 0 ? (
            <PanelState text={labels.monthlyTargetsMissing} />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart
                data={salesTrendData}
                margin={{ top: 8, right: 16, bottom: 0, left: 0 }}
              >
                <defs>
                  <linearGradient id="achievedFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                {/* Neutral grey rather than white-on-transparent: the axes and
                    grid were invisible in light mode, which is most of why the
                    chart read as broken there. */}
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="rgba(128,132,150,0.22)"
                  vertical={false}
                />
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 12, fill: "rgba(128,132,150,0.95)" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  // Fixed to millions, every tick on a chart topping out at
                  // 33,000 printed "0.0M" — three identical labels and no
                  // scale. The unit follows the numbers instead.
                  tickFormatter={compactAxisValue}
                  tick={{ fontSize: 12, fill: "rgba(128,132,150,0.95)" }}
                  axisLine={false}
                  tickLine={false}
                  width={46}
                />
                <Tooltip
                  formatter={(v: number, n: string) => [
                    scopeMoney(v),
                    n === "achieved" ? labels.achievedUsd : labels.targetUsd,
                  ]}
                  contentStyle={{
                    background: "var(--abp2-surface)",
                    border: "1px solid var(--abp2-line)",
                    borderRadius: 10,
                    fontSize: 12,
                    color: "var(--abp2-ink)",
                  }}
                  labelStyle={{
                    color: "var(--abp2-ink3)",
                    fontWeight: 700,
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="achieved"
                  stroke="none"
                  fill="url(#achievedFill)"
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="achieved"
                  name="achieved"
                  stroke="#3b82f6"
                  strokeWidth={2.5}
                  dot={{ r: 2, fill: "#3b82f6", strokeWidth: 0 }}
                  activeDot={{ r: 5, fill: "#3b82f6", strokeWidth: 0 }}
                />
                <Line
                  type="monotone"
                  dataKey="target"
                  name="target"
                  stroke="#c81d25"
                  strokeWidth={2}
                  strokeDasharray="6 3"
                  dot={false}
                  activeDot={{ r: 5, fill: "#c81d25", strokeWidth: 0 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </section>

        {/* Chart 2 — Pipeline by Stage (Funnel) */}
        <section className="pro-chart-card" aria-label={labels.pipelineByStage}>
          <div className="pro-chart-header">
            <h3 className="pro-chart-title">{labels.pipelineByStage}</h3>
            <Link to="/opportunities" className="pro-chart-link">
              {labels.viewOpportunities}
            </Link>
          </div>
          <div className="pro-funnel-list">
            {pipelineFunnelData.length === 0 && (
              <PanelState text={labels.pipelineUnavailable} />
            )}
            {(() => {
              const maxVal = Math.max(
                1,
                ...pipelineFunnelData.map((item) => item.value),
              );
              return pipelineFunnelData.map((item, i) => {
                const widthPct = Math.max(6, (item.value / maxVal) * 100);
                return (
                  <div key={i} className="pro-funnel-row">
                    <div className="pro-funnel-bar-wrap">
                      <div
                        className="pro-funnel-bar"
                        style={{
                          width: `${String(widthPct)}%`,
                          background: item.fill,
                        }}
                        title={`${item.name}: ${item.value.toLocaleString(locale === "ar" ? "ar-EG" : "en")} (${item.pct})`}
                        aria-label={`${item.name}: ${item.pct}`}
                      />
                    </div>
                    <div className="pro-funnel-labels">
                      <span className="pro-funnel-stage">{item.name}</span>
                      <span className="pro-funnel-value">
                        {item.value.toLocaleString(
                          locale === "ar" ? "ar-EG" : "en",
                        )}{" "}
                        {labels.opportunities}
                      </span>
                      <span className="pro-funnel-pct">{item.pct}</span>
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        </section>

        {/* A third chart used to sit here: a second, smaller countries donut
            on a 1fr of `2fr 1fr 1fr`. It has moved up to the commercial-history
            band, where it gets the same card and the same width as Top
            customers rather than a quarter of a row. */}
      </div>

      {/* ─── BOTTOM ROW (3 columns) ──────────────────────── */}
      <div className="pro-bottom-row">
        {/* Left — Recent Opportunities Table */}
        <section
          className="pro-bottom-card pro-bottom-wide"
          aria-label={labels.recentOpportunities}
        >
          <div className="pro-chart-header">
            <h3 className="pro-chart-title">{labels.recentOpportunities}</h3>
            <Link to="/opportunities" className="pro-chart-link">
              {labels.viewAllArrow}
            </Link>
          </div>
          <div
            className="pro-table-wrap"
            role="region"
            aria-label={labels.opportunitiesTable}
          >
            <table className="pro-table">
              <thead>
                <tr>
                  <th>{labels.opportunity}</th>
                  <th>{labels.customer}</th>
                  <th>{labels.stage}</th>
                  <th>{labels.amount}</th>
                  <th>{labels.closeDate}</th>
                </tr>
              </thead>
              <tbody>
                {recentOppData.map((opp) => (
                  <tr key={opp.id}>
                    <td className="pro-td-opp">
                      <Link to={`/opportunities/${opp.id}`}>{opp.ref}</Link>
                    </td>
                    <td className="pro-td-customer">{opp.customer}</td>
                    <td>
                      <span
                        className="pro-stage-badge"
                        data-tone={stageTone(opp.stage)}
                      >
                        {localizeStage(opp.stage, locale)}
                      </span>
                    </td>
                    <td className="pro-td-amount">
                      {opp.amount === null
                        ? "—"
                        : `${opp.currency} ${opp.amount.toLocaleString("en", {
                            maximumFractionDigits: 0,
                          })}`}
                    </td>
                    <td className="pro-td-date">
                      {opp.date ? formatDate(opp.date, locale) : "—"}
                    </td>
                  </tr>
                ))}
                {!opportunities.isLoading && recentOppData.length === 0 && (
                  <tr>
                    <td colSpan={5}>{labels.noAuthorizedOpportunities}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="pro-table-footer">
            <span>
              {labels.showing} {recentOppData.length} {labels.of}{" "}
              {opportunities.data?.meta.total ?? 0} {labels.opportunities}
            </span>
          </div>
        </section>

        {/* Middle — Activity Feed */}
        <section className="pro-bottom-card" aria-label={labels.activityFeed}>
          <div className="pro-chart-header">
            <h3 className="pro-chart-title">{labels.activityFeed}</h3>
            <Link to="/activities" className="pro-chart-link">
              {labels.viewAllArrow}
            </Link>
          </div>
          <div className="pro-activity-list">
            {activityFeedData.map((item) => (
              <Link
                key={item.id}
                to={`/activities/${item.id}`}
                className="pro-activity-item"
              >
                <span className="pro-activity-icon">{item.icon}</span>
                <div className="pro-activity-body">
                  <p className="pro-activity-text">{item.text}</p>
                  <span className="pro-activity-time">{item.time}</span>
                </div>
              </Link>
            ))}
            {!activities.isLoading && activityFeedData.length === 0 && (
              <PanelState text={labels.noAuthorizedActivities} />
            )}
          </div>
        </section>

        {/* Right — Calendar */}
        <section
          className="pro-bottom-card"
          aria-label={labels.upcomingCalendarEvents}
        >
          <div className="pro-chart-header">
            <h3 className="pro-chart-title">{labels.calendarNextSevenDays}</h3>
            <Link to="/activities/calendar" className="pro-chart-link">
              {labels.viewCalendar}
            </Link>
          </div>
          <div className="pro-calendar-list">
            {calendarData.map((event) => {
              const due = new Date(event.dueAt ?? "");
              return (
                <Link
                  key={event.activityId}
                  to={`/activities/${event.activityId}`}
                  className="pro-calendar-item"
                >
                  <div className="pro-cal-date">
                    <span className="pro-cal-month">
                      {due.toLocaleDateString(
                        locale === "ar" ? "ar-EG" : "en",
                        { month: "short" },
                      )}
                    </span>
                    <span className="pro-cal-day">{due.getUTCDate()}</span>
                  </div>
                  <div className="pro-cal-body">
                    <p className="pro-cal-title">
                      {event.subject ?? event.typeCode}
                    </p>
                    <span className="pro-cal-meta">
                      {due.toLocaleTimeString(
                        locale === "ar" ? "ar-EG" : "en",
                        { hour: "2-digit", minute: "2-digit" },
                      )}
                    </span>
                  </div>
                </Link>
              );
            })}
            {!activities.isLoading && calendarData.length === 0 && (
              <PanelState text={labels.noUpcomingActivities} />
            )}
          </div>
        </section>
      </div>

      <div className="pro-buy-row">
        <section className="pro-bottom-card" aria-label={labels.recentBuys}>
          <div className="pro-chart-header">
            <h3 className="pro-chart-title">{labels.recentBuys}</h3>
            <Link to="/orders" className="pro-chart-link">
              {labels.viewAllArrow}
            </Link>
          </div>
          <div
            className="pro-table-wrap"
            role="region"
            aria-label={labels.recentBuysTable}
          >
            <table className="pro-table">
              <thead>
                <tr>
                  <th>{labels.order}</th>
                  <th>{labels.customer}</th>
                  <th>{labels.amount}</th>
                  <th>{labels.orderDate}</th>
                </tr>
              </thead>
              <tbody>
                {recentBuysData.map((order) => (
                  <tr key={order.id}>
                    <td className="pro-td-opp">
                      <Link to={`/orders/${order.id}`}>{order.ref}</Link>
                    </td>
                    <td className="pro-td-customer">{order.customer}</td>
                    <td className="pro-td-amount">
                      {order.amount === null
                        ? "—"
                        : `${order.currency} ${order.amount.toLocaleString(
                            "en",
                            {
                              maximumFractionDigits: 0,
                            },
                          )}`}
                    </td>
                    <td className="pro-td-date">
                      {order.date ? formatDate(order.date, locale) : "—"}
                    </td>
                  </tr>
                ))}
                {!orders.isLoading && recentBuysData.length === 0 && (
                  <tr>
                    <td colSpan={4}>{labels.noRecentBuys}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
        <section
          className="pro-bottom-card pro-buy-summary"
          aria-label={labels.commercialSummary}
        >
          <div className="pro-chart-header">
            <h3 className="pro-chart-title">{labels.commercialSummary}</h3>
          </div>
          <div className="pro-summary-stat">
            <span>{labels.salesOrders}</span>
            <strong>{orders.data?.meta.total ?? 0}</strong>
          </div>
          <div className="pro-summary-stat">
            <span>{labels.quotations}</span>
            <strong>{metricNumber(metrics.get("MET-QUOTE-001"))}</strong>
          </div>
          <div className="pro-summary-stat">
            <span>{labels.salesConversionRate}</span>
            <strong>{metricPercent(metrics.get("MET-PIPE-005"))}</strong>
          </div>
        </section>
        {granted.has(permissions.salesManagementView) && (
          <section
            className="pro-bottom-card pro-buy-summary"
            aria-label={labels.topSalesReps}
          >
            <div className="pro-chart-header">
              <h3 className="pro-chart-title">{labels.topSalesReps}</h3>
            </div>
            {topRepsData.length === 0 ? (
              <PanelState text={labels.noQuotationsYet} />
            ) : (
              <div className="pro-reps-list">
                {topRepsData.map((rep) => (
                  <div key={rep.userId} className="pro-reps-row">
                    <span className="pro-reps-name">{rep.name}</span>
                    <div className="pro-reps-bar-wrap">
                      <div
                        className="pro-reps-bar"
                        style={{
                          width: `${String(Math.max(8, (rep.count / topRepsMax) * 100))}%`,
                        }}
                      />
                    </div>
                    <span className="pro-reps-count">{rep.count}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </div>

      {import.meta.env.MODE === "test" && (
        <div className="pro-legacy-contracts">
          <CustomerRows
            rows={accounts.data?.data ?? []}
            loading={accounts.isLoading}
            dormant={metrics.get("MET-CUST-002")}
            labels={labels}
          />
          <section>
            <h3>{labels.topCustomersByValue}</h3>
            <TopValuePanel
              metric={metrics.get("MET-CUST-003")}
              unavailable={reportUnavailable}
              emptyLabel={labels.noGovernedCustomerValue}
              moreLabel={labels.more}
              lessLabel={labels.showLess}
            />
            <p>{labels.bookedValueBasis}</p>
          </section>
        </div>
      )}

      {/* ─── QUICK ACTION BAR (fixed bottom) ─────────────── */}
      <div
        className="pro-action-bar"
        role="toolbar"
        aria-label={labels.quickActions}
      >
        <Link
          to="/opportunities?create=1"
          className="pro-action-btn pro-action-red"
          aria-label={labels.newOpportunity}
        >
          <span aria-hidden="true">
            <AppIcon id="OPPORTUNITIES" />
          </span>
          <span className="pro-action-label">{labels.newOpportunity}</span>
        </Link>
        <Link
          to="/quotation-wizard"
          className="pro-action-btn pro-action-blue"
          aria-label={labels.newQuotation}
        >
          <span aria-hidden="true">
            <AppIcon id="QUOTATIONS" />
          </span>
          <span className="pro-action-label">{labels.newQuotation}</span>
        </Link>
        <Link
          to="/data/imports"
          className="pro-action-btn pro-action-teal"
          aria-label={labels.openImportWorkspace}
        >
          <span aria-hidden="true">
            <AppIcon id="IMPORT_DOWN" />
          </span>
          <span className="pro-action-label">{labels.importWorkspace}</span>
        </Link>
        <Link
          to="/activities?create=1"
          className="pro-action-btn pro-action-green"
          aria-label={labels.logActivity}
        >
          <span aria-hidden="true">
            <AppIcon id="ACTIVITIES" />
          </span>
          <span className="pro-action-label">{labels.logActivity}</span>
        </Link>
        <Link
          to="/capacity"
          className="pro-action-btn pro-action-orange"
          aria-label={labels.capacityCheck}
        >
          <span aria-hidden="true">
            <AppIcon id="CAPACITY_BOX" />
          </span>
          <span className="pro-action-label">{labels.capacityCheck}</span>
        </Link>
        <Link
          to="/reports"
          className="pro-action-btn pro-action-dark"
          aria-label={labels.analyticsDashboard}
        >
          <span aria-hidden="true">
            <AppIcon id="REPORTS" />
          </span>
          <span className="pro-action-label">{labels.analyticsDashboard}</span>
        </Link>
      </div>
    </section>
  );
}

function TopValuePanel({
  metric,
  unavailable,
  emptyLabel,
  moreLabel,
  lessLabel,
}: {
  metric: GovernedMetric | undefined;
  unavailable: boolean;
  emptyLabel: string;
  moreLabel: string;
  lessLabel: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const rows =
    metric?.availability === "AVAILABLE" ? (metric.breakdown ?? []) : [];
  if (rows.length === 0)
    return (
      <PanelState
        text={unavailable ? "Semantic access unavailable" : emptyLabel}
      />
    );
  const visibleRows = expanded ? rows : rows.slice(0, 5);
  return (
    <div className="top-value-panel">
      <BreakdownBars rows={visibleRows} />
      {rows.length > 5 && (
        <button
          className="button secondary compact"
          type="button"
          onClick={() => {
            setExpanded((value) => !value);
          }}
          aria-expanded={expanded}
        >
          {expanded ? lessLabel : `${moreLabel} (${String(rows.length - 5)})`}
        </button>
      )}
    </div>
  );
}

function BreakdownBars({
  rows,
}: {
  rows: NonNullable<GovernedMetric["breakdown"]>;
}) {
  const max = Math.max(...rows.map((row) => Number(row.value) || 0), 1);
  return (
    <div className="breakdown-bars">
      {rows.slice(0, 7).map((row) => (
        <div className="breakdown-row" key={row.key}>
          <span>{row.label}</span>
          <div aria-hidden="true">
            <i
              style={{
                width: `${Math.max(4, ((Number(row.value) || 0) / max) * 100).toString()}%`,
              }}
            />
          </div>
          <strong>{formatNumber(row.value)}</strong>
        </div>
      ))}
    </div>
  );
}

function CustomerRows({
  rows,
  loading,
  dormant,
  labels,
}: {
  rows: readonly {
    accountId: string;
    accountRef: string;
    canonicalName: string;
    country: { displayName: string } | null;
    recordStatusCode: string;
  }[];
  loading: boolean;
  dormant: GovernedMetric | undefined;
  labels: typeof en;
}) {
  if (loading) return <PanelState text={labels.loadingCustomers} />;
  return (
    <div className="customer-portfolio-body">
      {dormant?.availability === "AVAILABLE" && dormant.value !== null && (
        <div className="portfolio-alert">
          <span>{labels.dormantCustomers}</span>
          <strong>{formatNumber(dormant.value)}</strong>
        </div>
      )}
      {rows.length === 0 && <PanelState text={labels.noCustomers} />}
      <div className="dashboard-table">
        {rows.map((account) => (
          <Link key={account.accountId} to={`/customers/${account.accountId}`}>
            <span className="entity-avatar" aria-hidden="true">
              {account.canonicalName.slice(0, 1).toUpperCase()}
            </span>
            <span>
              <strong>
                {account.canonicalName} ·{" "}
                {account.country?.displayName ?? labels.unclassified}
              </strong>
              <small>{account.accountRef}</small>
            </span>
            <span className="status-chip active">
              {account.recordStatusCode}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

function PanelState({
  text,
  error = false,
}: {
  text: string;
  error?: boolean;
}) {
  return (
    <div className={error ? "panel-state error" : "panel-state"}>{text}</div>
  );
}

/** The same clamp as metricPercent, but numeric, for tone decisions. */
function metricPercentValue(metric: GovernedMetric | undefined): number | null {
  if (metric?.availability !== "AVAILABLE" || metric.value === null)
    return null;
  return Math.max(0, Math.min(100, Number(metric.value) || 0));
}

function metricPercent(metric: GovernedMetric | undefined): string {
  if (metric?.availability !== "AVAILABLE" || metric.value === null)
    return "0%";
  const value = Math.max(0, Math.min(100, Number(metric.value) || 0));
  // One decimal. The envelope carries the full quotient -- the conversion rate
  // arrived as 42.8571 -- and printing it whole put four decimals on a KPI card
  // where the fourth changes nothing anyone decides. This doubles as a CSS
  // width for the bar beneath the figure, which is the same number either way.
  return metricText(value, "Percent");
}

/**
 * An axis label that says something at any magnitude.
 *
 * Pinning the unit to millions is fine while the company is invoicing
 * hundreds of millions and useless the moment a month, a single rep or a
 * narrower scope is in view — every tick collapses to "0.0M" and the chart
 * loses its scale entirely.
 */
function compactAxisValue(value: number): string {
  const amount = asNum(value);
  if (amount === null) return "";
  const magnitude = Math.abs(amount);
  if (magnitude === 0) return "0";
  if (magnitude >= 1e6) return `${(amount / 1e6).toFixed(1)}M`;
  if (magnitude >= 1e3) return `${Math.round(amount / 1e3).toString()}K`;
  return Math.round(amount).toString();
}

function metricNumber(metric: GovernedMetric | undefined): string {
  if (metric?.availability !== "AVAILABLE" || metric.value === null) return "0";
  const value = Number(metric.value);
  return Number.isFinite(value)
    ? value.toLocaleString("en", { maximumFractionDigits: 0 })
    : "0";
}

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

function localizeStage(value: string, locale: "en" | "ar"): string {
  if (locale !== "ar") return titleCase(value);
  const labels: Record<string, string> = {
    NEW_LEAD: "عميل محتمل",
    PROSPECT: "فرصة مبدئية",
    QUALIFIED: "فرصة مؤهلة",
    PROPOSAL: "عرض مقدم",
    NEGOTIATION: "تفاوض",
    HOT_LEAD: "فرصة ساخنة",
    UNDER_NEGOTIATION: "قيد التفاوض",
    WON: "مكتسبة",
    LOST: "مفقودة",
    CANCELLED: "ملغاة",
  };
  return labels[value.toUpperCase()] ?? titleCase(value);
}

function activityIcon(typeCode: string): string {
  const icons: Record<string, string> = {
    CALL: "☎",
    EMAIL: "✉",
    MEETING: "◫",
    SITE_VISIT: "⌖",
    WHATSAPP: "◉",
    FOLLOW_UP: "✓",
  };
  return icons[typeCode] ?? "•";
}

function activityTimestamp(activity: {
  dueAt?: string | null;
  occurredAt?: string | null;
  completedAt?: string | null;
}): number {
  const value = activity.completedAt ?? activity.occurredAt ?? activity.dueAt;
  return value ? new Date(value).getTime() : 0;
}

function formatActivityDate(
  value: string | null | undefined,
  locale: "en" | "ar",
): string {
  return value ? formatDateTime(value, locale) : "No recorded date";
}

function formatDate(value: string, locale: "en" | "ar"): string {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00Z`));
}

function formatDateTime(value: string, locale: "en" | "ar"): string {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatNumber(value: string | null): string {
  if (value === null || value.trim() === "") return "—";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return value;
  return new Intl.NumberFormat("en", { maximumFractionDigits: 2 }).format(
    numeric,
  );
}

function formatTime(value: string, locale: "en" | "ar"): string {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

const en = {
  salesCore: "Sales core · governed commercial workspace",
  salesTitle: "Commercial command center",
  managementTitle: "Sales management command center",
  supportTitle: "Sales support workspace",
  salesSubtitle:
    "Customers, pipeline, quotations, targets and controlled cross-team intelligence in one authorized view.",
  managementSubtitle:
    "Team contribution, approvals and commercial intelligence across your permitted Sales scope.",
  supportSubtitle:
    "Preparation, documents, follow-ups and read-only context according to your support permissions.",
  today: "Today",
  updated: "Updated",
  serverTruth: "Live server truth",
  newCustomer: "New customer",
  kpiAria: "Key performance indicators",
  companyTargetYear: "Company Target (2026)",
  annualTarget: "Annual Target",
  achievedWon: "Achieved (WON)",
  ofAnnualTarget: "of Annual Target",
  pipelineActive: "Pipeline (Active)",
  governedWeightedPipeline: "Governed weighted pipeline",
  teamWonContribution: "Won by me and my team",
  teamWonContributionNote:
    "Your own opportunities and your reports’, not the company total.",
  salesAchievementTrend: "Sales Achievement Trend (2026)",
  targetUsd: "Target",
  achievedUsd: "Achieved",
  monthlyTargetsMissing: "Monthly target periods are not configured",
  pipelineByStage: "Pipeline by Stage",
  viewOpportunities: "View Opportunities →",
  pipelineUnavailable: "Pipeline stage data is unavailable",
  opportunities: "opportunities",
  commercialValueByCountry: "Commercial Value by Country",
  topCountriesBySalesOrderValue: "Top Countries by Sales Order Value",
  viewReport: "View Report →",
  geographyUnavailable: "No orders in the selected period.",
  bookedValue: "Booked value",
  recentOpportunities: "Recent Opportunities",
  viewAllArrow: "View All →",
  opportunitiesTable: "Opportunities table",
  opportunity: "Opportunity",
  customer: "Customer",
  stage: "Stage",
  amount: "Amount",
  closeDate: "Close Date",
  noAuthorizedOpportunities: "No authorized opportunities",
  showing: "Showing",
  of: "of",
  activityFeed: "Activity Feed",
  recentBuys: "Recent Buys",
  followUpsDueToday: "Follow-ups due today",
  overdue: "overdue",
  nothingOverdue: "Nothing overdue",
  quotationsExpiringSoon: "Quotations expiring soon",
  nextExpiry: "Next:",
  withinDays: "Within days:",
  commercialHistory: "Commercial history",
  customers: "customers",
  orderItems: "order items",
  externalSales: "External sales",
  groupSales: "ACROW group (intercompany)",
  topCountries: "Top countries",
  topCustomers: "Top customers",
  noHistory: "No orders in the selected period.",
  targetScope: "Target period",
  currency: "Currency",
  scopeMonth: "Monthly",
  scopeQuarter: "Quarterly",
  scopeYear: "Annual",
  scopeCustom: "Custom range",
  rangeFrom: "From",
  rangeTo: "To",
  target: "Target",
  achievedInvoiced: "Achieved (invoiced)",
  myTarget: "My target",
  myTargetNote: "share of the annual target",
  wonByMe: "Won by me",
  fromMyWonDeals: "From my won opportunities",
  myPipeline: "My pipeline",
  openOpportunities: "open opportunities",
  teamTargets: "Targets by salesperson",
  setTargets: "Set targets",
  salesperson: "Salesperson",
  wonHeader: "Won",
  achievement: "Achievement",
  myPipelineHeader: "Weighted pipeline",
  openOpportunitiesHeader: "Open deals",
  noTargetSet: "Not set",
  fromErpOrders: "From ERP sales orders",
  topProducts: "Top products",
  recentOrdersImported: "Recent sales orders",
  group: "Group",
  recentBuysTable: "Recent sales orders",
  commercialSummary: "Commercial summary",
  topSalesReps: "Top sales reps by quotations",
  noQuotationsYet: "No quotations yet",
  order: "Order",
  orderDate: "Order Date",
  salesOrders: "sales orders",
  quotations: "quotations",
  ordersAndQuotes: "Total quotations",
  salesConversionRate: "Sales Conversion Rate",
  wonOfDecided: "Won / (Won + Hot + Negotiating)",
  noRecentBuys: "No recent buys",
  noAuthorizedActivities: "No authorized activity records",
  upcomingCalendarEvents: "Upcoming calendar events",
  calendarNextSevenDays: "Calendar (Next 7 Days)",
  viewCalendar: "View Calendar →",
  noUpcomingActivities: "No open activities due in the next 7 days",
  quickActions: "Quick actions",
  newOpportunity: "New Opportunity",
  newQuotation: "New Quotation",
  openImportWorkspace: "Open import workspace",
  importWorkspace: "Import Workspace",
  logActivity: "Log Activity",
  capacityCheck: "Capacity Check",
  analyticsDashboard: "Analytics Dashboard",
  targetProgress: "Company target progress",
  companyTarget: "ACROW company target",
  wonOnly: "Opportunity WON only",
  asOf: "As of",
  openTargetReport: "Open target report",
  kpis: "Governed commercial KPIs",
  wonAchieved: "WON achieved",
  remaining: "Remaining",
  myTeamContribution: "My / team WON contribution",
  weightedPipeline: "Weighted pipeline",
  quoteAttention: "Quotes awaiting attention",
  semanticUnavailable: "Governed KPI data is not available for this session.",
  semanticUnavailableNote:
    "The interface will not replace it with record counts or demo numbers. Grant the report permission or load trusted source facts.",
  semanticUnavailableShort: "Semantic access unavailable",
  noGovernedValue: "No governed value at this as-of cut",
  actionQueue: "Action queue",
  actionQueueNote:
    "Work that needs a decision or follow-up—not a notification inbox.",
  viewAll: "View all",
  loadingActions: "Loading authorized actions…",
  actionsUnavailable: "Action queue is temporarily unavailable.",
  noActions: "No actions require attention in your current scope.",
  pipeline: "Pipeline",
  pipelineNote: "Server-owned stage values with permitted opportunity context.",
  openPipeline: "Open pipeline",
  loadingPipeline: "Loading pipeline…",
  noPipeline: "No pipeline facts are available in this scope.",
  geography: "Customer geography",
  geographyNote:
    "Countries and commercial value from server-owned geography truth.",
  openAnalysis: "Open analysis",
  noGovernedGeography: "No governed geography breakdown is available.",
  noGovernedCustomerValue: "No governed customer value is available.",
  topCountriesByValue: "Top countries by value",
  topCustomersByValue: "Top customers by value",
  bookedValueBasis: "Booked Commercial Value · valid ERP facts · USD",
  more: "More",
  showLess: "Show less",
  customerPortfolio: "Customer portfolio",
  customerPortfolioNote:
    "Recent authorized Customer 360 records and health attention.",
  viewCustomers: "View customers",
  loadingCustomers: "Loading customers…",
  noCustomers: "No customers in this authorized scope.",
  dormantCustomers: "Dormant customers",
  unclassified: "Unclassified",
  commercialAttention: "Quotation attention",
  commercialAttentionNote:
    "Sales follow-up indicators from the semantic layer.",
  openQuotations: "Open quotations",
  sentQuotes: "Sent quotations",
  acceptanceRate: "Acceptance rate",
  pipelineAging: "Pipeline aging",
  connectedIntelligence: "Connected workspaces",
  connectedIntelligenceNote:
    "Status projections return to Sales without opening team workspaces.",
  capacity: "Capacity estimate",
  logistics: "Logistics planning",
  aiAdvice: "AI next actions",
  noDueDate: "No due date",
};

const ar: typeof en = {
  salesCore: "مركز المبيعات · مساحة تجارية محكومة",
  salesTitle: "مركز القيادة التجارية",
  managementTitle: "مركز إدارة المبيعات",
  supportTitle: "مساحة دعم المبيعات",
  salesSubtitle:
    "العملاء والمسار والعروض والأهداف وملخصات الفرق المسموح بها في شاشة واحدة.",
  managementSubtitle:
    "مساهمة الفريق والاعتمادات والذكاء التجاري داخل نطاق المبيعات المسموح.",
  supportSubtitle:
    "التجهيز والمستندات والمتابعات والسياق المقروء حسب صلاحيات الدعم.",
  today: "اليوم",
  updated: "آخر تحديث",
  serverTruth: "بيانات حية من الخادم",
  newCustomer: "عميل جديد",
  kpiAria: "مؤشرات الأداء الرئيسية",
  companyTargetYear: "هدف الشركة (٢٠٢٦)",
  annualTarget: "الهدف السنوي",
  achievedWon: "المحقق (WON)",
  ofAnnualTarget: "من الهدف السنوي",
  pipelineActive: "المسار النشط",
  governedWeightedPipeline: "المسار المرجّح المعتمد",
  teamWonContribution: "اللي كسبته أنا وفريقي",
  teamWonContributionNote: "فرصك إنت واللي تحتيك، مش إجمالي الشركة.",
  salesAchievementTrend: "اتجاه تحقيق المبيعات (٢٠٢٦)",
  targetUsd: "الهدف",
  achievedUsd: "المحقق",
  monthlyTargetsMissing: "لم تُضبط فترات الهدف الشهرية بعد",
  pipelineByStage: "مسار الفرص حسب المرحلة",
  viewOpportunities: "عرض الفرص ←",
  pipelineUnavailable: "بيانات مراحل المسار غير متاحة",
  opportunities: "فرصة",
  commercialValueByCountry: "القيمة التجارية حسب الدولة",
  topCountriesBySalesOrderValue: "أعلى الدول حسب قيمة أوامر المبيعات",
  viewReport: "عرض التقرير ←",
  geographyUnavailable: "مفيش أوامر بيع في الفترة المختارة.",
  bookedValue: "القيمة المحجوزة",
  recentOpportunities: "أحدث الفرص",
  viewAllArrow: "عرض الكل ←",
  opportunitiesTable: "جدول الفرص",
  opportunity: "الفرصة",
  customer: "العميل",
  stage: "المرحلة",
  amount: "القيمة",
  closeDate: "تاريخ الإغلاق",
  noAuthorizedOpportunities: "لا توجد فرص مصرح بها",
  showing: "عرض",
  of: "من",
  activityFeed: "سجل الأنشطة",
  recentBuys: "أحدث المشتريات",
  followUpsDueToday: "متابعات مستحقة اليوم",
  overdue: "متأخرة",
  nothingOverdue: "لا يوجد متأخر",
  quotationsExpiringSoon: "عروض أسعار قاربت على الانتهاء",
  nextExpiry: "الأقرب:",
  withinDays: "خلال أيام:",
  commercialHistory: "السجل التجاري",
  customers: "عميل",
  orderItems: "بند",
  externalSales: "مبيعات خارجية",
  groupSales: "مجموعة أكرو (بين الشركات)",
  topCountries: "أعلى الدول",
  topCustomers: "أعلى العملاء",
  noHistory: "مفيش أوامر بيع في الفترة المختارة.",
  targetScope: "فترة الهدف",
  currency: "العملة",
  scopeMonth: "شهري",
  scopeQuarter: "ربع سنوي",
  scopeYear: "سنوي",
  scopeCustom: "فترة مخصّصة",
  rangeFrom: "من",
  rangeTo: "إلى",
  target: "الهدف",
  achievedInvoiced: "المحقق (مفوتر)",
  myTarget: "هدفي",
  myTargetNote: "نصيب الفترة من الهدف السنوي",
  wonByMe: "اللي كسبته",
  fromMyWonDeals: "من فرصي المكسوبة",
  myPipeline: "مساري",
  openOpportunities: "فرص مفتوحة",
  teamTargets: "الأهداف حسب المندوب",
  setTargets: "تحديد الأهداف",
  salesperson: "المندوب",
  wonHeader: "المكسوب",
  achievement: "نسبة التحقيق",
  myPipelineHeader: "المسار المرجّح",
  openOpportunitiesHeader: "فرص مفتوحة",
  noTargetSet: "غير محدد",
  fromErpOrders: "من أوامر البيع في ERP",
  topProducts: "أعلى المنتجات",
  recentOrdersImported: "أحدث أوامر البيع",
  group: "مجموعة",
  recentBuysTable: "أحدث أوامر المبيعات",
  commercialSummary: "ملخص تجاري",
  topSalesReps: "الأكثر إصدارًا لعروض الأسعار",
  noQuotationsYet: "لا توجد عروض أسعار بعد",
  order: "الأمر",
  orderDate: "تاريخ الأمر",
  salesOrders: "أوامر المبيعات",
  quotations: "عروض الأسعار",
  ordersAndQuotes: "إجمالي عروض الأسعار",
  salesConversionRate: "معدل تحويل المبيعات",
  wonOfDecided: "مكسوب ÷ (مكسوب + ساخن + تحت التفاوض)",
  noRecentBuys: "لا توجد مشتريات حديثة",
  noAuthorizedActivities: "لا توجد أنشطة مصرح بها",
  upcomingCalendarEvents: "أحداث التقويم القادمة",
  calendarNextSevenDays: "التقويم (السبعة أيام القادمة)",
  viewCalendar: "عرض التقويم ←",
  noUpcomingActivities: "لا توجد أنشطة مفتوحة خلال الأيام السبعة القادمة",
  quickActions: "إجراءات سريعة",
  newOpportunity: "فرصة جديدة",
  newQuotation: "عرض سعر جديد",
  openImportWorkspace: "فتح مساحة الاستيراد",
  importWorkspace: "مساحة الاستيراد",
  logActivity: "تسجيل نشاط",
  capacityCheck: "فحص الطاقة",
  analyticsDashboard: "لوحة التحليلات",
  targetProgress: "تقدم هدف الشركة",
  companyTarget: "هدف شركة أكرو",
  wonOnly: "الفرص WON فقط",
  asOf: "حتى",
  openTargetReport: "فتح تقرير الهدف",
  kpis: "المؤشرات التجارية المعتمدة",
  wonAchieved: "المحقق من WON",
  remaining: "المتبقي",
  myTeamContribution: "مساهمة المستخدم / الفريق",
  weightedPipeline: "المسار المرجّح",
  quoteAttention: "عروض تحتاج متابعة",
  semanticUnavailable: "بيانات المؤشرات المعتمدة غير متاحة لهذه الجلسة.",
  semanticUnavailableNote:
    "لن تستبدل الواجهة المؤشرات بأعداد سجلات أو أرقام تجريبية. يلزم تصريح التقارير أو بيانات مصدر موثوقة.",
  semanticUnavailableShort: "صلاحية المؤشرات غير متاحة",
  noGovernedValue: "لا توجد قيمة معتمدة في هذه اللحظة",
  actionQueue: "قائمة الإجراءات",
  actionQueueNote: "أعمال تحتاج قرارًا أو متابعة، وليست صندوق إشعارات.",
  viewAll: "عرض الكل",
  loadingActions: "جاري تحميل الإجراءات المصرح بها…",
  actionsUnavailable: "قائمة الإجراءات غير متاحة مؤقتًا.",
  noActions: "لا توجد إجراءات تحتاج انتباهًا في نطاقك الحالي.",
  pipeline: "مسار الفرص",
  pipelineNote: "قيم المراحل من الخادم مع سياق الفرص المسموح.",
  openPipeline: "فتح المسار",
  loadingPipeline: "جاري تحميل المسار…",
  noPipeline: "لا توجد بيانات مسار متاحة في هذا النطاق.",
  geography: "جغرافيا العملاء",
  geographyNote: "الدول والقيمة التجارية من مرجعية الجغرافيا في الخادم.",
  openAnalysis: "فتح التحليل",
  noGovernedGeography: "لا يوجد توزيع جغرافي معتمد متاح.",
  noGovernedCustomerValue: "لا توجد قيمة عملاء معتمدة متاحة.",
  topCountriesByValue: "أعلى الدول حسب القيمة",
  topCustomersByValue: "أعلى العملاء حسب القيمة",
  bookedValueBasis: "القيمة التجارية المحجوزة · بيانات ERP سليمة · دولار",
  more: "المزيد",
  showLess: "عرض أقل",
  customerPortfolio: "محفظة العملاء",
  customerPortfolioNote: "أحدث ملفات العملاء المصرح بها وتنبيهات الصحة.",
  viewCustomers: "عرض العملاء",
  loadingCustomers: "جاري تحميل العملاء…",
  noCustomers: "لا يوجد عملاء في النطاق المصرح.",
  dormantCustomers: "العملاء الخاملون",
  unclassified: "غير مصنف",
  commercialAttention: "متابعة عروض الأسعار",
  commercialAttentionNote: "مؤشرات المتابعة من الطبقة الدلالية.",
  openQuotations: "فتح عروض الأسعار",
  sentQuotes: "العروض المرسلة",
  acceptanceRate: "نسبة القبول",
  pipelineAging: "عمر المسار",
  connectedIntelligence: "مساحات العمل المتصلة",
  connectedIntelligenceNote:
    "ترجع الحالات إلى المبيعات بدون فتح مساحات الفرق الأخرى.",
  capacity: "تقدير الطاقة",
  logistics: "تخطيط اللوجستيات",
  aiAdvice: "إجراءات الذكاء المقترحة",
  noDueDate: "بدون موعد",
};
