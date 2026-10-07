import {
  bundleHeightMm,
  bundleWeightKg,
  type BundleGroup,
  type BundlingSettings,
} from "./cargo-bundling.ts";
import {
  packCargo,
  type CargoItem,
  type LoadedUnit,
  type PackingResult,
  type PackingUnit,
} from "./cargo-packing.ts";

/** How the boards travel: banded bundles, or board by board. */
export type LoadForm = "BUNDLES" | "BOARDS";

/**
 * What the packer is given, in the form the load is made up in.
 *
 * Loose: one board is one piece, at its own thickness and its net weight —
 * there is no banding on it, so there is no packing allowance either. Banded:
 * one block per full bundle plus a short one for the remainder, each carrying
 * its bearers, its strapping and the height they add.
 */
export function cargoItems(
  groups: readonly BundleGroup[],
  bundling: BundlingSettings,
  form: LoadForm,
): CargoItem[] {
  return groups.flatMap((group) => {
    if (form === "BOARDS")
      return group.boardsTotal > 0
        ? [
            {
              id: group.itemId,
              label: group.description,
              lengthMm: group.lengthMm,
              widthMm: group.widthMm,
              heightMm: group.thicknessMm,
              weightKg: group.unitWeightKg,
              quantity: group.boardsTotal,
            },
          ]
        : [];

    const pieces: CargoItem[] = [];
    if (group.fullBundles > 0) {
      pieces.push({
        id: group.itemId,
        label: group.description,
        lengthMm: group.lengthMm,
        widthMm: group.widthMm,
        heightMm: group.fullBundleHeightMm,
        weightKg: group.fullBundleWeightKg,
        quantity: group.fullBundles,
      });
    }
    // The short bundle is a different box, so it is its own piece: folding it
    // into the full ones would overstate the height of the stack.
    if (group.remainderBoards > 0) {
      pieces.push({
        id: `${group.itemId}~rest`,
        label: group.description,
        lengthMm: group.lengthMm,
        widthMm: group.widthMm,
        heightMm: bundleHeightMm(
          group.remainderBoards,
          group.thicknessMm,
          bundling,
        ),
        weightKg: bundleWeightKg(
          group.remainderBoards,
          group.unitWeightKg,
          bundling,
        ),
        quantity: 1,
      });
    }
    return pieces;
  });
}

/**
 * Bundles sized to stack in whole layers in the container they are going in.
 *
 * ABP's boxes are 1,800 mm high inside and a bundle may be up to 1,100 mm. A
 * bundle of 15 mm boards closed on weight at 57 boards is 955 mm: two of them
 * are 1,910 mm, one more than the box, so every one of them travelled a layer
 * on its own with 845 mm of air above it. Capping the height at what divides
 * the box -- two layers of up to 900 mm here -- makes the same boards two
 * bundles high. The setting stays the upper limit; this only ever lowers it.
 */
export function fitBundling(
  bundling: BundlingSettings,
  innerHeightMm: number,
): BundlingSettings {
  if (!(innerHeightMm > 0) || !(bundling.maxBundleHeightMm > 0))
    return bundling;
  const layers = Math.max(
    1,
    Math.ceil(innerHeightMm / bundling.maxBundleHeightMm),
  );
  const fitted = Math.floor(innerHeightMm / layers);
  return fitted < bundling.maxBundleHeightMm
    ? { ...bundling, maxBundleHeightMm: fitted }
    : bundling;
}

/** A container type as the fleet planner sees it. */
export interface FleetUnit {
  readonly code: string;
  readonly unit: PackingUnit;
}

/** A loaded unit that knows which container it is. */
export interface FleetLoadedUnit extends LoadedUnit {
  readonly containerCode: string;
  readonly unit: PackingUnit;
}

/** "7 × 40 ft + 1 × 20 ft": what a plan books, in the order it books it. */
export function fleetSummary(
  units: readonly { readonly containerCode?: string | undefined }[],
  nameOf: (code: string) => string,
): string {
  const counts = new Map<string, number>();
  for (const loaded of units) {
    const code = loaded.containerCode ?? "";
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return [...counts]
    .map(([code, count]) => `${String(count)} × ${nameOf(code)}`)
    .join(" + ");
}

export interface FleetResult extends Omit<PackingResult, "units"> {
  readonly units: readonly FleetLoadedUnit[];
}

/** What is still waiting after some loaded units, back as packable items. */
function contentsLeft(
  loaded: readonly LoadedUnit[],
  items: readonly CargoItem[],
): CargoItem[] {
  const counts = new Map<string, number>();
  for (const unit of loaded)
    for (const placement of unit.placements)
      counts.set(placement.itemId, (counts.get(placement.itemId) ?? 0) + 1);
  return items
    .map((item) => ({
      ...item,
      quantity: Math.max(0, item.quantity - (counts.get(item.id) ?? 0)),
    }))
    .filter((item) => item.quantity > 0);
}

/**
 * Find the best genuine mix of large and small containers.
 *
 * The old planner tried one case only: replace the last forty with exactly one
 * twenty. If the tail needed two twenties, the screen hid Mix completely even
 * though "five forties plus two twenties" was a valid booking. Here every
 * useful count of large containers is tried; whatever remains is repacked into
 * as many small containers as it physically needs. The best genuine mix is
 * the one with the fewest total containers, then the least booked volume.
 */
export function packFleet(
  items: readonly CargoItem[],
  big: FleetUnit,
  small: FleetUnit | null,
): FleetResult {
  const tag = (result: PackingResult, fleet: FleetUnit, from: number) =>
    result.units.map((loaded, i) => ({
      ...loaded,
      index: from + i,
      placements: loaded.placements.map((p) => ({ ...p, unitIndex: from + i })),
      containerCode: fleet.code,
      unit: fleet.unit,
    }));

  const full = packCargo(items, big.unit);
  const all = tag(full, big, 0);
  if (small === null || full.units.length < 2) return { ...full, units: all };

  const candidates: FleetResult[] = [];
  for (let bigCount = 1; bigCount < full.units.length; bigCount += 1) {
    const head = packCargo(items, big.unit, { maxUnits: bigCount });
    const remaining = contentsLeft(head.units, items);
    const tail = packCargo(remaining, small.unit);
    if (tail.refused.length > 0 || tail.units.length === 0) continue;
    const bigUnits = tag(head, big, 0);
    const smallUnits = tag(tail, small, bigUnits.length);
    const units = [...bigUnits, ...smallUnits];
    candidates.push({
      units,
      refused: [],
      totalPieces: full.totalPieces,
      placedPieces: units.reduce(
        (sum, unit) => sum + unit.placements.length,
        0,
      ),
      totalWeightKg: full.totalWeightKg,
    });
  }

  const bookedVolume = (result: FleetResult) =>
    result.units.reduce(
      (sum, loaded) =>
        sum +
        (loaded.unit.innerLengthMm *
          loaded.unit.innerWidthMm *
          loaded.unit.innerHeightMm) /
          1e9,
      0,
    );
  const best = candidates.sort(
    (a, b) =>
      a.units.length - b.units.length || bookedVolume(a) - bookedVolume(b),
  )[0];
  return best ?? { ...full, units: all };
}
