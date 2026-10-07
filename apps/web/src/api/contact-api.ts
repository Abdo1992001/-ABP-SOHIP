import type { ApiClient, components, operations } from "@abp/api-client";
import { CustomerApiError, type ErrorEnvelope } from "./customer-api.ts";

export type ContactDetail = components["schemas"]["ContactDetail"];
export type ContactListItem = components["schemas"]["ContactListItem"];
export type ContactListQuery = NonNullable<
  operations["get_accounts_by_accountId_contacts"]["parameters"]["query"]
>;
export type CreateContactInput = components["schemas"]["CreateContactRequest"];
export type UpdateContactInput = components["schemas"]["UpdateContactRequest"];
export type CreateContactChannelInput =
  components["schemas"]["CreateContactChannelRequest"];
export type CreateContactShareInput =
  components["schemas"]["CreateContactShareRequest"];

export async function listContacts(
  client: ApiClient,
  accountId: string,
  query: ContactListQuery,
): Promise<components["schemas"]["ContactListEnvelope"]> {
  return unwrap(
    await client.GET("/accounts/{accountId}/contacts", {
      params: { path: { accountId }, query },
    }),
  ) as components["schemas"]["ContactListEnvelope"];
}

export async function getContact(client: ApiClient, contactId: string) {
  const result = await client.GET("/contacts/{contactId}", {
    params: { path: { contactId } },
  });
  return {
    data: (unwrap(result) as components["schemas"]["ContactEnvelope"]).data,
    etag: result.response.headers.get("etag"),
  };
}

export async function createContact(
  client: ApiClient,
  accountId: string,
  input: CreateContactInput,
) {
  const result = await client.POST("/accounts/{accountId}/contacts", {
    params: {
      path: { accountId },
      header: { "Idempotency-Key": crypto.randomUUID() },
    },
    body: input,
  });
  return {
    data: (unwrap(result) as components["schemas"]["ContactEnvelope"]).data,
    etag: result.response.headers.get("etag"),
  };
}

export async function updateContact(
  client: ApiClient,
  contactId: string,
  rowVersion: string,
  input: UpdateContactInput,
) {
  const result = await client.PATCH("/contacts/{contactId}", {
    params: {
      path: { contactId },
      header: { "If-Match": rowVersion },
    },
    body: input,
  });
  return {
    data: (unwrap(result) as components["schemas"]["ContactEnvelope"]).data,
    etag: result.response.headers.get("etag"),
  };
}

export async function addContactChannel(
  client: ApiClient,
  contactId: string,
  input: CreateContactChannelInput,
) {
  const result = await client.POST("/contacts/{contactId}/channels", {
    params: {
      path: { contactId },
      header: { "Idempotency-Key": crypto.randomUUID() },
    },
    body: input,
  });
  return {
    data: (unwrap(result) as components["schemas"]["ContactEnvelope"]).data,
    etag: result.response.headers.get("etag"),
  };
}

export async function removeContactChannel(
  client: ApiClient,
  channelId: string,
  rowVersion: string,
) {
  const result = await client.DELETE("/contact-channels/{channelId}", {
    params: {
      path: { channelId },
      header: {
        "If-Match": rowVersion,
        "Idempotency-Key": crypto.randomUUID(),
      },
    },
  });
  return {
    data: (unwrap(result) as components["schemas"]["ContactEnvelope"]).data,
    etag: result.response.headers.get("etag"),
  };
}

export async function shareContacts(
  client: ApiClient,
  accountId: string,
  input: CreateContactShareInput,
) {
  const result = await client.POST("/accounts/{accountId}/contact-shares", {
    params: {
      path: { accountId },
      header: { "Idempotency-Key": crypto.randomUUID() },
    },
    body: input,
  });
  return {
    data: (unwrap(result) as components["schemas"]["ContactShareEnvelope"])
      .data,
    etag: result.response.headers.get("etag"),
  };
}

export async function revokeContactShare(
  client: ApiClient,
  shareId: string,
  rowVersion: string,
) {
  const result = await client.DELETE("/contact-shares/{shareId}", {
    params: {
      path: { shareId },
      header: {
        "If-Match": rowVersion,
        "Idempotency-Key": crypto.randomUUID(),
      },
    },
  });
  return unwrap(result);
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
