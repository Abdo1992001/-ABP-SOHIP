# Adding data and changing templates

How to get data into the ABP Commercial System, and how to change the files it
produces, without a developer for the everyday cases.

## 1. Adding data in bulk (customers, items, ERP orders)

1. Open **ERP & Data → Import center** (`/data/imports`).
2. Choose the kind of import: _Customers_, _Sales orders (ERP)_ or _Item master_.
3. Press **Download Excel template** (or _CSV_). The file has exactly the
   columns the importer reads. Red headings are required; hover a heading in
   Excel to see what goes there and an example. The same guide is shown under
   the upload form.
4. Fill **one row per record** under the headings. Keep the single sheet and
   the heading names as they are; do not add formulas or links (they are
   rejected for safety).
5. Upload the file. The system detects the columns, validates every row and
   shows a preview with the problems it found.
6. Commit. A batch can be rolled back from the same screen.

Uploading the same customer number / SKU / order number again **updates** the
record instead of creating a duplicate, so a monthly re-export from the ERP is
safe to upload.

## 2. Adding records one at a time

| What                          | Where                                                                 |
| ----------------------------- | --------------------------------------------------------------------- |
| Customer, contact, project    | Sales → Customers / Contacts / Projects → **+ New**                   |
| Quotation                     | Sales → New quotation wizard                                          |
| Customer order                | Sales → Customer orders → **Book order** (from an accepted quotation) |
| Production run                | Operations → Work orders → **Plan production** (or from the order)    |
| Shipment                      | Logistics → Shipments → **Plan shipment** (or from the order)         |
| Payment received              | Finance → Receivables → **Record payment**                            |
| Complaint                     | Customer service → Complaints → **Log complaint**                     |
| A customer's exact location   | Sales → Customer map → **Pin a place**                                |
| Many locations at once        | Sales → Customer map → **Pins from a sheet** (see below)              |
| Prices, capacity rates, users | Administration                                                        |

**Pins from a sheet.** On the Customer map, **Download sheet** gives every
customer and project you can see, one per row, with any pin already dropped.
Fill **Latitude** and **Longitude** (in Google Maps, right-click the place and
click the numbers to copy them; pasting both into the Latitude cell works).
Leave **Type** and **Reference** as they are, and leave rows you do not know
empty. **Upload filled sheet** shows how many places will be pinned, which rows
need fixing and why, and corrects coordinates typed the wrong way round where
that is certain; **Save** writes them one by one with a progress bar.

## 3. Customer feedback link

Send customers `/feedback` (no account needed). From an order, **Ask for
feedback** copies a link with the order already filled in. Answers arrive in
Sales → Customer feedback, routed to the salesperson; critical ones open a
complaint by themselves.

## 4. Changing a document template

The quotation, proforma and cargo-report Excel layouts are files in
`apps/web/public/templates/`:

- `abp-quotation.xlsx`, `abp-proforma.xlsx`, `abp-cargo-boards.xlsx`

To change the look (logo, colours, fonts, wording of fixed text, column
widths): open the file in Excel, edit it **without moving or renaming the
cells the system fills** (the line table, totals, customer block), save, and
rebuild the web image (`docker compose build web` then
`docker compose up -d web`). Keep a copy of the previous file.

## 5. Adding a column to an import (developer)

1. Add the column to `apps/web/src/lib/import-templates.ts` (the template and
   the on-screen guide come from here).
2. Read it in the import commit for that type in
   `apps/worker/src/workflow-handlers.ts`.
3. If it is required, add it to `apps/api/src/imports/import-rules.ts`.
4. Run the tests, rebuild `api`, `worker` and `web`.

## 6. Adding a new kind of record or screen (developer)

The order is always: database migration → Prisma model → API (service,
controller, DTO) → contract (`docs/contracts/openapi`) and the generators →
web screen registered in `screen-registry.ts`, `App.tsx`, `screen-purpose.ts`
and `role-route-matrix.ts`. Each of the stages added in October 2026
(customer orders, receivables, complaints route, shipments, work orders,
feedback, map) is a worked example of that order in the git history.
