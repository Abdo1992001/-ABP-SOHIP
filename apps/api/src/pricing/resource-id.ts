/**
 * Which id an idempotency record points at.
 *
 * A hand-kept list of key names, and a command whose id was not on it threw at
 * the end of a successful transaction -- so adding a document subject worked,
 * wrote its row, and then answered 500 with the subject saved and the caller
 * told nothing. The named list stays, because it is the precedence when a DTO
 * carries more than one id, but anything ending in `Id` now counts.
 *
 * Whoever performed the command is excluded: `createdByUserId` is on several
 * of these shapes and naming the actor as the resource would make two
 * different commands by one person look like the same record.
 */
export function resourceIdOf(data: unknown): string {
  if (data === null || typeof data !== "object")
    throw new Error("Command response has no resource identifier");
  const value = data as Record<string, unknown>;
  for (const key of [
    "taxPolicyId",
    "guardrailId",
    "pricingOverrideId",
    "productId",
    "pricingBaseConfigId",
    "calculationFormulaId",
    "documentSubjectId",
  ]) {
    const held = value[key];
    if (typeof held === "string" && held !== "") return held;
  }
  for (const [key, held] of Object.entries(value))
    if (
      typeof held === "string" &&
      held !== "" &&
      key.endsWith("Id") &&
      !/UserId$/.test(key)
    )
      return held;
  throw new Error("Command response has no resource identifier");
}
