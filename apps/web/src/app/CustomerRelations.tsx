import { useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import type { ApiClient } from "@abp/api-client";
import { useI18n } from "../i18n/i18n.tsx";
import { ErrorBanner } from "./CommercialUI.tsx";
import { commercialRequest, rows, str } from "./commercial-api.ts";

export const customerTabs = [
  {
    id: "overview",
    en: "Overview",
    ar: "نظرة عامة",
    permission: "accounts.view",
  },
  {
    id: "contacts",
    en: "Contacts",
    ar: "جهات الاتصال",
    permission: "contacts.view",
  },
  {
    // Listing, granting and revoking a share all existed in the API with
    // nothing calling them. Without a screen the only way to give a colleague
    // access to one account was to widen their whole country scope.
    id: "sharing",
    en: "Sharing",
    ar: "المشاركة",
    permission: "accounts.view",
  },
  {
    id: "history",
    en: "Purchase history",
    ar: "سجل المشتريات",
    permission: "accounts.view",
  },
  {
    id: "projects",
    en: "Projects",
    ar: "المشروعات",
    permission: "projects.view",
  },
  {
    id: "opportunities",
    en: "Opportunities",
    ar: "الفرص",
    permission: "opportunities.view",
  },
  {
    id: "quotations",
    en: "Quotations",
    ar: "عروض الأسعار",
    permission: "quotations.view",
  },
  {
    // Booked here from accepted quotations, through production and delivery.
    id: "customer-orders",
    en: "Customer orders",
    ar: "أوامر البيع",
    permission: "sales-orders.view",
  },
  {
    // What they still owe on those orders, installment by installment.
    id: "receivables",
    en: "Receivables",
    ar: "المستحقات",
    permission: "payments.view",
  },
  {
    id: "orders",
    en: "ERP orders",
    ar: "أوامر ERP",
    permission: "sales-orders.view",
  },
  {
    id: "payments",
    en: "Payments",
    ar: "المدفوعات",
    permission: "payments.view",
  },
  {
    id: "complaints",
    en: "Complaints",
    ar: "الشكاوى",
    permission: "complaints.view",
  },
  {
    id: "feedback",
    en: "Feedback",
    ar: "آراء العميل",
    permission: "feedback.view",
  },
  {
    id: "shipments",
    en: "Shipments",
    ar: "الشحنات",
    permission: "shipments.view",
  },
  {
    id: "documents",
    en: "Documents",
    ar: "المستندات",
    permission: "documents.view",
  },
  {
    id: "activity",
    en: "Activities",
    ar: "الأنشطة",
    permission: "activities.view",
  },
  {
    id: "meetings",
    en: "Meetings",
    ar: "الاجتماعات",
    permission: "activities.view",
  },
  {
    id: "source",
    en: "Source",
    ar: "المصدر",
    permission: "accounts.view",
  },
];
const configs: Record<string, { path: string; root: string; id: string }> = {
  opportunities: {
    path: "/opportunities",
    root: "/opportunities",
    id: "opportunityId",
  },
  quotations: { path: "/quotations", root: "/quotations", id: "quotationId" },
  "customer-orders": {
    path: "/customer-orders",
    root: "/customer-orders",
    id: "customerOrderId",
  },
  // An installment has no page of its own; it opens on its order.
  receivables: {
    path: "/receivables",
    root: "/customer-orders",
    id: "customerOrderId",
  },
  feedback: {
    path: "/customer-feedback",
    root: "/customer-feedback",
    id: "feedbackId",
  },
  orders: { path: "/sales-orders", root: "/orders", id: "salesOrderId" },
  payments: {
    path: "/finance/payments",
    root: "/finance/payments",
    id: "paymentId",
  },
  complaints: { path: "/complaints", root: "/complaints", id: "complaintId" },
  shipments: { path: "/shipments", root: "/shipments", id: "shipmentId" },
  documents: { path: "/documents", root: "/documents", id: "documentId" },
  activity: { path: "/activities", root: "/activities", id: "activityId" },
  meetings: { path: "/activities", root: "/activities", id: "activityId" },
};
export function CustomerRelations({
  client,
  accountId,
  tab,
}: {
  client: ApiClient;
  accountId: string;
  tab: string;
}) {
  const { locale } = useI18n();
  const [page, setPage] = useState(1);
  const config = configs[tab];
  const query = useQuery({
    queryKey: ["customer-relations", accountId, tab, page],
    enabled: Boolean(config),
    queryFn: () =>
      commercialRequest(client, "GET", config?.path ?? "", {
        path: {},
        query: {
          ...(tab === "documents"
            ? { resourceId: accountId, resourceTypeCode: "ACCOUNT" }
            : { accountId }),
          ...(["activity", "meetings", "documents"].includes(tab)
            ? {}
            : { page }),
          // Every installment, settled ones included: this is their history.
          ...(tab === "receivables" ? { view: "ALL" } : {}),
          offset: (page - 1) * 25,
          limit: 25,
        },
      }),
  });
  const items = rows(query.data?.data).filter(
    (item) =>
      tab !== "meetings" || str(item.typeCode).toUpperCase() === "MEETING",
  );
  return (
    <div role="tabpanel">
      <ErrorBanner error={query.error} retry={() => void query.refetch()} />
      {query.isLoading && (
        <div
          className="skeleton-stack"
          aria-label={locale === "ar" ? "جار تحميل البيانات" : "Loading data"}
          role="status"
        >
          <span />
          <span />
          <span />
        </div>
      )}
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>{locale === "ar" ? "المرجع" : "Reference"}</th>
              <th>{locale === "ar" ? "الحالة" : "Status"}</th>
              <th>
                {locale === "ar" ? "القيمة / الوصف" : "Value / description"}
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr
                key={str(
                  item.receivableInstallmentId ?? item[config?.id ?? "id"],
                )}
              >
                <td>
                  <Link
                    to={`${config?.root ?? ""}/${encodeURIComponent(str(item[config?.id ?? "id"]))}`}
                  >
                    {str(
                      (tab === "receivables"
                        ? `${str(item.orderRef)} · ${str(item.label)}`
                        : undefined) ??
                        item.orderRef ??
                        item.feedbackRef ??
                        item.orderNumber ??
                        item.displayName ??
                        item.sourcePaymentKey ??
                        item.opportunityRef ??
                        item.quoteRef ??
                        item.salesOrderRef ??
                        item.sourceOrderRef ??
                        item.complaintRef ??
                        item.shipmentRef ??
                        item.subject ??
                        item.fileName ??
                        item.documentRef ??
                        item[config?.id ?? "id"],
                    )}
                  </Link>
                </td>
                <td>
                  {str(
                    item.statusCode ??
                      item.stageCode ??
                      item.taskStatusCode ??
                      item.milestoneCode,
                  )}
                </td>
                <td>
                  {str(
                    (tab === "feedback"
                      ? `${item.rating ? `${"★".repeat(Number(item.rating))} · ` : ""}${str(item.kindCode)}`
                      : undefined) ??
                      (tab === "receivables"
                        ? `${str(item.outstandingAmount)} / ${str(item.amount)}`
                        : undefined) ??
                      item.totalAmount ??
                      item.grandTotalAmount ??
                      item.estimatedValue ??
                      item.amount ??
                      item.title ??
                      "",
                  )}{" "}
                  {str(item.currencyCode ?? "")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!query.isLoading && !query.error && !items.length && (
        <p>
          {locale === "ar"
            ? "لا توجد بيانات مرتبطة بهذا العميل"
            : "No linked items for this customer."}
        </p>
      )}
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
          disabled={items.length < 25}
          onClick={() => {
            setPage(page + 1);
          }}
        >
          {locale === "ar" ? "التالي" : "Next"}
        </button>
      </footer>
    </div>
  );
}
