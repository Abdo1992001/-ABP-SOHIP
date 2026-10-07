import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import type { ApiClient, components } from "@abp/api-client";
import { useI18n } from "../i18n/i18n.tsx";
import { enumLabel } from "../i18n/enum-labels.ts";
import { ErrorBanner, PageHeader, StatusChip } from "./CommercialUI.tsx";
import { DocumentDownload } from "./DocumentDownload.tsx";
import { DocumentLinksPanel } from "./DocumentLinksPanel.tsx";
import type { Me } from "../api/customer-api.ts";

type Document = components["schemas"]["DocumentListItem"];

/**
 * Documents attached to commercial records.
 *
 * The one thing this screen has to do that a table cannot is hand the file over,
 * so every row carries its own download control rather than a link that opens a
 * detail page just to find another button.
 */
export function DocumentsPage({ client, me }: { client: ApiClient; me: Me }) {
  const { locale } = useI18n();
  const ar = locale === "ar";
  const labels = ar ? arLabels : enLabels;
  const [search, setSearch] = useState("");
  const [resourceTypeCode, setResourceTypeCode] = useState("");
  const [page, setPage] = useState(1);
  const [linksFor, setLinksFor] = useState<{
    documentId: string;
    name: string;
  } | null>(null);
  const limit = 25;

  const documents = useQuery({
    queryKey: ["documents", { search, resourceTypeCode, page }],
    queryFn: async () => {
      const result = await client.GET("/documents", {
        params: {
          query: {
            offset: (page - 1) * limit,
            limit,
            ...(search.trim().length >= 2 ? { search: search.trim() } : {}),
            ...(resourceTypeCode ? { resourceTypeCode } : {}),
          },
        },
      });
      if (!result.data)
        throw new Error(`DOCUMENTS_${String(result.response.status)}`);
      return result.data as unknown as {
        data: Document[];
        meta: { total: number; hasNext: boolean };
      };
    },
  });

  const rows = documents.data?.data ?? [];

  return (
    <section className="documents-page">
      <PageHeader
        kicker={labels.kicker}
        title={labels.title}
        count={documents.data?.meta.total ?? 0}
        sub={labels.subtitle}
      />

      <div className="record-filters">
        <input
          type="search"
          value={search}
          placeholder={labels.searchPlaceholder}
          aria-label={labels.searchPlaceholder}
          onChange={(event) => {
            setPage(1);
            setSearch(event.target.value);
          }}
        />
        <select
          value={resourceTypeCode}
          aria-label={labels.attachedTo}
          onChange={(event) => {
            setPage(1);
            setResourceTypeCode(event.target.value);
          }}
        >
          <option value="">{labels.anything}</option>
          <option value="ACCOUNT">{labels.customers}</option>
          <option value="QUOTATION">{labels.quotations}</option>
          <option value="PROJECT">{labels.projects}</option>
          <option value="COMPLAINT">{labels.complaints}</option>
        </select>
      </div>

      <ErrorBanner
        error={documents.error}
        retry={() => {
          void documents.refetch();
        }}
      />

      <div className="enterprise-table-scroll">
        <table className="enterprise-table">
          <thead>
            <tr>
              <th>{labels.document}</th>
              <th>{labels.type}</th>
              <th>{labels.attachedTo}</th>
              <th>{labels.status}</th>
              <th>{labels.version}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((document) => (
              <tr key={document.documentId}>
                <td>
                  <span className="doc-title">
                    {document.displayName ??
                      enumLabel(document.documentTypeCode, locale)}
                  </span>
                  <small className="doc-file">
                    v{document.version}
                    {document.official ? ` · ${labels.official}` : ""}
                  </small>
                </td>
                {/* These are stored codes. Printed as they are, an Arabic
                    table carried DOCUMENTTYPE and OPPORTUNITY in English
                    SCREAMING_CASE -- which the redesign brief rules out by
                    name. */}
                <td>{enumLabel(document.documentTypeCode, locale)}</td>
                <td>
                  {linkFor(document) !== null ? (
                    <Link to={linkFor(document) ?? "/"}>
                      {enumLabel(document.resourceTypeCode, locale)}
                    </Link>
                  ) : (
                    enumLabel(document.resourceTypeCode, locale)
                  )}
                </td>
                <td>
                  <StatusChip code={document.statusCode} />
                </td>
                <td className="numeric">{document.version}</td>
                <td className="doc-row-actions">
                  <DocumentDownload
                    client={client}
                    documentId={document.documentId}
                  />
                  {/* Where else this document is filed. Links could be
                      created and never seen, because no read returned them. */}
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => {
                      setLinksFor({
                        documentId: document.documentId,
                        name: document.displayName ?? document.documentTypeCode,
                      });
                    }}
                  >
                    {labels.links}
                  </button>
                </td>
              </tr>
            ))}
            {!documents.isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="table-empty">
                  {labels.noDocuments}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <footer className="pagination">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => {
            setPage(page - 1);
          }}
        >
          {labels.previous}
        </button>
        <span>{page}</span>
        <button
          type="button"
          disabled={documents.data?.meta.hasNext !== true}
          onClick={() => {
            setPage(page + 1);
          }}
        >
          {labels.next}
        </button>
      </footer>
      {linksFor !== null && (
        <DocumentLinksPanel
          client={client}
          me={me}
          documentId={linksFor.documentId}
          documentName={linksFor.name}
          onClose={() => {
            setLinksFor(null);
          }}
        />
      )}
    </section>
  );
}

/** A document is only useful if you can get back to what it is attached to. */
function linkFor(document: Document): string | null {
  const id = document.resourceId;
  if (typeof id !== "string" || id === "") return null;
  switch (document.resourceTypeCode) {
    case "ACCOUNT":
      return `/customers/${id}`;
    case "QUOTATION":
      return `/quotations/${id}`;
    case "PROJECT":
      return `/projects/${id}`;
    case "COMPLAINT":
      return `/complaints/${id}`;
    default:
      return null;
  }
}

const enLabels = {
  kicker: "Files",
  title: "Documents",
  subtitle: "Files attached to customers, quotations, projects and complaints.",
  searchPlaceholder: "Title or file name",
  attachedTo: "Attached to",
  anything: "Anything",
  customers: "Customers",
  quotations: "Quotations",
  projects: "Projects",
  complaints: "Complaints",
  document: "Document",
  links: "Links",
  type: "Type",
  status: "Status",
  version: "Version",
  official: "official",
  noDocuments: "No documents.",
  previous: "Previous",
  next: "Next",
};

const arLabels: typeof enLabels = {
  kicker: "الملفات",
  title: "المستندات",
  subtitle: "ملفات مرفقة بالعملاء وعروض الأسعار والمشروعات والشكاوى.",
  searchPlaceholder: "العنوان أو اسم الملف",
  attachedTo: "مرفق بـ",
  anything: "الكل",
  customers: "العملاء",
  quotations: "عروض الأسعار",
  projects: "المشروعات",
  complaints: "الشكاوى",
  document: "المستند",
  links: "الارتباطات",
  type: "النوع",
  status: "الحالة",
  version: "الإصدار",
  official: "رسمي",
  noDocuments: "لا توجد مستندات.",
  previous: "السابق",
  next: "التالي",
};
