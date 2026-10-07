+# Step 6 Migration Manifest

## 20260822020000_step6_physical_schema

- Purpose: implements the eight physical-schema domains handed off by Step 5.
- Tables created: 24 new reference/configuration/history/fact tables, including quotation approval/document/send provenance; import/DQ/reconciliation/ERP facts; capacity estimates; logistics planning placements; FX, payments and cheques; returns; targets; continents.
- Tables altered: `pricing_rules` gains `version` and `row_version`; `countries` gains a validated-later governed continent FK declared NOT VALID so existing authoritative data is never fabricated.
- Constraints/indexes: FKs use RESTRICT for historical commercial relationships; business keys, money/quantity bounds, capacity 900/700/600 at 24h, 0/90 rotation, 25% returned-scrap rule, effective-date checks, and query indexes are included.
- SQL objects: overlap-rejection triggers for active price/FX ranges; SENT quotation header/line/adjustment immutability triggers; final official-document immutability trigger.
- Backfill: none. No existing commercial facts needed invented values.
- Risk: additive forward migration only. Existing data is preserved.
- Fresh DB / upgrade result: migration uses only ordinary PostgreSQL 17/Azure Flexible Server supported SQL and is applied locally through Prisma migration history.

## Step 7 forward physical support

- `20260822032000_step7_import_dq_reconciliation`: typed import intake/preview lineage, DQ resolution concurrency, reconciliation issues/runs, and item resolver mappings.
- `20260822032100_step7_import_actor_contract`: makes the contracted import creator identity non-null after a guarded backfill.
- `20260822032200_step7_continent_code_alignment`: corrects the legacy two-character continent key so canonical values such as `AFRICA` and `OCEANIA` are FK-valid.
- `20260822033000_step7_capacity_runtime`: adds immutable multi-category estimate runs/items, rate snapshots, canonical seed rates, and effective-range overlap protection.
- `20260822034000_step7_logistics_runtime`: adds auditable Flat-on-Face plan inputs, transport snapshots, optimizer runs, placements, validation results, and export job records.
- `20260822035000_step7_finance_runtime`: adds governed FX authorship/supersession, payment facts and allocations, and cheque lifecycle evidence/concurrency.
- `20260822035100_step7_fx_overlap_alignment`: aligns the database overlap guard with the authoritative APPROVED FX status.
- `20260822036000_step7_returned_scrap_runtime`: adds returned-scrap request/line policy lineage, approval state, decimal benefit evidence, and concurrency.
- `20260822036100_step7_returned_scrap_default_alignment`: aligns the fixed 25% policy default without changing historical rows.
- `20260822037000_step7_targets_runtime`: adds versioned ACROW/USD annual and period target configuration tied only to WON snapshots.
- `20260822038000_step7_support_runtime`: adds project contact roles, complaint cases, identity row versions/permission UUIDs, user preferences/notifications, advisory outputs, document upload/link metadata, export events, and security events.
- All eleven are forward-only migrations; no applied migration was edited. PostgreSQL 17 deploy/status passes with 31 migrations.
