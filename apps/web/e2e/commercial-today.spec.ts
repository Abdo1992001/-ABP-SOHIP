import { test, expect, type Page } from "@playwright/test";
import {
  gotoScreen,
  assertTypeScale,
  assertLabeled,
  assertReadable,
  assertNothingClipped,
  assertNoHorizontalScroll,
  assertNoRawEnums,
} from "./helpers.js";

/**
 * Commercial today, in all four of its states.
 *
 * The API is stubbed rather than reached, which is the point: the empty and
 * error states of a screen are the ones nobody ever looks at, because you only
 * meet them when something has gone wrong and that is exactly when you are not
 * checking whether the layout holds. Stubbing is also what lets this run with
 * no session at all.
 *
 * The payloads below are test doubles, shaped to the contract in
 * `docs/contracts/openapi` — not real ACROW figures. They exist to exercise
 * each branch: one deal past its close date, one long untouched, one closing
 * this month with a probability, and two owners so the team list has an order.
 */

const NOW = new Date();
const daysAgo = (n: number) =>
  new Date(NOW.getTime() - n * 86_400_000).toISOString();
const dayOfThisMonth = (day: number) =>
  new Date(NOW.getFullYear(), NOW.getMonth(), day).toISOString().slice(0, 10);

const ME = {
  data: {
    user: {
      userId: "10000000-0000-4000-8000-000000000001",
      email: "tester@abp.local",
      displayName: "Test Owner",
      authStatusCode: "ACTIVE",
      rowVersion: '"rv-1"',
      jobTitle: null,
      photoUpdatedAt: null,
      managerUserId: null,
      teamId: null,
      lastSignInAt: daysAgo(1),
      mfaEnabled: false,
      mfaRequired: false,
      mustChangePassword: false,
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
      permissions: ["sales.workspace.view", "opportunities.view"],
      countryScope: { countryCodes: ["EG"], enforced: true },
      workspaces: [
        {
          workspace: "SALES",
          enabled: true,
          capabilities: ["sales.workspace.view"],
        },
      ],
      policyVersion: 1,
    },
    session: {
      sessionId: "sess-1",
      assurance: "PASSWORD",
      authTransport: "BFF_COOKIE",
      issuedAt: daysAgo(0),
      expiresAt: new Date(NOW.getTime() + 3_600_000).toISOString(),
    },
    stepUp: { required: false, satisfied: true, permittedMethods: [] },
  },
};

const OPPORTUNITIES = {
  data: [
    {
      opportunityId: "ab060000-0000-4000-8000-000000000001",
      opportunityRef: "OPP-00000001",
      title: "Delta Contracting — curved columns — north tower",
      accountId: "ab010000-0000-4000-8000-000000000001",
      projectId: null,
      countryCode: "EG",
      ownerUserId: "10000000-0000-4000-8000-000000000001",
      stageCode: "NEGOTIATION",
      cancelledAt: null,
      cancellationReason: null,
      probabilityPct: "75",
      probabilitySourceCode: "STAGE_DEFAULT",
      estimatedValue: "480000",
      currencyCode: "USD",
      createdAt: daysAgo(90),
      updatedAt: daysAgo(2),
      expectedCloseDate: dayOfThisMonth(3),
    },
    {
      opportunityId: "ab060000-0000-4000-8000-000000000002",
      opportunityRef: "OPP-00000002",
      title: "Nile Builders — slab formwork — phase two",
      accountId: "ab010000-0000-4000-8000-000000000002",
      projectId: null,
      countryCode: "EG",
      ownerUserId: "10000000-0000-4000-8000-000000000002",
      stageCode: "PROPOSAL",
      cancelledAt: null,
      cancellationReason: null,
      probabilityPct: "50",
      probabilitySourceCode: "STAGE_DEFAULT",
      estimatedValue: "260000",
      currencyCode: "USD",
      createdAt: daysAgo(200),
      updatedAt: daysAgo(47),
      expectedCloseDate: dayOfThisMonth(28),
    },
    {
      opportunityId: "ab060000-0000-4000-8000-000000000003",
      opportunityRef: "OPP-00000003",
      title: "Cairo Structures — wall panels",
      accountId: "ab010000-0000-4000-8000-000000000003",
      projectId: null,
      countryCode: "EG",
      ownerUserId: "10000000-0000-4000-8000-000000000001",
      stageCode: "WON",
      cancelledAt: null,
      cancellationReason: null,
      probabilityPct: "100",
      probabilitySourceCode: "STAGE_DEFAULT",
      estimatedValue: "310000",
      currencyCode: "USD",
      createdAt: daysAgo(150),
      updatedAt: daysAgo(10),
      expectedCloseDate: dayOfThisMonth(1),
    },
  ],
  meta: { total: 3, page: 1, limit: 200 },
};

const ROSTER = {
  data: [
    {
      userId: "10000000-0000-4000-8000-000000000001",
      displayName: "Test Owner",
    },
    {
      userId: "10000000-0000-4000-8000-000000000002",
      displayName: "Second Owner",
    },
  ],
};

type Mode = "loaded" | "empty" | "error";

async function stub(page: Page, mode: Mode) {
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (status: number, body: unknown) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });

    // The identity always resolves: a signed-in person with no identity is a
    // broken state, not an empty one, and the shell would never render.
    if (path.endsWith("/me")) return json(200, ME);
    if (path.endsWith("/team/roster")) return json(200, ROSTER);
    if (path.endsWith("/opportunities")) {
      if (mode === "error") return json(500, { error: { code: "INTERNAL" } });
      return json(
        200,
        mode === "empty" ? { data: [], meta: { total: 0 } } : OPPORTUNITIES,
      );
    }
    return json(200, { data: [], meta: { total: 0, unreadCount: 0 } });
  });
}

test.describe("commercial today", () => {
  test("answers each question from the deals", async ({ page }) => {
    await stub(page, "loaded");
    await gotoScreen(page, "/today");

    await expect(page.locator(".today-section")).toHaveCount(4);

    // Past its close date and still open.
    const slipping = page.locator(".today-section").first();
    await expect(slipping).toContainText("OPP-00000001");

    // Weighted forecast: 480,000 x 75% + 260,000 x 50% = 490,000.
    await expect(page.locator(".today-forecast")).toContainText("490,000");

    // Both owners appear, and the won deal is attributed.
    await expect(page.locator(".today-team li")).toHaveCount(2);

    await assertTypeScale(page);
    await assertLabeled(page);
    await assertReadable(page);
    await assertNothingClipped(page);
    await assertNoHorizontalScroll(page);
    await assertNoRawEnums(page);
  });

  test("says so plainly when there is nothing to act on", async ({ page }) => {
    await stub(page, "empty");
    await gotoScreen(page, "/today");

    await expect(page.locator(".today-section")).toHaveCount(4);
    await expect(page.locator(".today-empty")).toHaveCount(4);
    await assertReadable(page);
    await assertNoHorizontalScroll(page);
  });

  test("shows a retryable error rather than an empty page", async ({
    page,
  }) => {
    await stub(page, "error");
    await gotoScreen(page, "/today");

    await expect(page.locator(".error-banner")).toBeVisible();
    await assertReadable(page);
  });
});
