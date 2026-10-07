import type { ApiClient, components, operations } from "@abp/api-client";
import { CustomerApiError, type ErrorEnvelope } from "./customer-api.ts";

export type QuotationListQuery = NonNullable<
  operations["get_quotations"]["parameters"]["query"]
>;
export type CreateQuotationInput =
  components["schemas"]["CreateQuotationRequest"];

export async function listQuotations(
  client: ApiClient,
  query: QuotationListQuery,
) {
  return unwrap(
    await client.GET("/quotations", { params: { query } }),
  ) as components["schemas"]["QuotationListEnvelope"];
}

export async function createQuotation(
  client: ApiClient,
  input: CreateQuotationInput,
  idempotencyKey: string = crypto.randomUUID(),
) {
  const result = await client.POST("/quotations", {
    params: { header: { "Idempotency-Key": idempotencyKey } },
    body: input,
  });
  return unwrap(result).data;
}

export const quotationCopyableStatuses = new Set([
  "SENT",
  "EXPIRED",
  "REJECTED",
  "CANCELLED",
  "SUPERSEDED",
]);

export function canCopyQuotation(statusCode: string) {
  return quotationCopyableStatuses.has(statusCode.toUpperCase());
}

export async function copyQuotation(
  client: ApiClient,
  quotationId: string,
  expectedRowVersion: string,
) {
  const result = await client.POST("/quotations/{quotationId}/supersede", {
    params: {
      path: { quotationId },
      header: { "Idempotency-Key": crypto.randomUUID() },
    },
    body: { expectedRowVersion, copyRecipients: false },
  });
  return unwrap(result).data;
}

function unwrap<T>(result: {
  data?: T;
  error?: unknown;
  response: Response;
}): T {
  if (result.data !== undefined) return result.data;
  throw new CustomerApiError(
    result.response.status,
    result.error as ErrorEnvelope | undefined,
  );
}

export type QuotationPdfReading = components["schemas"]["QuotationPdfReading"];

/**
 * Read a past quotation PDF. Nothing is written — what comes back is what the
 * document was found to contain, including the rows it could not resolve, so
 * a person decides before any of it becomes a quotation.
 */
export async function readQuotationPdf(client: ApiClient, file: File) {
  const result = await client.POST("/quotations/read-pdf", {
    headers: { "Content-Type": "application/pdf" },
    body: file as unknown as string,
    bodySerializer: (body) => body as unknown as BodyInit,
  });
  return unwrap(result).data as QuotationPdfReading;
}

/**
 * Turn a reading into a draft quotation in one command. A rejected line or a
 * failed calculation rolls the quotation itself back, so importing a file can
 * never leave an empty numbered draft behind.
 */
export async function createQuotationFromReading(
  client: ApiClient,
  input: {
    opportunityId: string;
    lines: { description: string; qty: number; unitPrice: number }[];
  },
) {
  return createQuotation(client, {
    opportunityId: input.opportunityId,
    draft: {
      lines: input.lines.map((line) => ({
        description: line.description,
        qty: String(line.qty),
        unitCode: "PIECE",
        unitPrice: String(line.unitPrice),
      })),
    },
  });
}
