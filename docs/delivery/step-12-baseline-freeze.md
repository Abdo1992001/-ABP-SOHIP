# Step 12 Baseline Freeze Record

The technical baseline is verified but is not an immutable release candidate. The repository is on `main` at `a23753b33d9c91a133c93dbfcd48b40feb878226`; the starting Step-12 inspection found 247 dirty paths. Therefore Docker, Bicep and CI sources cannot truthfully be attributed to the commit alone.

Verified evidence: OpenAPI 1.6.0, 217/217 mandatory operations, generated-client drift 0, PostgreSQL 17.11 with 35 migrations and zero schema drift, 55/55 screens, 195/195 actions, 72 metrics, 18 reports, local Docker runtime, Electron build and unsigned MSIX layout. A reviewed clean commit/tag and image digests are required before production.

Machine-readable evidence: `docs/governance/step-12-baseline-freeze.json`.
