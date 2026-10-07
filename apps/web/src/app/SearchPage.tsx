import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";
import type { ApiClient, components } from "@abp/api-client";
import { useI18n } from "../i18n/i18n.tsx";
import { ErrorBanner, PageHeader } from "./CommercialUI.tsx";

type Hit = components["schemas"]["SearchResult"];

/**
 * Global search results.
 *
 * Results are grouped by what they are, not interleaved by relevance score.
 * Someone typing "2600157" is looking for an order; someone typing "Baukrane"
 * is looking for a customer. Grouping lets them find the right kind of thing
 * without reading past nine of the wrong kind.
 */
const groupOrder = [
  "ACCOUNT",
  "CONTACT",
  "QUOTATION",
  "OPPORTUNITY",
  "SALES_ORDER",
  "PROJECT",
  "PRODUCT",
] as const;

/** Where each kind of result actually lives. */
function hrefFor(hit: Hit): string {
  switch (hit.resourceTypeCode) {
    case "ACCOUNT":
      return `/customers/${hit.resourceId}`;
    case "CONTACT":
      return `/contacts/${hit.resourceId}`;
    case "QUOTATION":
      return `/quotations/${hit.resourceId}`;
    case "OPPORTUNITY":
      return `/opportunities/${hit.resourceId}`;
    case "SALES_ORDER":
      return `/orders/${hit.resourceId}`;
    case "PROJECT":
      return `/projects/${hit.resourceId}`;
    case "PRODUCT":
      return `/products/${hit.resourceId}`;
    default:
      return "/";
  }
}

export function SearchPage({ client }: { client: ApiClient }) {
  const { locale } = useI18n();
  const ar = locale === "ar";
  const labels = ar ? arLabels : enLabels;
  const [params, setParams] = useSearchParams();
  const term = params.get("q") ?? "";
  const [draft, setDraft] = useState(term);
  const [kind, setKind] = useState("");

  const results = useQuery({
    queryKey: ["global-search", term],
    // Two characters is the server's own floor; asking below it only produces
    // a 422 the user cannot act on.
    enabled: term.trim().length >= 2,
    queryFn: async () => {
      const result = await client.GET("/search", {
        params: { query: { q: term.trim(), page: 1, limit: 50 } },
      });
      if (!result.data)
        throw new Error(`SEARCH_${String(result.response.status)}`);
      return result.data.data as unknown as Hit[];
    },
  });

  const grouped = useMemo(() => {
    const byKind = new Map<string, Hit[]>();
    for (const hit of results.data ?? []) {
      const bucket = byKind.get(hit.resourceTypeCode);
      if (bucket) bucket.push(hit);
      else byKind.set(hit.resourceTypeCode, [hit]);
    }
    return groupOrder
      .map((key) => ({ key, hits: byKind.get(key) ?? [] }))
      .filter((group) => group.hits.length > 0);
  }, [results.data]);

  const visible = kind === "" ? grouped : grouped.filter((g) => g.key === kind);
  const total = results.data?.length ?? 0;

  return (
    <section className="search-page">
      <PageHeader
        kicker={labels.kicker}
        title={labels.title}
        count={total}
        sub={labels.subtitle}
        {...(term === "" ? {} : { status: `${labels.resultsFor} "${term}"` })}
      />

      <form
        className="search-bar"
        onSubmit={(event) => {
          event.preventDefault();
          const next = new URLSearchParams(params);
          if (draft.trim() === "") next.delete("q");
          else next.set("q", draft.trim());
          setParams(next);
        }}
      >
        <input
          type="search"
          value={draft}
          autoFocus
          placeholder={labels.placeholder}
          aria-label={labels.placeholder}
          onChange={(event) => {
            setDraft(event.target.value);
          }}
        />
        <button type="submit" className="primary">
          {labels.search}
        </button>
      </form>

      {grouped.length > 0 && (
        <div className="search-kinds">
          <button
            type="button"
            className={kind === "" ? "search-kind is-active" : "search-kind"}
            onClick={() => {
              setKind("");
            }}
          >
            {labels.everything} ({total})
          </button>
          {grouped.map((group) => (
            <button
              key={group.key}
              type="button"
              className={
                kind === group.key ? "search-kind is-active" : "search-kind"
              }
              onClick={() => {
                setKind(group.key);
              }}
            >
              {labels.kinds[group.key] ?? group.key} ({group.hits.length})
            </button>
          ))}
        </div>
      )}

      <ErrorBanner
        error={results.error}
        retry={() => {
          void results.refetch();
        }}
      />

      {term.trim().length < 2 && (
        <p className="search-hint">{labels.typeToSearch}</p>
      )}
      {results.isFetching && <p className="search-hint">{labels.searching}</p>}
      {term.trim().length >= 2 && !results.isFetching && total === 0 && (
        <p className="search-hint">
          {labels.noResults} &ldquo;{term}&rdquo;.
        </p>
      )}

      {visible.map((group) => (
        <section key={group.key} className="search-group">
          <h3>{labels.kinds[group.key] ?? group.key}</h3>
          <ul className="search-results">
            {group.hits.map((hit) => (
              <li key={`${hit.resourceTypeCode}:${hit.resourceId}`}>
                <Link to={hrefFor(hit)} className="search-result">
                  <span className="search-result-primary">
                    {hit.primaryText}
                  </span>
                  <span className="search-result-secondary">
                    {hit.secondaryText}
                  </span>
                  {hit.badgeCode !== null && hit.badgeCode !== undefined && (
                    <span className="search-result-badge">{hit.badgeCode}</span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </section>
  );
}

const enLabels = {
  kicker: "Search",
  title: "Search everything",
  subtitle:
    "Customers, contacts, quotations, deals, orders, projects, products.",
  resultsFor: "Results for",
  placeholder: "Customer, quotation number, order number, item code…",
  search: "Search",
  everything: "Everything",
  typeToSearch: "Type at least two characters.",
  searching: "Searching…",
  noResults: "Nothing found for",
  kinds: {
    ACCOUNT: "Customers",
    CONTACT: "Contacts",
    QUOTATION: "Quotations",
    OPPORTUNITY: "Opportunities",
    SALES_ORDER: "Sales orders",
    PROJECT: "Projects",
    PRODUCT: "Products",
  } as Record<string, string>,
};

const arLabels: typeof enLabels = {
  kicker: "البحث",
  title: "ابحث في كل شيء",
  subtitle:
    "العملاء وجهات الاتصال وعروض الأسعار والفرص والأوامر والمشروعات والمنتجات.",
  resultsFor: "نتائج البحث عن",
  placeholder: "عميل أو رقم عرض سعر أو رقم أمر أو كود صنف…",
  search: "بحث",
  everything: "الكل",
  typeToSearch: "اكتب حرفين على الأقل.",
  searching: "جارٍ البحث…",
  noResults: "لا توجد نتائج لـ",
  kinds: {
    ACCOUNT: "العملاء",
    CONTACT: "جهات الاتصال",
    QUOTATION: "عروض الأسعار",
    OPPORTUNITY: "الفرص",
    SALES_ORDER: "أوامر البيع",
    PROJECT: "المشروعات",
    PRODUCT: "المنتجات",
  },
};
