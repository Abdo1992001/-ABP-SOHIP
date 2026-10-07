import { describe, expect, it } from "vitest";
import { formatMetricValue, metricText } from "./metric-format.ts";

describe("formatMetricValue", () => {
  it("stops a ratio printing its full division", () => {
    // Read off the live Reporting screen: Pipeline Aging, twenty digits wide.
    expect(metricText("9.49899942418981483056", "Percent")).toBe("9.5%");
  });

  it("rounds a conversion rate to where it still means something", () => {
    expect(metricText("42.8571", "Percent")).toBe("42.9%");
  });

  it("groups money and drops the fractions nobody reads a pipeline to", () => {
    expect(metricText("2900000", "USD")).toBe("2,900,000 USD");
    expect(metricText("1332500", "USD")).toBe("1,332,500 USD");
    expect(metricText("133185659.4412", "EGP")).toBe("133,185,659 EGP");
  });

  it("prefers the currency the report was run in over the unit", () => {
    expect(metricText("2900000", "Quantity", "EGP")).toBe("2,900,000 EGP");
  });

  it("keeps counts and quantities whole", () => {
    expect(metricText("29", "Count")).toBe("29 Count");
    expect(metricText("45.0", "Count")).toBe("45 Count");
    expect(metricText("1968", "Quantity")).toBe("1,968 Quantity");
  });

  it("keeps half a day of ageing", () => {
    expect(metricText("12.46", "Days")).toBe("12.5 Days");
  });

  it("wears the percent sign rather than the word", () => {
    expect(formatMetricValue("0", "Percent")).toEqual({
      value: "0.0",
      suffix: "%",
    });
  });

  it("gives an unrecognised unit two decimals rather than twenty", () => {
    // A unit added to the registry later must never print raw.
    expect(metricText("3.14159265358979", "Furlongs")).toBe("3.14 Furlongs");
  });

  it("weighs kilograms in whole kilos", () => {
    expect(metricText("8840.6", "kg")).toBe("8,841 kg");
  });

  it("leaves a value that is not a number exactly as it came", () => {
    // These are codes, not miscounted figures: reformatting one would hide a
    // real answer behind a NaN.
    // And without the unit: "UNAVAILABLE %" is not a reading of anything.
    expect(metricText("UNAVAILABLE", "Percent")).toBe("UNAVAILABLE");
    expect(formatMetricValue("ZERO_TARGET_DENOMINATOR", "Count").value).toBe(
      "ZERO_TARGET_DENOMINATOR",
    );
  });

  it("shows nothing as an em dash rather than NaN", () => {
    expect(formatMetricValue(null, "Count").value).toBe("—");
    expect(formatMetricValue(undefined, null).value).toBe("—");
  });

  it("takes a number as readily as a string", () => {
    expect(metricText(42.8571, "Percent")).toBe("42.9%");
  });

  it("prints a bare figure when the metric has no unit at all", () => {
    expect(metricText("17", null)).toBe("17.00");
    expect(formatMetricValue("17", "").suffix).toBe("");
  });

  it("does not round a large count into scientific notation", () => {
    expect(metricText("1234567890", "Count")).toBe("1,234,567,890 Count");
  });

  it("keeps a negative figure negative", () => {
    expect(metricText("-4.62", "Percent")).toBe("-4.6%");
  });
});
