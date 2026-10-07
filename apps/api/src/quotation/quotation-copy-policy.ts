export const quotationCopyableStatuses = new Set([
  "SENT",
  "EXPIRED",
  "REJECTED",
  "CANCELLED",
  "SUPERSEDED",
]);

export function canCopyQuotationStatus(statusCode: string) {
  return quotationCopyableStatuses.has(statusCode.toUpperCase());
}

export function copyClosesSource(statusCode: string) {
  return statusCode.toUpperCase() === "SENT";
}
