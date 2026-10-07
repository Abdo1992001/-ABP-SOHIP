import { describe, expect, it } from "vitest";
import {
  PIN_SHEET_HEADERS,
  cellText,
  pinSheetRows,
  readPinSheet,
  type PinnablePoint,
} from "./map-pins.ts";

const points: PinnablePoint[] = [
  {
    kind: "ACCOUNT",
    id: "a1",
    ref: "ACC-00000001",
    name: "Arab Contractors",
    countryCode: "EG",
    address: "New Cairo",
    precision: "DISTRICT",
    lat: 30.02,
    lng: 31.46,
  },
  {
    kind: "PROJECT",
    id: "p1",
    ref: "PRJ-00000001",
    name: "Iconic Tower",
    countryCode: "EG",
    city: "New Capital",
    precision: "PINNED",
    lat: 30.0075,
    lng: 31.7031,
  },
  {
    kind: "ACCOUNT",
    id: "a2",
    ref: "ACC-00000002",
    name: "Gulf Builders",
    countryCode: "AE",
    precision: "COUNTRY",
  },
];
const head = [...PIN_SHEET_HEADERS];

describe("pin sheet", () => {
  it("lists everyone, with a pin only where one was dropped", () => {
    const rows = pinSheetRows(points);
    expect(rows[0]).toEqual([
      "Customer",
      "ACC-00000001",
      "Arab Contractors",
      "EG",
      "New Cairo",
      "",
      "",
    ]);
    expect(rows[1]?.slice(5)).toEqual([30.0075, 31.7031]);
  });

  it("reads new pins and leaves blank and unmoved rows alone", () => {
    const result = readPinSheet(
      [
        head,
        ["Customer", "ACC-00000001", "", "", "", 30.0296, 31.4913],
        ["Project", "PRJ-00000001", "", "", "", 30.0075, 31.7031],
        ["Customer", "ACC-00000002", "", "", "", "", ""],
      ],
      points,
    );
    expect(result.problems).toEqual([]);
    expect(result.unchanged).toBe(1);
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]).toMatchObject({
      lat: 30.0296,
      lng: 31.4913,
      swapped: false,
    });
  });

  it("takes coordinates pasted together, and puts swapped ones right", () => {
    const result = readPinSheet(
      [
        head,
        ["Customer", "acc-00000001", "", "", "", "30.03, 31.47", ""],
        // Hurghada typed backwards: 33.81 is no latitude in Egypt.
        ["Project", "PRJ-00000001", "", "", "", 33.8116, 27.2579],
      ],
      points,
    );
    expect(
      result.changes.map((one) => [one.lat, one.lng, one.swapped]),
    ).toEqual([
      [30.03, 31.47, false],
      [27.2579, 33.8116, true],
    ]);
  });

  it("names the row and the reason for everything it cannot use", () => {
    const result = readPinSheet(
      [
        head,
        ["Customer", "ACC-99999999", "", "", "", 30, 31],
        ["Customer", "ACC-00000001", "", "", "", 30, ""],
        ["Customer", "ACC-00000002", "", "", "", "north", 31],
      ],
      points,
    );
    expect(result.changes).toEqual([]);
    expect(result.problems.map((problem) => problem.row)).toEqual([2, 3, 4]);
    expect(result.problems[0]?.reason).toContain("ACC-99999999");
  });

  it("refuses a sheet that is not the downloaded one", () => {
    const result = readPinSheet([["Company", "Lat", "Lng"]], points);
    expect(result.problems[0]?.row).toBe(1);
  });

  it("reads rich text and formula cells as their text", () => {
    expect(cellText({ richText: [{ text: "ACC-" }, { text: "1" }] })).toBe(
      "ACC-1",
    );
    expect(cellText({ formula: "A1", result: 30.5 })).toBe("30.5");
  });
});
