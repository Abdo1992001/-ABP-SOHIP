import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import type { ApiClient, components } from "@abp/api-client";
import { useI18n } from "../i18n/i18n.tsx";
import { listProducts } from "../api/product-api.ts";
import { ErrorBanner, PageHeader, SlideOver } from "./CommercialUI.tsx";
import { enumLabel } from "../i18n/enum-labels.ts";

type Issue = components["schemas"]["DataQualityIssue"];
type ImportJob = components["schemas"]["ImportJob"];

/**
 * The review queue.
 *
 * The import pipeline deliberately refuses to guess: an ordered item it cannot
 * find in the item master is parked here instead of being invented as a product.
 * That only helps if a person can act on it, so every row offers the four
 * decisions that actually resolve it — map it to an existing item, create the
 * product, say it is a service or a charge, or accept it as-is.
 *
 * Each decision is applied to every order line carrying the same item code. The
 * same code appears on many orders; fixing one of them is not a fix.
 */
export function DataQualityPage({ client }: { client: ApiClient }) {
  const { locale } = useI18n();
  const ar = locale === "ar";
  const labels = ar ? arLabels : enLabels;
  const cache = useQueryClient();

  const [severity, setSeverity] = useState("REVIEW_REQUIRED");
  const [status, setStatus] = useState<"" | "OPEN" | "RESOLVED" | "WAIVED">(
    "OPEN",
  );
  const [search, setSearch] = useState("");
  const [active, setActive] = useState<Issue | null>(null);

  const jobs = useQuery({
    queryKey: ["import-jobs", "recent"],
    queryFn: async () => {
      const result = await client.GET("/import-jobs", {
        params: { query: { page: 1, limit: 10 } },
      });
      if (!result.data)
        throw new Error(`IMPORT_JOBS_${String(result.response.status)}`);
      return result.data.data as unknown as ImportJob[];
    },
  });

  const issues = useQuery({
    queryKey: ["dq-issues", { severity, status, search }],
    queryFn: async () => {
      const result = await client.GET("/data-quality/issues", {
        params: {
          query: {
            page: 1,
            limit: 100,
            ...(severity ? { severityCode: severity } : {}),
            ...(status ? { statusCode: status } : {}),
            ...(search.trim() ? { search: search.trim() } : {}),
          },
        },
      });
      if (!result.data)
        throw new Error(`DQ_ISSUES_${String(result.response.status)}`);
      return result.data as unknown as {
        data: Issue[];
        meta: { total: number };
      };
    },
  });

  const rows = issues.data?.data ?? [];

  return (
    <section className="dq-page">
      <PageHeader
        kicker={labels.kicker}
        title={labels.title}
        count={issues.data?.meta.total ?? 0}
        sub={labels.subtitle}
      />

      {/* The staging report, kept where the warnings are: a count of warnings
          means little without the counts it came from. */}
      <div className="dq-jobs">
        {(jobs.data ?? []).map((job) => (
          <article key={job.importJobId} className="dq-job-card">
            <header>
              <strong>
                {job.jobRef ?? enumLabel(job.importTypeCode, locale)}
              </strong>
              <span>{enumLabel(job.statusCode, locale)}</span>
            </header>
            <p className="dq-job-file">{job.fileName}</p>
            <dl>
              {summaryRows(job).map(([name, value]) => (
                <div key={name}>
                  <dt>{name}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </article>
        ))}
      </div>

      <div className="dq-filters">
        <input
          type="search"
          value={search}
          placeholder={labels.searchPlaceholder}
          aria-label={labels.searchPlaceholder}
          onChange={(event) => {
            setSearch(event.target.value);
          }}
        />
        <select
          value={severity}
          aria-label={labels.severity}
          onChange={(event) => {
            setSeverity(event.target.value);
          }}
        >
          <option value="">{labels.allSeverities}</option>
          <option value="REVIEW_REQUIRED">{labels.reviewRequired}</option>
          <option value="WARNING">{labels.warning}</option>
          <option value="ERROR">{labels.error}</option>
        </select>
        <select
          value={status}
          aria-label={labels.status}
          onChange={(event) => {
            setStatus(
              event.target.value as "" | "OPEN" | "RESOLVED" | "WAIVED",
            );
          }}
        >
          <option value="OPEN">{labels.open}</option>
          <option value="RESOLVED">{labels.resolved}</option>
          <option value="WAIVED">{labels.waived}</option>
          <option value="">{labels.allStatuses}</option>
        </select>
      </div>

      <ErrorBanner
        error={issues.error}
        retry={() => {
          void issues.refetch();
        }}
      />

      <div className="enterprise-table-scroll">
        <table className="enterprise-table">
          <thead>
            <tr>
              <th>{labels.severity}</th>
              <th>{labels.what}</th>
              <th>{labels.record}</th>
              <th>{labels.detail}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((issue) => (
              <tr key={issue.issueId}>
                <td>
                  <span
                    className={`dq-severity is-${issue.severityCode.toLowerCase()}`}
                  >
                    {labels.severities[issue.severityCode] ??
                      enumLabel(issue.severityCode, locale)}
                  </span>
                </td>
                {/* A rule this screen has no wording for fell through to the
                    stored code, so a new check arrived on screen as
                    ORDER_DATE_MISSING in the middle of an Arabic table.
                    enumLabel at least reads as a phrase. */}
                <td>
                  {labels.rules[issue.issueCode] ??
                    enumLabel(issue.issueCode, locale)}
                </td>
                <td className="dq-key">{issue.sourceRecordKey ?? "—"}</td>
                <td className="dq-message">{issue.message}</td>
                <td>
                  {issue.statusCode === "OPEN" ? (
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => {
                        setActive(issue);
                      }}
                    >
                      {labels.decide}
                    </button>
                  ) : (
                    <span className="dq-done">
                      {enumLabel(
                        issue.resolutionCode ?? issue.statusCode,
                        locale,
                      )}
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {!issues.isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={5} className="table-empty">
                  {labels.nothingToReview}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {active !== null && (
        <ResolvePanel
          client={client}
          issue={active}
          onClose={() => {
            setActive(null);
          }}
          onResolved={() => {
            setActive(null);
            void cache.invalidateQueries({ queryKey: ["dq-issues"] });
            void cache.invalidateQueries({ queryKey: ["erp-orders"] });
          }}
        />
      )}
    </section>
  );
}

function summaryRows(job: ImportJob): [string, string][] {
  const summary = job.summary;
  if (
    summary === null ||
    summary === undefined ||
    typeof summary !== "object"
  ) {
    return [];
  }
  const counters = (summary as { counters?: Record<string, unknown> }).counters;
  if (counters === undefined) return [];
  // Only the headline counters. The full set is useful in a log, not on a card.
  const wanted = [
    "Rows Read",
    "Customers Detected",
    "Countries Detected",
    "Sales Orders Detected",
    "Order Items Detected",
    "Products Loaded",
    "Unmatched Distinct Items",
  ];
  return wanted
    .filter((name) => counters[name] !== undefined)
    .map((name) => [name, String(counters[name])]);
}

function ResolvePanel({
  client,
  issue,
  onClose,
  onResolved,
}: {
  client: ApiClient;
  issue: Issue;
  onClose: () => void;
  onResolved: () => void;
}) {
  const { locale } = useI18n();
  const ar = locale === "ar";
  const labels = ar ? arLabels : enLabels;
  const [resolutionCode, setResolutionCode] = useState("MAP_TO_EXISTING");
  const [reason, setReason] = useState("");
  const [productSearch, setProductSearch] = useState(
    issue.sourceRecordKey ?? "",
  );
  const [mappingTargetId, setMappingTargetId] = useState("");

  const products = useQuery({
    queryKey: ["dq-product-search", productSearch],
    enabled: resolutionCode === "MAP_TO_EXISTING",
    queryFn: () =>
      listProducts(client, {
        page: 1,
        limit: 25,
        ...(productSearch.trim().length >= 2
          ? { search: productSearch.trim() }
          : {}),
      }),
  });

  const resolve = useMutation({
    mutationFn: async () => {
      const result = await client.POST(
        "/data-quality/issues/{issueId}/resolve",
        {
          params: {
            path: { issueId: issue.issueId },
            header: {
              "Idempotency-Key": crypto.randomUUID(),
              // Optimistic concurrency: resolving an issue someone else has
              // already decided must fail loudly, not overwrite their decision.
              "If-Match": `"rv-${issue.rowVersion ?? "1"}"`,
            },
          },
          body: {
            resolutionCode,
            reason: reason.trim() || labels.defaultReason,
            ...(resolutionCode === "MAP_TO_EXISTING" && mappingTargetId !== ""
              ? { mappingTargetId }
              : {}),
          },
        },
      );
      if (!result.data)
        throw new Error(`RESOLVE_${String(result.response.status)}`);
      return result.data;
    },
    onSuccess: onResolved,
  });

  const needsTarget =
    resolutionCode === "MAP_TO_EXISTING" && mappingTargetId === "";

  return (
    <SlideOver title={labels.decideTitle} onClose={onClose}>
      <p className="dq-panel-message">{issue.message}</p>
      <p className="dq-panel-key">
        <span>{labels.itemCode}</span>
        <strong>{issue.sourceRecordKey ?? "—"}</strong>
      </p>

      <ErrorBanner
        error={resolve.error}
        retry={() => {
          resolve.mutate();
        }}
      />

      <fieldset className="dq-choices">
        <legend>{labels.whatIsIt}</legend>
        {(
          [
            ["MAP_TO_EXISTING", labels.mapToExisting, labels.mapToExistingHint],
            ["CREATE_PRODUCT", labels.createProduct, labels.createProductHint],
            [
              "CLASSIFY_SERVICE",
              labels.classifyService,
              labels.classifyServiceHint,
            ],
            [
              "CLASSIFY_LOGISTICS",
              labels.classifyLogistics,
              labels.classifyLogisticsHint,
            ],
            ["WAIVE", labels.ignore, labels.ignoreHint],
          ] as [string, string, string][]
        ).map(([code, title, hint]) => (
          <label key={code} className="dq-choice">
            <input
              type="radio"
              name="resolution"
              value={code}
              checked={resolutionCode === code}
              onChange={() => {
                setResolutionCode(code);
              }}
            />
            <span>
              <strong>{title}</strong>
              <em>{hint}</em>
            </span>
          </label>
        ))}
      </fieldset>

      {resolutionCode === "MAP_TO_EXISTING" && (
        <div className="dq-map">
          <label>
            {labels.findProduct}
            <input
              type="search"
              value={productSearch}
              onChange={(event) => {
                setProductSearch(event.target.value);
              }}
            />
          </label>
          <label>
            {labels.product}
            <select
              value={mappingTargetId}
              onChange={(event) => {
                setMappingTargetId(event.target.value);
              }}
            >
              <option value="">
                {products.isLoading ? labels.loading : labels.chooseProduct}
              </option>
              {(products.data?.data ?? []).map((product) => (
                <option key={product.productId} value={product.productId}>
                  {product.canonicalDescription}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      <label className="dq-reason">
        {labels.reason}
        <textarea
          value={reason}
          maxLength={500}
          placeholder={labels.reasonPlaceholder}
          onChange={(event) => {
            setReason(event.target.value);
          }}
        />
      </label>

      <div className="dq-panel-actions">
        <button type="button" className="ghost-button" onClick={onClose}>
          {labels.cancel}
        </button>
        <button
          type="button"
          className="primary"
          disabled={resolve.isPending || needsTarget}
          onClick={() => {
            resolve.mutate();
          }}
        >
          {labels.apply}
        </button>
      </div>
      <p className="dq-panel-note">{labels.appliesToAll}</p>
      <p className="dq-panel-note">
        <Link to="/orders">{labels.seeOrders}</Link>
      </p>
    </SlideOver>
  );
}

const enLabels = {
  kicker: "Imports",
  title: "Review queue",
  subtitle:
    "Rows the importer refused to guess about. Each decision is applied to every order line with the same item code.",
  searchPlaceholder: "Item code, rule or message",
  severity: "Severity",
  allSeverities: "All severities",
  reviewRequired: "Needs a decision",
  warning: "Warning",
  error: "Error",
  status: "Status",
  allStatuses: "All statuses",
  open: "Open",
  resolved: "Resolved",
  waived: "Accepted as-is",
  what: "Finding",
  record: "Record",
  detail: "Detail",
  decide: "Decide",
  nothingToReview: "Nothing is waiting for a decision.",
  decideTitle: "What is this item?",
  itemCode: "Item code",
  whatIsIt: "Choose one",
  mapToExisting: "Map to an existing item",
  mapToExistingHint: "It is already in the item master under another code.",
  createProduct: "Create it as a new product",
  createProductHint:
    "It is a real product we sold. It is created in costing, not as currently sellable.",
  classifyService: "It is a service",
  classifyServiceHint: "Installation, repair, consultancy — not a product.",
  classifyLogistics: "It is a logistics charge",
  classifyLogisticsHint: "Transport, freight, delivery, customs.",
  ignore: "Accept as-is",
  ignoreHint: "Leave the lines unchanged and close the finding.",
  findProduct: "Search the item master",
  product: "Product",
  chooseProduct: "Choose a product",
  loading: "Loading…",
  reason: "Why",
  reasonPlaceholder: "Recorded with the decision, for audit.",
  defaultReason: "Reviewed from the import queue.",
  cancel: "Cancel",
  apply: "Apply",
  appliesToAll:
    "This applies to every order line carrying this item code, across all orders.",
  seeOrders: "See the orders that use it",
  severities: {
    REVIEW_REQUIRED: "Decide",
    WARNING: "Warning",
    ERROR: "Error",
  } as Record<string, string>,
  rules: {
    ITEM_NOT_IN_MASTER: "Item not in the item master",
    NON_PRODUCT_ITEM: "Not a product",
    GROUP_AFFILIATE_DETECTED: "ACROW group company",
    NAME_VARIANTS_MERGED: "Name spellings merged",
    COUNTRY_UNRESOLVED: "Country not recognised",
    ORDER_DATE_MISSING: "No order date",
    CUSTOMER_NUMBER_MISSING: "No customer number",
    ORDER_NUMBER_MISSING: "No order number",
    DUPLICATE_LINE_NUMBER: "Duplicate line number",
    ORDER_CUSTOMER_CONFLICT: "Order under two customers",
    COLUMN_MISSING: "Expected column missing",
    ITEM_BARCODE_MISSING: "No barcode",
    ITEM_DESCRIPTION_MISSING: "No description",
  } as Record<string, string>,
};

const arLabels: typeof enLabels = {
  kicker: "الاستيراد",
  title: "قائمة المراجعة",
  subtitle:
    "صفوف رفض المستورد التخمين فيها. كل قرار يُطبَّق على كل بنود الأوامر التي تحمل نفس كود الصنف.",
  searchPlaceholder: "كود الصنف أو القاعدة أو الرسالة",
  severity: "الأهمية",
  allSeverities: "كل المستويات",
  reviewRequired: "يحتاج قرارًا",
  warning: "تحذير",
  error: "خطأ",
  status: "الحالة",
  allStatuses: "كل الحالات",
  open: "مفتوح",
  resolved: "تم الحل",
  waived: "مقبول كما هو",
  what: "الملاحظة",
  record: "السجل",
  detail: "التفصيل",
  decide: "قرِّر",
  nothingToReview: "لا يوجد ما ينتظر قرارًا.",
  decideTitle: "ما هو هذا الصنف؟",
  itemCode: "كود الصنف",
  whatIsIt: "اختر واحدًا",
  mapToExisting: "اربطه بصنف موجود",
  mapToExistingHint: "موجود بالفعل في دليل الأصناف بكود آخر.",
  createProduct: "أنشئه كمنتج جديد",
  createProductHint:
    "منتج حقيقي تم بيعه. يُنشأ تحت التسعير، وليس كمنتج متاح للبيع الآن.",
  classifyService: "خدمة",
  classifyServiceHint: "تركيب أو إصلاح أو استشارة — ليس منتجًا.",
  classifyLogistics: "رسوم نقل",
  classifyLogisticsHint: "نقل أو شحن أو تسليم أو جمارك.",
  ignore: "اقبله كما هو",
  ignoreHint: "لا تغيّر البنود وأغلق الملاحظة.",
  findProduct: "ابحث في دليل الأصناف",
  product: "المنتج",
  chooseProduct: "اختر منتجًا",
  loading: "جارٍ التحميل…",
  reason: "السبب",
  reasonPlaceholder: "يُسجَّل مع القرار للمراجعة.",
  defaultReason: "تمت المراجعة من قائمة الاستيراد.",
  cancel: "إلغاء",
  apply: "تطبيق",
  appliesToAll:
    "يُطبَّق على كل بنود الأوامر التي تحمل كود الصنف هذا، في جميع الأوامر.",
  seeOrders: "اعرض الأوامر التي تستخدمه",
  severities: {
    REVIEW_REQUIRED: "قرار",
    WARNING: "تحذير",
    ERROR: "خطأ",
  },
  rules: {
    ITEM_NOT_IN_MASTER: "صنف غير موجود في الدليل",
    NON_PRODUCT_ITEM: "ليس منتجًا",
    GROUP_AFFILIATE_DETECTED: "شركة تابعة لمجموعة أكرو",
    NAME_VARIANTS_MERGED: "دمج تهجئات الاسم",
    COUNTRY_UNRESOLVED: "دولة غير معروفة",
    ORDER_DATE_MISSING: "بدون تاريخ أمر",
    CUSTOMER_NUMBER_MISSING: "بدون رقم عميل",
    ORDER_NUMBER_MISSING: "بدون رقم أمر",
    DUPLICATE_LINE_NUMBER: "رقم بند مكرر",
    ORDER_CUSTOMER_CONFLICT: "أمر تحت عميلين",
    COLUMN_MISSING: "عمود متوقع مفقود",
    ITEM_BARCODE_MISSING: "بدون باركود",
    ITEM_DESCRIPTION_MISSING: "بدون وصف",
  },
};
