import { defineConfig, devices } from "@playwright/test";

/**
 * Browser verification for the redesign.
 *
 * The unit tests run in jsdom, which has no layout engine: it cannot tell you
 * that a figure is 9.5px, that a chip is white on white, that a sticky bar is
 * transparent, or that RTL mirrored the wrong way. Every one of those shipped
 * anyway. This config exists so a screen can be *looked at* — in both themes,
 * both locales, with motion on and off, and at phone width — rather than only
 * compiled.
 *
 * Theme and locale are preset through the app's own persistence keys
 * (`abp.theme` in theme.ts, `abp.locale` in i18n.tsx) so a project lands on a
 * screen already in the state it means to photograph, with no toggling step
 * that could itself be the thing under test.
 */

const BASE_URL = "http://localhost:5173";

function initState(theme: "light" | "dark", locale: "en" | "ar") {
  return {
    storageState: {
      cookies: [],
      origins: [
        {
          origin: BASE_URL,
          localStorage: [
            { name: "abp.theme", value: theme },
            { name: "abp.locale", value: locale },
          ],
        },
      ],
    },
  };
}

const desktop = {
  ...devices["Desktop Chrome"],
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 2,
};

export default defineConfig({
  testDir: "./e2e",
  snapshotDir: "./e2e/__screenshots__",
  /**
   * One worker, not many. The Vite dev server is a single process compiling on
   * demand; six projects hitting it at once made `page.goto` time out on a
   * screen that renders fine on its own, which is a slow harness reporting
   * itself as a broken app. Serial is slower and tells the truth.
   */
  fullyParallel: false,
  workers: 1,
  retries: 1,
  reporter: [["list"]],
  timeout: 60_000,
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: "disabled" },
  },
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    navigationTimeout: 45_000,
  },
  webServer: {
    command: "npm run dev",
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
  /**
   * The screen sweep walks all fifty-six list screens. Running that in six
   * projects is fifty minutes of duplicated work for no extra signal: what it
   * asserts — that a screen states what it is — cannot differ between light
   * and dark or between motion settings. It runs in one Latin project and one
   * Arabic one, which is where it *can* differ, and the per-screen visual
   * specs keep the full matrix.
   */
  projects: [
    { name: "light-en", use: { ...desktop, ...initState("light", "en") } },
    { name: "light-ar", use: { ...desktop, ...initState("light", "ar") } },
    {
      name: "dark-en",
      testIgnore: /screen-intro\.spec\.ts/,
      use: { ...desktop, ...initState("dark", "en") },
    },
    {
      name: "dark-ar",
      testIgnore: /screen-intro\.spec\.ts/,
      use: { ...desktop, ...initState("dark", "ar") },
    },
    {
      name: "reduced-motion",
      testIgnore: /screen-intro\.spec\.ts/,
      use: {
        ...desktop,
        ...initState("dark", "en"),
        // `reducedMotion` is a browser-context option, not a top-level `use`
        // one. Written directly on `use` it is silently ignored: this project
        // ran with the media query unset for its whole existence, making it a
        // duplicate of dark-en and leaving every
        // `@media (prefers-reduced-motion: reduce)` rule in the app untested.
        // `e2e/harness.spec.ts` now asserts the emulation is actually on.
        contextOptions: { reducedMotion: "reduce" },
      },
    },
    {
      name: "mobile",
      testIgnore: /screen-intro\.spec\.ts/,
      use: {
        ...devices["Pixel 7"],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        ...initState("dark", "ar"),
      },
    },
  ],
});
