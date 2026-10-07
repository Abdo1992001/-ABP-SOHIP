import { test, expect } from "@playwright/test";

/**
 * The harness checking itself.
 *
 * Every other spec trusts that the project it runs under is in the state its
 * name claims: that `dark-ar` is really dark and really Arabic, that
 * `reduced-motion` really has the media query set, that `mobile` is really at
 * phone width. None of that is asserted anywhere, and all of it is config —
 * a typo in a project's `use` block silently turns a whole matrix column into
 * a duplicate of another one, and the suite goes green while testing nothing.
 *
 * This ran because the typechecker rejected `reducedMotion` in the config's
 * `use` block. That turned out to be a type-resolution artefact rather than a
 * real hole — but the only way to know was to measure it in the browser, and
 * having measured it once it is worth keeping measured.
 */
test.describe("harness", () => {
  test("this project is in the state its name claims", async ({
    page,
  }, testInfo) => {
    await page.goto("/");

    const state = await page.evaluate(() => ({
      reduced: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      theme:
        document.documentElement.dataset.theme ??
        (() => {
          try {
            return localStorage.getItem("abp.theme");
          } catch {
            return null;
          }
        })(),
      locale:
        document.documentElement.lang ||
        (() => {
          try {
            return localStorage.getItem("abp.locale");
          } catch {
            return null;
          }
        })(),
      dir: document.documentElement.dir,
      width: window.innerWidth,
    }));

    const name = testInfo.project.name;

    if (name === "reduced-motion") {
      expect(
        state.reduced,
        "the reduced-motion project does not actually emulate reduced motion",
      ).toBe(true);
    } else {
      expect(
        state.reduced,
        `${name} is emulating reduced motion when it should not be`,
      ).toBe(false);
    }

    if (name === "mobile") {
      expect(
        state.width,
        "the mobile project is not at phone width",
      ).toBeLessThanOrEqual(420);
    } else {
      expect(state.width).toBeGreaterThan(1000);
    }

    // Arabic is the case worth asserting: a project that fails to apply the
    // locale renders the whole app in English and every RTL assertion under it
    // becomes meaningless while still passing.
    if (name.endsWith("-ar")) {
      expect(state.locale, `${name} did not land in Arabic`).toBe("ar");
      expect(state.dir, `${name} is not right-to-left`).toBe("rtl");
    }
    if (name.endsWith("-en")) {
      expect(state.locale, `${name} did not land in English`).toBe("en");
    }

    if (name.startsWith("dark")) {
      expect(state.theme, `${name} did not land in the dark theme`).toBe(
        "dark",
      );
    }
    if (name.startsWith("light")) {
      expect(state.theme, `${name} did not land in the light theme`).toBe(
        "light",
      );
    }
  });
});
