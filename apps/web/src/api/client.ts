import { createApiClient, type ApiClient } from "@abp/api-client";
import { readCsrfToken } from "./csrf.ts";

export function createWebApiClient(
  baseUrl = window.__ABP_RUNTIME_CONFIG__?.apiBaseUrl ??
    import.meta.env.VITE_API_BASE_URL ??
    "/api/v1",
): ApiClient {
  const devTestUserId = import.meta.env.DEV
    ? import.meta.env.VITE_LOCAL_TEST_USER_ID
    : undefined;
  const devTestSessionId = import.meta.env.DEV
    ? import.meta.env.VITE_LOCAL_TEST_SESSION_ID
    : undefined;
  const localTestUserId =
    window.__ABP_RUNTIME_CONFIG__?.localTestUserId ||
    devTestUserId ||
    undefined;
  const localTestSessionId =
    window.__ABP_RUNTIME_CONFIG__?.localTestSessionId ||
    devTestSessionId ||
    undefined;
  const localFetch: typeof globalThis.fetch = (input, init) => {
    const headers = new Headers(
      input instanceof Request ? input.headers : undefined,
    );
    new Headers(init?.headers).forEach((value, key) => {
      headers.set(key, value);
    });
    if (localTestUserId !== undefined) {
      headers.set("x-abp-test-user-id", localTestUserId);
    }
    if (localTestUserId !== undefined && localTestSessionId !== undefined) {
      headers.set("x-abp-test-session-id", localTestSessionId);
    }
    const method =
      init?.method ?? (input instanceof Request ? input.method : "GET");
    const csrfToken = readCsrfToken();
    if (
      csrfToken &&
      !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase())
    ) {
      headers.set("x-csrf-token", csrfToken);
    }
    return globalThis.fetch(input, { ...init, headers });
  };
  return createApiClient({
    baseUrl,
    fetch: localFetch,
  });
}
