/**
 * Where the CSRF token lives between requests.
 *
 * It used to live in `sessionStorage`, which dies with the browser tab — but
 * the session cookie that authenticates the user is set with an absolute
 * `expires`, so it survives the tab, the window and a browser restart. Reopen
 * the app the next morning and you are still signed in with no login screen,
 * only now there is no CSRF token: every GET works, and every write comes back
 * 403 `errors.forbidden`. That is what made "Start a deal here", saving a
 * quotation and the rest of the write paths fail out of nowhere.
 *
 * `localStorage` matches the cookie's lifetime, which is the whole point. It is
 * no weaker: a CSRF token is not a credential but a value the legitimate origin
 * has to echo back, another site cannot read either storage, and script running
 * on this origin could read both equally. The token is cleared on logout and
 * whenever the server rejects it, so a stale one cannot linger.
 *
 * Every accessor is wrapped: storage throws outright in a locked-down browser
 * profile, and an exception here would take down the whole API client.
 */

const KEY = "abp.csrf";

export function readCsrfToken(): string | null {
  try {
    const stored = window.localStorage.getItem(KEY);
    if (stored) return stored;
    // Someone who was signed in when this shipped still has their token in the
    // old place. Move it across rather than making them sign in again.
    const legacy = window.sessionStorage.getItem(KEY);
    if (legacy) {
      window.localStorage.setItem(KEY, legacy);
      window.sessionStorage.removeItem(KEY);
      return legacy;
    }
    return null;
  } catch {
    return null;
  }
}

export function writeCsrfToken(token: string): void {
  try {
    window.localStorage.setItem(KEY, token);
  } catch {
    /* A browser that refuses storage will 403 on writes; nothing else to do. */
  }
}

export function clearCsrfToken(): void {
  try {
    window.localStorage.removeItem(KEY);
    // Remove the old location too, so a token left over from a build before
    // this change cannot be read back by anything still looking there.
    window.sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
