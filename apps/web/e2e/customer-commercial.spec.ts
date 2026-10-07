import { expect, test, type Page } from "@playwright/test";
import { assertNoHorizontalScroll, gotoScreen } from "./helpers.js";

const ACCOUNT_ID = "aa000000-0000-4000-8000-000000000001";

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
      permissions: ["accounts.view", "accounts.create", "accounts.edit"],
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

async function stubCustomers(page: Page) {
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(body),
      });

    if (url.pathname.endsWith("/me")) return json(me);
    if (url.pathname.endsWith("/reference/countries")) {
      return json({
        data: [
          {
            countryCode: "EG",
            displayName: "Egypt",
            isActive: true,
          },
        ],
      });
    }
    if (url.pathname.endsWith("/accounts/formwork-mix")) {
      return json({
        data: {
          targetPct: 70,
          month: {
            from: "2026-09-01",
            to: "2026-09-30",
            formworkCustomers: 7,
            otherCustomers: 3,
            totalCustomers: 10,
            sharePct: 70,
            gapPct: 0,
            statusCode: "ON_TARGET",
          },
          year: {
            from: "2026-01-01",
            to: "2026-12-31",
            formworkCustomers: 62,
            otherCustomers: 38,
            totalCustomers: 100,
            sharePct: 62,
            gapPct: 8,
            statusCode: "BELOW_TARGET",
          },
        },
      });
    }
    if (url.pathname.endsWith("/accounts")) {
      return json({
        data: [
          {
            accountId: ACCOUNT_ID,
            accountRef: "ACC-0042",
            customerNumber: "C-2048",
            canonicalName: "Nile Formwork",
            accountCategoryCode: "CONTRACTOR",
            businessTypeCode: "FORMWORK",
            ownerUserId: "10000000-0000-4000-8000-000000000001",
            recordStatusCode: "ACTIVE",
            country: { countryCode: "EG", displayName: "Egypt" },
          },
        ],
        meta: { page: 1, offset: 0, limit: 25, total: 1, hasNext: false },
      });
    }
    return json({ data: [], meta: { total: 0, unreadCount: 0 } });
  });
}

test.describe("customer commercial memory", () => {
  test.beforeEach(async ({ page }) => {
    await stubCustomers(page);
  });

  test("shows formwork mix and customer classification responsively", async ({
    page,
  }, testInfo) => {
    test.skip(
      !["dark-ar", "mobile"].includes(testInfo.project.name),
      "The visual contract is covered in Arabic desktop and mobile.",
    );

    await gotoScreen(page, "/customers");

    await expect(
      page.getByRole("heading", { name: /هدف الفورم ورك/ }),
    ).toBeVisible();
    await expect(page.getByText("70%", { exact: true })).toBeVisible();
    await expect(page.getByText("62%", { exact: true })).toBeVisible();
    await expect(
      page
        .getByRole("cell", { name: /عميل فورم ورك/ })
        .getByText("عميل فورم ورك", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("combobox", { name: "نوع العميل" }),
    ).toBeVisible();
    await assertNoHorizontalScroll(page);

    await expect(page).toHaveScreenshot(
      `customers-formwork-mix-${testInfo.project.name}.png`,
      { fullPage: true },
    );
  });
});
