import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ApiClient } from "@abp/api-client";
import { getProduct, listProducts } from "../api/product-api.ts";
import { useI18n } from "../i18n/i18n.tsx";
import {
  fillFromProduct,
  lookupProduct,
  type LookupProduct,
  type ProductFill,
} from "../lib/product-lookup.ts";

/**
 * The item code on a quotation line, tied to its description.
 *
 * A salesperson arrives with either the code (from the ERP or a BOQ) or the
 * board. Typing the code fills the description and sizes; a line that already
 * has an item shows its code, so the two are never read apart. Only an exact
 * code match is applied on its own — anything else is offered to choose from,
 * because the wrong variant is priced, sent and delivered before anybody
 * notices.
 */
export function LineItemCode({
  client,
  productId,
  editable,
  onResolved,
  children,
}: {
  client: ApiClient;
  productId: string | undefined;
  editable: boolean;
  onResolved: (fill: ProductFill, code: string) => void;
  /** The description, laid out on the same line as its code. */
  children?: ReactNode;
}) {
  const { locale } = useI18n();
  const txt = (en: string, ar: string) => (locale === "ar" ? ar : en);
  const [typed, setTyped] = useState<string | null>(null);

  const current = useQuery({
    queryKey: ["products", "line-code", productId ?? ""],
    queryFn: () => getProduct(client, productId ?? ""),
    enabled: productId !== undefined && productId !== "",
    retry: false,
    staleTime: 5 * 60_000,
  });
  const currentCode =
    productId !== undefined && productId !== ""
      ? (current.data?.data.skuCode ?? current.data?.data.barcode ?? "")
      : "";

  // Searched once typing pauses, not on every key: the API allows sixty
  // searches a minute per user, and a thirteen-digit code typed key by key
  // would spend eleven of them on one line.
  const [search, setSearch] = useState("");
  useEffect(() => {
    const next = (typed ?? "").trim();
    const timer = setTimeout(() => {
      setSearch(next);
    }, 350);
    return () => {
      clearTimeout(timer);
    };
  }, [typed]);
  const found = useQuery({
    queryKey: ["products", "line-code-search", search],
    queryFn: () => listProducts(client, { page: 1, limit: 50, search }),
    enabled: search.length >= 3,
    retry: false,
    staleTime: 60_000,
  });
  const catalogue: LookupProduct[] = (found.data?.data ?? []).map(
    (product) => ({
      productId: product.productId,
      skuCode: product.skuCode,
      barcode: product.barcode,
      canonicalDescription: product.canonicalDescription,
    }),
  );
  const result =
    search.length >= 3
      ? lookupProduct(search, catalogue)
      : { applyDirectly: null, candidates: [] };

  const apply = (product: LookupProduct) => {
    const code = product.skuCode ?? product.barcode ?? "";
    onResolved(fillFromProduct(product), code);
    setTyped(null);
  };

  // An exact match is applied as soon as the search comes back.
  // Only once the search has caught up with what is in the box, so a match for
  // an earlier, shorter code is never applied to the one being typed.
  const settled =
    typed !== null && search === typed.trim() && !found.isFetching;
  const exact = settled ? result.applyDirectly : null;
  useEffect(() => {
    if (exact !== null) apply(exact);
    // Keyed on the match, not on apply, which is recreated each render.
  }, [exact?.productId]);

  const shown = typed ?? currentCode;
  const noMatch =
    settled &&
    search.length >= 3 &&
    found.isSuccess &&
    result.candidates.length === 0;

  return (
    <div className="line-item-code">
      <div className="line-item-code-row">
        <input
          aria-label={txt("Item code", "كود الصنف")}
          className="line-item-code-input"
          dir="ltr"
          readOnly={!editable}
          value={shown}
          placeholder={txt("Item code", "كود الصنف")}
          onChange={(event) => {
            setTyped(event.target.value);
          }}
          onBlur={() => {
            // Leaving the box without a match restores the line's real code,
            // so a half-typed code is never mistaken for the one on the line.
            if (result.candidates.length === 0) setTyped(null);
          }}
        />
        {children}
      </div>
      {noMatch && (
        <small className="line-item-code-miss">
          {txt("No item with this code", "مفيش صنف بالكود ده")}
        </small>
      )}
      {settled &&
        result.applyDirectly === null &&
        result.candidates.length > 0 && (
          <ul
            className="line-item-code-options"
            role="listbox"
            aria-label={txt("Matching items", "أصناف مطابقة")}
          >
            {result.candidates.slice(0, 8).map((match) => (
              <li key={match.product.productId}>
                <button
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault();
                  }}
                  onClick={() => {
                    apply(match.product);
                  }}
                >
                  <strong dir="ltr">
                    {match.product.skuCode ?? match.product.barcode ?? "—"}
                  </strong>
                  <span>{match.product.canonicalDescription}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
    </div>
  );
}
