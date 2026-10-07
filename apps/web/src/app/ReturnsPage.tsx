import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import type { ApiClient } from "@abp/api-client";
import type { Me } from "../api/customer-api.ts";
import { listQuotations } from "../api/quotation-api.ts";
import {
  createReturn,
  decideReturn,
  finalizeReturn,
  getReturn,
  listReturns,
  submitReturnForApproval,
} from "../api/returns-api.ts";
import { commercialRequest, isObject, rows, str } from "./commercial-api.ts";
import { useI18n } from "../i18n/i18n.tsx";
import {
  ErrorBanner,
  PageHeader,
  SlideOver,
  useToast,
} from "./CommercialUI.tsx";
import { AccountPicker } from "./AccountPicker.tsx";

const STATUS_LABEL: Record<string, { en: string; ar: string }> = {
  DRAFT: { en: "Draft", ar: "مسودة" },
  PENDING_APPROVAL: { en: "Pending approval", ar: "بانتظار الموافقة" },
  APPROVED: { en: "Approved", ar: "معتمد" },
  FINALIZED: { en: "Finalized", ar: "منتهي" },
  REJECTED: { en: "Rejected", ar: "مرفوض" },
  CANCELLED: { en: "Cancelled", ar: "ملغي" },
};
const BENEFIT_LABEL: Record<string, { en: string; ar: string }> = {
  CREDIT: { en: "Cash credit", ar: "رصيد نقدي" },
  REPLACEMENT: { en: "Board replacement", ar: "استبدال ألواح" },
};

export function ReturnsPage({ client, me }: { client: ApiClient; me: Me }) {
  const { locale } = useI18n();
  const txt = (en: string, ar: string) => (locale === "ar" ? ar : en);
  const navigate = useNavigate();
  const { caseId } = useParams();
  const cache = useQueryClient();
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [accountId, setAccountId] = useState("");
  const [quotationId, setQuotationId] = useState("");
  const [benefitTypeCode, setBenefitTypeCode] = useState("CREDIT");
  const [returnQty, setReturnQty] = useState<Record<string, string>>({});
  const [decisionComment, setDecisionComment] = useState("");

  const list = useQuery({
    queryKey: ["returns", page],
    queryFn: () => listReturns(client, page),
  });
  const detail = useQuery({
    queryKey: ["return", caseId],
    enabled: !!caseId,
    queryFn: () => getReturn(client, caseId ?? ""),
  });
  const accountQuotations = useQuery({
    queryKey: ["return-account-quotations", accountId],
    enabled: !!accountId,
    queryFn: () => listQuotations(client, { accountId, limit: 50, page: 1 }),
  });
  const sourceQuotation = useQuery({
    queryKey: ["return-source-quotation", quotationId],
    enabled: !!quotationId,
    queryFn: () =>
      commercialRequest(client, "GET", "/quotations/{quotationId}", {
        path: { quotationId },
      }),
  });
  const sourceLines = rows(
    isObject(sourceQuotation.data?.data) &&
      isObject(sourceQuotation.data.data.data)
      ? sourceQuotation.data.data.data.lines
      : [],
  );

  const refresh = async () => {
    await cache.invalidateQueries({ queryKey: ["returns"] });
    await cache.invalidateQueries({ queryKey: ["return", caseId] });
    toast.success(txt("Saved", "تم الحفظ"));
  };
  const version = detail.data?.data.case.rowVersion ?? "";

  const create = useMutation({
    mutationFn: () =>
      createReturn(client, {
        accountId,
        originalQuotationId: quotationId,
        benefitTypeCode: benefitTypeCode as "CREDIT" | "REPLACEMENT",
        lines: Object.entries(returnQty)
          .filter(([, qty]) => Number(qty) > 0)
          .map(([originalQuotationLineId, returnedQty]) => ({
            originalQuotationLineId,
            returnedQty,
          })),
      }),
    onSuccess: async (result) => {
      setCreating(false);
      setAccountId("");
      setQuotationId("");
      setReturnQty({});
      await cache.invalidateQueries({ queryKey: ["returns"] });
      void navigate(`/returns/${result.data.case.returnedScrapCaseId}`);
    },
  });
  const submit = useMutation({
    mutationFn: () =>
      submitReturnForApproval(client, caseId ?? "", version, undefined),
    onSuccess: refresh,
  });
  const decide = useMutation({
    mutationFn: (decision: "APPROVE" | "REJECT") =>
      decideReturn(
        client,
        caseId ?? "",
        version,
        decision,
        decisionComment || undefined,
      ),
    onSuccess: async () => {
      setDecisionComment("");
      await refresh();
    },
  });
  const finalize = useMutation({
    mutationFn: () => finalizeReturn(client, caseId ?? "", version),
    onSuccess: refresh,
  });

  const canCreate = me.access.permissions.includes("returns.create");
  const canEdit = me.access.permissions.includes("returns.edit");
  const canApprove =
    me.access.permissions.includes("returns.approve") &&
    me.access.permissions.includes("sales.management.view");
  const canFinalize = me.access.permissions.includes("returns.finalize");

  return (
    <section className="workspace-page">
      <PageHeader
        kicker={txt("ERP & data", "الـERP والبيانات")}
        title={txt("Returns & scrap credit", "المرتجعات ورصيد الخردة")}
        {...(list.data ? { count: list.data.data.length } : {})}
        actions={
          canCreate ? (
            <button
              className="primary"
              onClick={() => {
                setCreating(true);
              }}
            >
              {txt("+ New return case", "+ حالة مرتجع جديدة")}
            </button>
          ) : undefined
        }
      />
      <p className="empty-inline">
        {txt(
          "Policy: 25% credit or board replacement of the original purchase price.",
          "السياسة: 25% رصيد نقدي أو استبدال ألواح من سعر الشراء الأصلي.",
        )}
      </p>
      <ErrorBanner error={list.error} retry={() => void list.refetch()} />
      <div className="panel">
        <table className="data-table">
          <thead>
            <tr>
              <th>{txt("Case", "الحالة")}</th>
              <th>{txt("Benefit", "نوع الاسترداد")}</th>
              <th>{txt("Status", "الحالة")}</th>
              <th>{txt("Value", "القيمة")}</th>
            </tr>
          </thead>
          <tbody>
            {list.data?.data.map((c) => (
              <tr key={c.returnedScrapCaseId}>
                <td>
                  <Link to={`/returns/${c.returnedScrapCaseId}`}>
                    {c.caseRef ?? c.returnedScrapCaseId}
                  </Link>
                </td>
                <td>
                  {locale === "ar"
                    ? BENEFIT_LABEL[c.benefitTypeCode]?.ar
                    : BENEFIT_LABEL[c.benefitTypeCode]?.en}
                </td>
                <td>
                  <span className="badge badge-navy">
                    {locale === "ar"
                      ? (STATUS_LABEL[c.statusCode ?? "DRAFT"]?.ar ??
                        c.statusCode)
                      : (STATUS_LABEL[c.statusCode ?? "DRAFT"]?.en ??
                        c.statusCode)}
                  </span>
                </td>
                <td>
                  {c.creditAmount ?? "0"} {c.currencyCodeSnapshot}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.data?.data.length === 0 && (
          <p className="table-empty">
            {txt(
              "No boards have come back yet. Open a case when a customer returns material from an order.",
              "مفيش ألواح رجعت لسه. افتح حالة لما عميل يرجّع خامات من أوردر.",
            )}
          </p>
        )}
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
            disabled={!list.data?.meta.hasNext}
            onClick={() => {
              setPage(page + 1);
            }}
          >
            {txt("Next", "التالي")}
          </button>
        </footer>
      </div>
      {creating && (
        <SlideOver
          title={txt("New return case", "حالة مرتجع جديدة")}
          onClose={() => {
            setCreating(false);
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <AccountPicker
              client={client}
              value={accountId}
              onChange={(id) => {
                setAccountId(id);
                setQuotationId("");
                setReturnQty({});
              }}
            />
            {accountId && (
              <label>
                {txt("Original quotation", "عرض السعر الأصلي")}
                <select
                  required
                  value={quotationId}
                  onChange={(e) => {
                    setQuotationId(e.target.value);
                    setReturnQty({});
                  }}
                >
                  <option value="">
                    {txt("Select quotation", "اختر عرض السعر")}
                  </option>
                  {accountQuotations.data?.data.map((q) => (
                    <option key={q.quotationId} value={q.quotationId}>
                      {q.quoteRef}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {quotationId && sourceLines.length > 0 && (
              <fieldset>
                <legend>
                  {txt("Returned quantities", "الكميات المرتجعة")}
                </legend>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>{txt("Item", "الصنف")}</th>
                      <th>{txt("Original qty", "الكمية الأصلية")}</th>
                      <th>{txt("Returned qty", "الكمية المرتجعة")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sourceLines.map((line) => (
                      <tr key={str(line.quotationLineId)}>
                        <td>{str(line.description)}</td>
                        <td>{str(line.qty)}</td>
                        <td>
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={returnQty[str(line.quotationLineId)] ?? ""}
                            onChange={(e) => {
                              setReturnQty((prev) => ({
                                ...prev,
                                [str(line.quotationLineId)]: e.target.value,
                              }));
                            }}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </fieldset>
            )}
            <label>
              {txt("Benefit type", "نوع الاسترداد")}
              <select
                value={benefitTypeCode}
                onChange={(e) => {
                  setBenefitTypeCode(e.target.value);
                }}
              >
                <option value="CREDIT">
                  {txt("Cash credit", "رصيد نقدي")}
                </option>
                <option value="REPLACEMENT">
                  {txt("Board replacement", "استبدال ألواح")}
                </option>
              </select>
            </label>
            <ErrorBanner
              error={create.error}
              retry={() => {
                create.mutate();
              }}
            />
            <button
              className="primary"
              disabled={
                create.isPending ||
                !quotationId ||
                Object.values(returnQty).every((q) => !(Number(q) > 0))
              }
            >
              {create.isPending
                ? "…"
                : txt("Save return case", "حفظ حالة المرتجع")}
            </button>
          </form>
        </SlideOver>
      )}
      {caseId && (
        <SlideOver
          title={
            detail.data?.data.case.caseRef ?? txt("Return case", "حالة مرتجع")
          }
          onClose={() => void navigate("/returns")}
        >
          <ErrorBanner
            error={detail.error}
            retry={() => void detail.refetch()}
          />
          {detail.data && (
            <div className="customer-overview">
              <dl className="quotation-fact-grid">
                <div>
                  <dt>{txt("Status", "الحالة")}</dt>
                  <dd>
                    {locale === "ar"
                      ? (STATUS_LABEL[
                          detail.data.data.case.statusCode ?? "DRAFT"
                        ]?.ar ?? detail.data.data.case.statusCode)
                      : (STATUS_LABEL[
                          detail.data.data.case.statusCode ?? "DRAFT"
                        ]?.en ?? detail.data.data.case.statusCode)}
                  </dd>
                </div>
                <div>
                  <dt>{txt("Benefit rate", "نسبة الاسترداد")}</dt>
                  <dd>{detail.data.data.case.appliedCreditPctSnapshot}%</dd>
                </div>
                <div>
                  <dt>{txt("Assessed base", "القيمة الأساسية")}</dt>
                  <dd>
                    {detail.data.data.case.assessedBaseAmount ?? "0"}{" "}
                    {detail.data.data.case.currencyCodeSnapshot}
                  </dd>
                </div>
                <div>
                  <dt>{txt("Benefit value", "قيمة الاسترداد")}</dt>
                  <dd className="quotation-fact-strong">
                    {detail.data.data.case.benefitValueAmount ?? "0"}{" "}
                    {detail.data.data.case.currencyCodeSnapshot}
                  </dd>
                </div>
                <div>
                  <dt>{txt("Customer", "العميل")}</dt>
                  <dd>
                    <Link to={`/customers/${detail.data.data.case.accountId}`}>
                      {txt("Open customer 360", "فتح ملف العميل")}
                    </Link>
                  </dd>
                </div>
              </dl>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{txt("Returned qty", "الكمية المرتجعة")}</th>
                    <th>{txt("Unit price snapshot", "سعر الوحدة الأصلي")}</th>
                    <th>{txt("Benefit", "الاسترداد")}</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.data.data.lines.map((line) => (
                    <tr key={line.returnedScrapLineId}>
                      <td>{line.returnedQty}</td>
                      <td>{line.originalPurchaseUnitPriceSnapshot}</td>
                      <td>{line.benefitValueAmount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {detail.data.data.case.statusCode === "DRAFT" && canEdit && (
                <>
                  <ErrorBanner
                    error={submit.error}
                    retry={() => {
                      submit.mutate();
                    }}
                  />
                  <button
                    className="primary"
                    disabled={submit.isPending}
                    onClick={() => {
                      submit.mutate();
                    }}
                  >
                    {txt("Submit for manager approval", "إرسال لموافقة المدير")}
                  </button>
                </>
              )}
              {detail.data.data.case.statusCode === "PENDING_APPROVAL" &&
                canApprove && (
                  <div className="action-grid">
                    <input
                      aria-label={txt("Comment", "ملاحظة")}
                      placeholder={txt("Optional comment", "ملاحظة اختيارية")}
                      value={decisionComment}
                      onChange={(e) => {
                        setDecisionComment(e.target.value);
                      }}
                    />
                    <ErrorBanner error={decide.error} retry={() => undefined} />
                    <button
                      className="primary"
                      disabled={decide.isPending}
                      onClick={() => {
                        decide.mutate("APPROVE");
                      }}
                    >
                      {txt("Approve", "اعتماد")}
                    </button>
                    <button
                      className="danger"
                      disabled={decide.isPending}
                      onClick={() => {
                        decide.mutate("REJECT");
                      }}
                    >
                      {txt("Reject", "رفض")}
                    </button>
                  </div>
                )}
              {detail.data.data.case.statusCode === "APPROVED" &&
                canFinalize && (
                  <>
                    <ErrorBanner
                      error={finalize.error}
                      retry={() => {
                        finalize.mutate();
                      }}
                    />
                    <button
                      className="primary"
                      disabled={finalize.isPending}
                      onClick={() => {
                        finalize.mutate();
                      }}
                    >
                      {txt("Finalize case", "إنهاء الحالة")}
                    </button>
                  </>
                )}
            </div>
          )}
        </SlideOver>
      )}
    </section>
  );
}
