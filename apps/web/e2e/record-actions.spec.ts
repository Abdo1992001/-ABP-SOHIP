import { test, expect, type Page } from "@playwright/test";
import { gotoScreen } from "./helpers.js";

/**
 * Acting on a record from a generic list screen.
 *
 * The interesting part of the cheque panel is not the buttons it shows — it is
 * the ones it refuses to show. A cleared cheque cannot be deposited again, and
 * a screen that offers the button anyway produces a 400 the user cannot
 * interpret and learns to distrust. The state machine is the server's, so the
 * test is really asking: does the client agree with the server about what is
 * possible?
 */

const CHEQUE_ID = "dd000000-0000-4000-8000-000000000001";

function me(permissions: string[]) {
  return {
    data: {
      user: {
        userId: "10000000-0000-4000-8000-000000000001",
        email: "finance@abp.local",
        displayName: "Finance",
        authStatusCode: "ACTIVE",
        rowVersion: '"rv-1"',
        mfaEnabled: false,
        mfaRequired: false,
        mustChangePassword: false,
      },
      access: {
        roles: [{ code: "FINANCE", name: "Finance" }],
        permissions,
        countryScope: { countryCodes: ["EG"], enforced: true },
        workspaces: [{ workspace: "FINANCE", enabled: true, capabilities: [] }],
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

function cheques(statusCode: string) {
  return {
    data: [
      {
        chequeId: CHEQUE_ID,
        chequeNumber: "000100407",
        bankName: "Banque Misr",
        amount: "92500.0000",
        currencyCode: "EGP",
        dueDate: "2026-04-21",
        issueDate: "2026-02-10",
        statusCode,
        rowVersion: "3",
      },
    ],
    meta: { total: 1, page: 1, limit: 25 },
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
    if (url.pathname.endsWith("/status-transitions")) {
      opts.capture?.(route.request().postDataJSON() as Record<string, unknown>);
      return json({ data: { success: true } });
    }
    if (url.pathname.endsWith("/finance/cheques"))
      return json(cheques(opts.status));
    return json({ data: [], meta: { total: 0, unreadCount: 0 } });
  });
}

const FINANCE = ["cheques.view", "cheques.manage"];

async function openCheque(page: Page) {
  await gotoScreen(page, "/finance/cheques");
  await page.locator(".record-row").first().click();
}

test.describe("record actions", () => {
  test("a deposited cheque can clear or bounce, and says why it needs a reason", async ({
    page,
  }) => {
    const sent: Record<string, unknown>[] = [];
    await stub(page, {
      status: "DEPOSITED",
      permissions: FINANCE,
      capture: (body) => sent.push(body),
    });
    await openCheque(page);

    const panel = page.locator(".record-actions");
    await expect(panel).toBeVisible();

    // The server's table for DEPOSITED is CLEARED / BOUNCED / CANCELLED.
    const cleared = panel.getByRole("button", { name: /Cleared|محصّل/ });
    await expect(cleared).toBeVisible();
    await expect(
      panel.getByRole("button", { name: /Bounced|مرتجع/ }),
    ).toBeVisible();

    // Nothing is possible without a reason, and the screen says so.
    await expect(cleared).toBeDisabled();
    await expect(panel).toContainText(/reason|السبب/i);

    await panel
      .locator("input")
      .first()
      .fill("Bank confirmed on the statement");
    await expect(cleared).toBeEnabled();
    await cleared.click();
    // Deliberate second step: money movement is not a one-click action.
    await panel.getByRole("button", { name: /Confirm|تأكيد/ }).click();

    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]!.targetStatusCode).toBe("CLEARED");
    expect(sent[0]!.reason).toBe("Bank confirmed on the statement");
    // The row's own token, in the bare-integer form this module uses.
    expect(sent[0]!.expectedRowVersion).toBe("3");
  });

  test("a cleared cheque offers nothing, because nothing is possible", async ({
    page,
  }) => {
    await stub(page, { status: "CLEARED", permissions: FINANCE });
    await openCheque(page);

    const panel = page.locator(".record-actions");
    await expect(panel).toHaveCount(0);
    // It explains the absence rather than leaving a blank panel.
    await expect(
      page.locator(".slide-over, .slideover, [role='dialog']").first(),
    ).toContainText(/final|نهائي/i);
  });

  test("offers nothing at all without cheques.manage", async ({ page }) => {
    await stub(page, { status: "DEPOSITED", permissions: ["cheques.view"] });
    await openCheque(page);

    await expect(page.locator(".record-actions")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /Cleared|محصّل/ }),
    ).toHaveCount(0);
  });
});
