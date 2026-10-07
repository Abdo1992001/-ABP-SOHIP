import { test, expect, type Page } from "@playwright/test";
import { gotoScreen, assertReadable, assertLabeled } from "./helpers.js";

/**
 * Account recovery, which is the one place the admin screen touches a
 * credential — so the tests are about what is *sent*, not only what is drawn.
 *
 * Three things have to hold: the administrator never picks the password, the
 * reset always forces a change at next sign-in, and neither action fires
 * without a confirmation step. A destructive action on somebody else's account
 * that happens on a single click is a support call waiting to happen.
 */

const USER_ID = "10000000-0000-4000-8000-000000000009";

function me(permissions: string[]) {
  return {
    data: {
      user: {
        userId: "10000000-0000-4000-8000-000000000001",
        email: "admin@abp.local",
        displayName: "Admin",
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
        workspaces: [{ workspace: "ADMIN", enabled: true, capabilities: [] }],
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

const USERS = {
  data: [
    {
      userId: USER_ID,
      email: "locked.out@abp.local",
      displayName: "Locked Out",
      authStatusCode: "LOCKED",
      rowVersion: '"rv-3"',
      lastSignInAt: null,
      mfaEnabled: true,
      mfaRequired: true,
      mustChangePassword: false,
    },
  ],
  meta: { total: 1 },
};

async function stub(
  page: Page,
  opts: {
    permissions: string[];
    capture?: (path: string, body: unknown) => void;
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
    if (/reset-(password|mfa)$/.test(url.pathname)) {
      opts.capture?.(url.pathname, route.request().postDataJSON());
      return json({ data: { ok: true } });
    }
    if (url.pathname.endsWith("/admin/users")) return json(USERS);
    return json({ data: [], meta: { total: 0, unreadCount: 0 } });
  });
}

test.describe("account recovery", () => {
  test("the admin never chooses the password, and it must be changed", async ({
    page,
  }) => {
    const sent: { path: string; body: Record<string, unknown> }[] = [];
    await stub(page, {
      permissions: ["users.manage", "users.view"],
      capture: (path, body) =>
        sent.push({ path, body: body as Record<string, unknown> }),
    });
    await gotoScreen(page, "/admin/users");

    await page.getByRole("button", { name: /Recover|استعادة/ }).click();
    await page
      .getByRole("button", { name: /Reset password|إعادة تعيين كلمة/ })
      .click();
    // Deliberate second step: nothing destructive on one click.
    await page.getByRole("button", { name: /Yes, reset it|أيوه/ }).click();

    await expect.poll(() => sent.length).toBe(1);
    const body = sent[0]!.body;
    expect(sent[0]!.path).toContain("reset-password");
    expect(body.mustChangePassword).toBe(true);
    expect(body.revokeSessions).toBe(true);
    // Generated, not typed: long, and never the same twice.
    expect(String(body.password).length).toBeGreaterThanOrEqual(16);

    // Shown once, and said to be shown once.
    const panel = page.locator(".mfa-recovery");
    await expect(panel).toContainText(String(body.password));
    await expect(panel).toContainText(/not shown again|مش هتظهر تاني/);
  });

  test("clearing two-step verification also asks first", async ({ page }) => {
    const sent: string[] = [];
    await stub(page, {
      permissions: ["users.manage", "users.view"],
      capture: (path) => sent.push(path),
    });
    await gotoScreen(page, "/admin/users");

    await page.getByRole("button", { name: /Recover|استعادة/ }).click();
    await page
      .getByRole("button", { name: /Reset two-step|إعادة تعيين التحقق/ })
      .click();
    await expect.poll(() => sent.length).toBe(0); // still only a prompt
    await page.getByRole("button", { name: /Yes, clear it|أيوه/ }).click();
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]).toContain("reset-mfa");
  });

  test("offers nothing without users.manage", async ({ page }) => {
    await stub(page, { permissions: ["users.view"] });
    await gotoScreen(page, "/admin/users");

    await expect(
      page.getByRole("button", { name: /Recover|استعادة/ }),
    ).toHaveCount(0);
    await assertReadable(page);
    await assertLabeled(page);
  });
});
