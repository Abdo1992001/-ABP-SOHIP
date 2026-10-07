import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@abp/api-client";
import type { Me } from "../api/customer-api.ts";
import { NotificationsPage } from "./NotificationsPage.tsx";
import { QuotationStudio } from "./QuotationStudio.tsx";
import { SettingsPage } from "./SettingsPage.tsx";
import { ToastProvider } from "./CommercialUI.tsx";

const me = {
  user: { userId: "user-1", displayName: "Sales User" },
  access: {
    permissions: ["quotations.edit"],
    roles: [],
    countryScope: { countryCodes: ["EG"] },
  },
} as unknown as Me;
function mount(element: ReturnType<typeof NotificationsPage>, route = "/") {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={cache}>
      <MemoryRouter initialEntries={[route]}>
        <ToastProvider>
          <Routes>
            <Route path="/quotations/:quotationId" element={element} />
            <Route path="*" element={element} />
          </Routes>
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const ok = (data: unknown) => ({
  data: { data },
  response: new Response(null, { status: 200, headers: { etag: '"rv-3"' } }),
});
afterEach(cleanup);
describe("Commercial workspace interactions", () => {
  it("keeps a notification unread after a rejected write and retries the same action", async () => {
    let read = false;
    const get = vi.fn(() =>
      ok([
        {
          notificationId: "n1",
          titleSafe: "Review quotation",
          typeCode: "APPROVAL_NEEDED",
          createdAt: "2026-09-01T09:00:00Z",
          readAt: read ? "2026-09-05T00:00:00Z" : null,
        },
      ]),
    );
    const post = vi
      .fn()
      .mockResolvedValueOnce({
        error: { error: { messageKey: "Read request failed" } },
        response: new Response(null, { status: 503 }),
      })
      .mockImplementation(() => {
        read = true;
        return ok({ success: true });
      });
    mount(
      <NotificationsPage
        client={{ GET: get, POST: post } as unknown as ApiClient}
      />,
    );
    await userEvent.click(
      await screen.findByRole(
        "button",
        { name: "Mark read" },
        { timeout: 5_000 },
      ),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Read request failed",
    );
    expect(
      screen.getByRole("button", { name: "Mark read" }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Mark read" }),
      ).not.toBeInTheDocument(),
    );
    expect(post).toHaveBeenCalledTimes(2);
  });
  it("saves edited quote lines without discarding existing adjustments or payment terms", async () => {
    const adjustments = [
      {
        typeCode: "DELIVERY",
        modeCode: "FIXED_AMOUNT",
        value: "50",
        label: "Delivery",
      },
    ];
    const quote = {
      quoteRef: "QT-DEMO",
      rowVersion: '"rv-3"',
      statusCode: "DRAFT",
      paymentTermsCode: "NET30",
      customPaymentTerms: null,
      validFrom: "2026-09-01",
      expiresOn: "2026-10-01",
      adjustments,
      lines: [
        {
          quotationLineId: "line-1",
          description: "PVC pipe",
          qty: "10",
          unitCode: "PIECE",
          unitPrice: "25",
          discountAmount: "0",
        },
      ],
    };
    const get = vi.fn(() => ok(quote));
    const put = vi.fn(() => ok(quote));
    mount(
      <QuotationStudio
        client={{ GET: get, PUT: put } as unknown as ApiClient}
        me={me}
      />,
      "/quotations/q1",
    );
    const qty = await screen.findByRole("spinbutton", { name: "qty 1" });
    await userEvent.clear(qty);
    await userEvent.type(qty, "12");
    await userEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => {
      expect(put).toHaveBeenCalled();
    });
    expect(put).toHaveBeenCalledWith(
      "/quotations/{quotationId}/draft-content",
      expect.objectContaining({
        // Vitest's asymmetric matcher is intentionally typed as `any`.
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        body: expect.objectContaining({
          adjustments,
          paymentTermsCode: "NET30",
          lines: [expect.objectContaining({ qty: "12" })],
        }),
      }),
    );
  });
  it("hides session revocation for a user without the sessions.revoke permission", async () => {
    const get = vi.fn(() => ok({ preferencesJsonb: {}, rowVersion: "1" }));
    mount(
      <SettingsPage
        client={{ GET: get } as unknown as ApiClient}
        me={me}
        theme="light"
        setTheme={() => undefined}
      />,
    );
    // The settings tab strip became a grouped sidebar; the section is now a
    // nav button carrying its own one-line description.
    await userEvent.click(
      screen.getByRole("button", { name: /Password & sessions/ }),
    );
    expect(
      screen.queryByRole("button", { name: "Revoke all sessions" }),
    ).not.toBeInTheDocument();
  });
});
