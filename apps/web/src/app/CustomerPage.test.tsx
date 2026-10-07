import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import type { ApiClient, components } from "@abp/api-client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.tsx";

const accountId = "30000000-0000-4000-8000-000000000001";
const response = (status = 200, headers?: HeadersInit) =>
  new Response(null, { status, ...(headers === undefined ? {} : { headers }) });

const me: components["schemas"]["Me"] = {
  user: {
    userId: "10000000-0000-4000-8000-000000000001",
    email: "sales@example.test",
    displayName: "Sales User",
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
        code: "SALES_USER",
        name: "Sales User",
        workspace: "SALES",
      },
    ],
    permissions: [
      "sales.workspace.view",
      "accounts.view",
      "accounts.create",
      "accounts.edit",
      "accounts.archive",
    ],
    countryScope: { countryCodes: ["AU", "EG"], enforced: true },
    workspaces: [
      {
        workspace: "SALES",
        enabled: true,
        capabilities: ["accounts.view", "accounts.edit"],
      },
    ],
    policyVersion: 1,
  },
  stepUp: { required: false, satisfied: true, permittedMethods: ["MFA"] },
};

const detail: components["schemas"]["AccountDetail"] = {
  accountId,
  accountRef: "ACC-WORCA",
  customerNumber: "773309",
  canonicalName: "WORCA",
  address: "12 Bourke St, Melbourne VIC 3000",
  taxNumber: "ABN 51 824 753 556",
  accountCategoryCode: null,
  businessTypeCode: "OTHER",
  ownerUserId: me.user.userId,
  defaultCurrencyCode: null,
  recordStatusCode: "ACTIVE",
  archivedAt: null,
  rowVersion: '"rv-1"',
  geography: {
    country: {
      countryCode: "AU",
      displayName: "Australia",
      continent: "OCEANIA",
      marketScope: "GLOBAL",
    },
    continent: "OCEANIA",
    marketScope: "GLOBAL",
  },
  hqCountry: null,
  effectiveGroupMemberships: [
    {
      membershipId: "50000000-0000-4000-8000-000000000001",
      groupNetworkId: "40000000-0000-4000-8000-000000000001",
      groupCode: "ACROW_GLOBAL",
      groupName: "ACROW Global Network",
      groupTypeCode: "COMPANY_NETWORK",
      // The precondition ending a membership needs. The read publishes it
      // now, so the fixture carries it the way the API does.
      rowVersion: '"rv-1758547200"',
      effectiveFrom: null,
      effectiveTo: null,
    },
  ],
  contacts: [],
  opportunities: [],
  quotations: [],
  activities: [],
  erpSyncStatus: {
    statusCode: "NOT_CONFIGURED",
    totalOrders: 0,
    pendingCount: 0,
    syncedCount: 0,
    failedCount: 0,
    latestSyncedAt: null,
  },
};

afterEach(cleanup);

describe("WS2-A Customer frontend", () => {
  it("renders server truth through the generated client and handles a typed 412", async () => {
    const australia = detail.geography.country;
    if (australia === null) throw new Error("AUSTRALIA_FIXTURE_REQUIRED");
    const get = vi.fn(async (path: string) => {
      await Promise.resolve();
      if (path === "/me") return { data: { data: me }, response: response() };
      if (path === "/reference/countries") {
        return {
          data: {
            data: [
              australia,
              {
                countryCode: "EG",
                displayName: "Egypt",
                continent: "AFRICA",
                marketScope: "LOCAL",
              },
            ],
          },
          response: response(),
        };
      }
      if (path === "/accounts") {
        return {
          data: {
            data: [
              {
                accountId,
                accountRef: detail.accountRef,
                customerNumber: detail.customerNumber,
                canonicalName: detail.canonicalName,
                accountCategoryCode: null,
                ownerUserId: detail.ownerUserId,
                recordStatusCode: "ACTIVE",
                country: detail.geography.country,
              },
            ],
            meta: { page: 1, offset: 0, limit: 50, total: 1, hasNext: false },
          },
          response: response(),
        };
      }
      return {
        data: { data: detail },
        response: response(200, { etag: detail.rowVersion }),
      };
    });
    const patch = vi.fn(() =>
      Promise.resolve({
        error: {
          error: {
            code: "CONCURRENCY_CONFLICT",
            messageKey: "errors.concurrency_conflict",
            params: {},
            fieldErrors: [],
            ruleErrors: [],
            traceId: "trace-12345678",
            correlationId: "correlation-12345678",
            conflict: {
              currentRowVersion: '"rv-2"',
              expectedRowVersion: '"rv-1"',
              resource: { resourceType: "ACCOUNT", resourceId: accountId },
            },
          },
        },
        response: response(412),
      }),
    );
    const client = {
      GET: get,
      PATCH: patch,
      POST: vi.fn(),
      PUT: vi.fn(),
      DELETE: vi.fn(),
      OPTIONS: vi.fn(),
      HEAD: vi.fn(),
      TRACE: vi.fn(),
    } as unknown as ApiClient;
    renderApp(client, `/sales/customers/${accountId}`);

    expect(
      await screen.findByRole("heading", { name: "WORCA" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Oceania")).toBeInTheDocument();
    expect(screen.getByText("Global")).toBeInTheDocument();
    expect(screen.getByText(/ACROW Global Network/)).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: /Edit customer/ }),
    );
    // Customer 360 is a dedicated route, so the governed country selector is
    // rendered once instead of being duplicated beside the list grid.
    expect(screen.getAllByRole("option", { name: "Australia" })).toHaveLength(
      1,
    );
    expect(get).toHaveBeenCalledWith("/reference/countries");

    const name = screen.getByLabelText("Name", { selector: "input" });
    await userEvent.clear(name);
    await userEvent.type(name, "WORCA Updated");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText(/changed elsewhere/i)).toBeInTheDocument();
    expect(patch).toHaveBeenCalledTimes(1);
  });

  it("does not expose Customers when accounts.view is absent", async () => {
    const restrictedMe = {
      ...me,
      access: { ...me.access, permissions: ["sales.workspace.view"] },
    } as components["schemas"]["Me"];
    const get = vi.fn(() =>
      Promise.resolve({
        data: { data: restrictedMe },
        response: response(),
      }),
    );
    const client = { GET: get } as unknown as ApiClient;
    renderApp(client, "/sales/customers");
    expect(
      await screen.findByText("Customer access is not granted."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Customers" }),
    ).not.toBeInTheDocument();
    expect(get).not.toHaveBeenCalledWith("/accounts", expect.anything());
  });

  it("renders a contact-only projection through generated Contact operations", async () => {
    const contactId = "70000000-0000-4000-8000-000000000001";
    const contactMe = {
      ...me,
      access: {
        ...me.access,
        permissions: ["sales.workspace.view", "contacts.view", "contacts.edit"],
      },
    } as components["schemas"]["Me"];
    const contact: components["schemas"]["ContactDetail"] = {
      contactId,
      accountId,
      displayName: "Jane Citizen",
      jobTitle: "Commercial Director",
      statusCode: "ACTIVE",
      rowVersion: '"rv-1"',
      account: {
        accountId,
        accountRef: "ACC-WORCA",
        canonicalName: "WORCA",
      },
      channels: [
        {
          contactChannelId: "71000000-0000-4000-8000-000000000001",
          channelTypeCode: "EMAIL",
          value: "jane@example.test",
          isPrimary: true,
        },
      ],
    };
    const get = vi.fn(async (path: string) => {
      await Promise.resolve();
      if (path === "/me") {
        return { data: { data: contactMe }, response: response() };
      }
      if (path === "/contacts/{contactId}") {
        return {
          data: { data: contact },
          response: response(200, { etag: contact.rowVersion }),
        };
      }
      throw new Error(`UNEXPECTED_GET_${path}`);
    });
    const client = {
      GET: get,
      PATCH: vi.fn(),
      POST: vi.fn(),
      PUT: vi.fn(),
      DELETE: vi.fn(),
      OPTIONS: vi.fn(),
      HEAD: vi.fn(),
      TRACE: vi.fn(),
    } as unknown as ApiClient;
    renderApp(client, `/sales/contacts/${contactId}`);

    expect(
      await screen.findByRole("heading", { name: "Jane Citizen" }),
    ).toBeInTheDocument();
    // The customer is a way through to Customer 360, not just a name printed
    // above the contact.
    const account = screen.getByRole("link", { name: "WORCA" });
    expect(account).toHaveAttribute("href", `/customers/${accountId}`);
    expect(screen.getByText("ACC-WORCA")).toBeInTheDocument();

    // The narrow-visibility notice is still made, in the terms it matters in:
    // reaching the customer needs access to the customer.
    expect(
      screen.getByText(/needs access to that account in its own right/i),
    ).toBeInTheDocument();

    // A channel is something you can act on. An address printed as text is a
    // thing to copy by hand; a mailto: is a thing to press.
    const email = screen.getByRole("link", { name: "jane@example.test" });
    expect(email).toHaveAttribute("href", "mailto:jane@example.test");
    expect(screen.getByText("Primary")).toBeInTheDocument();

    expect(
      screen.getByRole("button", { name: "Save contact" }),
    ).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith("/contacts/{contactId}", {
      params: { path: { contactId } },
    });
  });

  it("renders Activities through generated operations and completes an authorized task", async () => {
    const activityId = "91000000-0000-4000-8000-000000000001";
    const activityMe = {
      ...me,
      access: {
        ...me.access,
        permissions: [
          "sales.workspace.view",
          "activities.view",
          "activities.create",
          "activities.edit",
          "activities.cancel",
        ],
      },
    } as components["schemas"]["Me"];
    const activity = {
      activityId,
      countryCode: "EG",
      ownerUserId: me.user.userId,
      typeCode: "FOLLOW_UP",
      subject: "Confirm commercial scope",
      taskStatusCode: "OPEN",
    };
    const get = vi.fn((path: string) => {
      if (path === "/me")
        return { data: { data: activityMe }, response: response() };
      if (path === "/activities")
        return {
          data: {
            data: [activity],
            meta: { offset: 0, limit: 50, total: 1, hasNext: false },
          },
          response: response(),
        };
      return {
        data: { data: activity },
        response: response(200, { etag: '"rv-1"' }),
      };
    });
    const post = vi.fn((path: string) => ({
      data: {
        data: path.endsWith("/complete")
          ? { ...activity, taskStatusCode: "COMPLETED" }
          : activity,
      },
      response: response(200, { etag: '"rv-2"' }),
    }));
    const client = {
      GET: get,
      POST: post,
      PATCH: vi.fn(),
      PUT: vi.fn(),
      DELETE: vi.fn(),
      OPTIONS: vi.fn(),
      HEAD: vi.fn(),
      TRACE: vi.fn(),
    } as unknown as ApiClient;
    renderApp(client, `/sales/activities/${activityId}`);
    expect(
      await screen.findByRole("heading", { name: "Confirm commercial scope" }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Actions" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Complete activity" }),
    );
    expect(post).toHaveBeenCalledWith(
      "/activities/{activityId}/complete",
      expect.anything(),
    );
  });

  it("renders Customer projects and Project 360 through generated Project operations", async () => {
    const projectId = "80000000-0000-4000-8000-000000000001";
    const projectMe = {
      ...me,
      access: {
        ...me.access,
        permissions: [
          "sales.workspace.view",
          "accounts.view",
          "projects.view",
          "projects.create",
          "projects.edit",
          "projects.archive",
        ],
        countryScope: { countryCodes: ["AU", "EG", "SA"], enforced: true },
      },
    } as components["schemas"]["Me"];
    const project: components["schemas"]["ProjectDetail"] = {
      projectId,
      projectRef: "PRJ-00000001",
      name: "Riyadh Metro Commercial Project",
      geography: {
        country: {
          countryCode: "SA",
          displayName: "Saudi Arabia",
          continent: "ASIA",
          marketScope: "GLOBAL",
        },
        continent: "ASIA",
        marketScope: "GLOBAL",
      },
      city: "Riyadh",
      region: "Riyadh",
      addressText: null,
      stageCode: null,
      commercialOwnerUserId: me.user.userId,
      parties: [
        {
          projectPartyId: "81000000-0000-4000-8000-000000000001",
          account: {
            accountId,
            accountRef: detail.accountRef,
            canonicalName: detail.canonicalName,
          },
          roleCode: "MAIN_CONTRACTOR",
          primaryFlag: true,
          // The party's own concurrency token. Removing a party sends it in
          // If-Match, and it is a different counter from the project's.
          rowVersion: '"rv-1"',
        },
      ],
      recordStatusCode: "ACTIVE",
      archivedAt: null,
      rowVersion: '"rv-1"',
    };
    const primaryParty = project.parties[0];
    if (primaryParty === undefined) throw new Error("PROJECT_PARTY_REQUIRED");
    const projectListItem: components["schemas"]["ProjectListItem"] = {
      projectId,
      projectRef: project.projectRef,
      name: project.name,
      geography: project.geography,
      primaryAccount: primaryParty.account,
      city: project.city,
      region: project.region,
      stageCode: project.stageCode,
      commercialOwnerUserId: project.commercialOwnerUserId,
      recordStatusCode: "ACTIVE",
      updatedAt: "2026-08-21T00:00:00.000Z",
    };
    const get = vi.fn(async (path: string) => {
      await Promise.resolve();
      if (path === "/me") {
        return { data: { data: projectMe }, response: response() };
      }
      if (path === "/reference/countries") {
        return {
          data: {
            data: [detail.geography.country, project.geography.country].filter(
              (country) => country !== null,
            ),
          },
          response: response(),
        };
      }
      if (path === "/accounts") {
        return {
          data: {
            data: [
              {
                accountId,
                accountRef: detail.accountRef,
                customerNumber: detail.customerNumber,
                canonicalName: detail.canonicalName,
                accountCategoryCode: null,
                ownerUserId: detail.ownerUserId,
                recordStatusCode: "ACTIVE",
                country: detail.geography.country,
              },
            ],
            meta: { page: 1, offset: 0, limit: 50, total: 1, hasNext: false },
          },
          response: response(),
        };
      }
      if (path === "/accounts/{accountId}") {
        return { data: { data: detail }, response: response() };
      }
      if (path === "/projects") {
        return {
          data: {
            data: [projectListItem],
            meta: { page: 1, offset: 0, limit: 50, total: 1, hasNext: false },
          },
          response: response(),
        };
      }
      if (path === "/projects/{projectId}") {
        return {
          data: { data: project },
          response: response(200, { etag: project.rowVersion }),
        };
      }
      throw new Error(`UNEXPECTED_GET_${path}`);
    });
    const client = {
      GET: get,
      PATCH: vi.fn(),
      POST: vi.fn(),
      PUT: vi.fn(),
      DELETE: vi.fn(),
      OPTIONS: vi.fn(),
      HEAD: vi.fn(),
      TRACE: vi.fn(),
    } as unknown as ApiClient;
    renderApp(client, `/sales/customers/${accountId}`);

    expect(
      await screen.findByRole("tab", { name: "Projects" }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Projects" }));
    expect(
      await screen.findByText(/Riyadh Metro Commercial Project/),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("link", { name: /Riyadh Metro Commercial Project/ }),
    );
    expect(
      await screen.findByRole("heading", {
        name: "Riyadh Metro Commercial Project",
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Saudi Arabia").length).toBeGreaterThan(0);
    // The market scope is printed as a label, not as the stored code: this
    // used to assert "GLOBAL", which is the SCREAMING_CASE the redesign brief
    // rules out — it read the same in Arabic as in English.
    expect(screen.getAllByText("Global").length).toBeGreaterThan(0);
    expect(get).toHaveBeenCalledWith(
      "/projects/{projectId}",
      expect.objectContaining({ params: { path: { projectId } } }),
    );
  });
});

function renderApp(client: ApiClient, route: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>
        <App client={client} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
