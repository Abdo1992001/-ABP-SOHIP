import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApiClient } from "@abp/api-client";
import { useNavigate, useParams } from "react-router";
import { useI18n } from "../i18n/i18n.tsx";
import { ErrorBanner, ScreenIntro } from "./CommercialUI.tsx";
import { isObject, rows, str } from "./commercial-api.ts";
import { enumLabel } from "../i18n/enum-labels.ts";
import {
  finishDownload,
  failDownload,
  saveBlob,
  startDownload,
} from "../lib/downloads.ts";
import {
  buildCsvTemplate,
  buildTemplate,
  templateFor,
} from "../lib/import-templates.ts";

type ImportJob = Record<string, unknown> & {
  importJobId: string;
  sourceSystemId: string;
  statusCode: string;
  fileName?: string | null;
  currentPreviewFingerprint?: string | null;
};

const pendingStatuses = new Set([
  "VALIDATING",
  "COMMIT_REQUESTED",
  "ROLLBACK_REQUESTED",
]);

export function SmartImportPage({ client }: { client: ApiClient }) {
  const { locale } = useI18n();
  const { jobId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [sourceSystemCode, setSourceSystemCode] = useState("LOCAL_UAT");
  const [importTypeCode, setImportTypeCode] = useState("CUSTOMERS");
  const [mappingVersion, setMappingVersion] = useState("v1");
  const [selectedJobId, setSelectedJobId] = useState(jobId ?? "");
  const [reconciliationRunId, setReconciliationRunId] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (jobId) setSelectedJobId(jobId);
  }, [jobId]);

  const jobs = useQuery({
    queryKey: ["import-jobs"],
    queryFn: async () => {
      const response = await client.GET("/import-jobs", {
        params: { query: { page: 1, limit: 25 } },
      });
      if (!response.data) throw apiError(response.response.status);
      return rows(response.data);
    },
    retry: false,
  });
  const detail = useQuery({
    queryKey: ["import-job", selectedJobId],
    enabled: Boolean(selectedJobId),
    queryFn: async () => {
      const response = await client.GET("/import-jobs/{jobId}", {
        params: { path: { jobId: selectedJobId } },
      });
      if (!response.data) throw apiError(response.response.status);
      return dataObject(response.data) as ImportJob;
    },
    refetchInterval: (query) =>
      pendingStatuses.has(str(query.state.data?.statusCode)) ? 1200 : false,
    retry: false,
  });
  const previewRows = useQuery({
    queryKey: ["import-rows", selectedJobId],
    enabled: Boolean(selectedJobId),
    queryFn: async () => {
      const response = await client.GET("/import-jobs/{jobId}/rows", {
        params: {
          path: { jobId: selectedJobId },
          query: { page: 1, limit: 50 },
        },
      });
      if (!response.data) throw apiError(response.response.status);
      return rows(response.data);
    },
    retry: false,
  });
  const issues = useQuery({
    queryKey: ["import-issues", selectedJobId],
    enabled: Boolean(selectedJobId),
    queryFn: async () => {
      const response = await client.GET("/import-jobs/{jobId}/issues", {
        params: {
          path: { jobId: selectedJobId },
          query: { page: 1, limit: 50 },
        },
      });
      if (!response.data) throw apiError(response.response.status);
      return rows(response.data);
    },
    retry: false,
  });
  const reconciliation = useQuery({
    queryKey: ["import-reconciliation", reconciliationRunId],
    enabled: Boolean(reconciliationRunId),
    queryFn: async () => {
      const response = await client.GET("/reconciliation-runs/{runId}", {
        params: { path: { runId: reconciliationRunId } },
      });
      if (!response.data) throw apiError(response.response.status);
      return dataObject(response.data);
    },
    refetchInterval: (query) =>
      ["PENDING", "RUNNING"].includes(str(query.state.data?.statusCode))
        ? 1000
        : false,
    retry: false,
  });

  const upload = useMutation({
    mutationFn: async () => {
      if (!file)
        throw new Error(
          label(locale, "Choose a CSV or XLSX file", "اختر ملف CSV أو XLSX"),
        );
      const created = await client.POST("/import-jobs", {
        params: { header: { "Idempotency-Key": crypto.randomUUID() } },
        body: {
          sourceSystemCode,
          importTypeCode,
          fileName: file.name,
          expectedSizeBytes: file.size,
          mimeType: mimeFor(file),
        },
      });
      if (!created.data) throw apiError(created.response.status);
      const newJob = dataObject(created.data) as ImportJob;
      const uploaded = await client.POST("/import-jobs/{jobId}/file", {
        params: {
          path: { jobId: newJob.importJobId },
          query: { parserVersion: "safe-1", mappingVersion },
        },
        headers: { "Content-Type": "application/octet-stream" },
        body: file as unknown as string,
        bodySerializer: (body) => body as unknown as BodyInit,
      });
      if (!uploaded.data) throw apiError(uploaded.response.status);
      return dataObject(uploaded.data) as ImportJob;
    },
    onSuccess: async (job) => {
      setSelectedJobId(job.importJobId);
      setNotice(
        label(
          locale,
          "File detected, mapped and validated. Review the preview before commit.",
          "تم اكتشاف الملف وربط أعمدته والتحقق منه. راجع المعاينة قبل الاعتماد.",
        ),
      );
      void navigate(`/data/imports/${job.importJobId}`);
      await refresh(queryClient, job.importJobId);
    },
  });
  const commit = useMutation({
    mutationFn: async () => {
      const job = detail.data;
      if (!job?.currentPreviewFingerprint)
        throw new Error("IMPORT_PREVIEW_REQUIRED");
      const response = await client.POST("/import-jobs/{jobId}/commit", {
        params: {
          path: { jobId: job.importJobId },
          header: { "Idempotency-Key": crypto.randomUUID() },
        },
        body: { previewFingerprint: job.currentPreviewFingerprint },
      });
      if (!response.data) throw apiError(response.response.status);
      return dataObject(response.data) as ImportJob;
    },
    onSuccess: async (job) => {
      setNotice(
        label(
          locale,
          "Commit queued. Status refreshes automatically.",
          "تم إرسال الاعتماد. تتحدث الحالة تلقائيًا.",
        ),
      );
      await refresh(queryClient, job.importJobId);
    },
  });
  const reconcile = useMutation({
    mutationFn: async () => {
      const job = detail.data;
      if (!job) throw new Error("IMPORT_JOB_REQUIRED");
      const response = await client.POST("/reconciliation-runs", {
        params: { header: { "Idempotency-Key": crypto.randomUUID() } },
        body: {
          reconciliationTypeCode: "IMPORT_VS_CANONICAL",
          sourceSystemId: job.sourceSystemId,
          filters: { importJobId: job.importJobId },
        },
      });
      if (!response.data) throw apiError(response.response.status);
      return dataObject(response.data);
    },
    onSuccess: (run) => {
      setReconciliationRunId(str(run.reconciliationRunId));
      setNotice(
        label(
          locale,
          "Reconciliation run started with full audit lineage.",
          "بدأت المطابقة مع الاحتفاظ بمسار تدقيق كامل.",
        ),
      );
    },
  });

  const summary = useMemo(
    () => classify(previewRows.data ?? [], issues.data ?? []),
    [previewRows.data, issues.data],
  );
  const error =
    upload.error ??
    commit.error ??
    reconcile.error ??
    jobs.error ??
    detail.error ??
    previewRows.error ??
    issues.error ??
    reconciliation.error;
  const job = detail.data;
  const canCommit = job?.statusCode === "PREVIEWED" && summary.error === 0;

  return (
    <section className="smart-import-page">
      <header className="page-heading smart-import-heading">
        <div>
          <p className="eyebrow" data-abp-caption>
            {label(locale, "ERP & DATA", "ERP والبيانات")}
          </p>
          <h1>{label(locale, "Smart Import", "الاستيراد الذكي")}</h1>
          <p>
            {label(
              locale,
              "Auditable CSV/XLSX intake with schema detection, validation and reconciliation.",
              "استيراد CSV/XLSX قابل للتدقيق مع اكتشاف البنية والتحقق والمطابقة.",
            )}
          </p>
        </div>
        <span className="scope-pill">CSV · XLSX · 100 MB max</span>
      </header>
      <ScreenIntro />

      <ol
        className="import-stepper"
        aria-label={label(locale, "Import progress", "مراحل الاستيراد")}
      >
        {[
          "Upload",
          "Detect",
          "Map",
          "Validate",
          "Review",
          "Commit",
          "Reconcile",
        ].map((step, index) => (
          <li
            key={step}
            className={stepState(
              index,
              job?.statusCode,
              str(reconciliation.data?.statusCode),
            )}
          >
            <span>{index + 1}</span>
            {label(locale, step, arabicStep(step))}
          </li>
        ))}
      </ol>

      <ErrorBanner
        error={error}
        retry={() => void refresh(queryClient, selectedJobId)}
      />
      {notice && (
        <div className="success-banner" role="status">
          {notice}
        </div>
      )}
      {reconciliation.data && (
        <div className="reconciliation-status" role="status">
          <span>{label(locale, "Reconciliation status", "حالة المطابقة")}</span>
          <strong>{str(reconciliation.data.statusCode)}</strong>
          <small>
            {str(reconciliation.data.reconciliationTypeCode)} ·{" "}
            {str(reconciliation.data.reconciliationRunId)}
          </small>
        </div>
      )}

      <div className="smart-import-grid">
        <form
          className="commercial-card import-upload-card"
          onSubmit={(event) => {
            event.preventDefault();
            setNotice("");
            upload.mutate();
          }}
        >
          <div className="card-header">
            <div>
              <h2>{label(locale, "1. Upload source", "1. رفع المصدر")}</h2>
              <p>
                {label(
                  locale,
                  "The file is parsed in memory and never executes formulas or macros.",
                  "يُحلل الملف في الذاكرة ولا تُنفذ الصيغ أو وحدات الماكرو.",
                )}
              </p>
            </div>
          </div>
          <label>
            {label(locale, "Source system", "نظام المصدر")}
            <input
              value={sourceSystemCode}
              pattern="[A-Z0-9_-]{2,50}"
              onChange={(event) => {
                setSourceSystemCode(event.target.value.toUpperCase());
              }}
              required
            />
          </label>
          <label>
            {label(locale, "Import type", "نوع الاستيراد")}
            <select
              value={importTypeCode}
              onChange={(event) => {
                setImportTypeCode(event.target.value);
              }}
            >
              {/* Only the kinds that actually write records. Finance was
                  offered here and committing it created nothing — the job
                  reported success for work it had not done. */}
              <option value="CUSTOMERS">
                {enumLabel("CUSTOMERS", locale)}
              </option>
              <option value="ITEM_MASTER">
                {enumLabel("ITEM_MASTER", locale)}
              </option>
              <option value="SALES_ORDERS">
                {enumLabel("SALES_ORDERS", locale)}
              </option>
            </select>
          </label>
          <label>
            {label(locale, "Mapping version", "إصدار الربط")}
            <input
              value={mappingVersion}
              pattern="[A-Za-z0-9._-]{1,50}"
              onChange={(event) => {
                setMappingVersion(event.target.value);
              }}
              required
            />
          </label>
          {/* The native file control writes its own button and "no file
              chosen" text in the *browser's* language, not the app's — an
              English control in the middle of an Arabic form, with no way to
              translate or style it. The input is still the input; it is just
              not the thing you see. */}
          <label className="import-file-drop">
            {label(locale, "CSV or XLSX file", "ملف CSV أو XLSX")}
            <input
              className="visually-hidden-input"
              type="file"
              accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
              }}
              required
            />
            <span className="import-file-button">
              {file
                ? label(locale, "Choose another file", "اختار ملف تاني")
                : label(locale, "Choose a file", "اختار ملف")}
            </span>
            <small>
              {file
                ? `${file.name} · ${formatBytes(file.size)}`
                : label(
                    locale,
                    "CSV or XLSX, up to 100 MB",
                    "CSV أو XLSX، لحد ١٠٠ ميجابايت",
                  )}
            </small>
          </label>
          <button
            className="primary-button"
            type="submit"
            disabled={upload.isPending}
          >
            {upload.isPending
              ? label(locale, "Processing…", "جارٍ التحليل…")
              : label(locale, "Upload, detect & validate", "رفع واكتشاف وتحقق")}
          </button>
        </form>
        <ImportTemplatePanel typeCode={importTypeCode} />

        <aside className="commercial-card import-history-card">
          <div className="card-header">
            <div>
              <h2>{label(locale, "Import history", "سجل الاستيراد")}</h2>
              <p>
                {label(
                  locale,
                  "Only jobs owned by your signed-in account are shown.",
                  "تظهر فقط المهام الخاصة بحسابك الحالي.",
                )}
              </p>
            </div>
          </div>
          <div className="import-history-list">
            {(jobs.data ?? []).map((item) => {
              const id = str(item.importJobId);
              const status =
                id === selectedJobId && job
                  ? job.statusCode
                  : str(item.statusCode);
              return (
                <button
                  type="button"
                  className={id === selectedJobId ? "active" : ""}
                  key={id}
                  onClick={() => {
                    setSelectedJobId(id);
                    void navigate(`/data/imports/${id}`);
                  }}
                >
                  <strong>{str(item.fileName)}</strong>
                  <span>{enumLabel(str(item.importTypeCode), locale)}</span>
                  <em className={`status-badge status-${status.toLowerCase()}`}>
                    {enumLabel(status, locale)}
                  </em>
                </button>
              );
            })}
          </div>
        </aside>
      </div>

      {job && (
        <>
          <section className="commercial-card import-review-card">
            <div className="card-header">
              <div>
                <h2>
                  {label(locale, "Preview & validation", "المعاينة والتحقق")}
                </h2>
                <p>
                  {job.fileName} · {job.statusCode}
                </p>
              </div>
              <button
                type="button"
                className="secondary-button"
                onClick={() => void refresh(queryClient, selectedJobId)}
              >
                {label(locale, "Refresh", "تحديث")}
              </button>
            </div>
            <div className="import-quality-summary">
              {(
                ["valid", "warning", "error", "duplicate", "review"] as const
              ).map((key) => (
                <div key={key}>
                  <span>{qualityLabel(locale, key)}</span>
                  <strong>{summary[key]}</strong>
                </div>
              ))}
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>{label(locale, "Row", "الصف")}</th>
                    <th>{label(locale, "Natural key", "المفتاح الطبيعي")}</th>
                    <th>{label(locale, "Status", "الحالة")}</th>
                    <th>{label(locale, "Issues", "المشكلات")}</th>
                    <th>
                      {label(locale, "Normalized preview", "المعاينة الموحدة")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(previewRows.data ?? []).map((row) => (
                    <tr key={str(row.rowNo)}>
                      <td>{str(row.rowNo)}</td>
                      <td>{str(row.naturalKey)}</td>
                      <td>
                        <span
                          className={`status-badge status-${str(row.statusCode).toLowerCase()}`}
                        >
                          {enumLabel(str(row.statusCode), locale)}
                        </span>
                      </td>
                      <td>{str(row.issueCount)}</td>
                      <td>
                        <NormalizedPreview fields={row.normalizedFields} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {(previewRows.data ?? []).length === 0 && (
              <div className="empty-state">
                {label(
                  locale,
                  "Upload a file to generate its review preview.",
                  "ارفع ملفًا لإنشاء معاينة المراجعة.",
                )}
              </div>
            )}
          </section>

          {(issues.data ?? []).length > 0 && (
            <section className="commercial-card import-issues-card">
              <div className="card-header">
                <div>
                  <h2>
                    {label(
                      locale,
                      "Data quality issues",
                      "مشكلات جودة البيانات",
                    )}
                  </h2>
                  <p>
                    {label(
                      locale,
                      "Blocking errors must be resolved before commit.",
                      "يجب حل الأخطاء المانعة قبل الاعتماد.",
                    )}
                  </p>
                </div>
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>{label(locale, "Severity", "الخطورة")}</th>
                      <th>{label(locale, "Rule", "القاعدة")}</th>
                      <th>{label(locale, "Record", "السجل")}</th>
                      <th>{label(locale, "Message", "الرسالة")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(issues.data ?? []).map((issue, index) => (
                      <tr key={str(issue.issueId ?? index)}>
                        <td>{str(issue.severityCode)}</td>
                        <td>{str(issue.issueCode)}</td>
                        <td>{str(issue.sourceRecordKey)}</td>
                        <td>{str(issue.message)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <footer className="import-action-bar">
            <div>
              <strong>
                {label(locale, "Controlled commit", "اعتماد محكوم")}
              </strong>
              <span>
                {summary.error > 0
                  ? label(
                      locale,
                      "Resolve blocking errors first.",
                      "حل الأخطاء المانعة أولًا.",
                    )
                  : label(
                      locale,
                      "Preview fingerprint will be locked at commit.",
                      "ستُثبت بصمة المعاينة عند الاعتماد.",
                    )}
              </span>
            </div>
            <button
              type="button"
              className="primary-button"
              disabled={!canCommit || commit.isPending}
              onClick={() => {
                commit.mutate();
              }}
            >
              {label(locale, "Commit validated rows", "اعتماد الصفوف المتحققة")}
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={job.statusCode !== "COMMITTED" || reconcile.isPending}
              onClick={() => {
                reconcile.mutate();
              }}
            >
              {label(locale, "Start reconciliation", "بدء المطابقة")}
            </button>
          </footer>
        </>
      )}
    </section>
  );
}

function dataObject(value: unknown): Record<string, unknown> {
  if (isObject(value) && isObject(value.data)) return value.data;
  if (isObject(value)) return value;
  throw new Error("INVALID_API_RESPONSE");
}
function apiError(status: number) {
  return new Error(`HTTP_${status.toString()}`);
}
function mimeFor(file: File) {
  return file.name.toLowerCase().endsWith(".xlsx")
    ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    : "text/csv";
}
function formatBytes(bytes: number) {
  return bytes < 1024
    ? `${bytes.toString()} B`
    : `${(bytes / 1024).toFixed(1)} KB`;
}
/**
 * What the importer made of one spreadsheet row.
 *
 * This used to print the raw JSON — braces, quotes and camelCase keys — in a
 * column headed "Normalized preview". The person reading it is checking
 * whether their file was understood, and `{"accountName":"...","countryCode"`
 * is not an answer to that question. The same values read as labelled pairs.
 */
function NormalizedPreview({ fields }: { fields: unknown }) {
  if (!isObject(fields)) return <span className="table-empty-cell">—</span>;
  const pairs = Object.entries(fields)
    .filter(([, value]) => value !== null && value !== "")
    .slice(0, 6);
  if (pairs.length === 0) return <span className="table-empty-cell">—</span>;
  return (
    <ul className="import-normalized">
      {pairs.map(([key, value]) => (
        <li key={key}>
          <span>{humanizeKey(key)}</span>
          <strong>{str(value)}</strong>
        </li>
      ))}
    </ul>
  );
}

function humanizeKey(key: string) {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/^./, (character) => character.toUpperCase());
}
function label(locale: "en" | "ar", en: string, ar: string) {
  return locale === "ar" ? ar : en;
}
function arabicStep(step: string) {
  return (
    (
      {
        Upload: "رفع",
        Detect: "اكتشاف",
        Map: "ربط",
        Validate: "تحقق",
        Review: "مراجعة",
        Commit: "اعتماد",
        Reconcile: "مطابقة",
      } as Record<string, string>
    )[step] ?? step
  );
}
function stepState(
  index: number,
  status?: string,
  reconciliationStatus?: string,
) {
  if (!status) return index === 0 ? "active" : "";
  if (reconciliationStatus === "COMPLETED") return "complete";
  const reached =
    status === "UPLOADED"
      ? 0
      : status === "PREVIEWED"
        ? 4
        : status === "COMMITTED"
          ? 6
          : status === "COMMIT_REQUESTED"
            ? 5
            : status === "FAILED"
              ? 4
              : 4;
  return index < reached ? "complete" : index === reached ? "active" : "";
}
function classify(
  preview: Record<string, unknown>[],
  issues: Record<string, unknown>[],
) {
  const errorIssues = issues.filter((item) =>
    ["ERROR", "BLOCKER"].includes(str(item.severityCode)),
  ).length;
  return {
    valid: preview.filter((item) => item.statusCode === "VALID").length,
    warning: issues.filter((item) => item.severityCode === "WARNING").length,
    error: errorIssues,
    duplicate: issues.filter((item) =>
      String(item.issueCode).includes("DUPLICATE"),
    ).length,
    review: issues.filter((item) => item.statusCode === "OPEN").length,
  };
}
function qualityLabel(
  locale: "en" | "ar",
  key: "valid" | "warning" | "error" | "duplicate" | "review",
) {
  const en = {
    valid: "VALID",
    warning: "WARNING",
    error: "ERROR",
    duplicate: "DUPLICATE CANDIDATE",
    review: "DQ REVIEW",
  };
  const ar = {
    valid: "صالح",
    warning: "تحذير",
    error: "خطأ",
    duplicate: "تكرار محتمل",
    review: "مراجعة الجودة",
  };
  return locale === "ar" ? ar[key] : en[key];
}
async function refresh(
  queryClient: ReturnType<typeof useQueryClient>,
  id: string,
) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["import-jobs"] }),
    queryClient.invalidateQueries({ queryKey: ["import-job", id] }),
    queryClient.invalidateQueries({ queryKey: ["import-rows", id] }),
    queryClient.invalidateQueries({ queryKey: ["import-issues", id] }),
  ]);
}

/**
 * The template for the import type chosen above: the exact columns the
 * importer reads, as an Excel or CSV file to fill and upload again, and the
 * same columns explained on screen.
 */
function ImportTemplatePanel({ typeCode }: { typeCode: string }) {
  const { locale } = useI18n();
  const ar = locale === "ar";
  const template = templateFor(typeCode);
  if (!template) return null;
  const save = async (kind: "xlsx" | "csv") => {
    const fileName =
      kind === "xlsx"
        ? template.fileName
        : template.fileName.replace(/\.xlsx$/, ".csv");
    const id = startDownload(fileName);
    try {
      const blob =
        kind === "xlsx"
          ? await buildTemplate(template, ar)
          : buildCsvTemplate(template);
      saveBlob(blob, fileName);
      finishDownload(id, blob.size);
    } catch (error) {
      failDownload(
        id,
        error instanceof Error ? error.message : "TEMPLATE_FAILED",
      );
    }
  };
  return (
    <section className="import-template panel">
      <header>
        <div>
          <h3>
            {ar ? "قالب" : "Template"} · {ar ? template.ar : template.en}
          </h3>
          <p className="settings-hint">
            {ar
              ? "نزّل القالب، املاه (صف واحد لكل سجل تحت العناوين)، وارفعه هنا. الأعمدة الحمرا مطلوبة. الرفع تاني بنفس الرقم بيحدّث السجل بدل ما يكرره."
              : "Download the template, fill one row per record under the headings, and upload it here. Red columns are required. Uploading the same number again updates the record instead of duplicating it."}
          </p>
        </div>
        <div className="import-template-actions">
          <button
            type="button"
            className="primary"
            onClick={() => void save("xlsx")}
          >
            {ar ? "نزّل قالب Excel" : "Download Excel template"}
          </button>
          <button type="button" onClick={() => void save("csv")}>
            CSV
          </button>
        </div>
      </header>
      <ul className="import-template-columns">
        {template.columns.map((column) => (
          <li key={column.key}>
            <code>{column.key}</code>
            {column.required && (
              <span className="import-required">
                {ar ? "مطلوب" : "Required"}
              </span>
            )}
            <p>{ar ? column.ar : column.en}</p>
            <small>
              {ar ? "مثال" : "e.g."} <code>{column.example}</code>
            </small>
          </li>
        ))}
      </ul>
    </section>
  );
}
