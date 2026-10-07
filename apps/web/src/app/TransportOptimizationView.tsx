import { useI18n } from "../i18n/i18n.tsx";
import {
  transportMetrics,
  type LogisticsVisualization,
} from "./logistics-metrics.ts";

export function TransportOptimizationView({
  data,
}: {
  data: LogisticsVisualization;
}) {
  const { locale } = useI18n();
  const txt = (en: string, ar: string) => (locale === "ar" ? ar : en);
  const metrics = transportMetrics(data);
  const unit = data.transportUnits[0];
  const placements = unit
    ? data.placements.filter(
        (item) => item.planTransportUnitId === unit.planTransportUnitId,
      )
    : [];
  const unitLength = Number(unit?.lengthMmSnapshot ?? 1);
  const unitWidth = Number(unit?.widthMmSnapshot ?? 1);
  if (!unit || placements.length === 0)
    return (
      <div className="empty-state">
        <h2>{txt("No optimized placement yet", "لا يوجد توزيع محسن بعد")}</h2>
        <p>
          {txt(
            "Save the load manifest, then run Optimize.",
            "احفظ بيان الحمولة ثم شغّل التحسين.",
          )}
        </p>
      </div>
    );
  return (
    <div className="transport-acceptance">
      <dl className="transport-metrics">
        <Metric
          label={txt("Boards per layer", "ألواح بكل طبقة")}
          value={metrics.boardsPerLayer}
        />
        <Metric
          label={txt("Maximum layers", "أقصى عدد طبقات")}
          value={metrics.maximumLayers}
        />
        <Metric
          label={txt("Boards per trip", "ألواح بكل رحلة")}
          value={metrics.boardsPerTrip}
        />
        <Metric label={txt("Trips", "الرحلات")} value={metrics.trips} />
        <Metric
          label={txt("Payload utilization", "استغلال الحمولة")}
          value={`${metrics.payloadUtilization.toFixed(1)}%`}
        />
        <Metric
          label={txt("Area utilization", "استغلال المساحة")}
          value={`${metrics.areaUtilization.toFixed(1)}%`}
        />
        <Metric
          label={txt("Unfit quantity", "الكمية غير الملائمة")}
          value={metrics.unfitQuantity}
        />
      </dl>
      <section className="transport-unit-card">
        <div>
          <span className="eyebrow" data-abp-caption>
            {txt("2D PLACEMENT", "التوزيع ثنائي الأبعاد")}
          </span>
          <h3>
            {unit.nameSnapshot ?? txt("Transport unit", "وحدة النقل")} #
            {unit.instanceNo}
          </h3>
          <p>
            {unit.lengthMmSnapshot} × {unit.widthMmSnapshot} ×{" "}
            {unit.heightMmSnapshot} mm · {unit.maxWeightKgSnapshot} kg
          </p>
        </div>
        <svg
          className="transport-plan-svg"
          viewBox={`0 0 ${String(unitLength)} ${String(unitWidth)}`}
          role="img"
          aria-label={txt(
            "Calculated non-overlapping board placement",
            "توزيع الألواح المحسوب دون تداخل",
          )}
        >
          <rect
            x="0"
            y="0"
            width={unitLength}
            height={unitWidth}
            rx="90"
            className="truck-bed"
          />
          {placements.map((placement, index) => (
            <g key={placement.placementId}>
              <rect
                x={Number(placement.xMm)}
                y={Number(placement.yMm)}
                width={Number(placement.lengthMm)}
                height={Number(placement.widthMm)}
                rx="45"
                className={`board-placement board-${String((index % 3) + 1)}`}
              />
              <text
                x={Number(placement.xMm) + Number(placement.lengthMm) / 2}
                y={Number(placement.yMm) + Number(placement.widthMm) / 2}
                textAnchor="middle"
                dominantBaseline="middle"
              >
                {placement.stackQty} × {placement.rotationCode}°
              </text>
            </g>
          ))}
        </svg>
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
