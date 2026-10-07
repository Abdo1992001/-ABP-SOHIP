import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  chromium,
  type BrowserContext,
  type Locator,
  type Page,
} from "playwright";
import { createPrismaClient } from "../../packages/database/dist/index.js";
// The API owns the pinned OTP dependency; UAT uses that exact implementation.
// @ts-expect-error package-local runtime import has no project declaration file.
import { TOTP } from "../../apps/api/node_modules/otpauth/dist/otpauth.node.mjs";

type Credential = { username: string; password: string; userId: string };
type FormEvidence = {
  form: string;
  role: string;
  route: string;
  viewport: string;
  language: string;
  direction: string;
  validationFocused: boolean;
  saveReachable: boolean;
  cancelReachable: boolean;
  horizontalOverflow: boolean;
  saved: boolean;
  result: "PASS" | "FAIL";
  screenshot: string;
  error?: string;
};

const appUrl = (process.env.ABP_UAT_WEB_URL ?? "http://127.0.0.1:5173").replace(
  /\/$/,
  "",
);
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL_REQUIRED");
const outputRoot = resolve(
  process.env.ABP_LONG_FORM_OUTPUT ??
    "docs/delivery/final-audit/screenshots/long-forms",
);
const chromePath =
  process.env.ABP_UAT_CHROME_PATH ??
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const evidence: FormEvidence[] = [];
const database = createPrismaClient(databaseUrl);

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
  return JSON.parse(result.stdout.trim()) as Credential[];
}

function permanentPassword() {
  return `Forms!${randomBytes(24).toString("base64url")}Aa9#`;
}

function otp(secret: string) {
  return new TOTP({
    issuer: "ABP Commercial System",
    label: "Long-form UAT",
    secret,
  }).generate();
}

async function settle(page: Page) {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(600);
  await page
    .locator(".spinner")
    .waitFor({ state: "detached", timeout: 10_000 })
    .catch(() => undefined);
}

async function bootstrap(page: Page, credential: Credential) {
  await page.goto(appUrl);
  await page
    .locator('input[autocomplete="username"]')
    .fill(credential.username);
  await page
    .locator('input[autocomplete="current-password"]')
    .fill(credential.password);
  await page.locator('button[type="submit"]').click();
  await page.locator('input[autocomplete="new-password"]').first().waitFor();
  const permanent = permanentPassword();
  await page
    .locator('input[autocomplete="current-password"]')
    .fill(credential.password);
  const passwords = page.locator('input[autocomplete="new-password"]');
  await passwords.nth(0).fill(permanent);
  await passwords.nth(1).fill(permanent);
  await page.locator('button[type="submit"]').click();
  const secretNode = page.locator(".manual-secret strong");
  await secretNode.waitFor({ timeout: 15_000 });
  const secret = (await secretNode.innerText()).trim();
  await page.locator('input[autocomplete="one-time-code"]').fill(otp(secret));
  await page.locator('button[type="submit"]').click();
  await page.locator(".recovery-codes").waitFor({ timeout: 15_000 });
  await page.locator("button.primary").click();
  await page.locator(".app-shell, .portal-shell").waitFor({ timeout: 15_000 });
}

async function setLocale(page: Page, locale: "en" | "ar") {
  const current = await page.evaluate(() => document.documentElement.lang);
  if (current !== locale) {
    await page.locator(".language-switch").first().click();
    await page.waitForFunction(
      (next) => document.documentElement.lang === next,
      locale,
    );
  }
}

async function validateForm(form: Locator, expectInvalid = true) {
  if (!expectInvalid)
    return form.evaluate((node) => (node as HTMLFormElement).checkValidity());
  const firstInvalid = form.locator(":invalid").first();
  if ((await firstInvalid.count()) === 0) return false;
  const submit = form
    .locator('button[type="submit"], button:not([type])')
    .last();
  await submit.click();
  await form.page().waitForTimeout(100);
  return firstInvalid.evaluate((node) => {
    const active = document.activeElement;
    return (
      active === node ||
      (active instanceof HTMLElement && active.matches(":invalid"))
    );
  });
}

async function fillSelectOrInput(control: Locator, value: string) {
  if ((await control.evaluate((node) => node.tagName)) === "SELECT")
    await control.selectOption(value);
  else await control.fill(value);
}

async function captureForm(
  page: Page,
  form: Locator,
  name: string,
  role: string,
  validationFocused: boolean,
  cancel: Locator,
  saved = false,
) {
  await settle(page);
  const submit = form
    .locator('button[type="submit"], button:not([type])')
    .last();
  await submit.scrollIntoViewIfNeeded();
  const saveReachable = await submit.isVisible().catch(() => false);
  const cancelReachable = await cancel.isVisible().catch(() => false);
  const metrics = await page.evaluate(() => ({
    overflow:
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth + 1,
    language: document.documentElement.lang,
    direction: document.documentElement.dir,
  }));
  const viewport = page.viewportSize()!;
  const fileName = `${name}-${String(viewport.width)}x${String(viewport.height)}-${metrics.language}.png`;
  const absolute = resolve(outputRoot, fileName);
  await page.screenshot({ path: absolute, fullPage: false });
  const result =
    validationFocused && saveReachable && cancelReachable && !metrics.overflow
      ? "PASS"
      : "FAIL";
  evidence.push({
    form: name,
    role,
    route: new URL(page.url()).pathname,
    viewport: `${String(viewport.width)}x${String(viewport.height)}`,
    language: metrics.language,
    direction: metrics.direction,
    validationFocused,
    saveReachable,
    cancelReachable,
    horizontalOverflow: metrics.overflow,
    saved,
    result,
    screenshot: `long-forms/${fileName}`,
    ...(result === "FAIL" ? { error: "FORM_LAYOUT_OR_VALIDATION_GATE" } : {}),
  });
}

async function genericAction(page: Page, operationId: string) {
  const card = page.locator(`[data-operation-id="${operationId}"]`);
  await card.scrollIntoViewIfNeeded();
  await card.locator("button").click();
  const form = page.locator(`form[aria-labelledby="${operationId}-title"]`);
  await form.waitFor();
  return form;
}

async function cancelGeneric(page: Page, form: Locator) {
  const cancel = form.locator("footer button.secondary");
  await cancel.click();
  await form.waitFor({ state: "detached" });
}

async function fillRequiredForVisual(form: Locator) {
  await form.locator("input[required]").evaluateAll((inputs) => {
    for (const [index, input] of inputs.entries()) {
      const element = input as HTMLInputElement;
      if (element.value) continue;
      if (element.type === "date") element.value = "2026-09-13";
      else if (element.type === "email")
        element.value = `visual${String(index)}@abp.local`;
      else if (element.type === "url") element.value = "https://example.local";
      else if (element.type === "number") element.value = "1";
      else if (element.pattern?.includes("A-Z")) element.value = "EG";
      else element.value = "UAT visual value";
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
  for (const select of await form.locator("select[required]").all()) {
    if (!(await select.inputValue())) {
      const value = await select
        .locator("option:not([value=''])")
        .first()
        .getAttribute("value");
      if (value) await select.selectOption(value);
    }
  }
  for (const textarea of await form.locator("textarea[required]").all()) {
    if (!(await textarea.inputValue()))
      await textarea.fill("UAT visual evidence");
  }
}

async function genericMatrix({
  page,
  role,
  name,
  route,
  operationId,
  fill,
  waitSaved,
}: {
  page: Page;
  role: string;
  name: string;
  route: string;
  operationId: string;
  fill: (form: Locator) => Promise<void>;
  waitSaved?: (form: Locator) => Promise<void>;
}) {
  await page.setViewportSize({ width: 1366, height: 768 });
  await setLocale(page, "en");
  await page.goto(`${appUrl}${route}`);
  await settle(page);
  let form = await genericAction(page, operationId);
  const validation = await validateForm(form);
  await fill(form);
  const cancel = form.locator("footer button.secondary");
  await captureForm(page, form, name, role, validation, cancel);
  await page.setViewportSize({ width: 390, height: 844 });
  await captureForm(page, form, name, role, validation, cancel);
  await cancelGeneric(page, form);

  await page.setViewportSize({ width: 1366, height: 768 });
  await setLocale(page, "ar");
  form = await genericAction(page, operationId);
  await fillRequiredForVisual(form);
  await captureForm(
    page,
    form,
    name,
    role,
    true,
    form.locator("footer button.secondary"),
  );
  await cancelGeneric(page, form);

  await setLocale(page, "en");
  form = await genericAction(page, operationId);
  await fill(form);
  await form.locator('button[type="submit"]').click();
  if (waitSaved) await waitSaved(form);
  else {
    try {
      await form
        .locator(".status.success, .status.error")
        .first()
        .waitFor({ timeout: 20_000 });
    } catch {
      const invalid = await form.locator(":invalid").evaluateAll((nodes) =>
        nodes.map((node) => ({
          tag: node.tagName,
          name: (node as HTMLInputElement).name,
          value: (node as HTMLInputElement).value,
          aria: node.getAttribute("aria-label"),
          text: node.parentElement?.innerText?.slice(0, 200),
        })),
      );
      throw new Error(`GENERIC_SAVE_NO_RESULT:${JSON.stringify(invalid)}`);
    }
    if (await form.locator(".status.error").count()) {
      throw new Error(
        `GENERIC_SAVE_FAILED:${(await form.locator(".status.error").innerText()).slice(0, 500)}`,
      );
    }
  }
  const savedEvidence = evidence.findLast(
    (item) => item.form === name && item.role === role,
  );
  if (savedEvidence) savedEvidence.saved = true;
  await cancelGeneric(page, form);
}

async function customMatrix({
  page,
  role,
  name,
  route,
  open,
  formSelector,
  fill,
  submit,
  waitSaved,
  expectInvalid = true,
}: {
  page: Page;
  role: string;
  name: string;
  route: string;
  open: (page: Page) => Promise<void>;
  formSelector: string;
  fill: (form: Locator) => Promise<void>;
  submit: (form: Locator) => Locator;
  waitSaved: (page: Page, form: Locator) => Promise<void>;
  expectInvalid?: boolean;
}) {
  await page.setViewportSize({ width: 1366, height: 768 });
  await setLocale(page, "en");
  await page.goto(`${appUrl}${route}`);
  await settle(page);
  await open(page);
  let form = page.locator(formSelector).last();
  await form.waitFor();
  const validation = await validateForm(form, expectInvalid);
  await fill(form);
  const cancel = page
    .locator(
      ".slideover-header button, .dialog button[aria-label], .page-heading button.primary",
    )
    .last();
  await captureForm(page, form, name, role, validation, cancel);
  await page.setViewportSize({ width: 390, height: 844 });
  await captureForm(page, form, name, role, validation, cancel);
  await page.keyboard.press("Escape");
  if (await form.isVisible().catch(() => false)) await cancel.click();

  await page.setViewportSize({ width: 1366, height: 768 });
  await setLocale(page, "ar");
  await open(page);
  form = page.locator(formSelector).last();
  await form.waitFor();
  await fillRequiredForVisual(form);
  const rtlCancel = page
    .locator(
      ".slideover-header button, .dialog button[aria-label], .page-heading button.primary",
    )
    .last();
  await captureForm(page, form, name, role, true, rtlCancel);
  await page.keyboard.press("Escape");
  if (await form.isVisible().catch(() => false)) await rtlCancel.click();

  await setLocale(page, "en");
  await open(page);
  form = page.locator(formSelector).last();
  await fill(form);
  await submit(form).click();
  await waitSaved(page, form);
  const savedEvidence = evidence.findLast(
    (item) => item.form === name && item.role === role,
  );
  if (savedEvidence) savedEvidence.saved = true;
}

async function exerciseSalesManager(page: Page) {
  const role = "sales-manager";
  await customMatrix({
    page,
    role,
    name: "customer",
    route: "/customers",
    open: async (current) => {
      const trigger = current.getByRole("button", {
        name: /New customer|عميل جديد/,
      });
      if (!(await trigger.isVisible().catch(() => false))) {
        const summary = (await current.locator("body").innerText()).slice(
          0,
          800,
        );
        throw new Error(`CUSTOMER_CREATE_TRIGGER_MISSING:${summary}`);
      }
      await trigger.click();
    },
    formSelector: "form.form-card",
    fill: async (form) => {
      await form
        .getByLabel("Name")
        .fill(`Long Form Customer ${String(Date.now())}`);
      await form.getByLabel("Country").selectOption("EG");
    },
    submit: (form) => form.getByRole("button", { name: "Create", exact: true }),
    waitSaved: async (current) =>
      current.waitForURL(/\/customers\/[0-9a-f-]{36}$/i, { timeout: 20_000 }),
  });

  await page.goto(`${appUrl}/customers`);
  await settle(page);
  await page.locator(".route-content .row-open").first().click();
  await settle(page);
  await page.getByRole("tab", { name: "Contacts", exact: true }).click();
  const addContact = page.getByRole("button", {
    name: /Add contact|إضافة جهة/,
  });
  if (
    (await addContact.count()) === 0 ||
    !(await addContact
      .first()
      .isVisible()
      .catch(() => false))
  ) {
    const summary = (await page.locator("body").innerText()).slice(0, 1200);
    throw new Error(`CONTACT_CREATE_TRIGGER_MISSING:${summary}`);
  }
  await customMatrix({
    page,
    role,
    name: "contact",
    route: new URL(page.url()).pathname,
    open: async (current) => {
      await current
        .getByRole("tab", { name: /Contacts|جهات الاتصال/, exact: true })
        .click();
      await current
        .getByRole("button", { name: /Add contact|إضافة جهة/ })
        .click();
    },
    formSelector: "form.contact-form",
    fill: async (form) => {
      await form
        .getByLabel("Contact name")
        .fill(`Long Form Contact ${String(Date.now())}`);
      await form.getByLabel("Job title").fill("Commercial Engineer");
      await form
        .getByLabel("Primary email")
        .fill(`contact.${String(Date.now())}@abp.local`);
    },
    submit: (form) => form.getByRole("button", { name: "Create contact" }),
    waitSaved: async (current) =>
      current
        .locator(".slideover form.contact-form")
        .waitFor({ state: "detached", timeout: 20_000 }),
  });

  await customMatrix({
    page,
    role,
    name: "project",
    route: "/projects",
    open: async (current) =>
      current.locator(".page-heading button.primary").click(),
    formSelector: "form.create-form",
    fill: async (form) => {
      await form
        .getByLabel("Project name")
        .fill(`Long Form Project ${String(Date.now())}`);
      await form.getByLabel("Project country").selectOption("EG");
      await form.locator("select").nth(1).selectOption({ index: 1 });
      await form.getByLabel("Primary party role").fill("CONTRACTOR");
    },
    submit: (form) => form.getByRole("button", { name: "Create project" }),
    waitSaved: async (current) =>
      current.waitForURL(/\/sales\/projects\/[0-9a-f-]{36}$/i, {
        timeout: 20_000,
      }),
  });

  await customMatrix({
    page,
    role,
    name: "opportunity",
    route: "/opportunities",
    open: async (current) =>
      current.locator(".page-heading button.primary").click(),
    formSelector: ".slideover form",
    fill: async (form) => {
      await form.getByLabel("Select customer").selectOption({ index: 1 });
      await form
        .getByLabel("Reason for no linked project")
        .fill("DIRECT_REQUIREMENT");
      await form.getByLabel("Estimated value").fill("275000");
    },
    submit: (form) => form.getByRole("button", { name: "Create opportunity" }),
    waitSaved: async (current) =>
      current.waitForURL(/\/opportunities\/[0-9a-f-]{36}$/i, {
        timeout: 20_000,
      }),
  });

  await customMatrix({
    page,
    role,
    name: "quotation",
    route: "/quotations",
    open: async (current) =>
      current.locator(".page-heading button.primary").click(),
    formSelector: "form.quotation-create-dialog",
    fill: async (form) =>
      form.getByLabel("Opportunity").selectOption({ index: 1 }),
    submit: (form) => form.getByRole("button", { name: "Create draft" }),
    waitSaved: async (current) =>
      current.waitForURL(/\/quotations\/[0-9a-f-]{36}$/i, { timeout: 20_000 }),
  });

  await genericMatrix({
    page,
    role,
    name: "target-configuration",
    route: "/targets",
    operationId: "put_company_targets_by_year",
    fill: async (form) => {
      const targetYear = String(3000 + (Date.now() % 900));
      const year = form.getByLabel(/year/i);
      if ((await year.count()) > 0) await year.first().fill(targetYear);
      const annual = form.getByLabel(/Annual Target Amount/i);
      if ((await annual.count()) > 0) await annual.fill("6000000");
      const currency = form.getByLabel(/Base Currency Code/i);
      if ((await currency.count()) > 0) await currency.fill("USD");
      const ifMatch = form.getByLabel(/If-Match|row version/i);
      if ((await ifMatch.count()) > 0) await ifMatch.fill('"0"');
    },
  });

  await genericMatrix({
    page,
    role,
    name: "market-signal",
    route: "/intelligence/market-signals",
    operationId: "post_market_signals",
    fill: async (form) => {
      const now = String(Date.now());
      await form.getByLabel("Title *").fill(`Long Form Signal ${now}`);
      await form.getByLabel("Source name *").fill("ABP UAT Desk");
      await form.getByLabel("Source url").fill("https://example.local/signal");
      await form.getByLabel("Published date *").fill("2026-09-13");
      await form.getByLabel("Retrieved date *").fill("2026-09-13");
      await form
        .getByLabel("Evidence *")
        .fill("Verified long-form UAT evidence");
      await form.getByLabel("Country code").fill("EG");
      await form.getByLabel("Summary").fill("UAT market signal summary");
    },
  });

  await genericMatrix({
    page,
    role,
    name: "target-account",
    route: "/intelligence/target-accounts",
    operationId: "post_target_accounts",
    fill: async (form) => {
      await form
        .getByLabel("Company name *")
        .fill(`Long Form Target ${String(Date.now())}`);
      await form.getByLabel("Country code *").fill("EG");
      await form
        .getByLabel("Rationale *")
        .fill("Qualified UAT expansion target");
    },
  });
}

async function exerciseAdmin(page: Page, roleId: string) {
  const role = "system-admin";
  await genericMatrix({
    page,
    role,
    name: "user",
    route: "/admin/users",
    operationId: "post_admin_users",
    fill: async (form) => {
      const stamp = String(Date.now());
      await form.getByLabel("Email *").fill(`long.form.${stamp}@abp.local`);
      await form.getByLabel("Display name *").fill(`Long Form User ${stamp}`);
      const addButtons = form.getByRole("button", { name: /^Add / });
      const roleArray = form.locator(".schema-array").nth(0);
      const countryArray = form.locator(".schema-array").nth(1);
      if ((await roleArray.locator(".array-item").count()) === 0)
        await addButtons.nth(0).click();
      await roleArray.locator("input").first().fill(roleId);
      if ((await countryArray.locator(".array-item").count()) === 0)
        await addButtons.nth(1).click();
      await countryArray.locator("input").first().fill("EG");
    },
  });

  await page.goto(`${appUrl}/settings`);
  await settle(page);
  await page.getByRole("tab", { name: "Notifications" }).click();
  const settingsPanel = page.locator(".settings-content");
  const save = settingsPanel.getByRole("button", { name: "Save changes" });
  const firstToggle = settingsPanel.locator('input[type="checkbox"]').first();
  await firstToggle.click();
  await captureForm(
    page,
    settingsPanel,
    "settings",
    role,
    true,
    page.getByRole("tab", { name: "Profile" }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await captureForm(
    page,
    settingsPanel,
    "settings",
    role,
    true,
    page.getByRole("tab", { name: "Profile" }),
  );
  const preferenceSaved = page.waitForResponse(
    (response) =>
      response.url().includes("/api/v1/preferences") &&
      response.request().method() === "PATCH" &&
      response.status() === 200,
  );
  await save.click();
  await preferenceSaved;
  const settingsSaved = evidence.findLast((item) => item.form === "settings");
  if (settingsSaved) settingsSaved.saved = true;
  await page.setViewportSize({ width: 1366, height: 768 });
  await setLocale(page, "ar");
  await page.getByRole("tab", { name: "الإشعارات" }).click();
  await captureForm(
    page,
    page.locator(".settings-content"),
    "settings",
    role,
    true,
    page.getByRole("tab", { name: "الملف الشخصي" }),
    true,
  );
  await setLocale(page, "en");

  await page.goto(`${appUrl}/products`);
  await settle(page);
  await page.locator(".customer-list .list-link").first().click();
  await page.getByRole("tab", { name: "Edit product" }).click();
  const productForm = page.locator("form.product-edit-form");
  await productForm
    .getByLabel("Description")
    .fill(`UAT Product ${String(Date.now())}`);
  await captureForm(
    page,
    productForm,
    "product",
    role,
    true,
    page.getByRole("tab", { name: "Specifications" }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await captureForm(
    page,
    productForm,
    "product",
    role,
    true,
    page.getByRole("tab", { name: "Specifications" }),
  );
  await page.setViewportSize({ width: 1366, height: 768 });
  const productSavedResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/v1/products/") &&
      response.request().method() === "PATCH" &&
      response.status() === 200,
  );
  await productForm.getByRole("button", { name: "Save product" }).click();
  await productSavedResponse;
  const productSaved = evidence.findLast((item) => item.form === "product");
  if (productSaved) productSaved.saved = true;
  await setLocale(page, "ar");
  await page.getByRole("tab", { name: "تعديل المنتج" }).click();
  await captureForm(
    page,
    page.locator("form.product-edit-form"),
    "product",
    role,
    true,
    page.getByRole("tab", { name: "المواصفات" }),
    true,
  );
  await setLocale(page, "en");
}

async function exerciseFinance(
  page: Page,
  accountId: string,
  originalQuotationId: string,
  originalQuotationLineId: string,
) {
  const role = "finance";
  await genericMatrix({
    page,
    role,
    name: "payment",
    route: "/finance/payments",
    operationId: "post_finance_payments",
    fill: async (form) => {
      await form.getByLabel("Account ID *").selectOption({ index: 1 });
      await form.getByLabel("Payment date *").fill("2026-09-13");
      await form.getByLabel("Amount *").fill("12500");
      await form.getByLabel("Currency code *").fill("EGP");
      await form
        .getByLabel("Source payment key")
        .fill(`LF-PAY-${String(Date.now())}`);
    },
  });
  await genericMatrix({
    page,
    role,
    name: "cheque",
    route: "/finance/cheques",
    operationId: "post_finance_cheques",
    fill: async (form) => {
      await form.getByLabel("Account ID *").selectOption({ index: 1 });
      await form
        .getByLabel("Cheque number *")
        .fill(`LF-CHQ-${String(Date.now())}`);
      await form.getByLabel("Amount *").fill("18000");
      await form.getByLabel("Currency code *").fill("EGP");
      await form.getByLabel("Source type code *").fill("MANUAL");
      await form
        .getByLabel("Source cheque key")
        .fill(`LF-CHQ-${String(Date.now())}`);
    },
  });
  await genericMatrix({
    page,
    role,
    name: "returned-scrap",
    route: "/returns",
    operationId: "post_returned_scrap_cases",
    fill: async (form) => {
      const account = form.getByLabel("Account ID *");
      if ((await account.evaluate((node) => node.tagName)) === "SELECT")
        await account.selectOption({ index: 1 });
      else await fillSelectOrInput(account, accountId);
      await form
        .getByLabel("Original quotation ID *")
        .fill(originalQuotationId);
      const add = form.getByRole("button", { name: /^Add Lines/ });
      if ((await form.locator(".schema-array .array-item").count()) === 0)
        await add.click();
      await form
        .getByLabel("Original quotation line ID *")
        .fill(originalQuotationLineId);
      await form.getByLabel("Returned qty *").fill("1");
    },
  });
}

async function withRole(
  browserContext: () => Promise<BrowserContext>,
  credential: Credential,
  run: (page: Page) => Promise<void>,
) {
  await database.$executeRawUnsafe(
    "DELETE FROM request_rate_limits WHERE bucket_key LIKE 'login:%'",
  );
  const context = await browserContext();
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  try {
    await bootstrap(page, credential);
    await run(page);
  } finally {
    await context.close();
  }
}

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });
const credentials = resetCredentials();
const byName = new Map(credentials.map((item) => [item.username, item]));
const admin = byName.get("uat.admin");
const salesManager = byName.get("uat.sales.manager");
const finance = byName.get("uat.finance");
if (!admin || !salesManager || !finance) throw new Error("UAT_ROLES_MISSING");
const role = await database.role.findFirstOrThrow({
  where: { code: "SALES_USER" },
  select: { id: true },
});
const originalLine = await database.quotationLine.findFirstOrThrow({
  where: { quotation: { quotationRef: "UAT-QTN-002" }, lineNo: 1 },
  select: {
    id: true,
    quotationId: true,
    quotation: { select: { accountId: true } },
  },
});
const browser = await chromium.launch({
  headless: true,
  executablePath: chromePath,
});
const createContext = () =>
  browser.newContext({ viewport: { width: 1366, height: 768 } });
const failures: string[] = [];
const roleFilter = process.env.ABP_LONG_FORM_ROLE;
for (const [name, credential, run] of [
  ["sales-manager", salesManager, exerciseSalesManager],
  ["system-admin", admin, (page: Page) => exerciseAdmin(page, role.id)],
  [
    "finance",
    finance,
    (page: Page) =>
      exerciseFinance(
        page,
        originalLine.quotation.accountId,
        originalLine.quotationId,
        originalLine.id,
      ),
  ],
] as const) {
  if (roleFilter && name !== roleFilter) continue;
  try {
    process.stderr.write(`[long-form-uat] START ${name}\n`);
    await withRole(createContext, credential, run);
    process.stderr.write(`[long-form-uat] PASS ${name}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push(`${name}:${message}`);
    process.stderr.write(`[long-form-uat] FAIL ${name}: ${message}\n`);
  }
}
await browser.close();
await database.$disconnect();
const requiredForms = [
  "customer",
  "contact",
  "project",
  "opportunity",
  "quotation",
  "product",
  "user",
  "settings",
  "target-configuration",
  "market-signal",
  "target-account",
  "payment",
  "cheque",
  "returned-scrap",
];
const formResults = Object.fromEntries(
  requiredForms.map((form) => {
    const rows = evidence.filter((item) => item.form === form);
    return [
      form,
      {
        captures: rows.length,
        passed:
          rows.length >= 3 && rows.every((item) => item.result === "PASS"),
        saved: rows.some((item) => item.saved),
      },
    ];
  }),
);
for (const [form, result] of Object.entries(formResults)) {
  if (!result.passed || !result.saved)
    failures.push(`${form}:ACCEPTANCE_INCOMPLETE`);
}
const report = {
  generatedAt: new Date().toISOString(),
  runtime: { web: appUrl, database: "abp_uat", mockApi: false },
  requiredForms,
  formResults,
  failures,
  evidence,
};
await writeFile(
  resolve(outputRoot, "long-form-uat-results.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);
process.stdout.write(
  JSON.stringify({
    forms: requiredForms.length,
    passed: Object.values(formResults).filter(
      (item) => item.passed && item.saved,
    ).length,
    failed: failures.length,
    evidenceFile:
      "docs/delivery/final-audit/screenshots/long-forms/long-form-uat-results.json",
  }),
);
if (failures.length) process.exitCode = 1;
