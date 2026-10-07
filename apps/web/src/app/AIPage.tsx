import { useState } from "react";
import { Link } from "react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import type { ApiClient } from "@abp/api-client";
import { useI18n } from "../i18n/i18n.tsx";
import { commercialRequest, isObject, rows, str } from "./commercial-api.ts";
import { ErrorBanner, ScreenIntro, Sparkline } from "./CommercialUI.tsx";
import { notificationRoute } from "./NotificationsPage.tsx";
export function AIPage({ client }: { client: ApiClient }) {
  const { locale } = useI18n();
  const [page, setPage] = useState(1);
  const [resourceType, setResourceType] = useState("ACCOUNT");
  const [resourceId, setResourceId] = useState("");
  const query = useQuery({
    queryKey: ["ai-advisories", page],
    queryFn: () =>
      commercialRequest(client, "GET", "/ai/advisories", {
        path: {},
        query: { page, limit: 25 },
      }),
  });
  const dismiss = useMutation({
    mutationFn: (advisoryId: string) =>
      commercialRequest(client, "POST", "/ai/advisories/{advisoryId}/dismiss", {
        path: { advisoryId },
        body: {},
        idempotencyKey: crypto.randomUUID(),
      }),
    onSuccess: () => void query.refetch(),
  });
  const resources = useQuery({
    queryKey: ["ai-advisory-resources", resourceType],
    queryFn: () => {
      const path =
        resourceType === "TARGET_ACCOUNT"
          ? "/target-accounts"
          : resourceType === "OPPORTUNITY"
            ? "/opportunities"
            : "/accounts";
      return commercialRequest(client, "GET", path, {
        path: {},
        query: { page: 1, limit: 100 },
      });
    },
  });
  const generate = useMutation({
    mutationFn: () =>
      commercialRequest(client, "POST", "/ai/advisories/generate", {
        path: {},
        body: { resourceTypeCode: resourceType, resourceId },
        idempotencyKey: crypto.randomUUID(),
      }),
    onSuccess: () => void query.refetch(),
  });
  const items = rows(query.data?.data);
  const resourceItems = rows(resources.data?.data);
  return (
    <section className="workspace-page ai-page">
      <header className="ai-hero">
        <div className="ai-hero-inner">
          <div className="ai-icon-wrap">✦</div>
          <div>
            <h1>{locale === "ar" ? "المستشار الذكي" : "AI Advisory Brief"}</h1>
            <p>
              {locale === "ar"
                ? "رؤى تساعدك على اتخاذ القرار التجاري"
                : "Insights to guide your next commercial decision"}
            </p>
          </div>
        </div>
      </header>
      <ScreenIntro />
      <form
        className="ai-generate-panel"
        onSubmit={(event) => {
          event.preventDefault();
          if (resourceId) generate.mutate();
        }}
      >
        <div className="ai-generate-copy">
          <strong>
            {locale === "ar"
              ? "إنشاء مراجعة تجارية بمساعدة OpenAI"
              : "Generate an OpenAI-assisted commercial review"}
          </strong>
          <span>
            {locale === "ar"
              ? "النتيجة استشارية، تُحفظ للمراجعة والتدقيق، ولا تنفذ أي قرار تجاري."
              : "The result is advisory, saved for review and audit, and never executes a commercial decision."}
          </span>
        </div>
        <label>
          <span>{locale === "ar" ? "نوع السجل" : "Record type"}</span>
          <select
            value={resourceType}
            onChange={(event) => {
              setResourceType(event.target.value);
              setResourceId("");
            }}
          >
            <option value="ACCOUNT">
              {locale === "ar" ? "عميل" : "Customer"}
            </option>
            <option value="TARGET_ACCOUNT">
              {locale === "ar" ? "عميل مستهدف" : "Target account"}
            </option>
            <option value="OPPORTUNITY">
              {locale === "ar" ? "فرصة" : "Opportunity"}
            </option>
          </select>
        </label>
        <label>
          <span>{locale === "ar" ? "السجل" : "Record"}</span>
          <select
            required
            value={resourceId}
            disabled={resources.isLoading}
            onChange={(event) => {
              setResourceId(event.target.value);
            }}
          >
            <option value="">
              {resources.isLoading
                ? locale === "ar"
                  ? "جارٍ تحميل السجلات…"
                  : "Loading records…"
                : locale === "ar"
                  ? "اختر من القائمة"
                  : "Choose a record"}
            </option>
            {resourceItems.map((resource) => {
              const id = resourceIdentifier(resource);
              return id ? (
                <option key={id} value={id}>
                  {resourceLabel(resource)}
                </option>
              ) : null;
            })}
          </select>
        </label>
        <button
          className="primary"
          type="submit"
          disabled={!resourceId || generate.isPending}
        >
          {generate.isPending
            ? locale === "ar"
              ? "جارٍ إنشاء المراجعة…"
              : "Generating review…"
            : locale === "ar"
              ? "إنشاء المراجعة"
              : "Generate review"}
        </button>
      </form>
      <ErrorBanner error={query.error} retry={() => void query.refetch()} />
      <ErrorBanner
        error={resources.error}
        retry={() => void resources.refetch()}
      />
      <ErrorBanner
        error={generate.error}
        retry={() => {
          if (resourceId) generate.mutate();
        }}
      />
      <ErrorBanner
        error={dismiss.error}
        retry={() => {
          if (dismiss.variables) dismiss.mutate(dismiss.variables);
        }}
      />
      <div className="ai-cards-wrap">
        {items.map((item) => {
          const output = isObject(item.outputJsonb) ? item.outputJsonb : {};
          const priority = str(output.priority ?? "MEDIUM").toLowerCase();
          const data = Array.isArray(output.sparkData)
            ? output.sparkData.filter((v): v is number => typeof v === "number")
            : [Number(item.scoreNumeric ?? 0)];
          return (
            <article
              className={`advisory-card priority-${priority}`}
              key={str(item.aiRuleOutputId)}
            >
              <header className="advisory-header">
                <span
                  className={`badge badge-${priority === "high" ? "danger" : priority === "low" ? "info" : "warning"}`}
                >
                  {locale === "ar"
                    ? (
                        {
                          high: "عالي",
                          medium: "متوسط",
                          low: "منخفض",
                        } as Record<string, string>
                      )[priority]
                    : priority.toUpperCase()}
                </span>
                <span className="advisory-category">
                  {str(
                    locale === "ar"
                      ? (output.categoryAr ?? output.category)
                      : (output.category ?? item.ruleCode),
                  )}
                </span>
                <button
                  className="advisory-dismiss"
                  disabled={dismiss.isPending}
                  aria-label={locale === "ar" ? "تجاهل" : "Dismiss"}
                  onClick={() => {
                    dismiss.mutate(str(item.aiRuleOutputId));
                  }}
                >
                  ×
                </button>
              </header>
              <h2 className="advisory-title">
                {str(
                  locale === "ar"
                    ? (output.titleAr ?? output.title)
                    : (output.title ?? item.ruleCode),
                )}
              </h2>
              <p className="advisory-insight">
                {str(
                  locale === "ar"
                    ? (output.insightAr ?? output.insight ?? output.text)
                    : (output.insight ?? output.text ?? item.outputTypeCode),
                )}
              </p>
              <div className="advisory-footer">
                <div className="advisory-kpi">
                  <span>
                    {str(
                      locale === "ar"
                        ? (output.kpiLabelAr ?? output.kpiLabel)
                        : (output.kpiLabel ?? "Score"),
                    )}
                  </span>
                  <strong>{str(output.kpiValue ?? item.scoreNumeric)}</strong>
                </div>
                <Link className="primary" to={notificationRoute(item)}>
                  {locale === "ar" ? "عرض التفاصيل" : "View details"} →
                </Link>
              </div>
              <Sparkline data={data} color="#0284c7" />
            </article>
          );
        })}
      </div>
      {!query.isLoading && !query.error && items.length === 0 && (
        <p className="ai-empty">
          {locale === "ar"
            ? "لا توجد رؤى نشطة حالياً"
            : "No active insights right now."}
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
    </section>
  );
}

function resourceIdentifier(resource: Record<string, unknown>): string {
  return str(
    resource.accountId ??
      resource.targetAccountId ??
      resource.opportunityId ??
      resource.id,
  ).replace("—", "");
}

function resourceLabel(resource: Record<string, unknown>): string {
  return str(
    resource.canonicalName ??
      resource.companyName ??
      resource.name ??
      resource.title ??
      resource.subject ??
      resource.accountRef ??
      resourceIdentifier(resource),
  );
}
