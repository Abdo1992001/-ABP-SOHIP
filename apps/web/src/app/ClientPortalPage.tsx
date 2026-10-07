import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApiClient, operations } from "@abp/api-client";
import { useI18n } from "../i18n/i18n.tsx";
import { AbpLogo, useResolvedTheme } from "./AbpLogo.tsx";
import type { ThemePreference } from "./theme.ts";
import { DataView } from "./ContractScreen.tsx";
import { ErrorBanner } from "./CommercialUI.tsx";

type ClientPortalContextsResponse =
  operations["get_portal_customer_contexts"]["responses"][200]["content"]["application/json"];

type PortalSection =
  "home" | "profile" | "complaints" | "repeat" | "notifications";

export function ClientPortalPage({
  client,
  setTheme,
  onLogout,
  logoutBusy,
}: {
  client: ApiClient;
  setTheme: Dispatch<SetStateAction<ThemePreference>>;
  onLogout: () => void;
  logoutBusy: boolean;
}) {
  const { locale, toggle } = useI18n();
  const resolved = useResolvedTheme();
  const cache = useQueryClient();
  const [accountId, setAccountId] = useState("");
  const [section, setSection] = useState<PortalSection>("home");
  const [description, setDescription] = useState("");
  const [feedback, setFeedback] = useState("");
  const contexts = useQuery({
    queryKey: ["portal-contexts"],
    queryFn: async () => {
      const result = await client.GET("/portal/customer-contexts");
      if (result.data === undefined)
        throw new Error(`PORTAL_${String(result.response.status)}`);
      return result.data as unknown as ClientPortalContextsResponse;
    },
  });
  const available = contexts.data?.data ?? [];
  useEffect(() => {
    const firstAccountId = available[0]?.accountId;
    if (!accountId && firstAccountId) setAccountId(firstAccountId);
  }, [accountId, available]);
  const orders = useQuery({
    queryKey: ["portal-orders", accountId],
    enabled: Boolean(accountId),
    queryFn: async () =>
      required(
        await client.GET("/portal/customers/{accountId}/orders", {
          params: { path: { accountId }, query: { offset: 0, limit: 25 } },
        }),
      ),
  });
  const shipments = useQuery({
    queryKey: ["portal-shipments", accountId],
    enabled: Boolean(accountId),
    queryFn: async () =>
      required(
        await client.GET("/portal/customers/{accountId}/shipments", {
          params: { path: { accountId }, query: { offset: 0, limit: 25 } },
        }),
      ),
  });
  const complaints = useQuery({
    queryKey: ["portal-complaints", accountId],
    enabled: Boolean(accountId),
    queryFn: async () =>
      required(
        await client.GET("/portal/customers/{accountId}/complaints", {
          params: { path: { accountId }, query: { offset: 0, limit: 25 } },
        }),
      ),
  });
  const create = useMutation({
    mutationFn: async () =>
      required(
        await client.POST("/portal/customers/{accountId}/complaints", {
          params: { path: { accountId } },
          body: { complaintTypeCode: "GENERAL", description },
        }),
      ),
    onSuccess: async () => {
      setDescription("");
      setFeedback(
        locale === "ar"
          ? "تم إرسال الشكوى لفريق خدمة العملاء."
          : "Complaint submitted to customer service.",
      );
      await cache.invalidateQueries({
        queryKey: ["portal-complaints", accountId],
      });
    },
  });
  if (contexts.isLoading)
    return (
      <div
        className="app-state skeleton-stack"
        aria-label={locale === "ar" ? "جار تحميل البوابة" : "Loading portal"}
        role="status"
      >
        <span />
        <span />
        <span />
      </div>
    );
  if (contexts.error)
    return (
      <div className="app-state denied" role="alert">
        <div>
          <h1>
            {locale === "ar"
              ? "دخول البوابة غير متاح"
              : "Portal access unavailable"}
          </h1>
          <p>
            {locale === "ar"
              ? "لا يوجد عميل نشط مرتبط بهذه الهوية."
              : "Your identity has no active customer binding."}
          </p>
        </div>
      </div>
    );
  return (
    <main className="portal-shell">
      <header className="portal-header">
        {/* The one page a customer ever sees, so it carries the real mark
            rather than the placeholder square, in whichever variant suits the
            theme they are viewing it in. */}
        <AbpLogo className="portal-logo" size="md" />
        <div className="brand-copy">
          <strong>{locale === "ar" ? "بوابة العملاء" : "Client portal"}</strong>
          <small>
            {locale === "ar"
              ? "طلباتك وشحناتك ومستنداتك"
              : "Your orders, shipments and documents"}
          </small>
        </div>
        <label>
          {locale === "ar" ? "حساب العميل" : "Customer context"}
          <select
            value={accountId}
            onChange={(event) => {
              setAccountId(event.target.value);
            }}
          >
            {available.map((item) => (
              <option key={item.accountId} value={item.accountId}>
                {item.displayName}
              </option>
            ))}
          </select>
        </label>
        <div className="portal-header-actions">
          <button
            type="button"
            className="topbar-icon-button"
            aria-label={
              locale === "ar"
                ? resolved === "light"
                  ? "تفعيل المظهر الداكن"
                  : "تفعيل المظهر الفاتح"
                : resolved === "light"
                  ? "Use dark theme"
                  : "Use light theme"
            }
            onClick={() => {
              setTheme(resolved === "light" ? "dark" : "light");
            }}
          >
            <span aria-hidden="true">{resolved === "light" ? "◐" : "☀"}</span>
          </button>
          <button type="button" className="language-switch" onClick={toggle}>
            {locale === "ar" ? "English" : "العربية"}
          </button>
          <button
            type="button"
            className="topbar-icon-button"
            aria-label={locale === "ar" ? "تسجيل الخروج" : "Sign out"}
            disabled={logoutBusy}
            onClick={onLogout}
          >
            <span aria-hidden="true">↪</span>
          </button>
        </div>
      </header>
      <section className="workspace-page">
        <header className="page-heading">
          <div>
            <span className="eyebrow" data-abp-caption>
              {locale === "ar" ? "بوابة العملاء" : "CLIENT PORTAL"}
            </span>
            <h1>
              {locale === "ar"
                ? "الطلبات والشحنات والشكاوى"
                : "Orders, shipments & complaints"}
            </h1>
            <p>
              {locale === "ar"
                ? "تظهر فقط سجلات حساب العميل المرتبط صراحةً بهذه الهوية."
                : "Only records from the selected, explicitly bound customer are shown."}
            </p>
          </div>
        </header>
        <nav
          className="portal-tabs"
          aria-label={locale === "ar" ? "أقسام البوابة" : "Portal sections"}
        >
          {(
            [
              ["home", locale === "ar" ? "الرئيسية" : "Home"],
              ["profile", locale === "ar" ? "ملفي" : "My profile"],
              ["complaints", locale === "ar" ? "الشكاوى" : "Complaints"],
              ["repeat", locale === "ar" ? "تكرار الطلب" : "Repeat business"],
              [
                "notifications",
                locale === "ar" ? "الإشعارات" : "Notifications",
              ],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={section === id ? "active" : ""}
              aria-current={section === id ? "page" : undefined}
              onClick={() => {
                setSection(id);
              }}
            >
              {label}
            </button>
          ))}
        </nav>
        {section === "home" && (
          <div className="portal-dashboard-grid">
            <PortalPanel
              title={locale === "ar" ? "طلبات ERP" : "ERP orders"}
              value={portalDisplay(orders.data?.data)}
              loading={orders.isLoading}
              error={orders.error}
              retry={() => void orders.refetch()}
            />
            <PortalPanel
              title={locale === "ar" ? "حالة الشحنات" : "Shipment status"}
              value={portalDisplay(shipments.data?.data)}
              loading={shipments.isLoading}
              error={shipments.error}
              retry={() => void shipments.refetch()}
            />
            <PortalPanel
              title={locale === "ar" ? "الشكاوى" : "Complaints"}
              value={portalDisplay(complaints.data?.data)}
              loading={complaints.isLoading}
              error={complaints.error}
              retry={() => void complaints.refetch()}
            />
          </div>
        )}
        {section === "profile" && (
          <section className="panel data-surface portal-profile">
            <h2>{locale === "ar" ? "ملف العميل" : "Customer profile"}</h2>
            <dl>
              <div>
                <dt>{locale === "ar" ? "الاسم" : "Name"}</dt>
                <dd>
                  {available.find((item) => item.accountId === accountId)
                    ?.displayName ?? "—"}
                </dd>
              </div>
              <div>
                <dt>{locale === "ar" ? "حساب مرتبط" : "Bound account"}</dt>
                <dd>{locale === "ar" ? "نشط وآمن" : "Active and secure"}</dd>
              </div>
            </dl>
          </section>
        )}
        {section === "complaints" && (
          <>
            <PortalPanel
              title={locale === "ar" ? "الشكاوى" : "Complaints"}
              value={portalDisplay(complaints.data?.data)}
              loading={complaints.isLoading}
              error={complaints.error}
              retry={() => void complaints.refetch()}
            />
            <section className="panel action-surface">
              <h2>{locale === "ar" ? "إنشاء شكوى" : "Create complaint"}</h2>
              <label>
                {locale === "ar" ? "وصف الشكوى" : "Description"}
                <textarea
                  value={description}
                  onChange={(event) => {
                    setDescription(event.target.value);
                  }}
                  maxLength={5000}
                />
              </label>
              <button
                className="primary"
                type="button"
                disabled={description.trim().length < 3 || create.isPending}
                onClick={() => {
                  setFeedback("");
                  create.mutate();
                }}
              >
                {create.isPending
                  ? locale === "ar"
                    ? "جار الإرسال…"
                    : "Submitting…"
                  : locale === "ar"
                    ? "إرسال الشكوى"
                    : "Submit complaint"}
              </button>
              {feedback && <p className="status success">{feedback}</p>}
              {create.error && (
                <p role="alert">
                  {locale === "ar"
                    ? "تعذر إرسال الشكوى."
                    : "Complaint was not submitted."}
                </p>
              )}
            </section>
          </>
        )}
        {section === "repeat" && (
          <PortalPanel
            title={
              locale === "ar"
                ? "سجل الطلبات القابلة للتكرار"
                : "Orders available for repeat business"
            }
            value={portalDisplay(orders.data?.data)}
            loading={orders.isLoading}
            error={orders.error}
            retry={() => void orders.refetch()}
          />
        )}
        {section === "notifications" && (
          <div className="portal-dashboard-grid">
            <PortalPanel
              title={locale === "ar" ? "تحديثات الشحن" : "Shipment updates"}
              value={portalDisplay(shipments.data?.data)}
              loading={shipments.isLoading}
              error={shipments.error}
              retry={() => void shipments.refetch()}
            />
            <PortalPanel
              title={locale === "ar" ? "تحديثات الشكاوى" : "Complaint updates"}
              value={portalDisplay(complaints.data?.data)}
              loading={complaints.isLoading}
              error={complaints.error}
              retry={() => void complaints.refetch()}
            />
          </div>
        )}
      </section>
    </main>
  );
}

function PortalPanel({
  title,
  value,
  loading,
  error,
  retry,
}: {
  title: string;
  value: unknown;
  loading: boolean;
  error: unknown;
  retry: () => void;
}) {
  return (
    <section className="panel data-surface">
      <div className="section-heading">
        <h2>{title}</h2>
      </div>
      <ErrorBanner error={error} retry={retry} />
      {loading ? (
        <div className="skeleton-stack" aria-label={title} role="status">
          <span />
          <span />
          <span />
        </div>
      ) : (
        <DataView value={value ?? []} compact />
      )}
    </section>
  );
}
function required<T>(result: {
  data?: T;
  error?: unknown;
  response: Response;
}): T {
  if (result.data === undefined)
    throw new Error(`PORTAL_${String(result.response.status)}`);
  return result.data;
}

const portalTechnicalKeys = new Set([
  "id",
  "accountId",
  "complaintId",
  "erpOrderId",
  "productId",
  "shipmentId",
]);

function portalDisplay(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(portalDisplay);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !portalTechnicalKeys.has(key))
      .map(([key, nested]) => [key, portalDisplay(nested)]),
  );
}
