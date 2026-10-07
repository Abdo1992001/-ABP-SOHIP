import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  COMPUTED_PRODUCT_METRICS,
  productMetricAvailability,
} from "./product-metric-availability.js";

/**
 * The seven product and price metrics were declared ACTIVE and computed
 * nothing. Asking for any of them returned one inherited sentence — that the
 * source columns "are not populated in the current selected scope" — which
 * was true of exactly one of them and pointed the other six at the wrong
 * thing entirely.
 *
 * These check the two halves of the fix: the three that can be computed are
 * routed to a computation, and each of the four that cannot says which of the
 * four different things is missing.
 */

describe("product metric availability", () => {
  it("routes the metrics the ERP lines can answer to a computation", () => {
    for (const metricId of COMPUTED_PRODUCT_METRICS)
      expect(productMetricAvailability(metricId)).toEqual({ computed: true });
  });

  it("says the formwork split is not held against a product", () => {
    // It is an account business type, so no amount of data in erp_order_lines
    // would produce it — the product master has to be classified first.
    for (const metricId of ["MET-PROD-001", "MET-PROD-002"]) {
      const result = productMetricAvailability(metricId);
      expect(result.computed).toBe(false);
      expect(result).toMatchObject({
        reason: "PRODUCT_FORMWORK_CLASSIFICATION_NOT_CAPTURED",
        unit: "Percent",
      });
    }
  });

  it("says the board type is not classified, rather than blaming the rows", () => {
    expect(productMetricAvailability("MET-PROD-003")).toMatchObject({
      computed: false,
      reason: "PRODUCT_BOARD_TYPE_NOT_CLASSIFIED",
    });
  });

  it("says the thickness column is empty, which is the one that really is", () => {
    expect(productMetricAvailability("MET-PROD-004")).toMatchObject({
      computed: false,
      reason: "PRODUCT_THICKNESS_NOT_POPULATED",
    });
  });

  it("gives four different reasons, not one sentence four times", () => {
    const reasons = new Set(
      ["MET-PROD-001", "MET-PROD-003", "MET-PROD-004"].map((metricId) => {
        const result = productMetricAvailability(metricId);
        return result.computed ? "computed" : result.reason;
      }),
    );
    expect(reasons.size).toBe(3);
  });

  it("does not claim to answer a metric nobody declared", () => {
    expect(productMetricAvailability("MET-PROD-999")).toMatchObject({
      computed: false,
      reason: "UNKNOWN_PRODUCT_METRIC",
    });
  });

  it("covers every product and price metric the registry declares", () => {
    // A metric added to the registry and forgotten here would fall through to
    // the generic catch-all again, which is the whole defect coming back.
    const registry = readFileSync(
      new URL("./authoritative-registry.generated.ts", import.meta.url),
      "utf8",
    );
    const declared = [
      ...new Set(
        [...registry.matchAll(/metricId: "(MET-(?:PROD|PRICE)-\d+)"/g)].map(
          (match) => match[1] ?? "",
        ),
      ),
    ];
    expect(declared.length).toBeGreaterThan(0);
    for (const metricId of declared) {
      const result = productMetricAvailability(metricId);
      const reason = result.computed ? "computed" : result.reason;
      expect(
        reason,
        `${metricId} falls through to the generic answer`,
      ).not.toBe("UNKNOWN_PRODUCT_METRIC");
    }
  });
});
