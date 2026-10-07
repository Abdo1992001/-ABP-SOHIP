import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ApiClient, components } from "@abp/api-client";
import { permissions } from "@abp/contracts";
import type { Me } from "../api/customer-api.ts";
import { useI18n } from "../i18n/i18n.tsx";
import { toNum } from "../lib/numbers.ts";
import { ErrorBanner, PageHeader } from "./CommercialUI.tsx";
import { PersonTargetsTable } from "./PersonTargetsTable.tsx";
import { localToday } from "../lib/today.ts";

type TargetPerformance = components["schemas"]["TargetPerformance"];

/**
 * The annual target and how the year is actually going.
 *
 * A target screen that only shows the number is a wall poster. The useful part
 * is the comparison: month by month, what was planned against what has closed,
 * and whether the gap is growing. Periods that have not started yet are shown
 * but not counted as a miss — a zero in November is not a shortfall in March.
 */
export function TargetsPage({ client, me }: { client: ApiClient; me: Me }) {
  const { locale } = useI18n();
  const ar = locale === "ar";
  const labels = ar ? arLabels : enLabels;
  const [year, setYear] = useState(new Date().getFullYear());
  const granted = new Set<string>(me.access.permissions);
  const managesTeam = granted.has(permissions.salesManagementView);

  const performance = useQuery({
    queryKey: ["company-target-performance", year],
    queryFn: async () => {
      const result = await client.GET("/company-targets/{year}/performance", {
        params: { path: { year: String(year) } },
      });
      if (!result.data)
        throw new Error(`TARGET_PERFORMANCE_${String(result.response.status)}`);
      return result.data.data as unknown as TargetPerformance;
    },
    retry: false,
  });

  const data = performance.data;
  const money = (value: string | number | null | undefined) =>
    value === null || value === undefined
      ? "—"
      : `${Number(value).toLocaleString(ar ? "ar-EG" : "en", {
          maximumFractionDigits: 0,
        })} ${data?.baseCurrencyCode ?? ""}`.trim();

  const today = localToday();
  const periods = data?.periods ?? [];
  const elapsed = periods.filter((period) => period.periodEnd < today);
  const plannedToDate = elapsed.reduce(
    (sum, period) => sum + Number(period.targetAmount),
    0,
  );
  const wonToDate = elapsed.reduce(
    (sum, period) => sum + Number(period.wonAmount),
    0,
  );
  // Pace against the year so far, not against the whole year: being 8% of the
  // way to an annual number in February is not behind.
  const paceGap = wonToDate - plannedToDate;

  const achievement = toNum(data?.achievementPct, 0);

  return (
    <section className="targets-page">
      <PageHeader
        kicker={labels.kicker}
        title={labels.title}
        sub={labels.subtitle}
        actions={
          <select
            value={year}
            aria-label={labels.year}
            onChange={(event) => {
              setYear(Number(event.target.value));
            }}
          >
            {[year - 1, year, year + 1]
              .filter((value, index, all) => all.indexOf(value) === index)
              .sort((a, b) => a - b)
              .map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
          </select>
        }
      />

      <ErrorBanner
        error={performance.error}
        retry={() => {
          void performance.refetch();
        }}
      />

      {performance.isError && <p className="table-empty">{labels.noTarget}</p>}

      {data && (
        <>
          <div className="targets-summary">
            <div>
              <span>{labels.annualTarget}</span>
              <strong>{money(data.targetAmount)}</strong>
            </div>
            <div>
              <span>{labels.wonSoFar}</span>
              <strong>{money(data.wonAmount)}</strong>
            </div>
            <div>
              <span>{labels.remaining}</span>
              <strong>{money(data.remainingAmount)}</strong>
            </div>
            <div className={paceGap < 0 ? "is-behind" : "is-ahead"}>
              <span>{labels.pace}</span>
              <strong>
                {paceGap < 0 ? "−" : "+"}
                {money(Math.abs(paceGap)).replace("-", "")}
              </strong>
              <em>
                {elapsed.length === 0
                  ? labels.yearNotStarted
                  : `${labels.against} ${money(plannedToDate)} ${labels.plannedByNow}`}
              </em>
            </div>
          </div>

          <div className="targets-bar">
            <div
              className="targets-bar-fill"
              style={{ width: `${String(Math.min(100, achievement))}%` }}
            />
            <span>{achievement.toFixed(1)}%</span>
          </div>

          <div className="enterprise-table-scroll">
            <table className="enterprise-table">
              <thead>
                <tr>
                  <th>{labels.period}</th>
                  <th className="numeric">{labels.planned}</th>
                  <th className="numeric">{labels.won}</th>
                  <th className="numeric">{labels.gap}</th>
                  <th>{labels.progress}</th>
                </tr>
              </thead>
              <tbody>
                {periods.map((period) => {
                  const planned = Number(period.targetAmount);
                  const won = Number(period.wonAmount);
                  const future = period.periodStart > today;
                  const pct = planned > 0 ? (won / planned) * 100 : 0;
                  return (
                    <tr
                      key={period.periodStart}
                      className={future ? "is-future" : ""}
                    >
                      <td>{monthLabel(period.periodStart, locale)}</td>
                      <td className="numeric">{money(period.targetAmount)}</td>
                      <td className="numeric">{money(period.wonAmount)}</td>
                      <td className="numeric">
                        {future ? "—" : money(won - planned)}
                      </td>
                      <td>
                        {future ? (
                          <span className="targets-future">
                            {labels.notStarted}
                          </span>
                        ) : (
                          <div className="targets-row-bar">
                            <div
                              style={{
                                width: `${String(Math.min(100, pct))}%`,
                              }}
                            />
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {periods.length === 0 && (
                  <tr>
                    <td colSpan={5} className="table-empty">
                      {labels.noPeriods}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      <PersonTargetsTable
        client={client}
        year={year}
        canManage={managesTeam && granted.has(permissions.targetsManage)}
        onlyUserId={managesTeam ? null : me.user.userId}
      />
    </section>
  );
}

function monthLabel(periodStart: string, locale: string) {
  const date = new Date(`${periodStart}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return periodStart;
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en", {
    month: "long",
    year: "numeric",
  }).format(date);
}

const enLabels = {
  kicker: "Planning",
  title: "Company target",
  subtitle: "The plan for the year, and how it is actually going.",
  year: "Year",
  noTarget: "No target has been set for this year.",
  annualTarget: "Annual target",
  wonSoFar: "Won so far",
  remaining: "Remaining",
  pace: "Against pace",
  against: "against",
  plannedByNow: "planned by now",
  yearNotStarted: "The first period has not closed yet.",
  period: "Period",
  planned: "Planned",
  won: "Won",
  gap: "Gap",
  progress: "Progress",
  notStarted: "Not started",
  noPeriods: "No periods are configured for this target.",
};

const arLabels: typeof enLabels = {
  kicker: "التخطيط",
  title: "هدف الشركة",
  subtitle: "خطة العام، وأين نحن منها فعليًا.",
  year: "السنة",
  noTarget: "لم يتم تحديد هدف لهذه السنة.",
  annualTarget: "الهدف السنوي",
  wonSoFar: "المحقق حتى الآن",
  remaining: "المتبقي",
  pace: "مقابل الوتيرة",
  against: "مقابل",
  plannedByNow: "مخطط حتى الآن",
  yearNotStarted: "لم تُغلق أول فترة بعد.",
  period: "الفترة",
  planned: "المخطط",
  won: "المحقق",
  gap: "الفرق",
  progress: "التقدم",
  notStarted: "لم تبدأ",
  noPeriods: "لا توجد فترات محددة لهذا الهدف.",
};
