import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import type { ApiClient } from "@abp/api-client";
import { useI18n } from "../i18n/i18n.tsx";
import { commercialRequest, isObject } from "./commercial-api.ts";
import { ErrorBanner, PageHeader } from "./CommercialUI.tsx";
import { localToday } from "../lib/today.ts";

/**
 * The delivery calendar: what leaves and what arrives, day by day.
 *
 * Five kinds of date share the month -- a planned dispatch, the date the
 * customer can expect the goods, what actually left, what was actually
 * delivered, and the date the customer asked for when they ordered. A date
 * that passed without the thing happening is marked late, which is the whole
 * reason to look at this screen on a Sunday morning.
 */

type Rec = Record<string, unknown>;
const text = (value: unknown): string =>
  typeof value === "string" ? value : "";

const KINDS = [
  { code: "PLANNED_DISPATCH", en: "Leaves", ar: "خروج" },
  { code: "DISPATCHED", en: "Left", ar: "خرجت" },
  { code: "EXPECTED_DELIVERY", en: "Expected at customer", ar: "وصول متوقع" },
  { code: "DELIVERED", en: "Delivered", ar: "اتسلّمت" },
  {
    code: "REQUESTED_BY_CUSTOMER",
    en: "Customer asked for",
    ar: "العميل طالبها",
  },
] as const;

const iso = (date: Date) => date.toISOString().slice(0, 10);
const utc = (year: number, month: number, day: number) =>
  new Date(Date.UTC(year, month, day));

/** The six weeks that show a month, Saturday first as the week runs in Egypt. */
function monthGrid(year: number, month: number): string[] {
  const first = utc(year, month, 1);
  const lead = (first.getUTCDay() + 1) % 7; // days back to Saturday
  const start = utc(year, month, 1 - lead);
  return Array.from({ length: 42 }, (_, index) =>
    iso(
      utc(
        start.getUTCFullYear(),
        start.getUTCMonth(),
        start.getUTCDate() + index,
      ),
    ),
  );
}

export function DeliveryCalendarPage({ client }: { client: ApiClient }) {
  const { locale } = useI18n();
  const ar = locale === "ar";
  const txt = (en: string, arabic: string) => (ar ? arabic : en);
  const today = new Date();
  // The date in Cairo, not London: just after midnight they differ.
  const todayIso = localToday();
  const [cursor, setCursor] = useState({
    year: today.getFullYear(),
    month: today.getMonth(),
  });
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [lateOnly, setLateOnly] = useState(false);
  const [selected, setSelected] = useState(todayIso);
  const days = useMemo(() => monthGrid(cursor.year, cursor.month), [cursor]);
  const from = days[0] ?? todayIso;
  const to = days[days.length - 1] ?? todayIso;

  const calendar = useQuery({
    queryKey: ["delivery-calendar", from, to],
    queryFn: async () => {
      const result = await commercialRequest(
        client,
        "GET",
        "/logistics/delivery-calendar",
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
  const all = Array.isArray(calendar.data?.events)
    ? calendar.data.events.filter(isObject)
    : [];
  const events = all.filter(
    (event) =>
      !hidden.has(text(event.kindCode)) && (!lateOnly || event.late === true),
  );
  const byDay = new Map<string, Rec[]>();
  for (const event of events) {
    const list = byDay.get(text(event.date)) ?? [];
    list.push(event);
    byDay.set(text(event.date), list);
  }
  const lateCount = all.filter((event) => event.late === true).length;
  const monthName = utc(cursor.year, cursor.month, 1).toLocaleDateString(
    ar ? "ar-EG" : "en-GB",
    {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    },
  );
  const weekdays = Array.from({ length: 7 }, (_, index) =>
    utc(2026, 0, 3 + index).toLocaleDateString(ar ? "ar-EG" : "en-GB", {
      weekday: "short",
      timeZone: "UTC",
    }),
  );
  const move = (delta: number) => {
    const next = utc(cursor.year, cursor.month + delta, 1);
    setCursor({ year: next.getUTCFullYear(), month: next.getUTCMonth() });
  };
  const label = (event: Rec) => {
    const kind = KINDS.find((one) => one.code === event.kindCode);
    return kind === undefined ? text(event.kindCode) : ar ? kind.ar : kind.en;
  };
  const target = (event: Rec) =>
    text(event.shipmentId)
      ? `/shipments/${text(event.shipmentId)}`
      : `/customer-orders/${text(event.customerOrderId)}`;
  const dayEvents = byDay.get(selected) ?? [];

  return (
    <section className="workspace-page calendar-page">
      <PageHeader
        kicker={txt("Logistics", "اللوجستيات")}
        title={txt("Delivery calendar", "تقويم التسليم")}
        {...(lateCount > 0
          ? {
              status: txt(
                `${String(lateCount)} dates this view have passed without happening`,
                `${String(lateCount)} مواعيد عدّت من غير ما تحصل`,
              ),
            }
          : {})}
        actions={
          <Link className="button-link" to="/shipments">
            {txt("Shipments", "الشحنات")}
          </Link>
        }
      />
      <div className="calendar-toolbar">
        <button
          type="button"
          onClick={() => {
            move(-1);
          }}
          aria-label={txt("Previous month", "الشهر اللي فات")}
        >
          {ar ? "→" : "←"}
        </button>
        <strong>{monthName}</strong>
        <button
          type="button"
          onClick={() => {
            move(1);
          }}
          aria-label={txt("Next month", "الشهر الجاي")}
        >
          {ar ? "←" : "→"}
        </button>
        <button
          type="button"
          className="ghost"
          onClick={() => {
            setCursor({
              year: today.getFullYear(),
              month: today.getMonth(),
            });
            setSelected(todayIso);
          }}
        >
          {txt("Today", "النهارده")}
        </button>
        <div
          className="calendar-legend"
          role="group"
          aria-label={txt("Show", "اعرض")}
        >
          {KINDS.map((kind) => (
            <label key={kind.code} className={`cal-kind kind-${kind.code}`}>
              <input
                type="checkbox"
                checked={!hidden.has(kind.code)}
                onChange={() => {
                  setHidden((current) => {
                    const next = new Set(current);
                    if (next.has(kind.code)) next.delete(kind.code);
                    else next.add(kind.code);
                    return next;
                  });
                }}
              />
              {ar ? kind.ar : kind.en}
            </label>
          ))}
          <label className="cal-kind kind-late">
            <input
              type="checkbox"
              checked={lateOnly}
              onChange={() => {
                setLateOnly(!lateOnly);
              }}
            />
            {txt("Late only", "المتأخر بس")}
          </label>
        </div>
      </div>
      <ErrorBanner
        error={calendar.error}
        retry={() => void calendar.refetch()}
      />
      <div className="calendar-layout">
        <div className="calendar-grid" role="grid" aria-label={monthName}>
          {weekdays.map((day) => (
            <div key={day} className="calendar-weekday" role="columnheader">
              {day}
            </div>
          ))}
          {days.map((day) => {
            const list = byDay.get(day) ?? [];
            const outside = Number(day.slice(5, 7)) - 1 !== cursor.month;
            return (
              <button
                key={day}
                type="button"
                role="gridcell"
                className={[
                  "calendar-day",
                  outside ? "is-outside" : "",
                  day === todayIso ? "is-today" : "",
                  day === selected ? "is-selected" : "",
                ].join(" ")}
                onClick={() => {
                  setSelected(day);
                }}
                aria-label={`${day}: ${String(list.length)}`}
              >
                <span className="calendar-date">{Number(day.slice(8))}</span>
                {list.slice(0, 3).map((event, index) => (
                  <span
                    key={`${text(event.shipmentId)}-${text(event.customerOrderId)}-${String(index)}`}
                    className={`cal-chip kind-${text(event.kindCode)}${event.late === true ? " is-late" : ""}`}
                  >
                    {text(event.shipmentRef) || text(event.orderRef)}
                  </span>
                ))}
                {list.length > 3 && (
                  <span className="cal-more">+{list.length - 3}</span>
                )}
              </button>
            );
          })}
        </div>
        <aside className="calendar-agenda panel">
          <h2>
            {new Date(`${selected}T00:00:00Z`).toLocaleDateString(
              ar ? "ar-EG" : "en-GB",
              {
                weekday: "long",
                day: "numeric",
                month: "long",
                timeZone: "UTC",
              },
            )}
          </h2>
          {dayEvents.length === 0 && (
            <p className="empty-inline">
              {txt("Nothing on this day.", "مفيش حاجة اليوم ده.")}
            </p>
          )}
          <ol>
            {dayEvents.map((event, index) => (
              <li
                key={`${text(event.kindCode)}-${String(index)}`}
                className={event.late === true ? "is-late" : ""}
              >
                <span
                  className={`cal-dot kind-${text(event.kindCode)}`}
                  aria-hidden="true"
                />
                <div>
                  <strong>
                    {label(event)}
                    {event.late === true && ` · ${txt("late", "متأخرة")}`}
                  </strong>
                  <Link to={target(event)}>
                    {[text(event.shipmentRef), text(event.orderRef)]
                      .filter(Boolean)
                      .join(" · ")}
                  </Link>
                  {text(event.accountName) && (
                    <Link
                      to={`/customers/${text(event.accountId)}`}
                      className="cal-customer"
                    >
                      {text(event.accountName)}
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </aside>
      </div>
    </section>
  );
}
