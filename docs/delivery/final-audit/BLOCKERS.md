# Remaining Blockers

Status date: 2026-09-13.

RC: `v1.0.0-rc.1` · Commit: `1c94fc9` · Technical RC: **FROZEN** · Exact-tag production smoke: **PASS** · Visual / interaction acceptance: **PASS** · Role UAT: **PASS**

## Technical release blockers

1. **Operational handoff only.** The technical gates are closed. Customer operations must supply the one-time production administrator credential through the protected handoff process; no credential is stored in this repository or evidence.

## Recorded non-blocking items

- OpenAI advisory generation remains optional. Disabled-state behavior passes; a live external response requires a protected customer-supplied key.
- The lazy Three.js vendor chunk is about 681 kB minified and about 172 kB gzip. It remains lazy and below the configured 700 kB warning threshold.
- Mobile Metro tooling has tracked advisories that are absent from the self-hosted web/API production images.
- Off-host backup retention belongs to customer IT operations.
- Customer/business sign-off is pending handover and does not block the technical RC once the technical gates pass.

Database-backed tests, 9/9 role API UAT, 156/156 browser captures, 14/14 long-form forms (three captures per form: desktop, mobile and Arabic RTL, with successful saves), the 1,118-control audit (0 failures), Smart Import, backup/restore, security proof and exact-tag production smoke are complete. Technical blockers: none. Tag `v1.0.0-rc.1` is frozen.
