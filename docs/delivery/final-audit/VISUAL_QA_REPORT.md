# Visual QA Report

Status date: 2026-09-13.

RC: `v1.0.0-rc.1` · Commit: `1c94fc9` · Technical RC: **FROZEN** · Exact-tag production smoke: **PASS** · Visual / interaction acceptance: **PASS** · Role UAT: **PASS**

Visual and interaction QA used the local Vite application against the isolated PostgreSQL UAT API. The official representative suite passes **156/156 captures across 9/9 roles**.

## Coverage and results

- Role captures: system administrator 27, sales manager 35, sales user A 12, sales user B 12, sales support 13, logistics 15, operations 10, finance 12 and customer portal 20.
- Viewports: 1920×1080 (2), 1600×900 (2), 1366×768 (135), 1280×720 (2), 1024×768 (2), 768×1024 (2), 390×844 (9) and 375×812 (2).
- Themes: light 147 and dark 9.
- Direction: LTR 147 and Arabic RTL 9.
- Captured horizontal overflow: 0.
- Captured clipped page bottoms: 0.
- Explicit popup/modal checks: 13.

The pack confirms the official ABP identity, localized authentication, sidebar and navigation states, light/dark contrast, mobile menu accessibility, modal focus trapping and focus restoration, Customer 360, Quotation Studio, Engineering, Transport, Messages, Calendar, Admin, Customer Portal and Smart Import.

Smart Import was exercised with an actual CSV file. The UI created a job, uploaded binary content, displayed VALID/WARNING/ERROR/DUPLICATE CANDIDATE/DQ REVIEW counts, committed the accepted fingerprint and completed reconciliation. Its seven-step state and final COMPLETED result were visually accepted.

Evidence is stored under docs/delivery/final-audit/screenshots/; the machine-readable index is visual-uat-results.json.

## Long-form acceptance

The named long-form matrix now passes **14/14 forms** with three captures per form: 1366×768 English, 390×844 English and 1366×768 Arabic RTL. Customer, Contact, Project, Opportunity, Quotation, User, Settings, Target Configuration, Market Signal, Target Account, Payment, Cheque and Returned Scrap all pass required validation focus, save/cancel reachability, responsive overflow checks and real save evidence. Product edit is covered through the existing update contract; product creation has no current create-product API contract.

Evidence and the machine-readable result are under `docs/delivery/final-audit/screenshots/long-forms/`.

## Open acceptance work

The exhaustive action pass now inspects 1,118 visible controls across the authenticated route set. It records 1,073 observable responses, 45 intentionally skipped destructive or mutation controls, and 0 failures. Evidence is stored in `docs/delivery/final-audit/action-audit.json`.

Visual/interaction acceptance is **PASS**. The RC is still not created because immutable release closure requires the final checks and exact-tag smoke from the committed tree.
