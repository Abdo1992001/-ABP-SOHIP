import { useMemo } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import type { ApiClient } from "@abp/api-client";
import type { Me } from "../api/customer-api.ts";
import { useI18n } from "../i18n/i18n.tsx";
import { enumLabel } from "../i18n/enum-labels.ts";
import { commercialRequest, isObject, str } from "./commercial-api.ts";
import { ErrorBanner, LoadingSkeleton, PageHeader } from "./CommercialUI.tsx";

/**
 * Commercial today — the screen that answers a question instead of reporting a
 * number.
 *
 * The dashboard tells you the year is 27% achieved. True, and there is nothing
 * you can do with it at 9am. Every section here ends in a deal you can open and
 * a reason it is on the list, and every one of them is computed from fields the
 * opportunity record actually carries: `expectedCloseDate`, `updatedAt`,
 * `stageCode`, `probabilityPct`, `estimatedValue`, `ownerUserId`.
 *
 * What is deliberately absent: per-person targets. There is no per-user target
 * anywhere in the schema — `company-targets` is a single company figure — so
 * "who is behind their number" cannot be answered honestly, and inventing a
 * denominator to rank people by would be worse than leaving the question out.
 * The team section reports what each person is carrying, which is a fact.
 *
 * "What needs you today" is not here either: `/actions` already answers it from
 * the server's own action queue, and two screens answering one question is how
 * they end up disagreeing.
 */

/** Stages a deal can still be worked. Anything else is decided. */
const OPEN_STAGES = new Set([
  "NEW_LEAD",
  "PROSPECT",
  "QUALIFIED",
  "PROPOSAL",
  "NEGOTIATION",
]);

interface Opportunity {
  opportunityId: string;
  opportunityRef: string;
  title: string;
  stageCode: string;
  ownerUserId: string;
  estimatedValue: string;
  currencyCode: string;
  probabilityPct: string;
  expectedCloseDate: string | null;
  updatedAt: string;
}

function toOpportunity(row: Record<string, unknown>): Opportunity {
  return {
    opportunityId: str(row.opportunityId),
    opportunityRef: str(row.opportunityRef),
    title: str(row.title),
    stageCode: str(row.stageCode),
    ownerUserId: str(row.ownerUserId),
    estimatedValue:
      typeof row.estimatedValue === "string" ? row.estimatedValue : "0",
    currencyCode:
      typeof row.currencyCode === "string" ? row.currencyCode : "USD",
    probabilityPct:
      typeof row.probabilityPct === "string" ? row.probabilityPct : "0",
    expectedCloseDate:
      typeof row.expectedCloseDate === "string" ? row.expectedCloseDate : null,
    updatedAt: str(row.updatedAt),
  };
}

const DAY = 86_400_000;

/** Whole days between then and now, floored — "touched 9 days ago". */
function daysSince(iso: string, now: number): number {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 0;
  return Math.max(0, Math.floor((now - then) / DAY));
}

/**
 * Totals are kept per currency and never added together.
 *
 * The pipeline holds USD and EGP side by side at a rate that moves; one summed
 * figure would be a number that was true at some unstated moment and is now
 * wrong, presented as if it were a fact.
 */
function sumByCurrency(rows: Opportunity[], weighted: boolean) {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const value = Number(row.estimatedValue) || 0;
    const factor = weighted ? (Number(row.probabilityPct) || 0) / 100 : 1;
    totals.set(
      row.currencyCode,
      (totals.get(row.currencyCode) ?? 0) + value * factor,
    );
  }
  return [...totals.entries()].sort((a, b) => b[1] - a[1]);
}

export function CommercialTodayPage({
  client,
  me,
}: {
  client: ApiClient;
  me: Me;
}) {
  const { locale } = useI18n();
  const txt = (en: string, ar: string) => (locale === "ar" ? ar : en);

  const opportunities = useQuery({
    queryKey: ["today-opportunities"],
    queryFn: () =>
      commercialRequest(client, "GET", "/opportunities", {
        path: {},
        query: { page: 1, limit: 200 },
      }),
  });

  const roster = useQuery({
    queryKey: ["today-roster"],
    queryFn: () =>
      commercialRequest(client, "GET", "/team/roster", { path: {} }),
  });

  const names = useMemo(() => {
    const map = new Map<string, string>();
    const rows =
      isObject(roster.data?.data) && Array.isArray(roster.data.data.data)
        ? roster.data.data.data.filter(isObject)
        : [];
    for (const row of rows) map.set(str(row.userId), str(row.displayName));
    return map;
  }, [roster.data]);

  const model = useMemo(() => {
    const rows =
      isObject(opportunities.data?.data) &&
      Array.isArray(opportunities.data.data.data)
        ? opportunities.data.data.data.filter(isObject).map(toOpportunity)
        : [];
    const now = Date.now();
    const open = rows.filter((row) => OPEN_STAGES.has(row.stageCode));

    // Past its own close date and still open. The date came from the person
    // who owns the deal, so this is their own forecast having slipped.
    const slipping = open
      .filter(
        (row) =>
          row.expectedCloseDate !== null &&
          new Date(row.expectedCloseDate).getTime() < now,
      )
      .sort(
        (a, b) =>
          new Date(a.expectedCloseDate ?? 0).getTime() -
          new Date(b.expectedCloseDate ?? 0).getTime(),
      );

    // Least recently touched. Ranked rather than thresholded: a fixed "quiet
    // for 14 days" rule shows nothing on a fresh pipeline and everything on an
    // old one, whereas the five you have neglected most always exist.
    const quiet = [...open]
      .sort(
        (a, b) =>
          new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime(),
      )
      .slice(0, 6);

    // Due to close inside this calendar month.
    const monthEnd = new Date();
    monthEnd.setMonth(monthEnd.getMonth() + 1, 0);
    monthEnd.setHours(23, 59, 59, 999);
    const closingThisMonth = open
      .filter(
        (row) =>
          row.expectedCloseDate !== null &&
          new Date(row.expectedCloseDate).getTime() <= monthEnd.getTime(),
      )
      .sort((a, b) => Number(b.estimatedValue) - Number(a.estimatedValue));

    // What each person is carrying. Won is the decided half, open the rest.
    const byOwner = new Map<
      string,
      { won: Opportunity[]; open: Opportunity[] }
    >();
    for (const row of rows) {
      const bucket = byOwner.get(row.ownerUserId) ?? { won: [], open: [] };
      if (row.stageCode === "WON") bucket.won.push(row);
      else if (OPEN_STAGES.has(row.stageCode)) bucket.open.push(row);
      byOwner.set(row.ownerUserId, bucket);
    }
    const team = [...byOwner.entries()]
      .map(([userId, bucket]) => ({
        userId,
        won: sumByCurrency(bucket.won, false),
        openTotals: sumByCurrency(bucket.open, false),
        openCount: bucket.open.length,
        wonCount: bucket.won.length,
      }))
      .sort((a, b) => (b.won[0]?.[1] ?? 0) - (a.won[0]?.[1] ?? 0));

    return { rows, open, slipping, quiet, closingThisMonth, team, now };
  }, [opportunities.data]);

  /**
   * Latin digits even in Arabic. Arabic-Indic numerals in a column of figures
   * are markedly harder to compare at a glance, and every reference, date and
   * SKU beside them is Latin anyway — mixing the two in one table is worse
   * than either on its own.
   */
  const money = (amount: number, currency: string) =>
    `${amount.toLocaleString("en", { maximumFractionDigits: 0 })} ${currency}`;

  if (opportunities.isLoading)
    return <LoadingSkeleton rows={5} variant="cards" />;

  const dealRow = (row: Opportunity, reason: string) => (
    <li key={row.opportunityId}>
      <Link to={`/opportunities/${row.opportunityId}`} className="today-deal">
        <span className="today-deal-main">
          <strong>{row.title}</strong>
          <small data-abp-num>{row.opportunityRef}</small>
        </span>
        <span className="today-deal-meta">
          <span className="today-deal-reason">{reason}</span>
          <span className="today-deal-value" data-abp-num>
            {money(Number(row.estimatedValue) || 0, row.currencyCode)}
          </span>
          <span className="today-deal-stage">
            {enumLabel(row.stageCode, locale)}
          </span>
        </span>
      </Link>
    </li>
  );

  const section = (
    key: string,
    question: string,
    answer: string,
    body: React.ReactNode,
  ) => (
    <section className="today-section" key={key}>
      <header>
        <h2>{question}</h2>
        <p>{answer}</p>
      </header>
      {body}
    </section>
  );

  const nothing = (message: string) => <p className="today-empty">{message}</p>;

  const weighted = sumByCurrency(model.closingThisMonth, true);
  const unweighted = sumByCurrency(model.closingThisMonth, false);

  return (
    <div className="workspace-page today-page">
      <PageHeader
        kicker={txt("Commercial today", "شغل النهاردة")}
        title={txt("What needs a decision", "اللي محتاج قرار")}
        sub={txt(
          "Four questions about the pipeline, answered from the deals themselves. Tasks due today are in the action queue.",
          "أربع أسئلة عن خط البيع، الإجابة من الصفقات نفسها. المهام المستحقة النهاردة في قائمة الإجراءات.",
        )}
        actions={
          <Link className="ghost-button" to="/actions">
            {txt("Action queue", "قائمة الإجراءات")}
          </Link>
        }
      />

      <ErrorBanner
        error={opportunities.error}
        retry={() => void opportunities.refetch()}
      />

      <div className="today-grid">
        {section(
          "slipping",
          txt("Which deals have slipped?", "أنهي صفقات فاتها ميعادها؟"),
          txt(
            "Open, and past the close date their owner set.",
            "مفتوحة، وعدّى تاريخ الإقفال اللي صاحبها حدده.",
          ),
          model.slipping.length === 0 ? (
            nothing(
              txt(
                "Nothing is past its close date.",
                "مفيش حاجة عدّى ميعاد إقفالها.",
              ),
            )
          ) : (
            <ul className="today-list">
              {model.slipping.map((row) =>
                dealRow(
                  row,
                  txt(
                    `${String(daysSince(row.expectedCloseDate ?? "", model.now))} days late`,
                    `متأخرة ${String(daysSince(row.expectedCloseDate ?? "", model.now))} يوم`,
                  ),
                ),
              )}
            </ul>
          ),
        )}

        {section(
          "quiet",
          txt("What have I not touched?", "إيه اللي ملمستوش؟"),
          txt(
            "The open deals longest without an update.",
            "الصفقات المفتوحة اللي عدّى عليها أطول وقت من غير تحديث.",
          ),
          model.quiet.length === 0 ? (
            nothing(txt("No open deals.", "مفيش صفقات مفتوحة."))
          ) : (
            <ul className="today-list">
              {model.quiet.map((row) =>
                dealRow(
                  row,
                  txt(
                    `${String(daysSince(row.updatedAt, model.now))} days quiet`,
                    `ساكتة ${String(daysSince(row.updatedAt, model.now))} يوم`,
                  ),
                ),
              )}
            </ul>
          ),
        )}

        {section(
          "closing",
          txt(
            "What can still close this month?",
            "إيه اللي ممكن يقفل الشهر ده؟",
          ),
          txt(
            "Open deals due by month end, at their own probability.",
            "صفقات مفتوحة ميعادها قبل آخر الشهر، باحتمالية كل واحدة.",
          ),
          model.closingThisMonth.length === 0 ? (
            nothing(
              txt(
                "Nothing is due to close this month.",
                "مفيش حاجة ميعاد إقفالها الشهر ده.",
              ),
            )
          ) : (
            <>
              <div className="today-forecast">
                {weighted.map(([currency, amount]) => {
                  const full =
                    unweighted.find(([code]) => code === currency)?.[1] ?? 0;
                  return (
                    <div className="today-forecast-line" key={currency}>
                      <span>{txt("Weighted", "مرجّح")}</span>
                      <strong data-abp-num>{money(amount, currency)}</strong>
                      <small>
                        {txt("of", "من")}{" "}
                        <span data-abp-num>{money(full, currency)}</span>{" "}
                        {txt("in full", "بالكامل")}
                      </small>
                    </div>
                  );
                })}
              </div>
              <ul className="today-list">
                {model.closingThisMonth
                  .slice(0, 6)
                  .map((row) =>
                    dealRow(
                      row,
                      txt(
                        `${row.probabilityPct}% likely`,
                        `احتمال ${row.probabilityPct}%`,
                      ),
                    ),
                  )}
              </ul>
            </>
          ),
        )}

        {section(
          "team",
          txt("What is each person carrying?", "كل واحد شايل إيه؟"),
          txt(
            "Won and still-open value per owner. There are no per-person targets in this system, so this ranks load, not performance.",
            "المكسوب والمفتوح لكل مسؤول. مفيش أهداف فردية في النظام، فده ترتيب بالحمل مش بالأداء.",
          ),
          model.team.length === 0 ? (
            nothing(txt("No owned deals.", "مفيش صفقات متعيّنة."))
          ) : (
            <ul className="today-team">
              {model.team.map((person) => (
                <li key={person.userId}>
                  <span className="today-team-name">
                    {names.get(person.userId) ??
                      (person.userId === me.user.userId
                        ? me.user.displayName
                        : txt("Unassigned", "غير معيّن"))}
                  </span>
                  <span className="today-team-figures">
                    <span>
                      {txt("Won", "مكسوب")}{" "}
                      <strong data-abp-num>
                        {person.won.length === 0
                          ? "—"
                          : person.won
                              .map(([code, amount]) => money(amount, code))
                              .join(" · ")}
                      </strong>
                    </span>
                    <span>
                      {txt("Open", "مفتوح")}{" "}
                      <strong data-abp-num>
                        {person.openTotals.length === 0
                          ? "—"
                          : person.openTotals
                              .map(([code, amount]) => money(amount, code))
                              .join(" · ")}
                      </strong>
                      <small data-abp-num> ({String(person.openCount)})</small>
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          ),
        )}
      </div>
    </div>
  );
}
