import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";

/**
 * Forcing a screen into each of its five states, at the network layer.
 *
 * Every screen is supposed to ship loaded / loading / empty / error /
 * forbidden. Four of those are invisible in normal use — you only see the
 * error state when something is actually broken, which is exactly when nobody
 * is checking whether it looks right. Intercepting the API is the only way to
 * photograph them on demand.
 *
 * `mockLoaded` replays recorded responses rather than invented ones. A fixture
 * captured from the real system keeps the envelope shape, the enum codes and
 * the Arabic names honest; hand-written JSON drifts from the contract the day
 * after it is written and then tests something that does not exist.
 */

const API = "**/api/v1/**";
const FIXTURES = join(import.meta.dirname, "fixtures");

export interface Fixture {
  status: number;
  body: unknown;
}

function fixturePath(name: string) {
  return join(FIXTURES, `${name}.json`);
}

export function hasFixtures(name: string) {
  return existsSync(fixturePath(name));
}

export function readFixture(name: string): Record<string, Fixture> {
  return JSON.parse(readFileSync(fixturePath(name), "utf8")) as Record<
    string,
    Fixture
  >;
}

/**
 * Record every API response a screen asks for, once, so later runs are
 * deterministic and need no session. Run with a signed-in storageState:
 *   npm run e2e:record
 */
export async function recordFixtures(page: Page, name: string) {
  const captured: Record<string, Fixture> = {};
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (!url.pathname.startsWith("/api/v1")) return;
    const key = url.pathname + url.search;
    void response
      .json()
      .then((body: unknown) => {
        captured[key] = { status: response.status(), body };
      })
      .catch(() => undefined);
  });
  return () => {
    mkdirSync(FIXTURES, { recursive: true });
    writeFileSync(fixturePath(name), JSON.stringify(captured, null, 2), "utf8");
    return Object.keys(captured).length;
  };
}

/** Replay recorded responses; anything not recorded falls through to an empty collection. */
export async function mockLoaded(page: Page, name: string) {
  const fixtures = readFixture(name);
  await page.route(API, async (route) => {
    const url = new URL(route.request().url());
    const key = url.pathname + url.search;
    const hit = fixtures[key] ?? fixtures[url.pathname];
    if (!hit) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: [], meta: { total: 0 } }),
      });
      return;
    }
    await route.fulfill({
      status: hit.status,
      contentType: "application/json",
      body: JSON.stringify(hit.body),
    });
  });
}

/** Hold every call open long enough to photograph the skeleton. */
export async function mockLoading(page: Page, holdMs = 5_000) {
  await page.route(API, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, holdMs));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: [], meta: { total: 0 } }),
    });
  });
}

/**
 * An empty collection in the envelope the API actually uses. `me` and
 * `preferences` are exempt: a signed-in person with no identity is not an
 * empty state, it is a broken one, and it would test a screen that cannot
 * exist.
 */
export async function mockEmpty(page: Page, name?: string) {
  const fixtures = name && hasFixtures(name) ? readFixture(name) : {};
  await page.route(API, async (route) => {
    const url = new URL(route.request().url());
    if (/\/(me|preferences)$/.test(url.pathname)) {
      const hit = fixtures[url.pathname + url.search] ?? fixtures[url.pathname];
      if (hit) {
        await route.fulfill({
          status: hit.status,
          contentType: "application/json",
          body: JSON.stringify(hit.body),
        });
        return;
      }
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: [],
        meta: { total: 0, page: 1, limit: 25, unreadCount: 0 },
      }),
    });
  });
}

export async function mockError(page: Page, name?: string) {
  const fixtures = name && hasFixtures(name) ? readFixture(name) : {};
  await page.route(API, async (route) => {
    const url = new URL(route.request().url());
    if (/\/me$/.test(url.pathname)) {
      const hit = fixtures[url.pathname] ?? fixtures[url.pathname + url.search];
      if (hit) {
        await route.fulfill({
          status: hit.status,
          contentType: "application/json",
          body: JSON.stringify(hit.body),
        });
        return;
      }
    }
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({
        error: { code: "INTERNAL", messageKey: "errors.internal" },
      }),
    });
  });
}

export async function mockForbidden(page: Page, name?: string) {
  const fixtures = name && hasFixtures(name) ? readFixture(name) : {};
  await page.route(API, async (route) => {
    const url = new URL(route.request().url());
    if (/\/me$/.test(url.pathname)) {
      const hit = fixtures[url.pathname] ?? fixtures[url.pathname + url.search];
      if (hit) {
        await route.fulfill({
          status: hit.status,
          contentType: "application/json",
          body: JSON.stringify(hit.body),
        });
        return;
      }
    }
    await route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({
        error: { code: "FORBIDDEN", messageKey: "errors.forbidden" },
      }),
    });
  });
}
