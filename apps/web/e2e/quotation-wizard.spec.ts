import { expect, test, type Page } from "@playwright/test";
import { assertNoHorizontalScroll, gotoScreen } from "./helpers.js";

const ACCOUNT_ID = "aa000000-0000-4000-8000-000000000001";
const OPPORTUNITY_ID = "cc000000-0000-4000-8000-000000000001";
const NEW_OPPORTUNITY_ID = "cc000000-0000-4000-8000-000000000002";
const QUOTATION_ID = "dd000000-0000-4000-8000-000000000001";

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
        "quotations.view",
        "quotations.create",
        "quotations.edit",
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

async function stubWizard(page: Page) {
  const savedDrafts: Record<string, unknown>[] = [];
  const createdDeals: Record<string, unknown>[] = [];
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (body: unknown) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { etag: '"rv-2"' },
        body: JSON.stringify(body),
      });

    if (url.pathname.endsWith("/me")) return json(me);
    if (url.pathname.endsWith("/accounts")) {
      return json({
        data: [
          {
            accountId: ACCOUNT_ID,
            accountRef: "ACC-0001",
            canonicalName: "Nile Contracting",
            businessTypeCode: "FORMWORK",
            countryCode: "EG",
            statusCode: "ACTIVE",
          },
        ],
        meta: { page: 1, offset: 0, limit: 25, total: 1, hasNext: false },
      });
    }
    if (url.pathname.endsWith(`/accounts/${ACCOUNT_ID}/commercial-history`)) {
      return json({
        data: {
          accountId: ACCOUNT_ID,
          businessTypeCode: "FORMWORK",
          currencyCode: "EGP",
          totalValue: "0",
          orderCount: 0,
          itemCount: 0,
          markets: [],
          products: [],
          orders: [],
          priceHistory: [
            {
              quotationId: "dd000000-0000-4000-8000-000000000099",
              quotationRef: "QT-2026-0042",
              quotationStatusCode: "SENT",
              quotedOn: "2026-08-15",
              lineNo: 1,
              description: "Acrow Board 18 × 1220 × 2440",
              materialClass: "STANDARD",
              unitCode: "PIECE",
              unitPrice: "2800",
              pricePerKg: "87.093",
              weightPerPieceKg: "32.14944",
              boardWidthMm: "1220",
              boardLengthMm: "2440",
              thicknessMm: "18",
              currencyCode: "EGP",
            },
          ],
        },
      });
    }
    if (
      url.pathname.endsWith("/opportunities") &&
      request.method() === "POST"
    ) {
      createdDeals.push(request.postDataJSON() as Record<string, unknown>);
      return json({
        data: {
          opportunityId: NEW_OPPORTUNITY_ID,
          opportunityRef: "OPP-0043",
          accountId: ACCOUNT_ID,
          title: "Fresh quotation scope",
          stageCode: "QUALIFIED",
        },
      });
    }
    if (url.pathname.endsWith("/opportunities")) {
      return json({
        data: [
          {
            opportunityId: OPPORTUNITY_ID,
            opportunityRef: "OPP-0042",
            accountId: ACCOUNT_ID,
            title: "New Cairo tower",
            stageCode: "QUALIFIED",
          },
          ...(createdDeals.length
            ? [
                {
                  opportunityId: NEW_OPPORTUNITY_ID,
                  opportunityRef: "OPP-0043",
                  accountId: ACCOUNT_ID,
                  title: "Fresh quotation scope",
                  stageCode: "QUALIFIED",
                },
              ]
            : []),
        ],
        meta: { page: 1, offset: 0, limit: 50, total: 1, hasNext: false },
      });
    }
    if (url.pathname.endsWith("/pricing/standard-board-basis")) {
      return json({
        data: {
          standardPricePerKg: "77.76185215045737",
          curvedPricePerKg: "120",
          circularPricePerKg: "120",
          defaultDensityKgM3: "600",
          defaultThicknessMm: "18",
          referenceBoardWidthMm: "1220",
          referenceBoardLengthMm: "2440",
          standardWeightKg: "32.14944",
          standardBoardPrice: "2500",
          defaultDiscountPct: "0",
        },
      });
    }
    if (
      url.pathname.endsWith(`/quotations/${QUOTATION_ID}/draft-content`) &&
      request.method() === "PUT"
    ) {
      savedDrafts.push(request.postDataJSON() as Record<string, unknown>);
      return json({
        data: { quotationId: QUOTATION_ID, rowVersion: '"rv-3"' },
      });
    }
    if (url.pathname.endsWith("/quotations") && request.method() === "POST") {
      return json({
        data: {
          quotationId: QUOTATION_ID,
          quoteRef: "QT-2026-0099",
          rowVersion: '"rv-2"',
          statusCode: "DRAFT",
        },
      });
    }
    if (url.pathname.endsWith(`/quotations/${QUOTATION_ID}`)) {
      return json({
        data: {
          quotationId: QUOTATION_ID,
          quoteRef: "QT-2026-0099",
          statusCode: "DRAFT",
          rowVersion: '"rv-3"',
          lines: [],
          adjustments: [],
        },
      });
    }
    return json({ data: [], meta: { total: 0, unreadCount: 0 } });
  });
  return { createdDeals, savedDrafts };
}

test("builds, reviews and saves a workbook-aligned regular-column quotation", async ({
  page,
}, testInfo) => {
  test.skip(
    !["light-en", "dark-ar", "mobile"].includes(testInfo.project.name),
    "English, Arabic dark mode and one phone layout cover this focused workflow.",
  );
  const { savedDrafts } = await stubWizard(page);
  await gotoScreen(page, "/quotation-wizard");

  await page.getByRole("button", { name: /Nile Contracting/ }).click();
  await expect(
    page.getByText(/What this customer was quoted before|العميل اتسعّر له/),
  ).toBeVisible();
  await expect(page.getByText("QT-2026-0042")).toBeVisible();
  await page.getByRole("button", { name: /Use rate|استخدم السعر/ }).click();
  await page
    .getByLabel(/Which deal\?|أي فرصة بيعية؟/)
    .selectOption(OPPORTUNITY_ID);
  await page
    .getByRole("button", { name: /Continue to items|كمّل للبنود/ })
    .click();

  await expect(
    page.getByRole("heading", { name: /Pricing basis|أساس التسعير/ }),
  ).toBeVisible();
  await expect(
    page.getByText(/Quotation override|سعر خاص بالعرض/),
  ).toBeVisible();
  const pricingValue = page.getByLabel(
    /Standard pricing value|قيمة تسعير اللوح القياسي/,
  );
  await expect(pricingValue).toHaveValue("2799.99");
  await page.getByRole("button", { name: /By kilogram|حسب الكيلو/ }).click();
  await expect(pricingValue).toHaveValue("87.09");
  await page.getByRole("button", { name: /By board|حسب اللوح/ }).click();
  await expect(pricingValue).toHaveValue("2799.99");
  await pricingValue.fill("3000");
  await expect(page.getByText("93.31", { exact: true })).toBeVisible();
  await expect(
    page.locator(".wizard-reference-board").getByText("3,000.00"),
  ).toBeVisible();
  await page.getByRole("button", { name: /Reset|رجوع لسعر الشركة/ }).click();
  await expect(pricingValue).toHaveValue("2500.00");
  await page
    .getByText(/Side A|الضلع A/)
    .locator("..")
    .getByRole("spinbutton")
    .fill("600");
  await page
    .getByText(/Side B|الضلع B/)
    .locator("..")
    .getByRole("spinbutton")
    .fill("400");

  await expect(
    page.getByText(/All items are ready|كل البنود جاهزة/),
  ).toBeVisible();
  await assertNoHorizontalScroll(page);
  await page.evaluate(() => {
    document.querySelector<HTMLElement>(".app-main")?.scrollTo(0, 0);
  });
  await page.screenshot({
    path: testInfo.outputPath(`quotation-wizard-${testInfo.project.name}.png`),
    fullPage: true,
    animations: "disabled",
  });

  await page
    .getByRole("button", { name: /Review quotation|راجع عرض السعر/ })
    .click();
  await expect(
    page.getByRole("heading", { name: /Everything in one place|كل البيانات/ }),
  ).toBeVisible();
  await expect(page.getByText(/Ready to save|جاهز للحفظ/)).toBeVisible();
  await assertNoHorizontalScroll(page);
  await page.evaluate(() => {
    document.querySelector<HTMLElement>(".app-main")?.scrollTo(0, 0);
  });
  await page.screenshot({
    path: testInfo.outputPath(
      `quotation-wizard-review-${testInfo.project.name}.png`,
    ),
    fullPage: true,
    animations: "disabled",
  });

  await page
    .getByRole("button", { name: /Create quotation draft|إنشاء مسودة/ })
    .click();
  await expect(page).toHaveURL(new RegExp(`/quotations/${QUOTATION_ID}$`));

  expect(savedDrafts).toHaveLength(1);
  const saved = savedDrafts[0] as {
    lines?: Array<Record<string, unknown>>;
    adjustments?: unknown[];
    standardPricePerKgOverride?: unknown;
    densityOverrideKgM3?: unknown;
  };
  expect(saved.lines?.[0]).toMatchObject({
    materialClass: "REGULAR",
    category: "COLUMN",
    sectionLabel: "REGULAR COLUMNS",
    sideAMm: "600",
    sideBMm: "400",
    columnHeightMm: "4000",
    thicknessMm: "18",
    maxPanelWidthMm: "1220",
    maxPanelLengthMm: "2000",
    autoDescribe: true,
  });
  expect(saved.adjustments).toEqual([]);
  expect(saved.standardPricePerKgOverride).toBeNull();
  expect(saved.densityOverrideKgM3).toBeNull();
});

test("can start a fresh quotation when the customer already has an older deal", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "light-en",
    "The interaction is locale-independent and only needs one browser run.",
  );
  const { createdDeals } = await stubWizard(page);
  await gotoScreen(page, "/quotation-wizard");
  await assertNoHorizontalScroll(page);
  await page.screenshot({
    path: testInfo.outputPath("quotation-wizard-customer-picker.png"),
    fullPage: true,
    animations: "disabled",
  });

  await page.getByRole("button", { name: /Nile Contracting/ }).click();
  await expect(page.getByText("Selected customer")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Nile Contracting" }),
  ).toHaveCount(0);

  await page
    .getByRole("button", { name: "+ New deal for this customer" })
    .click();
  await page.screenshot({
    path: testInfo.outputPath("quotation-wizard-new-deal.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.getByLabel("Name the deal").fill("Fresh quotation scope");
  await page.getByRole("button", { name: "Create deal" }).click();

  await expect(page.getByLabel(/Which deal\?/)).toHaveValue(NEW_OPPORTUNITY_ID);
  expect(createdDeals).toEqual([
    {
      title: "Fresh quotation scope",
      accountId: ACCOUNT_ID,
      noProjectReasonCode: "DIRECT_SUPPLY",
    },
  ]);

  await page.getByRole("button", { name: /Continue to items/ }).click();
  await expect(
    page.getByRole("heading", { name: "Pricing basis" }),
  ).toBeVisible();
  await assertNoHorizontalScroll(page);
});

test("keeps several Arabic scopes grouped as compact cards", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "dark-ar",
    "This is the focused RTL visual regression for the multi-scope layout.",
  );
  await stubWizard(page);
  await gotoScreen(page, "/quotation-wizard");
  await page.getByRole("button", { name: /Nile Contracting/ }).click();
  await page.getByLabel(/أي فرصة بيعية؟/).selectOption(OPPORTUNITY_ID);
  await page.getByRole("button", { name: /كمّل للبنود/ }).click();

  await page
    .getByRole("button", { name: "+ قياسي (لوح مسطح)", exact: true })
    .click();
  await page.getByRole("button", { name: "+ كور", exact: true }).click();

  await expect(page.locator(".wizard-items-table tbody tr")).toHaveCount(3);
  await assertNoHorizontalScroll(page);
  await page.evaluate(() => {
    document
      .querySelector<HTMLElement>(".wizard-items-heading")
      ?.scrollIntoView({ block: "start" });
  });
  await page.screenshot({
    path: testInfo.outputPath("quotation-wizard-multi-scope-dark-ar.png"),
    fullPage: false,
    animations: "disabled",
  });
});
