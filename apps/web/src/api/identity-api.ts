import type { ApiClient, components } from "@abp/api-client";

export type User = components["schemas"]["User"];
export type Role = components["schemas"]["Role"];
export type AccessRequest = components["schemas"]["AccessRequest"];

export async function teamRoster(
  client: ApiClient,
): Promise<{ userId: string; displayName: string }[]> {
  const result = await client.GET("/team/roster");
  return (
    unwrap(result) as unknown as {
      data: { userId: string; displayName: string }[];
    }
  ).data;
}

export async function listUsers(
  client: ApiClient,
  query: { search?: string; page?: number; limit?: number } = {},
) {
  return unwrap(
    await client.GET("/admin/users", { params: { query } }),
  ) as unknown as components["schemas"]["UserListEnvelope"];
}

export async function listRoles(client: ApiClient) {
  return unwrap(
    await client.GET("/admin/roles", { params: { query: { limit: 200 } } }),
  ) as unknown as components["schemas"]["RoleListEnvelope"];
}

export async function createUser(
  client: ApiClient,
  body: components["schemas"]["CreateUserRequest"],
): Promise<{ data: User; tempPassword: string | null }> {
  const result = await client.POST("/admin/users", {
    params: { header: { "Idempotency-Key": crypto.randomUUID() } },
    body,
  });
  return unwrap(result);
}

export async function listAccessRequests(
  client: ApiClient,
  query: { search?: string; page?: number; limit?: number } = {},
) {
  return unwrap(
    await client.GET("/admin/access-requests", { params: { query } }),
  ) as unknown as components["schemas"]["AccessRequestListEnvelope"];
}

export async function approveAccessRequest(
  client: ApiClient,
  requestId: string,
  rowVersion: string,
  body: { jobTitle?: string | null; roleIds: string[]; countryCodes: string[] },
): Promise<{ data: AccessRequest; user: User; tempPassword: string | null }> {
  const result = await client.POST(
    "/admin/access-requests/{requestId}/approve",
    {
      params: {
        path: { requestId },
        header: {
          "If-Match": `"rv-${rowVersion}"`,
          "Idempotency-Key": crypto.randomUUID(),
        },
      },
      body,
    },
  );
  return unwrap(result);
}

export async function rejectAccessRequest(
  client: ApiClient,
  requestId: string,
  rowVersion: string,
  reason: string,
): Promise<AccessRequest> {
  const result = await client.POST(
    "/admin/access-requests/{requestId}/reject",
    {
      params: {
        path: { requestId },
        header: { "If-Match": `"rv-${rowVersion}"` },
      },
      body: { reason },
    },
  );
  return (unwrap(result) as unknown as { data: AccessRequest }).data;
}

function unwrap<T>(result: {
  data?: T;
  error?: unknown;
  response: Response;
}): T {
  if (result.data !== undefined) return result.data;
  const envelope = result.error as
    { error?: { messageKey?: string; code?: string } } | undefined;
  throw new Error(
    envelope?.error?.messageKey ??
      envelope?.error?.code ??
      `IDENTITY_HTTP_${String(result.response.status)}`,
  );
}
