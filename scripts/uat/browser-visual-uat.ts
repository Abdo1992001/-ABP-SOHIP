import { mkdir, rm, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { chromium, type Page } from "playwright";
import { createPrismaClient } from "../../packages/database/dist/index.js";
// The API owns the pinned OTP dependency; use that exact version in UAT.
// @ts-expect-error package-local runtime import has no project declaration file.
import { TOTP } from "../../apps/api/node_modules/otpauth/dist/otpauth.node.mjs";

type Credential = { username: string; password: string; userId: string };
type Evidence = {
  role: string;
  route: string;
  viewport: string;
  theme: string;
  language: string;
  direction: string;
  interaction: string;
  bottomReached: boolean;
  horizontalOverflow: boolean;
  popupTested: boolean;
  result: "PASS" | "FAIL";
  screenshot: string;
  error?: string;
};

const appUrl = (process.env.ABP_UAT_WEB_URL ?? "http://127.0.0.1:5173").replace(
  /\/$/,
  "",
);
const outputRoot = resolve(
  process.env.ABP_VISUAL_UAT_OUTPUT ?? "docs/delivery/final-audit/screenshots",
);
const chromePath =
  process.env.ABP_UAT_CHROME_PATH ??
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const databaseUrl = process.env.DATABASE_URL;
const routes: Readonly<Record<string, { allowed: string; denied: string }>> = {
  "uat.admin": { allowed: "/admin/users", denied: "/portal" },
  "uat.sales.manager": { allowed: "/customers", denied: "/admin/users" },
  "uat.sales.user": { allowed: "/customers", denied: "/admin/users" },
  "uat.sales.user.b": { allowed: "/customers", denied: "/admin/users" },
  "uat.sales.support": { allowed: "/data/imports", denied: "/opportunities" },
  "uat.logistics": { allowed: "/shipments", denied: "/customers" },
  "uat.operations": { allowed: "/capacity", denied: "/finance/payments" },
  "uat.finance": { allowed: "/finance/payments", denied: "/sales/management" },
  "uat.portal.customer": { allowed: "/portal", denied: "/customers" },
};
const slugs: Readonly<Record<string, string>> = {
  "uat.admin": "system-admin",
  "uat.sales.manager": "sales-manager",
  "uat.sales.user": "sales-user",
  "uat.sales.user.b": "sales-user-b",
  "uat.sales.support": "sales-support",
  "uat.logistics": "logistics",
  "uat.operations": "operations",
  "uat.finance": "finance",
  "uat.portal.customer": "portal",
};

function resetCredentials(): Credential[] {
  const result = spawnSync(
    process.platform === "win32"
      ? (process.env.ComSpec ?? "cmd.exe")
      : "corepack",
    process.platform === "win32"
      ? [
          "/d",
          "/s",
          "/c",
          "corepack",
          "pnpm",
          "exec",
          "tsx",
          "scripts/uat/create-uat.ts",
        ]
      : ["pnpm", "exec", "tsx", "scripts/uat/create-uat.ts"],
    {
      cwd: process.cwd(),
      env: { ...process.env, ABP_UAT_OUTPUT: "json" },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
  if (result.status !== 0) throw new Error("UAT_CREDENTIAL_RESET_FAILED");
  const credentials = JSON.parse(result.stdout.trim()) as Credential[];
  if (credentials.length !== 9) throw new Error("EXPECTED_NINE_UAT_USERS");
  return credentials;
}

function permanentPassword() {
  return `Visual!${randomBytes(24).toString("base64url")}Aa9#`;
}

function otp(secret: string) {
  return new TOTP({
    issuer: "ABP Commercial System",
    label: "Visual UAT",
    secret,
  }).generate();
}

async function waitForSettled(page: Page) {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(900);
  await page
    .locator(".spinner")
    .waitFor({ state: "detached", timeout: 10_000 })
    .catch(() => undefined);
}

async function capture(
  page: Page,
  evidence: Evidence[],
  role: string,
  name: string,
  interaction: string,
  popupTested = false,
  folder = role,
  focusSelector?: string,
) {
  await waitForSettled(page);
  const metrics = await page.evaluate(async () => {
    const root = document.documentElement;
    const candidates = [
      document.querySelector<HTMLElement>(".app-main"),
      document.querySelector<HTMLElement>(".portal-shell"),
      document.scrollingElement as HTMLElement | null,
    ].filter((item): item is HTMLElement => Boolean(item));
    const scrollTarget =
      candidates.find((item) => item.scrollHeight > item.clientHeight + 2) ??
      candidates.at(-1)!;
    scrollTarget.scrollTop = scrollTarget.scrollHeight;
    await new Promise<void>((resolveFrame) => {
      requestAnimationFrame(() => resolveFrame());
    });
    const bodyText = document.body.innerText;
    const technicalError = bodyText.match(/errors\.[a-z0-9_.-]+/i)?.[0];
    const bottom =
      scrollTarget.scrollTop + scrollTarget.clientHeight >=
      scrollTarget.scrollHeight - 2;
    scrollTarget.scrollTop = 0;
    return {
      theme: root.dataset.theme ?? "light",
      language: root.lang || "unknown",
      direction: root.dir || getComputedStyle(root).direction,
      overflow: root.scrollWidth > root.clientWidth + 1,
      bottom,
      technicalError,
    };
  });
  const size = page.viewportSize()!;
  const relative = `${folder}/${name}.png`;
  await mkdir(resolve(outputRoot, folder), { recursive: true });
  if (focusSelector) await page.locator(focusSelector).scrollIntoViewIfNeeded();
  await page.screenshot({
    path: resolve(outputRoot, relative),
    fullPage: false,
  });
  evidence.push({
    role,
    route: new URL(page.url()).pathname,
    viewport: `${size.width}x${size.height}`,
    theme: metrics.theme,
    language: metrics.language,
    direction: metrics.direction,
    interaction,
    bottomReached: metrics.bottom,
    horizontalOverflow: metrics.overflow,
    popupTested,
    result: metrics.overflow || metrics.technicalError ? "FAIL" : "PASS",
    screenshot: relative.replaceAll("\\", "/"),
    ...(metrics.technicalError ? { error: metrics.technicalError } : {}),
  });
}

async function captureAt(
  page: Page,
  evidence: Evidence[],
  role: string,
  width: number,
  height: number,
  name: string,
  interaction: string,
  folder: string,
) {
  await page.setViewportSize({ width, height });
  await capture(page, evidence, role, name, interaction, false, folder);
}

async function openRoute(
  page: Page,
  evidence: Evidence[],
  role: string,
  path: string,
  name: string,
  interaction: string,
) {
  await page.goto(`${appUrl}${path}`);
  await waitForSettled(page);
  const text = await page.locator("body").innerText();
  if (/access denied|forbidden|غير مصرح|غير متاح/i.test(text))
    throw new Error(`SPECIALIZED_ROUTE_DENIED:${path}`);
  await capture(page, evidence, role, name, interaction, false, "specialized");
}

async function openFirstRecord(
  page: Page,
  evidence: Evidence[],
  role: string,
  name: string,
  interaction: string,
) {
  const link = page.locator(".route-content .row-open").first();
  if (!(await link.isVisible().catch(() => false)))
    throw new Error(`NO_RECORD_LINK:${new URL(page.url()).pathname}`);
  await link.click();
  await waitForSettled(page);
  await capture(page, evidence, role, name, interaction, false, "specialized");
}

async function bootstrap(
  page: Page,
  credential: Credential,
  role: string,
  evidence: Evidence[],
) {
  await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  await page
    .locator('input[autocomplete="username"]')
    .fill(credential.username);
  await page
    .locator('input[autocomplete="current-password"]')
    .fill(credential.password);
  await page.locator('button[type="submit"]').click();
  await page.locator('input[autocomplete="new-password"]').first().waitFor();
  await capture(
    page,
    evidence,
    role,
    "auth-password-change-1366x768",
    "forced password change",
  );
  const permanent = permanentPassword();
  await page
    .locator('input[autocomplete="current-password"]')
    .fill(credential.password);
  const newPasswords = page.locator('input[autocomplete="new-password"]');
  await newPasswords.nth(0).fill(permanent);
  await newPasswords.nth(1).fill(permanent);
  await page.locator('button[type="submit"]').click();
  const secretNode = page.locator(".manual-secret strong");
  await secretNode.waitFor({ timeout: 15_000 });
  await capture(
    page,
    evidence,
    role,
    "auth-mfa-setup-1366x768",
    "TOTP enrollment",
  );
  const secret = (await secretNode.innerText()).trim();
  await page.locator('input[autocomplete="one-time-code"]').fill(otp(secret));
  await page.locator('button[type="submit"]').click();
  await page.locator(".recovery-codes").waitFor({ timeout: 15_000 });
  await capture(
    page,
    evidence,
    role,
    "auth-recovery-codes-1366x768",
    "recovery codes",
  );
  await page.locator("button.primary").click();
  await page.waitForTimeout(1200);
}

async function exerciseSpecialized(
  page: Page,
  evidence: Evidence[],
  role: string,
) {
  if (role === "sales-manager") {
    await openRoute(
      page,
      evidence,
      role,
      "/customers",
      "customer-list-1366x768",
      "Customer list",
    );
    await openFirstRecord(
      page,
      evidence,
      role,
      "customer-360-1366x768",
      "Customer 360 tabs and populated data",
    );
    await page.getByRole("tab", { name: "Overview", exact: true }).waitFor();
    await openRoute(
      page,
      evidence,
      role,
      "/quotations",
      "quotation-list-1366x768",
      "Quotation list",
    );
    await openFirstRecord(
      page,
      evidence,
      role,
      "quotation-studio-1366x768",
      "Quotation Studio",
    );
    for (const [label, name] of [
      ["Line items", "quotation-line-items-1366x768"],
      ["Summary", "quotation-summary-1366x768"],
      ["Pricing rules", "quotation-pricing-rules-1366x768"],
      ["Documents", "quotation-documents-1366x768"],
      ["Approval", "quotation-approval-1366x768"],
      ["Audit trail", "quotation-audit-trail-1366x768"],
    ] as const) {
      await page.getByRole("tab", { name: label, exact: true }).click();
      await waitForSettled(page);
      await capture(
        page,
        evidence,
        role,
        name,
        `Quotation Studio ${label}`,
        false,
        "specialized",
      );
    }
    await openRoute(
      page,
      evidence,
      role,
      "/products",
      "product-list-1366x768",
      "Product catalog",
    );
    const productLink = page
      .locator(".customer-list .list-link")
      .filter({ hasText: "UAT Board Product 1" });
    await productLink.click();
    await page.getByLabel("Engineering Studio").waitFor();
    await page.getByLabel("Width (mm)").fill("1000");
    await capture(
      page,
      evidence,
      role,
      "engineering-studio-1366x768",
      "Engineering inputs, canonical calculation and scaled graphic",
      false,
      "specialized",
    );
    await openRoute(
      page,
      evidence,
      role,
      "/activities/calendar",
      "calendar-1366x768",
      "Calendar",
    );
    // The first grid cells can belong to the previous month and are outside the
    // active query window. The second week always lands inside the shown month.
    await page
      .locator(".calendar-day > button:first-child:not(:disabled)")
      .nth(10)
      .click();
    const activityDialog = page.getByRole("dialog", { name: "Log activity" });
    await activityDialog.waitFor();
    await activityDialog.getByLabel("Customer").selectOption({ index: 1 });
    await activityDialog.getByLabel("Activity type").selectOption("MEETING");
    const activitySubject = `Visual UAT meeting ${Date.now()}`;
    await activityDialog.getByLabel("Subject").fill(activitySubject);
    await activityDialog.getByRole("button", { name: "Save" }).click();
    await activityDialog.waitFor({ state: "detached" });
    await page.getByText(activitySubject, { exact: true }).waitFor();
    await capture(
      page,
      evidence,
      role,
      "calendar-created-activity-1366x768",
      "Create a typed customer activity and render it in the calendar",
      false,
      "specialized",
    );
    await openRoute(
      page,
      evidence,
      role,
      "/messages",
      "messages-1366x768",
      "Participant-scoped messages",
    );
    const uatConversation = page
      .locator(".conversation-row")
      .filter({ hasText: "UAT Sales Coordination" });
    await uatConversation.click();
    const messageBody = `Visual UAT message ${Date.now()}`;
    await page.getByPlaceholder("Write a message").fill(messageBody);
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await page.getByText(messageBody, { exact: true }).waitFor();
    await capture(
      page,
      evidence,
      role,
      "messages-sent-1366x768",
      "Send and display a participant-scoped message",
      false,
      "specialized",
    );
    await openRoute(
      page,
      evidence,
      role,
      "/intelligence/market-signals",
      "market-intelligence-1366x768",
      "Market Intelligence",
    );
  }
  if (role === "sales-support") {
    await openRoute(
      page,
      evidence,
      role,
      "/data/imports",
      "smart-import-1366x768",
      "Smart Import",
    );
    const importKey = Date.now();
    const csv = [
      "id,name,countryCode",
      `UAT-IMPORT-${String(importKey)}-1,Delta Construction ${String(importKey)},EG`,
      `UAT-IMPORT-${String(importKey)}-2,Nile Projects ${String(importKey)},EG`,
    ].join("\n");
    await page.locator('input[type="file"]').setInputFiles({
      name: `uat-customers-${String(importKey)}.csv`,
      mimeType: "text/csv",
      buffer: Buffer.from(csv),
    });
    await page
      .getByRole("button", { name: "Upload, detect & validate" })
      .click();
    await page
      .getByText("File detected, mapped and validated.", {
        exact: false,
      })
      .waitFor({ timeout: 30_000 });
    await page.getByText("VALID", { exact: true }).first().waitFor();
    await capture(
      page,
      evidence,
      role,
      "smart-import-preview-1366x768",
      "Upload CSV, detect schema, map fields, validate and review rows",
      false,
      "specialized",
      ".import-review-card",
    );
    await page.getByRole("button", { name: "Commit validated rows" }).click();
    await page
      .locator(".import-review-card")
      .getByText(/COMMITTED/)
      .waitFor({ timeout: 30_000 });
    await page.getByRole("button", { name: "Start reconciliation" }).click();
    await page
      .getByText("Reconciliation run started", { exact: false })
      .waitFor();
    await page
      .locator(".reconciliation-status")
      .getByText("COMPLETED", { exact: true })
      .waitFor({ timeout: 30_000 });
    await capture(
      page,
      evidence,
      role,
      "smart-import-reconciled-1366x768",
      "Commit validated rows and start an audited reconciliation run",
      false,
      "specialized",
    );
  }
  if (role === "logistics") {
    await openRoute(
      page,
      evidence,
      role,
      "/logistics/plans",
      "transport-plans-1366x768",
      "Transport plans",
    );
    const uatPlanLink = page
      .locator("tr")
      .filter({ hasText: "UAT-LOG-0001" })
      .locator(".row-open");
    await uatPlanLink.click();
    await capture(
      page,
      evidence,
      role,
      "transport-planner-1366x768",
      "Transport Planner calculations and placement",
      false,
      "specialized",
    );
    await page.getByRole("tab", { name: "Optimization" }).click();
    await capture(
      page,
      evidence,
      role,
      "transport-optimization-1366x768",
      "Transport utilization and placement data",
      false,
      "specialized",
    );
    await page.getByRole("tab", { name: "3D view" }).click();
    await page.locator("canvas").waitFor();
    await capture(
      page,
      evidence,
      role,
      "transport-3d-1366x768",
      "Lazy-loaded Three.js transport view",
      false,
      "specialized",
    );
  }
  if (role === "finance") {
    await openRoute(
      page,
      evidence,
      role,
      "/finance/cheques",
      "cheques-1366x768",
      "Finance cheques",
    );
  }
  if (role === "system-admin") {
    await openRoute(
      page,
      evidence,
      role,
      "/customers",
      "admin-customer-list-1366x768",
      "Administrator customer access",
    );
    await openFirstRecord(
      page,
      evidence,
      role,
      "admin-customer-360-1366x768",
      "Administrator Customer 360",
    );
    await page.getByRole("tab", { name: "Overview", exact: true }).waitFor();
    const customerTabs = [
      "Overview",
      "Contacts",
      "Projects",
      "Opportunities",
      "Quotations",
      "Orders",
      "Payments",
      "Complaints",
      "Shipments",
      "Documents",
      "Activities",
      "Meetings",
      "Source",
    ] as const;
    for (const label of customerTabs) {
      const tab = page.getByRole("tab", { name: label, exact: true });
      if (!(await tab.isVisible().catch(() => false)))
        throw new Error(`CUSTOMER_360_TAB_MISSING:${label}`);
      await tab.click();
      await waitForSettled(page);
      await capture(
        page,
        evidence,
        role,
        `customer-360-${label.toLowerCase().replaceAll(" ", "-")}-1366x768`,
        `Customer 360 ${label}`,
        false,
        "specialized",
      );
    }
    await openRoute(
      page,
      evidence,
      role,
      "/settings",
      "settings-1366x768",
      "System settings",
    );
  }
}

async function exercisePortal(page: Page, evidence: Evidence[], role: string) {
  const selector = page.locator(".portal-header select");
  await selector.waitFor();
  await page.waitForFunction(
    () =>
      (document.querySelector(".portal-header select") as HTMLSelectElement)
        ?.options.length > 0,
  );
  if ((await selector.locator("option").count()) !== 1)
    throw new Error("PORTAL_ACCOUNT_ISOLATION_FAILED");
  const sections = [
    ["My profile", "profile-1366x768"],
    ["Complaints", "complaints-1366x768"],
    ["Repeat business", "repeat-business-1366x768"],
    ["Notifications", "notifications-1366x768"],
  ] as const;
  for (const [label, name] of sections) {
    await page.getByRole("button", { name: label, exact: true }).click();
    await capture(page, evidence, role, name, `Portal ${label}`);
  }
  await page.getByRole("button", { name: "Complaints", exact: true }).click();
  const description = page.locator("textarea");
  await description.fill(`Visual UAT ${new Date().toISOString()}`);
  await page.getByRole("button", { name: "Submit complaint" }).click();
  await page.getByText("Complaint submitted to customer service.").waitFor();
  await capture(
    page,
    evidence,
    role,
    "complaint-success-1366x768",
    "Portal complaint submission feedback",
  );
  const body = await page.locator("body").innerText();
  if (
    /\b[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i.test(
      body,
    )
  )
    throw new Error("PORTAL_RAW_TECHNICAL_ID_VISIBLE");
}

async function exerciseRole(credential: Credential, evidence: Evidence[]) {
  const role = slugs[credential.username]!;
  const route = routes[credential.username]!;
  process.stderr.write(`[visual-uat] START ${role}\n`);
  await mkdir(resolve(outputRoot, role), { recursive: true });
  const context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    reducedMotion: "no-preference",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  page.setDefaultNavigationTimeout(30_000);
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 500)
      runtimeErrors.push(`${response.status()} ${response.url()}`);
  });
  try {
    await bootstrap(page, credential, role, evidence);
    await capture(page, evidence, role, "landing-1366x768", "role landing");
    const groups = page.locator(".workspace-label-btn");
    if ((await groups.count()) > 0) {
      await groups.first().click();
      await capture(
        page,
        evidence,
        role,
        "sidebar-1366x768",
        "sidebar accordion",
      );
    }
    await page.goto(`${appUrl}${route.allowed}`);
    await capture(
      page,
      evidence,
      role,
      "list-1366x768",
      "permitted list/table",
    );
    const detailLink = page.locator(".route-content .row-open").first();
    if (await detailLink.isVisible().catch(() => false)) {
      await detailLink.click();
      await capture(page, evidence, role, "detail-1366x768", "click to detail");
    }
    const quickCreate = page.getByRole("button", {
      name: /Quick create|إضافة سريعة/,
    });
    if (await quickCreate.isVisible().catch(() => false)) {
      await quickCreate.click();
      const dialog = page.getByRole("dialog");
      await dialog.waitFor();
      const focusEntered = await dialog.evaluate((node) =>
        node.contains(document.activeElement),
      );
      if (!focusEntered) throw new Error("MODAL_FOCUS_DID_NOT_ENTER");
      await capture(
        page,
        evidence,
        role,
        "modal-1366x768",
        "quick create + focus",
        true,
      );
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "hidden" });
      const focusRestored = await quickCreate.evaluate(
        (node) => node === document.activeElement,
      );
      if (!focusRestored) throw new Error("MODAL_TRIGGER_FOCUS_NOT_RESTORED");
    }
    await page.setViewportSize({ width: 1366, height: 768 });
    await exerciseSpecialized(page, evidence, role);
    if (role === "portal") {
      await page.goto(`${appUrl}/portal`);
      await exercisePortal(page, evidence, role);
    }
    await page.goto(`${appUrl}${route.denied}`);
    await waitForSettled(page);
    const deniedText = await page.locator("body").innerText();
    if (!/denied|forbidden|غير مصرح|غير متاح|403|404/i.test(deniedText)) {
      throw new Error(`DENIED_ROUTE_VISIBLE:${route.denied}`);
    }

    if (role === "sales-manager" || role === "portal") {
      const matrix = [
        [1920, 1080, "desktop"],
        [1600, 900, "desktop"],
        [1280, 720, "desktop"],
        [1024, 768, "tablet"],
        [768, 1024, "tablet"],
        [375, 812, "mobile"],
      ] as const;
      await page.goto(`${appUrl}${route.allowed}`);
      for (const [width, height, folder] of matrix) {
        await captureAt(
          page,
          evidence,
          role,
          width,
          height,
          `${role}-${String(width)}x${String(height)}`,
          "responsive viewport matrix",
          folder,
        );
      }
    }

    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`${appUrl}${route.allowed}`);
    const language = page.locator(".language-switch").first();
    await language.click();
    await page.waitForFunction(() => document.documentElement.dir === "rtl");
    await capture(
      page,
      evidence,
      role,
      `${role}-arabic-1366x768`,
      "Arabic RTL navigation and content",
      false,
      "rtl",
    );
    await language.click();
    await page.waitForFunction(() => document.documentElement.dir === "ltr");

    const darkTheme = page.getByRole("button", { name: "Use dark theme" });
    if (await darkTheme.isVisible().catch(() => false)) {
      await darkTheme.click();
      await page.waitForFunction(
        () => document.documentElement.dataset.theme === "dark",
      );
      await capture(page, evidence, role, "dark-1366x768", "dark theme");
      await page.getByRole("button", { name: "Use light theme" }).click();
      await page.waitForFunction(
        () => document.documentElement.dataset.theme === "light",
      );
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await waitForSettled(page);
    const menu = page.locator(".mobile-menu");
    if (await menu.isVisible().catch(() => false)) {
      await menu.click();
      const inert = await page
        .locator(".app-main")
        .evaluate((node) => node.hasAttribute("inert"));
      if (!inert) throw new Error("MOBILE_BACKGROUND_NOT_INERT");
    }
    await capture(
      page,
      evidence,
      role,
      "mobile-390x844",
      "mobile navigation",
      true,
    );
    if (await menu.isVisible().catch(() => false)) {
      await page
        .locator(".mobile-menu-backdrop")
        .click({ position: { x: 350, y: 400 } });
      await page.waitForFunction(
        () => !document.querySelector(".app-main")?.hasAttribute("inert"),
      );
      const restored = await page
        .locator(".app-main")
        .evaluate((node) => !node.hasAttribute("inert"));
      if (!restored) throw new Error("MOBILE_BACKGROUND_REMAINS_INERT");
    }
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await capture(
      page,
      evidence,
      role,
      "reduced-motion-1366x768",
      "prefers-reduced-motion",
    );
    await page.emulateMedia({ reducedMotion: "no-preference" });

    const signOut = page.getByRole("button", { name: "Sign out" });
    await signOut.click();
    await page
      .locator('input[autocomplete="username"]')
      .waitFor({ timeout: 15_000 });
    if (runtimeErrors.length) throw new Error(runtimeErrors.join("; "));
    process.stderr.write(`[visual-uat] PASS ${role}\n`);
  } catch (error) {
    process.stderr.write(
      `[visual-uat] FAIL ${role}: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    evidence.push({
      role,
      route: new URL(page.url()).pathname,
      viewport: "1366x768",
      theme: "unknown",
      language: "unknown",
      direction: "unknown",
      interaction: "role journey",
      bottomReached: false,
      horizontalOverflow: false,
      popupTested: false,
      result: "FAIL",
      screenshot: "",
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    await Promise.race([
      context.close().catch(() => undefined),
      new Promise<void>((resolveClose) => {
        setTimeout(resolveClose, 5_000);
      }),
    ]);
  }
}

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });
const credentials = resetCredentials();
const roleFilter = process.env.ABP_UAT_ROLE;
const selectedCredentials = roleFilter
  ? credentials.filter(
      (credential) =>
        credential.username === roleFilter ||
        slugs[credential.username] === roleFilter,
    )
  : credentials;
if (selectedCredentials.length === 0) throw new Error("UAT_ROLE_NOT_FOUND");
if (!databaseUrl) throw new Error("DATABASE_URL_REQUIRED");
const database = createPrismaClient(databaseUrl);
const browser = await chromium.launch({
  headless: true,
  executablePath: chromePath,
});
const evidence: Evidence[] = [];
for (const credential of selectedCredentials) {
  // Final UAT deliberately exercises many valid accounts from one browser host.
  // Clear only the UAT login bucket between role journeys so the production
  // anti-brute-force control remains enabled and is still covered by security tests.
  await database.$executeRawUnsafe(
    "DELETE FROM request_rate_limits WHERE bucket_key LIKE 'login:%'",
  );
  await exerciseRole(credential, evidence);
}
await database.$disconnect();
await browser.close();
const result = {
  generatedAt: new Date().toISOString(),
  runtime: { web: appUrl, database: "abp_uat", mockApi: false },
  passed: evidence.filter((item) => item.result === "PASS").length,
  failed: evidence.filter((item) => item.result === "FAIL").length,
  rolePasses: Object.fromEntries(
    Object.values(slugs).map((role) => [
      role,
      !evidence.some((item) => item.role === role && item.result === "FAIL"),
    ]),
  ),
  evidence,
};
await writeFile(
  resolve(outputRoot, "visual-uat-results.json"),
  `${JSON.stringify(result, null, 2)}\n`,
);
process.stdout.write(
  JSON.stringify({
    passed: result.passed,
    failed: result.failed,
    rolePasses: result.rolePasses,
    evidenceFile:
      "docs/delivery/final-audit/screenshots/visual-uat-results.json",
  }),
);
if (result.failed) process.exitCode = 1;
