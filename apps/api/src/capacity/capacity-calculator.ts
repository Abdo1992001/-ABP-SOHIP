import type { Prisma } from "@abp/database";

export function calculateCapacity(
  quantityBoards: Prisma.Decimal,
  boardsPerDay: number,
) {
  if (!quantityBoards.isPositive() || boardsPerDay <= 0)
    throw new Error("CAPACITY_QUANTITY_MUST_BE_POSITIVE");
  return {
    days: quantityBoards.div(boardsPerDay).toDecimalPlaces(4),
    hours: quantityBoards.div(boardsPerDay).mul(24).toDecimalPlaces(4),
  };
}
