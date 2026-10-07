import {
  ErrorBanner,
  ScreenIntro,
  SlideOver,
  StatusChip,
  TabBar,
} from "./CommercialUI.tsx";
import { enumLabel } from "../i18n/enum-labels.ts";
import { CustomerRelations, customerTabs } from "./CustomerRelations.tsx";
import { CustomerSharePanel } from "./CustomerSharePanel.tsx";
import { GroupMembershipPanel } from "./GroupMembershipPanel.tsx";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import type { ApiClient, components } from "@abp/api-client";

type AccountCommercialHistory =
  components["schemas"]["AccountCommercialHistory"];
import { permissions } from "@abp/contracts";
import {
  archiveAccount,
  createAccount,
  CustomerApiError,
  getAccount,
  listAccounts,
  listCountries,
  updateAccount,
  type Me,
} from "../api/customer-api.ts";
import {
  addContactChannel,
  createContact,
  getContact,
  listContacts,
  removeContactChannel,
  revokeContactShare,
  shareContacts,
  updateContact,
} from "../api/contact-api.ts";
import { useI18n } from "../i18n/i18n.tsx";
import { listProjects } from "../api/project-api.ts";
import { commercialRequest, isObject, str } from "./commercial-api.ts";
import { CustomerPriceHistory } from "./CustomerPriceHistory.tsx";

export function CustomerPage({ client, me }: { client: ApiClient; me: Me }) {
  const { locale } = useI18n();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("overview");
  const { accountId } = useParams();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [countryCode, setCountryCode] = useState("");
  const [categoryCode, setCategoryCode] = useState("");
  const [businessTypeCode, setBusinessTypeCode] = useState<
    "" | "FORMWORK" | "OTHER"
  >("");
  const [page, setPage] = useState(1);
  const [archiveState, setArchiveState] = useState<
    "ACTIVE" | "ARCHIVED" | "ALL"
  >("ACTIVE");
  const [showCreate, setShowCreate] = useState(
    () => searchParams.get("create") === "1",
  );
  const granted = useMemo(() => new Set(me.access.permissions), [me]);

  const countries = useQuery({
    queryKey: ["reference-countries"],
    queryFn: () => listCountries(client),
  });
  const scopedCountries = useMemo(() => {
    const allowedCountries = new Set(me.access.countryScope.countryCodes);
    return (countries.data ?? []).filter((country) =>
      allowedCountries.has(country.countryCode),
    );
  }, [countries.data, me.access.countryScope.countryCodes]);
  const accounts = useQuery({
    queryKey: [
      "accounts",
      search,
      countryCode,
      categoryCode,
      businessTypeCode,
      archiveState,
      page,
    ],
    queryFn: () =>
      listAccounts(client, {
        ...(search === "" ? {} : { search }),
        ...(countryCode === "" ? {} : { countryCode }),
        ...(categoryCode === "" ? {} : { accountCategoryCode: categoryCode }),
        ...(businessTypeCode === "" ? {} : { businessTypeCode }),
        archiveState,
        page,
        limit: 25,
        sort: "canonicalName:asc",
      }),
  });
  const formworkMix = useQuery({
    queryKey: ["customer-formwork-mix"],
    enabled: accountId === undefined,
    queryFn: async () => {
      const result = await client.GET("/accounts/formwork-mix", {});
      if (!result.data) throw new Error("FORMWORK_MIX_UNAVAILABLE");
      const data: unknown = result.data.data;
      if (
        data === null ||
        typeof data !== "object" ||
        Array.isArray(data) ||
        !("month" in data) ||
        !("year" in data)
      )
        return undefined;
      return data as components["schemas"]["FormworkMix"];
    },
  });
  const detail = useQuery({
    queryKey: ["account", accountId],
    queryFn: () => {
      if (accountId === undefined)
        return Promise.reject(new Error("ACCOUNT_ID_REQUIRED"));
      return getAccount(client, accountId);
    },
    enabled: accountId !== undefined,
  });
  const segments = useQuery<readonly CustomerSegmentHeader[]>({
    queryKey: ["account-segments", accountId],
    enabled: accountId !== undefined && granted.has("customer-segments.view"),
    queryFn: async () => {
      const result = await client.GET(
        "/accounts/{accountId}/segment-assignments",
        { params: { path: { accountId: accountId ?? "" } } },
      );
      if (!result.data) throw new Error("CUSTOMER_SEGMENTS_UNAVAILABLE");
      return result.data.data as unknown as readonly CustomerSegmentHeader[];
    },
  });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["accounts"] });
    await queryClient.invalidateQueries({ queryKey: ["account", accountId] });
  };

  if (accountId !== undefined) {
    return (
      <section className="customer-page customer-360-page">
        {detail.isLoading && (
          <LoadingSkeleton
            label={
              locale === "ar" ? "جار تحميل ملف العميل" : "Loading Customer 360"
            }
          />
        )}
        {detail.error && (
          <ErrorBanner
            error={detail.error}
            retry={() => void detail.refetch()}
          />
        )}
        {detail.data && (
          <div className="customer-360-shell">
            <header className="customer-resource-header">
              <div className="customer-resource-identity">
                <span className="entity-avatar large" aria-hidden="true">
                  {detail.data.data.canonicalName.slice(0, 1).toUpperCase()}
                </span>
                <div>
                  <span className="eyebrow" data-abp-caption>
                    {detail.data.data.accountRef}
                  </span>
                  <h1>{detail.data.data.canonicalName}</h1>
                  <p>
                    {detail.data.data.geography.country?.displayName ??
                      "Unclassified"}{" "}
                    ·{" "}
                    {detail.data.data.geography.continent
                      ? enumLabel(detail.data.data.geography.continent, locale)
                      : "Unclassified"}{" "}
                    ·{" "}
                    {enumLabel(detail.data.data.geography.marketScope, locale)}
                  </p>
                </div>
              </div>
              <div className="customer-resource-actions">
                <StatusChip code={detail.data.data.recordStatusCode} />
                <Link className="button secondary" to="/customers">
                  {locale === "ar" ? "العودة للقائمة" : "Back to grid"}
                </Link>
              </div>
            </header>
            <ScreenIntro />
            <dl className="customer-header-facts">
              <div>
                <dt>{locale === "ar" ? "القطاع" : "Segment"}</dt>
                <dd>
                  {segments.data?.find((segment) => !segment.effectiveTo)?.[
                    locale === "ar" ? "displayNameAr" : "displayNameEn"
                  ] ?? (
                    <StatusChip code={detail.data.data.accountCategoryCode} />
                  )}
                </dd>
              </div>
              <div>
                <dt>{locale === "ar" ? "نوع العميل" : "Customer type"}</dt>
                <dd>
                  <span
                    className={businessTypeClass(
                      detail.data.data.businessTypeCode,
                    )}
                  >
                    {businessTypeLabel(
                      detail.data.data.businessTypeCode,
                      locale,
                    )}
                  </span>
                </dd>
              </div>
              <div>
                <dt>{locale === "ar" ? "المالك" : "Owner"}</dt>
                <dd>
                  <bdi dir="auto">
                    {detail.data.data.ownerUserId === me.user.userId
                      ? me.user.displayName
                      : shortIdentity(detail.data.data.ownerUserId, locale)}
                  </bdi>
                </dd>
              </div>
              <div>
                <dt>{locale === "ar" ? "مزامنة ERP" : "ERP sync"}</dt>
                <dd>
                  {syncStatusLabel(
                    (detail.data.data as Partial<typeof detail.data.data>)
                      .erpSyncStatus?.statusCode ?? "NOT_CONFIGURED",
                    locale,
                  )}
                </dd>
              </div>
              <div>
                <dt>{locale === "ar" ? "جهات الاتصال" : "Contacts"}</dt>
                <dd>
                  {(detail.data.data as Partial<typeof detail.data.data>)
                    .contacts?.length ?? 0}
                </dd>
              </div>
              <div>
                <dt>{locale === "ar" ? "الفرص" : "Opportunities"}</dt>
                <dd>
                  {(detail.data.data as Partial<typeof detail.data.data>)
                    .opportunities?.length ?? 0}
                </dd>
              </div>
              <div>
                <dt>{locale === "ar" ? "عروض الأسعار" : "Quotations"}</dt>
                <dd>
                  {(detail.data.data as Partial<typeof detail.data.data>)
                    .quotations?.length ?? 0}
                </dd>
              </div>
            </dl>
            <TabBar
              tabs={customerTabs.filter(
                (tab) =>
                  granted.has(tab.permission) &&
                  (tab.id !== "payments" ||
                    me.access.roles.some(
                      (role) => role.code === "SYSTEM_ADMIN",
                    ) ||
                    me.access.workspaces.some(
                      (w) => w.workspace === "FINANCE" && w.enabled,
                    )),
              )}
              active={activeTab}
              onChange={setActiveTab}
            />
            <div
              className="panel detail-panel customer-360-content"
              id="overview"
            >
              {activeTab === "contacts" ? (
                <ContactSection
                  client={client}
                  me={me}
                  accountId={accountId}
                  ownerUserId={detail.data.data.ownerUserId}
                />
              ) : activeTab === "projects" ? (
                <ProjectSection client={client} accountId={accountId} />
              ) : activeTab === "history" ? (
                <PurchaseHistorySection client={client} accountId={accountId} />
              ) : activeTab === "sharing" ? (
                <CustomerSharePanel
                  client={client}
                  me={me}
                  accountId={accountId}
                  ownerUserId={detail.data.data.ownerUserId}
                />
              ) : activeTab === "source" ? (
                <CustomerSource account={detail.data.data} />
              ) : activeTab !== "overview" ? (
                <CustomerRelations
                  key={activeTab}
                  client={client}
                  accountId={accountId}
                  tab={activeTab}
                />
              ) : (
                <CustomerDetail
                  client={client}
                  me={me}
                  account={detail.data.data}
                  countries={scopedCountries}
                  onChanged={refresh}
                />
              )}
            </div>
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="customer-page customer-grid-page">
      <header className="resource-header customer-grid-header">
        <div>
          <p className="resource-kicker">
            {locale === "ar"
              ? "المبيعات · محفظة العملاء"
              : "Sales core · Customer portfolio"}
          </p>
          <h1>{locale === "ar" ? "العملاء" : "Customers"}</h1>
          <p>
            {locale === "ar"
              ? "إدارة العلاقات والمشروعات والفرص التجارية."
              : "Manage relationships, projects and commercial opportunities."}
          </p>
        </div>
        <div className="resource-header-actions">
          <span className="grid-count">
            <strong>{accounts.data?.meta.total ?? "—"}</strong>
            <small>{locale === "ar" ? "عميل" : "customers"}</small>
          </span>
          {granted.has(permissions.accountsCreate) && (
            <button
              type="button"
              className="primary"
              onClick={() => {
                setShowCreate((value) => !value);
              }}
            >
              {showCreate
                ? locale === "ar"
                  ? "إلغاء"
                  : "Cancel"
                : locale === "ar"
                  ? "＋ عميل جديد"
                  : "＋ New customer"}
            </button>
          )}
        </div>
      </header>
      <ScreenIntro />

      <FormworkMixPanel
        data={formworkMix.data}
        loading={formworkMix.isLoading}
        locale={locale}
      />

      {showCreate && (
        <SlideOver
          title={locale === "ar" ? "عميل جديد" : "New customer"}
          onClose={() => {
            setShowCreate(false);
          }}
        >
          <CreateCustomerForm
            client={client}
            countries={scopedCountries}
            onCreated={async (id) => {
              setShowCreate(false);
              await refresh();
              await navigate(`/customers/${id}`);
            }}
          />
        </SlideOver>
      )}

      <section
        className="enterprise-grid-card"
        aria-label={locale === "ar" ? "قائمة العملاء" : "Customers grid"}
      >
        <div
          className="saved-view-strip"
          aria-label={locale === "ar" ? "عروض العملاء" : "Customer views"}
        >
          <span className="active-view">
            {locale === "ar"
              ? "كل العملاء المصرح بهم"
              : "All authorized customers"}
          </span>
          <span>
            {locale === "ar"
              ? "نطاق الدول يُطبّق أولاً · المنع له الأولوية"
              : "Country Scope first · DENY wins"}
          </span>
        </div>
        <div className="enterprise-grid-toolbar" aria-label="Customer filters">
          <label className="grid-search filter-field">
            <span className="filter-field-label">
              {locale === "ar" ? "بحث" : "Search"}
            </span>
            <input
              aria-label={locale === "ar" ? "بحث العملاء" : "Search customers"}
              placeholder={
                locale === "ar"
                  ? "ابحث بالعميل أو المرجع أو الرقم"
                  : "Search customer, reference or number"
              }
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
            />
          </label>
          <label className="filter-field">
            <span className="filter-field-label">
              {locale === "ar" ? "الدولة" : "Country"}
            </span>
            <select
              aria-label="Filter by country"
              value={countryCode}
              onChange={(event) => {
                setCountryCode(event.target.value);
                setPage(1);
              }}
            >
              <option value="">
                {locale === "ar"
                  ? "كل الدول المصرح بها"
                  : "All scoped countries"}
              </option>
              {scopedCountries.map((country) => (
                <option key={country.countryCode} value={country.countryCode}>
                  {country.displayName}
                </option>
              ))}
            </select>
          </label>
          <label className="filter-field">
            <span className="filter-field-label">
              {locale === "ar" ? "نوع العميل" : "Customer type"}
            </span>
            <select
              aria-label={locale === "ar" ? "نوع العميل" : "Customer type"}
              value={businessTypeCode}
              onChange={(event) => {
                setBusinessTypeCode(
                  event.target.value as "" | "FORMWORK" | "OTHER",
                );
                setPage(1);
              }}
            >
              <option value="">
                {locale === "ar" ? "كل الأنواع" : "All types"}
              </option>
              <option value="FORMWORK">
                {locale === "ar" ? "عميل فورم ورك" : "Formwork customer"}
              </option>
              <option value="OTHER">
                {locale === "ar" ? "عميل آخر" : "Other customer"}
              </option>
            </select>
          </label>
          <label className="filter-field">
            <span className="filter-field-label">
              {locale === "ar" ? "التصنيف" : "Classification"}
            </span>
            <select
              aria-label={
                locale === "ar" ? "تصنيف العميل" : "Customer classification"
              }
              value={categoryCode}
              onChange={(event) => {
                setCategoryCode(event.target.value);
                setPage(1);
              }}
            >
              <option value="">
                {locale === "ar" ? "كل التصنيفات" : "All classifications"}
              </option>
              {ACCOUNT_CATEGORY_OPTIONS.filter((option) => option.value).map(
                (option) => (
                  <option key={option.value} value={option.value}>
                    {locale === "ar" ? option.ar : option.en}
                  </option>
                ),
              )}
            </select>
          </label>
          <label className="filter-field">
            <span className="filter-field-label">
              {locale === "ar" ? "الحالة" : "Status"}
            </span>
            <select
              aria-label="Archive state"
              value={archiveState}
              onChange={(event) => {
                setArchiveState(event.target.value as typeof archiveState);
                setPage(1);
              }}
            >
              <option value="ACTIVE">
                {locale === "ar" ? "نشط" : "Active"}
              </option>
              <option value="ARCHIVED">
                {locale === "ar" ? "مؤرشف" : "Archived"}
              </option>
              <option value="ALL">
                {locale === "ar" ? "كل الحالات" : "All states"}
              </option>
            </select>
          </label>
        </div>

        {accounts.isLoading && (
          <LoadingSkeleton
            label={locale === "ar" ? "جار تحميل العملاء" : "Loading customers"}
            rows={5}
          />
        )}
        {accounts.error && (
          <Status
            text={
              locale === "ar"
                ? "تعذر تحميل العملاء."
                : "Customers could not be loaded."
            }
            tone="error"
          />
        )}
        {accounts.data && (
          <>
            <div className="enterprise-table-scroll customer-table-scroll">
              <table className="enterprise-table customer-list-table">
                <thead>
                  <tr>
                    <th>{locale === "ar" ? "العميل" : "Customer"}</th>
                    <th>{locale === "ar" ? "المرجع" : "Reference"}</th>
                    <th>{locale === "ar" ? "رقم العميل" : "Customer no."}</th>
                    <th>{locale === "ar" ? "الدولة" : "Country"}</th>
                    <th>{locale === "ar" ? "الفئة" : "Category"}</th>
                    <th>{locale === "ar" ? "النوع" : "Type"}</th>
                    <th>{locale === "ar" ? "الحالة" : "Status"}</th>
                    <th>
                      <span className="sr-only">
                        {locale === "ar" ? "فتح" : "Open"}
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.data.data.map((account) => (
                    <tr key={account.accountId}>
                      <td
                        className="customer-primary-cell"
                        data-label={locale === "ar" ? "العميل" : "Customer"}
                      >
                        <Link
                          className="customer-cell"
                          to={`/customers/${account.accountId}`}
                        >
                          <span className="entity-avatar" aria-hidden="true">
                            {account.canonicalName.slice(0, 1).toUpperCase()}
                          </span>
                          <strong>{account.canonicalName}</strong>
                        </Link>
                      </td>
                      <td data-label={locale === "ar" ? "المرجع" : "Reference"}>
                        <code>{account.accountRef}</code>
                      </td>
                      <td
                        data-label={
                          locale === "ar" ? "رقم العميل" : "Customer no."
                        }
                      >
                        {account.customerNumber ?? "—"}
                      </td>
                      <td data-label={locale === "ar" ? "الدولة" : "Country"}>
                        {account.country?.displayName ??
                          (locale === "ar" ? "غير مصنف" : "Unclassified")}
                      </td>
                      <td data-label={locale === "ar" ? "الفئة" : "Category"}>
                        {account.accountCategoryCode ? (
                          <StatusChip code={account.accountCategoryCode} />
                        ) : (
                          "—"
                        )}
                      </td>
                      <td data-label={locale === "ar" ? "النوع" : "Type"}>
                        <span
                          className={businessTypeClass(
                            account.businessTypeCode,
                          )}
                        >
                          {businessTypeLabel(account.businessTypeCode, locale)}
                        </span>
                      </td>
                      <td data-label={locale === "ar" ? "الحالة" : "Status"}>
                        <StatusChip code={account.recordStatusCode} />
                      </td>
                      <td className="customer-open-cell">
                        <Link
                          className="row-open"
                          to={`/customers/${account.accountId}`}
                          aria-label={
                            locale === "ar"
                              ? `فتح ${account.canonicalName}`
                              : `Open ${account.canonicalName}`
                          }
                        >
                          →
                        </Link>
                      </td>
                    </tr>
                  ))}
                  {accounts.data.data.length === 0 && (
                    <tr>
                      <td colSpan={8} className="table-empty">
                        {locale === "ar"
                          ? "لا يوجد عملاء في هذا النطاق المصرح."
                          : "No customers in this authorized view."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <footer className="grid-pagination">
              <span>
                {locale === "ar"
                  ? `صفحة ${String(accounts.data.meta.page)} · ${String(accounts.data.meta.total)} سجل`
                  : `Page ${String(accounts.data.meta.page)} · ${String(accounts.data.meta.total)} records`}
              </span>
              <div>
                <button
                  type="button"
                  className="secondary"
                  disabled={page <= 1}
                  onClick={() => {
                    setPage((value) => Math.max(1, value - 1));
                  }}
                >
                  {locale === "ar" ? "السابق" : "Previous"}
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={!accounts.data.meta.hasNext}
                  onClick={() => {
                    setPage((value) => value + 1);
                  }}
                >
                  {locale === "ar" ? "التالي" : "Next"}
                </button>
              </div>
            </footer>
          </>
        )}
      </section>
    </section>
  );
}

type CustomerSegmentHeader = {
  effectiveTo?: string | null;
  displayNameAr?: string | null;
  displayNameEn?: string | null;
};

function businessTypeLabel(
  value: "FORMWORK" | "OTHER" | undefined,
  locale: "en" | "ar",
) {
  if (value === undefined) return "—";
  if (value === "FORMWORK")
    return locale === "ar" ? "عميل فورم ورك" : "Formwork customer";
  return locale === "ar" ? "عميل آخر" : "Other customer";
}

/**
 * The chip's modifier class, without assuming the field arrived.
 *
 * `businessTypeCode` is required by the contract, and the grid read it as
 * `code.toLowerCase()` on that basis — so a single row without it threw inside
 * the row map and the whole customer screen fell to the error boundary. A
 * missing value is worth showing as unknown; it is not worth losing the list
 * of customers over.
 */
function businessTypeClass(value: string | undefined) {
  return `business-type-chip is-${(value ?? "unknown").toLowerCase()}`;
}

function FormworkMixPanel({
  data,
  loading,
  locale,
}: {
  data: components["schemas"]["FormworkMix"] | undefined;
  loading: boolean;
  locale: "en" | "ar";
}) {
  if (loading) return null;
  if (!data) return null;
  const ar = locale === "ar";
  const periods = [
    { key: "month", label: ar ? "هذا الشهر" : "This month", value: data.month },
    { key: "year", label: ar ? "هذه السنة" : "This year", value: data.year },
  ] as const;
  return (
    <section
      className="formwork-mix-panel"
      aria-label={ar ? "نسبة عملاء الفورم ورك" : "Formwork customer mix"}
    >
      <header>
        <div>
          <span>{ar ? "مزيج العملاء" : "Customer mix"}</span>
          <h2>{ar ? "هدف الفورم ورك ٧٠٪" : "70% formwork target"}</h2>
        </div>
        <p>
          {ar
            ? "من العملاء المختلفين اللي عندهم أوامر بيع فعلية في الفترة."
            : "Of distinct customers with actual ERP sales orders in the period."}
        </p>
      </header>
      <div className="formwork-mix-grid">
        {periods.map(({ key, label, value }) => (
          <article key={key} className={`is-${value.statusCode.toLowerCase()}`}>
            <div className="formwork-mix-value">
              <strong>
                {value.totalCustomers === 0
                  ? "—"
                  : `${String(value.sharePct)}%`}
              </strong>
              <span>{label}</span>
            </div>
            <div className="formwork-mix-track" aria-hidden="true">
              <span
                style={{
                  inlineSize: `${String(Math.min(100, value.sharePct))}%`,
                }}
              />
              <i style={{ insetInlineStart: `${String(data.targetPct)}%` }} />
            </div>
            <footer>
              <span>
                {ar ? "فورم ورك" : "Formwork"}: {value.formworkCustomers}
              </span>
              <span>
                {ar ? "إجمالي العملاء" : "Total customers"}:{" "}
                {value.totalCustomers}
              </span>
              <b>
                {value.statusCode === "NO_DATA"
                  ? ar
                    ? "لا توجد تعاملات"
                    : "No activity"
                  : value.statusCode === "ON_TARGET"
                    ? ar
                      ? "على الهدف"
                      : "On target"
                    : ar
                      ? `ناقص ${String(Math.abs(value.gapPct))}%`
                      : `${String(Math.abs(value.gapPct))}% below`}
              </b>
            </footer>
          </article>
        ))}
      </div>
    </section>
  );
}

function CustomerSource({
  account,
}: {
  account: Awaited<ReturnType<typeof getAccount>>["data"];
}) {
  const { locale } = useI18n();
  const syncValue = (account as Partial<typeof account>).erpSyncStatus;
  const sync = syncValue ?? {
    statusCode: "NOT_CONFIGURED" as const,
    totalOrders: 0,
    pendingCount: 0,
    syncedCount: 0,
    failedCount: 0,
    latestSyncedAt: null,
  };
  const entries = [
    [
      locale === "ar" ? "النظام المرجعي" : "System of record",
      "ABP Commercial System",
    ],
    [locale === "ar" ? "مرجع السجل" : "Record reference", account.accountRef],
    [locale === "ar" ? "نسخة السجل" : "Record version", account.rowVersion],
    [
      locale === "ar" ? "حالة السجل" : "Record status",
      account.recordStatusCode,
    ],
    [locale === "ar" ? "حالة مزامنة ERP" : "ERP sync status", sync.statusCode],
    [locale === "ar" ? "طلبات ERP" : "ERP orders", String(sync.totalOrders)],
    [locale === "ar" ? "تمت مزامنتها" : "Synced", String(sync.syncedCount)],
    [
      locale === "ar" ? "بانتظار المزامنة" : "Pending",
      String(sync.pendingCount),
    ],
    [locale === "ar" ? "فشلت" : "Failed", String(sync.failedCount)],
    [
      locale === "ar" ? "آخر مزامنة" : "Latest sync",
      sync.latestSyncedAt
        ? new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", {
            dateStyle: "medium",
            timeStyle: "short",
          }).format(new Date(sync.latestSyncedAt))
        : locale === "ar"
          ? "لا توجد مزامنة"
          : "No sync recorded",
    ],
  ] as const;
  return (
    <section className="customer-source" role="tabpanel">
      <header className="section-heading">
        <div>
          <h3>{locale === "ar" ? "مصدر السجل" : "Record source"}</h3>
          <p>
            {locale === "ar"
              ? "بيانات المصدر الآمنة وحالة التكامل لهذا العميل."
              : "Safe source metadata and integration state for this customer."}
          </p>
        </div>
      </header>
      <dl className="detail-grid source-detail-grid">
        {entries.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function shortIdentity(value: string, locale: "en" | "ar") {
  const suffix = value.slice(-8);
  return locale === "ar" ? `مستخدم …${suffix}` : `User …${suffix}`;
}

function syncStatusLabel(value: string, locale: "en" | "ar") {
  if (locale === "en") return value.replaceAll("_", " ").toLowerCase();
  const labels: Readonly<Record<string, string>> = {
    NOT_CONFIGURED: "غير مهيأ",
    NOT_REQUIRED: "غير مطلوب",
    PENDING_SYNC: "بانتظار المزامنة",
    SYNCING: "جار المزامنة",
    SYNCED: "تمت المزامنة",
    SYNC_FAILED: "فشلت المزامنة",
    MIXED: "حالة مختلطة",
  };
  return labels[value] ?? value;
}

const ACCOUNT_CATEGORY_OPTIONS = [
  { value: "", en: "Not classified", ar: "غير مصنّف" },
  { value: "ACROW", en: "ACROW", ar: "أكرو" },
  { value: "AICS", en: "AICS", ar: "AICS" },
  { value: "OTHER", en: "Other", ar: "أخرى" },
];

export function CreateCustomerForm({
  client,
  countries,
  onCreated,
}: {
  client: ApiClient;
  countries: readonly { countryCode: string; displayName: string }[];
  onCreated: (id: string) => Promise<void>;
}) {
  const { locale } = useI18n();
  const [canonicalName, setCanonicalName] = useState("");
  const [countryCode, setCountryCode] = useState("");
  const [categoryCode, setCategoryCode] = useState("");
  const [businessTypeCode, setBusinessTypeCode] = useState<
    "FORMWORK" | "OTHER"
  >("OTHER");
  const [error, setError] = useState<string>();
  const mutation = useMutation({
    mutationFn: () =>
      createAccount(client, {
        canonicalName,
        countryCode,
        ...(categoryCode ? { accountCategoryCode: categoryCode } : {}),
        businessTypeCode,
      }),
    onSuccess: ({ data }) => {
      void onCreated(data.accountId);
    },
    onError: (failure) => {
      setError(errorText(failure));
    },
  });
  useDirtyProtection(canonicalName.length > 0 || countryCode.length > 0);
  return (
    <form
      className="panel form-card"
      onSubmit={(event) => {
        event.preventDefault();
        if (!mutation.isPending) mutation.mutate();
      }}
    >
      <h2>{locale === "ar" ? "إنشاء عميل" : "Create customer"}</h2>
      <label>
        {locale === "ar" ? "الاسم" : "Name"}
        <input
          required
          maxLength={300}
          value={canonicalName}
          onChange={(e) => {
            setCanonicalName(e.target.value);
          }}
        />
      </label>
      <label>
        {locale === "ar" ? "الدولة" : "Country"}
        <select
          required
          value={countryCode}
          onChange={(e) => {
            setCountryCode(e.target.value);
          }}
        >
          <option value="">
            {locale === "ar"
              ? "اختر من البيانات المرجعية المعتمدة"
              : "Choose from governed reference data"}
          </option>
          {countries.map((country) => (
            <option key={country.countryCode} value={country.countryCode}>
              {country.displayName}
            </option>
          ))}
        </select>
      </label>
      <label>
        {locale === "ar" ? "تصنيف العميل" : "Customer classification"}
        <select
          value={categoryCode}
          onChange={(e) => {
            setCategoryCode(e.target.value);
          }}
        >
          {ACCOUNT_CATEGORY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {locale === "ar" ? option.ar : option.en}
            </option>
          ))}
        </select>
      </label>
      <label>
        {locale === "ar" ? "نوع العميل التجاري" : "Commercial customer type"}
        <select
          value={businessTypeCode}
          onChange={(event) => {
            setBusinessTypeCode(event.target.value as "FORMWORK" | "OTHER");
          }}
        >
          <option value="FORMWORK">
            {locale === "ar" ? "عميل فورم ورك" : "Formwork customer"}
          </option>
          <option value="OTHER">
            {locale === "ar" ? "عميل آخر" : "Other customer"}
          </option>
        </select>
      </label>
      <ErrorBanner
        error={error}
        retry={() => {
          mutation.mutate();
        }}
      />
      <button className="primary" disabled={mutation.isPending}>
        {mutation.isPending
          ? locale === "ar"
            ? "جار الإنشاء…"
            : "Creating…"
          : locale === "ar"
            ? "إنشاء"
            : "Create"}
      </button>
    </form>
  );
}

function CustomerDetail({
  client,
  me,
  account,
  countries,
  onChanged,
}: {
  client: ApiClient;
  me: Me;
  account: Awaited<ReturnType<typeof getAccount>>["data"];
  countries: readonly { countryCode: string; displayName: string }[];
  onChanged: () => Promise<void>;
}) {
  const { locale } = useI18n();
  const granted = new Set(me.access.permissions);
  const effectiveCountryCode =
    account.hqCountry?.countryCode ??
    account.geography.country?.countryCode ??
    "";
  const [name, setName] = useState(account.canonicalName);
  const [hqCountryCode, setHqCountryCode] = useState(effectiveCountryCode);
  const [categoryCode, setCategoryCode] = useState(
    account.accountCategoryCode ?? "",
  );
  const [businessTypeCode, setBusinessTypeCode] = useState<
    "FORMWORK" | "OTHER"
  >(account.businessTypeCode);
  // What the buyer block of a proforma invoice needs and nothing held: the
  // postal address customs reads and the tax number it clears against.
  const [address, setAddress] = useState(account.address ?? "");
  const [taxNumber, setTaxNumber] = useState(account.taxNumber ?? "");
  const [editOpen, setEditOpen] = useState(false);
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [archiveReason, setArchiveReason] = useState("");
  const [message, setMessage] = useState<string>();
  const dirty =
    name !== account.canonicalName ||
    hqCountryCode !== effectiveCountryCode ||
    categoryCode !== (account.accountCategoryCode ?? "") ||
    businessTypeCode !== account.businessTypeCode ||
    address !== (account.address ?? "") ||
    taxNumber !== (account.taxNumber ?? "");
  useEffect(() => {
    setName(account.canonicalName);
    setHqCountryCode(effectiveCountryCode);
    setCategoryCode(account.accountCategoryCode ?? "");
    setBusinessTypeCode(account.businessTypeCode);
    setAddress(account.address ?? "");
    setTaxNumber(account.taxNumber ?? "");
    setMessage(undefined);
  }, [
    account.accountId,
    account.rowVersion,
    account.canonicalName,
    account.hqCountry,
    account.geography.country,
    account.accountCategoryCode,
    account.businessTypeCode,
    account.address,
    account.taxNumber,
    effectiveCountryCode,
  ]);
  useDirtyProtection(dirty);

  const update = useMutation({
    mutationFn: () =>
      updateAccount(client, account.accountId, account.rowVersion, {
        canonicalName: name,
        hqCountryCode: hqCountryCode || null,
        accountCategoryCode: categoryCode || null,
        businessTypeCode,
        // An emptied box clears the column; the server trims, so a stray
        // space never prints as a filled-looking blank line on a document.
        address: address.trim() || null,
        taxNumber: taxNumber.trim() || null,
      }),
    onSuccess: () => {
      void onChanged();
    },
    onError: (failure) => {
      setMessage(errorText(failure));
    },
  });
  const archive = useMutation({
    mutationFn: () =>
      archiveAccount(
        client,
        account.accountId,
        account.rowVersion,
        archiveReason,
      ),
    onSuccess: () => {
      void onChanged();
    },
    onError: (failure) => {
      setMessage(errorText(failure));
    },
  });

  return (
    <article className="customer-overview">
      <div className="detail-title">
        <div>
          <span className="eyebrow" data-abp-caption>
            {locale === "ar" ? "سجل العميل الرئيسي" : "Customer master"}
          </span>
          <h2>{locale === "ar" ? "نظرة عامة" : "Overview"}</h2>
        </div>
      </div>
      <dl>
        <div>
          <dt>{locale === "ar" ? "الدولة" : "Country"}</dt>
          <dd>
            {account.geography.country?.displayName ??
              (locale === "ar" ? "غير مصنف" : "Unclassified")}
          </dd>
        </div>
        <div>
          <dt>{locale === "ar" ? "القارة" : "Continent"}</dt>
          <dd>
            {account.geography.continent
              ? enumLabel(account.geography.continent, locale)
              : locale === "ar"
                ? "غير مصنف"
                : "Unclassified"}
          </dd>
        </div>
        <div>
          <dt>{locale === "ar" ? "السوق" : "Market"}</dt>
          <dd>{enumLabel(account.geography.marketScope, locale)}</dd>
        </div>
        <div>
          <dt>{locale === "ar" ? "نوع العميل" : "Customer type"}</dt>
          <dd>{businessTypeLabel(account.businessTypeCode, locale)}</dd>
        </div>
        {/* Shown even when empty. These two are printed on every proforma
            invoice this customer is sent, so a blank one is information --
            hiding the row until it has content is how nobody finds out the
            document went out with an empty buyer block. */}
        <div>
          <dt>{locale === "ar" ? "العنوان" : "Address"}</dt>
          <dd>
            <bdi dir="auto">
              {account.address ??
                (locale === "ar" ? "لم يُسجَّل" : "Not recorded")}
            </bdi>
          </dd>
        </div>
        <div>
          <dt>{locale === "ar" ? "الرقم الضريبي" : "Tax number"}</dt>
          <dd dir="ltr">
            {account.taxNumber ??
              (locale === "ar" ? "لم يُسجَّل" : "Not recorded")}
          </dd>
        </div>
        <div>
          <dt>{locale === "ar" ? "نسخة السجل" : "Row version"}</dt>
          <dd>{account.rowVersion}</dd>
        </div>
      </dl>
      {/* Shown even when empty, and now with a way in. Hiding the box when a
          customer was in no group meant nobody could discover that grouping
          existed, let alone set one -- while both endpoints for it had been
          live the whole time. */}
      <div className="group-box">
        <strong>
          {locale === "ar"
            ? "عضوية المجموعة السارية"
            : "Effective group membership"}
        </strong>
        {account.effectiveGroupMemberships.length === 0 ? (
          <span>
            {locale === "ar" ? "مش في أي مجموعة" : "Not in any group"}
          </span>
        ) : (
          account.effectiveGroupMemberships.map((group) => (
            <span key={group.membershipId}>
              {group.groupName} · {group.groupCode}
            </span>
          ))
        )}
        {granted.has(permissions.groupsManage) && (
          <button
            type="button"
            className="ghost-button"
            onClick={() => {
              setGroupsOpen(true);
            }}
          >
            {locale === "ar" ? "إدارة المجموعات" : "Manage groups"}
          </button>
        )}
      </div>
      {groupsOpen && (
        <GroupMembershipPanel
          client={client}
          me={me}
          accountId={account.accountId}
          accountName={account.canonicalName}
          memberships={account.effectiveGroupMemberships}
          onChanged={() => {
            void onChanged();
          }}
          onClose={() => {
            setGroupsOpen(false);
          }}
        />
      )}

      {granted.has(permissions.accountsEdit) && (
        <button
          className="primary"
          onClick={() => {
            setEditOpen(true);
          }}
        >
          {locale === "ar" ? "تعديل العميل" : "Edit customer"}
        </button>
      )}
      {editOpen && (
        <SlideOver
          title={locale === "ar" ? "تعديل العميل" : "Edit customer"}
          onClose={() => {
            setEditOpen(false);
          }}
        >
          <section className="customer-360-section">
            {granted.has(permissions.accountsEdit) &&
              account.recordStatusCode === "ACTIVE" && (
                <form
                  className="edit-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!update.isPending) update.mutate();
                  }}
                >
                  <h3>
                    {locale === "ar"
                      ? "تعديل الحقول المصرح بها"
                      : "Edit authorized fields"}
                  </h3>
                  <label>
                    {locale === "ar" ? "الاسم" : "Name"}
                    <input
                      value={name}
                      maxLength={300}
                      onChange={(e) => {
                        setName(e.target.value);
                      }}
                    />
                  </label>
                  {/* Both print on the buyer block of a proforma invoice,
                      so the hint says where they end up rather than what
                      they are -- that is the part that is not obvious. */}
                  <label>
                    {locale === "ar" ? "العنوان" : "Address"}
                    <textarea
                      value={address}
                      rows={2}
                      maxLength={500}
                      placeholder={
                        locale === "ar"
                          ? "العنوان كما يُطبع على الفاتورة المبدئية"
                          : "As printed on the proforma invoice"
                      }
                      onChange={(e) => {
                        setAddress(e.target.value);
                      }}
                    />
                  </label>
                  <label>
                    {locale === "ar" ? "الرقم الضريبي" : "Tax number"}
                    <input
                      value={taxNumber}
                      dir="ltr"
                      maxLength={60}
                      placeholder={
                        locale === "ar"
                          ? "رقم التسجيل الضريبي للعميل"
                          : "The customer's tax registration number"
                      }
                      onChange={(e) => {
                        setTaxNumber(e.target.value);
                      }}
                    />
                  </label>
                  <label>
                    {locale === "ar" ? "دولة المقر" : "HQ country"}
                    <select
                      value={hqCountryCode}
                      onChange={(e) => {
                        setHqCountryCode(e.target.value);
                      }}
                    >
                      <option value="">
                        {locale === "ar" ? "غير محدد" : "Not set"}
                      </option>
                      {countries.map((country) => (
                        <option
                          key={country.countryCode}
                          value={country.countryCode}
                        >
                          {country.displayName}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {locale === "ar"
                      ? "تصنيف العميل"
                      : "Customer classification"}
                    <select
                      value={categoryCode}
                      onChange={(e) => {
                        setCategoryCode(e.target.value);
                      }}
                    >
                      {ACCOUNT_CATEGORY_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {locale === "ar" ? option.ar : option.en}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {locale === "ar"
                      ? "نوع العميل التجاري"
                      : "Commercial customer type"}
                    <select
                      value={businessTypeCode}
                      onChange={(e) => {
                        setBusinessTypeCode(
                          e.target.value as "FORMWORK" | "OTHER",
                        );
                      }}
                    >
                      <option value="FORMWORK">
                        {locale === "ar"
                          ? "عميل فورم ورك"
                          : "Formwork customer"}
                      </option>
                      <option value="OTHER">
                        {locale === "ar" ? "عميل آخر" : "Other customer"}
                      </option>
                    </select>
                  </label>
                  <button disabled={!dirty || update.isPending}>
                    {update.isPending
                      ? locale === "ar"
                        ? "جار الحفظ…"
                        : "Saving…"
                      : locale === "ar"
                        ? "حفظ التغييرات"
                        : "Save changes"}
                  </button>
                </form>
              )}

            {granted.has(permissions.accountsArchive) &&
              account.recordStatusCode === "ACTIVE" && (
                <form
                  className="archive-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!archive.isPending) archive.mutate();
                  }}
                >
                  <label>
                    Archive reason
                    <input
                      minLength={3}
                      required
                      value={archiveReason}
                      onChange={(e) => {
                        setArchiveReason(e.target.value);
                      }}
                    />
                  </label>
                  <button className="danger" disabled={archive.isPending}>
                    {archive.isPending ? "Archiving…" : "Archive customer"}
                  </button>
                </form>
              )}
            {message && <Status text={message} tone="error" />}
          </section>
        </SlideOver>
      )}
    </article>
  );
}

function ProjectSection({
  client,
  accountId,
}: {
  client: ApiClient;
  accountId: string;
}) {
  const { locale } = useI18n();
  const [page, setPage] = useState(1);
  const projects = useQuery({
    queryKey: ["account-projects", accountId, page],
    queryFn: () =>
      listProjects(client, {
        accountId,
        archiveState: "ACTIVE",
        page,
        limit: 25,
        sort: "updatedAt:desc",
      }),
  });
  return (
    <section className="contacts-section">
      <h3>{locale === "ar" ? "المشروعات" : "Projects"}</h3>
      <ErrorBanner
        error={projects.error}
        retry={() => void projects.refetch()}
      />
      {projects.isLoading && (
        <LoadingSkeleton
          label={locale === "ar" ? "جار تحميل المشروعات" : "Loading projects"}
        />
      )}
      <div className="contact-list">
        {projects.data?.data.map((project) => (
          <Link
            className="contact-row"
            key={project.projectId}
            to={`/projects/${project.projectId}`}
          >
            <strong>{project.name}</strong>
            <span>
              {project.projectRef} · {project.geography.country.displayName}
            </span>
          </Link>
        ))}
      </div>
      {!projects.isLoading &&
        !projects.error &&
        projects.data?.data.length === 0 && (
          <p>
            {locale === "ar" ? "لا توجد مشروعات مرتبطة" : "No linked projects."}
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
          disabled={(projects.data?.data.length ?? 0) < 25}
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

function ContactSection({
  client,
  me,
  accountId,
  ownerUserId,
}: {
  client: ApiClient;
  me: Me;
  accountId: string;
  ownerUserId: string;
}) {
  const queryClient = useQueryClient();
  const { locale } = useI18n();
  const [page, setPage] = useState(1);
  const granted = useMemo(() => new Set(me.access.permissions), [me]);
  const [selectedId, setSelectedId] = useState<string>();
  const [showCreate, setShowCreate] = useState(false);
  const contacts = useQuery({
    queryKey: ["contacts", accountId, page],
    queryFn: () =>
      listContacts(client, accountId, {
        page,
        limit: 25,
        sort: "displayName:asc",
      }),
  });
  const detail = useQuery({
    queryKey: ["contact", selectedId],
    queryFn: () => {
      if (selectedId === undefined)
        return Promise.reject(new Error("CONTACT_ID_REQUIRED"));
      return getContact(client, selectedId);
    },
    enabled: selectedId !== undefined,
  });
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["contacts", accountId] });
    if (selectedId !== undefined) {
      await queryClient.invalidateQueries({
        queryKey: ["contact", selectedId],
      });
    }
  };

  return (
    <section className="contacts-section" aria-labelledby="contacts-heading">
      <div className="section-heading">
        <div>
          <h3 id="contacts-heading">
            {locale === "ar" ? "جهات الاتصال" : "Contacts"}
          </h3>
        </div>
        {granted.has(permissions.contactsCreate) && (
          <button
            type="button"
            onClick={() => {
              setShowCreate((value) => !value);
            }}
          >
            {showCreate ? "Cancel" : "Add contact"}
          </button>
        )}
      </div>
      {showCreate && (
        <SlideOver
          title="Add contact / جهة اتصال جديدة"
          onClose={() => {
            setShowCreate(false);
          }}
        >
          <CreateContactForm
            client={client}
            accountId={accountId}
            onCreated={async (contactId) => {
              setShowCreate(false);
              setSelectedId(contactId);
              await refresh();
            }}
          />
        </SlideOver>
      )}
      {contacts.isLoading && (
        <LoadingSkeleton
          label={
            locale === "ar" ? "جار تحميل جهات الاتصال" : "Loading contacts"
          }
        />
      )}
      {contacts.error && (
        <ErrorBanner
          error={contacts.error}
          retry={() => void contacts.refetch()}
        />
      )}
      {contacts.data?.data.length === 0 && (
        <Status text="No contacts in this authorized projection." />
      )}
      <div className="contact-grid">
        <div className="contact-list">
          {contacts.data?.data.map((contact) => (
            <Link
              key={contact.contactId}
              className="contact-row"
              to={`/contacts/${contact.contactId}`}
            >
              <strong>{contact.displayName}</strong>
              <span>{contact.jobTitle ?? "No title"}</span>
              <small>{contact.statusCode}</small>
            </Link>
          ))}
        </div>
        <div className="contact-detail">
          {selectedId === undefined && (
            <Status text="Select a contact to view permitted details." />
          )}
          {detail.isLoading && (
            <LoadingSkeleton
              label={
                locale === "ar" ? "جار تحميل جهة الاتصال" : "Loading contact"
              }
              rows={2}
            />
          )}
          {detail.error && (
            <Status text="This contact is not available." tone="error" />
          )}
          {detail.data && (
            <ContactEditor
              client={client}
              me={me}
              contact={detail.data.data}
              canShare={ownerUserId === me.user.userId}
              onChanged={refresh}
            />
          )}
        </div>
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
          disabled={(contacts.data?.data.length ?? 0) < 25}
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

export function CreateContactForm({
  client,
  accountId,
  onCreated,
}: {
  client: ApiClient;
  accountId: string;
  onCreated: (contactId: string) => Promise<void>;
}) {
  const [displayName, setDisplayName] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string>();
  const mutation = useMutation({
    mutationFn: () =>
      createContact(client, accountId, {
        displayName,
        jobTitle: jobTitle || null,
        channels:
          email === ""
            ? []
            : [{ channelTypeCode: "EMAIL", value: email, isPrimary: true }],
      }),
    onSuccess: ({ data }) => {
      void onCreated(data.contactId);
    },
    onError: (failure) => {
      setMessage(contactErrorText(failure));
    },
  });
  return (
    <form
      className="contact-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!mutation.isPending) mutation.mutate();
      }}
    >
      <label>
        Contact name
        <input
          required
          value={displayName}
          onChange={(event) => {
            setDisplayName(event.target.value);
          }}
        />
      </label>
      <label>
        Job title
        <input
          value={jobTitle}
          onChange={(event) => {
            setJobTitle(event.target.value);
          }}
        />
      </label>
      <label>
        Primary email
        <input
          type="email"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
          }}
        />
      </label>
      <button disabled={mutation.isPending}>
        {mutation.isPending ? "Creating…" : "Create contact"}
      </button>
      {message && <Status text={message} tone="error" />}
    </form>
  );
}

function ContactEditor({
  client,
  me,
  contact,
  canShare,
  onChanged,
}: {
  client: ApiClient;
  me: Me;
  contact: Awaited<ReturnType<typeof getContact>>["data"];
  canShare: boolean;
  onChanged: () => Promise<void>;
}) {
  const granted = new Set(me.access.permissions);
  const { locale } = useI18n();
  const txt = (en: string, ar: string) => (locale === "ar" ? ar : en);
  const [displayName, setDisplayName] = useState(contact.displayName);
  const [jobTitle, setJobTitle] = useState(contact.jobTitle ?? "");
  const channelTypeCode = "EMAIL";
  const [channelValue, setChannelValue] = useState("");
  const [recipientUserId, setRecipientUserId] = useState("");
  const [message, setMessage] = useState<string>();
  const [createdShare, setCreatedShare] = useState<{
    contactShareId: string;
    rowVersion: string;
  }>();
  const colleagues = useQuery({
    queryKey: ["people-directory"],
    queryFn: () =>
      commercialRequest(client, "GET", "/messages/directory", {
        path: {},
        query: { page: 1, limit: 100 },
      }),
    enabled: canShare,
  });
  const directory =
    isObject(colleagues.data?.data) && Array.isArray(colleagues.data.data.data)
      ? colleagues.data.data.data.filter(isObject)
      : [];
  useEffect(() => {
    setDisplayName(contact.displayName);
    setJobTitle(contact.jobTitle ?? "");
    setMessage(undefined);
  }, [
    contact.contactId,
    contact.displayName,
    contact.jobTitle,
    contact.rowVersion,
  ]);

  const update = useMutation({
    mutationFn: () =>
      updateContact(client, contact.contactId, contact.rowVersion, {
        displayName,
        jobTitle: jobTitle || null,
      }),
    onSuccess: () => void onChanged(),
    onError: (failure) => {
      setMessage(contactErrorText(failure));
    },
  });
  const addChannel = useMutation({
    mutationFn: () =>
      addContactChannel(client, contact.contactId, {
        channelTypeCode,
        value: channelValue,
        isPrimary: false,
      }),
    onSuccess: () => {
      setChannelValue("");
      void onChanged();
    },
    onError: (failure) => {
      setMessage(contactErrorText(failure));
    },
  });
  const share = useMutation({
    mutationFn: () =>
      shareContacts(client, contact.accountId, {
        recipientUserId,
        contactIds: [contact.contactId],
        accessLevelCode: "VIEW",
        expiresAt: null,
      }),
    onSuccess: ({ data }) => {
      setCreatedShare({
        contactShareId: data.contactShareId,
        rowVersion: data.rowVersion,
      });
      setMessage("Contact-only share created. Customer 360 remains private.");
    },
    onError: (failure) => {
      setMessage(contactErrorText(failure));
    },
  });
  const revoke = useMutation({
    mutationFn: () => {
      if (createdShare === undefined) throw new Error("SHARE_REQUIRED");
      return revokeContactShare(
        client,
        createdShare.contactShareId,
        createdShare.rowVersion,
      );
    },
    onSuccess: () => {
      setCreatedShare(undefined);
      setMessage("Contact-only share revoked immediately.");
    },
    onError: (failure) => {
      setMessage(contactErrorText(failure));
    },
  });

  return (
    <article>
      <span className="eyebrow" data-abp-caption>
        {contact.account.accountRef}
      </span>
      <h4>{contact.displayName}</h4>
      <p>{contact.account.canonicalName}</p>
      <ul className="channel-list">
        {contact.channels.map((channel) => (
          <li key={channel.contactChannelId}>
            <span>
              {channel.channelTypeCode}: {channel.value}
            </span>
            {granted.has(permissions.contactsEdit) && (
              <button
                type="button"
                onClick={() => {
                  void removeContactChannel(
                    client,
                    channel.contactChannelId,
                    contact.rowVersion,
                  )
                    .then(onChanged)
                    .catch((failure: unknown) => {
                      setMessage(contactErrorText(failure));
                    });
                }}
              >
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
      {granted.has(permissions.contactsEdit) && (
        <>
          <form
            className="contact-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!update.isPending) update.mutate();
            }}
          >
            <label>
              Name
              <input
                value={displayName}
                onChange={(event) => {
                  setDisplayName(event.target.value);
                }}
              />
            </label>
            <label>
              Job title
              <input
                value={jobTitle}
                onChange={(event) => {
                  setJobTitle(event.target.value);
                }}
              />
            </label>
            <button disabled={update.isPending}>
              {update.isPending
                ? txt("Saving…", "بيحفظ…")
                : txt("Save contact", "احفظ جهة الاتصال")}
            </button>
          </form>
          <form
            className="contact-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!addChannel.isPending) addChannel.mutate();
            }}
          >
            <label>
              {txt("Email address", "عنوان الإيميل")}
              <input
                type="email"
                required
                value={channelValue}
                onChange={(event) => {
                  setChannelValue(event.target.value);
                }}
              />
            </label>
            <button disabled={addChannel.isPending}>
              {txt("Add email", "ضيف الإيميل")}
            </button>
          </form>
        </>
      )}
      {canShare && granted.has(permissions.contactsShare) && (
        <form
          className="contact-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!share.isPending) share.mutate();
          }}
        >
          {/* A colleague by name, not a user UUID. Nobody knows their
              colleagues' UUIDs, so the field could only be filled by copying
              one out of another screen — which meant the feature existed and
              could not be used. */}
          <label>
            {txt("Share with", "شارك مع")}
            <select
              required
              value={recipientUserId}
              onChange={(event) => {
                setRecipientUserId(event.target.value);
              }}
            >
              <option value="">
                {colleagues.isLoading
                  ? txt("Loading…", "بيحمّل…")
                  : txt("Choose a colleague", "اختار زميل")}
              </option>
              {directory
                .filter((entry) => str(entry.userId) !== me.user.userId)
                .map((entry) => (
                  <option key={str(entry.userId)} value={str(entry.userId)}>
                    {str(entry.displayName)}
                  </option>
                ))}
            </select>
          </label>
          <button disabled={share.isPending || recipientUserId === ""}>
            {txt("Share this contact only", "شارك جهة الاتصال دي بس")}
          </button>
          {createdShare && (
            <button
              type="button"
              className="danger"
              disabled={revoke.isPending}
              onClick={() => {
                revoke.mutate();
              }}
            >
              Revoke latest share
            </button>
          )}
        </form>
      )}
      {message && (
        <Status
          text={message}
          tone={message.includes("failed") ? "error" : "neutral"}
        />
      )}
    </article>
  );
}

function contactErrorText(error: unknown): string {
  if (error instanceof CustomerApiError) {
    if (error.status === 412)
      return "This contact changed elsewhere. Reload before saving again.";
    const field = error.envelope?.error.fieldErrors[0];
    return field
      ? `${field.field}: ${field.code}`
      : (error.envelope?.error.messageKey ?? "Contact request failed.");
  }
  return "Contact request failed.";
}

function useDirtyProtection(dirty: boolean) {
  useEffect(() => {
    const prevent = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
    };
    window.addEventListener("beforeunload", prevent);
    return () => {
      window.removeEventListener("beforeunload", prevent);
    };
  }, [dirty]);
}

function errorText(error: unknown): string {
  if (error instanceof CustomerApiError) {
    if (error.status === 412)
      return "This customer changed elsewhere. Reload Customer 360 before saving again.";
    const field = error.envelope?.error.fieldErrors[0];
    return field
      ? `${field.field}: ${field.code}`
      : (error.envelope?.error.messageKey ?? "Request failed.");
  }
  return "Request failed.";
}

function Status({
  text,
  tone = "neutral",
}: {
  text: string;
  tone?: "neutral" | "error";
}) {
  return (
    <div
      className={`status ${tone}`}
      role={tone === "error" ? "alert" : "status"}
    >
      {text}
    </div>
  );
}

function LoadingSkeleton({
  label,
  rows = 3,
}: {
  label: string;
  rows?: number;
}) {
  return (
    <div className="skeleton-stack" aria-label={label} role="status">
      {Array.from({ length: rows }, (_, index) => (
        <span key={index} />
      ))}
    </div>
  );
}

/**
 * Purchase history: what this customer has actually bought, from the imported
 * ERP sales orders. Separate from the Opportunities and Quotations tabs, which
 * show what they might buy — a salesperson opening a customer wants both, and
 * mixing them is how a forecast turns into a claim about revenue.
 */
function PurchaseHistorySection({
  client,
  accountId,
}: {
  client: ApiClient;
  accountId: string;
}) {
  const { locale } = useI18n();
  const ar = locale === "ar";
  const history = useQuery<AccountCommercialHistory>({
    queryKey: ["account", accountId, "commercial-history"],
    queryFn: async () => {
      const result = await client.GET(
        "/accounts/{accountId}/commercial-history",
        { params: { path: { accountId } } },
      );
      if (!result.data)
        throw new Error(`HISTORY_${String(result.response.status)}`);
      return result.data.data as unknown as AccountCommercialHistory;
    },
  });

  if (history.isLoading) {
    return <p className="table-empty">{ar ? "جارٍ التحميل…" : "Loading…"}</p>;
  }
  if (history.isError || !history.data) {
    return (
      <ErrorBanner
        error={history.error}
        retry={() => {
          void history.refetch();
        }}
      />
    );
  }

  const data = history.data;
  // Every amount and quantity is optional in the contract, so format defensively
  // rather than letting a missing figure render as "NaN EGP".
  const money = (value: string | undefined) =>
    value === undefined
      ? "—"
      : `${Number(value).toLocaleString(ar ? "ar-EG" : "en", {
          maximumFractionDigits: 0,
        })} EGP`;
  const qty = (value: string | undefined) =>
    value === undefined
      ? "—"
      : Number(value).toLocaleString(ar ? "ar-EG" : "en", {
          maximumFractionDigits: 0,
        });

  return (
    <div className="purchase-history">
      <div className="purchase-history-stats">
        <div>
          <span>{ar ? "إجمالي المشتريات" : "Total purchased"}</span>
          <strong>{money(data.totalValue)}</strong>
        </div>
        <div>
          <span>{ar ? "عدد الأوامر" : "Orders"}</span>
          <strong>{data.orderCount}</strong>
        </div>
        <div>
          <span>{ar ? "عدد البنود" : "Order items"}</span>
          <strong>{data.itemCount}</strong>
        </div>
        <div>
          <span>{ar ? "أول شراء" : "First order"}</span>
          <strong>{data.firstOrderDate || "—"}</strong>
        </div>
        <div>
          <span>{ar ? "آخر شراء" : "Last order"}</span>
          <strong>{data.lastOrderDate || "—"}</strong>
        </div>
        {data.relationshipTypeCode === "GROUP_AFFILIATE" && (
          <div className="purchase-history-group">
            <span>{ar ? "نوع العلاقة" : "Relationship"}</span>
            <strong>
              {ar ? "شركة تابعة لمجموعة أكرو" : "ACROW group company"}
            </strong>
          </div>
        )}
      </div>

      <CustomerPriceHistory rows={data.priceHistory} />

      {data.orderCount === 0 && (
        <p className="table-empty">
          {ar
            ? "لا توجد أوامر بيع سابقة لهذا العميل."
            : "This customer has no historical sales orders."}
        </p>
      )}

      {data.markets.length > 1 && (
        <section className="purchase-history-block">
          <h4>{ar ? "الأسواق" : "Markets"}</h4>
          <ul className="purchase-history-list">
            {data.markets.map((market) => (
              <li key={market.countryCode}>
                <span>{market.countryName}</span>
                <strong>{money(market.value)}</strong>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="purchase-history-block">
        <h4>{ar ? "المنتجات المشتراة" : "Products purchased"}</h4>
        <div className="enterprise-table-scroll">
          <table className="enterprise-table">
            <thead>
              <tr>
                <th>{ar ? "المنتج" : "Product"}</th>
                <th>{ar ? "الكمية" : "Quantity"}</th>
                <th>{ar ? "القيمة" : "Value"}</th>
                <th>{ar ? "آخر شراء" : "Last bought"}</th>
              </tr>
            </thead>
            <tbody>
              {data.products.map((product) => (
                <tr key={product.productId}>
                  <td>{product.description}</td>
                  <td>{qty(product.quantity)}</td>
                  <td>{money(product.value)}</td>
                  <td>{product.lastOrderDate || "—"}</td>
                </tr>
              ))}
              {data.products.length === 0 && (
                <tr>
                  <td colSpan={4} className="table-empty">
                    {ar
                      ? "لا توجد منتجات مطابقة — البنود غير مطابقة لدليل الأصناف."
                      : "No matched products — the ordered items are not in the item master yet."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="purchase-history-block">
        <h4>{ar ? "الأوامر السابقة" : "Historical orders"}</h4>
        <div className="enterprise-table-scroll">
          <table className="enterprise-table">
            <thead>
              <tr>
                <th>{ar ? "رقم الأمر" : "Order"}</th>
                <th>{ar ? "التاريخ" : "Date"}</th>
                <th>{ar ? "الحالة" : "Status"}</th>
                <th>{ar ? "البنود" : "Items"}</th>
                <th>{ar ? "القيمة" : "Value"}</th>
                <th>{ar ? "أمر شراء العميل" : "Customer PO"}</th>
              </tr>
            </thead>
            <tbody>
              {data.orders.map((order) => (
                <tr key={order.orderId}>
                  <td>{order.orderNumber}</td>
                  <td>{order.orderDate || "—"}</td>
                  <td>
                    <StatusChip code={order.statusCode} />
                  </td>
                  <td>{order.lineCount}</td>
                  <td>{money(order.value)}</td>
                  <td>{order.customerPoNumber || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
