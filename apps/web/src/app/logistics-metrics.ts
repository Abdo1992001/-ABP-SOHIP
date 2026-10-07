import type { components } from "@abp/api-client";

export type LogisticsVisualization =
  components["schemas"]["LogisticsVisualization"];
export type PlanTransportUnit = components["schemas"]["PlanTransportUnit"];
export type PlacementGroup = components["schemas"]["PlacementGroup"];

const number = (value: string | number | null | undefined) =>
  Number(value ?? 0);

export function transportMetrics(data: LogisticsVisualization) {
  const units = data.transportUnits;
  const placements = data.placements;
  const loaded = placements.reduce(
    (sum, placement) => sum + number(placement.stackQty),
    0,
  );
  const requestedByLine = new Map<string, number>();
  for (const placement of placements)
    requestedByLine.set(placement.planLineId, number(placement.requestedQty));
  const requested = [...requestedByLine.values()].reduce(
    (sum, value) => sum + value,
    0,
  );
  const totalPayload = units.reduce(
    (sum, unit) => sum + number(unit.maxWeightKgSnapshot),
    0,
  );
  const loadedWeight = placements.reduce(
    (sum, placement) =>
      sum + number(placement.stackQty) * number(placement.boardWeightKg),
    0,
  );
  const floorArea = units.reduce(
    (sum, unit) =>
      sum + number(unit.lengthMmSnapshot) * number(unit.widthMmSnapshot),
    0,
  );
  const usedArea = placements.reduce(
    (sum, placement) =>
      sum + number(placement.lengthMm) * number(placement.widthMm),
    0,
  );
  const maximumLayers = placements.reduce((maximum, placement) => {
    const unit = units.find(
      (item) => item.planTransportUnitId === placement.planTransportUnitId,
    );
    const stack = number(placement.stackQty);
    const boardHeight = stack
      ? number(placement.heightMm) / stack
      : number(placement.heightMm);
    return Math.max(
      maximum,
      boardHeight > 0
        ? Math.floor(number(unit?.heightMmSnapshot) / boardHeight)
        : 0,
    );
  }, 0);
  return {
    boardsPerLayer: placements.length,
    maximumLayers,
    boardsPerTrip: units.length ? loaded / units.length : 0,
    trips: units.length,
    payloadUtilization: totalPayload ? (loadedWeight / totalPayload) * 100 : 0,
    areaUtilization: floorArea ? (usedArea / floorArea) * 100 : 0,
    unfitQuantity: Math.max(0, requested - loaded),
    loaded,
    requested,
  };
}
