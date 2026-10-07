import createOpenApiClient from "openapi-fetch";
import type { paths } from "./generated/schema.js";

export interface ApiClientOptions {
  baseUrl: string;
  fetch?: typeof globalThis.fetch;
}

export function createApiClient(options: ApiClientOptions) {
  return createOpenApiClient<paths>({
    baseUrl: options.baseUrl,
    credentials: "include",
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
}

export type ApiClient = ReturnType<typeof createApiClient>;
