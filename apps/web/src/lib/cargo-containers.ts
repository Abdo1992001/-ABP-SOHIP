/**
 * What we load into.
 *
 * ABP books two things for board: a 20ft and a 40ft. Everything else here is
 * road haulage, kept because the same question gets asked about a jumbo or a
 * trailer, and marked so the two that matter lead the list.
 *
 * These are **internal** dimensions, not nominal ones: a "40ft" container is
 * 12,192mm long on the outside and 12,032mm on the inside, and planning
 * against the outside number is how a load that fits on paper does not fit on
 * the quay. Door openings are separate because a bundle that fits the box can
 * still be wider than the way in.
 *
 * **Payload is a booking limit, not the plate.** A box is rated far higher
 * than anyone loads it: ABP works to 25 tonnes and will go to 26 if the line
 * accepts it, so that is the default and `payloadCeilingKg` is where the
 * setting stops. Every figure here is a starting value — the screen lets them
 * be edited, because a lane, a line or a road limit can change any of them and
 * a number frozen in code is a number that quietly goes wrong.
 */

export interface CargoContainer {
  readonly code: string;
  readonly name: { readonly en: string; readonly ar: string };
  readonly kind: "SEA" | "ROAD";
  /** Whether this is one of the two ABP actually books for board. */
  readonly primary: boolean;
  /** Internal, in millimetres. */
  readonly innerLengthMm: number;
  readonly innerWidthMm: number;
  readonly innerHeightMm: number;
  /** The opening, in millimetres. A flatbed has none: it loads from above. */
  readonly doorWidthMm: number | null;
  readonly doorHeightMm: number | null;
  /** What we plan to, in kilograms. */
  readonly payloadKg: number;
  /** The most this may be raised to. */
  readonly payloadCeilingKg: number;
  readonly tareKg: number;
}

/** The working limit, and the most it may be raised to. */
export const PAYLOAD_TARGET_KG = 25000;
export const PAYLOAD_CEILING_KG = 26000;

export const CARGO_CONTAINERS: readonly CargoContainer[] = [
  // ABP's own fleet, measured off the units the company actually loads --
  // not the ISO figures. They are narrower and a great deal lower than a
  // standard container: 1,800 mm of internal height against a 40HC's 2,698,
  // which is what decides how many bundles go in. Using the ISO numbers
  // planned loads that would not have fitted through the door.
  {
    code: "ABP40",
    name: { en: "ABP 40 ft", ar: "٤٠ قدم أكرو" },
    kind: "SEA",
    primary: true,
    innerLengthMm: 11800,
    innerWidthMm: 2100,
    innerHeightMm: 1800,
    doorWidthMm: 2100,
    doorHeightMm: 1800,
    payloadKg: PAYLOAD_TARGET_KG,
    payloadCeilingKg: PAYLOAD_CEILING_KG,
    tareKg: 4020,
  },
  {
    code: "ABP20",
    name: { en: "ABP 20 ft", ar: "٢٠ قدم أكرو" },
    kind: "SEA",
    primary: true,
    innerLengthMm: 5800,
    innerWidthMm: 2100,
    innerHeightMm: 1800,
    doorWidthMm: 2100,
    doorHeightMm: 1800,
    payloadKg: PAYLOAD_TARGET_KG,
    payloadCeilingKg: PAYLOAD_CEILING_KG,
    tareKg: 2200,
  },
  {
    // ABP's own road fleet. The payloads are the company's stated capacities
    // -- 150, 200 and 700 boards, all at 33 kg a board -- and those are what
    // bind, not the body size: a 13.6 m trailer holds about 1,660 boards by
    // volume and ABP loads 700, because 700 x 33 is 23.1 tonnes.
    //
    // The 4 m and 6 m widths are 2,450 mm, the published load width for a
    // cargo truck body. It matters to forty millimetres: two boards side by
    // side need 2,440, and an earlier estimate of 2,400 made a Jumbo 4 m need
    // two trips for the 150 boards the company loads on one. The lengths are
    // the body sizes the names state. The payloads are ABP's own figures and
    // are not estimates.
    code: "JUMBO4",
    name: { en: "Jumbo 4 m", ar: "جامبو ٤ متر" },
    kind: "ROAD",
    primary: true,
    innerLengthMm: 4200,
    innerWidthMm: 2450,
    innerHeightMm: 2400,
    doorWidthMm: 2450,
    doorHeightMm: 2350,
    payloadKg: 4950,
    payloadCeilingKg: 4950,
    tareKg: 3500,
  },
  {
    code: "JUMBO6",
    name: { en: "Jumbo 6 m", ar: "جامبو ٦ متر" },
    kind: "ROAD",
    primary: true,
    innerLengthMm: 6200,
    innerWidthMm: 2450,
    innerHeightMm: 2400,
    doorWidthMm: 2450,
    doorHeightMm: 2350,
    payloadKg: 6600,
    payloadCeilingKg: 6600,
    tareKg: 4500,
  },
  {
    code: "TRAILER13",
    name: { en: "Trailer 13 m", ar: "مقطورة ١٣ متر" },
    kind: "ROAD",
    primary: true,
    innerLengthMm: 13600,
    innerWidthMm: 2480,
    innerHeightMm: 3000,
    doorWidthMm: 2450,
    doorHeightMm: 2950,
    payloadKg: 23100,
    payloadCeilingKg: 24000,
    tareKg: 7500,
  },
];

/** What the screen opens on: the box ABP books most for board. */
export const DEFAULT_CONTAINER_CODE = "ABP40";

export function containerByCode(code: string): CargoContainer | undefined {
  return CARGO_CONTAINERS.find((unit) => unit.code === code);
}

/** Cubic metres of usable space inside the unit. */
export function innerVolumeM3(unit: {
  innerLengthMm: number;
  innerWidthMm: number;
  innerHeightMm: number;
}): number {
  return (
    (unit.innerLengthMm / 1000) *
    (unit.innerWidthMm / 1000) *
    (unit.innerHeightMm / 1000)
  );
}
