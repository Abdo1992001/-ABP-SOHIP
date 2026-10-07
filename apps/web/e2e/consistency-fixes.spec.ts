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
      permissions: [
        "sales.workspace.view",
        "accounts.view",
        "quotations.view",
        "logistics.view",
        "customer-segments.view",
        "customer-segments.manage",
      ],
      countryScope: { countryCodes: ["EG"], enforced: true },
      workspaces: [
        { workspace: "SALES", enabled: true, capabilities: [] },
        { workspace: "LOGISTICS", enabled: true, capabilities: [] },
        { workspace: "ADMIN", enabled: true, capabilities: [] },
      ],
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

async function stub(page: Page) {
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(body),
      });

    if (url.pathname.endsWith("/me")) return json(me);
    if (url.pathname.endsWith("/accounts")) {
      return json({
        data: [
          {
            accountId: ACCOUNT_ID,
            accountRef: "ACC-EG-0042",
            canonicalName: "Cairo Construction Group",
            customerNumber: "C-1042",
            countryCode: "EG",
            country: { displayName: "Egypt" },
            accountCategoryCode: "STRATEGIC",
            // Required by the contract since the customer type was added.
            // Leaving it out was not a harmless omission: the grid read it
            // unguarded and the whole customer screen fell to the error
            // boundary, which is what this test caught.
            businessTypeCode: "FORMWORK",
            recordStatusCode: "ACTIVE",
          },
        ],
        meta: { page: 1, offset: 0, limit: 25, total: 1, hasNext: false },
      });
    }
    if (url.pathname.endsWith("/customer-segments")) {
      return json({
        data: [
          {
            segmentId: "55000000-0000-4000-8000-000000000001",
            name: "Strategic accounts",
            recordStatusCode: "ACTIVE",
          },
        ],
        meta: { page: 1, offset: 0, limit: 25, total: 1, hasNext: false },
      });
    }
    return json({ data: [], meta: { total: 0, unreadCount: 0 } });
  });
}

test("keeps customer status and actions visible at tablet width", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "light-en");
  await page.setViewportSize({ width: 900, height: 900 });
  await stub(page);
  await gotoScreen(page, "/customers");

  await expect(page.locator(".customer-list-table thead")).toBeHidden();
  await expect(
    page.getByRole("row").getByText("Active", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open Cairo Construction Group" }),
  ).toBeVisible();
  await assertNoHorizontalScroll(page);
  await page.screenshot({
    path: testInfo.outputPath("customers-tablet.png"),
    fullPage: true,
    animations: "disabled",
  });
});

test("localizes the embedded Cargo Loader and applies RTL", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "light-ar");
  await stub(page);
  await gotoScreen(page, "/logistics/cargo-loader");

  // The loader used to be a separate application in an iframe, and this test
  // reached into that frame to check it had been localized. It is now a screen
  // in the CRM, so there is no frame to reach into and nothing to localize
  // separately — the check is that the chain it exists for is on the page, in
  // Arabic, in the shell's own RTL.
  await expect(page.locator(".cargo-page")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("iframe")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "محمّل الحاويات" }),
  ).toBeVisible();

  // Boards in, bundles out: the arithmetic the screen exists for. Scoped to
  // the panel headings, because "الألواح" is also a column and a KPI label.
  const panels = page.locator(".cargo-panel > h2");
  await expect(panels.filter({ hasText: "الألواح" }).first()).toBeVisible();
  await expect(panels.filter({ hasText: "من الألواح للحزم" })).toBeVisible();
  const bundles = page.locator(".cargo-bundle-table tbody tr");
  await expect(bundles).toHaveCount(1);
  // The default board is 15mm at 37.95kg, so a 1,500kg band holds 35 of them.
  await expect(bundles.first()).toContainText("٣٥");
  await page.screenshot({
    path: testInfo.outputPath("cargo-loader-ar.png"),
    fullPage: true,
    animations: "disabled",
  });
});

test("keeps generic screens free of operation ids and raw UUID labels", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "light-ar");
  await stub(page);
  await gotoScreen(page, "/admin/customer-segments");

  await expect(page.locator("main")).not.toContainText("get_customer_segments");
  await expect(page.locator("main")).not.toContainText(
    "55000000-0000-4000-8000-000000000001",
  );
  await expect(
    page.getByRole("heading", { name: "قطاعات العملاء" }),
  ).toBeVisible();
  await assertNoHorizontalScroll(page);
});
