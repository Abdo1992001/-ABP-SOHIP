# Production Readiness

Status date: 2026-09-13.

RC: `v1.0.0-rc.1` · Commit: `1c94fc9` · Technical RC: **FROZEN** · Exact-tag production smoke: **PASS** · Visual / interaction acceptance: **PASS** · Role UAT: **PASS**

**RC FROZEN — v1.0.0-rc.1.** Functional acceptance, the representative visual UAT pack, the named long-form matrix and the exhaustive action audit pass. Exact-tag production smoke is healthy.

## Passed gates

- Database tests: 13/13 against PostgreSQL.
- API tests: 47/47, with zero mandatory integration skips.
- Web tests: 22/22.
- Worker tests: 1/1.
- Authorization tests: 4/4.
- OpenAPI contract: 255/255 operations implemented and typed, generated drift 0.
- Nine-role API lifecycle: 9/9 roles, including password change, MFA enrollment and verification, logout/login, recovery material generation, role isolation and Customer Portal binding.
- Browser visual UAT: 156/156 captures across 9/9 roles, English/LTR, Arabic/RTL, light/dark themes and desktop/tablet/mobile viewports. No captured horizontal overflow or clipped page bottoms.
- Named long-form matrix: 14/14 forms, each captured at 1366×768 English, 390×844 English and 1366×768 Arabic RTL; required-field validation, cancel reachability, responsive overflow and successful save evidence all pass. Product edit is covered; product creation has no create-product API contract.
- Every-visible-control audit: 1,118 controls inspected across the authenticated route set; 1,073 observable passes, 45 intentionally skipped destructive/mutation controls, 0 failures. Evidence: `docs/delivery/final-audit/action-audit.json`.
- Smart Import: real CSV upload, validation, review, commit and reconciliation completed through the UI.
- Production smoke: PostgreSQL, API, worker, web, reverse proxy and HTTPS healthy from the current production images.
- Production database cleanliness: accounts 0, opportunities 0, quotations 0 and payments 0.
- Backup/restore and security proofs: PASS.

Production PostgreSQL is 17.11 with 41 applied migrations. Current image digests are recorded in the production evidence and smoke output. OpenAI advisory support is optional and its disabled state is accepted; it is not a release blocker. The lazy Three.js chunk and Metro advisories are recorded non-blocking tooling findings.

## Remaining hard gates

1. Customer operations must supply the one-time production administrator credential through the protected handoff process; no credential is stored in this repository or evidence.

RC tag: `v1.0.0-rc.1`. No final credentials are stored in this repository or evidence.
