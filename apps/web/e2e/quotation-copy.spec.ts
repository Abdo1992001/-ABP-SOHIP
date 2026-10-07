import { expect, test, type Page } from "@playwright/test";
import { assertNoHorizontalScroll, gotoScreen } from "./helpers.js";

const SOURCE_ID = "bb000000-0000-4000-8000-000000000001";
const CREATED_ID = "bb000000-0000-4000-8000-000000000002";

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
      permissions: ["quotations.view", "quotations.create", "quotations.edit"],
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

function quotation(quotationId = SOURCE_ID, statusCode = "EXPIRED") {
  return {
    quotationId,
    quoteRef: quotationId === SOURCE_ID ? "QT-2026-0042" : "QT-2026-0043",
    statusCode,
    commercialState: "NOT_SUBMITTED",
    accountId: "aa000000-0000-4000-8000-000000000001",
    opportunityId: "cc000000-0000-4000-8000-000000000001",
    countryCode: "EG",
    currencyCode: "EGP",
    grandTotalAmount: "128400",
    subtotalAmount: "128400",
    totalAmount: "128400",
    validFrom: "2026-09-01",
    expiresOn: "2026-09-08",
    rowVersion: '"rv-4"',
    lines: [],
    adjustments: [],
  };
}

async function stub(page: Page) {
  const copyRequests: Record<string, unknown>[] = [];
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (body: unknown) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(body),
      });

    if (url.pathname.endsWith("/me")) return json(me);
    if (url.pathname.endsWith(`/quotations/${SOURCE_ID}/supersede`)) {
      copyRequests.push(request.postDataJSON() as Record<string, unknown>);
      return json({ data: quotation(CREATED_ID, "DRAFT") });
    }
    if (url.pathname.endsWith(`/quotations/${SOURCE_ID}`))
      return json({ data: quotation() });
    if (url.pathname.endsWith(`/quotations/${CREATED_ID}`))
      return json({ data: quotation(CREATED_ID, "DRAFT") });
    if (url.pathname.endsWith("/quotations"))
      return json({
        data: [quotation()],
        meta: { page: 1, offset: 0, limit: 25, total: 1, hasNext: false },
      });
    return json({ data: [], meta: { total: 0, unreadCount: 0 } });
  });
  return copyRequests;
}

test("creates a new draft directly from a historical quotation row", async ({
  page,
}) => {
  const copyRequests = await stub(page);
  await gotoScreen(page, "/quotations");

  const copyButton = page.getByRole("button", {
    name: /Create new from this quotation|إنشاء عرض جديد من هذا العرض/,
  });
  await expect(copyButton).toBeVisible();
  await copyButton.click();

  await expect(page).toHaveURL(new RegExp(`/quotations/${CREATED_ID}$`));
  expect(copyRequests).toEqual([
    { expectedRowVersion: '"rv-4"', copyRecipients: false },
  ]);
});

test("keeps the create-from-previous action visible and responsive in the detail header", async ({
  page,
}, testInfo) => {
  await stub(page);
  await gotoScreen(page, `/quotations/${SOURCE_ID}`);

  const copyButton = page.getByRole("button", {
    name: /Create new from this quotation|إنشاء عرض جديد من هذا العرض/,
  });
  await expect(copyButton).toBeVisible();
  const box = await copyButton.boundingBox();
  expect(box).not.toBeNull();
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(
    page.viewportSize()?.width ?? 0,
  );
  await assertNoHorizontalScroll(page);
  await page.screenshot({
    path: testInfo.outputPath("quotation-copy-detail.png"),
    fullPage: true,
    animations: "disabled",
  });
});
