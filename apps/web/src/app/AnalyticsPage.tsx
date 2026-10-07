import {
  ErrorBanner,
  ScreenIntro,
  Sparkline,
  TabBar,
} from "./CommercialUI.tsx";
import { metricSeries, ReportCharts } from "./ReportCharts.tsx";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { ApiClient, components } from "@abp/api-client";
import {
  executeOperation,
  operationById,
  type OperationContract,
} from "../api/operation-runtime.ts";
import { useI18n } from "../i18n/i18n.tsx";
import type { Me } from "../api/customer-api.ts";
import { DataView } from "./ContractScreen.tsx";
import { ExportDelivery } from "./DocumentDownload.tsx";
import { metricText } from "../lib/metric-format.ts";
import { enumLabel } from "../i18n/enum-labels.ts";
import { localToday } from "../lib/today.ts";

/**
 * When these figures are current to.
 *
 * This printed the raw instant — `2026-09-21T16:05:12.424Z` — beside the page
 * title. It is the one line on the screen that tells a manager whether they
 * are looking at today's numbers, and it was written in the machine's format
 * rather than theirs.
 */
function asOfLabel(value: string | null | undefined, locale: "en" | "ar") {
  if (value === null || value === undefined || value === "") return "—";
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return value;
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(at);
}

type ReportDefinition = components["schemas"]["ReportDefinition"];
type ReportEnvelope = components["schemas"]["GovernedAnalyticsReportEnvelope"];
type DrilldownEnvelope = components["schemas"]["AnalyticsDrilldownEnvelope"];
type ExportEnvelope = components["schemas"]["AnalyticsExportEnvelope"];

const reportsOperation = required("get_analytics_registry_reports");
const reportNamesAr: Record<string, string> = {
  "RPT-001": "الأداء التجاري",
  "RPT-002": "التوزيع الجغرافي للعملاء",
  "RPT-003": "شبكة المجموعة",
  "RPT-004": "الفرص وعروض الأسعار",
  "RPT-005": "تحليل العملاء",
  "RPT-006": "طلبات المبيعات",
  "RPT-007": "شرائح العملاء والتسعير",
  "RPT-008": "اللوجستيات",
  "RPT-009": "الطاقة الإنتاجية",
  "RPT-010": "أسعار الصرف",
  "RPT-011": "المدفوعات والشيكات",
  "RPT-012": "المرتجعات والشكاوى",
  "RPT-013": "جودة البيانات",
  "RPT-014": "ملخص الإدارة الذكي",
  "RPT-015": "ملخص المبيعات",
  "RPT-016": "ملخص اللوجستيات",
  "RPT-017": "ملخص التشغيل",
  "RPT-018": "ملخص المالية",
};
const reportOperation = required("get_analytics_reports_by_reportId");
const drilldownOperation = required(
  "get_analytics_reports_by_reportId_drilldown",
);
const exportOperation = required("post_analytics_reports_by_reportId_exports");

/** A basis line that reads as English (or Arabic) whichever kind it is. */
function basisText(basis: string, locale: "en" | "ar"): string {
  // A reason code is the only thing that arrives in this shape; prose never
  // does, so nothing that already reads properly is touched.
  return /^[A-Z][A-Z0-9_]{3,}$/.test(basis.trim())
    ? enumLabel(basis.trim(), locale)
    : basis;
}

export function AnalyticsPage({ client, me }: { client: ApiClient; me: Me }) {
  const { locale } = useI18n();
  const [reportId, setReportId] = useState("RPT-004");
  const [currency, setCurrency] = useState<"USD" | "EGP">("USD");
  const [asOf, setAsOf] = useState(() => localToday());
  const [showDrilldown, setShowDrilldown] = useState(false);
  const [selectedMetric, setSelectedMetric] = useState("");
  const [stageCode, setStageCode] = useState("");
  const [page, setPage] = useState(1);
  const registry = useQuery({
    queryKey: ["analytics", "reports-registry"],
    queryFn: async () => {
      const result = await executeOperation(client, reportsOperation, {
        path: {},
      });
      return result.data as { data: ReportDefinition[] };
    },
  });
  const definitions = registry.data?.data ?? [];
  const selected = useMemo(
    () => definitions.find((item) => item.reportId === reportId),
    [definitions, reportId],
  );
  const report = useQuery({
    queryKey: ["analytics", "report", reportId, currency, asOf],
    queryFn: async () => {
      const result = await executeOperation(client, reportOperation, {
        path: { reportId },
        query: {
          asOf: `${asOf}T23:59:59.999Z`,
          currency,
        },
      });
      return result.data as ReportEnvelope;
    },
    enabled: definitions.length > 0,
  });
  const drilldown = useQuery({
    queryKey: [
      "analytics",
      "drilldown",
      reportId,
      currency,
      asOf,
      selectedMetric,
      stageCode,
      page,
    ],
    queryFn: async () => {
      const result = await executeOperation(client, drilldownOperation, {
        path: { reportId },
        query: {
          asOf: `${asOf}T23:59:59.999Z`,
          currency,
          offset: (page - 1) * 25,
          limit: 25,
          sort: "date_desc",
          ...(selectedMetric ? { metricId: selectedMetric } : {}),
          ...(stageCode ? { stageCode } : {}),
        },
      });
      return result.data as DrilldownEnvelope;
    },
    enabled: showDrilldown && definitions.length > 0,
  });
  const createExport = useMutation({
    mutationFn: async (formatCode: "CSV" | "XLSX" | "PDF") => {
      const result = await executeOperation(client, exportOperation, {
        path: { reportId },
        body: {
          formatCode,
          asOf: `${asOf}T23:59:59.999Z`,
          currency,
        },
        idempotencyKey: crypto.randomUUID(),
      });
      return result.data as ExportEnvelope;
    },
  });
  const labels = locale === "ar" ? ar : en;

  if (registry.isLoading)
    return <div className="app-state">{labels.loading}</div>;
  // An unreachable report registry is still the Reports screen. Dropping the
  // header for the error state leaves a bare red sentence on an empty page,
  // which tells the reader neither what they opened nor what is wrong with it
  // — and it is the state in which they are least able to guess.
  if (registry.isError || definitions.length === 0)
    return (
      <section className="analytics-page" aria-labelledby="analytics-title">
        <header className="page-heading">
          <div>
            <p className="eyebrow" data-abp-caption>
              {labels.semanticAuthority}
            </p>
            <h1 id="analytics-title">{labels.title}</h1>
          </div>
        </header>
        <ScreenIntro />
        <div className="app-state denied" role="alert">
          {labels.unavailable}
          <ErrorBanner
            error={registry.error}
            retry={() => void registry.refetch()}
          />
        </div>
      </section>
    );

  return (
    <section className="analytics-page" aria-labelledby="analytics-title">
      <header className="page-heading">
        <div>
          <p className="eyebrow" data-abp-caption>
            {labels.semanticAuthority}
          </p>
          <h1 id="analytics-title">{labels.title}</h1>
          <p>{labels.note}</p>
        </div>
        <div className="analytics-freshness" aria-live="polite">
          <span>{labels.asOf}</span>
          <strong>{asOfLabel(report.data?.data.asOf, locale)}</strong>
        </div>
      </header>
      <ScreenIntro />

      <TabBar
        tabs={definitions.map((item) => ({
          id: item.reportId,
          en: item.name,
          ar: reportNamesAr[item.reportId] ?? item.name,
        }))}
        active={reportId}
        onChange={(value) => {
          setReportId(value);
          createExport.reset();
          setShowDrilldown(false);
          setSelectedMetric("");
          setStageCode("");
          setPage(1);
        }}
      />
      <form
        className="analytics-filters"
        onSubmit={(event) => {
          event.preventDefault();
        }}
      >
        <label>
          {labels.asOf}
          <input
            type="date"
            value={asOf}
            onChange={(event) => {
              setAsOf(event.target.value);
            }}
          />
        </label>
        <label>
          {labels.currency}
          <select
            value={currency}
            onChange={(event) => {
              setCurrency(event.target.value as "USD" | "EGP");
            }}
          >
            <option value="USD">USD</option>
            <option value="EGP">EGP</option>
          </select>
        </label>
      </form>

      {report.isLoading && <div className="app-state">{labels.loading}</div>}
      {report.data && (
        <>
          <section className="analytics-summary" aria-label={labels.metrics}>
            {report.data.data.metrics.map((metric) => (
              <article className="metric-card" key={metric.metricId}>
                <small>
                  {metric.metricId} · v{metric.metricVersion}
                </small>
                <h2>{metric.name}</h2>
                {metric.availability === "AVAILABLE" ? (
                  <strong className="metric-value">
                    {/* Formatted, not printed raw: the envelope carries the
                        full precision of the division that produced it, and
                        Pipeline Aging was reading
                        "9.49899942418981483056 Percent" beside a Stage Value
                        of "2900000 USD" with no separators. The exact figure
                        stays in the envelope and in the export. */}
                    {metricText(metric.value, metric.unit, metric.currency)}
                  </strong>
                ) : (
                  <strong className="metric-unavailable">
                    {labels.notAvailable}
                  </strong>
                )}
                {/* The basis is prose for a metric that computed and a
                    reason code for one that did not, so a code is turned
                    into the sentence it stands for -- "ZERO_TARGET_
                    DENOMINATOR" under a missing figure told a manager
                    nothing about what to do. */}
                <p>{basisText(metric.basis, locale)}</p>
                <Sparkline data={metricSeries(metric)} />
                {(metric.dqContext.excludedDataConflict > 0 ||
                  metric.dqContext.unclassified > 0) && (
                  <p className="dq-note">
                    {labels.dq}: {metric.dqContext.excludedDataConflict} /{" "}
                    {metric.dqContext.unclassified}
                  </p>
                )}
              </article>
            ))}
          </section>

          <ReportCharts
            metrics={report.data.data.metrics}
            onSelect={(metric, stage) => {
              setSelectedMetric(metric);
              setStageCode(stage ?? "");
              setPage(1);
              setShowDrilldown(true);
            }}
          />
          <section className="analytics-actions" aria-label={labels.actions}>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setShowDrilldown((value) => !value);
              }}
            >
              {showDrilldown ? labels.hideDrilldown : labels.showDrilldown}
            </button>
            {(["CSV", "XLSX", "PDF"] as const)
              .filter(
                (format) =>
                  selected?.exportFormats.includes(format) &&
                  me.access.permissions.includes("data.export") &&
                  me.access.permissions.includes("exports.create"),
              )
              .map((format) => (
                <button
                  key={format}
                  type="button"
                  disabled={createExport.isPending}
                  onClick={() => {
                    createExport.mutate(format);
                  }}
                >
                  {labels.export} {format}
                </button>
              ))}
            {createExport.data && (
              <ExportDelivery
                client={client}
                exportId={createExport.data.data.exportId}
                analytics
              />
            )}
          </section>
        </>
      )}

      <ErrorBanner
        error={createExport.error}
        retry={() => {
          if (createExport.variables) {
            createExport.mutate(createExport.variables);
          }
        }}
      />
      <ErrorBanner error={report.error} retry={() => void report.refetch()} />
      {showDrilldown && (
        <section
          className="analytics-drilldown"
          aria-labelledby="drilldown-title"
        >
          <h2 id="drilldown-title">
            {labels.drilldown} {selectedMetric}
          </h2>
          <ErrorBanner
            error={drilldown.error}
            retry={() => void drilldown.refetch()}
          />
          {drilldown.isLoading && (
            <div
              className="skeleton-stack"
              aria-label={labels.loading}
              role="status"
            >
              <span />
              <span />
              <span />
            </div>
          )}
          {drilldown.data && (
            <>
              <DataView value={drilldown.data.data} />
              <footer className="pagination">
                <button
                  disabled={page === 1}
                  onClick={() => {
                    setPage(page - 1);
                  }}
                >
                  {locale === "ar" ? "السابق" : "Previous"}
                </button>
                <span>{page}</span>
                <button
                  disabled={!drilldown.data.meta.hasNext}
                  onClick={() => {
                    setPage(page + 1);
                  }}
                >
                  {locale === "ar" ? "التالي" : "Next"}
                </button>
              </footer>
            </>
          )}
        </section>
      )}
    </section>
  );
}

function required(operationId: string): OperationContract {
  const operation = operationById.get(operationId);
  if (!operation) throw new Error(`ANALYTICS_OPERATION_MISSING_${operationId}`);
  return operation;
}

const en = {
  title: "Reporting & intelligence",
  semanticAuthority: "Commercial performance",
  note: "Compare performance, explore details, and export your reports.",
  report: "Report",
  asOf: "As of",
  currency: "Currency",
  loading: "Loading reports…",
  unavailable: "Reports are temporarily unavailable.",
  notAvailable: "Not available",
  metrics: "Performance metrics",
  dq: "Excluded conflicts / unclassified",
  actions: "Report actions",
  showDrilldown: "Open drilldown",
  hideDrilldown: "Close drilldown",
  export: "Export",
  job: "Job",
  drilldown: "Report details",
  drilldownDenied: "Drilldown is unavailable or not authorized.",
  serverRows: "Server-authorized rows",
  row: "Row",
  authoritativeProjection: "Authoritative projection",
};
const ar: typeof en = {
  title: "التقارير والذكاء",
  semanticAuthority: "الأداء التجاري",
  note: "قارن الأداء واستعرض التفاصيل وصدّر التقارير.",
  report: "التقرير",
  asOf: "حتى",
  currency: "العملة",
  loading: "جاري تحميل التحليلات المعتمدة…",
  unavailable: "التحليلات غير متاحة، ولن يتم عرض بيانات تجريبية بديلة.",
  notAvailable: "غير متاح",
  metrics: "المؤشرات المعتمدة",
  dq: "التعارضات المستبعدة / غير المصنف",
  actions: "إجراءات التقرير",
  showDrilldown: "فتح التفاصيل",
  hideDrilldown: "إغلاق التفاصيل",
  export: "تصدير",
  job: "المهمة",
  drilldown: "التفاصيل المصرح بها",
  drilldownDenied: "التفاصيل غير متاحة أو غير مصرح بها.",
  serverRows: "صفوف مصرح بها من الخادم",
  row: "الصف",
  authoritativeProjection: "العرض المعتمد",
};
