export interface LoadLine {
  id: string;
  qty: number;
  length: number;
  width: number;
  thickness: number;
  weight: number;
}
export interface LoadUnit {
  id: string;
  length: number;
  width: number;
  height: number;
  maxWeight: number;
}
export interface Placement {
  lineId: string;
  unitId: string;
  x: number;
  y: number;
  z: number;
  length: number;
  width: number;
  height: number;
  rotation: 0 | 90;
  stackQty: number;
}

export function planFlatOnFace(
  lines: readonly LoadLine[],
  units: readonly LoadUnit[],
) {
  const placements: Placement[] = [];
  const remaining = new Map(lines.map((l) => [l.id, l.qty]));
  for (const unit of units) {
    let x = 0,
      y = 0,
      rowDepth = 0,
      weight = 0;
    for (const line of [...lines].sort(
      (a, b) =>
        b.length * b.width - a.length * a.width || a.id.localeCompare(b.id),
    )) {
      let left = remaining.get(line.id) ?? 0;
      while (left > 0) {
        const rotations: Array<{ r: 0 | 90; l: number; w: number }> = [
          { r: 0, l: line.length, w: line.width },
          { r: 90, l: line.width, w: line.length },
        ];
        let fit = rotations.find(
          (o) => x + o.l <= unit.length && y + o.w <= unit.width,
        );
        if (!fit) {
          x = 0;
          y += rowDepth;
          rowDepth = 0;
          fit = rotations.find(
            (o) => o.l <= unit.length && y + o.w <= unit.width,
          );
        }
        if (!fit) break;
        const byHeight = Math.floor(unit.height / line.thickness);
        const byWeight =
          line.weight > 0
            ? Math.floor((unit.maxWeight - weight) / line.weight)
            : left;
        const stack = Math.min(left, byHeight, byWeight);
        if (stack <= 0) break;
        placements.push({
          lineId: line.id,
          unitId: unit.id,
          x,
          y,
          z: 0,
          length: fit.l,
          width: fit.w,
          height: line.thickness * stack,
          rotation: fit.r,
          stackQty: stack,
        });
        weight += line.weight * stack;
        left -= stack;
        remaining.set(line.id, left);
        x += fit.l;
        rowDepth = Math.max(rowDepth, fit.w);
      }
    }
  }
  return {
    placements,
    remaining: [...remaining.values()].reduce((a, b) => a + b, 0),
    loaded: placements.reduce((a, p) => a + p.stackQty, 0),
  };
}

export function validatePlacements(
  placements: readonly Placement[],
  units: readonly LoadUnit[],
) {
  const errors: string[] = [];
  const byId = new Map(units.map((u) => [u.id, u]));
  for (const p of placements) {
    const u = byId.get(p.unitId);
    if (
      !u ||
      p.x < 0 ||
      p.y < 0 ||
      p.z < 0 ||
      p.x + p.length > u.length ||
      p.y + p.width > u.width ||
      p.z + p.height > u.height
    )
      errors.push("PLACEMENT_OUT_OF_BOUNDS");
    if (p.rotation !== 0 && p.rotation !== 90) errors.push("INVALID_ROTATION");
  }
  for (let i = 0; i < placements.length; i++)
    for (let j = i + 1; j < placements.length; j++) {
      const a = placements[i]!,
        b = placements[j]!;
      if (
        a.unitId === b.unitId &&
        a.x < b.x + b.length &&
        b.x < a.x + a.length &&
        a.y < b.y + b.width &&
        b.y < a.y + a.width &&
        a.z < b.z + b.height &&
        b.z < a.z + a.height
      )
        errors.push("PLACEMENT_OVERLAP");
    }
  return [...new Set(errors)];
}
