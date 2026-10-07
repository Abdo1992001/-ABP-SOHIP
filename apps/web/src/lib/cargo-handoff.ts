/**
 * The Cargo Loader's last plan for a quotation, handed to the shipment
 * planner: the loader works out how many 40 ft, 20 ft and road units an
 * order fills, and planning that order's shipment should not mean typing the
 * answer in again. Kept in this browser session only.
 */

export interface CargoHandoff {
  quotationId: string;
  units: {
    typeCode: "CONTAINER_40" | "CONTAINER_20" | "TRUCK";
    count: number;
  }[];
  totalWeightKg: number;
  savedAt: string;
}

const key = (quotationId: string) => `abp.cargo-plan.${quotationId}`;

/** ABP40 / ABP20 are sea containers; jumbos and trailers travel by road. */
export function unitTypeOf(
  containerCode: string,
): CargoHandoff["units"][number]["typeCode"] {
  if (/40/.test(containerCode)) return "CONTAINER_40";
  if (/20/.test(containerCode)) return "CONTAINER_20";
  return "TRUCK";
}

export function rememberCargoPlan(
  quotationId: string,
  units: readonly { containerCode: string }[],
  totalWeightKg: number,
) {
  const counts = new Map<CargoHandoff["units"][number]["typeCode"], number>();
  for (const unit of units) {
    const type = unitTypeOf(unit.containerCode);
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  const value: CargoHandoff = {
    quotationId,
    units: [...counts.entries()].map(([typeCode, count]) => ({
      typeCode,
      count,
    })),
    totalWeightKg: Math.round(totalWeightKg),
    savedAt: new Date().toISOString(),
  };
  try {
    window.sessionStorage.setItem(key(quotationId), JSON.stringify(value));
  } catch {
    // Private windows refuse storage; the planner simply starts empty.
  }
}

export function recallCargoPlan(quotationId: string): CargoHandoff | null {
  try {
    const raw = window.sessionStorage.getItem(key(quotationId));
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as CargoHandoff;
    return parsed.quotationId === quotationId ? parsed : null;
  } catch {
    return null;
  }
}
