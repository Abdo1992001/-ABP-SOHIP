import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import type { ApiClient } from "@abp/api-client";
import type { Me } from "../api/customer-api.ts";
import { useI18n } from "../i18n/i18n.tsx";
import { formatNum } from "../lib/numbers.ts";
import {
  BOARD_CATEGORIES,
  PRODUCTION_LINES,
  lineName,
} from "../lib/production.ts";
import { commercialRequest, isObject, rows } from "./commercial-api.ts";
import {
  ErrorBanner,
  PageHeader,
  SlideOver,
  useToast,
} from "./CommercialUI.tsx";
import { localToday } from "../lib/today.ts";

/**
 * Work orders: the factory's runs for customer orders.
 *
 * A run is planned on a line; its length comes from the board category's
 * capacity rate. It is released to the floor, started, checked and completed
 * -- and the customer order follows it, so sales sees "in production" and
 * "ready" without asking the factory.
 */

type Rec = Record<string, unknown>;
const text = (value: unknown): string =>
  typeof value === "string"
    ? value
    : typeof value === "number"
      ? String(value)
      : "";

const STATUS: Record<string, { en: string; ar: string }> = {
  PLANNED: { en: "Planned", ar: "متخطط" },
  RELEASED: { en: "Released", ar: "اتسلّم للمصنع" },
  IN_PROGRESS: { en: "In production", ar: "في الإنتاج" },
  ON_HOLD: { en: "On hold", ar: "متوقف" },
  QC: { en: "Quality check", ar: "فحص الجودة" },
  COMPLETED: { en: "Completed", ar: "خلص" },
  CANCELLED: { en: "Cancelled", ar: "ملغي" },
};
const MOVE: Record<string, { en: string; ar: string }> = {
  RELEASED: { en: "Release to the floor", ar: "سلّمه للمصنع" },
  IN_PROGRESS: { en: "Start production", ar: "ابدأ الإنتاج" },
  ON_HOLD: { en: "Put on hold", ar: "وقّفه" },
  QC: { en: "Send to quality check", ar: "ابعته لفحص الجودة" },
  COMPLETED: { en: "Pass quality check", ar: "الفحص نجح" },
  CANCELLED: { en: "Cancel", ar: "إلغاء" },
};
const RISK: Record<string, { en: string; ar: string }> = {
  LATE_FOR_CUSTOMER: {
    en: "Tight for the customer's date",
    ar: "قريب من ميعاد العميل",
  },
  OVERDUE: { en: "Behind plan", ar: "متأخر عن الخطة" },
};

function useText() {
  const { locale } = useI18n();
  const ar = locale === "ar";
  return {
    ar,
    txt: (en: string, arabic: string) => (ar ? arabic : en),
    status: (code: unknown) => {
      const found = STATUS[text(code)];
      return found === undefined ? text(code) : ar ? found.ar : found.en;
    },
    line: (code: unknown) => lineName(code, ar),
    num: (value: unknown) => formatNum(Number(value) || 0, ar ? "ar" : "en"),
    date: (value: unknown) =>
      text(value)
        ? new Date(
            text(value).length === 10 ? `${text(value)}T00:00:00` : text(value),
          ).toLocaleDateString(ar ? "ar-EG" : "en-GB")
        : "—",
  };
}

export function WorkOrdersPage({ client, me }: { client: ApiClient; me: Me }) {
  const { txt, status, line, num, date, ar } = useText();
  const { workOrderId } = useParams();
  const navigate = useNavigate();
  const cache = useQueryClient();
  const toast = useToast();
  const [filter, setFilter] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [planning, setPlanning] = useState(false);
  const canPlan = me.access.permissions.includes("work-orders.manage");

  const list = useQuery({
    queryKey: ["work-orders", filter, search, page],
    queryFn: async () => {
      const query: Record<string, string | number> = { page, limit: 25 };
      if (filter) query.status = filter;
      if (search) query.search = search;
      const result = await commercialRequest(client, "GET", "/work-orders", {
        path: {},
        query,
      });
      const meta =
        isObject(result.data) && isObject(result.data.meta)
          ? result.data.meta
          : {};
      return {
        rows: rows(result.data),
        hasNext: meta.hasNext === true,
        total: Number(meta.total) || 0,
      };
    },
  });

  return (
    <section className="workspace-page shipments-page">
      <PageHeader
        kicker={txt("Operations", "العمليات")}
        title={txt("Work orders", "أوامر الإنتاج")}
        {...(list.data === undefined ? {} : { count: list.data.total })}
        actions={
          <>
            <Link className="button-link" to="/operations/production-schedule">
              {txt("Production timeline", "الجدول الزمني للإنتاج")}
            </Link>
            {canPlan && (
              <button
                type="button"
                className="primary"
                onClick={() => {
                  setPlanning(true);
                }}
              >
                {txt("+ Plan production", "+ تخطيط إنتاج")}
              </button>
            )}
          </>
        }
      />
      <div
        className="orders-filters"
        role="group"
        aria-label={txt("Status", "الحالة")}
      >
        {["", ...Object.keys(STATUS)].map((code) => (
          <button
            key={code || "ALL"}
            type="button"
            className={filter === code ? "is-active" : ""}
            aria-pressed={filter === code}
            onClick={() => {
              setFilter(code);
              setPage(1);
            }}
          >
            {code === "" ? txt("All", "الكل") : status(code)}
          </button>
        ))}
      </div>
      <input
        type="search"
        aria-label={txt("Search work orders", "بحث أوامر الإنتاج")}
        placeholder={txt(
          "Search by work order, order or customer",
          "ابحث برقم أمر الإنتاج أو الأوردر أو العميل",
        )}
        value={search}
        onChange={(event) => {
          setSearch(event.target.value);
          setPage(1);
        }}
      />
      <ErrorBanner error={list.error} retry={() => void list.refetch()} />
      <div className="panel">
        <div className="enterprise-table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>{txt("Work order", "أمر الإنتاج")}</th>
                <th>{txt("Order", "الأوردر")}</th>
                <th>{txt("Customer", "العميل")}</th>
                <th>{txt("Line", "الخط")}</th>
                <th className="numeric">{txt("Boards", "الألواح")}</th>
                <th>{txt("Status", "الحالة")}</th>
                <th>{txt("Planned", "المخطط")}</th>
                <th>{txt("Customer date", "ميعاد العميل")}</th>
              </tr>
            </thead>
            <tbody>
              {list.data?.rows.map((row) => (
                <tr key={text(row.workOrderId)}>
                  <td>
                    <Link to={`/work-orders/${text(row.workOrderId)}`}>
                      {text(row.workOrderRef)}
                    </Link>
                  </td>
                  <td>
                    <Link to={`/customer-orders/${text(row.customerOrderId)}`}>
                      {text(row.orderRef)}
                    </Link>
                  </td>
                  <td>
                    <Link to={`/customers/${text(row.accountId)}`}>
                      {text(row.accountName)}
                    </Link>
                  </td>
                  <td>{line(row.productionLineCode)}</td>
                  <td className="numeric">
                    {num(row.quantityProduced)} / {num(row.quantityPlanned)}
                  </td>
                  <td>
                    <span className={`wo-status wo-${text(row.statusCode)}`}>
                      {status(row.statusCode)}
                    </span>
                    {RISK[text(row.risk)] && (
                      <small className={`wo-risk risk-${text(row.risk)}`}>
                        {ar
                          ? RISK[text(row.risk)]?.ar
                          : RISK[text(row.risk)]?.en}
                      </small>
                    )}
                  </td>
                  <td>
                    {date(row.plannedStartDate)} → {date(row.plannedEndDate)}
                  </td>
                  <td>{date(row.requestedDeliveryDate)}</td>
                </tr>
              ))}
              {list.data?.rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="table-empty">
                    {txt(
                      "No work orders here. Plan production for a confirmed order.",
                      "مفيش أوامر إنتاج هنا. خطّط إنتاج لأوردر مؤكَّد.",
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <footer className="pagination">
          <button
            disabled={page === 1}
            onClick={() => {
              setPage(page - 1);
            }}
          >
            {txt("Previous", "السابق")}
          </button>
          <span>{page}</span>
          <button
            disabled={!list.data?.hasNext}
            onClick={() => {
              setPage(page + 1);
            }}
          >
            {txt("Next", "التالي")}
          </button>
        </footer>
      </div>
      {planning && (
        <WorkOrderPlanDialog
          client={client}
          onClose={() => {
            setPlanning(false);
          }}
          onPlanned={async (id) => {
            setPlanning(false);
            await cache.invalidateQueries({ queryKey: ["work-orders"] });
            toast.success(txt("Production planned", "الإنتاج اتخطط"));
            void navigate(`/work-orders/${id}`);
          }}
        />
      )}
      {workOrderId && (
        <WorkOrderDetail
          client={client}
          id={workOrderId}
          onClose={() => void navigate("/work-orders")}
        />
      )}
    </section>
  );
}

export function WorkOrderPlanDialog({
  client,
  customerOrderId,
  onClose,
  onPlanned,
}: {
  client: ApiClient;
  customerOrderId?: string;
  onClose: () => void;
  onPlanned: (workOrderId: string) => Promise<void>;
}) {
  const { txt, ar, num } = useText();
  const [orderId, setOrderId] = useState(customerOrderId ?? "");
  const [lineCode, setLineCode] = useState("LINE_1");
  const [category, setCategory] = useState("STANDARD");
  const [quantity, setQuantity] = useState("");
  const [start, setStart] = useState(localToday());
  const [end, setEnd] = useState("");
  const [priority, setPriority] = useState("NORMAL");
  const [notes, setNotes] = useState("");

  const orders = useQuery({
    queryKey: ["customer-orders", "producible"],
    enabled: customerOrderId === undefined,
    queryFn: async () =>
      rows(
        (
          await commercialRequest(client, "GET", "/customer-orders", {
            path: {},
            query: { page: 1, limit: 200 },
          })
        ).data,
      ).filter((row) =>
        ["CONFIRMED", "IN_PRODUCTION"].includes(text(row.statusCode)),
      ),
  });
  const order = useQuery({
    queryKey: ["customer-order", orderId],
    enabled: orderId !== "",
    queryFn: async () => {
      const result = await commercialRequest(
        client,
        "GET",
        "/customer-orders/{customerOrderId}",
        {
          path: { customerOrderId: orderId },
        },
      );
      return isObject(result.data) && isObject(result.data.data)
        ? result.data.data
        : {};
    },
  });
  const rates = useQuery({
    queryKey: ["capacity-rates"],
    queryFn: async () =>
      rows(
        (
          await commercialRequest(client, "GET", "/capacity/rates", {
            path: {},
          })
        ).data,
      ),
    staleTime: 10 * 60_000,
    // Planners without the capacity screen still plan; the server holds the rates.
    retry: false,
  });
  const fromRates = [
    ...new Set(
      (rates.data ?? []).map((row) => text(row.categoryCode)).filter(Boolean),
    ),
  ];
  const categories = fromRates.length > 0 ? fromRates : [...BOARD_CATEGORIES];
  const boards = Array.isArray(order.data?.lines)
    ? order.data.lines
        .filter(isObject)
        .reduce((sum, row) => sum + (Number(row.quantity) || 0), 0)
    : 0;
  const rate = rates.data?.find(
    (row) =>
      row.categoryCode === category &&
      (row.statusCode === undefined || row.statusCode === "ACTIVE"),
  );
  const perDay = Number(rate?.boardsPerDay) || 0;
  const runBoards = Number(quantity) || boards;
  const days =
    perDay > 0 && runBoards > 0
      ? Math.max(1, Math.ceil(runBoards / perDay))
      : 0;
  const autoEnd =
    days > 0
      ? new Date(Date.parse(`${start}T00:00:00Z`) + (days - 1) * 86_400_000)
          .toISOString()
          .slice(0, 10)
      : "";
  const requested = text(order.data?.requestedDeliveryDate);
  const finish = end || autoEnd;

  const plan = useMutation({
    mutationFn: async () => {
      const body: Record<string, string> = {
        customerOrderId: orderId,
        productionLineCode: lineCode,
        capacityCategoryCode: category,
        plannedStartDate: start,
        priorityCode: priority,
      };
      if (quantity.trim()) body.quantityPlanned = quantity.trim();
      if (end) body.plannedEndDate = end;
      if (notes.trim()) body.notes = notes.trim();
      const result = await commercialRequest(client, "POST", "/work-orders", {
        path: {},
        body,
        idempotencyKey: crypto.randomUUID(),
      });
      const data =
        isObject(result.data) && isObject(result.data.data)
          ? result.data.data
          : {};
      return text(data.workOrderId);
    },
    onSuccess: (id) => onPlanned(id),
  });

  return (
    <SlideOver title={txt("Plan production", "تخطيط إنتاج")} onClose={onClose}>
      <form
        className="orders-amend"
        onSubmit={(event) => {
          event.preventDefault();
          plan.mutate();
        }}
      >
        {customerOrderId === undefined && (
          <label>
            {txt("Customer order", "أمر البيع")}
            <select
              value={orderId}
              onChange={(event) => {
                setOrderId(event.target.value);
              }}
            >
              <option value="">{txt("Choose…", "اختار…")}</option>
              {orders.data?.map((row) => (
                <option
                  key={text(row.customerOrderId)}
                  value={text(row.customerOrderId)}
                >
                  {text(row.orderRef)} · {text(row.accountName)}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="shipment-plan-dates">
          <label>
            {txt("Production line", "خط الإنتاج")}
            <select
              value={lineCode}
              onChange={(event) => {
                setLineCode(event.target.value);
              }}
            >
              {PRODUCTION_LINES.map((one) => (
                <option key={one.code} value={one.code}>
                  {ar ? one.ar : one.en}
                </option>
              ))}
            </select>
          </label>
          <label>
            {txt("Board category", "تصنيف الألواح")}
            <select
              value={category}
              onChange={(event) => {
                setCategory(event.target.value);
              }}
            >
              {categories.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          {txt("Boards in this run", "عدد الألواح في التشغيلة")}
          <input
            inputMode="decimal"
            value={quantity}
            placeholder={
              boards > 0
                ? `${num(boards)} — ${txt("the whole order", "الأوردر كله")}`
                : ""
            }
            onChange={(event) => {
              setQuantity(event.target.value);
            }}
          />
        </label>
        <div className="shipment-plan-dates">
          <label>
            {txt("Starts", "البداية")}
            <input
              type="date"
              value={start}
              onChange={(event) => {
                setStart(event.target.value);
              }}
            />
          </label>
          <label>
            {txt("Ends", "النهاية")}
            <input
              type="date"
              value={end || autoEnd}
              min={start}
              onChange={(event) => {
                setEnd(event.target.value);
              }}
            />
          </label>
        </div>
        {days > 0 && (
          <p className="settings-hint">
            {txt(
              `${num(runBoards)} boards at ${num(perDay)} a day (${category}) is ${String(days)} day${days === 1 ? "" : "s"} of production.`,
              `${num(runBoards)} لوح بمعدل ${num(perDay)} في اليوم (${category}) = ${String(days)} يوم إنتاج.`,
            )}
          </p>
        )}
        {requested && finish && finish > requested && (
          <p className="form-error">
            {txt(
              `This finishes after the date the customer asked for (${requested}).`,
              `ده هيخلص بعد الميعاد اللي العميل طلبه (${requested}).`,
            )}
          </p>
        )}
        <label>
          {txt("Priority", "الأولوية")}
          <select
            value={priority}
            onChange={(event) => {
              setPriority(event.target.value);
            }}
          >
            <option value="LOW">{txt("Low", "منخفضة")}</option>
            <option value="NORMAL">{txt("Normal", "عادية")}</option>
            <option value="HIGH">{txt("High", "عالية")}</option>
            <option value="URGENT">{txt("Urgent", "عاجلة")}</option>
          </select>
        </label>
        <label>
          {txt("Notes for the floor", "ملاحظات للمصنع")}
          <textarea
            value={notes}
            maxLength={2000}
            onChange={(event) => {
              setNotes(event.target.value);
            }}
          />
        </label>
        <ErrorBanner
          error={plan.error}
          retry={() => {
            plan.mutate();
          }}
        />
        <button className="primary" disabled={orderId === "" || plan.isPending}>
          {plan.isPending ? "…" : txt("Plan production", "خطّط الإنتاج")}
        </button>
      </form>
    </SlideOver>
  );
}

function WorkOrderDetail({
  client,
  id,
  onClose,
}: {
  client: ApiClient;
  id: string;
  onClose: () => void;
}) {
  const { txt, status, line, num, date, ar } = useText();
  const cache = useQueryClient();
  const toast = useToast();
  const [moving, setMoving] = useState<string | null>(null);
  const detail = useQuery({
    queryKey: ["work-order", id],
    queryFn: async () => {
      const result = await commercialRequest(
        client,
        "GET",
        "/work-orders/{workOrderId}",
        {
          path: { workOrderId: id },
        },
      );
      return isObject(result.data) && isObject(result.data.data)
        ? result.data.data
        : {};
    },
  });
  const row = detail.data ?? {};
  const moves = Array.isArray(row.allowedTransitions)
    ? row.allowedTransitions.filter(
        (value): value is string => typeof value === "string",
      )
    : [];
  const events = Array.isArray(row.events) ? row.events.filter(isObject) : [];
  const route = ["PLANNED", "RELEASED", "IN_PROGRESS", "QC", "COMPLETED"];
  const at = route.indexOf(text(row.statusCode));

  return (
    <SlideOver
      title={text(row.workOrderRef) || txt("Work order", "أمر إنتاج")}
      onClose={onClose}
      width={860}
    >
      <ErrorBanner error={detail.error} retry={() => void detail.refetch()} />
      {detail.data && (
        <div className="complaint-detail">
          <ol
            className="complaint-route"
            style={{ gridTemplateColumns: "repeat(5, minmax(0, 1fr))" }}
          >
            {route.map((code, index) => (
              <li
                key={code}
                className={
                  index < at ? "is-done" : index === at ? "is-current" : ""
                }
              >
                <strong>{status(code)}</strong>
              </li>
            ))}
          </ol>
          {(row.statusCode === "ON_HOLD" || row.statusCode === "CANCELLED") && (
            <p className="complaint-now is-late">
              {status(row.statusCode)}:{" "}
              {text(row.holdReason) || text(row.cancelReason)}
            </p>
          )}
          {Array.isArray(row.overlaps) && row.overlaps.length > 0 && (
            <p className="complaint-now is-late">
              {txt("Shares its line with", "بيتداخل على نفس الخط مع")}{" "}
              {row.overlaps
                .filter(isObject)
                .map(
                  (one) =>
                    `${text(one.workOrderRef)} (${text(one.plannedStartDate)} → ${text(one.plannedEndDate)})`,
                )
                .join(" · ")}
              {" — "}
              {txt(
                "reschedule one of them or move it to another line.",
                "غيّر ميعاد واحد منهم أو انقله لخط تاني.",
              )}
            </p>
          )}
          {RISK[text(row.risk)] && (
            <p className="complaint-now is-late">
              {ar ? RISK[text(row.risk)]?.ar : RISK[text(row.risk)]?.en} —{" "}
              {txt("customer asked for", "العميل طالب")}{" "}
              {date(row.requestedDeliveryDate)}
            </p>
          )}
          {moves.length > 0 && (
            <div className="complaint-moves">
              {moves.map((to) => (
                <button
                  key={to}
                  type="button"
                  className={
                    to === "CANCELLED" || to === "ON_HOLD" ? "ghost" : "primary"
                  }
                  onClick={() => {
                    setMoving(to);
                  }}
                >
                  {row.statusCode === "QC" && to === "IN_PROGRESS"
                    ? txt(
                        "Fail — back to production",
                        "الفحص فشل — رجّعه للإنتاج",
                      )
                    : row.statusCode === "ON_HOLD" && to === "IN_PROGRESS"
                      ? txt("Resume", "كمّل")
                      : ar
                        ? MOVE[to]?.ar
                        : MOVE[to]?.en}
                </button>
              ))}
            </div>
          )}
          <dl className="quotation-fact-grid">
            <div>
              <dt>{txt("Order", "الأوردر")}</dt>
              <dd>
                <Link to={`/customer-orders/${text(row.customerOrderId)}`}>
                  {text(row.orderRef)}
                </Link>
              </dd>
            </div>
            <div>
              <dt>{txt("Customer", "العميل")}</dt>
              <dd>
                <Link to={`/customers/${text(row.accountId)}`}>
                  {text(row.accountName)}
                </Link>
              </dd>
            </div>
            <div>
              <dt>{txt("Line", "الخط")}</dt>
              <dd>
                {line(row.productionLineCode)} ·{" "}
                {text(row.capacityCategoryCode)}
              </dd>
            </div>
            <div>
              <dt>{txt("Boards", "الألواح")}</dt>
              <dd>
                {num(row.quantityProduced)} / {num(row.quantityPlanned)}
                {Number(row.quantityRejected) > 0 &&
                  ` · ${num(row.quantityRejected)} ${txt("rejected", "مرفوض")}`}
              </dd>
            </div>
            <div>
              <dt>{txt("Planned", "المخطط")}</dt>
              <dd>
                {date(row.plannedStartDate)} → {date(row.plannedEndDate)}
              </dd>
            </div>
            <div>
              <dt>{txt("Actual", "الفعلي")}</dt>
              <dd>
                {text(row.actualStartAt) ? date(row.actualStartAt) : "—"}
                {text(row.actualEndAt) && ` → ${date(row.actualEndAt)}`}
              </dd>
            </div>
            <div>
              <dt>{txt("Rate", "المعدل")}</dt>
              <dd>
                {Number(row.boardsPerDay) > 0
                  ? `${num(row.boardsPerDay)} ${txt("boards / day", "لوح / يوم")}`
                  : "—"}
              </dd>
            </div>
            <div>
              <dt>{txt("Quality check", "فحص الجودة")}</dt>
              <dd>
                {text(row.qcResultCode)
                  ? `${text(row.qcResultCode)} · ${text(row.qcByName)}${text(row.qcNotes) ? ` — ${text(row.qcNotes)}` : ""}`
                  : "—"}
              </dd>
            </div>
          </dl>
          {text(row.notes) && (
            <p className="complaint-description">{text(row.notes)}</p>
          )}
          <section className="complaint-history">
            <h3>{txt("History", "السجل")}</h3>
            <ol>
              {events.map((event) => (
                <li key={text(event.eventId)}>
                  <time>
                    {new Date(text(event.createdAt)).toLocaleString(
                      ar ? "ar-EG" : "en-GB",
                    )}
                  </time>
                  <strong>
                    {text(event.eventCode) === "PLANNED"
                      ? txt("Planned", "اتخطط")
                      : text(event.eventCode) === "RESCHEDULED"
                        ? txt("Rescheduled", "اتعدّل ميعاده")
                        : `${status(event.fromStatusCode)} → ${status(event.toStatusCode)}`}
                  </strong>
                  <span>{text(event.actorName)}</span>
                  {text(event.note) && <em>{text(event.note)}</em>}
                </li>
              ))}
            </ol>
          </section>
        </div>
      )}
      {moving && (
        <MoveDialog
          client={client}
          row={row}
          to={moving}
          onClose={() => {
            setMoving(null);
          }}
          onDone={async () => {
            setMoving(null);
            await cache.invalidateQueries({ queryKey: ["work-order", id] });
            await cache.invalidateQueries({ queryKey: ["work-orders"] });
            await cache.invalidateQueries({ queryKey: ["customer-order"] });
            await cache.invalidateQueries({
              queryKey: ["production-schedule"],
            });
            toast.success(txt("Recorded", "اتسجّل"));
          }}
        />
      )}
    </SlideOver>
  );
}

function MoveDialog({
  client,
  row,
  to,
  onClose,
  onDone,
}: {
  client: ApiClient;
  row: Rec;
  to: string;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const { txt, status } = useText();
  const from = text(row.statusCode);
  const [values, setValues] = useState<Record<string, string>>({
    qcResultCode: from === "QC" ? (to === "COMPLETED" ? "PASS" : "FAIL") : "",
    quantityProduced: to === "QC" ? text(row.quantityPlanned) : "",
  });
  const set = (field: string) => (event: { target: { value: string } }) => {
    setValues((current) => ({ ...current, [field]: event.target.value }));
  };
  const value = (field: string) => values[field] ?? "";
  const needsReason = to === "CANCELLED" || to === "ON_HOLD";
  const needsNotes = from === "QC" && value("qcResultCode") !== "PASS";
  const send = useMutation({
    mutationFn: () => {
      const body: Record<string, string> = {
        expectedRowVersion: text(row.rowVersion),
        targetStatusCode: to,
      };
      for (const field of [
        "reason",
        "quantityProduced",
        "quantityRejected",
        "qcResultCode",
        "qcNotes",
      ]) {
        const entry = value(field).trim();
        if (entry !== "") body[field] = entry;
      }
      return commercialRequest(
        client,
        "POST",
        "/work-orders/{workOrderId}/transitions",
        {
          path: { workOrderId: text(row.workOrderId) },
          body,
          idempotencyKey: crypto.randomUUID(),
        },
      );
    },
    onSuccess: () => onDone(),
  });
  const missing =
    (needsReason && value("reason").trim().length < 3) ||
    (to === "QC" && !value("quantityProduced").trim()) ||
    (needsNotes && value("qcNotes").trim().length < 3);
  return (
    <SlideOver title={`${status(from)} → ${status(to)}`} onClose={onClose}>
      <form
        className="orders-amend"
        onSubmit={(event) => {
          event.preventDefault();
          send.mutate();
        }}
      >
        {to === "QC" && (
          <>
            <label>
              {txt("Boards produced", "الألواح اللي اتنتجت")}
              <input
                inputMode="decimal"
                value={value("quantityProduced")}
                onChange={set("quantityProduced")}
              />
            </label>
            <label>
              {txt("Boards rejected on the line", "الألواح المرفوضة على الخط")}
              <input
                inputMode="decimal"
                value={value("quantityRejected")}
                onChange={set("quantityRejected")}
              />
            </label>
          </>
        )}
        {from === "QC" && (
          <>
            <label>
              {txt("Result", "النتيجة")}
              <select
                value={value("qcResultCode")}
                onChange={set("qcResultCode")}
              >
                {to === "COMPLETED" ? (
                  <>
                    <option value="PASS">{txt("Pass", "ناجح")}</option>
                    <option value="CONDITIONAL">
                      {txt("Pass with remarks", "ناجح بملاحظات")}
                    </option>
                  </>
                ) : (
                  <option value="FAIL">
                    {txt("Fail — rework", "فاشل — إعادة تشغيل")}
                  </option>
                )}
              </select>
            </label>
            <label>
              {needsNotes
                ? txt("What was found", "اتلاقى إيه")
                : txt("Notes (optional)", "ملاحظات (اختياري)")}
              <textarea
                value={value("qcNotes")}
                maxLength={2000}
                onChange={set("qcNotes")}
              />
            </label>
          </>
        )}
        {needsReason && (
          <label>
            {txt("Why", "السبب")}
            <textarea
              value={value("reason")}
              maxLength={500}
              onChange={set("reason")}
            />
          </label>
        )}
        {!needsReason && to !== "QC" && from !== "QC" && (
          <p className="settings-hint">
            {txt(
              "Nothing else is needed for this step.",
              "مش محتاجة حاجة تانية.",
            )}
          </p>
        )}
        <ErrorBanner
          error={send.error}
          retry={() => {
            send.mutate();
          }}
        />
        <button
          className={to === "CANCELLED" ? "danger" : "primary"}
          disabled={send.isPending || missing}
        >
          {send.isPending ? "…" : txt("Record", "سجّل")}
        </button>
      </form>
    </SlideOver>
  );
}
