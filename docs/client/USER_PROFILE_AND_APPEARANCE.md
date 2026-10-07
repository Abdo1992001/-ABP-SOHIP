# User profile, personal settings, appearance and brand adaptation

Status: delivered. Verified against the running dev stack on `http://localhost:8080`
(`abp-commercial-system-*`), not against source.

This document records what was built, what was deliberately **not** built and why,
and the measurements that back both.

---

## 1. What a person owns, and what they do not

The split is enforced in the DTO, not in the screen. `UpdateMyProfileDto`
(`apps/api/src/support/profile.dto.ts`) declares exactly four properties —
`displayName`, `phone`, `photoVisible`, `phoneVisible`. There is no property for
role, country scope, manager, team or account status, so no request can carry
one even by accident, and no future edit to a screen can introduce the
possibility.

| A person may change                      | Administration sets  |
| ---------------------------------------- | -------------------- |
| Profile photo                            | Role and permissions |
| The name colleagues see                  | Country scope        |
| Phone number                             | Manager and team     |
| Whether photo / phone are visible        | Account status       |
| Theme (light / dark / system)            | Company branding     |
| Language (English / Arabic)              |                      |
| Which notification categories reach them |                      |

Organisational facts are shown as facts on **My profile**, never as disabled
fields. A greyed-out input reads as something broken; a value with a line saying
who sets it reads as something decided.

## 2. My profile — `/profile`

A new screen (`MY_PROFILE`), reachable from the user menu and from the sidebar
under Communication. Four panels:

- **Identity** — the only editable block: photo upload/replace/remove, display
  name, phone. The phone field says whether colleagues can currently see it and
  links to the switch that changes that.
- **Access** — email, job title, account status, roles, country scope,
  workspaces, permission count. Read-only, with the line that says why.
- **This session** — signed in at, expires at, sign-in strength, previous
  sign-in. Only the session you are in, because that is the only one the API
  exposes (see §6).
- **How colleagues see you** — the same card `/people` renders, drawn from the
  real visibility flags.

**Photo handling.** `ProfileService.sniff()` reads the file's magic number and
accepts PNG, JPEG, GIF and WebP only; the declared content type is never
trusted, and there is no `contentType` field in the upload DTO to disagree with
the bytes. SVG is refused outright — an avatar is never an SVG, which can carry
script. Ceiling is 4 MB. Avatars are served from
`GET /users/{userId}/avatar`, cached `private, max-age=86400` and keyed by
`photoUpdatedAt`, so a replaced photo is a new URL and appears without a forced
refresh. Requesting the avatar of someone who has hidden theirs returns 404 —
the rule is applied in the API, not by the card.

**Without a photo**, initials are drawn. They are segmented with
`Intl.Segmenter`, so an Arabic name yields Arabic initials rather than broken
code units, and the tint is derived from the user id, so one person is the same
colour on every screen.

## 3. Finish setting up (the onboarding prompt)

A card at the top of My profile listing only steps this person can act on:

- add a photo
- set a display name that is not their email local part
- add a phone number
- finish two-step verification — **shown only when it is required on their
  account and not yet set up**, because MFA that is neither enabled nor required
  is a choice, not an unfinished step.

It removes itself when nothing is left. It is not dismissible and not
persisted, because it only appears on a page you chose to open — a permanent
banner elsewhere is one people learn to ignore, which costs more than it gains.

## 4. Settings — `/settings`

Was five flat tabs across the top; at laptop width the labels ran out of room,
and a tab strip leaves no space for the one line of description that stops
people opening the wrong section. It is now a grouped sidebar:

```
ACCOUNT      Privacy & visibility      What colleagues can see
WORKSPACE    Appearance & language     Theme, light or dark, Arabic or English
             Notifications             What reaches you
SECURITY     Password & sessions       Sign-in and devices
```

The open section is in the URL (`/settings?section=security`), so a link can
point at one and the back button walks between them. Identity is **not**
duplicated here; the sidebar's top row links out to My profile. A field
editable in two places is a field that will one day show two different answers.

**Responsive.** Below 900px the rail becomes a horizontal row of section chips
above the panel; below 640px the fact lists stack to one column. Measured at
375×812: `document.scrollWidth === clientWidth === 375`, no element crossing the
viewport edge, on both `/profile` and `/settings`.

## 5. Notification preferences are real

Before this work the four notification switches wrote to the preferences blob
and **were read by nothing** — a control that controls nothing, which is worse
than no control, because the person believes they have turned something off.

Every notification now goes through one function,
`notify()` in `apps/api/src/support/notify.ts`, which checks the recipient's
preference before writing the row, inside the same transaction as the thing the
notification is about — a deal that rolls back cannot leave behind a
notification saying it happened.

The categories listed in Settings are exactly the type codes the system emits.
`APPROVAL_NEEDED` is shown as a fixed row rather than a switch: an approval
request is somebody waiting on this person to decide, and silencing it does not
make the decision go away, it makes the deal sit.

There is no email toggle because there is no mailer in this system. A switch for
it would be the same fiction in a new place.

## 6. What was deliberately not built

| Brief item                                         | Why not                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Per-session device list (§31)                      | The API exposes the current session and no endpoint that enumerates a user's other sessions. A list assembled from guesses would be worse than none. **What is offered instead:** the current session's real facts on My profile, and "Sign out everywhere", which is a real operation.       |
| Integrations and Drive (§33)                       | No OAuth flow and no Drive endpoints exist in this architecture.                                                                                                                                                                                                                              |
| Email notification toggles                         | No mailer exists.                                                                                                                                                                                                                                                                             |
| Do Not Disturb / quiet hours (§29)                 | There is no scheduler, and notifications are written synchronously inside business transactions. Suppressing them on a schedule would drop them permanently; hiding them in the client would be cosmetic. Per-category muting already gives the real control, and it is honoured server-side. |
| Three-level visibility (team / company / everyone) | There is no teams table in the schema, so "my team" has no meaning to resolve against. Visibility is Show / Hide, which is a distinction the data can actually make.                                                                                                                          |

## 6a. Correction — two-step verification _is_ implemented

An earlier version of this document stated, in the table above, that MFA
enrolment was not implemented server-side, and the security screen was built on
that assumption. **That was wrong, and the error was mine.** The enrolment
endpoints existed the whole time; I reported an absence I had not verified.

The real flow is now built and wired end to end:

| Step    | What happens                                                                                                                                                                                       |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Start   | `POST /me/mfa/setup` returns an `otpauth://` URI and the shared secret                                                                                                                             |
| Show    | The QR code is rendered client-side, with the secret also printed for anyone whose camera will not read it                                                                                         |
| Confirm | `POST /me/mfa/confirm` with a 6-digit code — enrolment does not complete until a code the authenticator produced has been verified, so a mis-scanned QR fails here rather than at the next sign-in |
| Recover | Ten one-time recovery codes are shown **once**, with that fact stated on the screen; the server stores only their hashes, so there is no screen that can show them again                           |
| Disable | `POST /me/mfa/disable`, refused when the account has MFA _required_ by policy                                                                                                                      |

The secret is encrypted at rest, and a locked-out colleague is recovered by an
administrator from **Account recovery** (§8 below) rather than by a database
edit.

## 7. Brand adaptation and dark mode

**The white logo is a real asset.** `apps/web/public/acrow-logo-white.png` is
generated from the approved artwork with the alpha channel preserved exactly and
only the ink replaced (`inks: {(255,255,255)}`, `size (522,125)`). No CSS
brightness or invert filter is used anywhere. `AbpLogo.tsx` is the single place
the mark is drawn; it watches `data-theme` with a `MutationObserver` and swaps
the source. Height is passed as a CSS custom property, never as an inline
`height`, because an inline height outranked every stylesheet rule and stretched
the 4.2:1 wordmark into a smear.

**Theme model.** `ThemePreference` is `light | dark | system`; `system` follows
the device and keeps following it. `prefersDark()` returns `null` when
`window.matchMedia` is absent rather than throwing, which is also what makes the
component render under a test renderer.

### Defects found and fixed in the dark/light pass

Each of these was found by measuring the running app, not by reading CSS.

| Defect                                                                                                                                                               | Measured                                                       | Fix                                                                                              |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Global `dl` rule painted a divider-colour background under every definition list; lists that pair `dt`/`dd` directly had nothing covering it, so it drew a pale slab | slab on every dark detail screen                               | background scoped to `dl:has(> div)`, the wrapper-cell form it was written for; colour tokenised |
| A third grey palette (`#16182a` / `#687086` / `#9ba3b8`) in the light-theme override block, parallel to the real tokens                                              | 92 declarations; `#9ba3b8` is 2.5:1 on white                   | all 92 repointed to `--ink` / `--ink2` / `--ink3`                                                |
| `.app-shell button.danger` — pale pink on a 15% red wash, written when the shell was dark-only                                                                       | **1.5:1** on the light theme, on a destructive button          | `var(--danger)` on `var(--dangerSoft)`                                                           |
| `.abp2-shell a` outranked `.pro-action-btn`'s own white, so the dashboard's coloured action buttons drew blue link text                                              | 1.2–2.4:1                                                      | rule named with the anchor so it wins                                                            |
| Dashboard action buttons were a colour at 85% opacity — composites darker on dark, _lighter_ on light                                                                | as above                                                       | opaque, two lightest hues taken down a step                                                      |
| Pipeline stage badges wrote their own colour into the style attribute, one hue for text and the same hue at 18% behind it                                            | Won badge **2.7:1** on light                                   | stage names a tone; the stylesheet gives each tone a value per theme; type raised 9.5px → 11px   |
| Customer 360 fact cells, the `.guard` warning strip, `.contact-form`, `.status` strip — fixed light values                                                           | pale slabs on dark; one label at **1.03:1**                    | tokenised                                                                                        |
| `.quotation-fact-strong` used `--abp-crimson`, a background colour, as text                                                                                          | 3.1:1 on the dark card                                         | `var(--brandInk)`                                                                                |
| `.table-empty` at `#9198a9`                                                                                                                                          | 2.6:1 — and an empty state is the only line on the screen      | `var(--ink3)`                                                                                    |
| `.metric-unavailable`, `.dq-note`, `.app-state`                                                                                                                      | 3.0:1                                                          | tokenised                                                                                        |
| Visibility switches were native checkboxes stretched by a global `input { width: 100% }` into 70×42 blue rectangles                                                  | did not read as checkboxes                                     | drawn as real switches, which is what the adjacent label already said                            |
| Password form start-aligned its items, so the two fields came out different widths                                                                                   | —                                                              | `justify-items: stretch`                                                                         |
| `Me` reported workspaces from the user's roles alone, while `hasWorkspace()` grants a system administrator all five                                                  | admin's profile showed 1 workspace for an account that opens 5 | `MeController` now reports all five for a system admin, matching the guard                       |

### Second pass — the states a route sweep never reaches

Walking routes only measures what happens to be on screen. A slide-over that
was never opened, a toast that was never fired and an error banner that never
errored are never measured, so a second probe mounts those component states
against the real stylesheet and measures them directly.

It found one more family of the same defect, and the worst instance in the
codebase:

| Defect                                                                                       | Measured (light theme)                                                                                                                |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `.status-chip` — every tone was a pale ink on the same hue at 20%, written for the dark card | **Won 1.03:1**, Cancelled 1.06, Qualified 1.18, Negotiation 1.20, Hot lead 1.25, Lost 1.26, Neutral 1.83 — the whole family invisible |
| `.error-banner` — the component every screen shares, pale pink on a 12% red wash             | message **1.43:1**, Retry button **1.08:1**                                                                                           |
| `.empty-state` — white at 30% / 50%                                                          | 2.64:1 on dark                                                                                                                        |

All three are tokenised. The chip tones were also aligned to the pipeline
stage badge, so the two chip systems now tell the same colour story:
negotiation and hot-lead violet, proposal blue, qualified teal, won green,
lost red, cancelled amber, neutral grey.

The error banner is the one worth calling out. It is the single component
whose entire job is to be read at the moment something has gone wrong, and on
the light theme neither its message nor its Retry button was legible.

**34 component states × 2 themes, 0 failures.** Weakest: 4.63:1 light,
5.26:1 dark.

### Auth screens

Sign-in and Request access sit outside `.route-content` and so were outside the
route sweep. Measured separately in both themes: 0 findings.

### Final measurement

**45 route states × 2 themes = 90 checks. Zero findings.**

The probe composites every element's background through its translucent
ancestors onto the page ground before computing the ratio (reading
`backgroundColor` alone mis-measures every translucent layer), skips elements
sitting on a gradient, and applies the WCAG thresholds — 3:1 for large or large-bold
text, 4.5:1 for everything else. Transitions are disabled during the sweep, because
a theme switch mid-transition reports intermediate colours. Input and textarea
foregrounds are checked separately, since a field's value is not a child text
node.

Routes covered: all 40 list and workspace screens plus five record-detail
screens and the four settings sections.

## 8. RTL and Arabic

Both new screens were checked in Arabic. The shell mirrors, the settings rail
moves to the correct side, the completion bar fills from the right, and the
switch knob travels the correct direction (`[dir="rtl"]` reverses the
transform). Copy is Egyptian Arabic in the same register as the rest of the
product, not translated English.

## 9. Verification

```
typecheck    apps/api, apps/web, packages/database — clean
API tests    131 passed | 18 skipped
web tests    49 passed
lint         apps/api, apps/web — clean
screens      67 (was 66; MY_PROFILE added, assertions updated in
             step9-frontend.test.ts and step10-analytics.test.ts)
operations   283 (unchanged — the profile endpoints already existed)
contrast     90 checks, 0 findings
responsive   375×812 and 1400×1000, no horizontal overflow
```

## 9b. Third pass — shape, not just colour

Contrast auditing measures what colour a thing is. It cannot tell you that a
thing is the wrong _shape_, and that gap let a real defect ship: the privacy
and notification switches were the right green, measured fine, and rendered as
blobs. `input, select { min-height: 42px }` is a bare-element rule from the
form styles, and **a min-height beats a height whatever the specificity** — so
a track declared 38x22 was drawn 38x42, and with a 999px radius that is a
circle with a bite out of it, not a switch.

So the audit gained three geometry checks, each measuring what is actually
painted rather than what the CSS says:

- **Text outside its own box** — a `Range` over the element's text nodes gives
  the real glyph rectangle, compared against the padding box. (`scrollWidth` is
  not usable here: on a flex container it reports values that have nothing to
  do with whether the label fits, which produced five false positives before
  this was corrected.)
- **A control squashed by a min-height it never asked for** — the bug above,
  now caught by rule.
- **Text that is covered** — sample six points across the glyph box and ask
  `elementFromPoint` what the compositor actually paints there. If something
  unrelated answers _and nothing behind it paints an opaque ground_, the text
  is invisible. Elements already clipped away by a collapsed container are
  excluded, and so is a strip that legitimately covers scrolled content.

### What the shape pass found

| Defect                                                                                                    | What it looked like                                                                                                                                                                                              |
| --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.visibility-switch` track forced to 38x42 by `input { min-height: 42px }`                                | every privacy and notification switch drew as a green blob                                                                                                                                                       |
| `.abp2-shell .tab-bar { background: none }` on a `position: sticky` bar                                   | on the quotation studio the record name, date and status chip scrolled straight through the tabs — a sticky strip that occludes nothing                                                                          |
| `.ai-generate-panel` — a 4-column grid needing ~830px, guarded by a `max-width: 980px` **viewport** query | the viewport does not know the sidebar took 240px of it: at a 1100px window the panel had ~730px, the query never fired, and the Generate button was crushed to **30px** with its label painted outside the card |
| `.abp2-stat-grid` — `auto-fit, minmax(178px, 1fr)` holding one card                                       | that card stretched the full page width, marooned in a row of dead space                                                                                                                                         |

The AI panel now wraps on its own content, which needs no breakpoint to be
right — the general lesson being that inside a shell with a sidebar, a viewport
media query is measuring the wrong box.

**45 routes x 3 widths (1000 / 1100 / 1500) = 135 geometry checks, 0 findings.
45 routes x 2 scroll positions = 90 occlusion checks, 0 findings.**

## 9c. Functional sweep

Separately from appearance: every route walked with `fetch` wrapped and
`error` / `unhandledrejection` / `console.error` captured.

**55 routes: 0 JavaScript errors, 0 failed requests** — after one fix.

`/admin/templates` answered **403 to a system administrator**. The cause was
the same one found in `MeController` earlier: `identity.workspaces` is the raw
set derived from a user's roles, and the SYSTEM_ADMIN role's own workspace
column is `SALES`, so asking it for `"ADMIN"` says no to the one account that
reaches everything. `hasWorkspace()` is the helper that knows this;
`templates.service.ts` and `jobs.service.ts` were calling the raw set instead.
Both now use the helper. The other seven raw uses were checked individually and
left alone: they are query filters and audit-log labels, not access gates.

## 10. Environment: the two-stack ambiguity is resolved

Two Docker stacks ran on this machine. `abp-commercial-system-*` publishes
**:8080** and is the one all of this was built and verified on.
`abp-production-*` held :80 and :443 with a bundle built several days earlier
and a separate, smaller database — so opening `localhost` with no port landed
there and showed none of this work. It caused real confusion twice.

The `abp-production-*` containers are now **stopped** (`docker stop`, not
`down`) — containers and volumes are intact and the stack restarts with
`docker start abp-production-db-1 abp-production-api-1 abp-production-worker-1
abp-production-web-1 abp-production-reverse-proxy-1`. Verified afterwards:
`http://localhost/` has no listener, `http://localhost:8080/profile` returns 200.

Still running: the four `abp-commercial-system-*` containers and `abp-uat-db`
on :5433.
