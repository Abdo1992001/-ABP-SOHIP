import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import type { ApiClient } from "@abp/api-client";
import type { Me } from "../api/customer-api.ts";
import { enumLabel } from "../i18n/enum-labels.ts";
import { useI18n } from "../i18n/i18n.tsx";
import { formatNum } from "../lib/numbers.ts";
import { lineName } from "../lib/production.ts";
import { dueText } from "../lib/receivables.ts";
import { commercialRequest, isObject, rows } from "./commercial-api.ts";
import { ShipmentPlanDialog } from "./ShipmentPlanDialog.tsx";
import { WorkOrderPlanDialog } from "./WorkOrdersPage.tsx";
import {
  ErrorBanner,
  PageHeader,
  SlideOver,
  StatusChip,
  useToast,
} from "./CommercialUI.tsx";
import { OrderConfirmationButton } from "./OrderConfirmationDialog.tsx";

/**
 * Customer orders: what the customer agreed to, booked from the accepted
 * quotation and carried from confirmation to hand-over.
 *
 * Imported ERP orders keep their own screen; these are the CRM's orders, and
 * the stages across the top are the questions asked about one: is it
 * confirmed, is it being made, is it ready, has it left.
 */

const STAGES = [
  "DRAFT",
  "CONFIRMED",
  "IN_PRODUCTION",
  "READY",
  "HANDED_OVER",
  "CLOSED",
] as const;

/** What the button that moves an order there says. */
const ACTION_LABEL: Record<string, { en: string; ar: string }> = {
  CONFIRMED: { en: "Confirm order", ar: "تأكيد الأوردر" },
  IN_PRODUCTION: { en: "Start production", ar: "بدء الإنتاج" },
  READY: { en: "Mark ready", ar: "جاهز للتسليم" },
  HANDED_OVER: { en: "Hand over", ar: "تسليم" },
  CLOSED: { en: "Close order", ar: "قفل الأوردر" },
  CANCELLED: { en: "Cancel order", ar: "إلغاء الأوردر" },
};

type Rec = Record<string, unknown>;
const text = (value: unknown): string =>
  typeof value === "string"
    ? value
    : typeof value === "number"
      ? String(value)
      : "";
const num = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export function CustomerOrdersPage({
  client,
  me,
}: {
  client: ApiClient;
  me: Me;
}) {
  const { customerOrderId } = useParams();
  return customerOrderId ? (
    <OrderDetail client={client} me={me} id={customerOrderId} />
  ) : (
    <OrderList client={client} me={me} />
  );
}

function useText() {
  const { locale } = useI18n();
  const ar = locale === "ar";
  return {
    locale,
    txt: (en: string, arabic: string) => (ar ? arabic : en),
    status: (code: string) => enumLabel(code, locale),
    money: (value: unknown, currency?: string) =>
      `${formatNum(num(value), locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${currency ? ` ${currency}` : ""}`,
  };
}

function OrderList({ client, me }: { client: ApiClient; me: Me }) {
  const { txt, status, money } = useText();
  const navigate = useNavigate();
  const cache = useQueryClient();
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<string>("");
  const [booking, setBooking] = useState(false);
  const canCreate = me.access.permissions.includes("sales-orders.create");

  const list = useQuery({
    queryKey: ["customer-orders", page, search, filter],
    queryFn: async () => {
      const query: Record<string, string | number> = { page, limit: 25 };
      if (search) query.search = search;
      if (filter) query.status = filter;
      const result = await commercialRequest(
        client,
        "GET",
        "/customer-orders",
        {
          path: {},
          query,
        },
      );
      const meta =
        isObject(result.data) && isObject(result.data.meta)
          ? result.data.meta
          : {};
      return {
        rows: rows(result.data),
        hasNext: meta.hasNext === true,
        total: num(meta.total),
      };
    },
  });

  return (
    <section className="workspace-page customer-orders">
      <PageHeader
        kicker={txt("Sales", "المبيعات")}
        title={txt("Customer orders", "أوامر البيع")}
        {...(list.data === undefined ? {} : { count: list.data.total })}
        actions={
          canCreate && (
            <button
              type="button"
              className="primary"
              onClick={() => {
                setBooking(true);
              }}
            >
              {txt("+ Book order", "+ حجز أوردر")}
            </button>
          )
        }
      />
      <div
        className="orders-filters"
        role="group"
        aria-label={txt("Status", "الحالة")}
      >
        {["", ...STAGES, "CANCELLED"].map((code) => (
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
        aria-label={txt("Search orders", "بحث الأوردرات")}
        placeholder={txt(
          "Search by order number, customer or PO",
          "ابحث برقم الأوردر أو العميل أو أمر الشراء",
        )}
        value={search}
        onChange={(event) => {
          setSearch(event.target.value);
          setPage(1);
        }}
      />
      <ErrorBanner error={list.error} retry={() => void list.refetch()} />
      <div className="panel">
        <table className="data-table">
          <thead>
            <tr>
              <th>{txt("Order", "الأوردر")}</th>
              <th>{txt("Customer", "العميل")}</th>
              <th>{txt("Quotation", "عرض السعر")}</th>
              <th>{txt("Status", "الحالة")}</th>
              <th>{txt("Customer PO", "أمر الشراء")}</th>
              <th>{txt("Delivery", "التسليم")}</th>
              <th className="numeric">{txt("Total", "الإجمالي")}</th>
            </tr>
          </thead>
          <tbody>
            {list.data?.rows.map((row) => (
              <tr key={text(row.customerOrderId)}>
                <td>
                  <Link to={`/customer-orders/${text(row.customerOrderId)}`}>
                    {text(row.orderRef)}
                  </Link>
                </td>
                <td>{text(row.accountName)}</td>
                <td>
                  <Link to={`/quotations/${text(row.quotationId)}`}>
                    {text(row.quotationRef)}
                  </Link>
                </td>
                <td>
                  <StatusChip code={text(row.statusCode)} />
                </td>
                <td>{text(row.customerPoNumber) || "—"}</td>
                <td>{text(row.requestedDeliveryDate) || "—"}</td>
                <td className="numeric">
                  {money(row.totalAmount, text(row.currencyCode))}
                </td>
              </tr>
            ))}
            {list.data?.rows.length === 0 && (
              <tr>
                <td colSpan={7} className="table-empty">
                  {txt(
                    "No orders yet. Book one from an accepted quotation.",
                    "مفيش أوردرات لسه. احجز أوردر من عرض سعر متقبَل.",
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {list.isLoading && (
          <div className="skeleton-stack" role="status">
            <span />
            <span />
            <span />
          </div>
        )}
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
      {booking && (
        <BookOrder
          client={client}
          onClose={() => {
            setBooking(false);
          }}
          onBooked={async (id) => {
            setBooking(false);
            await cache.invalidateQueries({ queryKey: ["customer-orders"] });
            toast.success(txt("Order booked", "تم حجز الأوردر"));
            void navigate(`/customer-orders/${id}`);
          }}
        />
      )}
    </section>
  );
}

function BookOrder({
  client,
  onClose,
  onBooked,
}: {
  client: ApiClient;
  onClose: () => void;
  onBooked: (id: string) => Promise<void>;
}) {
  const { txt, money, locale } = useText();
  const [quotationId, setQuotationId] = useState("");
  const [po, setPo] = useState("");
  const [delivery, setDelivery] = useState("");
  const [notes, setNotes] = useState("");
  const [override, setOverride] = useState("");
  const bookable = useQuery({
    queryKey: ["customer-orders", "bookable"],
    queryFn: async () =>
      rows(
        (await commercialRequest(client, "GET", "/customer-orders/bookable"))
          .data,
      ),
  });
  const book = useMutation({
    mutationFn: async () => {
      const body: Rec = { quotationId };
      if (po.trim()) body.customerPoNumber = po.trim();
      if (delivery) body.requestedDeliveryDate = delivery;
      if (notes.trim()) body.notes = notes.trim();
      if (override.trim()) body.creditOverrideReason = override.trim();
      const result = await commercialRequest(
        client,
        "POST",
        "/customer-orders",
        {
          path: {},
          body,
        },
      );
      const data =
        isObject(result.data) && isObject(result.data.data)
          ? result.data.data
          : {};
      return text(data.customerOrderId);
    },
    onSuccess: (id) => onBooked(id),
  });
  const chosen = bookable.data?.find(
    (row) => text(row.quotationId) === quotationId,
  );
  const behind = Number(chosen?.overdueInstallments) || 0;
  return (
    <SlideOver title={txt("Book an order", "حجز أوردر")} onClose={onClose}>
      <form
        className="orders-book"
        onSubmit={(event) => {
          event.preventDefault();
          book.mutate();
        }}
      >
        <p className="settings-hint">
          {txt(
            "Accepted quotations that have no order yet. The order copies the lines, prices, VAT and payment schedule the customer accepted.",
            "عروض الأسعار المتقبَلة اللي ملهاش أوردر لسه. الأوردر بياخد البنود والأسعار والضريبة وجدول الدفع زي ما العميل وافق عليهم.",
          )}
        </p>
        <ErrorBanner
          error={bookable.error}
          retry={() => void bookable.refetch()}
        />
        <fieldset className="orders-bookable">
          <legend>{txt("Quotation", "عرض السعر")}</legend>
          {bookable.data?.map((row) => (
            <label key={text(row.quotationId)} className="orders-bookable-row">
              <input
                type="radio"
                name="quotation"
                value={text(row.quotationId)}
                checked={quotationId === text(row.quotationId)}
                onChange={() => {
                  setQuotationId(text(row.quotationId));
                }}
              />
              <span>
                <strong>{text(row.quotationRef)}</strong>
                <em>{text(row.accountName)}</em>
                {Number(row.overdueInstallments) > 0 && (
                  <em className="orders-credit-flag">
                    {txt("Overdue payments", "عليه أقساط متأخرة")}
                  </em>
                )}
              </span>
              <span className="numeric">
                {money(row.totalAmount, text(row.currencyCode))}
                <small>
                  {txt("accepted", "اتقبل")}{" "}
                  {text(row.acceptedAt)
                    ? new Date(text(row.acceptedAt)).toLocaleDateString(
                        locale === "ar" ? "ar-EG" : "en-GB",
                      )
                    : ""}
                </small>
              </span>
            </label>
          ))}
          {bookable.data?.length === 0 && (
            <p className="table-empty">
              {txt(
                "Every accepted quotation already has its order.",
                "كل عروض الأسعار المتقبَلة ليها أوردرات.",
              )}
            </p>
          )}
        </fieldset>
        {behind > 0 && (
          <div className="orders-credit-warning" role="alert">
            <strong>
              {txt(
                `${text(chosen?.accountName)} has ${String(behind)} overdue installment${behind === 1 ? "" : "s"}`,
                `${text(chosen?.accountName)} عليه ${String(behind)} قسط متأخر`,
              )}
              {isObject(chosen?.overdueAmount) &&
                ` · ${Object.entries(chosen.overdueAmount)
                  .map(([currency, amount]) => money(amount, currency))
                  .join(" · ")}`}
            </strong>
            <span>
              {txt(
                "A manager can still book it, giving the reason. It is kept on the order's history.",
                "المدير يقدر يحجزه برضه بسبب مكتوب، وبيتسجّل في سجل الأوردر.",
              )}
            </span>
            <label>
              {txt("Why book it anyway", "ليه نحجزه رغم كده")}
              <textarea
                value={override}
                maxLength={500}
                onChange={(event) => {
                  setOverride(event.target.value);
                }}
              />
            </label>
            <Link to="/finance/receivables">
              {txt("See what they owe →", "شوف عليه كام ←")}
            </Link>
          </div>
        )}
        <label>
          {txt("Customer PO number", "رقم أمر الشراء")}
          <input
            value={po}
            maxLength={120}
            onChange={(event) => {
              setPo(event.target.value);
            }}
          />
        </label>
        <label>
          {txt("Requested delivery date", "تاريخ التسليم المطلوب")}
          <input
            type="date"
            value={delivery}
            onChange={(event) => {
              setDelivery(event.target.value);
            }}
          />
        </label>
        <label>
          {txt("Notes", "ملاحظات")}
          <textarea
            value={notes}
            maxLength={2000}
            onChange={(event) => {
              setNotes(event.target.value);
            }}
          />
        </label>
        <ErrorBanner
          error={book.error}
          retry={() => {
            book.mutate();
          }}
        />
        <button
          className="primary"
          disabled={
            quotationId === "" ||
            book.isPending ||
            (behind > 0 && override.trim().length < 3)
          }
        >
          {book.isPending ? "…" : txt("Book order", "احجز الأوردر")}
        </button>
      </form>
    </SlideOver>
  );
}

function OrderDetail({
  client,
  me,
  id,
}: {
  client: ApiClient;
  me: Me;
  id: string;
}) {
  const { txt, status, money, locale } = useText();
  const cache = useQueryClient();
  const toast = useToast();
  const [amending, setAmending] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [producing, setProducing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");

  const detail = useQuery({
    queryKey: ["customer-order", id],
    queryFn: async () => {
      const result = await commercialRequest(
        client,
        "GET",
        "/customer-orders/{customerOrderId}",
        {
          path: { customerOrderId: id },
        },
      );
      return isObject(result.data) && isObject(result.data.data)
        ? result.data.data
        : {};
    },
  });
  const order = detail.data ?? {};
  const currency = text(order.currencyCode);
  const statusCode = text(order.statusCode);
  const allowed = Array.isArray(order.allowedTransitions)
    ? order.allowedTransitions.filter(
        (value): value is string => typeof value === "string",
      )
    : [];
  const lines = rows(order.lines);
  const events = rows(order.events);
  const installments = rows(order.installments);
  const shipments = rows(order.shipments);
  const workOrders = rows(order.workOrders);
  const canPlanProduction =
    me.access.permissions.includes("work-orders.manage") &&
    ["CONFIRMED", "IN_PRODUCTION"].includes(statusCode);
  const canPlanShipment =
    me.access.permissions.includes("shipments.create") &&
    ["CONFIRMED", "IN_PRODUCTION", "READY"].includes(statusCode);
  const shortDate = (value: string) =>
    new Date(`${value}T00:00:00`).toLocaleDateString(
      locale === "ar" ? "ar-EG" : "en-GB",
    );

  const refresh = async (message: string) => {
    await cache.invalidateQueries({ queryKey: ["customer-order", id] });
    await cache.invalidateQueries({ queryKey: ["customer-orders"] });
    toast.success(message);
  };

  const move = useMutation({
    mutationFn: async ({ to, why }: { to: string; why?: string }) => {
      const body: Rec = {
        expectedRowVersion: text(order.rowVersion),
        targetStatusCode: to,
      };
      if (why) body.reason = why;
      await commercialRequest(
        client,
        "POST",
        "/customer-orders/{customerOrderId}/transitions",
        {
          path: { customerOrderId: id },
          body,
        },
      );
    },
    onSuccess: async () => {
      setCancelling(false);
      setReason("");
      await refresh(txt("Order updated", "اتحدّث الأوردر"));
    },
  });

  const stageIndex = STAGES.indexOf(statusCode as (typeof STAGES)[number]);

  return (
    <section className="workspace-page customer-order">
      <p className="orders-back">
        <Link to="/customer-orders">
          ← {txt("Customer orders", "أوامر البيع")}
        </Link>
      </p>
      <PageHeader
        kicker={text(order.accountName) || txt("Customer order", "أمر بيع")}
        title={text(order.orderRef) || "…"}
        {...(statusCode === "" ? {} : { status: status(statusCode) })}
        actions={
          <div className="orders-actions">
            <button
              type="button"
              className="ghost"
              onClick={() => {
                // A link the salesperson can send on WhatsApp, with the order
                // already filled in so the customer only has to talk.
                const link = `${window.location.origin}/feedback?type=ORDER&ref=${encodeURIComponent(text(order.orderRef))}`;
                void navigator.clipboard.writeText(link).then(() => {
                  toast.success(
                    txt(
                      "Feedback link copied — send it to the customer",
                      "اتنسخ رابط الرأي — ابعته للعميل",
                    ),
                  );
                });
              }}
            >
              {txt("Ask for feedback", "اطلب رأي العميل")}
            </button>
            {["CONFIRMED", "IN_PRODUCTION", "READY", "HANDED_OVER"].includes(
              statusCode,
            ) && (
              <OrderConfirmationButton
                client={client}
                orderId={id}
                orderRef={text(order.orderRef)}
                accountId={text(order.accountId)}
                accountName={text(order.accountName)}
                onSent={() =>
                  cache.invalidateQueries({ queryKey: ["customer-order", id] })
                }
              />
            )}
            {order.canAmend === true && (
              <button
                type="button"
                onClick={() => {
                  setAmending(true);
                }}
              >
                {txt("Amend", "تعديل")}
              </button>
            )}
            {allowed
              .filter((to) => to !== "CANCELLED")
              .map((to) => (
                <button
                  key={to}
                  type="button"
                  className="primary"
                  disabled={move.isPending}
                  onClick={() => {
                    move.mutate({ to });
                  }}
                >
                  {txt(ACTION_LABEL[to]?.en ?? to, ACTION_LABEL[to]?.ar ?? to)}
                </button>
              ))}
            {allowed.includes("CANCELLED") && (
              <button
                type="button"
                className="danger"
                onClick={() => {
                  setCancelling(true);
                }}
              >
                {txt("Cancel order", "إلغاء الأوردر")}
              </button>
            )}
          </div>
        }
      />
      <ErrorBanner
        error={detail.error ?? move.error}
        retry={() => void detail.refetch()}
      />

      {statusCode !== "" && statusCode !== "CANCELLED" && (
        <ol
          className="orders-stages"
          aria-label={txt("Order stages", "مراحل الأوردر")}
        >
          {STAGES.map((stage, index) => (
            <li
              key={stage}
              className={
                index < stageIndex
                  ? "is-done"
                  : index === stageIndex
                    ? "is-current"
                    : ""
              }
            >
              <span>{index + 1}</span>
              {status(stage)}
            </li>
          ))}
        </ol>
      )}
      {statusCode === "CANCELLED" && (
        <p className="orders-cancelled">
          {txt("Cancelled", "ملغي")}: {text(order.cancelReason)}
        </p>
      )}

      <div className="orders-facts panel">
        <dl className="quotation-fact-grid">
          <div>
            <dt>{txt("Customer", "العميل")}</dt>
            <dd>
              <Link to={`/customers/${text(order.accountId)}`}>
                {text(order.accountName)}
              </Link>
            </dd>
          </div>
          <div>
            <dt>{txt("Quotation", "عرض السعر")}</dt>
            <dd>
              <Link to={`/quotations/${text(order.quotationId)}`}>
                {text(order.quotationRef)}
              </Link>
            </dd>
          </div>
          <div>
            <dt>{txt("Customer PO", "أمر الشراء")}</dt>
            <dd>{text(order.customerPoNumber) || "—"}</dd>
          </div>
          <div>
            <dt>{txt("Requested delivery", "التسليم المطلوب")}</dt>
            <dd>{text(order.requestedDeliveryDate) || "—"}</dd>
          </div>
          <div>
            <dt>{txt("Delivery terms", "شروط التسليم")}</dt>
            <dd>{text(order.deliveryTerms) || "—"}</dd>
          </div>
          <div>
            <dt>{txt("Delivery point", "مكان التسليم")}</dt>
            <dd>{text(order.deliveryPoint) || "—"}</dd>
          </div>
          <div>
            <dt>{txt("Owner", "المسؤول")}</dt>
            <dd>{text(order.ownerName) || "—"}</dd>
          </div>
          <div>
            <dt>{txt("Amendments", "التعديلات")}</dt>
            <dd>{formatNum(num(order.amendmentNo), locale)}</dd>
          </div>
        </dl>
        {text(order.paymentTermsText) && (
          <p className="orders-terms">
            <strong>{txt("Payment terms", "شروط الدفع")}: </strong>
            {text(order.paymentTermsText)}
          </p>
        )}
      </div>

      <div className="panel">
        <h2>{txt("Lines", "البنود")}</h2>
        <div className="enterprise-table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>{txt("Code", "الكود")}</th>
                <th>{txt("Description", "الوصف")}</th>
                <th className="numeric">{txt("Qty", "الكمية")}</th>
                <th>{txt("Unit", "الوحدة")}</th>
                <th className="numeric">{txt("Unit price", "سعر الوحدة")}</th>
                <th className="numeric">{txt("Weight", "الوزن")}</th>
                <th className="numeric">{txt("Total", "الإجمالي")}</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={text(line.lineId)}>
                  <td>{text(line.lineNo)}</td>
                  <td>{text(line.itemCode) || "—"}</td>
                  <td>{text(line.description)}</td>
                  <td className="numeric">
                    {formatNum(num(line.quantity), locale)}
                  </td>
                  <td>{text(line.unitCode)}</td>
                  <td className="numeric">{money(line.unitPrice)}</td>
                  <td className="numeric">
                    {line.weightKg === null
                      ? "—"
                      : `${formatNum(num(line.weightKg), locale)} kg`}
                  </td>
                  <td className="numeric">{money(line.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="orders-totals">
          <div>
            <span>{txt("Subtotal", "الإجمالي قبل الضريبة")}</span>
            <strong>{money(order.subtotalAmount, currency)}</strong>
          </div>
          {num(order.adjustmentAmount) !== 0 && (
            <div>
              <span>{txt("Adjustments", "إضافات وخصومات")}</span>
              <strong>{money(order.adjustmentAmount, currency)}</strong>
            </div>
          )}
          <div>
            <span>
              {txt("VAT", "الضريبة")}{" "}
              {formatNum(num(order.vatRate) * 100, locale)}%
            </span>
            <strong>{money(order.taxAmount, currency)}</strong>
          </div>
          <div className="orders-grand">
            <span>{txt("Total", "الإجمالي")}</span>
            <strong>{money(order.totalAmount, currency)}</strong>
          </div>
        </div>
      </div>

      {(workOrders.length > 0 || canPlanProduction) && (
        <div className="panel">
          <div className="panel-heading-row">
            <h2>{txt("Production", "الإنتاج")}</h2>
            {canPlanProduction && (
              <button
                type="button"
                onClick={() => {
                  setProducing(true);
                }}
              >
                {txt("+ Plan production", "+ تخطيط إنتاج")}
              </button>
            )}
          </div>
          {workOrders.length === 0 ? (
            <p className="empty-inline orders-panel-note">
              {txt("Not planned on a line yet.", "لسه متخططش على خط إنتاج.")}
            </p>
          ) : (
            <div className="enterprise-table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{txt("Work order", "أمر الإنتاج")}</th>
                    <th>{txt("Status", "الحالة")}</th>
                    <th>{txt("Line", "الخط")}</th>
                    <th className="numeric">{txt("Boards", "الألواح")}</th>
                    <th>{txt("Planned", "المخطط")}</th>
                  </tr>
                </thead>
                <tbody>
                  {workOrders.map((one) => (
                    <tr key={text(one.workOrderId)}>
                      <td>
                        <Link to={`/work-orders/${text(one.workOrderId)}`}>
                          {text(one.workOrderRef)}
                        </Link>
                      </td>
                      <td>
                        <span
                          className={`wo-status wo-${text(one.statusCode)}`}
                        >
                          {enumLabel(text(one.statusCode), locale)}
                        </span>
                      </td>
                      <td>
                        {lineName(one.productionLineCode, locale === "ar")}
                      </td>
                      <td className="numeric">
                        {formatNum(Number(one.quantityProduced) || 0, locale)} /{" "}
                        {formatNum(Number(one.quantityPlanned) || 0, locale)}
                      </td>
                      <td>
                        {text(one.plannedStartDate)} →{" "}
                        {text(one.plannedEndDate)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {(shipments.length > 0 || canPlanShipment) && (
        <div className="panel">
          <div className="panel-heading-row">
            <h2>{txt("Shipments", "الشحنات")}</h2>
            {canPlanShipment && (
              <button
                type="button"
                onClick={() => {
                  setPlanning(true);
                }}
              >
                {txt("+ Plan shipment", "+ تخطيط شحنة")}
              </button>
            )}
          </div>
          {shipments.length === 0 ? (
            <p className="empty-inline orders-panel-note">
              {txt(
                "Nothing planned yet. Plan the shipment once the load is known.",
                "مفيش شحنة متخططة لسه. خطّطها لما الحمولة تتعرف.",
              )}
            </p>
          ) : (
            <div className="enterprise-table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{txt("Shipment", "الشحنة")}</th>
                    <th>{txt("Stage", "المرحلة")}</th>
                    <th>{txt("Leaves", "الخروج")}</th>
                    <th>{txt("Expected", "الوصول المتوقع")}</th>
                    <th>{txt("Delivered", "اتسلّمت")}</th>
                  </tr>
                </thead>
                <tbody>
                  {shipments.map((one) => (
                    <tr key={text(one.shipmentId)}>
                      <td>
                        <Link to={`/shipments/${text(one.shipmentId)}`}>
                          {text(one.shipmentRef)}
                        </Link>
                      </td>
                      <td>
                        <span
                          className={`shipment-step step-${text(one.milestoneCode)}`}
                        >
                          {enumLabel(text(one.milestoneCode), locale)}
                        </span>
                      </td>
                      <td>{text(one.plannedDispatchDate) || "—"}</td>
                      <td>{text(one.expectedDeliveryDate) || "—"}</td>
                      <td>
                        {text(one.deliveredAt)
                          ? new Date(text(one.deliveredAt)).toLocaleDateString(
                              locale === "ar" ? "ar-EG" : "en-GB",
                            )
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {installments.length > 0 && (
        <div className="panel">
          <h2>{txt("Payment plan", "خطة الدفع")}</h2>
          <div className="enterprise-table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{txt("Installment", "القسط")}</th>
                  <th>{txt("Due", "الميعاد")}</th>
                  <th className="numeric">{txt("Amount", "المبلغ")}</th>
                  <th className="numeric">{txt("Collected", "المحصّل")}</th>
                  <th className="numeric">{txt("Outstanding", "المتبقي")}</th>
                  <th>{txt("Status", "الحالة")}</th>
                </tr>
              </thead>
              <tbody>
                {installments.map((one) => {
                  const late =
                    String(one.agingBucket).startsWith("OVERDUE") &&
                    (one.statusCode === "OPEN" || one.statusCode === "PARTIAL");
                  return (
                    <tr key={text(one.receivableInstallmentId)}>
                      <td>{text(one.label)}</td>
                      <td>{dueText(one, txt, shortDate)}</td>
                      <td className="numeric">{money(one.amount)}</td>
                      <td className="numeric">{money(one.collectedAmount)}</td>
                      <td className="numeric">
                        <strong>{money(one.outstandingAmount)}</strong>
                      </td>
                      <td>
                        <StatusChip
                          code={late ? "OVERDUE" : text(one.statusCode)}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="panel">
        <h2>{txt("History", "السجل")}</h2>
        <ol className="orders-history">
          {events.map((event) => (
            <li key={text(event.eventId)}>
              <time>
                {new Date(text(event.createdAt)).toLocaleString(
                  locale === "ar" ? "ar-EG" : "en-GB",
                )}
              </time>
              <strong>
                {text(event.eventCode) === "BOOKED"
                  ? txt("Booked from the quotation", "اتحجز من عرض السعر")
                  : text(event.eventCode) === "AMENDED"
                    ? txt("Amended", "اتعدّل")
                    : text(event.eventCode) === "CONFIRMATION_SENT"
                      ? txt(
                          "Confirmation emailed to the customer",
                          "اتبعت تأكيد الأوردر للعميل",
                        )
                      : `${status(text(event.fromStatusCode))} → ${status(text(event.toStatusCode))}`}
              </strong>
              <span>{text(event.actorName)}</span>
              {text(event.note) && <em>{text(event.note)}</em>}
            </li>
          ))}
        </ol>
      </div>

      {cancelling && (
        <SlideOver
          title={txt("Cancel order", "إلغاء الأوردر")}
          onClose={() => {
            setCancelling(false);
          }}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              move.mutate({ to: "CANCELLED", why: reason.trim() });
            }}
          >
            <label>
              {txt("Why is it cancelled?", "سبب الإلغاء")}
              <textarea
                required
                minLength={3}
                maxLength={500}
                value={reason}
                onChange={(event) => {
                  setReason(event.target.value);
                }}
              />
            </label>
            <ErrorBanner error={move.error} retry={() => undefined} />
            <button
              className="danger"
              disabled={move.isPending || reason.trim().length < 3}
            >
              {txt("Cancel order", "إلغاء الأوردر")}
            </button>
          </form>
        </SlideOver>
      )}
      {producing && (
        <WorkOrderPlanDialog
          client={client}
          customerOrderId={id}
          onClose={() => {
            setProducing(false);
          }}
          onPlanned={async () => {
            setProducing(false);
            await refresh(txt("Production planned", "الإنتاج اتخطط"));
          }}
        />
      )}
      {planning && (
        <ShipmentPlanDialog
          client={client}
          customerOrderId={id}
          onClose={() => {
            setPlanning(false);
          }}
          onPlanned={async () => {
            setPlanning(false);
            await refresh(txt("Shipment planned", "الشحنة اتخططت"));
          }}
        />
      )}
      {amending && (
        <AmendOrder
          client={client}
          order={order}
          lines={lines}
          onClose={() => {
            setAmending(false);
          }}
          onSaved={async () => {
            setAmending(false);
            await refresh(txt("Order amended", "اتعدّل الأوردر"));
          }}
        />
      )}
    </section>
  );
}

function AmendOrder({
  client,
  order,
  lines,
  onClose,
  onSaved,
}: {
  client: ApiClient;
  order: Rec;
  lines: Rec[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { txt } = useText();
  const [po, setPo] = useState(text(order.customerPoNumber));
  const [delivery, setDelivery] = useState(text(order.requestedDeliveryDate));
  const [terms, setTerms] = useState(text(order.deliveryTerms));
  const [point, setPoint] = useState(text(order.deliveryPoint));
  const [quantities, setQuantities] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      lines.map((line) => [text(line.lineId), text(line.quantity)]),
    ),
  );
  const [reason, setReason] = useState("");
  const save = useMutation({
    mutationFn: async () => {
      const changed = lines
        .filter(
          (line) =>
            Number(quantities[text(line.lineId)]) !== num(line.quantity),
        )
        .map((line) => ({
          lineId: text(line.lineId),
          quantity: quantities[text(line.lineId)] ?? "",
        }));
      const body: Rec = {
        expectedRowVersion: text(order.rowVersion),
        reason: reason.trim(),
        customerPoNumber: po.trim() || null,
        requestedDeliveryDate: delivery || null,
        deliveryTerms: terms.trim() || null,
        deliveryPoint: point.trim() || null,
      };
      if (changed.length > 0) body.lines = changed;
      await commercialRequest(
        client,
        "PATCH",
        "/customer-orders/{customerOrderId}",
        {
          path: { customerOrderId: text(order.customerOrderId) },
          body,
        },
      );
    },
    onSuccess: () => onSaved(),
  });
  return (
    <SlideOver title={txt("Amend order", "تعديل الأوردر")} onClose={onClose}>
      <form
        className="orders-amend"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <label>
          {txt("Customer PO number", "رقم أمر الشراء")}
          <input
            value={po}
            maxLength={120}
            onChange={(event) => {
              setPo(event.target.value);
            }}
          />
        </label>
        <label>
          {txt("Requested delivery date", "تاريخ التسليم المطلوب")}
          <input
            type="date"
            value={delivery}
            onChange={(event) => {
              setDelivery(event.target.value);
            }}
          />
        </label>
        <label>
          {txt("Delivery terms", "شروط التسليم")}
          <input
            value={terms}
            maxLength={500}
            onChange={(event) => {
              setTerms(event.target.value);
            }}
          />
        </label>
        <label>
          {txt("Delivery point", "مكان التسليم")}
          <input
            value={point}
            maxLength={500}
            onChange={(event) => {
              setPoint(event.target.value);
            }}
          />
        </label>
        <fieldset>
          <legend>{txt("Quantities", "الكميات")}</legend>
          {lines.map((line) => (
            <label key={text(line.lineId)} className="orders-amend-line">
              <span>
                {text(line.lineNo)}. {text(line.description)}
              </span>
              <input
                inputMode="decimal"
                value={quantities[text(line.lineId)] ?? ""}
                onChange={(event) => {
                  setQuantities((current) => ({
                    ...current,
                    [text(line.lineId)]: event.target.value,
                  }));
                }}
              />
            </label>
          ))}
        </fieldset>
        <label>
          {txt("Reason for the amendment", "سبب التعديل")}
          <textarea
            required
            minLength={3}
            maxLength={500}
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
            }}
          />
        </label>
        <ErrorBanner
          error={save.error}
          retry={() => {
            save.mutate();
          }}
        />
        <button
          className="primary"
          disabled={save.isPending || reason.trim().length < 3}
        >
          {save.isPending ? "…" : txt("Save amendment", "حفظ التعديل")}
        </button>
      </form>
    </SlideOver>
  );
}
