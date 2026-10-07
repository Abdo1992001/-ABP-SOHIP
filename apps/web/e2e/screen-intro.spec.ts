import { test, expect, type Page } from "@playwright/test";
import { permissions } from "@abp/contracts";
import { screens } from "../src/app/screen-registry.ts";
import { screenPurpose } from "../src/app/screen-purpose.ts";
import { gotoScreen, assertNoHorizontalScroll } from "./helpers.js";

/**
 * Every screen says what it is for, on the screen, in both languages.
 *
 * This is the assertion the whole `screen-purpose` table exists to make
 * enforceable. A registry of blurbs that nothing checks is a registry that
 * goes stale the first time somebody adds a screen — and a screen added
 * without one is exactly the screen a new user will not understand, because
 * nobody remembered it was missing.
 *
 * The sweep runs against a permissive session and empty collections. That is
 * deliberate: the purpose line belongs to the header, so it must be there
 * before any row arrives. A screen that only explains itself once it has data
 * is a screen that says nothing on the day it matters most.
 */

/** Routes with a parameter need a concrete id; a sweep cannot invent a real one. */
const LIST_SCREENS = screens.filter((screen) => !screen.route.includes(":"));

const ALL_PERMISSIONS = Object.values(permissions);

function me() {
  return {
    data: {
      user: {
        userId: "10000000-0000-4000-8000-000000000001",
        email: "sweep@abp.local",
        displayName: "Sweep",
        authStatusCode: "ACTIVE",
        rowVersion: '"rv-1"',
        mfaEnabled: false,
        mfaRequired: false,
        mustChangePassword: false,
      },
      access: {
        // SYSTEM_ADMIN because workspace gating is by role, not permission:
        // without it the finance and admin screens redirect and the sweep
        // silently covers two thirds of the app.
        roles: [{ code: "SYSTEM_ADMIN", name: "System administrator" }],
        permissions: ALL_PERMISSIONS,
        countryScope: { countryCodes: ["EG", "SA", "AE"], enforced: true },
        workspaces: [
          "SALES",
          "LOGISTICS",
          "OPERATIONS",
          "FINANCE",
          "RESEARCH",
          "DATA",
          "ADMIN",
        ].map((workspace) => ({ workspace, enabled: true, capabilities: [] })),
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

async function stubApi(page: Page) {
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (url.pathname.endsWith("/me")) return json(me());
    // Everything else: a well-formed empty collection. Screens differ in
    // whether they read `data` as a list or an object, so both shapes are
    // served and each screen picks the one it expects.
    return json({
      data: [],
      meta: { total: 0, page: 1, limit: 25, unreadCount: 0 },
    });
  });
}

test.describe("every screen explains itself", () => {
  test("the registry and the purpose table agree", () => {
    const missing = screens
      .map((screen) => screen.id)
      .filter((id) => screenPurpose[id] === undefined);
    expect(
      missing,
      `screens with no stated purpose: ${missing.join(", ")}`,
    ).toEqual([]);

    // A purpose that is a restatement of the title teaches nobody anything,
    // and an empty one is worse than none because it looks deliberate.
    const thin = Object.entries(screenPurpose).filter(
      ([, entry]) =>
        entry.purpose.en.trim().length < 30 ||
        entry.purpose.ar.trim().length < 20 ||
        entry.source.en.trim().length < 30 ||
        entry.source.ar.trim().length < 20,
    );
    expect(
      thin.map(([id]) => id),
      "purpose or source too short to be useful",
    ).toEqual([]);
  });

  for (const screen of LIST_SCREENS) {
    test(`${screen.id} states its purpose and its source`, async ({ page }) => {
      await stubApi(page);
      // "/" still redirects once per session for the roles that have a
      // landing screen of their own (support, logistics, operations,
      // finance). The alias reaches the same screen without that first-visit
      // behaviour, so it is what the sweep asks for.
      await gotoScreen(
        page,
        screen.route === "/" ? (screen.aliases?.[0] ?? "/") : screen.route,
      );

      const intro = page.locator(".screen-intro").first();
      await expect(
        intro,
        `${screen.route} renders no screen intro`,
      ).toBeAttached();

      // There must be a visible sentence explaining the screen. A screen that
      // writes its own subtitle — usually because it can say something the
      // registry cannot, like a date or a count — satisfies this with that
      // subtitle, and the registry line steps aside rather than repeating it.
      const explanation = page
        .locator(".screen-intro-purpose, .abp2-page-sub")
        .first();
      await expect(
        explanation,
        `${screen.route} shows no explanation of itself`,
      ).toBeVisible();
      expect(
        (await explanation.textContent())?.trim().length ?? 0,
      ).toBeGreaterThan(20);

      // The provenance is closed by default — that is the point of it — but it
      // has to be openable and it has to contain something once open.
      const details = page.locator(".screen-intro-source").first();
      await expect(details).toHaveJSProperty("open", false);
      await details.locator("summary").click();
      await expect(details.locator("p")).toBeVisible();

      await assertNoHorizontalScroll(page);
    });
  }
});
