import { test } from "@playwright/test";
import {
  gotoScreen,
  assertTypeScale,
  assertLabeled,
  assertReadable,
  assertNothingClipped,
  assertNoHorizontalScroll,
  assertLogo,
  assertNoRawEnums,
  captureScreen,
} from "./helpers.js";

/**
 * The harness gate.
 *
 * Sign-in is the one screen that renders completely without a session, which
 * makes it the honest place to prove the harness itself works before it is
 * trusted to judge anything else: if these helpers cannot validate a screen
 * that is already correct, the helpers are wrong, not the screen.
 *
 * It is also worth testing on its own merits — it is the first thing anyone
 * sees, and it is outside the app shell, so every route sweep that walks
 * `.route-content` has always skipped it.
 */
test.describe("sign-in", () => {
  /**
   * Signed out is a 401 from /me, so say so explicitly. Left to the dev
   * proxy the call simply fails, and how long it takes to fail decides
   * whether the page is photographed mid-load or settled — which made the
   * screenshot differ by 10% of its pixels between two identical runs.
   */
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/v1/**", async (route) => {
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "UNAUTHENTICATED",
            messageKey: "errors.unauthenticated",
          },
        }),
      });
    });
  });

  test("renders correctly in this theme and locale", async ({ page }) => {
    await gotoScreen(page, "/");

    await assertTypeScale(page);
    await assertLabeled(page);
    await assertReadable(page);
    await assertNothingClipped(page);
    await assertNoHorizontalScroll(page);
    await assertLogo(page);
    await assertNoRawEnums(page);
  });

  /**
   * The instability was `auth-underline`: it starts after a 520ms delay, so
   * whether it had run by the time the shot was taken decided how the tagline
   * looked. `gotoScreen` now waits for every animation to settle first.
   */
  test("looks the same as last time", async ({ page }) => {
    await gotoScreen(page, "/");
    await captureScreen(page, "sign-in");
  });
});
