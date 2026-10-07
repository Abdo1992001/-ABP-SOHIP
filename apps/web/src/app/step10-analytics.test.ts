import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { operationById } from "../api/operation-runtime.ts";
import { screens } from "./screen-registry.ts";

describe("Step 10 governed analytics frontend", () => {
  it("maps the typed semantic report, drilldown, registry, and export operations", () => {
    const required = [
      "get_analytics_registry_metrics",
      "get_analytics_registry_reports",
      "get_analytics_metrics_by_metricId",
      "get_analytics_reports_by_reportId",
      "get_analytics_reports_by_reportId_drilldown",
      "post_analytics_reports_by_reportId_exports",
      "get_analytics_exports_by_exportId",
    ];
    expect(
      required.every((operationId) => operationById.has(operationId)),
    ).toBe(true);
    const reportScreen = screens.find((screen) => screen.id === "REPORTS");
    expect(reportScreen?.operations).toEqual(expect.arrayContaining(required));
  });

  it("renders server metric values and contains no authoritative frontend formula", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/app/AnalyticsPage.tsx"),
      "utf8",
    );
    expect(source).toContain("metric.value");
    expect(source).toContain("metric.dqContext");
    expect(source).toContain("executeOperation");
    expect(source).not.toMatch(/booked\s*[+-]/i);
    expect(source).not.toMatch(/shipped\s*[+-]/i);
    expect(source).not.toMatch(/won\s*\/\s*target/i);
    expect(source).not.toContain("demo analytics");
  });

  it("preserves the reconciled Step-9 plus CR-001 screen boundary", () => {
    // The Step-9 boundary is 64; the 65th is the pricing-rules admin screen,
    // added because pricing rules became data and needed somewhere to live
    // other than a SQL prompt.
    // 71 with the sales command centre and the support desk, which had
    // routes and pages but no registry entry and so no way in.
    // 73 with customer orders, list and detail; 74 with receivables; 75 with
    // the delivery calendar; 78 with work orders and the production timeline.
    // 80 with customer feedback; 81 with the customer map; 82 with system.
    expect(screens).toHaveLength(82);
    expect(new Set(screens.map((screen) => screen.implementation))).toEqual(
      new Set(["IMPLEMENTED"]),
    );
  });
});
