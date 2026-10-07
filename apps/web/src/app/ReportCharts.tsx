import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useI18n } from "../i18n/i18n.tsx";
import { enumLabel } from "../i18n/enum-labels.ts";
import type { components } from "@abp/api-client";
type Metric = components["schemas"]["GovernedMetricResult"];
function objectStringValue(value: unknown, key: string): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "string" ? candidate : undefined;
}
export function metricSeries(metric: Metric | undefined): number[] {
  if (!metric || metric.availability !== "AVAILABLE") return [];
  const values = (metric.breakdown ?? [])
    .map((row) => Number(row.value))
    .filter(Number.isFinite);
  return values.length
    ? values
    : metric.value !== null
      ? [Number(metric.value)]
      : [];
}
export function ReportCharts({
  metrics,
  onSelect,
}: {
  metrics: readonly Metric[];
  onSelect: (metric: string, stage?: string) => void;
}) {
  const { locale } = useI18n();
  const chartMetrics = metrics.filter(
    (metric) => metric.availability === "AVAILABLE" && metric.value !== null,
  );
  const reference = chartMetrics.at(0);
  const series = reference
    ? chartMetrics
        .filter(
          (metric) =>
            metric.unit === reference.unit &&
            metric.currency === reference.currency,
        )
        .map((metric) => ({
          name: metric.name,
          value: Number(metric.value),
          id: metric.metricId,
        }))
    : [];
  const breakdown = chartMetrics.find(
    (metric) => (metric.breakdown ?? []).length > 1,
  );
  const trend =
    breakdown?.breakdown?.map((row) => ({
      name: enumLabel(row.label, locale),
      key: row.key,
      value: Number(row.value),
    })) ?? [];
  return (
    <div className="charts-grid">
      <article className="chart-card">
        <h2 className="chart-title">
          {locale === "ar"
            ? "مقارنة مؤشرات التقرير"
            : `Report metric comparison (${reference?.currency ?? reference?.unit ?? ""})`}
        </h2>
        <ResponsiveContainer width="100%" height={300} minWidth={1}>
          <BarChart data={series}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="name" hide />
            <YAxis />
            <Tooltip />
            <Bar
              dataKey="value"
              fill="#0e0b53"
              radius={[4, 4, 0, 0]}
              onClick={(entry: unknown) => {
                const id = objectStringValue(entry, "id");
                if (id) onSelect(id);
              }}
            />
          </BarChart>
        </ResponsiveContainer>
        <div className="chart-legend">
          {series.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                onSelect(item.id);
              }}
            >
              {item.name}
            </button>
          ))}
        </div>
      </article>
      <article className="chart-card">
        <h2 className="chart-title">
          {breakdown?.name ??
            (locale === "ar" ? "تفاصيل المؤشر" : "Metric breakdown")}
        </h2>
        {trend.length && breakdown?.metricId.startsWith("MET-PIPE-") ? (
          <ResponsiveContainer width="100%" height={300} minWidth={1}>
            <BarChart data={trend} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" />
              <YAxis type="category" dataKey="name" width={115} />
              <Tooltip />
              <Bar
                dataKey="value"
                fill="#c81d25"
                onClick={(entry: unknown) => {
                  const key = objectStringValue(entry, "key");
                  if (key) onSelect(breakdown.metricId, key);
                }}
              />
            </BarChart>
          </ResponsiveContainer>
        ) : trend.length ? (
          <ResponsiveContainer width="100%" height={300} minWidth={1}>
            <AreaChart data={trend}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip />
              <Area
                type="monotone"
                dataKey="value"
                stroke="#c81d25"
                fill="#c81d25"
                fillOpacity={0.12}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <p>
            {locale === "ar"
              ? "لا تتوفر تفاصيل زمنية لهذا التقرير حتى الآن."
              : "No time series is available for this report yet."}
          </p>
        )}
      </article>
    </div>
  );
}
