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
 * Approvals, in the states that matter.
 *
 * The one worth having is "can see but cannot decide": `approvals.view`
 * without `approvals.decide` is a real combination — the person who raised the
 * request sees it in the queue — and a screen that showed them Approve and
 * Reject buttons that 403 on click would be worse than one that explains why
 * they are absent.
 */

const NOW = new Date();
const iso = (daysAgo: number) =>
  new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString();

function me(permissions: string[]) {
  return {
    data: {
      user: {
        userId: "10000000-0000-4000-8000-000000000001",
        email: "approver@abp.local",
        displayName: "Approver",
        authStatusCode: "ACTIVE",
        rowVersion: '"rv-1"',
        mfaEnabled: false,
        mfaRequired: false,
        mustChangePassword: false,
      },
      access: {
        roles: [],
        permissions,
        countryScope: { countryCodes: ["EG"], enforced: true },
        workspaces: [{ workspace: "SALES", enabled: true, capabilities: [] }],
        policyVersion: 1,
      },
      session: {
        sessionId: "s",
        assurance: "PASSWORD",
        authTransport: "BFF_COOKIE",
        issuedAt: iso(0),
        expiresAt: new Date(NOW.getTime() + 3.6e6).toISOString(),
      },
      stepUp: { required: false, satisfied: true, permittedMethods: [] },
    },
  };
}

const PENDING_ID = "cc000000-0000-4000-8000-000000000001";
const SETTLED_ID = "cc000000-0000-4000-8000-000000000002";

const LIST = {
  data: [
    {
      approvalRequestId: PENDING_ID,
      quotationId: "bb000000-0000-4000-8000-000000000001",
      requestedByUserId: "10000000-0000-4000-8000-000000000002",
      statusCode: "PENDING",
      requiredAuthorityTier: 2,
      currentAssigneeUserId: "10000000-0000-4000-8000-000000000001",
      requestedAt: iso(2),
      resolvedAt: null,
      invalidatedAt: null,
      invalidationReasonCode: null,
    },
    {
      approvalRequestId: SETTLED_ID,
      quotationId: "bb000000-0000-4000-8000-000000000002",
      requestedByUserId: "10000000-0000-4000-8000-000000000002",
      statusCode: "APPROVED",
      requiredAuthorityTier: 1,
      currentAssigneeUserId: null,
      requestedAt: iso(9),
      resolvedAt: iso(8),
      invalidatedAt: null,
      invalidationReasonCode: null,
    },
  ],
  meta: { total: 2, page: 1, limit: 50 },
};

const CONTEXT = {
  data: {
    approvalRequestId: PENDING_ID,
    quotation: {
      quotationRef: "QT-2026-0042",
      statusCode: "PENDING_APPROVAL",
      currencyCode: "USD",
      totalAmount: "128400",
      account: { canonicalName: "Delta Contracting" },
      project: null,
    },
  },
};

async function stub(
  page: Page,
  opts: {
    permissions: string[];
    empty?: boolean;
    onDecision?: (body: unknown) => void;
  },
) {
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const json = (status: number, body: unknown) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });

    if (url.pathname.endsWith("/me")) return json(200, me(opts.permissions));
    if (url.pathname.endsWith("/decisions")) {
      opts.onDecision?.(route.request().postDataJSON());
      return json(200, { data: { statusCode: "APPROVED" } });
    }
    if (/\/approval-requests\/[0-9a-f-]+$/.test(url.pathname))
      return json(200, CONTEXT);
    if (url.pathname.endsWith("/approval-requests"))
      return json(200, opts.empty ? { data: [], meta: { total: 0 } } : LIST);
    return json(200, { data: [], meta: { total: 0, unreadCount: 0 } });
  });
}

test.describe("approvals", () => {
  test("shows what is waiting, with the figures needed to decide", async ({
    page,
  }) => {
    await stub(page, { permissions: ["approvals.view", "approvals.decide"] });
    await gotoScreen(page, "/approvals");

    const card = page.locator(".approval-card");
    await expect(card).toHaveCount(1);
    await expect(card).toContainText("QT-2026-0042");
    await expect(card).toContainText("Delta Contracting");
    await expect(card).toContainText("128,400");
    await expect(page.locator(".approvals-settled li")).toHaveCount(1);

    await assertTypeScale(page);
    await assertLabeled(page);
    await assertReadable(page);
    await assertNothingClipped(page);
    await assertNoHorizontalScroll(page);
    await assertNoRawEnums(page);
  });

  test("records a decision with its comment", async ({ page }) => {
    let sent: unknown = null;
    await stub(page, {
      permissions: ["approvals.view", "approvals.decide"],
      onDecision: (body) => {
        sent = body;
      },
    });
    await gotoScreen(page, "/approvals");

    await page.getByRole("button", { name: /Decide|اتخذ قرار/ }).click();
    await page
      .locator(".approval-decision textarea")
      .fill("Margin is within policy.");
    await page.getByRole("button", { name: /^(Approve|موافقة)$/ }).click();

    await expect
      .poll(() => sent)
      .toEqual({
        decision: "APPROVE",
        comment: "Margin is within policy.",
      });
  });

  test("offers no decision buttons without the permission", async ({
    page,
  }) => {
    await stub(page, { permissions: ["approvals.view"] });
    await gotoScreen(page, "/approvals");

    await expect(page.locator(".approval-card")).toHaveCount(1);
    await expect(
      page.getByRole("button", { name: /Decide|اتخذ قرار/ }),
    ).toHaveCount(0);
    await assertReadable(page);
  });

  test("says so plainly when the queue is clear", async ({ page }) => {
    await stub(page, {
      permissions: ["approvals.view", "approvals.decide"],
      empty: true,
    });
    await gotoScreen(page, "/approvals");

    await expect(page.locator(".today-empty")).toBeVisible();
    await assertReadable(page);
    await assertNoHorizontalScroll(page);
  });
});
