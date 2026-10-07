/**
 * The order a crew actually puts the load in.
 *
 * A placement list is a set of coordinates, and drawing them in that order
 * plays a demo where bundles appear in the middle of the air and the floor
 * fills in afterwards. Nobody loads a container that way, so nobody watching
 * would believe it.
 *
 * The order here is the one a crew works in, and each rule is a physical
 * constraint rather than a preference:
 *
 *   - **Floor first.** You cannot stand a bundle on air, so a whole layer goes
 *     in before anything rests on it.
 *   - **Nose first.** You load from the far end back towards the doors,
 *     because the last thing in has to be the thing nearest the way out.
 *   - **Then across.** Within one row, side to side, which is the only freedom
 *     left once the other two are settled.
 */

import type { LoadedUnit, Placement } from "./cargo-packing.ts";

/** Every placement, in the order it goes in. */
export function loadingOrder(loaded: LoadedUnit): Placement[] {
  return [...loaded.placements].sort(
    (a, b) => a.z - b.z || a.x - b.x || a.y - b.y,
  );
}

export interface DemoFrame {
  /** How many pieces are in at this point. */
  readonly placed: number;
  /** The piece that just went in, or null at the very start. */
  readonly piece: Placement | null;
  /** Layers are what a crew counts, so the demo counts them too. */
  readonly layer: number;
  readonly weightKg: number;
}

/**
 * The running state after each piece, so a demo can caption itself.
 *
 * It is a list rather than a function of time: the playback can be scrubbed,
 * paused and replayed, and recomputing the running weight on every animation
 * frame for a four-hundred-piece load is work done sixty times a second for an
 * answer that never changes.
 */
export function demoFrames(loaded: LoadedUnit): DemoFrame[] {
  const order = loadingOrder(loaded);
  const floors = [...new Set(order.map((piece) => piece.z))].sort(
    (a, b) => a - b,
  );
  const frames: DemoFrame[] = [
    { placed: 0, piece: null, layer: 0, weightKg: 0 },
  ];
  let weightKg = 0;
  order.forEach((piece, index) => {
    weightKg += piece.weightKg;
    frames.push({
      placed: index + 1,
      piece,
      layer: floors.indexOf(piece.z) + 1,
      weightKg,
    });
  });
  return frames;
}
