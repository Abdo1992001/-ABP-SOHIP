import { test, expect, type Page } from "@playwright/test";
import { gotoScreen, assertReadable, assertLabeled } from "./helpers.js";

/**
 * Granting and removing access, which is the most consequential thing this
 * application does to a person.
 *
 * The tests are about what is *sent*, not what is drawn. Three things have to
 * hold, and each is a way somebody quietly loses access:
 *
 *  - a save carries the **whole** list, and starts from what the user already
 *    has — a panel that posts only the boxes you ticked silently removes every
 *    role you did not notice was there;
 *  - nothing goes through without a reason, because the audit row is the only
 *    account of why;
 *  - the concurrency token is the one the server just gave us, so two
 *    administrators editing at once cannot overwrite each other blindly.
 */

const USER_ID = "10000000-0000-4000-8000-000000000009";
const SALES_ROLE = "20000000-0000-4000-8000-000000000001";
const FINANCE_ROLE = "20000000-0000-4000-8000-000000000002";

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
        roles: [{ code: "SYSTEM_ADMIN", name: "System administrator" }],
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
      email: "colleague@abp.local",
      displayName: "Colleague",
      authStatusCode: "ACTIVE",
      rowVersion: '"rv-3"',
      lastSignInAt: null,
      mfaEnabled: false,
      mfaRequired: false,
      mustChangePassword: false,
    },
  ],
  meta: { total: 1 },
};

/** What the colleague already has. A save must preserve it, not replace it. */
const ACCESS = {
  data: {
    user: { ...USERS.data[0], rowVersion: '"rv-7"' },
    roles: [{ roleId: SALES_ROLE, name: "Sales" }],
    permissions: ["accounts.view", "quotations.view"],
    countryCodes: ["EG"],
    effectiveDenies: [],
  },
};

const ROLES = {
  data: [
    { roleId: SALES_ROLE, name: "Sales", code: "SALES" },
    { roleId: FINANCE_ROLE, name: "Finance", code: "FINANCE" },
  ],
  meta: { total: 2 },
};

const COUNTRIES = {
  data: [
    { countryCode: "EG", displayName: "Egypt" },
    { countryCode: "SA", displayName: "Saudi Arabia" },
  ],
};

interface Sent {
  path: string;
  body: Record<string, unknown>;
  ifMatch: string | null;
}

async function stub(
  page: Page,
  opts: { permissions: string[]; capture?: (sent: Sent) => void },
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
    if (route.request().method() !== "GET") {
      opts.capture?.({
        path: url.pathname,
        body: route.request().postDataJSON() as Record<string, unknown>,
        ifMatch: route.request().headers()["if-match"] ?? null,
      });
      return json(ACCESS);
    }
    if (/\/admin\/users\/[0-9a-f-]+$/.test(url.pathname)) return json(ACCESS);
    if (url.pathname.endsWith("/admin/users")) return json(USERS);
    if (url.pathname.endsWith("/admin/roles")) return json(ROLES);
    if (url.pathname.endsWith("/reference/countries")) return json(COUNTRIES);
    return json({ data: [], meta: { total: 0, unreadCount: 0 } });
  });
}

const ALL = [
  "users.view",
  "users.manage",
  "roles.assign",
  "country-access.manage",
];

async function openAccess(page: Page) {
  await gotoScreen(page, "/admin/users");
  await page.getByRole("button", { name: /^(Access|الصلاحيات)$/ }).click();
}

test.describe("user access", () => {
  test("a role save keeps what they already had and carries a reason", async ({
    page,
  }) => {
    const sent: Sent[] = [];
    await stub(page, { permissions: ALL, capture: (s) => sent.push(s) });
    await openAccess(page);

    // Sales is already theirs, so it must come back pre-ticked — this is the
    // assertion that catches a panel starting from an empty list.
    const sales = page
      .locator(".access-option", { hasText: "Sales" })
      .locator("input");
    await expect(sales).toBeChecked();

    const finance = page
      .locator(".access-option", { hasText: "Finance" })
      .locator("input");
    await finance.check();

    const save = page.getByRole("button", { name: /Save roles|حفظ الأدوار/ });
    // No reason yet: nothing may be sent.
    await expect(save).toBeDisabled();

    await page
      .locator(
        ".settings-field input[type='text'], .settings-field input:not([type])",
      )
      .first()
      .fill("Joining the finance desk");
    await expect(save).toBeEnabled();
    await save.click();

    await expect.poll(() => sent.length).toBe(1);
    const call = sent[0]!;
    expect(call.path).toContain("/roles");
    expect(call.body.reason).toBe("Joining the finance desk");
    // Both roles, not just the one that was ticked.
    expect(call.body.roleIds).toEqual(
      expect.arrayContaining([SALES_ROLE, FINANCE_ROLE]),
    );
    expect((call.body.roleIds as string[]).length).toBe(2);
    // The token the read returned, not the one from the list row.
    expect(call.ifMatch).toBe('"rv-7"');
  });

  test("country scope sends the whole list", async ({ page }) => {
    const sent: Sent[] = [];
    await stub(page, { permissions: ALL, capture: (s) => sent.push(s) });
    await openAccess(page);

    await page
      .locator(
        ".settings-field input[type='text'], .settings-field input:not([type])",
      )
      .first()
      .fill("Covering the Gulf");
    await page
      .locator(".access-option", { hasText: "Saudi Arabia" })
      .locator("input")
      .check();
    await page
      .getByRole("button", { name: /Save countries|حفظ الدول/ })
      .click();

    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]!.path).toContain("country-access");
    expect(sent[0]!.body.countryCodes).toEqual(
      expect.arrayContaining(["EG", "SA"]),
    );
  });

  test("suspending asks first, and never without a reason", async ({
    page,
  }) => {
    const sent: Sent[] = [];
    await stub(page, { permissions: ALL, capture: (s) => sent.push(s) });
    await openAccess(page);

    const suspend = page.getByRole("button", {
      name: /^(Suspend|إيقاف مؤقت)$/,
    });
    await expect(suspend).toBeDisabled();

    await page
      .locator(
        ".settings-field input[type='text'], .settings-field input:not([type])",
      )
      .first()
      .fill("Left the company");
    await suspend.click();
    await expect.poll(() => sent.length).toBe(0); // still only a prompt

    await page.getByRole("button", { name: /Confirm|تأكيد/ }).click();
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]!.path).toContain("/suspend");
    expect(sent[0]!.body.expectedRowVersion).toBe('"rv-7"');
    expect(sent[0]!.body.reason).toBe("Left the company");
  });

  test("offers only what the administrator is granted", async ({ page }) => {
    // Can read users and manage the account, but may not assign roles or
    // country scope — a real combination, and the panel must not pretend.
    await stub(page, { permissions: ["users.view", "users.manage"] });
    await openAccess(page);

    await expect(
      page.getByRole("button", { name: /Save roles|حفظ الأدوار/ }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /Save countries|حفظ الدول/ }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /^(Suspend|إيقاف مؤقت)$/ }),
    ).toHaveCount(1);

    await assertReadable(page);
    await assertLabeled(page);
  });
});
