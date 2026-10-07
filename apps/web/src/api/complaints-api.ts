import type { ApiClient, components, operations } from "@abp/api-client";
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

type ComplaintListFilters = Pick<
  NonNullable<operations["get_complaints"]["parameters"]["query"]>,
  "statusCode" | "assignedToMe" | "overdue"
>;

export async function listComplaints(
  client: ApiClient,
  page = 1,
  search?: string,
  filters: ComplaintListFilters = {},
) {
  return unwrap(
    await client.GET("/complaints", {
      params: {
        query: { page, limit: 25, ...(search ? { search } : {}), ...filters },
      },
    }),
  ) as components["schemas"]["ComplaintListEnvelope"];
}

export async function getComplaint(client: ApiClient, complaintId: string) {
  const result = await client.GET("/complaints/{complaintId}", {
    params: { path: { complaintId } },
  });
  return {
    data: unwrap<components["schemas"]["ComplaintEnvelope"]>(result).data,
    etag: result.response.headers.get("etag"),
  };
}

export async function createComplaint(
  client: ApiClient,
  body: components["schemas"]["CreateComplaintRequest"],
) {
  const result = await client.POST("/complaints", {
    params: { header: { "Idempotency-Key": crypto.randomUUID() } },
    body,
  });
  return {
    data: unwrap<components["schemas"]["ComplaintEnvelope"]>(result).data,
    etag: result.response.headers.get("etag"),
  };
}

export async function updateComplaint(
  client: ApiClient,
  complaintId: string,
  etag: string,
  body: components["schemas"]["UpdateComplaintRequest"],
) {
  const result = await client.PATCH("/complaints/{complaintId}", {
    params: { path: { complaintId }, header: { "If-Match": etag } },
    body,
  });
  return {
    data: unwrap<components["schemas"]["ComplaintEnvelope"]>(result).data,
    etag: result.response.headers.get("etag"),
  };
}

/** The stage fields a move may carry, besides where it goes. */
export type ComplaintMoveFields = Omit<
  components["schemas"]["ComplaintTransitionRequest"],
  "targetStatusCode" | "expectedRowVersion"
>;

/**
 * Move a complaint along its route. `expectedRowVersion` is the bare number;
 * the ETag the detail call returns ("rv-12") is not accepted here.
 */
export async function transitionComplaint(
  client: ApiClient,
  complaintId: string,
  expectedRowVersion: string,
  targetStatusCode: string,
  fields: ComplaintMoveFields = {},
) {
  const result = await client.POST(
    "/complaints/{complaintId}/status-transitions",
    {
      params: {
        path: { complaintId },
        header: { "Idempotency-Key": crypto.randomUUID() },
      },
      body: {
        ...fields,
        targetStatusCode:
          targetStatusCode as components["schemas"]["ComplaintTransitionRequest"]["targetStatusCode"],
        expectedRowVersion,
      },
    },
  );
  return {
    data: unwrap<components["schemas"]["ComplaintEnvelope"]>(result).data,
    etag: result.response.headers.get("etag"),
  };
}
