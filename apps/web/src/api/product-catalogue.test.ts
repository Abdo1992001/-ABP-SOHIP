import { describe, expect, it } from "vitest";
import { widthsOf } from "./product-catalogue.ts";

describe("widthsOf", () => {
  it("asks once per width, however many lines share it", () => {
    expect(
      widthsOf([
        { widthMm: 1220 },
        { widthMm: 883 },
        { widthMm: 1220 },
        { widthMm: 1220.2 },
      ]),
    ).toEqual([883, 1220]);
  });
  it("leaves out a line with no width yet", () => {
    expect(widthsOf([{ widthMm: 0 }, { widthMm: Number.NaN }])).toEqual([]);
  });
});
