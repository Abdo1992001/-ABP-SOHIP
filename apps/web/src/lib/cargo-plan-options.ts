import {
  CARGO_CONTAINERS,
  containerByCode,
  type CargoContainer,
} from "./cargo-containers.ts";
import {
  packCargo,
  type CargoItem,
  type LoadedUnit,
  type PackingUnit,
  type Refusal,
} from "./cargo-packing.ts";

/**
 * Which containers to book, and what each one costs in space.
 *
 * The packer answers "how many of THIS container", which is the wrong
 * question at the moment the decision is made. A shipment that needs two
 * forty-foot containers and a half-empty third might travel in two forties
 * and a twenty for less money and a tighter load, and nothing in the system
 * compared the two.
 *
 * Every option here is produced by actually packing the shipment, never by
 * dividing a total volume by a container's volume: boards are rigid and a
 * container is not a bucket, so the only honest count is the one the packer
 * arrives at.
 *
 * Options are ranked by what a shipper actually minimises — units first,
 * because a container costs what it costs whether or not it is full, and then
 * by how well the units that were booked are used.
 */

export type ShipMode = "SEA" | "ROAD";

export interface PlanUnit {
  readonly containerCode: string;
  readonly container: CargoContainer;
  readonly loaded: LoadedUnit;
  /**
   * Boards in this unit. A loader counts boards, not bundles: "how many
   * boards went in that container" is the question asked on the yard and it
   * was only answerable by multiplying bundles by a number kept elsewhere.
   */
  readonly boards: number;
}

/** How many boards a placed piece stands for, by item id. */
export type BoardsPerItem = Readonly<Record<string, number>>;

export interface PlanOption {
  /** Stable id, so a chosen option survives a re-rank. */
  readonly id: string;
  readonly label: string;
  readonly units: readonly PlanUnit[];
  /** How many of each container type this option books. */
  readonly mix: readonly { containerCode: string; count: number }[];
  readonly totalUnits: number;
  readonly totalWeightKg: number;
  /** Weight carried ÷ payload booked, 0–1. */
  readonly payloadUse: number;
  /** Volume filled ÷ volume booked, 0–1. */
  readonly volumeUse: number;
  readonly refused: readonly Refusal[];
  /** Boards across the whole plan. */
  readonly totalBoards: number;
  /** True when every piece found a place. */
  readonly complete: boolean;
  /**
   * Cubic metres of container booked. Two plans can book the same number of
   * units and not cost the same: three forties and two forties plus a twenty
   * are both three units, and the second is the cheaper shipment. Nothing
   * here prices a container -- less capacity booked for the same cargo is
   * simply less to pay for.
   */
  readonly bookedVolumeM3: number;
}

function toPackingUnit(container: CargoContainer): PackingUnit {
  return {
    innerLengthMm: container.innerLengthMm,
    innerWidthMm: container.innerWidthMm,
    innerHeightMm: container.innerHeightMm,
    doorWidthMm: container.doorWidthMm,
    doorHeightMm: container.doorHeightMm,
    payloadKg: container.payloadKg,
  };
}

/** Boards in one loaded unit, from what each placed piece stands for. */
function boardsIn(loaded: LoadedUnit, boardsPerItem: BoardsPerItem): number {
  return loaded.placements.reduce(
    (sum, placement) => sum + (boardsPerItem[placement.itemId] ?? 0),
    0,
  );
}

function summarise(
  id: string,
  label: string,
  units: readonly PlanUnit[],
  refused: readonly Refusal[],
): PlanOption {
  const mixCounts = new Map<string, number>();
  let weight = 0;
  let payloadBooked = 0;
  let volumeFilled = 0;
  let volumeBooked = 0;
  for (const unit of units) {
    mixCounts.set(
      unit.containerCode,
      (mixCounts.get(unit.containerCode) ?? 0) + 1,
    );
    weight += unit.loaded.weightKg;
    payloadBooked += unit.container.payloadKg;
    volumeFilled += unit.loaded.volumeM3;
    volumeBooked +=
      (unit.container.innerLengthMm / 1000) *
      (unit.container.innerWidthMm / 1000) *
      (unit.container.innerHeightMm / 1000);
  }
  return {
    id,
    label,
    units,
    totalBoards: units.reduce((sum, unit) => sum + unit.boards, 0),
    bookedVolumeM3: volumeBooked,
    mix: [...mixCounts.entries()].map(([containerCode, count]) => ({
      containerCode,
      count,
    })),
    totalUnits: units.length,
    totalWeightKg: weight,
    payloadUse: payloadBooked > 0 ? weight / payloadBooked : 0,
    volumeUse: volumeBooked > 0 ? volumeFilled / volumeBooked : 0,
    refused,
    complete: refused.length === 0 && units.length > 0,
  };
}

/** Everything loaded into one type of container. */
function singleTypePlan(
  items: readonly CargoItem[],
  container: CargoContainer,
  boardsPerItem: BoardsPerItem,
): PlanOption | null {
  const result = packCargo(items, toPackingUnit(container));
  if (result.units.length === 0) return null;
  return summarise(
    container.code,
    container.code,
    result.units.map((loaded) => ({
      containerCode: container.code,
      container,
      loaded,
      boards: boardsIn(loaded, boardsPerItem),
    })),
    result.refused,
  );
}

/**
 * Big containers first, then the smallest one that still takes what is left.
 *
 * This is the plan a shipper reaches for by hand: fill forties while they
 * fill, and put the tail in a twenty rather than paying for a forty to carry
 * it. It is only offered when it actually books fewer or cheaper units than
 * the single-type plans, which the ranking decides.
 */
function mixedPlan(
  items: readonly CargoItem[],
  big: CargoContainer,
  small: CargoContainer,
  boardsPerItem: BoardsPerItem,
): PlanOption | null {
  const full = packCargo(items, toPackingUnit(big));
  if (full.units.length < 2) return null;

  // Everything except the last, least-used big unit stays as it is; what was
  // in that one is offered to the small container instead.
  const keep = full.units.slice(0, -1);
  const tail = full.units[full.units.length - 1];
  if (tail === undefined) return null;

  const tailItems = tailAsItems(tail);
  const tailPack = packCargo(tailItems, toPackingUnit(small));
  // A tail that needs more than one small unit is not a saving.
  if (tailPack.units.length !== 1 || tailPack.refused.length > 0) return null;

  const units: PlanUnit[] = [
    ...keep.map((loaded) => ({
      containerCode: big.code,
      container: big,
      loaded,
      boards: boardsIn(loaded, boardsPerItem),
    })),
    ...tailPack.units.map((loaded) => ({
      containerCode: small.code,
      container: small,
      loaded,
      boards: boardsIn(loaded, boardsPerItem),
    })),
  ];
  return summarise(
    `${big.code}+${small.code}`,
    `${big.code} + ${small.code}`,
    units,
    full.refused,
  );
}

/** What a loaded unit is carrying, back as items the packer can re-place. */
function tailAsItems(unit: LoadedUnit): CargoItem[] {
  const byItem = new Map<string, CargoItem>();
  for (const placement of unit.placements) {
    const existing = byItem.get(placement.itemId);
    if (existing !== undefined) {
      byItem.set(placement.itemId, {
        ...existing,
        quantity: existing.quantity + 1,
      });
      continue;
    }
    byItem.set(placement.itemId, {
      id: placement.itemId,
      label: placement.label,
      // Placements carry the orientation as placed; the original footprint is
      // whichever pair it went in as, and the packer may rotate it again.
      lengthMm: placement.lengthMm,
      widthMm: placement.widthMm,
      heightMm: placement.heightMm,
      weightKg: placement.weightKg,
      quantity: 1,
    });
  }
  return [...byItem.values()];
}

export interface PlanOptionsInput {
  readonly items: readonly CargoItem[];
  readonly mode: ShipMode;
  /** Restrict to specific container codes; default is every one for the mode. */
  readonly containerCodes?: readonly string[] | undefined;
  /**
   * How many boards each item stands for, by item id. A loose board is one;
   * a bundle is however many boards were strapped into it.
   */
  readonly boardsPerItem?: BoardsPerItem | undefined;
}

/**
 * Every plan worth putting in front of a person, best first.
 *
 * Ranked by units booked, then by how full those units are. An incomplete
 * plan — one that could not place every piece — always sorts last however
 * few units it uses, because a shipment that leaves boards on the ground is
 * not a cheaper shipment.
 */
export function planOptions(input: PlanOptionsInput): PlanOption[] {
  const candidates = CARGO_CONTAINERS.filter(
    (container) =>
      container.kind === input.mode &&
      (input.containerCodes === undefined ||
        input.containerCodes.includes(container.code)),
  );
  if (candidates.length === 0 || input.items.length === 0) return [];

  const boardsPerItem = input.boardsPerItem ?? {};
  const options: PlanOption[] = [];
  for (const container of candidates) {
    const option = singleTypePlan(input.items, container, boardsPerItem);
    if (option !== null) options.push(option);
  }

  // Pair every larger container with every smaller one, by floor area.
  const area = (c: CargoContainer) => c.innerLengthMm * c.innerWidthMm;
  for (const big of candidates) {
    for (const small of candidates) {
      if (area(small) >= area(big)) continue;
      const option = mixedPlan(input.items, big, small, boardsPerItem);
      if (option !== null) options.push(option);
    }
  }

  return options.sort((left, right) => {
    if (left.complete !== right.complete) return left.complete ? -1 : 1;
    if (left.totalUnits !== right.totalUnits)
      return left.totalUnits - right.totalUnits;
    // Same number of units is not the same shipment: prefer the plan that
    // books less container for the same cargo.
    if (Math.abs(left.bookedVolumeM3 - right.bookedVolumeM3) > 0.5)
      return left.bookedVolumeM3 - right.bookedVolumeM3;
    return right.payloadUse - left.payloadUse;
  });
}

/** The option a person would pick unless they had a reason not to. */
export function recommendedOption(options: readonly PlanOption[]) {
  return options.find((option) => option.complete) ?? options[0] ?? null;
}

/** The container a code names, for rendering a plan. */
export { containerByCode };

/**
 * How the boards travel.
 *
 * On the road ABP loads either loose boards or made-up bundles, and the
 * choice changes what fits: a bundle is a single rigid block that cannot be
 * split across a layer, while loose boards fill whatever space is left. The
 * planner has to be told which, because the answer differs.
 */
export type LoadForm = "BOARDS" | "BUNDLES";

export interface BoardSpec {
  readonly label: string;
  readonly lengthMm: number;
  readonly widthMm: number;
  readonly thicknessMm: number;
  readonly weightKg: number;
}

/**
 * The cargo items for a shipment of `count` boards, in the chosen form.
 *
 * Loose boards are one item per board: the packer stacks them itself and is
 * free to use every millimetre of height. Bundles are pre-made blocks of
 * `boardsPerBundle`, which is how they leave the factory strapped.
 */
export function boardsAsItems(
  board: BoardSpec,
  count: number,
  form: LoadForm,
  bundle: { boardsPerBundle: number; baseHeightMm: number } = {
    boardsPerBundle: 35,
    baseHeightMm: 100,
  },
): { items: CargoItem[]; boardsPerItem: Record<string, number> } {
  if (count <= 0) return { items: [], boardsPerItem: {} };
  if (form === "BOARDS")
    return {
      items: [
        {
          id: "board",
          label: board.label,
          lengthMm: board.lengthMm,
          widthMm: board.widthMm,
          heightMm: board.thicknessMm,
          weightKg: board.weightKg,
          quantity: count,
        },
      ],
      boardsPerItem: { board: 1 },
    };

  const per = Math.max(1, Math.floor(bundle.boardsPerBundle));
  const whole = Math.floor(count / per);
  const remainder = count % per;
  const asBundle = (boards: number, id: string): CargoItem => ({
    id,
    label: `${board.label} — ${String(boards)} boards`,
    lengthMm: board.lengthMm,
    widthMm: board.widthMm,
    heightMm: boards * board.thicknessMm + bundle.baseHeightMm,
    weightKg: boards * board.weightKg,
    quantity: 1,
  });
  const items: CargoItem[] = [];
  const boardsPerItem: Record<string, number> = {};
  if (whole > 0) {
    items.push({ ...asBundle(per, "bundle"), quantity: whole });
    boardsPerItem["bundle"] = per;
  }
  // The tail travels as a short bundle rather than being rounded away.
  if (remainder > 0) {
    items.push(asBundle(remainder, "bundle-tail"));
    boardsPerItem["bundle-tail"] = remainder;
  }
  return { items, boardsPerItem };
}
