import type { ApiClient, components } from "@abp/api-client";
import { CustomerApiError, type ErrorEnvelope } from "./customer-api.ts";

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
function unwrapCase(result: {
  data?: unknown;
  error?: unknown;
  response: Response;
}) {
  if (result.data === undefined)
    throw new CustomerApiError(
      result.response.status,
      result.error as ErrorEnvelope | undefined,
    );
  return (
    result.data as unknown as components["schemas"]["ReturnedScrapCaseEnvelope"]
  ).data;
}

export async function listReturns(
  client: ApiClient,
  page = 1,
  search?: string,
) {
  return unwrap(
    await client.GET("/returned-scrap-cases", {
      params: { query: { page, limit: 25, ...(search ? { search } : {}) } },
    }),
  ) as components["schemas"]["ReturnedScrapListEnvelope"];
}

export async function getReturn(client: ApiClient, caseId: string) {
  const result = await client.GET("/returned-scrap-cases/{caseId}", {
    params: { path: { caseId } },
  });
  return {
    data: unwrapCase(result),
    etag: result.response.headers.get("etag"),
  };
}

export async function createReturn(
  client: ApiClient,
  body: components["schemas"]["CreateReturnedScrapCaseRequest"],
) {
  const result = await client.POST("/returned-scrap-cases", {
    params: { header: { "Idempotency-Key": crypto.randomUUID() } },
    body,
  });
  return {
    data: unwrapCase(result),
    etag: result.response.headers.get("etag"),
  };
}

export async function submitReturnForApproval(
  client: ApiClient,
  caseId: string,
  expectedRowVersion: string,
  comment?: string,
) {
  const result = await client.POST(
    "/returned-scrap-cases/{caseId}/submit-approval",
    {
      params: {
        path: { caseId },
        header: { "Idempotency-Key": crypto.randomUUID() },
      },
      body: { expectedRowVersion, ...(comment ? { comment } : {}) },
    },
  );
  return {
    data: unwrapCase(result),
    etag: result.response.headers.get("etag"),
  };
}

export async function decideReturn(
  client: ApiClient,
  caseId: string,
  expectedRowVersion: string,
  decision: "APPROVE" | "REJECT",
  comment?: string,
) {
  const result = await client.POST("/returned-scrap-cases/{caseId}/approve", {
    params: {
      path: { caseId },
      header: { "Idempotency-Key": crypto.randomUUID() },
    },
    body: { expectedRowVersion, decision, ...(comment ? { comment } : {}) },
  });
  return {
    data: unwrapCase(result),
    etag: result.response.headers.get("etag"),
  };
}

export async function finalizeReturn(
  client: ApiClient,
  caseId: string,
  expectedRowVersion: string,
  comment?: string,
) {
  const result = await client.POST("/returned-scrap-cases/{caseId}/finalize", {
    params: {
      path: { caseId },
      header: { "Idempotency-Key": crypto.randomUUID() },
    },
    body: { expectedRowVersion, ...(comment ? { comment } : {}) },
  });
  return {
    data: unwrapCase(result),
    etag: result.response.headers.get("etag"),
  };
}
