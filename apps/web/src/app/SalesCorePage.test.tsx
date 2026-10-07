import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import type { ApiClient, components } from "@abp/api-client";
import { permissions } from "@abp/contracts";
import { describe, expect, it, vi } from "vitest";
import { App } from "./App.tsx";
import { SalesCorePage } from "./SalesCorePage.tsx";

const me = {
  user: {
    userId: "10000000-0000-4000-8000-000000000001",
    email: "sales@example.test",
    displayName: "Sales",
    authStatusCode: "ACTIVE",
    rowVersion: '"rv-1"',
    mustChangePassword: false,
    mfaRequired: false,
    mfaEnabled: false,
  },
  session: {
    sessionId: "session-test",
    authTransport: "BFF_COOKIE",
    assurance: "FEDERATED_MFA",
    issuedAt: "2026-08-21T00:00:00.000Z",
    expiresAt: "2026-08-21T01:00:00.000Z",
  },
  access: {
    roles: [
      {
        roleId: "20000000-0000-4000-8000-000000000001",
        code: "SALES_MANAGER",
        name: "Sales Manager",
        workspace: "SALES",
      },
    ],
    permissions: [
      "sales.workspace.view",
      "sales.management.view",
      "sales.support.act",
      "accounts.view",
      "projects.view",
      "opportunities.view",
      "activities.view",
    ],
    countryScope: { countryCodes: ["EG"], enforced: true },
    workspaces: [{ workspace: "SALES", enabled: true, capabilities: [] }],
    policyVersion: 1,
  },
  stepUp: { required: false, satisfied: true, permittedMethods: ["MFA"] },
} as components["schemas"]["Me"];

describe("WS2-F Sales core integration", () => {
  it("uses only generated, permissioned entity APIs for overview and management search", async () => {
    const response = new Response(null, { status: 200 });
    const get = vi.fn(async (path: string) => {
      await Promise.resolve();
      if (path === "/me") return { data: { data: me }, response };
      if (path === "/activities")
        return {
          data: {
            data: [],
            meta: { page: 1, offset: 0, limit: 50, total: 0, hasNext: false },
          },
          response,
        };
      if (path === "/accounts")
        return {
          data: {
            data: [
              {
                accountId: "30000000-0000-4000-8000-000000000001",
                accountRef: "ACC-1",
                customerNumber: null,
                canonicalName: "Cairo Customer",
                accountCategoryCode: null,
                ownerUserId: me.user.userId,
                recordStatusCode: "ACTIVE",
                country: {
                  countryCode: "EG",
                  displayName: "Egypt",
                  continent: "AFRICA",
                  marketScope: "LOCAL",
                },
              },
            ],
            meta: { page: 1, offset: 0, limit: 10, total: 1, hasNext: false },
          },
          response,
        };
      if (path === "/projects")
        return {
          data: {
            data: [],
            meta: { page: 1, offset: 0, limit: 10, total: 0, hasNext: false },
          },
          response,
        };
      if (path === "/opportunities")
        return {
          data: {
            data: [],
            meta: { page: 1, offset: 0, limit: 10, total: 0, hasNext: false },
          },
          response,
        };
      throw new Error(`UNEXPECTED_${path}`);
    });
    const client = { GET: get } as unknown as ApiClient;
    const query = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={query}>
        <MemoryRouter initialEntries={["/sales/management"]}>
          <App client={client} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(
      await screen.findByRole("heading", {
        name: "Sales management command center",
      }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("Cairo Customer · Egypt"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Global Sales search")).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith("/accounts", expect.anything());
    expect(get).not.toHaveBeenCalledWith("/logistics", expect.anything());
  });

  it("renders server-ranked Top 5 value lists and reveals the remaining rows", async () => {
    const response = new Response(null, { status: 200 });
    const reportsMe = {
      ...me,
      access: {
        ...me.access,
        permissions: [...me.access.permissions, permissions.reportsCommercial],
      },
    } as components["schemas"]["Me"];
    const breakdown = Array.from({ length: 6 }, (_, index) => ({
      key: `customer-${String(index + 1)}`,
      label: `Customer ${String(index + 1)}`,
      value: String(600 - index * 100),
    }));
    const metric = (metricId: string, rows: typeof breakdown) => ({
      metricId,
      metricVersion: "1.1.0",
      name: metricId,
      value: "2100",
      unit: "USD",
      currency: "USD" as const,
      basis: "selected-window booked commercial-clean basis",
      asOf: "2026-08-24T00:00:00.000Z",
      scope: { countryCodes: ["EG"] },
      filters: {},
      generatedAt: "2026-08-24T00:00:00.000Z",
      availability: "AVAILABLE" as const,
      breakdown: rows,
      dqContext: {
        included: 6,
        excludedDataConflict: 0,
        excludedUnmapped: 0,
        excludedOther: 0,
        basis: "VALID",
      },
    });
    const get = vi.fn(async (path: string) => {
      await Promise.resolve();
      if (path === "/me") return { data: { data: reportsMe }, response };
      if (path === "/action-queue") return { data: { data: [] }, response };
      if (path === "/activities")
        return {
          data: {
            data: [],
            meta: { page: 1, offset: 0, limit: 50, total: 0, hasNext: false },
          },
          response,
        };
      if (path === "/accounts" || path === "/opportunities")
        return {
          data: {
            data: [],
            meta: { page: 1, offset: 0, limit: 10, total: 0, hasNext: false },
          },
          response,
        };
      if (path === "/analytics/reports/{reportId}")
        return {
          data: {
            data: {
              reportId: "RPT-001",
              reportVersion: "1.0.0",
              name: "Executive Performance Pack",
              asOf: "2026-08-24T00:00:00.000Z",
              generatedAt: "2026-08-24T00:00:00.000Z",
              currency: "USD",
              scope: { countryCodes: ["EG"] },
              filters: {},
              metrics: [
                metric("MET-CUST-003", breakdown),
                metric(
                  "MET-GEO-004",
                  breakdown.map((row, index) => ({
                    ...row,
                    key: `country-${String(index + 1)}`,
                    label: `Country ${String(index + 1)}`,
                  })),
                ),
              ],
              dqContext: {
                included: 12,
                excludedDataConflict: 0,
                excludedUnmapped: 0,
                excludedOther: 0,
                basis: "VALID",
              },
            },
          },
          response,
        };
      throw new Error(`UNEXPECTED_${path}`);
    });
    const client = { GET: get } as unknown as ApiClient;
    const query = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const view = render(
      <QueryClientProvider client={query}>
        <MemoryRouter initialEntries={["/sales/management"]}>
          <SalesCorePage client={client} me={reportsMe} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const heading = await within(view.container).findByText(
      "Top customers by value",
    );
    const panel = heading.closest("section");
    if (!panel) throw new Error("TOP_CUSTOMERS_PANEL_NOT_FOUND");
    expect(await within(panel).findByText("Customer 1")).toBeInTheDocument();
    expect(within(panel).queryByText("Customer 6")).not.toBeInTheDocument();
    await userEvent.click(
      within(panel).getByRole("button", { name: "More (1)" }),
    );
    expect(within(panel).getByText("Customer 6")).toBeInTheDocument();
    expect(
      within(panel).getByText(
        "Booked Commercial Value · valid ERP facts · USD",
      ),
    ).toBeInTheDocument();
  });
});
