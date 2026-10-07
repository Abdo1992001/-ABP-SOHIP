import { expect, test, type Page } from "@playwright/test";
import { assertNoHorizontalScroll, gotoScreen } from "./helpers.js";

const me = {
  data: {
    user: {
      userId: "10000000-0000-4000-8000-000000000001",
      email: "sales@abp.local",
      displayName: "Sales Manager",
      authStatusCode: "ACTIVE",
      rowVersion: '"rv-1"',
      mfaEnabled: false,
      mfaRequired: false,
      mustChangePassword: false,
    },
    access: {
      roles: [{ code: "SALES_MANAGER", name: "Sales manager" }],
      permissions: [
        "accounts.view",
        "opportunities.view",
        "activities.view",
        "quotations.view",
      ],
      countryScope: { countryCodes: ["EG"], enforced: true },
      workspaces: [{ workspace: "SALES", enabled: true, capabilities: [] }],
      policyVersion: 1,
    },
    session: {
      sessionId: "s",
      assurance: "PASSWORD",
      authTransport: "BFF_COOKIE",
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3.6e6).toISOString(),
    },
    stepUp: { required: false, satisfied: true, permittedMethods: [] },
  },
};

async function stub(page: Page, items: Record<string, unknown>[]) {
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(body),
      });

    if (url.pathname.endsWith("/me")) return json(me);
    if (url.pathname.endsWith("/action-queue"))
      return json({ data: items, meta: { total: items.length } });
    return json({ data: [], meta: { total: 0, unreadCount: 0 } });
  });
}

test("empty action queue stays compact and offers useful next steps", async ({
  page,
}, testInfo) => {
  await stub(page, []);
  await gotoScreen(page, "/actions");

  await expect(
    page.getByRole("heading", { name: /All clear|القائمة مخلّصة/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Open follow-ups|افتح المتابعات/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Review quotations|راجع عروض الأسعار/ }),
  ).toBeVisible();

  const mark = page.locator(".action-queue-empty-mark");
  const markBox = await mark.boundingBox();
  expect(markBox).not.toBeNull();
  expect(markBox?.width ?? 0).toBeLessThanOrEqual(60);
  expect(markBox?.height ?? 0).toBeLessThanOrEqual(60);
  await assertNoHorizontalScroll(page);
  await page.screenshot({
    path: testInfo.outputPath("action-queue-empty.png"),
    fullPage: true,
    animations: "disabled",
  });
});

test("action queue summarizes urgency and keeps every row actionable", async ({
  page,
}, testInfo) => {
  const now = Date.now();
  await stub(page, [
    {
      sourceTypeCode: "ACTIVITY",
      sourceId: "20000000-0000-4000-8000-000000000001",
      actionCode: "FOLLOW_UP",
      title: "Call Nile Contracting",
      subtitle: "Opportunity OPP-0142",
      href: "/activities",
      dueAt: new Date(now - 86_400_000).toISOString(),
      priorityCode: "OVERDUE",
      amount: null,
      currencyCode: null,
    },
    {
      sourceTypeCode: "QUOTATION",
      sourceId: "30000000-0000-4000-8000-000000000001",
      actionCode: "DRAFT_NOT_SENT",
      title: "QT-2026-0099",
      subtitle: "Nile Contracting",
      href: "/quotations/30000000-0000-4000-8000-000000000001",
      dueAt: new Date(now - 8 * 86_400_000).toISOString(),
      priorityCode: "STALE",
      amount: "250000",
      currencyCode: "EGP",
    },
  ]);
  await gotoScreen(page, "/actions");

  await expect(page.locator(".action-queue-summary")).toBeVisible();
  await expect(page.locator(".action-queue-row")).toHaveCount(2);
  await expect(page.getByText("Call Nile Contracting")).toBeVisible();
  await expect(page.getByText("QT-2026-0099")).toBeVisible();
  await expect(page.getByText(/250,000|٢٥٠٬٠٠٠/)).toBeVisible();
  await assertNoHorizontalScroll(page);
  await page.screenshot({
    path: testInfo.outputPath("action-queue-populated.png"),
    fullPage: true,
    animations: "disabled",
  });
});
