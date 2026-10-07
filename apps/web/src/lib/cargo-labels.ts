/**
 * Where a stack's description gets written.
 *
 * A loading crew reads a container off the markings on the bundles, not off a
 * table on a screen, so the 3-D view writes each product's description onto the
 * stack itself. Four rules keep that legible instead of noisy, and all four are
 * why this is arithmetic in its own module rather than a line inside the scene:
 *
 *   - **One marking per stack, not per bundle.** Bundles of the same product
 *     standing on each other carry one tag in a yard, and they carry one here,
 *     so a column of six does not repeat the same sentence six times.
 *   - **A stack is contiguous.** Two bundles of the same product at the same
 *     footprint but with air between them are two stacks; merging them would
 *     float a label over the gap.
 *   - **Only faces big enough to read.** A face shorter than the minimum gets
 *     no marking at all: text shrunk onto an 18 mm board edge is a smudge, and
 *     a smudge is worse than a blank.
 *   - **Only faces something can see.** A face pressed against the next stack
 *     is not marked. Drawing it anyway puts the tag inside the neighbouring
 *     bundle, where it shows through as half a sentence running off an edge —
 *     which is what the browser showed the first time this ran.
 *
 * The tag's size is settled here too, rather than in the scene, because it is
 * what decides whether a neighbour covers it.
 *
 * Everything stays in the packer's millimetres. The scene converts once, where
 * it converts everything else.
 */

import type { Placement } from "./cargo-packing.ts";

/**
 * Which way a face looks, in the packer's axes: x along, y across, z up.
 *
 * Five, not four. A container gets read from above as often as from the side —
 * off a gantry, off the plan view, off a photograph taken looking down — and a
 * stack with a blank top is one nobody can identify from up there.
 */
export type LabelFacing =
  "WIDTH_PLUS" | "WIDTH_MINUS" | "LENGTH_PLUS" | "LENGTH_MINUS" | "TOP";

export interface LabelFace {
  readonly key: string;
  /** The stack's lowest bundle, which carries the description for all of them. */
  readonly placement: Placement;
  readonly facing: LabelFacing;
  /** Centre of the face, in millimetres, in the packer's own coordinates. */
  readonly centreXMm: number;
  readonly centreYMm: number;
  readonly centreZMm: number;
  /** Across the face, in millimetres. */
  readonly faceWidthMm: number;
  /**
   * The other way across the face. On a side it is the whole stack's height,
   * not one bundle's; on the top it is how wide the stack is.
   */
  readonly faceHeightMm: number;
  /** The tag itself, centred on the face. */
  readonly tagWidthMm: number;
  readonly tagHeightMm: number;
}

export interface LabelFacesOptions {
  /** The tag's width over its height, fixed by the canvas the scene draws. */
  readonly tagAspect?: number;
  /** How much of a face's height and width a tag may take. */
  readonly tagHeightShare?: number;
  readonly tagWidthShare?: number;
  /** Smallest tag worth drawing. Below this it is a smudge, not a marking. */
  readonly minTagHeightMm?: number;
  /**
   * Mark every physical bundle separately, including bundles of the same
   * product stacked directly on one another. The cargo scene enables this so
   * the drawing remains a loading instruction, not a decorative solid block.
   */
  readonly onePerBundle?: boolean;
  /**
   * Which placements count as the same product. The loader gives a group's
   * short bundle its own item id, and a short bundle on top of full ones is
   * still one stack of one product.
   */
  readonly groupKey?: (itemId: string) => string;
}

interface Stack {
  readonly placement: Placement;
  readonly bottomMm: number;
  topMm: number;
}

/** Two bundles touching are never further apart than this. */
const TOUCHING_MM = 5;

function overlaps(
  aFrom: number,
  aTo: number,
  bFrom: number,
  bTo: number,
): boolean {
  return aFrom < bTo && bFrom < aTo;
}

export function labelFaces(
  placements: readonly Placement[],
  options: LabelFacesOptions = {},
): LabelFace[] {
  const tagAspect = options.tagAspect ?? 2;
  const heightShare = options.tagHeightShare ?? 0.46;
  const widthShare = options.tagWidthShare ?? 0.84;
  const minTagHeightMm = options.minTagHeightMm ?? 55;
  const onePerBundle = options.onePerBundle ?? false;
  const groupKey = options.groupKey ?? ((itemId: string) => itemId);

  // Bottom up, so each footprint's stacks close in the order they were built.
  const byFootprint = new Map<string, Stack[]>();
  for (const placement of [...placements].sort((a, b) => a.z - b.z)) {
    const footprint = [
      groupKey(placement.itemId),
      placement.x,
      placement.y,
      placement.lengthMm,
      placement.widthMm,
    ].join("|");
    const stacks = byFootprint.get(footprint) ?? [];
    const open = stacks[stacks.length - 1];
    const top = placement.z + placement.heightMm;
    // A millimetre of tolerance: a packer that rounds is still stacking.
    if (!onePerBundle && open !== undefined && placement.z <= open.topMm + 1) {
      open.topMm = Math.max(open.topMm, top);
    } else {
      stacks.push({ placement, bottomMm: placement.z, topMm: top });
    }
    byFootprint.set(footprint, stacks);
  }

  /**
   * Is anything pressed against this face, over the patch the tag would take?
   *
   * `alongFrom`/`alongTo` and `upFrom`/`upTo` are the tag's own rectangle on the
   * face; a neighbour only hides the marking if it covers part of that, not if
   * it merely touches a corner of the face.
   */
  const covered = (
    facing: Exclude<LabelFacing, "TOP">,
    planeMm: number,
    alongFrom: number,
    alongTo: number,
    upFrom: number,
    upTo: number,
    self: Placement,
  ): boolean =>
    placements.some((other) => {
      if (other === self) return false;
      const touchesPlane =
        facing === "WIDTH_PLUS"
          ? Math.abs(other.y - planeMm) <= TOUCHING_MM
          : facing === "WIDTH_MINUS"
            ? Math.abs(other.y + other.widthMm - planeMm) <= TOUCHING_MM
            : facing === "LENGTH_PLUS"
              ? Math.abs(other.x - planeMm) <= TOUCHING_MM
              : Math.abs(other.x + other.lengthMm - planeMm) <= TOUCHING_MM;
      if (!touchesPlane) return false;
      const alongOther =
        facing === "WIDTH_PLUS" || facing === "WIDTH_MINUS"
          ? ([other.x, other.x + other.lengthMm] as const)
          : ([other.y, other.y + other.widthMm] as const);
      return (
        overlaps(alongFrom, alongTo, alongOther[0], alongOther[1]) &&
        overlaps(upFrom, upTo, other.z, other.z + other.heightMm)
      );
    });

  const faces: LabelFace[] = [];
  for (const [footprint, stacks] of byFootprint) {
    stacks.forEach((stack, index) => {
      const faceHeightMm = stack.topMm - stack.bottomMm;
      const at = stack.placement;
      const centreZMm = (stack.bottomMm + stack.topMm) / 2;
      const sides: {
        facing: Exclude<LabelFacing, "TOP">;
        xMm: number;
        yMm: number;
        planeMm: number;
        alongCentreMm: number;
        widthMm: number;
      }[] = [
        {
          facing: "WIDTH_PLUS",
          xMm: at.x + at.lengthMm / 2,
          yMm: at.y + at.widthMm,
          planeMm: at.y + at.widthMm,
          alongCentreMm: at.x + at.lengthMm / 2,
          widthMm: at.lengthMm,
        },
        {
          facing: "WIDTH_MINUS",
          xMm: at.x + at.lengthMm / 2,
          yMm: at.y,
          planeMm: at.y,
          alongCentreMm: at.x + at.lengthMm / 2,
          widthMm: at.lengthMm,
        },
        {
          facing: "LENGTH_PLUS",
          xMm: at.x + at.lengthMm,
          yMm: at.y + at.widthMm / 2,
          planeMm: at.x + at.lengthMm,
          alongCentreMm: at.y + at.widthMm / 2,
          widthMm: at.widthMm,
        },
        {
          facing: "LENGTH_MINUS",
          xMm: at.x,
          yMm: at.y + at.widthMm / 2,
          planeMm: at.x,
          alongCentreMm: at.y + at.widthMm / 2,
          widthMm: at.widthMm,
        },
      ];
      // Anything standing on this stack hides its top, and a marking drawn
      // under a bundle is a marking inside it.
      const buried = placements.some(
        (other) =>
          other !== at &&
          Math.abs(other.z - stack.topMm) <= TOUCHING_MM &&
          overlaps(
            at.x,
            at.x + at.lengthMm,
            other.x,
            other.x + other.lengthMm,
          ) &&
          overlaps(at.y, at.y + at.widthMm, other.y, other.y + other.widthMm),
      );
      if (!buried) {
        const topTagHeightMm = Math.min(
          at.widthMm * heightShare,
          (at.lengthMm * widthShare) / tagAspect,
        );
        if (topTagHeightMm >= minTagHeightMm)
          faces.push({
            key: `${footprint}#${String(index)}#TOP`,
            placement: at,
            facing: "TOP",
            centreXMm: at.x + at.lengthMm / 2,
            centreYMm: at.y + at.widthMm / 2,
            centreZMm: stack.topMm,
            faceWidthMm: at.lengthMm,
            faceHeightMm: at.widthMm,
            tagWidthMm: topTagHeightMm * tagAspect,
            tagHeightMm: topTagHeightMm,
          });
      }

      for (const side of sides) {
        const tagHeightMm = Math.min(
          faceHeightMm * heightShare,
          (side.widthMm * widthShare) / tagAspect,
        );
        if (tagHeightMm < minTagHeightMm) continue;
        const tagWidthMm = tagHeightMm * tagAspect;
        if (
          covered(
            side.facing,
            side.planeMm,
            side.alongCentreMm - tagWidthMm / 2,
            side.alongCentreMm + tagWidthMm / 2,
            centreZMm - tagHeightMm / 2,
            centreZMm + tagHeightMm / 2,
            at,
          )
        )
          continue;
        faces.push({
          key: `${footprint}#${String(index)}#${side.facing}`,
          placement: at,
          facing: side.facing,
          centreXMm: side.xMm,
          centreYMm: side.yMm,
          centreZMm,
          faceWidthMm: side.widthMm,
          faceHeightMm,
          tagWidthMm,
          tagHeightMm,
        });
      }
    });
  }
  return faces;
}
