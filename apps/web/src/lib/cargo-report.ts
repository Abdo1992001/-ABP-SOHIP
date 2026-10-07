/**
 * What a customer is sent about a load.
 *
 * The 3-D view answers "does this look loadable" for the person planning it.
 * A customer needs a different thing: a document, per container, saying what is
 * in it, how heavy it is, and what it looks like from each side — because the
 * person receiving it will stand at one end of a container with a phone and
 * have to recognise what they are looking at.
 *
 * Two decisions live here rather than in the view, because both are arithmetic
 * that has to be right and neither needs a camera:
 *
 *   - **The four views.** Front, back and both sides, each square on to a face
 *     with nothing in perspective, so a picture can be compared to the real
 *     thing rather than admired. The viewpoint distance comes from the unit's
 *     own size so a 13.6 m trailer and a 4 m box both fill their frame.
 *   - **The manifest.** One row per product per container, with the boards,
 *     the pieces and the weight in that container — not in the shipment. A
 *     shipment-level table is what a customer already has; what they cannot
 *     work out for themselves is which container their boards are in.
 */

import type { LoadedUnit, PackingUnit, Placement } from "./cargo-packing.ts";

export type ViewName = "FRONT" | "REAR" | "LEFT" | "RIGHT" | "PLAN";

export interface ReportView {
  readonly name: ViewName;
  /** Where the camera stands, in metres, in the scene's own axes. */
  readonly position: readonly [number, number, number];
  /** What it looks at. */
  readonly target: readonly [number, number, number];
  /**
   * Which way is up in the picture. Every view but the plan takes the world's
   * own up; looking straight down, that is the direction being looked along,
   * so the plan has to say which way it wants the container to run.
   */
  readonly up: readonly [number, number, number];
}

const MM = 0.001;

/**
 * The four square-on viewpoints for one unit.
 *
 * The camera stands off by the largest dimension it has to see across, times a
 * margin, so nothing is clipped and the load is not lost in the middle of an
 * empty frame. Height is half the unit's, which puts the horizon through the
 * middle of the load rather than looking down on it.
 */
export function reportViews(unit: PackingUnit, margin = 1.35): ReportView[] {
  const l = unit.innerLengthMm * MM;
  const w = unit.innerWidthMm * MM;
  const h = unit.innerHeightMm * MM;
  const target: [number, number, number] = [0, h / 2, 0];
  // Along the length you are looking across the width and the height; from the
  // side you are looking across the length. Each stand-off is set by the face
  // it has to fit in frame.
  //
  // The end views take whichever is larger of two distances, and the second one
  // is why: standing only far enough to frame the end wall puts that wall a few
  // metres from the lens, where perspective blows the nearest bundle up until
  // it runs off the picture — which is what the first report actually did.
  // Backing off by most of the container's own length makes the load recede
  // down a tube instead, which is what a person sees standing at the doors.
  const endStand = Math.max(l * 0.9, Math.max(w, h) * margin + l / 2);
  // A side view has to fit the whole container lengthways, and the near wall is
  // the plane where it looks longest. Standing off by the length itself and
  // then clearing that wall leaves room on both sides; the earlier figure was
  // three centimetres short, which clipped the near end off every side shot.
  const sideStand = Math.max(l * 1.05, h * 2.2) + w / 2;
  // From above, the length has to fit across a frame that is wider than it is
  // tall, and the camera has to clear the roof before any of that matters.
  const planStand = Math.max(l * 0.95, w * 1.9) + h;
  const up = [0, 1, 0] as const;
  return [
    { name: "FRONT", position: [endStand, h / 2, 0], target, up },
    { name: "REAR", position: [-endStand, h / 2, 0], target, up },
    { name: "LEFT", position: [0, h / 2, sideStand], target, up },
    { name: "RIGHT", position: [0, h / 2, -sideStand], target, up },
    // Up is minus Z so the container runs left to right across the picture.
    { name: "PLAN", position: [0, planStand, 0], target, up: [0, 0, -1] },
  ];
}

export interface ManifestRow {
  /** The group this product belongs to, so the view can colour the row. */
  readonly itemId: string;
  readonly description: string;
  /** Pieces in this container: bundles in a banded load, boards in a loose one. */
  readonly pieces: number;
  /** Boards in this container, when the caller can say how many a piece holds. */
  readonly boards: number | null;
  readonly weightKg: number;
  /** This product's share of what the container is carrying, 0 to 1. */
  readonly weightShare: number;
}

export interface ContainerManifest {
  /** One-based, as a customer counts containers. */
  readonly number: number;
  readonly rows: ManifestRow[];
  readonly pieces: number;
  readonly boards: number | null;
  readonly weightKg: number;
  readonly payloadUse: number;
  readonly volumeUse: number;
}

export interface ManifestOptions {
  /**
   * How many boards one placement stands for. A banded load knows this; a
   * loose one is one board a piece. When nothing is known the boards column is
   * left out rather than guessed at.
   */
  readonly boardsIn?: (placement: Placement) => number | null;
  /** Which placements are the same product; a short bundle is not its own. */
  readonly groupKey?: (itemId: string) => string;
}

/** What is in one container, product by product. */
export function containerManifest(
  loaded: LoadedUnit,
  unit: PackingUnit,
  index: number,
  options: ManifestOptions = {},
): ContainerManifest {
  const groupKey = options.groupKey ?? ((itemId: string) => itemId);
  const boardsIn = options.boardsIn ?? (() => null);

  const byProduct = new Map<
    string,
    {
      description: string;
      pieces: number;
      boards: number | null;
      weightKg: number;
    }
  >();
  const fresh = (description: string) => ({
    description,
    pieces: 0,
    boards: 0,
    weightKg: 0,
  });
  for (const placement of loaded.placements) {
    const key = groupKey(placement.itemId);
    const row = byProduct.get(key) ?? fresh(placement.label);
    const boards = boardsIn(placement);
    byProduct.set(key, {
      description: row.description,
      pieces: row.pieces + 1,
      // One unknown makes the whole row unknown: a partial count printed as a
      // total is worse than a blank.
      boards:
        row.boards === null || boards === null ? null : row.boards + boards,
      weightKg: row.weightKg + placement.weightKg,
    });
  }

  const total = loaded.weightKg;
  const rows: ManifestRow[] = [...byProduct].map(([itemId, row]) => ({
    itemId,
    description: row.description,
    pieces: row.pieces,
    boards: row.boards,
    weightKg: row.weightKg,
    weightShare: total > 0 ? row.weightKg / total : 0,
  }));
  rows.sort((a, b) => b.weightKg - a.weightKg);

  const boards = rows.reduce<number | null>(
    (sum, row) =>
      sum === null || row.boards === null ? null : sum + row.boards,
    0,
  );
  return {
    number: index + 1,
    rows,
    pieces: rows.reduce((sum, row) => sum + row.pieces, 0),
    boards,
    weightKg: total,
    payloadUse: unit.payloadKg > 0 ? total / unit.payloadKg : 0,
    volumeUse: loaded.volumeUse,
  };
}
