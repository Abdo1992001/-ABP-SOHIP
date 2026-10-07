import type { ApiClient, components, operations } from "@abp/api-client";
import { CustomerApiError, type ErrorEnvelope } from "./customer-api.ts";

export type OpportunityDetail = components["schemas"]["OpportunityDetail"];
export type OpportunityListQuery = NonNullable<
  operations["get_opportunities"]["parameters"]["query"]
>;
export type CreateOpportunityInput =
  components["schemas"]["CreateOpportunityRequest"];
export type TransitionOpportunityInput =
  components["schemas"]["OpportunityStageTransitionRequest"];
export type ProbabilityOverrideInput =
  components["schemas"]["ProbabilityOverrideRequest"];

export async function listOpportunities(
  client: ApiClient,
  query: OpportunityListQuery,
) {
  return unwrap(
    await client.GET("/opportunities", { params: { query } }),
  ) as components["schemas"]["OpportunityListEnvelope"];
}

export async function getOpportunity(client: ApiClient, opportunityId: string) {
  const result = await client.GET("/opportunities/{opportunityId}", {
    params: { path: { opportunityId } },
  });
  return {
    data: (unwrap(result) as components["schemas"]["OpportunityEnvelope"]).data,
    etag: result.response.headers.get("etag"),
  };
}

export async function createOpportunity(
  client: ApiClient,
  input: CreateOpportunityInput,
) {
  const result = await client.POST("/opportunities", {
    params: { header: { "Idempotency-Key": crypto.randomUUID() } },
    body: input,
  });
  return {
    data: (unwrap(result) as components["schemas"]["OpportunityEnvelope"]).data,
    etag: result.response.headers.get("etag"),
  };
}

export async function transitionOpportunity(
  client: ApiClient,
  opportunityId: string,
  rowVersion: string,
  input: TransitionOpportunityInput,
) {
  const result = await client.POST(
    "/opportunities/{opportunityId}/stage-transitions",
    {
      params: {
        path: { opportunityId },
        header: {
          "If-Match": rowVersion,
          "Idempotency-Key": crypto.randomUUID(),
        },
      },
      body: input,
    },
  );
  return {
    data: (unwrap(result) as components["schemas"]["OpportunityEnvelope"]).data,
    etag: result.response.headers.get("etag"),
  };
}

export async function overrideOpportunityProbability(
  client: ApiClient,
  opportunityId: string,
  rowVersion: string,
  input: ProbabilityOverrideInput,
) {
  const result = await client.POST(
    "/opportunities/{opportunityId}/probability-overrides",
    {
      params: {
        path: { opportunityId },
        header: {
          "If-Match": rowVersion,
          "Idempotency-Key": crypto.randomUUID(),
        },
      },
      body: input,
    },
  );
  return {
    data: (unwrap(result) as components["schemas"]["OpportunityEnvelope"]).data,
    etag: result.response.headers.get("etag"),
  };
}

export async function listOpportunityStagePolicies(client: ApiClient) {
  return unwrap(await client.GET("/reference/opportunity-stage-policies")) as {
    data: readonly components["schemas"]["OpportunityStagePolicy"][];
  };
}

export async function listOpportunityLostReasons(client: ApiClient) {
  return unwrap(await client.GET("/reference/opportunity-lost-reasons")) as {
    data: readonly components["schemas"]["OpportunityLostReason"][];
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
