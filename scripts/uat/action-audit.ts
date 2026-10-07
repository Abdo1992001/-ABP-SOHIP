import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, type Page } from "playwright";
import { TOTP } from "../../apps/api/node_modules/otpauth/dist/otpauth.node.mjs";

type Credential = { username: string; password: string; userId: string };
type Finding = {
  route: string;
  kind: string;
  label: string;
  result: "PASS" | "SKIP" | "FAIL";
  reason?: string;
};

const appUrl = (process.env.ABP_UAT_WEB_URL ?? "http://127.0.0.1:5173").replace(
  /\/$/,
  "",
);
const output = resolve(
  process.env.ABP_ACTION_AUDIT_OUTPUT ??
    "docs/delivery/final-audit/action-audit.json",
);
const chromePath =
  process.env.ABP_UAT_CHROME_PATH ??
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const routes = [
  "/",
  "/search",
  "/customers",
  "/contacts",
  "/projects",
  "/opportunities",
  "/activities",
  "/activities/calendar",
  "/products",
  "/quotations",
  "/orders",
  "/capacity",
  "/logistics/plans",
  "/finance/fx",
  "/finance/payments",
  "/finance/cheques",
  "/returns",
  "/data/imports",
  "/data/quality",
  "/data/reconciliation",
  "/documents",
  "/notifications",
  "/actions",
  "/reports",
  "/targets",
  "/ai/brief",
  "/intelligence/market-signals",
  "/intelligence/target-markets",
  "/intelligence/target-accounts",
  "/intelligence/competitors",
  "/intelligence/watchlist",
  "/repeat-business",
  "/admin/users",
  "/admin/roles",
  "/admin/countries",
  "/admin/policies",
  "/admin/pricing",
  "/admin/capacity",
  "/admin/import-sources",
  "/admin/data-quality",
  "/admin/templates",
  "/admin/audit",
  "/complaints",
  "/shipments",
  "/research",
  "/admin/customer-segments",
  "/admin/client-identities",
  "/messages",
  "/settings",
];

function credentials(): Credential[] {
  const r = spawnSync(
    process.env.ComSpec ?? "cmd.exe",
    [
      "/d",
      "/s",
      "/c",
      "corepack",
      "pnpm",
      "exec",
      "tsx",
      "scripts/uat/create-uat.ts",
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, ABP_UAT_OUTPUT: "json" },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
  if (r.status !== 0) throw new Error("UAT_CREDENTIAL_RESET_FAILED");
  return JSON.parse(r.stdout.trim()) as Credential[];
}
function password() {
  return `Action!${randomBytes(24).toString("base64url")}Aa9#`;
}
function otp(secret: string) {
  return new TOTP({
    issuer: "ABP Commercial System",
    label: "Action audit",
    secret,
  }).generate();
}
async function settle(page: Page) {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(450);
  await page
    .locator(".spinner")
    .waitFor({ state: "detached", timeout: 5000 })
    .catch(() => undefined);
}
async function login(page: Page, c: Credential) {
  await page.goto(appUrl);
  await page.locator('input[autocomplete="username"]').fill(c.username);
  await page.locator('input[autocomplete="current-password"]').fill(c.password);
  await page.locator('button[type="submit"]').click();
  await page.locator('input[autocomplete="new-password"]').first().waitFor();
  const p = password();
  await page.locator('input[autocomplete="current-password"]').fill(c.password);
  await page.locator('input[autocomplete="new-password"]').nth(0).fill(p);
  await page.locator('input[autocomplete="new-password"]').nth(1).fill(p);
  await page.locator('button[type="submit"]').click();
  const secret = (
    await page.locator(".manual-secret strong").innerText()
  ).trim();
  await page.locator('input[autocomplete="one-time-code"]').fill(otp(secret));
  await page.locator('button[type="submit"]').click();
  await page.locator(".recovery-codes").waitFor();
  await page.locator("button.primary").click();
  await page.locator(".app-shell, .portal-shell").waitFor();
}
function label(text: string | null | undefined) {
  return (text ?? "").replace(/\s+/g, " ").trim().slice(0, 100);
}
function unsafe(text: string) {
  return /delete|remove|archive|sign out|log out|logout|تسجيل الدخول|تسجيل الخروج|حذف|إزالة|أرشفة|خروج/i.test(
    text,
  );
}

const c = credentials().find((x) => x.username === "uat.admin");
if (!c) throw new Error("UAT_ADMIN_MISSING");
const browser = await chromium.launch({
  headless: true,
  executablePath: chromePath,
});
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
page.setDefaultTimeout(5000);
await login(page, c);
const findings: Finding[] = [];
for (const route of routes) {
  await page.goto(`${appUrl}${route}`);
  await settle(page);
  const visibleButtons = page.locator("button:visible");
  const buttonCount = await visibleButtons.count();
  for (let i = 0; i < buttonCount; i++) {
    const currentButtons = page.locator("button:visible");
    if (i >= (await currentButtons.count())) continue;
    const b = currentButtons.nth(i);
    const text = label(
      `${await b.innerText().catch(() => "")} ${await b
        .getAttribute("aria-label")
        .catch(() => "")} ${await b.getAttribute("title").catch(() => "")}`,
    );
    const disabled = await b.isDisabled().catch(() => true);
    if (disabled) {
      findings.push({
        route,
        kind: "button",
        label: text,
        result: "SKIP",
        reason: "disabled by state",
      });
      continue;
    }
    if (
      unsafe(text) ||
      /^(save|create|submit|confirm|execute|حفظ|إنشاء|تأكيد|تنفيذ)$/i.test(text)
    ) {
      findings.push({
        route,
        kind: "button",
        label: text,
        result: "SKIP",
        reason: "destructive or mutation action requires domain data",
      });
      continue;
    }
    const before = await page.evaluate(() => ({
      url: location.href,
      dialogs: document.querySelectorAll('[role="dialog"], .slideover').length,
      text: document.body.innerText.length,
      expanded: document
        .querySelector("button:focus")
        ?.getAttribute("aria-expanded"),
    }));
    await b.click().catch(() => undefined);
    await page.waitForTimeout(180);
    const after = await page.evaluate(() => ({
      url: location.href,
      dialogs: document.querySelectorAll('[role="dialog"], .slideover').length,
      text: document.body.innerText.length,
      expanded: document
        .querySelector("button:focus")
        ?.getAttribute("aria-expanded"),
      status: Boolean(document.querySelector('[role="alert"], .status')),
    }));
    const reacted =
      before.url !== after.url ||
      before.dialogs !== after.dialogs ||
      before.text !== after.text ||
      before.expanded !== after.expanded ||
      after.status;
    findings.push({
      route,
      kind: "button",
      label: text,
      result: reacted ? "PASS" : "FAIL",
      ...(reacted
        ? {}
        : { reason: "click produced no observable UI response" }),
    });
    await page.goto(`${appUrl}${route}`);
    await settle(page);
  }
  const links = page.locator("a:visible");
  for (let i = 0; i < (await links.count()); i++) {
    const a = links.nth(i);
    const text = label(await a.innerText().catch(() => ""));
    const href = await a.getAttribute("href");
    findings.push({
      route,
      kind: "link",
      label: text,
      result: href ? "PASS" : "FAIL",
      ...(href ? {} : { reason: "visible anchor has no href" }),
    });
  }
  const fields = page.locator(
    "input:visible, textarea:visible, select:visible",
  );
  for (let i = 0; i < (await fields.count()); i++) {
    const f = fields.nth(i);
    const accessible = await f.evaluate((node) =>
      Boolean(
        node.getAttribute("aria-label") ||
        node.getAttribute("placeholder") ||
        (node as HTMLInputElement).labels?.length,
      ),
    );
    findings.push({
      route,
      kind: "field",
      label:
        label(await f.getAttribute("aria-label")) ||
        label(await f.getAttribute("placeholder")),
      result: accessible ? "PASS" : "FAIL",
      ...(accessible
        ? {}
        : { reason: "visible input has no accessible label" }),
    });
  }
}
await browser.close();
const report = {
  generatedAt: new Date().toISOString(),
  runtime: { web: appUrl, role: "uat.admin" },
  totals: {
    controls: findings.length,
    pass: findings.filter((x) => x.result === "PASS").length,
    skip: findings.filter((x) => x.result === "SKIP").length,
    fail: findings.filter((x) => x.result === "FAIL").length,
  },
  findings,
};
await mkdir(resolve(output, ".."), { recursive: true });
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(
  JSON.stringify({
    ...report.totals,
    output: "docs/delivery/final-audit/action-audit.json",
  }),
);
if (report.totals.fail) process.exitCode = 1;
