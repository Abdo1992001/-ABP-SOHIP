import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import type { ApiClient } from "@abp/api-client";
import { useI18n } from "../i18n/i18n.tsx";
import { formatNum } from "../lib/numbers.ts";
import { commercialRequest, isObject } from "./commercial-api.ts";

/**
 * From order to cash, under the KPIs: what was sold and where each order is,
 * whether the factory will make the customer's date, what is on the road,
 * what is owed and late, and how happy customers are -- each tile opening the
 * screen that holds the detail. A figure the viewer may not see is left out.
 */

type Rec = Record<string, unknown>;
const STAGES = [
  { code: "DRAFT", en: "Draft", ar: "مسودة" },
  { code: "CONFIRMED", en: "Confirmed", ar: "مؤكَّد" },
  { code: "IN_PRODUCTION", en: "In production", ar: "في الإنتاج" },
  { code: "READY", en: "Ready", ar: "جاهز" },
  { code: "HANDED_OVER", en: "Handed over", ar: "اتسلّم" },
];

function money(value: unknown, locale: "en" | "ar"): string {
  if (!isObject(value)) return "—";
  const parts = Object.entries(value)
    .filter(([, amount]) => Number(amount) > 0)
    .sort((a, b) => (a[0] === "EGP" ? -1 : b[0] === "EGP" ? 1 : 0))
    .map(
      ([currency, amount]) =>
        `${formatNum(Number(amount), locale)} ${currency}`,
    );
  return parts.length === 0 ? "0" : parts.slice(0, 2).join(" · ");
}

export function OrderToCashBand({ client }: { client: ApiClient }) {
  const { locale } = useI18n();
  const ar = locale === "ar";
  const txt = (en: string, arabic: string) => (ar ? arabic : en);
  const query = useQuery({
    queryKey: ["overview", "order-to-cash"],
    queryFn: async () => {
      const result = await commercialRequest(
        client,
        "GET",
        "/overview/order-to-cash",
      );
      return isObject(result.data) && isObject(result.data.data)
        ? result.data.data
        : null;
    },
    staleTime: 60_000,
    retry: false,
  });
  const data = query.data;
  if (!data) return null;
  const orders = isObject(data.orders) ? data.orders : null;
  const receivables = isObject(data.receivables) ? data.receivables : null;
  const production = isObject(data.production) ? data.production : null;
  const deliveries = isObject(data.deliveries) ? data.deliveries : null;
  const complaints = isObject(data.complaints) ? data.complaints : null;
  const happiness = isObject(data.satisfaction) ? data.satisfaction : null;
  const stages: Rec = orders && isObject(orders.stages) ? orders.stages : {};
  const count = (value: unknown) => formatNum(Number(value) || 0, locale);

  return (
    <section
      className="abp2-flow-band"
      aria-label={txt("From order to cash", "من الأوردر للتحصيل")}
    >
      <div className="abp2-flow-head">
        <h3 className="pro-chart-title">
          {txt("From order to cash", "من الأوردر للتحصيل")}
        </h3>
        {orders && (
          <span className="abp2-history-note">
            {txt("Open orders worth", "أوردرات مفتوحة بقيمة")}{" "}
            {money(orders.openValue, locale)}
          </span>
        )}
      </div>
      {orders && (
        <ol className="abp2-flow-stages">
          {STAGES.map((stage, index) => (
            <li
              key={stage.code}
              style={{ animationDelay: `${String(60 + index * 60)}ms` }}
            >
              <Link to="/customer-orders">
                <strong>{count(stages[stage.code])}</strong>
                <span>{ar ? stage.ar : stage.en}</span>
              </Link>
            </li>
          ))}
        </ol>
      )}
      <div className="abp2-flow-tiles">
        {receivables && (
          <Link
            to="/finance/receivables"
            className={`abp2-flow-tile${Number(receivables.overdueCount) > 0 ? " is-alert" : ""}`}
          >
            <span>{txt("Customers owe", "على العملاء")}</span>
            <strong>{money(receivables.owed, locale)}</strong>
            <small>
              {Number(receivables.overdueCount) > 0
                ? `${money(receivables.overdue, locale)} ${txt("late", "متأخر")} · ${count(receivables.overdueCount)} ${Number(receivables.overdueCount) === 1 ? txt("installment", "قسط") : txt("installments", "أقساط")}`
                : txt("Nothing late", "مفيش متأخرات")}
            </small>
          </Link>
        )}
        {production && (
          <Link
            to="/operations/production-schedule"
            className={`abp2-flow-tile${Number(production.atRisk) > 0 ? " is-alert" : ""}`}
          >
            <span>{txt("In the factory", "في المصنع")}</span>
            <strong>
              {count(production.active)} {txt("runs", "تشغيلة")}
            </strong>
            <small>
              {Number(production.atRisk) > 0
                ? `${count(production.atRisk)} ${txt("may miss the customer's date", "ممكن تتأخر على ميعاد العميل")}`
                : txt("All on time", "كله في ميعاده")}
            </small>
          </Link>
        )}
        {deliveries && (
          <Link
            to="/logistics/delivery-calendar"
            className={`abp2-flow-tile${Number(deliveries.late) > 0 ? " is-alert" : ""}`}
          >
            <span>{txt("Deliveries this week", "تسليمات الأسبوع ده")}</span>
            <strong>{count(deliveries.dueThisWeek)}</strong>
            <small>
              {Number(deliveries.late) > 0
                ? `${count(deliveries.late)} ${txt("past their date", "عدّى ميعادها")}`
                : txt("None late", "مفيش متأخر")}
            </small>
          </Link>
        )}
        {complaints && (
          <Link
            to="/complaints"
            className={`abp2-flow-tile${Number(complaints.late) > 0 ? " is-alert" : ""}`}
          >
            <span>{txt("Open complaints", "شكاوى مفتوحة")}</span>
            <strong>{count(complaints.open)}</strong>
            <small>
              {Number(complaints.late) > 0
                ? `${count(complaints.late)} ${txt("past their stage deadline", "عدّت ميعاد مرحلتها")}`
                : txt("All within their deadlines", "كلها في ميعادها")}
            </small>
          </Link>
        )}
        {happiness && (
          <Link
            to="/customer-feedback"
            className={`abp2-flow-tile${Number(happiness.criticalOpen) > 0 ? " is-alert" : ""}`}
          >
            <span>
              {txt("Customer satisfaction · 90 days", "رضا العملاء · 90 يوم")}
            </span>
            <strong>
              {happiness.average === null
                ? "—"
                : `${formatNum(Number(happiness.average), locale, { maximumFractionDigits: 1 })} / 5`}
            </strong>
            <small>
              {happiness.csatPct === null
                ? txt("No ratings yet", "مفيش تقييمات لسه")
                : `${formatNum(Number(happiness.csatPct), locale, { maximumFractionDigits: 0 })}% ${txt("satisfied", "راضيين")} · ${count(happiness.responses)} ${txt("ratings", "تقييم")}`}
            </small>
          </Link>
        )}
      </div>
    </section>
  );
}
