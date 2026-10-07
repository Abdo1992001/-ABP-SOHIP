import type { ApiClient, components, operations } from "@abp/api-client";
import { CustomerApiError, type ErrorEnvelope } from "./customer-api.ts";

export type ProjectDetail = components["schemas"]["ProjectDetail"];
export type ProjectListItem = components["schemas"]["ProjectListItem"];
export type ProjectListQuery = NonNullable<
  operations["get_projects"]["parameters"]["query"]
>;
export type CreateProjectInput = components["schemas"]["CreateProjectRequest"];
export type UpdateProjectInput = components["schemas"]["UpdateProjectRequest"];

export async function listProjects(
  client: ApiClient,
  query: ProjectListQuery,
): Promise<components["schemas"]["ProjectListEnvelope"]> {
  return unwrap(
    await client.GET("/projects", { params: { query } }),
  ) as components["schemas"]["ProjectListEnvelope"];
}

export async function getProject(client: ApiClient, projectId: string) {
  const result = await client.GET("/projects/{projectId}", {
    params: { path: { projectId } },
  });
  return {
    data: (unwrap(result) as components["schemas"]["ProjectEnvelope"]).data,
    etag: result.response.headers.get("etag"),
  };
}

export async function createProject(
  client: ApiClient,
  input: CreateProjectInput,
) {
  const result = await client.POST("/projects", {
    params: { header: { "Idempotency-Key": crypto.randomUUID() } },
    body: input,
  });
  return {
    data: (unwrap(result) as components["schemas"]["ProjectEnvelope"]).data,
    etag: result.response.headers.get("etag"),
  };
}

export async function updateProject(
  client: ApiClient,
  projectId: string,
  rowVersion: string,
  input: UpdateProjectInput,
) {
  const result = await client.PATCH("/projects/{projectId}", {
    params: {
      path: { projectId },
      header: { "If-Match": rowVersion },
    },
    body: input,
  });
  return {
    data: (unwrap(result) as components["schemas"]["ProjectEnvelope"]).data,
    etag: result.response.headers.get("etag"),
  };
}

export async function archiveProject(
  client: ApiClient,
  projectId: string,
  rowVersion: string,
  reason: string,
) {
  const result = await client.POST("/projects/{projectId}/archive", {
    params: {
      path: { projectId },
      header: {
        "If-Match": rowVersion,
        "Idempotency-Key": crypto.randomUUID(),
      },
    },
    body: { reason },
  });
  return {
    data: (unwrap(result) as components["schemas"]["ProjectEnvelope"]).data,
    etag: result.response.headers.get("etag"),
  };
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
