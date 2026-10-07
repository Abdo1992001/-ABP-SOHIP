import { test, expect, type Page } from "@playwright/test";
import { gotoScreen } from "./helpers.js";

/**
 * Recording that the customer accepted.
 *
 * This writes a stage transition that moves the opportunity to won, so the
 * forecast, the pipeline and the targets are all downstream of it. The tests
 * are about the three rules that keep that number honest:
 *
 *  - only a quotation the customer has actually received can be accepted;
 *  - evidence is required, because a deal is won when you have the evidence,
 *    not when you have the promise;
 *  - it takes two deliberate steps, because it is not an edit, it is a close.
 */

const QUOTATION_ID = "bb000000-0000-4000-8000-000000000001";

function me(permissions: string[]) {
  return {
    data: {
      user: {
        userId: "10000000-0000-4000-8000-000000000001",
        email: "rep@abp.local",
        displayName: "Rep",
        authStatusCode: "ACTIVE",
        rowVersion: '"rv-1"',
        mfaEnabled: false,
        mfaRequired: false,
        mustChangePassword: false,
      },
      access: {
        roles: [{ code: "SALES_REP", name: "Sales" }],
        permissions,
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
}

function quotation(statusCode: string) {
  return {
    data: {
      quotationId: QUOTATION_ID,
      quotationRef: "QT-2026-0042",
      statusCode,
      commercialState: "SUBMITTED",
      currencyCode: "EGP",
      accountId: "aa000000-0000-4000-8000-000000000001",
      opportunityId: "cc000000-0000-4000-8000-000000000001",
      subtotalAmount: "128400",
      totalAmount: "128400",
      rowVersion: '"rv-4"',
      lines: [],
    },
  };
}

async function stub(
  page: Page,
  opts: {
    status: string;
    permissions: string[];
    capture?: (body: Record<string, unknown>) => void;
  },
) {
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (url.pathname.endsWith("/me")) return json(me(opts.permissions));
    if (url.pathname.endsWith("/acceptances")) {
      opts.capture?.(route.request().postDataJSON() as Record<string, unknown>);
      return json({
        data: {
          acceptance: { acceptanceId: "e1", evidenceTypeCode: "PO" },
          opportunity: { opportunityId: "cc", stageCode: "WON" },
        },
      });
    }
    if (/\/quotations\/[0-9a-f-]+$/.test(url.pathname))
      return json(quotation(opts.status));
    return json({ data: [], meta: { total: 0, unreadCount: 0 } });
  });
}

const SALES = ["quotations.view", "quotations.accept"];

async function openDocuments(page: Page) {
  await gotoScreen(page, `/quotations/${QUOTATION_ID}`);
  await page.getByRole("tab", { name: /Documents|المستندات/ }).click();
}

test.describe("quotation acceptance", () => {
  test("records the evidence and reports what happened to the deal", async ({
    page,
  }) => {
    const sent: Record<string, unknown>[] = [];
    await stub(page, {
      status: "SENT",
      permissions: SALES,
      capture: (body) => sent.push(body),
    });
    await openDocuments(page);

    const panel = page.locator(".acceptance-panel");
    await expect(panel).toBeVisible();

    const record = panel.getByRole("button", {
      name: /Record acceptance|سجّل القبول/,
    });
    // No evidence yet: the server would refuse, so the screen does too, and
    // says why rather than silently disabling a button.
    await expect(record).toBeDisabled();
    await expect(panel).toContainText(/evidence|الدليل/i);

    await panel.locator("input").first().fill("PO-99881");
    await expect(record).toBeEnabled();
    await record.click();

    // Winning a deal is two steps, not one.
    await expect.poll(() => sent.length).toBe(0);
    await panel
      .getByRole("button", { name: /mark this deal won|سجّلها مكسوبة/ })
      .click();

    await expect.poll(() => sent.length).toBe(1);
    const body = sent[0]!;
    expect(body.evidenceTypeCode).toBe("PO");
    expect(body.externalReference).toBe("PO-99881");
    expect(String(body.acceptedAt)).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // The toast reports the consequence, not just "saved".
    await expect(page.locator(".toast, [role='status']").first()).toContainText(
      /won|مكسوبة/i,
    );
  });

  test("a quotation the customer has not received cannot be accepted", async ({
    page,
  }) => {
    await stub(page, { status: "DRAFT", permissions: SALES });
    await openDocuments(page);

    // The server refuses anything but SENT, so the panel is absent rather
    // than present-and-failing.
    await expect(page.locator(".acceptance-panel")).toHaveCount(0);
  });

  test("offers nothing without quotations.accept", async ({ page }) => {
    await stub(page, { status: "SENT", permissions: ["quotations.view"] });
    await openDocuments(page);

    await expect(page.locator(".acceptance-panel")).toHaveCount(0);
  });
});
