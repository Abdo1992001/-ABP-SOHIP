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
export async function listActivities(
  client: ApiClient,
  page = 1,
  filters: { dueFrom?: string; dueTo?: string; accountId?: string } = {},
) {
  return unwrap(
    await client.GET("/activities", {
      params: { query: { offset: (page - 1) * 25, limit: 25, ...filters } },
    }),
  ) as components["schemas"]["ActivityListEnvelope"];
}
export async function getActivity(client: ApiClient, activityId: string) {
  const result = await client.GET("/activities/{activityId}", {
    params: { path: { activityId } },
  });
  return {
    data: (
      unwrap(result) as unknown as components["schemas"]["ActivityEnvelope"]
    ).data,
    etag: result.response.headers.get("etag"),
  };
}
export async function createActivity(
  client: ApiClient,
  body: components["schemas"]["CreateActivityRequest"],
) {
  const result = await client.POST("/activities", {
    params: { header: { "Idempotency-Key": crypto.randomUUID() } },
    body,
  });
  return {
    data: (
      unwrap(result) as unknown as components["schemas"]["ActivityEnvelope"]
    ).data,
    etag: result.response.headers.get("etag"),
  };
}
export async function cancelActivity(
  client: ApiClient,
  activityId: string,
  etag: string,
  reason: string,
) {
  const result = await client.POST("/activities/{activityId}/cancel", {
    params: {
      path: { activityId },
      header: { "If-Match": etag, "Idempotency-Key": crypto.randomUUID() },
    },
    body: { reason },
  });
  return {
    data: (
      unwrap(result) as unknown as components["schemas"]["ActivityEnvelope"]
    ).data,
    etag: result.response.headers.get("etag"),
  };
}
export async function updateActivity(
  client: ApiClient,
  activityId: string,
  etag: string,
  body: components["schemas"]["UpdateActivityRequest"],
) {
  const result = await client.PATCH("/activities/{activityId}", {
    params: { path: { activityId }, header: { "If-Match": etag } },
    body,
  });
  return {
    data: (
      unwrap(result) as unknown as components["schemas"]["ActivityEnvelope"]
    ).data,
    etag: result.response.headers.get("etag"),
  };
}
export async function completeActivity(
  client: ApiClient,
  activityId: string,
  expectedRowVersion: string,
  outcomeCode?: string,
) {
  const result = await client.POST("/activities/{activityId}/complete", {
    params: {
      path: { activityId },
      header: { "Idempotency-Key": crypto.randomUUID() },
    },
    body: { expectedRowVersion, ...(outcomeCode ? { outcomeCode } : {}) },
  });
  return {
    data: (
      unwrap(result) as unknown as components["schemas"]["ActivityEnvelope"]
    ).data,
    etag: result.response.headers.get("etag"),
  };
}
export async function rescheduleActivity(
  client: ApiClient,
  activityId: string,
  expectedRowVersion: string,
  newDueAt: string,
) {
  const result = await client.POST("/activities/{activityId}/reschedule", {
    params: {
      path: { activityId },
      header: { "Idempotency-Key": crypto.randomUUID() },
    },
    body: { expectedRowVersion, newDueAt },
  });
  return {
    data: (
      unwrap(result) as unknown as components["schemas"]["ActivityEnvelope"]
    ).data,
    etag: result.response.headers.get("etag"),
  };
}
