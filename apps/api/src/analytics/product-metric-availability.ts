/**
 * Why a product or price metric cannot be computed — stated per metric.
 *
 * These six product metrics and one price metric were declared ACTIVE in the
 * authoritative registry with no computation behind any of them. Asking for
 * one fell through to the catch-all at the bottom of `calculate`, which
 * answers:
 *
 *   "Authoritative source columns required for this governed metric are not
 *    populated in the current selected scope."
 *
 * That sentence reads as a data or date-range problem, and it was true of
 * exactly one of the seven. It sent a reader looking for rows that were never
 * the issue. The reasons are genuinely different, and each one points at a
 * different fix:
 *
 *   - formwork / loose boards: the split is an **account** business type
 *     (`accounts.business_type_code`), and the metric asks for it per product.
 *     No column holds it. Fixing it means classifying the product master.
 *   - board type mix: every one of the 2,927 products is `STANDARD_SKU`, and
 *     all but fifteen read "acrow board". There is no M / A / Curved
 *     distinction to group by.
 *   - top thicknesses: `products.thickness_mm` exists and is null on every
 *     row. This is the one the old sentence described correctly.
 *
 * Kept apart from the service so the claim "each metric says which" is a
 * thing a test can check, rather than a comment.
 */

export type MetricAvailability =
  { computed: true } | { computed: false; reason: string; unit: string };

const NOT_COMPUTABLE: Record<string, { reason: string; unit: string }> = {
  "MET-PROD-001": {
    reason: "PRODUCT_FORMWORK_CLASSIFICATION_NOT_CAPTURED",
    unit: "Percent",
  },
  "MET-PROD-002": {
    reason: "PRODUCT_FORMWORK_CLASSIFICATION_NOT_CAPTURED",
    unit: "Percent",
  },
  "MET-PROD-003": {
    reason: "PRODUCT_BOARD_TYPE_NOT_CLASSIFIED",
    unit: "Quantity",
  },
  "MET-PROD-004": {
    reason: "PRODUCT_THICKNESS_NOT_POPULATED",
    unit: "Quantity",
  },
};

/** The product and price metrics this service computes from ERP order lines. */
export const COMPUTED_PRODUCT_METRICS = [
  "MET-PROD-005",
  "MET-PROD-006",
  "MET-PRICE-001",
] as const;

export function productMetricAvailability(
  metricId: string,
): MetricAvailability {
  const blocked = NOT_COMPUTABLE[metricId];
  if (blocked !== undefined)
    return { computed: false, reason: blocked.reason, unit: blocked.unit };
  if ((COMPUTED_PRODUCT_METRICS as readonly string[]).includes(metricId))
    return { computed: true };
  return {
    computed: false,
    reason: "UNKNOWN_PRODUCT_METRIC",
    unit: "Quantity",
  };
}
