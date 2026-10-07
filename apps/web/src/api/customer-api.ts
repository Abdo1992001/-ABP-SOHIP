import type { ApiClient, components, operations } from "@abp/api-client";

export type Me = components["schemas"]["Me"];
export type AccountListItem = components["schemas"]["AccountListItem"];
export type AccountDetail = components["schemas"]["AccountDetail"];
export type CountryReference = components["schemas"]["CountryReference"];
export type AccountListQuery = NonNullable<
  operations["get_accounts"]["parameters"]["query"]
>;
export type CreateAccountInput = components["schemas"]["CreateAccountRequest"];
export type UpdateAccountInput = components["schemas"]["UpdateAccountRequest"];
export type ErrorEnvelope = components["schemas"]["ErrorEnvelope"];

export class CustomerApiError extends Error {
  constructor(
    readonly status: number,
    readonly envelope: ErrorEnvelope | undefined,
  ) {
    super(envelope?.error.messageKey ?? `HTTP_${status.toString()}`);
  }
}

export async function getMe(client: ApiClient): Promise<Me> {
  const result = await client.GET("/me");
  return (unwrap(result) as unknown as components["schemas"]["MeEnvelope"])
    .data;
}

export async function listCountries(
  client: ApiClient,
): Promise<readonly CountryReference[]> {
  const result = await client.GET("/reference/countries");
  return (
    unwrap(
      result,
    ) as unknown as components["schemas"]["CountryReferenceListEnvelope"]
  ).data;
}

export async function listAccounts(
  client: ApiClient,
  query: AccountListQuery,
): Promise<components["schemas"]["AccountListEnvelope"]> {
  return unwrap(
    await client.GET("/accounts", { params: { query } }),
  ) as unknown as components["schemas"]["AccountListEnvelope"];
}

export async function getAccount(client: ApiClient, accountId: string) {
  const result = await client.GET("/accounts/{accountId}", {
    params: { path: { accountId } },
  });
  return {
    data: (
      unwrap(
        result,
      ) as unknown as components["schemas"]["AccountDetailEnvelope"]
    ).data,
    etag: result.response.headers.get("etag"),
  };
}

export async function createAccount(
  client: ApiClient,
  input: CreateAccountInput,
) {
  const result = await client.POST("/accounts", {
    params: { header: { "Idempotency-Key": crypto.randomUUID() } },
    body: input,
  });
  return {
    data: (
      unwrap(
        result,
      ) as unknown as components["schemas"]["AccountDetailEnvelope"]
    ).data,
    etag: result.response.headers.get("etag"),
  };
}

export async function updateAccount(
  client: ApiClient,
  accountId: string,
  rowVersion: string,
  input: UpdateAccountInput,
) {
  const result = await client.PATCH("/accounts/{accountId}", {
    params: {
      path: { accountId },
      header: { "If-Match": rowVersion },
    },
    body: input,
  });
  return {
    data: (
      unwrap(
        result,
      ) as unknown as components["schemas"]["AccountDetailEnvelope"]
    ).data,
    etag: result.response.headers.get("etag"),
  };
}

export async function archiveAccount(
  client: ApiClient,
  accountId: string,
  rowVersion: string,
  reason: string,
) {
  const result = await client.POST("/accounts/{accountId}/archive", {
    params: {
      path: { accountId },
      header: {
        "If-Match": rowVersion,
        "Idempotency-Key": crypto.randomUUID(),
      },
    },
    body: { reason },
  });
  return {
    data: (
      unwrap(
        result,
      ) as unknown as components["schemas"]["AccountDetailEnvelope"]
    ).data,
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
