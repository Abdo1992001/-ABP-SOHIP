import { ErrorBanner, ScreenIntro } from "./CommercialUI.tsx";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import type { ApiClient, components } from "@abp/api-client";
import { useI18n } from "../i18n/i18n.tsx";

type Directory = components["schemas"]["ContactDirectoryEnvelope"];

export function ContactDirectoryPage({ client }: { client: ApiClient }) {
  const { locale } = useI18n();
  const labels = locale === "ar" ? ar : en;
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  // Everyone this person may see, straight away; typing narrows it. It used
  // to wait for two letters before showing anything at all.
  const term = search.trim();
  const contacts = useQuery<Directory>({
    queryKey: ["contact-directory", term, page],
    placeholderData: (previous) => previous,
    queryFn: async () => {
      const result = await client.GET("/contacts", {
        params: {
          query: {
            ...(term.length >= 2 ? { search: term } : {}),
            page,
            limit: 25,
          },
        },
      });
      if (!result.data)
        throw new Error(`CONTACT_DIRECTORY_${String(result.response.status)}`);
      return result.data as Directory;
    },
    retry: false,
  });

  return (
    <section className="customer-page contact-directory-page">
      <header className="resource-header customer-grid-header">
        <div>
          <p className="resource-kicker">{labels.kicker}</p>
          <h1>{labels.title}</h1>
          <p>{labels.note}</p>
        </div>
        <div className="resource-header-actions">
          <span className="grid-count">
            <strong>{contacts.data?.meta.total ?? "—"}</strong>
            <small>{labels.authorizedResults}</small>
          </span>
          <Link className="button primary" to="/customers">
            {labels.openCustomers}
          </Link>
        </div>
      </header>
      <ScreenIntro />

      <section className="enterprise-grid-card" aria-label={labels.title}>
        <div className="saved-view-strip">
          <span className="active-view">{labels.allContacts}</span>
          <span>{labels.scopeRule}</span>
        </div>
        <div className="enterprise-grid-toolbar contact-toolbar">
          <label className="grid-search">
            <span className="sr-only">{labels.search}</span>
            <input
              aria-label={labels.search}
              placeholder={labels.placeholder}
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
            />
          </label>
          <button
            type="button"
            className="secondary"
            onClick={() => void contacts.refetch()}
          >
            {labels.refresh}
          </button>
        </div>

        {contacts.isLoading && (
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
        {contacts.isError && (
          <ErrorBanner
            error={contacts.error}
            retry={() => void contacts.refetch()}
          />
        )}
        {contacts.data && (
          <>
            <div className="enterprise-table-scroll">
              <table className="enterprise-table">
                <thead>
                  <tr>
                    <th>{labels.contact}</th>
                    <th>{labels.context}</th>
                    <th>{labels.reach}</th>
                    <th>{labels.status}</th>
                    <th>
                      <span className="sr-only">{labels.open}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {contacts.data.data.map((contact) => (
                    <tr key={contact.contactId}>
                      <td>
                        <Link
                          className="customer-cell"
                          to={`/contacts/${contact.contactId}`}
                        >
                          <span className="entity-avatar" aria-hidden="true">
                            {contact.displayName.slice(0, 1).toUpperCase()}
                          </span>
                          <span>
                            <strong>{contact.displayName}</strong>
                            {contact.jobTitle && (
                              <small className="contact-role">
                                {contact.jobTitle}
                              </small>
                            )}
                          </span>
                        </Link>
                      </td>
                      <td>
                        <Link to={`/customers/${contact.accountId}`}>
                          {contact.accountName}
                        </Link>
                      </td>
                      <td>
                        {contact.primaryChannel ? (
                          <a
                            className="contact-reach"
                            dir="ltr"
                            href={`mailto:${contact.primaryChannel.value}`}
                          >
                            {contact.primaryChannel.value}
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        <span className="status-chip active">
                          {contact.statusCode === "ACTIVE"
                            ? labels.available
                            : contact.statusCode}
                        </span>
                      </td>
                      <td>
                        <Link
                          className="row-open"
                          to={`/contacts/${contact.contactId}`}
                          aria-label={`${labels.open} ${contact.displayName}`}
                        >
                          →
                        </Link>
                      </td>
                    </tr>
                  ))}
                  {contacts.data.data.length === 0 && (
                    <tr>
                      <td colSpan={5} className="table-empty">
                        {labels.empty}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <footer className="grid-pagination">
              <span>
                {labels.page} {page}
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
                  {labels.previous}
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={!contacts.data.meta.hasNext}
                  onClick={() => {
                    setPage((current) => current + 1);
                  }}
                >
                  {labels.next}
                </button>
              </div>
            </footer>
          </>
        )}
      </section>
    </section>
  );
}

const en = {
  kicker: "Sales core · Contact directory",
  title: "Contacts",
  note: "Authorized people and relationship context. Contacts are not system users and inherit Customer access rules.",
  authorizedResults: "authorized results",
  openCustomers: "Open customers",
  allContacts: "All authorized contacts",
  scopeRule: "Customer scope inherited · restricted fields omitted",
  search: "Search contacts",
  placeholder: "Search name, role, customer or email",
  refresh: "Refresh",
  loading: "Loading authorized contacts…",
  reach: "Email",
  failed: "Contacts could not be loaded from the governed search projection.",
  contact: "Contact",
  context: "Customer",
  status: "Status",
  open: "Open",
  available: "Active",
  empty: "No contacts in this authorized view.",
  page: "Page",
  previous: "Previous",
  next: "Next",
};

const ar: typeof en = {
  kicker: "مركز المبيعات · دليل جهات الاتصال",
  title: "جهات الاتصال",
  note: "الأشخاص وسياق العلاقات المصرح به. جهات الاتصال ليست مستخدمي النظام وترث نطاق العميل.",
  authorizedResults: "نتائج مصرح بها",
  openCustomers: "فتح العملاء",
  allContacts: "كل جهات الاتصال المصرح بها",
  scopeRule: "نطاق العميل موروث · الحقول المقيدة محذوفة",
  search: "بحث في جهات الاتصال",
  placeholder: "ابحث بالاسم أو الوظيفة أو العميل أو الإيميل",
  refresh: "تحديث",
  loading: "جاري تحميل جهات الاتصال المصرح بها…",
  reach: "الإيميل",
  failed: "تعذر تحميل جهات الاتصال من عرض البحث المعتمد.",
  contact: "جهة الاتصال",
  context: "العميل",
  status: "الحالة",
  open: "فتح",
  available: "متاح",
  empty: "لا توجد جهات اتصال في هذا العرض المصرح.",
  page: "صفحة",
  previous: "السابق",
  next: "التالي",
};
