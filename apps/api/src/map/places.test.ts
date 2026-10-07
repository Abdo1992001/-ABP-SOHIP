import { describe, expect, it } from "vitest";
import { distanceKm, findPlace, locate, normalisePlaceText } from "./places.js";

describe("findPlace", () => {
  it("finds districts in English and Arabic", () => {
    expect(findPlace("Villa 12, 5th Settlement, New Cairo")?.key).toBe(
      "fifth-settlement",
    );
    expect(findPlace("التجمع الخامس - شارع التسعين")?.key).toBe(
      "fifth-settlement",
    );
    expect(findPlace("New Capital")?.key).toBe("new-capital");
    expect(findPlace("العاصمة الإدارية الجديدة")?.key).toBe("new-capital");
  });
  it("prefers the more specific name", () => {
    expect(findPlace("New Cairo")?.key).toBe("new-cairo");
    expect(findPlace("Cairo")?.key).toBe("cairo");
    expect(findPlace("El Sheikh Zayed, Giza")?.key).toBe("sheikh-zayed");
  });
  it("ignores what it does not know", () => {
    expect(findPlace("Building 4", null, "")).toBeNull();
  });
});

describe("normalisePlaceText", () => {
  it("folds Arabic letter forms and drops al-/el-", () => {
    expect(normalisePlaceText("الإسكندرية")).toBe(
      normalisePlaceText("الاسكندريه"),
    );
    expect(normalisePlaceText("El-Gouna")).toBe("gouna");
  });
});

describe("locate", () => {
  it("uses a pin first, then a district, then the country", () => {
    expect(
      locate({
        latitude: 30,
        longitude: 31,
        countryCode: "EG",
        texts: ["Cairo"],
      })?.precision,
    ).toBe("PINNED");
    expect(locate({ countryCode: "EG", texts: ["Luxor"] })).toMatchObject({
      precision: "DISTRICT",
      placeKey: "luxor",
    });
    expect(locate({ countryCode: "SA", texts: ["Luxor"] })?.precision).toBe(
      "COUNTRY",
    );
    expect(locate({ countryCode: "ZZ", texts: [] })).toBeNull();
  });
});

describe("distanceKm", () => {
  it("measures Fifth Settlement to the New Capital at about 26 km", () => {
    const km = distanceKm(
      { lat: 30.0075, lng: 31.4913 },
      { lat: 30.0196, lng: 31.7573 },
    );
    expect(km).toBeGreaterThan(24);
    expect(km).toBeLessThan(28);
  });
});
