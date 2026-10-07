/**
 * Where each bundle goes, and how many units it takes.
 *
 * ACROW ships panels, and panels arrive as bundles: flat cuboids, heavy for
 * their size, stacked rather than nested. That shape is what the algorithm is
 * built around — a layer/shelf packer, which is the honest model for this
 * cargo and produces a plan a loader can actually follow:
 *
 *   - a **layer** spans the floor at one height;
 *   - within a layer, a **row** runs across the width at one position
 *     along the length;
 *   - within a row, bundles sit side by side.
 *
 * Bundles are placed largest-footprint first, which is the classic
 * first-fit-decreasing ordering: it is not optimal — no practical packer is —
 * but it is deterministic, it never leaves a large item stranded behind small
 * ones, and the same input always produces the same plan, so two people
 * looking at the same quotation see the same load.
 *
 * Two rules are enforced rather than assumed, because breaking either produces
 * a plan that fails at the quay instead of on screen:
 *
 *   - **the door**, not the box, decides what can go in. A bundle that fits
 *     the interior and not the opening is refused with that reason;
 *   - **payload** closes a unit before volume does. Panel cargo is dense, so
 *     a container is normally full by weight with space left in it.
 *
 * Rotation is limited to a quarter turn about the vertical axis. A bundle of
 * panels is banded flat; standing it on edge is not a packing decision, it is
 * a damaged shipment.
 */

export interface CargoItem {
  readonly id: string;
  readonly label: string;
  readonly lengthMm: number;
  readonly widthMm: number;
  readonly heightMm: number;
  readonly weightKg: number;
  readonly quantity: number;
  /** Whether a quarter turn about the vertical axis is allowed. */
  readonly rotatable?: boolean;
  /** Whether anything may be placed on top of it. */
  readonly stackable?: boolean;
}

export interface PackingUnit {
  readonly innerLengthMm: number;
  readonly innerWidthMm: number;
  readonly innerHeightMm: number;
  readonly doorWidthMm: number | null;
  readonly doorHeightMm: number | null;
  readonly payloadKg: number;
}

export interface Placement {
  readonly itemId: string;
  readonly label: string;
  /** Index of the loaded unit, from 0. */
  readonly unitIndex: number;
  /** Millimetres from the unit's inner front-left-floor corner. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Footprint as placed, after any rotation. */
  readonly lengthMm: number;
  readonly widthMm: number;
  readonly heightMm: number;
  readonly weightKg: number;
  readonly rotated: boolean;
}

export interface LoadedUnit {
  readonly index: number;
  readonly placements: readonly Placement[];
  readonly weightKg: number;
  readonly volumeM3: number;
  /** Share of the unit's internal volume that is occupied, 0–1. */
  readonly volumeUse: number;
  /** Share of the unit's payload that is used, 0–1. */
  readonly payloadUse: number;
  /**
   * The container this unit is, when a plan mixes them. A plan of one
   * container type leaves it out and every unit is the plan's unit.
   */
  readonly unit?: PackingUnit;
  readonly containerCode?: string;
}

export type RefusalReason =
  "TOO_LONG" | "TOO_WIDE" | "TOO_TALL" | "DOOR_TOO_SMALL" | "TOO_HEAVY";

export interface Refusal {
  readonly itemId: string;
  readonly label: string;
  readonly quantity: number;
  readonly reason: RefusalReason;
}

export interface PackingResult {
  readonly units: readonly LoadedUnit[];
  readonly refused: readonly Refusal[];
  readonly totalPieces: number;
  readonly placedPieces: number;
  readonly totalWeightKg: number;
}

/** One physical piece, expanded from an item's quantity. */
interface Piece {
  readonly itemId: string;
  readonly label: string;
  readonly lengthMm: number;
  readonly widthMm: number;
  readonly heightMm: number;
  readonly weightKg: number;
  readonly rotatable: boolean;
}

/** Orientation as placed: along the unit's length and across its width. */
interface Footprint {
  readonly lengthMm: number;
  readonly widthMm: number;
  readonly rotated: boolean;
}

/**
 * The orientations a piece may be loaded in, best first.
 *
 * "Best" is the one that runs long-side along the container, which is what a
 * loader does by hand: it wastes the least width and leaves usable strips.
 */
function orientations(piece: Piece): Footprint[] {
  const asIs: Footprint = {
    lengthMm: piece.lengthMm,
    widthMm: piece.widthMm,
    rotated: false,
  };
  if (!piece.rotatable || piece.lengthMm === piece.widthMm) return [asIs];
  const turned: Footprint = {
    lengthMm: piece.widthMm,
    widthMm: piece.lengthMm,
    rotated: true,
  };
  return asIs.lengthMm >= turned.lengthMm ? [asIs, turned] : [turned, asIs];
}

/** Why a piece can never be loaded into this unit, or null if it can. */
function refuse(piece: Piece, unit: PackingUnit): RefusalReason | null {
  const fits = orientations(piece).some(
    (o) =>
      o.lengthMm <= unit.innerLengthMm &&
      o.widthMm <= unit.innerWidthMm &&
      piece.heightMm <= unit.innerHeightMm,
  );
  if (!fits) {
    // Name the dimension that actually blocks it, measured against the best
    // orientation — "too wide" when the piece would fit turned is a lie.
    const best = orientations(piece)[0];
    if (best === undefined) return "TOO_LONG";
    if (piece.heightMm > unit.innerHeightMm) return "TOO_TALL";
    if (best.widthMm > unit.innerWidthMm) return "TOO_WIDE";
    return "TOO_LONG";
  }
  // The way in. A piece is carried through the doors on its footprint, so the
  // opening has to clear its narrower horizontal side and its height.
  const doorWidthMm = unit.doorWidthMm;
  const doorHeightMm = unit.doorHeightMm;
  if (doorWidthMm !== null && doorHeightMm !== null) {
    const throughDoor = orientations(piece).some(
      (o) =>
        Math.min(o.lengthMm, o.widthMm) <= doorWidthMm &&
        piece.heightMm <= doorHeightMm,
    );
    if (!throughDoor) return "DOOR_TOO_SMALL";
  }
  if (piece.weightKg > unit.payloadKg) return "TOO_HEAVY";
  return null;
}

/** A kind of piece still waiting to be loaded: one per item. */
interface Kind {
  readonly itemId: string;
  readonly label: string;
  readonly lengthMm: number;
  readonly widthMm: number;
  readonly heightMm: number;
  readonly weightKg: number;
  readonly rotatable: boolean;
  remaining: number;
}

/** Full and remainder bundles are the same sale line and belong together. */
const bundleGroupId = (itemId: string): string => itemId.replace(/~rest$/, "");

/**
 * Plan the load.
 *
 * Returns the units in loading order, what would not go in and why, and the
 * figures a planner reads: weight, volume and how much of each was used.
 *
 * The unit is filled the way a crew fills it: row by row from the nose, each
 * row filled **across its whole width**, and each position stacked as high as
 * the box and the payload allow.
 *
 * The width is the point. ABP's forty-foot box is 2,100 mm wide and a board
 * is 1,220: one bundle across leaves an 880 mm strip down the whole length.
 * The first version of this filled the box one size at a time, largest first,
 * so that strip stayed empty in every container and a box of 1220 bundles
 * closed at twelve tonnes out of twenty-five. Now each row is completed with
 * whatever else on the order fits the strip -- a 733, a 620, a 583 -- and the
 * narrow boards ride beside the wide ones instead of taking boxes of their own.
 */
export function packCargo(
  items: readonly CargoItem[],
  unit: PackingUnit,
  options: { readonly maxUnits?: number } = {},
): PackingResult {
  const maxUnits = options.maxUnits ?? 40;
  const L = unit.innerLengthMm;
  const W = unit.innerWidthMm;
  const H = unit.innerHeightMm;

  // A piece that can never fit is reported once per item, with its count,
  // rather than once per piece — a hundred identical refusals is not a hundred
  // problems, it is one.
  const refusedCounts = new Map<
    string,
    { reason: RefusalReason; label: string; count: number }
  >();
  const refuseKind = (kind: Kind, reason: RefusalReason, count: number) => {
    const seen = refusedCounts.get(kind.itemId);
    if (seen === undefined)
      refusedCounts.set(kind.itemId, { reason, label: kind.label, count });
    else seen.count += count;
  };

  let totalPieces = 0;
  let totalWeightKg = 0;
  const kinds: Kind[] = [];
  for (const item of items) {
    const quantity = Math.max(0, Math.floor(item.quantity));
    if (quantity === 0) continue;
    totalPieces += quantity;
    totalWeightKg += item.weightKg * quantity;
    const kind: Kind = {
      itemId: item.id,
      label: item.label,
      lengthMm: item.lengthMm,
      widthMm: item.widthMm,
      heightMm: item.heightMm,
      weightKg: item.weightKg,
      rotatable: item.rotatable ?? true,
      remaining: quantity,
    };
    const reason = refuse(kind, unit);
    if (reason !== null) {
      refuseKind(kind, reason, quantity);
      continue;
    }
    kinds.push(kind);
  }

  // Biggest footprint first: the decisions that matter most are made while
  // the unit is still empty and can honour them. Ties by id, so the same
  // input always gives the same plan.
  kinds.sort((a, b) => {
    const areaA = a.lengthMm * a.widthMm;
    const areaB = b.lengthMm * b.widthMm;
    if (areaA !== areaB) return areaB - areaA;
    if (a.heightMm !== b.heightMm) return b.heightMm - a.heightMm;
    return a.itemId.localeCompare(b.itemId);
  });

  const unitVolume = (L / 1000) * (W / 1000) * (H / 1000);
  const units: LoadedUnit[] = [];
  const left = () => kinds.some((kind) => kind.remaining > 0);

  while (left() && units.length < maxUnits) {
    const index = units.length;
    const placements: Placement[] = [];
    let weightKg = 0;
    let rowX = 0;

    const room = (kind: Kind) => weightKg + kind.weightKg <= unit.payloadKg;
    const place = (
      kind: Kind,
      shape: Footprint,
      x: number,
      y: number,
      z: number,
    ) => {
      placements.push({
        itemId: kind.itemId,
        label: kind.label,
        unitIndex: index,
        x,
        y,
        z,
        lengthMm: shape.lengthMm,
        widthMm: shape.widthMm,
        heightMm: kind.heightMm,
        weightKg: kind.weightKg,
        rotated: shape.rotated,
      });
      weightKg += kind.weightKg;
      kind.remaining -= 1;
    };

    /**
     * One position on the floor, stacked: as many of the kind as the height
     * and the payload allow, then topped up with anything else that sits
     * within its footprint. Only the short bundle of the same sale line may
     * finish that column. Putting a different product on a smaller footprint
     * leaves an unusable ledge on the supporting bundle and makes the load
     * look compact while wasting real support area.
     */
    const stack = (kind: Kind, shape: Footprint, x: number, y: number) => {
      let z = 0;
      let placed = 0;
      const fitsSupport = (other: Kind, candidate: Footprint) => {
        const sameLine =
          bundleGroupId(other.itemId) === bundleGroupId(kind.itemId);
        return (
          candidate.lengthMm <= shape.lengthMm &&
          candidate.widthMm <= shape.widthMm &&
          (sameLine ||
            (candidate.lengthMm === shape.lengthMm &&
              candidate.widthMm === shape.widthMm))
        );
      };
      while (kind.remaining > 0 && z + kind.heightMm <= H && room(kind)) {
        place(kind, shape, x, y, z);
        z += kind.heightMm;
        placed += 1;
      }
      for (;;) {
        const top = kinds.find(
          (other) =>
            other.remaining > 0 &&
            z + other.heightMm <= H &&
            room(other) &&
            orientations(other).some((o) => fitsSupport(other, o)),
        );
        if (top === undefined) break;
        const fit = orientations(top).find((o) => fitsSupport(top, o));
        if (fit === undefined) break;
        place(top, fit, x, y, z);
        z += top.heightMm;
        placed += 1;
      }
      return placed;
    };

    for (;;) {
      // The row's lead: the biggest thing still waiting that fits what is
      // left of the length.
      let lead: { kind: Kind; shape: Footprint } | null = null;
      for (const kind of kinds) {
        if (kind.remaining === 0 || !room(kind)) continue;
        const shape = orientations(kind).find(
          (o) => rowX + o.lengthMm <= L && o.widthMm <= W,
        );
        if (shape !== undefined) {
          lead = { kind, shape };
          break;
        }
      }
      if (lead === null) break;

      let rowLength = lead.shape.lengthMm;
      let y = 0;
      let placedInRow = stack(lead.kind, lead.shape, rowX, y);
      if (placedInRow === 0) break;
      y += lead.shape.widthMm;

      // Then across: the widest thing that still fits the strip, preferring
      // what sits within the row's depth over what would lengthen it.
      for (;;) {
        let best: { kind: Kind; shape: Footprint; score: number } | null = null;
        for (const kind of kinds) {
          if (kind.remaining === 0 || !room(kind)) continue;
          for (const shape of orientations(kind)) {
            if (y + shape.widthMm > W || rowX + shape.lengthMm > L) continue;
            const within = shape.lengthMm <= rowLength ? 1 : 0;
            const score =
              within * 1e12 +
              shape.widthMm * 1e6 +
              Math.min(shape.lengthMm, rowLength);
            if (best === null || score > best.score)
              best = { kind, shape, score };
          }
        }
        if (best === null) break;
        const placed = stack(best.kind, best.shape, rowX, y);
        if (placed === 0) break;
        placedInRow += placed;
        rowLength = Math.max(rowLength, best.shape.lengthMm);
        y += best.shape.widthMm;
      }

      rowX += rowLength;
      if (placedInRow === 0 || rowX >= L) break;
    }

    if (placements.length === 0) {
      // Nothing could start an empty unit: what is left is over the payload on
      // its own. `refuse` catches that case, so this is a guard, not a path.
      for (const kind of kinds)
        if (kind.remaining > 0) {
          refuseKind(kind, "TOO_HEAVY", kind.remaining);
          kind.remaining = 0;
        }
      break;
    }

    const volumeM3 = placements.reduce(
      (sum, p) =>
        sum + (p.lengthMm / 1000) * (p.widthMm / 1000) * (p.heightMm / 1000),
      0,
    );
    units.push({
      index,
      placements,
      weightKg: Math.round(weightKg * 100) / 100,
      volumeM3: Math.round(volumeM3 * 1000) / 1000,
      volumeUse: unitVolume > 0 ? volumeM3 / unitVolume : 0,
      payloadUse: unit.payloadKg > 0 ? weightKg / unit.payloadKg : 0,
    });
  }

  // Beyond the unit limit, whatever is left is reported rather than dropped.
  for (const kind of kinds)
    if (kind.remaining > 0) refuseKind(kind, "TOO_HEAVY", kind.remaining);

  return {
    units,
    refused: [...refusedCounts].map(([itemId, value]) => ({
      itemId,
      label: value.label,
      quantity: value.count,
      reason: value.reason,
    })),
    totalPieces,
    placedPieces: units.reduce((sum, u) => sum + u.placements.length, 0),
    totalWeightKg: Math.round(totalWeightKg * 100) / 100,
  };
}

/** One step of the loading instruction: a layer, and what goes in it. */
export interface LoadingStep {
  /** Layer number from the floor, starting at 1. */
  readonly layer: number;
  /** Floor height of the layer, in millimetres. */
  readonly floorMm: number;
  /** How many rows deep the layer runs. */
  readonly rows: number;
  readonly pieces: number;
  readonly weightKg: number;
  /** Bundle labels in this layer, with counts, heaviest first. */
  readonly contents: readonly { label: string; count: number }[];
}

/**
 * How the unit is actually loaded, floor upwards.
 *
 * A placement list is a set of coordinates; a loading crew needs an order.
 * Grouping the placements back into layers and rows turns the plan into the
 * instruction it has to be at the door — load this along the floor first, then
 * this on top of it — and it also makes an unbalanced load visible, because a
 * layer that is much heavier than the one under it shows up as a number.
 */
export function describeLoading(loaded: LoadedUnit): readonly LoadingStep[] {
  const byLayer = new Map<number, Placement[]>();
  for (const placement of loaded.placements) {
    const bucket = byLayer.get(placement.z);
    if (bucket) bucket.push(placement);
    else byLayer.set(placement.z, [placement]);
  }
  return [...byLayer.entries()]
    .sort(([a], [b]) => a - b)
    .map(([floorMm, placements], index) => {
      const counts = new Map<string, number>();
      for (const placement of placements) {
        counts.set(placement.label, (counts.get(placement.label) ?? 0) + 1);
      }
      return {
        layer: index + 1,
        floorMm,
        rows: new Set(placements.map((placement) => placement.x)).size,
        pieces: placements.length,
        weightKg:
          Math.round(
            placements.reduce((sum, placement) => sum + placement.weightKg, 0) *
              100,
          ) / 100,
        contents: [...counts]
          .map(([label, count]) => ({ label, count }))
          .sort((a, b) => b.count - a.count),
      };
    });
}
