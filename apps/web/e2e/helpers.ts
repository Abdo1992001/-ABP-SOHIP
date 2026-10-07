import { expect, type Page } from "@playwright/test";

/**
 * The assertions this session kept re-writing by hand in the console.
 *
 * Each one measures what is actually painted, not what the stylesheet says.
 * That distinction is the whole point: `translateY(0)` and `transform: none`
 * are the same picture and completely different behaviour; a gradient button
 * reports `backgroundColor: transparent`; a min-height beats a height whatever
 * the specificity. A rule-reading assertion would have passed every defect
 * found today.
 */

/** Text that is allowed to look like an enum, because it is a real identifier. */
const ALLOWED_CODES = [
  /^MET-[A-Z]+-\d+$/, // governed metric ids
  /^(ACC|OPP|PRJ|QT|SO|SHP)-/, // business references
  /^(EGP|USD|SAR|AED|GBP|EUR)$/, // currency codes
  /^[A-Z]{2}$/, // ISO country codes in scope chips
  /^ABP$/, // the product's own name, in the breadcrumb root
];

const UUID =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;

export async function gotoScreen(page: Page, route: string) {
  // `networkidle` is a hopeful signal, not a reliable one: a screen that keeps
  // a request open — a poll, a stream, a query that refetches on focus — never
  // reaches it, and the navigation fails on a page that is perfectly ready.
  // The waits below are the honest readiness test, so a missed idle window is
  // allowed to pass through rather than fail the test.
  await page
    .goto(route, { waitUntil: "networkidle" })
    .catch(() => page.goto(route, { waitUntil: "domcontentloaded" }));
  // Whatever the route, the shell has to be on the page before anything is
  // measured against it.
  await page
    .locator(".app-shell, .app-state, .local-auth-page")
    .first()
    .waitFor({ state: "attached", timeout: 20_000 })
    .catch(() => undefined);
  // Wait the skeleton out rather than sleeping: a fixed timeout either flakes
  // or wastes time, and it photographs whatever happens to be on screen.
  const skeleton = page.locator('[data-testid="loading-skeleton"]');
  await skeleton
    .first()
    .waitFor({ state: "detached", timeout: 20_000 })
    .catch(() => undefined);
  // Let every animation reach its end state before anything is measured or
  // photographed. Playwright freezes animations that are *running*, but the
  // sign-in screen starts `auth-underline` after a 520ms delay: capture before
  // that and the animation has not begun, capture after and it has finished,
  // and the same page renders two different ways on two identical runs — a
  // stable ~10% pixel difference that looks like a real regression.
  await page
    .waitForFunction(
      () =>
        document
          .getAnimations()
          .every((a) => a.playState === "finished" || a.playState === "idle"),
      null,
      { timeout: 10_000 },
    )
    .catch(() => undefined);
  await page.waitForTimeout(150);
}

/** Every visible text node reads at 12px or more. */
export async function assertTypeScale(page: Page) {
  const offenders = await page.evaluate(() => {
    const bad: { sel: string; size: number; text: string }[] = [];
    const label = (el: Element) =>
      el.tagName.toLowerCase() +
      (el.className && typeof el.className === "string"
        ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".")
        : "");
    for (const el of Array.from(document.querySelectorAll("body *"))) {
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none") continue;
      // The kicker/eyebrow is a documented 11.5px role, and the sidebar
      // subtitle and <kbd> are the 10.5px ones. Everything else a person
      // reads is >= 12px. Marked by attribute on new code; the two legacy
      // class names are recognised too, because they *are* that role.
      if (el.hasAttribute("data-abp-caption")) continue;
      if (
        /\b(eyebrow|abp2-page-kicker|brand-copy)\b/.test(String(el.className))
      )
        continue;
      if (el.tagName === "KBD") continue;
      const own = Array.from(el.childNodes).some(
        (n) => n.nodeType === 3 && (n.textContent ?? "").trim().length > 1,
      );
      if (!own) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      const size = parseFloat(cs.fontSize);
      if (size < 12)
        bad.push({
          sel: label(el),
          size,
          text: (el.textContent ?? "").trim().slice(0, 24),
        });
    }
    return bad;
  });
  expect(offenders, `text below 12px: ${JSON.stringify(offenders)}`).toEqual(
    [],
  );
}

/** Figures, refs, dates and money are mono + tabular. */
export async function assertMonoNumerals(page: Page) {
  const offenders = await page.evaluate(() => {
    const bad: { sel: string; family: string; variant: string }[] = [];
    for (const el of Array.from(document.querySelectorAll("[data-abp-num]"))) {
      const cs = getComputedStyle(el);
      const mono = /plex mono|mono/i.test(cs.fontFamily);
      const tabular = cs.fontVariantNumeric.includes("tabular-nums");
      if (!mono || !tabular)
        bad.push({
          sel:
            el.tagName.toLowerCase() + "." + String(el.className).slice(0, 24),
          family: cs.fontFamily.slice(0, 40),
          variant: cs.fontVariantNumeric,
        });
    }
    return bad;
  });
  expect(
    offenders,
    `numerals not mono/tabular: ${JSON.stringify(offenders)}`,
  ).toEqual([]);
}

/** Every control a person types into can be named out loud. */
export async function assertLabeled(page: Page) {
  const offenders = await page.evaluate(() => {
    const bad: string[] = [];
    const controls = document.querySelectorAll("input, select, textarea");
    for (const el of Array.from(controls) as HTMLInputElement[]) {
      if (el.type === "hidden") continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      const labelled =
        el.closest("label") !== null ||
        (el.id && document.querySelector(`label[for="${el.id}"]`) !== null) ||
        el.hasAttribute("aria-label") ||
        el.hasAttribute("aria-labelledby") ||
        el.hasAttribute("title");
      if (!labelled)
        bad.push(`${el.tagName}#${el.id || "(no id)"}[${el.type}]`);
    }
    return bad;
  });
  expect(
    offenders,
    `unlabelled controls: ${JSON.stringify(offenders)}`,
  ).toEqual([]);
}

/** No raw enum and no UUID reaches a reader. */
export async function assertNoRawEnums(page: Page, allow: RegExp[] = []) {
  const patterns = [...ALLOWED_CODES, ...allow].map((r) => r.source);
  const offenders = await page.evaluate(
    ({ patterns, uuidSrc }) => {
      const allowed = patterns.map((p) => new RegExp(p));
      const uuid = new RegExp(uuidSrc, "i");
      const bad: { kind: string; text: string; sel: string }[] = [];
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
      );
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const parent = node.parentElement;
        if (!parent) continue;
        const cs = getComputedStyle(parent);
        if (cs.visibility === "hidden" || cs.display === "none") continue;
        const text = (node.textContent ?? "").trim();
        if (!text) continue;
        // The shell's own nav headings are uppercase by design and fully
        // localized ("OVERVIEW" / "نظرة عامة"), as is the brand mark. They are
        // display labels that happen to be capitals, not enum codes that
        // escaped a label table, and they appear on every screen.
        if (
          parent.closest(
            ".workspace-label, .workspace-label-text, .brand, .brand-copy, .sidebar-footer",
          )
        )
          continue;
        const sel =
          parent.tagName.toLowerCase() +
          "." +
          String(parent.className).slice(0, 20);
        if (uuid.test(text))
          bad.push({ kind: "uuid", text: text.slice(0, 40), sel });
        for (const token of text.split(/\s+/)) {
          if (!/^[A-Z][A-Z0-9_]{2,}$/.test(token)) continue;
          if (allowed.some((re) => re.test(token))) continue;
          bad.push({ kind: "enum", text: token, sel });
        }
      }
      return bad;
    },
    { patterns, uuidSrc: UUID.source },
  );
  expect(
    offenders,
    `raw enums/UUIDs shown: ${JSON.stringify(offenders.slice(0, 12))}`,
  ).toEqual([]);
}

/**
 * Text is readable against what is actually painted behind it.
 *
 * Composites through translucent ancestors onto the page ground before
 * measuring, skips anything sitting on a gradient (whose `backgroundColor`
 * reads transparent and would produce a false 1.0), and applies the WCAG
 * thresholds.
 */
export async function assertReadable(page: Page) {
  const offenders = await page.evaluate(() => {
    // A colour this cannot parse must come back null, not a channel of NaN.
    // Every comparison against NaN is false, so a NaN contrast ratio makes the
    // assertion *pass* — the one failure mode an auditor must not have. Any
    // notation with fewer than three numbers (a keyword, an oklch/lab colour)
    // is refused outright rather than half-read.
    const parse = (c: string) => {
      const m = c.match(/[\d.]+/g);
      if (!m || m.length < 3) return null;
      const [r, g, b, a] = m;
      if (r === undefined || g === undefined || b === undefined) return null;
      return { r: +r, g: +g, b: +b, a: a === undefined ? 1 : +a };
    };
    const hasImg = (el: Element) => {
      let n: Element | null = el;
      for (let i = 0; i < 4 && n; i++) {
        if (getComputedStyle(n).backgroundImage !== "none") return true;
        n = n.parentElement;
      }
      return false;
    };
    const dark = document.documentElement.dataset.theme === "dark";
    const bgOf = (el: Element) => {
      let n: Element | null = el;
      const stack: { r: number; g: number; b: number; a: number }[] = [];
      while (n) {
        const c = parse(getComputedStyle(n).backgroundColor);
        if (c && c.a > 0) {
          stack.push(c);
          if (c.a === 1) break;
        }
        n = n.parentElement;
      }
      let base = dark ? { r: 12, g: 14, b: 19 } : { r: 240, g: 244, b: 248 };
      for (let i = stack.length - 1; i >= 0; i--) {
        const c = stack[i]!;
        base = {
          r: c.r * c.a + base.r * (1 - c.a),
          g: c.g * c.a + base.g * (1 - c.a),
          b: c.b * c.a + base.b * (1 - c.a),
        };
      }
      return base;
    };
    const lum = (c: { r: number; g: number; b: number }) => {
      const f = (v: number) => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
    };
    const ratio = (a: { r: number; g: number; b: number }, b: typeof a) => {
      const l1 = lum(a);
      const l2 = lum(b);
      return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    };
    const bad: {
      sel: string;
      ratio: number;
      need: number;
      text: string;
      fg: string;
      bg: string;
      theme: string;
    }[] = [];
    for (const el of Array.from(document.querySelectorAll("body *"))) {
      const cs = getComputedStyle(el);
      if (
        cs.visibility === "hidden" ||
        cs.display === "none" ||
        cs.opacity === "0"
      )
        continue;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      const own = Array.from(el.childNodes).some(
        (n) => n.nodeType === 3 && (n.textContent ?? "").trim().length > 1,
      );
      if (!own || hasImg(el)) continue;
      const fg = parse(cs.color);
      if (!fg) continue;
      const bg = bgOf(el);
      const eff = {
        r: fg.r * fg.a + bg.r * (1 - fg.a),
        g: fg.g * fg.a + bg.g * (1 - fg.a),
        b: fg.b * fg.a + bg.b * (1 - fg.a),
      };
      const size = parseFloat(cs.fontSize);
      const bold = parseInt(cs.fontWeight, 10) >= 700;
      const need = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
      const cr = ratio(eff, bg);
      if (cr < need)
        bad.push({
          sel:
            el.tagName.toLowerCase() + "." + String(el.className).slice(0, 22),
          ratio: +cr.toFixed(2),
          need,
          text: (el.textContent ?? "").trim().slice(0, 22),
          fg: cs.color,
          bg: `rgb(${Math.round(bg.r)}, ${Math.round(bg.g)}, ${Math.round(bg.b)})`,
          theme: document.documentElement.dataset.theme ?? "(unset)",
        });
    }
    return bad;
  });
  expect(
    offenders,
    `unreadable text: ${JSON.stringify(offenders.slice(0, 10))}`,
  ).toEqual([]);
}

/** Nothing is cut off, squashed, or painted over by something see-through. */
export async function assertNothingClipped(page: Page) {
  const offenders = await page.evaluate(() => {
    const label = (el: Element) =>
      el.tagName.toLowerCase() +
      (typeof el.className === "string" && el.className
        ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".")
        : "");
    const textRect = (el: Element) => {
      const rg = document.createRange();
      let any = false;
      for (const n of Array.from(el.childNodes)) {
        if (n.nodeType === 3 && (n.textContent ?? "").trim().length > 1) {
          if (!any) {
            rg.setStartBefore(n);
            any = true;
          }
          rg.setEndAfter(n);
        }
      }
      if (!any) return null;
      const r = rg.getBoundingClientRect();
      return r.width < 2 && r.height < 2 ? null : r;
    };
    const bad: { sel: string; issue: string; px?: number }[] = [];
    for (const el of Array.from(document.querySelectorAll("body *"))) {
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none") continue;
      if (/sr-only|visually-hidden/.test(String(el.className))) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;

      // A custom control squashed by a min-height it never asked for.
      if (
        cs.appearance === "none" &&
        ["INPUT", "SELECT", "BUTTON"].includes(el.tagName)
      ) {
        const h = parseFloat(cs.height);
        const mh = parseFloat(cs.minHeight) || 0;
        if (mh > h + 1)
          bad.push({
            sel: label(el),
            issue: "min-height overrides height",
            px: mh,
          });
      }

      // Glyphs painted outside their own padding box with no ellipsis to say so.
      const tr = textRect(el);
      if (
        tr &&
        /hidden|clip/.test(cs.overflowX) &&
        cs.textOverflow !== "ellipsis"
      ) {
        const padR = parseFloat(cs.paddingRight) || 0;
        const padL = parseFloat(cs.paddingLeft) || 0;
        const over = Math.max(
          tr.right - (r.right - padR),
          r.left + padL - tr.left,
        );
        if (over > 1.5)
          bad.push({
            sel: label(el),
            issue: "text outside its box",
            px: Math.round(over),
          });
      }
    }
    return bad;
  });
  expect(
    offenders,
    `layout defects: ${JSON.stringify(offenders.slice(0, 10))}`,
  ).toEqual([]);
}

/** The page does not scroll sideways at any width. */
export async function assertNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
  }));
  expect(
    overflow.scrollW,
    `page scrolls horizontally: ${overflow.scrollW} > ${overflow.clientW}`,
  ).toBeLessThanOrEqual(overflow.clientW + 1);
}

/** The mark is present and not stretched. */
export async function assertLogo(page: Page) {
  const logo = page
    .locator("img[src*='acrow-logo'], [data-testid='abp-logo']")
    .first();
  await expect(logo).toBeVisible();
  const box = await logo.boundingBox();
  expect(box, "logo has no box").not.toBeNull();
  if (box) {
    const ratio = box.width / box.height;
    // The real wordmark is 522x125 ~ 4.18:1. Anything far off means it was
    // forced into a square or a strip.
    expect(
      ratio,
      `logo aspect ratio drifted: ${ratio.toFixed(2)}`,
    ).toBeGreaterThan(2.5);
    expect(ratio).toBeLessThan(6);
  }
}

export async function captureScreen(page: Page, name: string) {
  await expect(page).toHaveScreenshot(`${name}.png`, {
    fullPage: true,
    animations: "disabled",
    mask: [page.locator("canvas")],
  });
}
