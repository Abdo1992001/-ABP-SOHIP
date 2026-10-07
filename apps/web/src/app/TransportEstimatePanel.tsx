import { useState } from "react";
import { useI18n } from "../i18n/i18n.tsx";
import { estimateTransport } from "../lib/transport-estimate.ts";

/**
 * Quick, stateless trips/cost estimator — mirrors ABP Engineering Studio's
 * transport utility calc. Never saved anywhere; purely a planning aid.
 * Usable standalone (blank inputs) or pre-filled from an open Logistics plan.
 */
export function TransportEstimatePanel({
  initialTotalWeightKg = "",
  initialTruckCapacityKg = "",
}: {
  initialTotalWeightKg?: string;
  initialTruckCapacityKg?: string;
}) {
  const { locale } = useI18n();
  const [totalWeightKg, setTotalWeightKg] = useState(initialTotalWeightKg);
  const [truckCapacityKg, setTruckCapacityKg] = useState(
    initialTruckCapacityKg,
  );
  const [minimumTrips, setMinimumTrips] = useState("0");
  const [costPerTrip, setCostPerTrip] = useState("");
  const [extraCost, setExtraCost] = useState("0");

  const result =
    totalWeightKg && truckCapacityKg
      ? estimateTransport({
          totalWeightKg: Number(totalWeightKg),
          truckCapacityKg: Number(truckCapacityKg),
          minimumTrips: Number(minimumTrips || 0),
          costPerTrip: Number(costPerTrip || 0),
          extraCost: Number(extraCost || 0),
        })
      : null;

  return (
    <div className="transport-estimate-panel">
      <p className="transport-estimate-note">
        {locale === "ar"
          ? "حساب سريع تقديري لعدد الرحلات والتكلفة — غير محفوظ، للتخطيط فقط."
          : "Quick trips/cost estimate — not saved, planning aid only."}
      </p>
      <div className="transport-estimate-grid">
        <label>
          {locale === "ar" ? "إجمالي الوزن (كجم)" : "Total weight (kg)"}
          <input
            type="number"
            min="0"
            step="any"
            value={totalWeightKg}
            onChange={(event) => {
              setTotalWeightKg(event.target.value);
            }}
          />
        </label>
        <label>
          {locale === "ar" ? "سعة الشاحنة (كجم)" : "Truck capacity (kg)"}
          <input
            type="number"
            min="0"
            step="any"
            value={truckCapacityKg}
            onChange={(event) => {
              setTruckCapacityKg(event.target.value);
            }}
          />
        </label>
        <label>
          {locale === "ar" ? "الحد الأدنى للرحلات" : "Minimum trips"}
          <input
            type="number"
            min="0"
            step="1"
            value={minimumTrips}
            onChange={(event) => {
              setMinimumTrips(event.target.value);
            }}
          />
        </label>
        <label>
          {locale === "ar" ? "تكلفة الرحلة" : "Cost per trip"}
          <input
            type="number"
            min="0"
            step="any"
            value={costPerTrip}
            onChange={(event) => {
              setCostPerTrip(event.target.value);
            }}
          />
        </label>
        <label>
          {locale === "ar" ? "تكلفة إضافية" : "Extra cost"}
          <input
            type="number"
            min="0"
            step="any"
            value={extraCost}
            onChange={(event) => {
              setExtraCost(event.target.value);
            }}
          />
        </label>
      </div>
      {result && (
        <div className="transport-estimate-results">
          <div>
            <span>{locale === "ar" ? "عدد الرحلات" : "Trips"}</span>
            <strong>{result.trips}</strong>
          </div>
          <div>
            <span>{locale === "ar" ? "نسبة الاستغلال" : "Utilization"}</span>
            <strong>{result.utilizationPct.toFixed(1)}%</strong>
          </div>
          <div>
            <span>{locale === "ar" ? "التكلفة الإجمالية" : "Total cost"}</span>
            <strong>{result.totalCost.toFixed(2)}</strong>
          </div>
        </div>
      )}
    </div>
  );
}
