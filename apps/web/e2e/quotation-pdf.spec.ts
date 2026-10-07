import { expect, test, type Page } from "@playwright/test";
import { assertNoHorizontalScroll, gotoScreen } from "./helpers.js";

/**
 * Reading a past quotation out of its PDF, and accepting the reading.
 *
 * The reading below is the one the real parser produced from the real
 * `001-NOV-ABP-2025` quotation, and the rows it could not resolve are the
 * ones that document actually contains. It is inlined rather than read from a
 * PDF because the parser is tested against all 167 real binaries on its own
 * side; what these check is the part only a browser can answer — that a
 * person is told what the reading disagrees with, and that accepting it sends
 * the figures that were read rather than something reassembled on the way.
 *
 * The uploaded bytes are a stub: the read endpoint is mocked, so the file's
 * contents never reach a parser here, and a real customer quotation has no
 * business sitting in a repository.
 */

const ACCOUNT = "aa000000-0000-4000-8000-000000000001";
const OTHER_ACCOUNT = "aa000000-0000-4000-8000-000000000002";
const OPPORTUNITY = "cc000000-0000-4000-8000-000000000001";
const CREATED = "dd000000-0000-4000-8000-000000000009";

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
        "quotations.view",
        "quotations.create",
        "quotations.edit",
        "accounts.view",
        "opportunities.view",
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

/** As read from `001-NOV-ABP-2025`, which reconciles against its own total. */
const cleanReading = {
  data: {
    quoteRef: "001-NOV-ABP-2025",
    quoteDate: "Tuesday, December 16, 2025",
    clientName: "Concord for Engineering & Contracting",
    projectName: "(General use )",
    attention: "Eng / Ahmed Fekry",
    salesEngineer: "Eng . Nabil Emad - +20 1029869858",
    subject: "Acrow M Board",
    lines: [
      {
        description: "Acrow Board 18 mm × 1220 mm × 2440 mm ( M Board )",
        qty: 88,
        unitPrice: 3000,
        lineTotal: 264000,
      },
      {
        description: "Acrow Curved Board 18 mm × 1000 mm × 2000 mm ( M Board )",
        qty: 64,
        unitPrice: 3888,
        lineTotal: 248832,
      },
    ],
    subtotal: 512832,
    unreconciledRows: [],
    printedTotals: [
      { label: "total", value: 512832 },
      { label: "vat (14%)", value: 71796.48 },
    ],
    terms: [{ label: "Payment", value: "100 % in advance" }],
    reconciled: true,
  },
};

/** As read from `mark safi`, whose transport row no arithmetic resolves. */
const shortReading = {
  data: {
    ...cleanReading.data,
    quoteRef: null,
    quoteDate: "Thursday, April 16, 2026",
    clientName: "Mark Safi",
    lines: [
      {
        description: "ACROW BOARD 18 mm × 1220 mm× 2440 mm(M -BOARD)",
        qty: 600,
        unitPrice: 64,
        lineTotal: 38400,
      },
    ],
    subtotal: 38400,
    unreconciledRows: [
      "2 Transportation (CIF) to the Port of Tema, Ghana 40 FTContanier 3496",
    ],
    printedTotals: [{ label: "total", value: 41896 }],
    reconciled: false,
  },
};

const accounts = {
  data: [
    {
      accountId: ACCOUNT,
      accountRef: "ACC-1",
      customerNumber: "C-1",
      // The record spells out "and" where the document prints "&".
      canonicalName: "Concord for Engineering and Contracting",
      country: null,
      accountCategoryCode: "STANDARD",
      businessTypeCode: "FORMWORK",
      ownerUserId: me.data.user.userId,
      recordStatusCode: "ACTIVE",
    },
    {
      accountId: OTHER_ACCOUNT,
      accountRef: "ACC-2",
      customerNumber: "C-2",
      canonicalName: "Hassan Allam Construction",
      country: null,
      accountCategoryCode: "STANDARD",
      businessTypeCode: "FORMWORK",
      ownerUserId: me.data.user.userId,
      recordStatusCode: "ACTIVE",
    },
  ],
  meta: { page: 1, offset: 0, limit: 200, total: 2, hasNext: false },
};

const opportunities = {
  data: [
    {
      opportunityId: OPPORTUNITY,
      opportunityRef: "OPP-2026-0014",
      title: "Gates package",
      accountId: ACCOUNT,
      projectId: null,
      countryCode: "EG",
      ownerUserId: me.data.user.userId,
      stageCode: "QUALIFIED",
      probabilityPct: "40",
      probabilitySourceCode: "STAGE_DEFAULT",
      estimatedValue: "500000",
      currencyCode: "EGP",
      expectedCloseDate: "2026-11-01",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ],
  meta: { page: 1, offset: 0, limit: 100, total: 1, hasNext: false },
};

interface Sent {
  contentType?: string | undefined;
  create?: unknown;
  draft?: unknown;
}

async function stub(page: Page, reading: unknown) {
  const sent: Sent = {};
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
    if (url.pathname.endsWith("/quotations/read-pdf")) {
      sent.contentType = request.headers()["content-type"];
      return json(reading);
    }
    if (url.pathname.endsWith("/accounts")) return json(accounts);
    if (url.pathname.endsWith("/opportunities")) return json(opportunities);
    if (url.pathname.endsWith("/draft-content")) {
      sent.draft = request.postDataJSON();
      return json({ data: { quotationId: CREATED, rowVersion: '"rv-2"' } });
    }
    if (url.pathname.endsWith("/quotations") && request.method() === "POST") {
      sent.create = request.postDataJSON();
      return json({
        data: {
          quotationId: CREATED,
          quoteRef: "QT-2026-0099",
          statusCode: "DRAFT",
          commercialState: "NOT_SUBMITTED",
          accountId: ACCOUNT,
          countryCode: "EG",
          currencyCode: "EGP",
          rowVersion: '"rv-1"',
          lines: [],
          adjustments: [],
        },
      });
    }
    if (url.pathname.includes(`/quotations/${CREATED}`))
      return json({
        data: {
          quotationId: CREATED,
          quoteRef: "QT-2026-0099",
          statusCode: "DRAFT",
          commercialState: "NOT_SUBMITTED",
          accountId: ACCOUNT,
          countryCode: "EG",
          currencyCode: "EGP",
          rowVersion: '"rv-2"',
          lines: [],
          adjustments: [],
        },
      });
    if (url.pathname.endsWith("/quotations"))
      return json({
        data: [],
        meta: { page: 1, offset: 0, limit: 25, total: 0, hasNext: false },
      });
    return json({ data: [], meta: { total: 0, unreadCount: 0 } });
  });
  return sent;
}

async function openReader(page: Page) {
  await gotoScreen(page, "/quotations");
  await page
    .getByRole("button", { name: /Read a past PDF|قراءة PDF سابق/ })
    .click();
  await page.locator("#quotation-pdf-file").setInputFiles({
    name: "quotation.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4 stub"),
  });
  await page.locator(".pdf-reader-verdict").waitFor({ state: "visible" });
}

test.describe("reading a past quotation PDF", () => {
  test("sends the file as a PDF and says the reading agrees with the paper", async ({
    page,
  }) => {
    const sent = await stub(page, cleanReading);
    await openReader(page);

    expect(sent.contentType).toBe("application/pdf");
    const verdict = page.locator(".pdf-reader-verdict");
    await expect(verdict).toHaveClass(/is-ok/);
    await expect(verdict).toContainText(
      /add up to the total|بتجمع على الإجمالي/,
    );
    await assertNoHorizontalScroll(page);
  });

  test("puts a reading that disagrees with the paper, and the row behind it, in front of the reader", async ({
    page,
  }) => {
    await stub(page, shortReading);
    await openReader(page);

    const verdict = page.locator(".pdf-reader-verdict");
    await expect(verdict).toHaveClass(/is-off/);
    // The gap is 41,896 - 38,400 = 3,496, which is the transport row, and the
    // row is shown rather than a quantity being assumed for it.
    await expect(page.locator(".pdf-reader-flagged li")).toContainText(
      /Transportation \(CIF\)/,
    );
    await expect(page.locator(".pdf-reader-accept")).toContainText(
      /NOT copied into the draft|مش بتتنسخ في المسودة/,
    );
  });

  test("preselects the customer only when the name matches exactly", async ({
    page,
  }) => {
    await stub(page, cleanReading);
    await openReader(page);

    // "Concord for Engineering & Contracting" against a record that spells
    // out "and": the same name, and the only exact match, so it is chosen.
    const customer = page.locator(".pdf-reader-accept-fields select").first();
    await expect(customer).toHaveValue(ACCOUNT);
    await expect(page.locator(".pdf-reader-match")).toContainText(
      /matches it exactly|مطابق بالظبط/,
    );
  });

  test("chooses no customer for a client the system does not hold", async ({
    page,
  }) => {
    await stub(page, shortReading);
    await openReader(page);

    const customer = page.locator(".pdf-reader-accept-fields select").first();
    await expect(customer).toHaveValue("");
    await expect(page.locator(".pdf-reader-match")).toContainText(
      /no customer on the system matches|مفيش عميل على النظام/,
    );
  });

  test("cannot create a draft until a deal is chosen", async ({ page }) => {
    await stub(page, cleanReading);
    await openReader(page);

    const create = page.getByRole("button", {
      name: /Create draft quotation|اعمل مسودة عرض سعر/,
    });
    await expect(create).toBeDisabled();
  });

  test("creates the draft with the figures that were read", async ({
    page,
  }) => {
    const sent = await stub(page, cleanReading);
    await openReader(page);

    await page
      .locator(".pdf-reader-accept-fields select")
      .nth(1)
      .selectOption(OPPORTUNITY);
    await page
      .getByRole("button", {
        name: /Create draft quotation|اعمل مسودة عرض سعر/,
      })
      .click();

    await expect(page).toHaveURL(new RegExp(`/quotations/${CREATED}$`));
    expect(sent.create).toEqual({ opportunityId: OPPORTUNITY });
    expect(sent.draft).toEqual({
      lines: [
        {
          description: "Acrow Board 18 mm × 1220 mm × 2440 mm ( M Board )",
          qty: "88",
          unitCode: "PIECE",
          unitPrice: "3000",
        },
        {
          description:
            "Acrow Curved Board 18 mm × 1000 mm × 2000 mm ( M Board )",
          qty: "64",
          unitCode: "PIECE",
          unitPrice: "3888",
        },
      ],
    });
  });
});
