import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { ApiClient } from "@abp/api-client";
import { useI18n } from "../i18n/i18n.tsx";
import { recallCargoPlan } from "../lib/cargo-handoff.ts";
import { commercialRequest, isObject, rows } from "./commercial-api.ts";
import { ErrorBanner, SlideOver } from "./CommercialUI.tsx";

/**
 * Planning a shipment for a customer order: how it travels, when it leaves,
 * when the customer can expect it, and what it fills -- the containers or
 * trucks the Cargo Loader worked out for the order's quotation.
 */

const SHIPPABLE = ["CONFIRMED", "IN_PRODUCTION", "READY"];
const text = (value: unknown): string =>
  typeof value === "string" ? value : "";

export function ShipmentPlanDialog({
  client,
  customerOrderId,
  onClose,
  onPlanned,
}: {
  client: ApiClient;
  /** Fixed when planned from the order itself; chosen here otherwise. */
  customerOrderId?: string;
  onClose: () => void;
  onPlanned: (shipmentId: string) => Promise<void>;
}) {
  const { locale } = useI18n();
  const ar = locale === "ar";
  const txt = (en: string, arabic: string) => (ar ? arabic : en);
  const [orderId, setOrderId] = useState(customerOrderId ?? "");
  const [mode, setMode] = useState("LOCAL_TRUCK");
  const [planned, setPlanned] = useState("");
  const [expected, setExpected] = useState("");
  const [forty, setForty] = useState("");
  const [twenty, setTwenty] = useState("");
  const [trucks, setTrucks] = useState("");
  const [weight, setWeight] = useState("");
  const [note, setNote] = useState("");

  const orders = useQuery({
    queryKey: ["customer-orders", "shippable"],
    enabled: customerOrderId === undefined,
    queryFn: async () =>
      rows(
        (
          await commercialRequest(client, "GET", "/customer-orders", {
            path: {},
            query: { page: 1, limit: 200 },
          })
        ).data,
      ).filter((row) => SHIPPABLE.includes(text(row.statusCode))),
  });
  const chosen = useQuery({
    queryKey: ["customer-order", orderId],
    enabled: orderId !== "",
    queryFn: async () => {
      const result = await commercialRequest(
        client,
        "GET",
        "/customer-orders/{customerOrderId}",
        { path: { customerOrderId: orderId } },
      );
      return isObject(result.data) && isObject(result.data.data)
        ? result.data.data
        : {};
    },
  });
  const order = chosen.data ?? {};
  // What the Cargo Loader worked out for this order's quotation, if anyone
  // has loaded it in this session: filled in once, still editable.
  const handoff = text(order.quotationId)
    ? recallCargoPlan(text(order.quotationId))
    : null;
  const [usedHandoff, setUsedHandoff] = useState("");
  useEffect(() => {
    if (handoff === null || usedHandoff === handoff.savedAt) return;
    setUsedHandoff(handoff.savedAt);
    const count = (type: string) =>
      String(handoff.units.find((unit) => unit.typeCode === type)?.count ?? "");
    setForty(count("CONTAINER_40"));
    setTwenty(count("CONTAINER_20"));
    setTrucks(count("TRUCK"));
    if (handoff.totalWeightKg > 0) setWeight(String(handoff.totalWeightKg));
    if (handoff.units.some((unit) => unit.typeCode !== "TRUCK"))
      setMode("SEA_CONTAINER");
  }, [handoff, usedHandoff]);
  // The order's own weight, as a starting point for the load.
  const orderWeight = Array.isArray(order.lines)
    ? order.lines
        .filter(isObject)
        .reduce((sum, line) => sum + (Number(line.weightKg) || 0), 0)
    : 0;

  const units = [
    { typeCode: "CONTAINER_40", count: Number(forty) || 0 },
    { typeCode: "CONTAINER_20", count: Number(twenty) || 0 },
    { typeCode: "TRUCK", count: Number(trucks) || 0 },
  ].filter((unit) => unit.count > 0);

  const plan = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        customerOrderId: orderId,
        businessOccurredAt: new Date().toISOString(),
        transportModeCode: mode,
      };
      if (planned) body.plannedDispatchDate = planned;
      if (expected) body.expectedDeliveryDate = expected;
      if (units.length > 0 || weight || note.trim())
        body.loadPlan = {
          units,
          ...(weight ? { totalWeightKg: Number(weight) } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
        };
      const result = await commercialRequest(client, "POST", "/shipments", {
        path: {},
        body,
        idempotencyKey: crypto.randomUUID(),
      });
      const data =
        isObject(result.data) && isObject(result.data.data)
          ? result.data.data
          : {};
      return text(data.shipmentId);
    },
    onSuccess: (id) => onPlanned(id),
  });

  const lateExpected = expected !== "" && planned !== "" && expected < planned;
  return (
    <SlideOver title={txt("Plan a shipment", "تخطيط شحنة")} onClose={onClose}>
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
        {customerOrderId === undefined && orders.data?.length === 0 && (
          <p className="settings-hint">
            {txt(
              "No order is ready to ship: an order has to be confirmed first.",
              "مفيش أوردر جاهز للشحن: لازم الأوردر يتأكد الأول.",
            )}
          </p>
        )}
        {text(order.requestedDeliveryDate) && (
          <p className="settings-hint">
            {txt(
              "The customer asked for delivery by",
              "العميل طالب التسليم قبل",
            )}{" "}
            <strong>{text(order.requestedDeliveryDate)}</strong>
          </p>
        )}
        <label>
          {txt("How it travels", "طريقة النقل")}
          <select
            value={mode}
            onChange={(event) => {
              setMode(event.target.value);
            }}
          >
            <option value="LOCAL_TRUCK">
              {txt("Truck to site", "عربية للموقع")}
            </option>
            <option value="SEA_CONTAINER">
              {txt("Sea container (export)", "حاوية بحري (تصدير)")}
            </option>
          </select>
        </label>
        <div className="shipment-plan-dates">
          <label>
            {txt("Leaves on", "خروج يوم")}
            <input
              type="date"
              value={planned}
              onChange={(event) => {
                setPlanned(event.target.value);
              }}
            />
          </label>
          <label>
            {txt("Customer can expect it", "يوصل العميل يوم")}
            <input
              type="date"
              value={expected}
              min={planned || undefined}
              onChange={(event) => {
                setExpected(event.target.value);
              }}
            />
          </label>
        </div>
        {lateExpected && (
          <p className="form-error">
            {txt(
              "It cannot arrive before it leaves.",
              "مينفعش توصل قبل ما تخرج.",
            )}
          </p>
        )}
        <fieldset className="shipment-plan-units">
          <legend>{txt("What it fills", "الحمولة")}</legend>
          <label>
            {txt("40 ft containers", "حاويات 40 قدم")}
            <input
              inputMode="numeric"
              value={forty}
              onChange={(e) => {
                setForty(e.target.value);
              }}
            />
          </label>
          <label>
            {txt("20 ft containers", "حاويات 20 قدم")}
            <input
              inputMode="numeric"
              value={twenty}
              onChange={(e) => {
                setTwenty(e.target.value);
              }}
            />
          </label>
          <label>
            {txt("Trucks", "عربيات")}
            <input
              inputMode="numeric"
              value={trucks}
              onChange={(e) => {
                setTrucks(e.target.value);
              }}
            />
          </label>
          <label>
            {txt("Total weight (kg)", "الوزن الإجمالي (كجم)")}
            <input
              inputMode="decimal"
              value={weight}
              placeholder={
                orderWeight > 0 ? String(Math.round(orderWeight)) : ""
              }
              onChange={(e) => {
                setWeight(e.target.value);
              }}
            />
          </label>
        </fieldset>
        {handoff !== null && (
          <p className="settings-hint">
            {txt(
              "Filled in from the Cargo Loader's plan for this quotation.",
              "اتملى من خطة محمّل الحاويات لعرض السعر ده.",
            )}
          </p>
        )}
        {text(order.quotationId) && (
          <p className="settings-hint">
            <Link
              to={`/logistics/cargo-loader?quotationId=${text(order.quotationId)}`}
            >
              {txt(
                "Work out the containers in the Cargo Loader →",
                "احسب الحاويات في محمّل الحاويات ←",
              )}
            </Link>
          </p>
        )}
        <label>
          {txt("Note for the loading team", "ملاحظة لفريق التحميل")}
          <textarea
            value={note}
            maxLength={1000}
            onChange={(event) => {
              setNote(event.target.value);
            }}
          />
        </label>
        <ErrorBanner
          error={plan.error}
          retry={() => {
            plan.mutate();
          }}
        />
        <button
          className="primary"
          disabled={orderId === "" || plan.isPending || lateExpected}
        >
          {plan.isPending ? "…" : txt("Plan shipment", "خطّط الشحنة")}
        </button>
      </form>
    </SlideOver>
  );
}
