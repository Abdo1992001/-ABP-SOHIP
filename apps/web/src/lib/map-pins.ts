/**
 * Pins in bulk: the sheet a person downloads from the customer map, fills with
 * coordinates, and uploads again.
 *
 * Dropping pins one by one is fine for the odd site; a sales team that has a
 * list of a hundred customer offices wants to paste the coordinates in one go.
 * The sheet carries every customer and project the person can see, keyed by
 * its reference, so nothing is matched by guessing at names.
 */

export interface PinnablePoint {
  kind: "ACCOUNT" | "PROJECT";
  id: string;
  ref?: unknown;
  name?: unknown;
  countryCode?: unknown;
  address?: unknown;
  city?: unknown;
  precision?: unknown;
  lat?: unknown;
  lng?: unknown;
}

export interface PinChange {
  point: PinnablePoint;
  lat: number;
  lng: number;
  /** The two numbers were the wrong way round and have been put right. */
  swapped: boolean;
}

export interface PinProblem {
  row: number;
  reason: string;
}

export const PIN_SHEET_HEADERS = [
  "Type",
  "Reference",
  "Name",
  "Country",
  "Address",
  "Latitude",
  "Longitude",
] as const;

const TYPE_LABEL = { ACCOUNT: "Customer", PROJECT: "Project" } as const;

const str = (value: unknown): string =>
  typeof value === "string"
    ? value.trim()
    : typeof value === "number"
      ? String(value)
      : "";

/** One row per customer and project; existing pins are filled in. */
export function pinSheetRows(points: readonly PinnablePoint[]): unknown[][] {
  return points.map((point) => {
    const pinned = point.precision === "PINNED";
    return [
      TYPE_LABEL[point.kind],
      str(point.ref),
      str(point.name),
      str(point.countryCode),
      str(point.address) || str(point.city),
      pinned && typeof point.lat === "number" ? point.lat : "",
      pinned && typeof point.lng === "number" ? point.lng : "",
    ];
  });
}

/** What a spreadsheet cell holds, as text: plain, rich text or a formula. */
export function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.richText))
      return record.richText
        .map((part) =>
          typeof part === "object" && part !== null
            ? str((part as Record<string, unknown>).text)
            : "",
        )
        .join("")
        .trim();
    if ("result" in record) return cellText(record.result);
    if ("text" in record) return cellText(record.text);
  }
  return "";
}

function kindOf(value: string): "ACCOUNT" | "PROJECT" | null {
  const clean = value.trim().toUpperCase();
  if (["CUSTOMER", "ACCOUNT", "عميل"].includes(clean)) return "ACCOUNT";
  if (["PROJECT", "مشروع"].includes(clean)) return "PROJECT";
  return null;
}

/**
 * Roughly Egypt: enough to notice latitude and longitude typed backwards where
 * that is certain. Around Cairo both orders land inside the country (30, 31 is
 * Cairo; 31, 30 is the Delta), so those are taken as written.
 */
const inEgypt = (lat: number, lng: number) =>
  lat >= 21.5 && lat <= 32 && lng >= 24.5 && lng <= 37;

/**
 * Read a filled sheet back. Rows without coordinates, and rows whose pin is
 * already where the sheet says, are left alone; everything else is either a
 * change to save or a problem with the row number to fix.
 */
export function readPinSheet(
  grid: readonly (readonly unknown[])[],
  points: readonly PinnablePoint[],
): { changes: PinChange[]; unchanged: number; problems: PinProblem[] } {
  const header = (grid[0] ?? []).map((cell) => cellText(cell).toLowerCase());
  const at = (name: string) => header.indexOf(name.toLowerCase());
  const columns = {
    type: at("Type"),
    ref: at("Reference"),
    name: at("Name"),
    lat: at("Latitude"),
    lng: at("Longitude"),
  };
  const changes: PinChange[] = [];
  const problems: PinProblem[] = [];
  let unchanged = 0;
  if (columns.ref < 0 || columns.lat < 0) {
    problems.push({
      row: 1,
      reason:
        "The first row has to be the headings of the downloaded sheet (Reference, Latitude, Longitude…).",
    });
    return { changes, unchanged, problems };
  }

  const byRef = new Map<string, PinnablePoint>();
  for (const point of points) {
    const ref = str(point.ref).toUpperCase();
    if (ref) byRef.set(`${point.kind}:${ref}`, point);
  }
  const seen = new Set<string>();

  grid.slice(1).forEach((cells, index) => {
    const row = index + 2;
    const cell = (column: number) =>
      column < 0 ? "" : cellText(cells[column]);
    let latText = cell(columns.lat);
    let lngText = cell(columns.lng);
    // "30.03, 31.47" pasted from a map app into the latitude cell.
    if (lngText === "" && latText.includes(",")) {
      const [first = "", second = ""] = latText.split(",");
      latText = first.trim();
      lngText = second.trim();
    }
    if (latText === "" && lngText === "") return;
    const ref = cell(columns.ref).toUpperCase();
    const kind =
      kindOf(cell(columns.type)) ??
      (ref.startsWith("PRJ") ? "PROJECT" : "ACCOUNT");
    const point = byRef.get(`${kind}:${ref}`);
    if (!point) {
      problems.push({
        row,
        reason: ref
          ? `${ref} is not a ${kind === "PROJECT" ? "project" : "customer"} you can see.`
          : "The reference is empty.",
      });
      return;
    }
    if (latText === "" || lngText === "") {
      problems.push({ row, reason: "Both latitude and longitude are needed." });
      return;
    }
    let lat = Number(latText);
    let lng = Number(lngText);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      problems.push({ row, reason: "Latitude and longitude must be numbers." });
      return;
    }
    let swapped = false;
    if (
      str(point.countryCode) === "EG" &&
      !inEgypt(lat, lng) &&
      inEgypt(lng, lat)
    ) {
      [lat, lng] = [lng, lat];
      swapped = true;
    }
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      problems.push({
        row,
        reason: "Latitude runs from -90 to 90 and longitude from -180 to 180.",
      });
      return;
    }
    const key = `${point.kind}:${point.id}`;
    if (seen.has(key)) {
      problems.push({ row, reason: `${ref} appears twice in the sheet.` });
      return;
    }
    seen.add(key);
    const same =
      point.precision === "PINNED" &&
      typeof point.lat === "number" &&
      typeof point.lng === "number" &&
      Math.abs(point.lat - lat) < 1e-7 &&
      Math.abs(point.lng - lng) < 1e-7;
    if (same) {
      unchanged += 1;
      return;
    }
    changes.push({ point, lat, lng, swapped });
  });
  return { changes, unchanged, problems };
}
