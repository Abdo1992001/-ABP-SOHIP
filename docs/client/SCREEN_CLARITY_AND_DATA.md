# Every screen says what it is, and has something to show

Two complaints drove this work, and they are different problems with the same
symptom — a screen you open and cannot read.

> «معظم الشاشات فيها زحمة مش فاهمها ومش مفهوم بتاعة ايه وجاية منين وشاشات تانية ناقصة داتا»

The first is **crowding without explanation**: a title, a table, and no
statement of what the screen is for or where its rows came from. The second is
**screens with no rows at all**, which look broken rather than empty. Neither
is fixed by rearranging anything.

---

## 1. One place that says what every screen is for

`apps/web/src/app/screen-purpose.ts` holds, for all **69** screens, two
sentences in both languages:

| Field     | Answers                                               | Where it appears                                  |
| --------- | ----------------------------------------------------- | ------------------------------------------------- |
| `purpose` | What decision this screen supports                    | Always visible, in the header's own subtitle line |
| `source`  | Which system the rows come from, and what limits them | Behind a disclosure, closed by default            |

The split is the point. The purpose costs no extra space — it goes in the slot
a subtitle was already using. The provenance is a question somebody asks once
about a screen and then never again, so printing it permanently would _add_
the clutter it exists to relieve. Closed, it is one quiet line: **«الداتا دي
جاية منين؟»**

A worked example, from the quotation studio:

> **Purpose** — تسعّر الشغلانة: أسعار الألواح والأوزان والخصومات والشروط
> والإجماليات، وكل رقم مكتوب جاي منين.
>
> **Source** — الأسعار جاية من أساس التسعير بتاع الشركة إلا لو العرض ده أو بند
> لوحده غيّرها — والمصدر المطبّق مكتوب على كل بند.

### How it reaches all 69 screens

The route already knows which screen it is, so the header asks rather than each
screen being told. `ScreenIdProvider` wraps every route in `App.tsx`; `PageHeader`
reads the context; the twenty-two screens that draw their own header got a
one-line `<ScreenIntro />`. The alternative — a `sub` prop threaded through
sixty-nine components — is sixty-nine places for the wording to drift, and one
place for it to go missing: the screen somebody adds next.

Where a screen writes its own subtitle it keeps it, because it can usually say
something the registry cannot — a date, a count, a scope. The registry line
steps aside rather than repeating it, and the provenance is added either way,
because provenance is the half nobody thinks to write.

### It is enforced, not just written

`apps/web/e2e/screen-intro.spec.ts` walks every parameterless screen in the
registry and asserts each one explains itself, against a permissive session and
**empty** collections — deliberately, because a screen that only explains itself
once data arrives says nothing on the day that matters most.

It also rejects a purpose or source too short to be useful, which is what stops
the table decaying into restated titles.

---

## 2. What the sweep found

Three defects that no amount of reading the source would have surfaced, because
each needed the screen to actually render:

| Screen                  | Defect                                                                                                                                                                                                                                                                                                        | Fix                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Sales overview `/sales` | **Crashed** — `TypeError: reading 'orderCount'` — when `/reports/sales-history` returned a 200 whose body was not a history object. The guard tested that the request had returned, not that it returned something usable, so one unexpected payload took the whole dashboard down instead of hiding one band | Guarded on the shape                                  |
| Reports `/reports`      | When the report registry is unreachable, the header was dropped with it: a bare red sentence on an empty page, in the state where the reader is least able to guess what they opened                                                                                                                          | The error state keeps its heading and its explanation |
| Contact `/contacts/:id` | English-only, two mojibake strings (`Â·`, `contactâ€¦`), raw `WHATSAPP: +20…` pairs, and neither channel endpoint ever called                                                                                                                                                                                 | Rebuilt — see below                                   |

The dashboard crash is a robustness fix, not a bug being hit today: the real
endpoint returns the right shape. It is worth having anyway, because the
failure mode was the entire screen rather than the one section at fault.

---

## 3. The contact screen, rebuilt

It read `Contact-only projection` over `WHATSAPP: +20 100…` — a field name and
a value, with no way to act on either. The point of a contact is that you can
reach the person.

- Channels are **links you can press** — `tel:`, `mailto:`, `wa.me` — with the
  kind as a quiet label beside the value, not a code in front of it
- `POST /contacts/{id}/channels` and `DELETE /contact-channels/{id}` are wired.
  Both existed the whole time with nothing calling them
- The first channel of its kind is marked primary, so there is an answer to
  "which number do I try"
- Bilingual throughout; the two mojibake strings are gone
- The narrow-visibility notice stays, because it is true — a shared contact
  does not carry its customer with it — but it now says what you can and
  cannot do rather than warning about a projection

---

## 4. The screens that had nothing to show

Twelve tables were empty while the screen reading them was finished and wired.
`packages/database/scripts/demo-fill.sql` fills them, idempotently — it only
ever adds rows, never updates or deletes, so it is safe to re-run and safe
against a database with real work in it.

| Table                           | Was | Now   | The screen it unblocks                          |
| ------------------------------- | --- | ----- | ----------------------------------------------- |
| `contact_channels`              | 0   | 46    | Contacts — not one phone number existed         |
| `shipment_milestone_events`     | 0   | 50    | Shipment detail — 20 shipments, no history      |
| `payment_allocations`           | 0   | 20    | Payments — "where did this money go"            |
| `customer_segment_definitions`  | 0   | 5     | Customer segments                               |
| `customer_segment_assignments`  | 0   | 142   | Segments, and the pricing rules that read them  |
| `cheques`                       | 0   | 12    | Cheques                                         |
| `document_templates` / versions | 0   | 4 / 8 | Document templates                              |
| `reconciliation_runs` / issues  | 0   | 1 / 6 | Reconciliation                                  |
| `pricing_guardrails`            | 0   | 3     | Commercial policies — and the price check below |
| `quotation_adjustments`         | 0   | 5     | Discounts, never once exercised                 |

Three rules the fill follows, because demo data that lies is worse than none:

- **The real vocabulary.** Shipment stages are the four the shipment records
  already use — `SHIPPED`, `VESSEL_DEPARTED`, `ARRIVED_AT_PORT_OF_DISCHARGE`,
  `READY_FOR_DELIVERY` — not an invented set
- **No history a record has not reached.** Each shipment gets its milestones up
  to where it actually is. A container still at sea that reports being
  delivered makes the screen a liar
- **Variety, because uniformity proves nothing.** Cheques span four states
  including bounced; one payment in four is a part payment, so the screen has
  to show an unallocated remainder somewhere

Twenty-three enum codes that arrived with this data were given bilingual
labels, so none of it shows as a raw code.

---

## 4a. Six screens whose columns asked for fields the API does not return

Filling those tables had a consequence I did not expect: screens that had
looked merely empty started rendering rows of dashes. A column whose `field`
does not match the response is indistinguishable from a record with no value
there — so while a table had no rows, a wrong column name was invisible.

Found by hand, then the rest by a script that resolves every list operation in
`docs/contracts/openapi` and compares its response properties against the
columns each screen declares:

| Screen             | Asked for                                                      | The API returns                                                                 |
| ------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Cheques            | `chequeRef`                                                    | `chequeNumber`                                                                  |
| Document templates | `templateCode`                                                 | `code`                                                                          |
| Customer segments  | `name`, `segmentCode`                                          | `displayNameEn` / `displayNameAr`, `code`                                       |
| Reconciliation     | `runRef`, `issueCount`                                         | neither — the counts are inside `summaryJsonb`                                  |
| Watchlist          | `resourceTypeCode`                                             | `resourceType`                                                                  |
| Capacity estimate  | `estimateId`, `categoryCode`, `boardsRequired`, `daysRequired` | **none of them** — a row is a run, and the figures are inside its `items` array |

The last one is the reason the audit was worth writing: every column on that
screen was wrong, and nothing said so. The same mistake was in the first draft
of the capacity screen below — I wrote it, the audit caught it, it is fixed.

Reconciliation now reads `summaryJsonb.comparedCount` and
`summaryJsonb.mismatchCount` through the dotted paths `RecordScreen` already
supported, so the run reports what it actually found.

---

## 4b. Two defects across all twenty-six record screens

- **Rows opened only by mouse.** A `<tr>` with an `onClick` and nothing else is
  unreachable from a keyboard — and on these screens the row _is_ the only way
  into a record, so every record on all of them was unreachable. Rows are now
  focusable, labelled, open on Enter or Space, and show a focus ring
- **The pager read `1 · 383`**, which names neither number. It now says which
  page of how many, and how many records

---

## 5. A tool that existed and was never reachable

`POST /pricing/resolve` has always answered "is this price allowed" — it reads
the pricing rule and the guardrail in force on a date and returns floor,
reference and ceiling with the server's own warnings. Nothing called it.

It is now a **Price check** tab on any product (`/products/:id`, gated on
`pricing.view`): enter a quantity, a currency, and optionally the price you
intend to quote, and it answers in one line — inside the band, below the floor,
or above the ceiling — always naming the figure it judged against.

The reason to call the endpoint rather than divide in the browser is that a
client-side floor and a server-side floor drift, and the day they disagree is
the day a quotation is rejected for a reason the salesperson was never shown.

---

## 5a. Capacity became the tool it was pretending to be

`/capacity` listed saved estimates, offered no way to create one, and there
were none — so it read "No estimates yet" permanently. Its registry entry has
always declared `post_capacity_estimates`, which nothing called. A list of
results from a calculator nobody can run is not a screen; it is a table
waiting for one.

It is now a calculator: the production rates in force, then boards per
category and an optional start date, and an answer in days, hours and a finish
date. **The rate each line was computed with travels with the line**, because
that is what keeps a date promised in March defensible in June after somebody
has changed the rate. Without a start date it says so, and reports a duration
rather than implying a promise.

---

## 5b. Screens that could show data but not change it

Filling those twelve tables created a second-order gap: screens that now
display records and offer nothing to do with them. A cheque register you can
read but not mark as cleared is a report, not a screen.

Rather than promote each generic list to a bespoke component, `RecordScreen`
now looks up an action panel by screen id — from the route's own context, so
nothing is threaded through. Two are defined:

| Record   | What can now be done                                                  | Endpoint that existed uncalled                  |
| -------- | --------------------------------------------------------------------- | ----------------------------------------------- |
| Cheque   | Deposit, clear, bounce or cancel, with the reason the server requires | `POST /finance/cheques/{id}/status-transitions` |
| Shipment | Record the next stage, dated when it _happened_                       | `POST /shipments/{id}/milestones`               |

Both follow the server's own rules rather than a guess at them:

- The cheque transitions are the service's table — `RECEIVED → DEPOSITED`,
  `DEPOSITED → CLEARED / BOUNCED`, `BOUNCED → DEPOSITED`, and `CLEARED` and
  `CANCELLED` final. A terminal cheque offers no buttons and says why
- The milestone endpoint's enum stops at the discharge port, even though
  shipment records also carry `READY_FOR_DELIVERY`. That last step is not
  offered, because a button the schema rejects is a 400 with no explanation
- The milestone form asks when it _happened_, not when it was typed. A
  milestone entered three days late with today's date makes the transit look
  shorter than it was, and that number is what the next quotation promises

`e2e/record-actions.spec.ts` pins the part that matters: not the buttons shown,
but the ones refused.

---

## 5c. Sharing a customer

Three endpoints — list, grant, revoke — none of them called. Without a screen,
the only way to give a colleague access to one account was to widen their
country scope, which hands them every customer in the country to solve a
problem about one.

A grant is narrow in three ways at once, because "share this account" means
very different things: how much (contacts only / customer and contacts / the
full commercial workspace), what they may do (view or edit), and for how long.
The expiry is on the form rather than buried — cover for a week's leave should
end when the leave does — and a grant without one is labelled "no end date"
rather than left blank, because that is the grant that outlives its reason.

---

## 5d. Administering a user

`/admin/users` could create a user and then nothing else — no role, no country
scope, no suspend. A created account was **inert**: it could sign in and see an
empty application, because country scope is the boundary every screen obeys and
roles are where every permission comes from.

Seven endpoints existed for this and none were called. An eighth had to be
**added**: both access PUTs return a user's access only _after_ replacing it,
and nothing returned it before, so an administrator setting roles was
overwriting a list they could not see. `GET /admin/users/{userId}` now exposes
the projection the service already built internally.

The panel starts from what the user already has, requires a reason on every
change, and sends the whole list rather than the delta — `e2e/user-access.spec.ts`
asserts exactly that, because a panel that posts only the boxes you ticked
silently removes every role you did not notice was there.

---

## 5e. The landing screen

A system administrator was redirected to Users & access on their first visit,
so the dashboard was never the home screen for the account that runs the
system. Administering the system is something you go and do; it is not what
you open the morning with. The redirect now applies only to the roles with a
genuine landing screen of their own.

---

## 5f. Measuring the screens instead of reading them

Three checks now run against the built system on :8080 rather than against the
source, because the same class of defect kept surviving a green test suite.

**Every screen, with data.** All 69 screens are opened with responses generated
from the OpenAPI contract itself, so each one renders with the _real_ field
names rather than an empty state. Each is then measured: console errors, text
below the legibility floor, boxes escaping their container, and cells that came
out as an em dash. Empty stubs hide the two defects that matter most — a column
bound to a key the API never returns looks fine on an empty table, and a layout
only breaks once something is in it.

This is what found the customer screen falling to the error boundary when one
row lacked `businessTypeCode`; the dashboard printing «ليس رقم EGP», which is
`NaN` formatted in Arabic; and the action queue reporting two items while
showing none, because a priority code it did not recognise removed the row and
left it in the count.

**Every column, against the contract.** `scripts/check-screen-fields.mjs`
resolves each record screen's list operation back to its response schema and
checks every `field:` path against it. Four reconciliation columns were bound
to counts the run has never written; they had been permanently blank.

**Every operation, three ways.** Which of the 285 contract operations the web
app can actually reach is measured from the requests themselves, from literal
paths in the source, and from operation ids driven through the catalog. The
count is 281. Two of the remaining four are the container health probes, which
belong to infrastructure and not to a screen.

That measurement is also what surfaced the work in §5g.

---

## 5g. Endpoints that worked and could not be reached

**Group membership.** The customer screen showed which group of companies a
customer belonged to and offered no way to change it, while both endpoints had
always worked. The delete could not have been called even deliberately: it
checks an `If-Match` derived from the membership's creation instant, and no
read published that value, so the precondition was unknowable. The customer
detail now carries it and the screen has a panel to add and end memberships.
The box is shown even when a customer is in no group — hiding it meant nobody
could discover that grouping existed.

**The load optimiser.** `POST …/optimize` answers **202**: the run is queued,
not finished. The planner treated it as a completed action and reloaded the
plan immediately, which showed the state from before the run, and then nothing
looked again. The run's own endpoint existed and nothing called it. The planner
now watches the run while it is queued or running, stops polling the moment it
settles, and reloads only when it has actually succeeded.

**The operation catalog had drifted.** It listed 284 operations while the
contract defined 285: the generator had not been re-run after the
formwork-customer mix endpoint was added, so the one screen that drives
operations by id could not have driven that one. A frozen count in a test is
what let it sit — the same trap the contract baseline fell into earlier.

---

## 5h. The Cargo Loader, rebuilt

The loader was a separate application served in an iframe. It had its own
palette, its own typography and its own idea of a button, so the one screen a
customer is shown looked least like the product. It is now a screen in this
system, built from the same tokens as every other one, and the arithmetic sits
in `apps/web/src/lib/` where it is unit-tested.

**It models the chain the business works in: boards → bundles → containers.**
A quotation sells boards; nothing ships a loose board. Same-size boards are
banded into bundles, and it is the bundle a forklift moves and a container
holds. The screen answers both questions at once — how many boards go in a
bundle, and how many bundles go in a box — instead of leaving the first one on
somebody's notepad. A remainder becomes a short bundle at its real height
rather than being rounded into a full one.

**The figures come from the archive, not from assumption.** The proformas in
the Engineering Studio's DATA folder state the board size in the description
("ACROW Board 14.5mm x 882 mm x 1482 mm"), give the weight per board, and show
gross weight running about 10% over net for bearers, banding and wrapping. The
parser reads that description format directly, so pasting a line fills the
three dimensions in; the packing allowance defaults to the 10% the invoices
show.

**Everything that is a business decision is a setting**: banding height and
weight, the bearer allowance, the packing percentage, the container's internal
dimensions and the booked payload. Payload defaults to 25 tonnes and will not
go above 26, because that is the booking limit ABP works to rather than what
the box is plated for.

**Two ways in**: a quotation, which is the real workflow, and typed figures,
which is how the question gets answered on a call before any quotation exists.

**The plan says how to load it** — layer by layer from the floor, with the
bundles, rows and weight in each. A coordinate list is not an instruction.

Two things the rebuild made safe that the old one did not. A browser with no
WebGL used to take the whole screen down with an unhandled error from inside
three.js; the scene now asks first and says plainly that the figures are still
correct and only the picture is missing. And the packing engine is covered by
21 unit tests — overlap, containment, the door as a separate limit from the
box, weight closing a unit before volume, and a plan that is identical for
identical input.

The old application, its nginx location and its sync script have been removed;
the deployed copy was newer than the one on `G:` and was archived beside that
source first.

---

## 5i. An import that reported work it had not done

The import screen offered four kinds of file. **One of them wrote records.**
A file of customers, items or finance could be uploaded, validated, previewed
and committed; the batch reached `COMMITTED` and not one account, product or
payment existed anywhere. The screen reported success for work it had not done.

Underneath it, the rules were two `? :` chains inside the service, and three of
the four types fell through to a generic branch with no natural key and no
required fields. `CUSTOMERS` was matched on `["id", "key"]` — columns no
customer file has — so even if it had written, every upload would have created
duplicates. Country scope was enforced on sales orders alone, though a customer
file carries a country just as directly.

Three things changed:

- **Customers and items now write.** Each row is upserted on its natural key
  with full provenance — source system, source key, batch and row number, all
  columns the schema has always had and nothing ever filled — and an audit
  entry with the before/after hashes, the same way the sales-order path does.
- **The rules are a table** (`apps/api/src/imports/import-rules.ts`), one entry
  per type: natural keys, required fields, whether country scope applies, and
  `writesRecords`. A test asserts that nothing is offered whose commit writes
  nothing, which is the defect itself stated as a rule.
- **Finance was removed from the picker**, because there is no table behind it.
  Offering it was the lie; leaving it out is the truth until it is built.

An item now requires a `familyCode`. A product cannot be filed without a
family, and filing it under a guessed one is worse than refusing the row and
naming the column that is missing.

---

## 5j. A permission that was defined and never enforced

`quotation.approve` and `pricing.approve` were in the contract, granted to
roles, and checked nowhere: a quotation approval required only the general
`approvals.decide`, so a role holding the general right could approve a
quotation it had no authority over. The quotation decision now requires both.
Every role that decides today already holds both, so nobody lost access.

`pricing.approve` stays unenforced on purpose: there is no separate pricing
approval flow, because a price that breaches a guardrail raises a _quotation_
approval. The permission is redundant rather than missing, and inventing a
second workflow to justify it would be the wrong fix.

## 5k. The quotation screen, in the shape of the sheet

The company prices from the ACROW BOARD workbook, and the workbook shows its
working: three blocks of controls, each row reading **setting → override →
applied**, one line naming every applied value, and the equation itself
printed out — `77.76 EGP/kg × 32.149 kg = 2,500.00 EGP per reference board`.

The studio had the same controls in a flat grid of four boxes. Every figure
was there and none of them said where it came from, so the question a
salesperson asks about a quotation — _where did this price come from_ — was
answered by opening the sheet beside the screen. The pricing block is now the
sheet's own layout, and the applied column carries the accent when this
quotation overrode the company's figure.

Rebuilding it surfaced a real drift. The two screens that price a board each
carried their own fallbacks as literals: the wizard had been corrected to the
workbook's **77.76 EGP/kg** and **600 kg/m³**, the studio still had the old
spec document's **90** and **720**. With no company basis stored, the same
board priced differently depending on which screen you opened. Both now read
`apps/web/src/lib/workbook-defaults.ts`, whose seven tests check the figures
against the ones the sheet prints, including its own worked override
(2,368.42 EGP a board is 73.67 EGP/kg).

Two smaller things the same comparison caught:

- A quotation with nothing saved yet inferred its VAT rate by dividing a
  saved tax amount that did not exist, so it showed **0%** and a grand total
  the API would never return. It now falls back to the company rate until the
  first save.
- The **REF** column — the mark an item carries on the drawing — existed on a
  line but was editable only inside the line panel, so a quotation printed
  from the sheet and one read off the screen could not be matched row for row.
  It is a column again, and `Line total` now says `Total excl. VAT`, which is
  what it is.

## 5l. Reading a quotation back out of its own PDF

The company has years of quotations that exist only as PDFs. Re-typing one to
quote a repeat customer is where a quantity gets transposed, so the 167 in the
sample folder were made readable.

The measuring mattered more than the code. A first parser took the quantity by
its position in the row and was **wrong on 110 of 348 lines**, because the
folder does not agree with itself: the price table appears with five different
column sets, including one that prints square metres before the quantity and
one that prints a nesting allowance after it. Position cannot tell them apart.
Arithmetic can — the last figure is the line total, the one before it the unit
price, and the quantity is whichever remaining figure satisfies
`qty x unit = total`.

Where no figure satisfies it the row is **reported, not guessed at**. A
quotation imported with an invented quantity is worse than one that asks to be
checked, because nothing downstream would flag it again.

Against all 167 documents: every one readable, **445 lines read, none with
arithmetic that does not hold**, 16 rows handed back for a person to look at.
And the check that matters — do the lines read add up to the total the document
itself printed — holds for **142 of the 144** that print one. The two that do
not are the same document twice, and its shortfall is exactly the
transportation row the parser had already flagged.

Three things only real documents would have shown:

- A quantity printed hard against the text before it (`WITHOUT TIE ROD
HOLES40`) when the column gap is lost in extraction. The split is accepted
  only when the arithmetic then works, so a wrong split cannot become a
  quantity.
- Rows that carry their own VAT, where the last figure is the total including
  tax. The pair is dropped only when it proves itself: the last figure has to
  be the sum of the two before it at a plausible tax rate.
- Descriptions that wrap out of their cell and land on their own baselines,
  above and below the priced row. They are reattached; before that, an
  imported line could arrive with no description at all.

The upload is built: `POST /quotations/read-pdf` (operation 286), and a panel
on the quotations screen that takes a file and shows the reading. It **reads**
— it writes nothing — because the rows no arithmetic resolves are exactly the
rows a person has to see. The first thing on the panel is therefore the check,
not the lines.

Two things only the real documents showed, again:

- `mark safi.pdf` prints `Quotation  Thursday, April 16, 2026` and no
  reference at all, and the weekday was being stored as the quotation number.
  A reference always carries a digit; a weekday never does.
- The panel is the case worth photographing: it is the one document in the
  folder whose lines do not add up, and the shortfall is exactly the transport
  row shown underneath as needing a person.

Accepting a reading turns it into an ordinary draft: pick the customer and the
opportunity, and the lines are written through the two calls the system
already has — create against an opportunity, then save the draft content.
No third way to create a quotation was added for this one screen.

The customer is **matched, never assumed**. The document names its client in
prose and the system holds a canonical name, so the names are normalised and
compared, and only a _sole exact_ match is preselected. A single close match
is offered and left unselected, because a quotation attached to the wrong
customer is not an error anyone downstream would catch. The panel says which
of the three happened in words.

One rule came out of its own test: a document prints `Concord for Engineering
& Contracting` where the record holds `... and Contracting`. Dropping the
ampersand as punctuation made those two names differ by a whole word and the
exact match failed, so it is spelled out as "and" before punctuation is
stripped. That is the real Concord quotation, and it now matches.

The rows that need a person are deliberately **not** copied into the draft,
and the panel says so.

What is verified how: the parser against all 167 real binaries end to end; the
endpoint live on :8080 (unauthenticated it answers 401, where a route that
does not exist answers 404); and the whole flow in the browser on :8080 in
both locales — a real PDF picked, matched, accepted, and the draft request
carrying the real quantities and prices — with the customer and opportunity
mocked, because signing in needs a password.

---

## 6. What is still open

- **Messages** shows its explanation in the empty right-hand pane rather than
  in the header. The conversation rail is too narrow for a sentence, and the
  empty pane is the one moment somebody is looking at the screen without
  knowing what it is for
- Screens with a route parameter are not in the sweep — it cannot invent a real
  record id. Their purposes are written and rendered, but only the list screens
  are checked automatically
- The price check is on the product screen. The place it is worth the most is
  the quotation line itself, which is a larger change to a screen currently
  carrying the pricing-hierarchy work
- **Message reactions** (`POST /messages/{messageId}/reactions`) is the one
  endpoint left with no route from a screen that is not infrastructure. It was
  left unbuilt deliberately rather than overlooked: reactions add interface to
  an internal commercial thread without adding anything commercial. Worth
  building if the team asks for it, not before
- The screenshots in the leadership deck are the real screens off :8080 with
  representative records rather than live ones, because signing in needs a
  password. Swapping in captures of real records is a five-minute change
- The Cargo Loader reads the proforma **workbooks**. The 168 quotation PDFs in
  the same folder have not been parsed, so a quotation still reaches the loader
  through this system's own records rather than from one of those files
- A bundle's size is worked out from the banding settings, not read from a
  record. If the factory records an actual bundle size per product, that should
  become the source and the settings the fallback
- **Finance imports** have no target table and are no longer offered. Building
  them means deciding what a finance row _is_ — a payment, an invoice, a
  ledger entry — which is a business decision, not a coding one
- The importer accepts `.csv` and `.xlsx`. The quotation archive is PDFs, and
  reading those is a different mechanism entirely, not a setting on this one
