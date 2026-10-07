/**
 * The milestones a shipment runs through, by how it travels. Pure, so the
 * route is tested without Nest.
 *
 * A truck from the factory to site has nothing between leaving and arriving
 * that anybody records; a sea container has the vessel's departure and its
 * arrival at the port of discharge. Both end the same way: the customer takes
 * delivery, and signs for it.
 */

export const TRANSPORT_MODES = ["LOCAL_TRUCK", "SEA_CONTAINER"] as const;
export type TransportMode = (typeof TRANSPORT_MODES)[number];

export const LOAD_UNIT_TYPES = [
  "CONTAINER_40",
  "CONTAINER_20",
  "TRUCK",
] as const;

export const DELIVERY_CONDITIONS = [
  "GOOD",
  "DAMAGED",
  "SHORT",
  "REFUSED",
] as const;

const ROUTES: Record<TransportMode, readonly string[]> = {
  LOCAL_TRUCK: ["READY_FOR_DELIVERY", "SHIPPED", "DELIVERED", "POD_RECEIVED"],
  SEA_CONTAINER: [
    "READY_FOR_DELIVERY",
    "SHIPPED",
    "VESSEL_DEPARTED",
    "ARRIVED_AT_PORT_OF_DISCHARGE",
    "DELIVERED",
    "POD_RECEIVED",
  ],
};

export function isTransportMode(value: string): value is TransportMode {
  return (TRANSPORT_MODES as readonly string[]).includes(value);
}

export function routeOf(mode: string): readonly string[] {
  return isTransportMode(mode) ? ROUTES[mode] : ROUTES.SEA_CONTAINER;
}

/** The milestone that comes after `current`, or null at the end of the route. */
export function nextMilestone(mode: string, current: string): string | null {
  const route = routeOf(mode);
  const at = route.indexOf(current);
  return at < 0 ? null : (route[at + 1] ?? null);
}

/** Moving to `to` is the next step on this shipment's route. */
export function isNextStep(mode: string, current: string, to: string): boolean {
  return nextMilestone(mode, current) === to;
}

export type ShipmentAction =
  "DISPATCH" | "VESSEL_DEPARTED" | "ARRIVED" | "DELIVER" | "POD";

/** What the person working the shipment does next, named for the button. */
export function nextAction(
  mode: string,
  current: string,
): ShipmentAction | null {
  switch (nextMilestone(mode, current)) {
    case "SHIPPED":
      return "DISPATCH";
    case "VESSEL_DEPARTED":
      return "VESSEL_DEPARTED";
    case "ARRIVED_AT_PORT_OF_DISCHARGE":
      return "ARRIVED";
    case "DELIVERED":
      return "DELIVER";
    case "POD_RECEIVED":
      return "POD";
    default:
      return null;
  }
}

/**
 * An order has reached the customer when every shipment made for it has been
 * delivered. An order with no shipments has not.
 */
export function allDelivered(milestones: readonly string[]): boolean {
  return (
    milestones.length > 0 &&
    milestones.every((code) => code === "DELIVERED" || code === "POD_RECEIVED")
  );
}

export interface LoadPlanUnit {
  typeCode: string;
  count: number;
}

/** Keep only well-formed units, merged by type, in a stable order. */
export function normaliseUnits(units: readonly LoadPlanUnit[]): LoadPlanUnit[] {
  const counts = new Map<string, number>();
  for (const unit of units) {
    if (!(LOAD_UNIT_TYPES as readonly string[]).includes(unit.typeCode))
      continue;
    const count = Math.floor(unit.count);
    if (!(count > 0)) continue;
    counts.set(unit.typeCode, (counts.get(unit.typeCode) ?? 0) + count);
  }
  return LOAD_UNIT_TYPES.filter((type) => counts.has(type)).map((type) => ({
    typeCode: type,
    count: counts.get(type) ?? 0,
  }));
}
