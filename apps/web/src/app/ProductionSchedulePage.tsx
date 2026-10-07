import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import type { ApiClient } from "@abp/api-client";
import { useI18n } from "../i18n/i18n.tsx";
import { formatNum } from "../lib/numbers.ts";
import { lineName } from "../lib/production.ts";
import { commercialRequest, isObject } from "./commercial-api.ts";
import { ErrorBanner, PageHeader } from "./CommercialUI.tsx";
import { localToday } from "../lib/today.ts";

/**
 * The production timeline: every run on every line, day by day, against the
 * date its customer asked for.
 *
 * A bar is a work order from its planned start to its planned end. The red
 * diamond is the customer's requested delivery date and the truck is the
 * planned dispatch of the order's shipment -- so a bar that ends past its
 * diamond is a promise the factory cannot keep, visible before it is broken.
 */

type Rec = Record<string, unknown>;
const text = (value: unknown): string =>
  typeof value === "string"
    ? value
    : typeof value === "number"
      ? String(value)
      : "";
const DAY = 86_400_000;
const iso = (time: number) => new Date(time).toISOString().slice(0, 10);
const at = (day: string) => Date.parse(`${day}T00:00:00Z`);

const STATUS: Record<string, { en: string; ar: string }> = {
  PLANNED: { en: "Planned", ar: "متخطط" },
  RELEASED: { en: "Released", ar: "اتسلّم للمصنع" },
  IN_PROGRESS: { en: "In production", ar: "في الإنتاج" },
  ON_HOLD: { en: "On hold", ar: "متوقف" },
  QC: { en: "Quality check", ar: "فحص الجودة" },
  COMPLETED: { en: "Completed", ar: "خلص" },
};

export function ProductionSchedulePage({ client }: { client: ApiClient }) {
  const { locale } = useI18n();
  const ar = locale === "ar";
  const txt = (en: string, arabic: string) => (ar ? arabic : en);
  const today = localToday();
  // Six weeks: one behind, five ahead -- what has slipped and what is coming.
  const [startDay, setStartDay] = useState(() => iso(at(today) - 7 * DAY));
  const span = 42;
  const days = useMemo(
    () =>
      Array.from({ length: span }, (_, index) =>
        iso(at(startDay) + index * DAY),
      ),
    [startDay],
  );
  const from = days[0] ?? today;
  const to = days[days.length - 1] ?? today;

  const schedule = useQuery({
    queryKey: ["production-schedule", from, to],
    queryFn: async () => {
      const result = await commercialRequest(
        client,
        "GET",
        "/operations/production-schedule",
        {
          path: {},
          query: { from, to },
        },
      );
      return isObject(result.data) && isObject(result.data.data)
        ? result.data.data
        : {};
    },
  });
  const orders = Array.isArray(schedule.data?.workOrders)
    ? schedule.data.workOrders.filter(isObject)
    : [];
  const capacity = Array.isArray(schedule.data?.capacity)
    ? schedule.data.capacity.filter(isObject)
    : [];
  const lines = [
    ...new Set(orders.map((row) => text(row.productionLineCode))),
  ].sort();
  const column = (day: string) => Math.round((at(day) - at(from)) / DAY);
  const clamp = (index: number) => Math.max(0, Math.min(span - 1, index));
  const atRisk = orders.filter(
    (row) => row.risk === "LATE_FOR_CUSTOMER" || row.risk === "OVERDUE",
  ).length;
  const shift = (weeks: number) => {
    setStartDay(iso(at(startDay) + weeks * 7 * DAY));
  };
  const todayColumn = column(today);

  return (
    <section className="workspace-page calendar-page">
      <PageHeader
        kicker={txt("Operations", "العمليات")}
        title={txt("Production timeline", "الجدول الزمني للإنتاج")}
        {...(atRisk > 0
          ? {
              status: txt(
                `${String(atRisk)} runs are behind plan or too close to the customer's date`,
                `${String(atRisk)} تشغيلات متأخرة أو قريبة من ميعاد العميل`,
              ),
            }
          : {})}
        actions={
          <Link className="button-link" to="/work-orders">
            {txt("Work orders", "أوامر الإنتاج")}
          </Link>
        }
      />
      <div className="calendar-toolbar">
        <button
          type="button"
          onClick={() => {
            shift(-2);
          }}
          aria-label={txt("Two weeks back", "أسبوعين لورا")}
        >
          {ar ? "→" : "←"}
        </button>
        <strong>
          {new Date(at(from)).toLocaleDateString(ar ? "ar-EG" : "en-GB", {
            day: "numeric",
            month: "short",
            timeZone: "UTC",
          })}
          {" – "}
          {new Date(at(to)).toLocaleDateString(ar ? "ar-EG" : "en-GB", {
            day: "numeric",
            month: "short",
            year: "numeric",
            timeZone: "UTC",
          })}
        </strong>
        <button
          type="button"
          onClick={() => {
            shift(2);
          }}
          aria-label={txt("Two weeks ahead", "أسبوعين لقدّام")}
        >
          {ar ? "←" : "→"}
        </button>
        <button
          type="button"
          className="ghost"
          onClick={() => {
            setStartDay(iso(at(today) - 7 * DAY));
          }}
        >
          {txt("Today", "النهارده")}
        </button>
        <div className="calendar-legend gantt-legend">
          {Object.entries(STATUS).map(([code, label]) => (
            <span key={code} className="cal-kind">
              <i className={`gantt-swatch wo-bar-${code}`} aria-hidden="true" />
              {ar ? label.ar : label.en}
            </span>
          ))}
          <span className="cal-kind">
            <i className="gantt-diamond" aria-hidden="true" />
            {txt("Customer's date", "ميعاد العميل")}
          </span>
          <span className="cal-kind">
            <span aria-hidden="true">🚚</span>
            {txt("Planned dispatch", "الخروج المخطط")}
          </span>
        </div>
      </div>
      {capacity.length > 0 && (
        <p className="settings-hint">
          {txt("Capacity", "الطاقة")}:{" "}
          {capacity
            .map(
              (rate) =>
                `${text(rate.categoryCode)} ${formatNum(Number(rate.boardsPerDay) || 0, ar ? "ar" : "en")} ${txt("boards/day", "لوح/يوم")}`,
            )
            .join(" · ")}
        </p>
      )}
      <ErrorBanner
        error={schedule.error}
        retry={() => void schedule.refetch()}
      />
      <div className="gantt-scroll panel">
        <div
          className="gantt"
          style={{
            gridTemplateColumns: `240px repeat(${String(span)}, minmax(26px, 1fr))`,
          }}
        >
          <div className="gantt-corner">
            {txt("Line / run", "الخط / التشغيلة")}
          </div>
          {days.map((day) => {
            const date = new Date(at(day));
            const weekend = date.getUTCDay() === 5; // Friday off
            return (
              <div
                key={day}
                className={`gantt-day${weekend ? " is-weekend" : ""}${day === today ? " is-today" : ""}`}
                title={day}
              >
                {date.getUTCDate() === 1 || day === from ? (
                  <em>
                    {date.toLocaleDateString(ar ? "ar-EG" : "en-GB", {
                      month: "short",
                      timeZone: "UTC",
                    })}
                  </em>
                ) : null}
                <span>{date.getUTCDate()}</span>
              </div>
            );
          })}
          {lines.length === 0 && (
            <div
              className="gantt-empty"
              style={{ gridColumn: `1 / span ${String(span + 1)}` }}
            >
              {txt(
                "Nothing planned in these weeks. Plan production from a confirmed order.",
                "مفيش إنتاج متخطط في الأسابيع دي. خطّط إنتاج من أوردر مؤكَّد.",
              )}
            </div>
          )}
          {lines.map((code) => (
            <LineRows
              key={code}
              code={code}
              rows={orders.filter(
                (row) => text(row.productionLineCode) === code,
              )}
              span={span}
              column={column}
              clamp={clamp}
              todayColumn={todayColumn}
              ar={ar}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function LineRows({
  code,
  rows,
  span,
  column,
  clamp,
  todayColumn,
  ar,
}: {
  code: string;
  rows: Rec[];
  span: number;
  column: (day: string) => number;
  clamp: (index: number) => number;
  todayColumn: number;
  ar: boolean;
}) {
  const txt = (en: string, arabic: string) => (ar ? arabic : en);
  return (
    <>
      <div
        className="gantt-line"
        style={{ gridColumn: `1 / span ${String(span + 1)}` }}
      >
        {lineName(code, ar)}
        <small>
          {rows.length}{" "}
          {rows.length === 1 ? txt("run", "تشغيلة") : txt("runs", "تشغيلات")}
        </small>
      </div>
      {rows.map((row, index) => {
        const start = column(text(row.plannedStartDate));
        const end = column(text(row.plannedEndDate));
        const visible = end >= 0 && start <= span - 1;
        const requested = text(row.requestedDeliveryDate);
        const requestedColumn = requested ? column(requested) : -1;
        const shipments = Array.isArray(row.shipments)
          ? row.shipments.filter(isObject)
          : [];
        const risk = text(row.risk);
        const rowNo = index;
        return (
          <div
            key={text(row.workOrderId)}
            className="gantt-row"
            style={{ gridColumn: `1 / span ${String(span + 1)}` }}
          >
            <Link
              to={`/work-orders/${text(row.workOrderId)}`}
              className="gantt-label"
            >
              <strong>{text(row.workOrderRef)}</strong>
              <span>
                {text(row.orderRef)} · {text(row.accountName)}
              </span>
            </Link>
            <div
              className="gantt-track"
              style={{
                gridTemplateColumns: `repeat(${String(span)}, minmax(26px, 1fr))`,
              }}
            >
              {todayColumn >= 0 && todayColumn < span && (
                <i
                  className="gantt-today"
                  style={{ gridColumn: String(todayColumn + 1) }}
                  aria-hidden="true"
                />
              )}
              {visible && (
                <Link
                  to={`/work-orders/${text(row.workOrderId)}`}
                  className={`gantt-bar wo-bar-${text(row.statusCode)}${risk === "LATE_FOR_CUSTOMER" || risk === "OVERDUE" ? " is-risk" : ""}${row.overlapsOnLine === true ? " is-overlap" : ""}`}
                  style={{
                    gridColumn: `${String(clamp(start) + 1)} / ${String(clamp(end) + 2)}`,
                    animationDelay: `${String(rowNo * 40)}ms`,
                  }}
                  title={`${text(row.workOrderRef)} · ${text(row.plannedStartDate)} → ${text(row.plannedEndDate)} · ${text(row.quantityPlanned)}`}
                >
                  <span>
                    {formatNum(
                      Number(row.quantityPlanned) || 0,
                      ar ? "ar" : "en",
                    )}{" "}
                    {txt("boards", "لوح")}
                  </span>
                </Link>
              )}
              {requestedColumn >= 0 && requestedColumn < span && (
                <i
                  className="gantt-diamond on-track"
                  style={{ gridColumn: String(requestedColumn + 1) }}
                  title={`${txt("Customer asked for", "العميل طالب")} ${requested}`}
                />
              )}
              {shipments.map((one) => {
                const dispatch = text(one.plannedDispatchDate);
                const dispatchColumn = dispatch ? column(dispatch) : -1;
                return dispatchColumn >= 0 && dispatchColumn < span ? (
                  <Link
                    key={text(one.shipmentId)}
                    to={`/shipments/${text(one.shipmentId)}`}
                    className="gantt-truck"
                    style={{ gridColumn: String(dispatchColumn + 1) }}
                    title={`${text(one.shipmentRef)} · ${dispatch}`}
                  >
                    🚚
                  </Link>
                ) : null;
              })}
            </div>
          </div>
        );
      })}
    </>
  );
}
