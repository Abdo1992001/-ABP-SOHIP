# ERP import pipeline

Turns ACROW's flat Excel exports into the CRM's canonical records.

```
Excel file
  → INGESTION       read the sheet, map headers to logical field names
  → STAGING         every row persisted in import_rows (raw + normalized)
  → CLEANING        per-field cleanup                     lib/normalize.mjs
  → NORMALIZATION   names, countries, currencies, keys    lib/normalize.mjs
  → MATCHING        ordered item ↔ item master, by barcode first
  → ENTITY RES.     customer number → one canonical account
  → DEDUPLICATION   3,459 rows → 121 customers / 789 orders / 3,459 items
  → VALIDATION      missing keys, unknown country, unmatched product
  → WARNINGS        dq_issues rows — nothing is ever silently guessed
  → CANONICAL       accounts / products / erp_orders / erp_order_lines
```

Nothing goes straight to production: every run opens an `import_batches` job
(`IMP-001`, `IMP-002`, …), stages the rows, records its warnings in `dq_issues`,
and writes a summary of the counters onto the job.

## Running it

```bash
# 1. What would be deleted? (seeded demo data only — users, roles and
#    reference data are never touched)
node scripts/etl/purge-demo-data.mjs --dry-run
node scripts/etl/purge-demo-data.mjs

# 2. Dry run of the full pipeline: cleans, normalizes, matches, validates and
#    prints the staging report, then rolls the canonical writes back.
node scripts/etl/run-import.mjs --preview \
  --items  "…/pvc codes.xlsx" \
  --orders "…/customer list.xlsx"

# 3. For real. Item master first — the order stage matches against it, and
#    matching against a half-loaded dictionary reports false "unmatched" items.
node scripts/etl/run-import.mjs \
  --items  "…/pvc codes.xlsx" \
  --orders "…/customer list.xlsx"

# 4. Country access. Records are scoped by country; without this, users keep
#    the seeded EG/AE/SA scope and silently cannot see the other 22 countries.
node scripts/etl/grant-imported-countries.mjs
```

`DATABASE_URL` defaults to `postgresql://abp:abp@localhost:5432/abp`.

Re-running is safe: every canonical id is derived from the record's natural key
(`stableUuid`), so a second run updates the same rows instead of duplicating.

## The decisions worth knowing about

**"customer list.xlsx" is not a customer list.** It is one row per order _line_.
The same customer and order repeat across rows. Customer Number is the customer's
identity, Order Number is the order's — two spellings of one name under one
number are one customer, and the raw spellings are kept on the record for audit.

**Not every ordered item is a product.** Transportation, freight, service and
adjustment lines sit in the same column as real boards. `lib/classify.mjs` sorts
them into `SELLABLE_PRODUCT` / `SERVICE` / `LOGISTICS_CHARGE` / `MISCELLANEOUS` /
`UNKNOWN`, so "top products sold" means something.

**Barcode is the join key.** The item master's `Barcode` is what the order export
puts in `Ordered Item`. An exact code match is certain; a normalized-description
match is recorded as the weaker `MATCHED_DESCRIPTION` so a reviewer can see it.
No match means the line goes to review — a product is never invented.

**Group companies are not customers.** WORCA (Australia), ACROW DZ, Acrow LLC
(Oman), Acrow Morocco, ACROW Nigeria and the Arabic-named Egyptian, Saudi, Gulf
and Jordanian entities are ACROW affiliates. Their orders are kept in full, but
flagged `is_intercompany`, so "external sales" and "intercompany sales" are never
added together. As of the current data that split is roughly 176M vs 178M EGP —
combining them would overstate the external market by about a factor of two.

**Unresolvable values are flagged, not guessed.** A country that is not in the
catalog is parked on `ZZ` (Unknown country) _and_ raised as a warning, rather
than being filed under Egypt because that is the most common value in the file.

## Adding another source file

Add a module under `sources/` exporting `sheet`, `importTypeCode`, `entityCode`,
`columns`, `normalizeRow(record)` and `load(db, ctx, staged)`, then call it from
`run-import.mjs`. Everything else — staging, job records, issue writing, country
upserts, deterministic ids — is already in `lib/pipeline.mjs`.
