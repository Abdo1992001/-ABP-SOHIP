import { ErrorBanner, ScreenIntro, StatusChip } from "./CommercialUI.tsx";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router";
import type { ApiClient } from "@abp/api-client";
import type { Me } from "../api/customer-api.ts";
import {
  canCopyQuotation,
  copyQuotation,
  listQuotations,
} from "../api/quotation-api.ts";
import { useI18n } from "../i18n/i18n.tsx";
import { QuotationPdfReader } from "./QuotationPdfReader.tsx";

function formatQuotationMoney(
  amount: number,
  currency: string,
  locale: "ar" | "en",
) {
  try {
    return new Intl.NumberFormat(locale === "ar" ? "ar-EG" : "en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toLocaleString(locale === "ar" ? "ar-EG" : "en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })} ${currency}`;
  }
}

function formatQuotationDate(
  value: string | null | undefined,
  locale: "ar" | "en",
) {
  if (!value) return "—";
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(parsed);
}

export function QuotationPage({ client, me }: { client: ApiClient; me: Me }) {
  const { locale } = useI18n();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [copySource, setCopySource] = useState<{
    quotationId: string;
    rowVersion: string;
  } | null>(null);
  const [readingPdf, setReadingPdf] = useState(false);
  const quotations = useQuery({
    queryKey: ["quotations", search, page],
    queryFn: () =>
      listQuotations(client, {
        page,
        limit: 25,
        ...(search.trim() ? { search: search.trim() } : {}),
      }),
    retry: false,
  });
  const mayCreate = me.access.permissions.includes("quotations.create");
  const copy = locale === "ar" ? arabic : english;
  const createFromPrevious = useMutation({
    mutationFn: (source: { quotationId: string; rowVersion: string }) =>
      copyQuotation(client, source.quotationId, source.rowVersion),
    onSuccess: (created) => {
      void navigate(`/quotations/${created.quotationId}`);
    },
  });

  return (
    <section className="workspace-page quotation-page">
      <header className="page-heading customer-list-heading">
        <div>
          <span className="eyebrow" data-abp-caption>
            {copy.eyebrow}
          </span>
          <h1>{copy.title}</h1>
          <p>{copy.subtitle}</p>
        </div>
        <div className="heading-actions">
          <strong>{quotations.data?.meta.total ?? "—"}</strong>
          <span>{copy.authorized}</span>
          {mayCreate && (
            <>
              <button
                type="button"
                aria-expanded={readingPdf}
                onClick={() => {
                  setReadingPdf((open) => !open);
                }}
              >
                {copy.readPdf}
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => {
                  void navigate("/quotation-wizard");
                }}
              >
                ＋ {copy.newQuotation}
              </button>
            </>
          )}
        </div>
      </header>
      <ScreenIntro />
      {mayCreate && readingPdf && (
        <QuotationPdfReader
          client={client}
          onClose={() => {
            setReadingPdf(false);
          }}
        />
      )}

      <section className="enterprise-grid" aria-label={copy.title}>
        <div className="saved-view-strip">
          <span>{copy.all}</span>
          <span>{copy.lockedScope}</span>
        </div>
        <div className="quotation-toolbar">
          <input
            type="search"
            aria-label={copy.search}
            placeholder={copy.search}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
          <button
            type="button"
            className="secondary"
            onClick={() => void quotations.refetch()}
          >
            {copy.refresh}
          </button>
        </div>
        {quotations.isLoading && (
          <div
            className="skeleton-stack"
            aria-label={copy.loading}
            role="status"
          >
            <span />
            <span />
            <span />
            <span />
          </div>
        )}
        {quotations.isError && (
          <ErrorBanner
            error={quotations.error}
            retry={() => void quotations.refetch()}
          />
        )}
        {createFromPrevious.isError && (
          <ErrorBanner
            error={createFromPrevious.error}
            retry={() => {
              if (copySource) createFromPrevious.mutate(copySource);
            }}
          />
        )}
        {quotations.data && (
          <>
            <div className="enterprise-table-scroll">
              <table className="enterprise-table">
                <thead>
                  <tr>
                    <th>{copy.reference}</th>
                    <th>{copy.status}</th>
                    <th>{copy.country}</th>
                    <th>{copy.currency}</th>
                    <th>{copy.total}</th>
                    <th>{copy.validity}</th>
                    <th>
                      <span className="sr-only">{copy.open}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {quotations.data.data.map((quotation) => (
                    <tr key={quotation.quotationId}>
                      <td>
                        <Link to={`/quotations/${quotation.quotationId}`}>
                          <strong>
                            {quotation.quoteRef ??
                              quotation.quotationId.slice(0, 8)}
                          </strong>
                        </Link>
                        {quotation.supersedesQuotationId && (
                          <small className="table-subline">
                            {copy.supersedes}
                          </small>
                        )}
                      </td>
                      <td>
                        <StatusChip code={quotation.statusCode} />
                        {quotation.customerOrderId && quotation.orderRef ? (
                          <Link
                            className="table-subline quotation-won"
                            to={`/customer-orders/${quotation.customerOrderId}`}
                          >
                            {copy.booked} · {quotation.orderRef}
                          </Link>
                        ) : quotation.acceptedAt ? (
                          <small className="table-subline quotation-won">
                            {copy.accepted}
                          </small>
                        ) : null}
                      </td>
                      <td>{quotation.countryCode}</td>
                      <td>{quotation.currencyCode}</td>
                      <td>
                        {quotation.grandTotalAmount
                          ? formatQuotationMoney(
                              Number(quotation.grandTotalAmount),
                              quotation.currencyCode,
                              locale,
                            )
                          : "—"}
                      </td>
                      <td>
                        {formatQuotationDate(quotation.expiresOn, locale)}
                      </td>
                      <td>
                        <div className="quotation-row-actions">
                          {mayCreate &&
                            canCopyQuotation(quotation.statusCode ?? "") &&
                            quotation.rowVersion && (
                              <button
                                type="button"
                                className="quotation-copy-action"
                                disabled={createFromPrevious.isPending}
                                aria-label={`${copy.copyPrevious} ${quotation.quoteRef ?? ""}`}
                                title={copy.copyPrevious}
                                onClick={() => {
                                  if (!quotation.rowVersion) return;
                                  const source = {
                                    quotationId: quotation.quotationId,
                                    rowVersion: quotation.rowVersion,
                                  };
                                  setCopySource(source);
                                  createFromPrevious.mutate(source);
                                }}
                              >
                                {createFromPrevious.isPending &&
                                copySource?.quotationId ===
                                  quotation.quotationId
                                  ? "…"
                                  : "⧉"}
                              </button>
                            )}
                          <Link
                            className="row-open"
                            to={`/quotations/${quotation.quotationId}`}
                            aria-label={`${copy.open} ${quotation.quoteRef ?? ""}`}
                          >
                            →
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {quotations.data.data.length === 0 && (
                    <tr>
                      <td colSpan={7} className="table-empty">
                        {copy.empty}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <footer className="grid-pagination">
              <span>
                {copy.page} {quotations.data.meta.page} ·{" "}
                {quotations.data.meta.total} {copy.records}
              </span>
              <div>
                <button
                  type="button"
                  className="secondary"
                  disabled={page <= 1}
                  onClick={() => {
                    setPage((current) => Math.max(1, current - 1));
                  }}
                >
                  {copy.previous}
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={!quotations.data.meta.hasNext}
                  onClick={() => {
                    setPage((current) => current + 1);
                  }}
                >
                  {copy.next}
                </button>
              </div>
            </footer>
          </>
        )}
      </section>
    </section>
  );
}

const english = {
  eyebrow: "Sales core · Quotations",
  title: "Quotations",
  subtitle:
    "Drafts edit in place. After sending, any change creates a new quotation linked to the previous version.",
  authorized: "authorized quotations",
  newQuotation: "New quotation",
  readPdf: "Read a past PDF",
  copyPrevious: "Create new from this quotation",
  all: "All authorized quotations",
  lockedScope: "Country Scope first · DENY wins · no formal revisions",
  search: "Search quotation reference",
  refresh: "Refresh",
  loading: "Loading authorized quotations…",
  failed: "Quotation data is unavailable.",
  reference: "Quotation",
  status: "Status",
  country: "Country",
  currency: "Currency",
  total: "Total",
  validity: "Valid until",
  open: "Open",
  supersedes: "Created from a previous quotation",
  accepted: "Accepted by the customer",
  booked: "Booked",
  empty: "No quotations in this authorized view.",
  page: "Page",
  records: "records",
  previous: "Previous",
  next: "Next",
  draftOnly: "New independent DRAFT",
  close: "Close",
  createGuidance:
    "Choose an authorized opportunity. The server owns eligibility, customer scope and quotation numbering.",
  opportunity: "Opportunity",
  chooseOpportunity: "Choose an authorized opportunity",
  serverGuard:
    "The server enforces the permitted opportunity stage and Country Scope.",
  createFailed:
    "The draft could not be created. Check the opportunity eligibility and try again.",
  cancel: "Cancel",
  createDraft: "Create draft",
  creating: "Creating…",
};

const arabic: typeof english = {
  eyebrow: "مركز المبيعات · عروض الأسعار",
  title: "عروض الأسعار",
  subtitle:
    "تُعدّل المسودة في مكانها. بعد الإرسال، أي تغيير ينشئ عرض سعر جديدًا مرتبطًا بالنسخة السابقة.",
  authorized: "عرض سعر مصرح",
  newQuotation: "عرض سعر جديد",
  readPdf: "قراءة PDF سابق",
  copyPrevious: "إنشاء عرض جديد من هذا العرض",
  all: "كل عروض الأسعار المصرح بها",
  lockedScope: "نطاق الدول أولًا · المنع يتغلب · لا توجد مراجعات رسمية",
  search: "ابحث برقم عرض السعر",
  refresh: "تحديث",
  loading: "جارٍ تحميل عروض الأسعار المصرح بها…",
  failed: "بيانات عروض الأسعار غير متاحة.",
  reference: "عرض السعر",
  status: "الحالة",
  country: "الدولة",
  currency: "العملة",
  total: "الإجمالي",
  validity: "صالح حتى",
  open: "فتح",
  supersedes: "تم إنشاؤه من عرض سعر سابق",
  accepted: "العميل وافق عليه",
  booked: "اتحجز",
  empty: "لا توجد عروض أسعار في النطاق المصرح.",
  page: "صفحة",
  records: "سجل",
  previous: "السابق",
  next: "التالي",
  draftOnly: "مسودّة مستقلة جديدة",
  close: "إغلاق",
  createGuidance:
    "اختر فرصة مصرحًا بها. الخادم هو المسؤول عن الأهلية ونطاق العميل وترقيم عرض السعر.",
  opportunity: "الفرصة",
  chooseOpportunity: "اختر فرصة مصرحًا بها",
  serverGuard: "الخادم يفرض مرحلة الفرصة المسموحة ونطاق الدول.",
  createFailed: "تعذر إنشاء المسودّة. راجع أهلية الفرصة وحاول مرة أخرى.",
  cancel: "إلغاء",
  createDraft: "إنشاء مسودّة",
  creating: "جارٍ الإنشاء…",
};
