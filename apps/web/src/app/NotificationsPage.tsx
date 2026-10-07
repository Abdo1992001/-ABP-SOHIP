import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import type { ApiClient } from "@abp/api-client";
import { commercialRequest, rows, str, isObject } from "./commercial-api.ts";
import { ErrorBanner, ScreenIntro } from "./CommercialUI.tsx";
import { useI18n } from "../i18n/i18n.tsx";

export const notificationQuery = (client: ApiClient, page = 1) => ({
  queryKey: ["notifications", page],
  queryFn: () =>
    commercialRequest(client, "GET", "/notifications", {
      path: {},
      query: { page, limit: 25 },
    }),
  refetchInterval: 30_000,
});
export function notificationRoute(item: Record<string, unknown>) {
  const roots: Record<string, string> = {
    ACCOUNT: "/customers",
    CUSTOMER: "/customers",
    CONTACT: "/contacts",
    PROJECT: "/projects",
    QUOTATION: "/quotations",
    OPPORTUNITY: "/opportunities",
    ACTIVITY: "/activities",
    SHIPMENT: "/shipments",
    SALES_ORDER: "/orders",
    ERP_ORDER: "/orders",
    PAYMENT: "/finance/payments",
    COMPLAINT: "/complaints",
    CUSTOMER_ORDER: "/customer-orders",
    WORK_ORDER: "/work-orders",
    CUSTOMER_FEEDBACK: "/customer-feedback",
  };
  if (str(item.resourceTypeCode) === "SYSTEM") return "/admin/system";
  const root = roots[str(item.resourceTypeCode)];
  return root && item.resourceId
    ? `${root}/${encodeURIComponent(str(item.resourceId))}`
    : "/actions";
}
export function NotificationsPage({ client }: { client: ApiClient }) {
  const { locale } = useI18n();
  const [page, setPage] = useState(1);
  const navigate = useNavigate();
  const cache = useQueryClient();
  const query = useQuery(notificationQuery(client, page));
  const items = rows(query.data?.data);
  const total =
    isObject(query.data?.data) && isObject(query.data.data.meta)
      ? Number(query.data.data.meta.total)
      : items.length;
  const mutation = useMutation({
    mutationFn: async ({ id, route }: { id?: string; route?: string }) => {
      await commercialRequest(
        client,
        "POST",
        id ? "/notifications/{notificationId}/read" : "/notifications/read-all",
        {
          path: id ? { notificationId: id } : {},
          body: {},
          idempotencyKey: crypto.randomUUID(),
        },
      );
      await cache.invalidateQueries({ queryKey: ["notifications"] });
      if (route) await navigate(route);
    },
  });
  return (
    <section className="workspace-page">
      <header className="page-heading">
        <h1>{locale === "ar" ? "الإشعارات" : "Notifications"}</h1>
        <button
          className="primary"
          disabled={mutation.isPending || items.length === 0}
          onClick={() => {
            mutation.mutate({});
          }}
        >
          {locale === "ar" ? "قراءة الكل" : "Mark all read"}
        </button>
      </header>
      <ScreenIntro />
      <ErrorBanner error={query.error} retry={() => void query.refetch()} />
      <ErrorBanner
        error={mutation.error}
        retry={() => {
          if (mutation.variables) mutation.mutate(mutation.variables);
        }}
      />
      <div className="notification-list">
        {items.map((item) => (
          <article
            className={`notification-item ${item.readAt ? "" : "unread"}`}
            key={str(item.notificationId)}
          >
            <button
              className="notification-content"
              disabled={mutation.isPending}
              onClick={() => {
                mutation.mutate({
                  id: str(item.notificationId),
                  route: notificationRoute(item),
                });
              }}
            >
              <span className="notification-symbol" aria-hidden="true">
                {(
                  {
                    APPROVAL_NEEDED: "⚡",
                    QUOTATION_ACCEPTED: "✓",
                    OVERDUE_TASK: "◷",
                    PAYMENT_RECEIVED: "₤",
                    SHIPMENT_UPDATE: "▣",
                    AI_INSIGHT: "✦",
                    CUSTOMER_FEEDBACK: "★",
                    PAYMENT_OVERDUE: "₤",
                    PRODUCTION_AT_RISK: "⚙",
                    DELIVERY_LATE: "⛟",
                    FEEDBACK_REQUEST: "☺",
                    QUOTATION_EXPIRING: "⏳",
                    EMAIL_UNDELIVERED: "✉",
                    BACKUP_PROBLEM: "⛁",
                    CREDIT_OVERRIDE: "⚠",
                    CRITICAL_FEEDBACK: "!",
                  } as Record<string, string>
                )[str(item.typeCode)] ?? "●"}
              </span>
              <span>
                <strong>{str(item.titleSafe)}</strong>
                <p>{str(item.bodySafe)}</p>
                <time>
                  {new Date(str(item.createdAt)).toLocaleString(
                    locale === "ar" ? "ar-EG" : "en-GB",
                  )}
                </time>
              </span>
            </button>
            {!item.readAt && (
              <button
                disabled={mutation.isPending}
                onClick={() => {
                  mutation.mutate({ id: str(item.notificationId) });
                }}
              >
                {locale === "ar" ? "تمت القراءة" : "Mark read"}
              </button>
            )}
          </article>
        ))}
        {!query.isLoading && !query.error && !items.length && (
          <p>{locale === "ar" ? "لا توجد إشعارات" : "You're all caught up."}</p>
        )}
      </div>
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
          disabled={page * 25 >= total}
          onClick={() => {
            setPage(page + 1);
          }}
        >
          {locale === "ar" ? "التالي" : "Next"}
        </button>
      </footer>
    </section>
  );
}
