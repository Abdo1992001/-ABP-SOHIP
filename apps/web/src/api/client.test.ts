import { afterEach, expect, it, vi } from "vitest";
import { createWebApiClient } from "./client.ts";
afterEach(() => {
  vi.unstubAllGlobals();
  delete window.__ABP_RUNTIME_CONFIG__;
});
it("preserves JSON and concurrency headers when adding local authentication", async () => {
  window.__ABP_RUNTIME_CONFIG__ = {
    apiBaseUrl: "http://localhost:3000/api/v1",
    localTestUserId: "demo-user",
    localTestSessionId: "demo-session",
  };
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      expect(request.headers.get("content-type")).toBe("application/json");
      expect(request.headers.get("if-match")).toBe('"rv-2"');
      expect(request.headers.get("x-abp-test-user-id")).toBe("demo-user");
      expect(await request.json()).toEqual({ preferences: { email: false } });
      return new Response(JSON.stringify({ data: {} }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  await createWebApiClient().PATCH("/preferences", {
    params: { header: { "If-Match": '"rv-2"' } },
    body: { preferences: { email: false } },
  });
  expect(fetchMock).toHaveBeenCalledOnce();
});
