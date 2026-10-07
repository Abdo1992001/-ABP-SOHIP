import { useEffect, useState } from "react";
import { useQueries, type UseQueryResult } from "@tanstack/react-query";
import type { ApiClient } from "@abp/api-client";
import { listProducts } from "./product-api.ts";
import type { LookupProduct } from "../lib/product-lookup.ts";

/**
 * The slice of the product master a quotation needs.
 *
 * The catalogue holds 2,927 items and the list endpoint caps a page at 200,
 * so pulling all of it to price a handful of sizes is the wrong trade. Each
 * distinct board width the quotation uses is searched for instead -- the
 * endpoint's search matches the description, which states the sizes.
 *
 * One query per width, cached for the session. The first version fetched
 * every size again on every keystroke, up to twelve requests at a time, and
 * swallowed the failures: once the server started refusing the burst, the
 * catalogue came back empty and every code on the screen stayed at "…" or
 * "no code at this size" for boards the catalogue does hold. Now a width is
 * fetched once, only after the typing has settled, a refusal is retried, and
 * a width shared by ten lines is one request.
 */
export async function findCatalogueByWidth(
  client: ApiClient,
  widthMm: number,
): Promise<LookupProduct[]> {
  const search = `${String(widthMm)} mm`;
  const found: LookupProduct[] = [];
  // A common width runs past one page: 264 descriptions mention "1220 mm".
  for (let page = 1; page <= 5; page += 1) {
    const result = await listProducts(client, { page, limit: 200, search });
    for (const product of result.data)
      found.push({
        productId: product.productId,
        skuCode: product.skuCode,
        barcode: product.barcode,
        canonicalDescription: product.canonicalDescription,
      });
    if (!result.meta.hasNext) break;
  }
  return found;
}

/** The distinct whole-millimetre widths the lines ask about, in order. */
export function widthsOf(sizes: readonly { widthMm: number }[]): number[] {
  return [
    ...new Set(
      sizes
        .map((size) => Math.round(size.widthMm))
        .filter((width) => width > 0),
    ),
  ].sort((a, b) => a - b);
}

/** A value that only changes once it has stopped changing for `ms`. */
function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSettled(value);
    }, ms);
    return () => {
      window.clearTimeout(timer);
    };
  }, [value, ms]);
  return settled;
}

function combine(results: UseQueryResult<LookupProduct[]>[]) {
  const found = new Map<string, LookupProduct>();
  for (const result of results)
    for (const product of result.data ?? [])
      found.set(product.productId, product);
  return {
    products: [...found.values()],
    // Waiting only while a width has nothing yet: a width already loaded and
    // being checked again in the background is not a reason to show "…".
    loading: results.some(
      (result) => result.data === undefined && !result.isError,
    ),
  };
}

/** Every product at the widths the quotation's lines use. */
export function useSizeCatalogue(
  client: ApiClient,
  sizes: readonly { widthMm: number }[],
) {
  const settled = useSettled(widthsOf(sizes).join(","), 450);
  const widths = settled === "" ? [] : settled.split(",").map(Number);
  return useQueries({
    queries: widths.map((width) => ({
      queryKey: ["products", "by-width", width],
      queryFn: () => findCatalogueByWidth(client, width),
      staleTime: 30 * 60_000,
      gcTime: 60 * 60_000,
      retry: 3,
      retryDelay: (attempt: number) => 800 * (attempt + 1),
    })),
    combine,
  });
}
