import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import type { ApiClient } from "@abp/api-client";
import type { Me } from "../api/customer-api.ts";
import { uploadFileAsAttachment } from "../api/documents-api.ts";
import { useI18n } from "../i18n/i18n.tsx";
import { formatNum } from "../lib/numbers.ts";
import { commercialRequest, isObject, rows } from "./commercial-api.ts";
import {
  ErrorBanner,
  PageHeader,
  SlideOver,
  useToast,
} from "./CommercialUI.tsx";
import { ShipmentCorrection } from "./record-actions.tsx";
import { ShipmentPlanDialog } from "./ShipmentPlanDialog.tsx";
import { downloadDocument } from "./DownloadTray.tsx";

/**
 * Shipments, from the yard to the customer's signature.
 *
 * A truck goes ready -> dispatched -> delivered -> POD; a sea container also
 * records the vessel's departure and its arrival at the port. The step on
 * offer is the one the server says comes next for this shipment, so the
 * screen can never ask for a step the route does not have.
 */

type Rec = Record<string, unknown>;
const text = (value: unknown): string =>
  typeof value === "string"
    ? value
    : typeof value === "number"
      ? String(value)
      : "";

const STEPS: Record<string, { en: string; ar: string }> = {
  READY_FOR_DELIVERY: { en: "Ready to go", ar: "جاهزة للخروج" },
  SHIPPED: { en: "Dispatched", ar: "خرجت" },
  VESSEL_DEPARTED: { en: "At sea", ar: "في البحر" },
  ARRIVED_AT_PORT_OF_DISCHARGE: { en: "At port", ar: "في الميناء" },
  DELIVERED: { en: "Delivered", ar: "اتسلّمت" },
  POD_RECEIVED: { en: "POD received", ar: "إثبات التسليم وصل" },
};
const ROUTES: Record<string, string[]> = {
  LOCAL_TRUCK: ["READY_FOR_DELIVERY", "SHIPPED", "DELIVERED", "POD_RECEIVED"],
  SEA_CONTAINER: [
    "READY_FOR_DELIVERY",
    "SHIPPED",
    "VESSEL_DEPARTED",
    "ARRIVED_AT_PORT_OF_DISCHARGE",
    "DELIVERED",
    "POD_RECEIVED",
  ],
};
const UNITS: Record<string, { en: string; ar: string }> = {
  CONTAINER_40: { en: "× 40 ft", ar: "× 40 قدم" },
  CONTAINER_20: { en: "× 20 ft", ar: "× 20 قدم" },
  TRUCK: { en: "trucks", ar: "عربيات" },
};
const CONDITIONS = [
  { code: "GOOD", en: "In good condition", ar: "سليمة" },
  { code: "DAMAGED", en: "Some damaged", ar: "فيها تلف" },
  { code: "SHORT", en: "Short delivered", ar: "ناقصة" },
  { code: "REFUSED", en: "Refused", ar: "اترفضت" },
];
const ACTIONS: Record<string, { en: string; ar: string }> = {
  DISPATCH: { en: "Dispatch", ar: "تسجيل الخروج" },
  VESSEL_DEPARTED: { en: "Vessel departed", ar: "المركب أبحرت" },
  ARRIVED: { en: "Arrived at port", ar: "وصلت الميناء" },
  DELIVER: { en: "Record delivery", ar: "تسجيل التسليم" },
  POD: { en: "Proof of delivery received", ar: "استلام إثبات التسليم" },
};

function useText() {
  const { locale } = useI18n();
  const ar = locale === "ar";
  return {
    ar,
    locale,
    txt: (en: string, arabic: string) => (ar ? arabic : en),
    step: (code: unknown) => {
      const found = STEPS[text(code)];
      return found === undefined ? text(code) : ar ? found.ar : found.en;
    },
    date: (value: unknown) =>
      text(value)
        ? new Date(
            text(value).length === 10 ? `${text(value)}T00:00:00` : text(value),
          ).toLocaleDateString(ar ? "ar-EG" : "en-GB")
        : "—",
  };
}

/** "3 × 40 ft, 1 × 20 ft" from a load plan. */
function unitsText(plan: unknown, ar: boolean): string {
  if (!isObject(plan) || !Array.isArray(plan.units)) return "—";
  const parts = plan.units.filter(isObject).map((unit) => {
    const label = UNITS[text(unit.typeCode)];
    const count = text(unit.count);
    return label === undefined ? count : `${count} ${ar ? label.ar : label.en}`;
  });
  return parts.length === 0 ? "—" : parts.join(" · ");
}

export function ShipmentsPage({ client, me }: { client: ApiClient; me: Me }) {
  const { txt, step, date, ar } = useText();
  const { shipmentId } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const cache = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [planning, setPlanning] = useState(false);
  const customerOrderId = params.get("customerOrderId") ?? "";
  const canPlan = me.access.permissions.includes("shipments.create");

  const list = useQuery({
    queryKey: ["shipments", status, search, offset, customerOrderId],
    queryFn: async () => {
      const query: Record<string, string | number> = { offset, limit: 25 };
      if (status) query.status = status;
      if (search) query.search = search;
      if (customerOrderId) query.customerOrderId = customerOrderId;
      const result = await commercialRequest(client, "GET", "/shipments", {
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
        kicker={txt("Logistics", "اللوجستيات")}
        title={txt("Shipments", "الشحنات")}
        {...(list.data === undefined ? {} : { count: list.data.total })}
        actions={
          <>
            <Link className="button-link" to="/logistics/delivery-calendar">
              {txt("Delivery calendar", "تقويم التسليم")}
            </Link>
            {canPlan && (
              <button
                type="button"
                className="primary"
                onClick={() => {
                  setPlanning(true);
                }}
              >
                {txt("+ Plan shipment", "+ تخطيط شحنة")}
              </button>
            )}
          </>
        }
      />
      {customerOrderId && (
        <p className="settings-hint">
          {txt("Showing one order's shipments.", "معروض شحنات أوردر واحد.")}{" "}
          <button
            type="button"
            className="ghost"
            onClick={() => {
              setParams({});
            }}
          >
            {txt("Show all", "اعرض الكل")}
          </button>
        </p>
      )}
      <div
        className="orders-filters"
        role="group"
        aria-label={txt("Stage", "المرحلة")}
      >
        {["", ...Object.keys(STEPS)].map((code) => (
          <button
            key={code || "ALL"}
            type="button"
            className={status === code ? "is-active" : ""}
            aria-pressed={status === code}
            onClick={() => {
              setStatus(code);
              setOffset(0);
            }}
          >
            {code === "" ? txt("All", "الكل") : step(code)}
          </button>
        ))}
      </div>
      <input
        type="search"
        aria-label={txt("Search shipments", "بحث الشحنات")}
        placeholder={txt("Search by shipment number", "ابحث برقم الشحنة")}
        value={search}
        onChange={(event) => {
          setSearch(event.target.value);
          setOffset(0);
        }}
      />
      <ErrorBanner error={list.error} retry={() => void list.refetch()} />
      <div className="panel">
        <div className="enterprise-table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>{txt("Shipment", "الشحنة")}</th>
                <th>{txt("Order", "الأوردر")}</th>
                <th>{txt("Customer", "العميل")}</th>
                <th>{txt("Travels by", "النقل")}</th>
                <th>{txt("Load", "الحمولة")}</th>
                <th>{txt("Stage", "المرحلة")}</th>
                <th>{txt("Leaves", "الخروج")}</th>
                <th>{txt("Expected", "الوصول المتوقع")}</th>
              </tr>
            </thead>
            <tbody>
              {list.data?.rows.map((row) => (
                <tr key={text(row.shipmentId)}>
                  <td>
                    <Link to={`/shipments/${text(row.shipmentId)}`}>
                      {text(row.shipmentRef)}
                    </Link>
                  </td>
                  <td>
                    {text(row.customerOrderId) ? (
                      <Link
                        to={`/customer-orders/${text(row.customerOrderId)}`}
                      >
                        {text(row.orderRef)}
                      </Link>
                    ) : (
                      text(row.orderRef) || "—"
                    )}
                  </td>
                  <td>
                    {text(row.accountId) ? (
                      <Link to={`/customers/${text(row.accountId)}`}>
                        {text(row.accountName)}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    {row.transportModeCode === "LOCAL_TRUCK"
                      ? txt("Truck", "عربية")
                      : txt("Sea", "بحري")}
                  </td>
                  <td>{unitsText(row.loadPlan, ar)}</td>
                  <td>
                    <span
                      className={`shipment-step step-${text(row.milestoneCode)}`}
                    >
                      {step(row.milestoneCode)}
                    </span>
                  </td>
                  <td>{date(row.dispatchedAt || row.plannedDispatchDate)}</td>
                  <td>{date(row.deliveredAt || row.expectedDeliveryDate)}</td>
                </tr>
              ))}
              {list.data?.rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="table-empty">
                    {txt("No shipments here.", "مفيش شحنات هنا.")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <footer className="pagination">
          <button
            disabled={offset === 0}
            onClick={() => {
              setOffset(Math.max(0, offset - 25));
            }}
          >
            {txt("Previous", "السابق")}
          </button>
          <span>{offset / 25 + 1}</span>
          <button
            disabled={!list.data?.hasNext}
            onClick={() => {
              setOffset(offset + 25);
            }}
          >
            {txt("Next", "التالي")}
          </button>
        </footer>
      </div>
      {planning && (
        <ShipmentPlanDialog
          client={client}
          onClose={() => {
            setPlanning(false);
          }}
          onPlanned={async (id) => {
            setPlanning(false);
            await cache.invalidateQueries({ queryKey: ["shipments"] });
            toast.success(txt("Shipment planned", "الشحنة اتخططت"));
            void navigate(`/shipments/${id}`);
          }}
        />
      )}
      {shipmentId && (
        <ShipmentDetail
          client={client}
          me={me}
          shipmentId={shipmentId}
          onClose={() => void navigate("/shipments")}
        />
      )}
    </section>
  );
}

function ShipmentDetail({
  client,
  me,
  shipmentId,
  onClose,
}: {
  client: ApiClient;
  me: Me;
  shipmentId: string;
  onClose: () => void;
}) {
  const { txt, step, date, ar } = useText();
  const cache = useQueryClient();
  const toast = useToast();
  const [acting, setActing] = useState(false);
  const detail = useQuery({
    queryKey: ["shipment", shipmentId],
    queryFn: async () => {
      const result = await commercialRequest(
        client,
        "GET",
        "/shipments/{shipmentId}",
        {
          path: { shipmentId },
        },
      );
      return isObject(result.data) && isObject(result.data.data)
        ? result.data.data
        : {};
    },
  });
  const row = detail.data ?? {};
  const mode = text(row.transportModeCode) || "SEA_CONTAINER";
  const route = ROUTES[mode] ?? ROUTES.SEA_CONTAINER ?? [];
  const at = route.indexOf(text(row.milestoneCode));
  const action = text(row.nextAction);
  const history = Array.isArray(row.history)
    ? row.history.filter(isObject)
    : [];
  const plan = isObject(row.loadPlan) ? row.loadPlan : {};
  const refresh = async () => {
    await cache.invalidateQueries({ queryKey: ["shipment", shipmentId] });
    await cache.invalidateQueries({ queryKey: ["shipments"] });
    await cache.invalidateQueries({ queryKey: ["customer-order"] });
    await cache.invalidateQueries({ queryKey: ["delivery-calendar"] });
  };
  const when = (value: unknown) =>
    text(value)
      ? new Date(text(value)).toLocaleString(ar ? "ar-EG" : "en-GB", {
          dateStyle: "medium",
          timeStyle: "short",
        })
      : "—";

  return (
    <SlideOver
      title={text(row.shipmentRef) || txt("Shipment", "شحنة")}
      onClose={onClose}
      width={860}
    >
      <ErrorBanner error={detail.error} retry={() => void detail.refetch()} />
      {detail.data && (
        <div className="complaint-detail">
          <ol
            className="complaint-route shipment-route"
            style={{
              gridTemplateColumns: `repeat(${String(route.length)}, minmax(0, 1fr))`,
            }}
          >
            {route.map((code, index) => (
              <li
                key={code}
                className={
                  index < at ? "is-done" : index === at ? "is-current" : ""
                }
              >
                <strong>{step(code)}</strong>
              </li>
            ))}
          </ol>
          {action && (
            <div className="complaint-moves">
              <button
                type="button"
                className="primary"
                onClick={() => {
                  setActing(true);
                }}
              >
                {ar ? ACTIONS[action]?.ar : ACTIONS[action]?.en}
              </button>
            </div>
          )}
          <dl className="quotation-fact-grid">
            <div>
              <dt>{txt("Order", "الأوردر")}</dt>
              <dd>
                {text(row.customerOrderId) ? (
                  <Link to={`/customer-orders/${text(row.customerOrderId)}`}>
                    {text(row.orderRef)}
                  </Link>
                ) : (
                  text(row.orderRef) || "—"
                )}
              </dd>
            </div>
            <div>
              <dt>{txt("Customer", "العميل")}</dt>
              <dd>
                {text(row.accountId) ? (
                  <Link to={`/customers/${text(row.accountId)}`}>
                    {text(row.accountName)}
                  </Link>
                ) : (
                  "—"
                )}
              </dd>
            </div>
            <div>
              <dt>{txt("Travels by", "النقل")}</dt>
              <dd>
                {mode === "LOCAL_TRUCK"
                  ? txt("Truck to site", "عربية للموقع")
                  : txt("Sea container", "حاوية بحري")}
              </dd>
            </div>
            <div>
              <dt>{txt("Load", "الحمولة")}</dt>
              <dd>
                {unitsText(plan, ar)}
                {Number(plan.totalWeightKg) > 0 &&
                  ` · ${formatNum(Number(plan.totalWeightKg), ar ? "ar" : "en")} kg`}
              </dd>
            </div>
            <div>
              <dt>{txt("Leaves", "الخروج")}</dt>
              <dd>
                {text(row.dispatchedAt)
                  ? when(row.dispatchedAt)
                  : date(row.plannedDispatchDate)}
              </dd>
            </div>
            <div>
              <dt>{txt("Customer can expect it", "الوصول المتوقع")}</dt>
              <dd>{date(row.expectedDeliveryDate)}</dd>
            </div>
            <div>
              <dt>{txt("Vehicle / container", "العربية / الحاوية")}</dt>
              <dd>
                {[
                  text(row.vehicleRef),
                  text(row.containerNo),
                  text(row.sealNo) &&
                    `${txt("seal", "سيل")} ${text(row.sealNo)}`,
                ]
                  .filter(Boolean)
                  .join(" · ") || "—"}
              </dd>
            </div>
            <div>
              <dt>{txt("Driver", "السواق")}</dt>
              <dd>
                {[text(row.driverName), text(row.driverPhone)]
                  .filter(Boolean)
                  .join(" · ") || "—"}
              </dd>
            </div>
            {mode === "SEA_CONTAINER" && (
              <>
                <div>
                  <dt>{txt("B/L date", "تاريخ البوليصة")}</dt>
                  <dd>{date(row.blDate)}</dd>
                </div>
                <div>
                  <dt>{txt("Port of discharge", "ميناء التفريغ")}</dt>
                  <dd>
                    {text(row.portOfDischarge) || "—"}
                    {text(row.actualArrivalAt) &&
                      ` · ${when(row.actualArrivalAt)}`}
                  </dd>
                </div>
              </>
            )}
            <div>
              <dt>{txt("Delivered", "اتسلّمت")}</dt>
              <dd>
                {text(row.deliveredAt)
                  ? `${when(row.deliveredAt)} · ${text(row.receivedByName)}`
                  : "—"}
              </dd>
            </div>
            <div>
              <dt>{txt("Proof of delivery", "إثبات التسليم")}</dt>
              <dd>
                {text(row.podReceivedAt) ? (
                  <>
                    {text(row.podReference) || txt("Received", "وصل")}
                    {text(row.podDocumentId) && (
                      <>
                        {" · "}
                        <button
                          type="button"
                          className="link-button"
                          onClick={() => {
                            void downloadDocument(
                              client,
                              text(row.podDocumentId),
                              `${text(row.shipmentRef)}-POD`,
                            );
                          }}
                        >
                          {txt("signed copy", "النسخة الموقّعة")}
                        </button>
                      </>
                    )}
                  </>
                ) : (
                  "—"
                )}
              </dd>
            </div>
          </dl>
          {text(row.deliveryConditionCode) &&
            row.deliveryConditionCode !== "GOOD" && (
              <p className="complaint-now is-late">
                {
                  CONDITIONS.find(
                    (one) => one.code === row.deliveryConditionCode,
                  )?.[ar ? "ar" : "en"]
                }
                : {text(row.deliveryNotes)}
                {" · "}
                <Link to="/complaints">
                  {txt("Log a complaint", "سجّل شكوى")}
                </Link>
              </p>
            )}
          {isObject(plan) && text(plan.note) && (
            <p className="complaint-description">{text(plan.note)}</p>
          )}
          {text(row.quotationId) && (
            <p className="settings-hint">
              <Link
                to={`/logistics/cargo-loader?quotationId=${text(row.quotationId)}`}
              >
                {txt(
                  "Open the load in the Cargo Loader →",
                  "افتح الحمولة في محمّل الحاويات ←",
                )}
              </Link>
            </p>
          )}
          {mode === "SEA_CONTAINER" && (
            <ShipmentCorrection
              client={client}
              me={me}
              row={row}
              onDone={async () => {
                await refresh();
              }}
            />
          )}
          <section className="complaint-history">
            <h3>{txt("History", "السجل")}</h3>
            <ol>
              {history.map((event) => (
                <li key={text(event.eventId)}>
                  <time>{when(event.businessOccurredAt)}</time>
                  <strong>
                    {event.eventTypeCode === "CORRECTION"
                      ? txt("Corrected", "اتصحّحت")
                      : event.fromMilestoneCode
                        ? `${step(event.fromMilestoneCode)} → ${step(event.toMilestoneCode)}`
                        : step(event.toMilestoneCode)}
                  </strong>
                  <span />
                  {text(event.reason) && <em>{text(event.reason)}</em>}
                </li>
              ))}
            </ol>
          </section>
        </div>
      )}
      {acting && (
        <StepDialog
          client={client}
          row={row}
          action={action}
          onClose={() => {
            setActing(false);
          }}
          onDone={async () => {
            setActing(false);
            await refresh();
            toast.success(txt("Recorded", "اتسجّل"));
          }}
        />
      )}
    </SlideOver>
  );
}

/** One dialog per step, asking only for what that step records. */
function StepDialog({
  client,
  row,
  action,
  onClose,
  onDone,
}: {
  client: ApiClient;
  row: Rec;
  action: string;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const { txt, ar } = useText();
  const now = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
  const [occurred, setOccurred] = useState(now);
  const [values, setValues] = useState<Record<string, string>>({
    deliveryConditionCode: "GOOD",
  });
  const file = useRef<HTMLInputElement>(null);
  const set = (field: string) => (event: { target: { value: string } }) => {
    setValues((current) => ({ ...current, [field]: event.target.value }));
  };
  const value = (field: string) => values[field] ?? "";
  const iso = new Date(occurred).toISOString();
  const shipmentId = text(row.shipmentId);
  const version = text(row.rowVersion);

  const save = useMutation({
    mutationFn: async () => {
      const clean = (fields: string[]) =>
        Object.fromEntries(
          fields
            .map((field) => [field, value(field).trim()] as const)
            .filter(([, entry]) => entry !== ""),
        );
      if (action === "DISPATCH")
        return commercialRequest(
          client,
          "POST",
          "/shipments/{shipmentId}/dispatch",
          {
            path: { shipmentId },
            idempotencyKey: crypto.randomUUID(),
            body: {
              expectedRowVersion: version,
              dispatchedAt: iso,
              ...clean([
                "vehicleRef",
                "containerNo",
                "sealNo",
                "driverName",
                "driverPhone",
                "expectedDeliveryDate",
              ]),
            },
          },
        );
      if (action === "VESSEL_DEPARTED" || action === "ARRIVED")
        return commercialRequest(
          client,
          "POST",
          "/shipments/{shipmentId}/milestones",
          {
            path: { shipmentId },
            idempotencyKey: crypto.randomUUID(),
            body: {
              expectedRowVersion: version,
              businessOccurredAt: iso,
              milestoneCode:
                action === "ARRIVED"
                  ? "ARRIVED_AT_PORT_OF_DISCHARGE"
                  : "VESSEL_DEPARTED",
              ...(action === "ARRIVED"
                ? {
                    portOfDischarge: value("portOfDischarge").trim(),
                    actualArrivalAt: iso,
                  }
                : { blDate: value("blDate") }),
            },
          },
        );
      if (action === "DELIVER")
        return commercialRequest(
          client,
          "POST",
          "/shipments/{shipmentId}/deliver",
          {
            path: { shipmentId },
            idempotencyKey: crypto.randomUUID(),
            body: {
              expectedRowVersion: version,
              deliveredAt: iso,
              receivedByName: value("receivedByName").trim(),
              deliveryConditionCode: value("deliveryConditionCode"),
              ...clean(["deliveryNotes"]),
            },
          },
        );
      // POD: upload the signed copy first, when there is one.
      const chosen = file.current?.files?.[0];
      const document = chosen
        ? await uploadFileAsAttachment(
            client,
            chosen,
            "PROOF_OF_DELIVERY",
            "SHIPMENT",
            shipmentId,
          )
        : null;
      return commercialRequest(client, "POST", "/shipments/{shipmentId}/pod", {
        path: { shipmentId },
        idempotencyKey: crypto.randomUUID(),
        body: {
          expectedRowVersion: version,
          podReceivedAt: iso,
          ...clean(["podReference"]),
          ...(document?.documentId
            ? { podDocumentId: document.documentId }
            : {}),
        },
      });
    },
    onSuccess: () => onDone(),
  });

  const missing =
    (action === "DISPATCH" &&
      !value("vehicleRef").trim() &&
      !value("containerNo").trim()) ||
    (action === "VESSEL_DEPARTED" && !value("blDate")) ||
    (action === "ARRIVED" && !value("portOfDischarge").trim()) ||
    (action === "DELIVER" &&
      (value("receivedByName").trim().length < 2 ||
        (value("deliveryConditionCode") !== "GOOD" &&
          !value("deliveryNotes").trim()))) ||
    (action === "POD" && !value("podReference").trim() && !value("podFile"));

  return (
    <SlideOver
      title={
        ar ? (ACTIONS[action]?.ar ?? action) : (ACTIONS[action]?.en ?? action)
      }
      onClose={onClose}
    >
      <form
        className="orders-amend"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <label>
          {txt("When it happened", "حصلت إمتى")}
          <input
            type="datetime-local"
            value={occurred}
            max={now}
            onChange={(e) => {
              setOccurred(e.target.value);
            }}
          />
        </label>
        {action === "DISPATCH" && (
          <>
            <label>
              {txt("Truck plate / reference", "رقم العربية")}
              <input
                value={value("vehicleRef")}
                maxLength={100}
                onChange={set("vehicleRef")}
              />
            </label>
            <label>
              {txt("Container number", "رقم الحاوية")}
              <input
                value={value("containerNo")}
                maxLength={100}
                onChange={set("containerNo")}
              />
            </label>
            <label>
              {txt("Seal number", "رقم السيل")}
              <input
                value={value("sealNo")}
                maxLength={100}
                onChange={set("sealNo")}
              />
            </label>
            <label>
              {txt("Driver", "السواق")}
              <input
                value={value("driverName")}
                maxLength={200}
                onChange={set("driverName")}
              />
            </label>
            <label>
              {txt("Driver's phone", "تليفون السواق")}
              <input
                value={value("driverPhone")}
                maxLength={50}
                inputMode="tel"
                onChange={set("driverPhone")}
              />
            </label>
            <label>
              {txt(
                "Revised arrival date (optional)",
                "تاريخ الوصول المعدّل (اختياري)",
              )}
              <input
                type="date"
                value={value("expectedDeliveryDate")}
                onChange={set("expectedDeliveryDate")}
              />
            </label>
          </>
        )}
        {action === "VESSEL_DEPARTED" && (
          <label>
            {txt("Bill of lading date", "تاريخ البوليصة")}
            <input
              type="date"
              value={value("blDate")}
              onChange={set("blDate")}
            />
          </label>
        )}
        {action === "ARRIVED" && (
          <label>
            {txt("Port of discharge", "ميناء التفريغ")}
            <input
              value={value("portOfDischarge")}
              maxLength={200}
              onChange={set("portOfDischarge")}
            />
          </label>
        )}
        {action === "DELIVER" && (
          <>
            <label>
              {txt("Received by (name)", "استلمها (الاسم)")}
              <input
                value={value("receivedByName")}
                maxLength={200}
                onChange={set("receivedByName")}
              />
            </label>
            <label>
              {txt("Condition", "الحالة")}
              <select
                value={value("deliveryConditionCode")}
                onChange={set("deliveryConditionCode")}
              >
                {CONDITIONS.map((one) => (
                  <option key={one.code} value={one.code}>
                    {ar ? one.ar : one.en}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {value("deliveryConditionCode") === "GOOD"
                ? txt("Notes (optional)", "ملاحظات (اختياري)")
                : txt("What was wrong", "إيه اللي كان فيه مشكلة")}
              <textarea
                value={value("deliveryNotes")}
                maxLength={2000}
                onChange={set("deliveryNotes")}
              />
            </label>
            {text(row.customerOrderId) && (
              <p className="settings-hint">
                {txt(
                  "When this is the order's last shipment and the order is marked ready, the order is handed over on this date and its after-delivery payments fall due from it.",
                  "لو دي آخر شحنة في الأوردر والأوردر متعلّم جاهز، الأوردر بيتسلّم بالتاريخ ده والأقساط اللي بعد التسليم بتتحسب منه.",
                )}
              </p>
            )}
          </>
        )}
        {action === "POD" && (
          <>
            <label>
              {txt("Delivery note number", "رقم إذن التسليم")}
              <input
                value={value("podReference")}
                maxLength={200}
                onChange={set("podReference")}
              />
            </label>
            <label>
              {txt(
                "Signed copy (photo or PDF)",
                "النسخة الموقّعة (صورة أو PDF)",
              )}
              <input
                ref={file}
                type="file"
                accept="image/png,image/jpeg,application/pdf"
                onChange={(event) => {
                  setValues((current) => ({
                    ...current,
                    podFile: event.target.files?.[0]?.name ?? "",
                  }));
                }}
              />
            </label>
          </>
        )}
        <ErrorBanner
          error={save.error}
          retry={() => {
            save.mutate();
          }}
        />
        <button className="primary" disabled={save.isPending || missing}>
          {save.isPending ? "…" : txt("Record", "سجّل")}
        </button>
      </form>
    </SlideOver>
  );
}
