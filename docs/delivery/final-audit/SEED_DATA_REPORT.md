# Seed Data Report

`packages/database/prisma/seed.ts` is deterministic/idempotent, refuses production, and requires `ABP_ALLOW_DEMO_SEED=true`. It was run against local and test databases without duplication. Counts: 20 customers, 20 contacts, 20 projects, 25 opportunities, 3 WON snapshots, 15 quotations, 50 activities, 13 products, 20 ERP orders, 20 payments, 20 documents and one target. Monthly target allocations (12) sum exactly to USD 5M.

Every seeded customer has a contact, project, opportunity and ERP order. Five initially lack quotations; this is documented data coverage, not padded with fake links. Production must use a clean database and real target/data configuration.
