/**
 * Theme preference and the theme actually in effect.
 *
 * These are two different things and the app used to conflate them: it stored
 * "light" or "dark" and wrote that straight onto the document, so there was no
 * way to say "follow my machine". The preference is what the user chose —
 * light, dark, or system — and the resolved theme is what that means right
 * now. Only the resolved value reaches `data-theme`.
 */

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "abp.theme";

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

/**
 * Read the stored preference. Falls back to "system", which is the honest
 * default for someone who has never chosen: follow the machine they are on.
 * A blocked or empty localStorage must not stop the app rendering.
 */
export function readStoredTheme(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isThemePreference(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

export function storeTheme(preference: ThemePreference): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // A private window or blocked site data: the session still works, the
    // choice just does not outlive it.
  }
}

/**
 * Not every environment the app renders in implements matchMedia — a test
 * renderer, an embedded webview, a very old browser. Light is the safe answer
 * there: it is the theme the product was designed in, and a missing media
 * query must not stop the shell mounting.
 */
function prefersDark(): MediaQueryList | null {
  if (typeof window.matchMedia !== "function") return null;
  return window.matchMedia("(prefers-color-scheme: dark)");
}

export function systemTheme(): ResolvedTheme {
  return prefersDark()?.matches === true ? "dark" : "light";
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  return preference === "system" ? systemTheme() : preference;
}

/**
 * Apply the resolved theme to the document. `color-scheme` is set alongside
 * it so the browser's own chrome — scrollbars, form controls it draws itself,
 * the flash before paint — matches instead of staying light on a dark page.
 */
export function applyTheme(resolved: ResolvedTheme): void {
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
}

/**
 * Call `onChange` when the OS preference flips. Only meaningful while the
 * preference is "system"; the caller unsubscribes otherwise.
 */
export function watchSystemTheme(
  onChange: (resolved: ResolvedTheme) => void,
): () => void {
  const query = prefersDark();
  if (!query) return () => undefined;
  const listener = (event: MediaQueryListEvent) => {
    onChange(event.matches ? "dark" : "light");
  };
  query.addEventListener("change", listener);
  return () => {
    query.removeEventListener("change", listener);
  };
}
