/**
 * Local transport estimator — ports ABP Engineering Studio's
 * calculateTransport (src/tools/engineering-calculator.js), which is a
 * stateless "utility_reference" calc: never persisted, never a product/line,
 * just a quick trips/cost estimate. Kept as a pure function, no API call.
 */

export interface TransportEstimateInput {
  totalWeightKg: number;
  truckCapacityKg: number;
  minimumTrips?: number;
  costPerTrip: number;
  extraCost?: number;
}

export interface TransportEstimateResult {
  trips: number;
  utilizationPct: number;
  totalCost: number;
}

export function estimateTransport(
  input: TransportEstimateInput,
): TransportEstimateResult {
  const totalWeightKg = Math.max(0, input.totalWeightKg || 0);
  const truckCapacityKg = Math.max(0.0001, input.truckCapacityKg || 0.0001);
  const minimumTrips = Math.max(0, Math.ceil(input.minimumTrips || 0));
  const calculatedTrips =
    totalWeightKg > 0 ? Math.ceil(totalWeightKg / truckCapacityKg) : 0;
  const trips = Math.max(minimumTrips, calculatedTrips);
  const costPerTrip = Math.max(0, input.costPerTrip || 0);
  const extraCost = Math.max(0, input.extraCost || 0);
  return {
    trips,
    utilizationPct:
      trips > 0 ? (totalWeightKg / (trips * truckCapacityKg)) * 100 : 0,
    totalCost: trips * costPerTrip + extraCost,
  };
}
