# Step 11 Verdict

Technical hardening/readiness implementation is complete when the executable evidence named below is green. This does not make the system Production Ready and does not execute Step 12.

# Acceptance Boundary

Local code, PostgreSQL, tests, Docker, IaC, CI/CD design, restore proof, packaging layout, runbooks and evidence are Step 11. Live Azure/Entra/WAF/telemetry, signed MSIX, human approvals, UAT, access certification, training, cutover rehearsal and Go/No-Go remain external/Step 12.

# Starting Baseline

Steps 1–10 PASS; OpenAPI/client 1.4.0; 198/198 mandatory runtime operations; 48/48 screens; 91/91 actions; 71 metrics; 18 reports; zero SSOT deviation.

# Security Architecture

Defense in depth is BFF session → mandatory Country Scope → workspace/RBAC → DENY → relationship/share context → field projection → workflow state. OWASP ASVS 5 L2 plus selected L3 and NIST SSDF 1.1 are control mappings, not certifications.

# Authentication

Production accepts opaque `__Host-abp_session` cookie tokens only after SHA-256 lookup in PostgreSQL. Test headers work only outside Production and only when explicitly enabled; Production startup rejects them.

# MFA

Entra Conditional Access requires MFA for all interactive users, preferably FIDO2/WebAuthn and phishing-resistant methods for privileged/Finance roles. Live evidence is DEP-001.

# Sessions

Backend enforces 30m/12h standard and 15m/8h privileged idle/absolute policy, policy-version snapshot, expiry, active user and secure CSRF-bound sessions. Concurrent issuance policy is 5/3 at the Entra/BFF issuance boundary.

# Session Revocation

Revoked/expired/disabled/policy-version-mismatched sessions fail immediately. No revoked test session is reactivated. Target p95 ≤15s, hard ≤60s.

# Authorization

Existing Step-3 proof and real PostgreSQL API suites cover permission/workspace/owner/manager/team/share/view/edit/export/approve boundaries.

# Country Scope

Country Scope remains mandatory and evaluated before ownership/share/manager logic.

# DENY

DENY wins and is regression-tested.

# IDOR

The cross-domain IDOR/nested-parent matrix covers Customer, Contact, Project, Opportunity, Pricing, Quotation, ERP/DQ, Logistics, Finance, Returns, Documents, Jobs, Analytics and exports; guessed/out-of-scope IDs do not disclose records.

# Mass Assignment

Global DTO validation whitelists fields and rejects non-whitelisted input. Server-owned identity, scope, audit, source, cost/margin, hash, row-version and workflow fields are not client assignable.

# Injection

Prisma/parameterized SQL and whitelisted sort/filter values are authoritative. Security suites cover SQL/search/filter/path/header and spreadsheet injection.

# XSS

React escaping is the default; no raw business HTML path is authorized. CSP and typed rendering cover stored/reflected values.

# CSRF

Unsafe cookie-authenticated operations require a session-bound CSRF token with constant-time hash comparison. Safe methods remain exempt.

# CORS

Only explicit environment origins are credentialed. Production rejects wildcard and localhost origins.

# Security Headers

Helmet emits CSP, frame, HSTS in Production, MIME, referrer and cross-origin protections; Permissions-Policy and no-store are explicit.

# Cookies

Production contract is HttpOnly, Secure, SameSite and `__Host-` scoped. No auth token storage exists in localStorage/sessionStorage.

# Upload Security

JSON is 1MiB. ERP input is limited to 100MiB/250k rows/200 columns; unsafe filename/path/null/control input, ZIP/XLSM/XLSB/XLS/executable types, MIME/signature mismatch, formula/hyperlink/complex cells and CSV formulas are rejected. Document/image limits and scanning quarantine are infrastructure policies; live Defender is DEP-002/003.

# Signed URLs

Document URLs default to 5 minutes (max 15). Export policy is 24h normal, 1h restricted, and never beyond 7 days without explicit approval. Raw Blob paths are not public.

# Secrets

Production templates use Key Vault references and managed identities. Gitleaks CI plus local pattern scanning protect source/evidence; live population is external.

# Dependency Security

`pnpm audit` is an executable gate. Playwright/Electron and vulnerable transitive packages were raised/overridden to leave zero Critical/High findings. Medium/Low remain tracked non-critical residuals.

# Containers

API and worker run as Node non-root; web uses unprivileged Nginx. Images use frozen lockfile, multi-stage builds, health endpoints and no embedded Production secret.

# Database Security

PostgreSQL 17, delegated private subnet, disabled public networking, TLS ≥1.2, HA for Production, 14-day PITR and separate runtime/migration identity design are encoded in Bicep.

# Audit

Database trigger rejects UPDATE/DELETE and public privileges are revoked. Redaction and atomic transaction/outbox evidence remain green.

# Retention

Engineering baseline: critical audit/raw import 7y, security/access 1y, searchable logs 90d, daily backup 35d and monthly 12m. Formal approval is DEP-007.

# QA

Unit, service, repository, PostgreSQL integration, API, workflow, frontend, analytics, E2E, security, migration, Docker, backup and performance layers are wired into proof commands and final verify.

# Performance

`proof:performance` uses real Nest HTTP and PostgreSQL fixtures, captures p50/p95/p99/throughput/errors and enforces API/search/pricing/autosave/dashboard/drilldown targets as an ENGINEERING BASELINE pending DEP-006.

# PostgreSQL

Fresh migration, existing upgrade, Prisma validate/generate/status and drift checks use migration authority—never `db push`.

# Backup

RPO ≤15m and PITR/retention settings are encoded in IaC.

# Restore

`proof:backup` performs a real custom-format dump and isolated PostgreSQL 17 restore, then verifies migrations/schema/data and drops only its exact temporary database.

# DR

See `docs/architecture/step-11-dr-design.md`; UAE Central remains DEP-003 pending scanning fallback/region decision and a live exercise.

# Azure Architecture

UAE North primary: Front Door Premium/WAF → private Container Apps origin → PostgreSQL Flexible Server/Blob/Key Vault private design → Azure Monitor/App Insights/Log Analytics.

# Container Apps

Zone redundancy, VNet integration, immutable images, minimum two Production API/worker replicas, health probes, scaling and managed identities are templated.

# PostgreSQL Flexible Server

Version 17, private networking, TLS, HA, backup and geo backup are explicit.

# Blob

Public/shared-key access disabled; TLS, versioning, soft delete, private containers and lifecycle rules are explicit. Defender parity is DEP-003.

# Key Vault

RBAC, purge protection, soft delete, public network disabled and Container Apps secret references are explicit.

# Front Door / WAF

Premium profile, HTTPS-only route, health probe, managed WAF and bot rules in Prevention mode are compiled from Bicep.

# Networking

Dedicated Container Apps, PostgreSQL delegated and private-endpoint subnets; database public access is disabled.

# Bicep

Official pinned Bicep CLI compiles the subscription template. Live deployment remains DEP-002/Step 12.

# GitHub Actions

Frozen install, verification, dependency/secret scanning, CodeQL, container build, immutable digest artifact and environment deployment gates are defined.

# OIDC

Workflow requests `id-token: write` and uses Azure login federation. Live federated credential is DEP-002.

# Build Traceability

Commit, contract/client hashes, frozen lockfile, image digest and deployment artifact are preserved. Build once/promote; do not rebuild for Production.

# Deployment

What-if precedes deployment; migrations are pre-deploy/expand-contract work; Container Apps revision health precedes traffic.

# Rollback

Previous immutable revision/digest, worker drain, backward-compatible schema and forward-fix rules are in the rollback runbook.

# Observability

Structured logs carry trace/correlation IDs and durations; API/worker expose liveness/readiness; durable work retains correlation.

# Monitoring

Log Analytics 90d and workspace-based App Insights are templated. Live telemetry is external.

# Alerts

Availability and failed-job scheduled-query rules/action group are templated; recipients are not invented.

# Electron

Thin wrapper loads only configured HTTPS origin, uses sandbox/context isolation/web security, disables Node integration and denies permissions/external navigation by default.

# MSIX

Deterministic Windows package layout/manifest evidence is generated. Actual signing remains PENDING EXTERNAL CERTIFICATE; no signed artifact is claimed.

# Production Config Safety

Startup rejects missing managed config, wildcard/localhost origins, test auth, demo seeds, external AI, weak cookie policy, localhost DB and invalid Key Vault URI.

# Release Gates

`step-11-release-readiness.json` records RG-01..RG-16 independently. RG-16 is NOT STARTED — STEP 12 ONLY.

# Dependencies

DEP-001..008 are recorded with no invented owner. All are Go-Live blocking evidence dependencies, not unresolved SSOT decisions.

# Runbooks

Cutover, rollback, incident, backup/restore and security operations runbooks are present and owner-neutral.

# Step-12 Handoff

`docs/architecture/step-12-go-live-handoff.json` is generated; it authorizes no Step-12 execution.

# Step 1–10 Regressions

All authoritative proofs and final `pnpm verify` must remain PASS.

# pnpm verify

The final captured result is recorded only after exit code 0.

# SSOT Deviations

Zero. No revisions, internal sales-order lifecycle, reservations/MES/QC, Shipment/POD, personal target, Net Commercial Sales, fake AR/revenue, or new finance logic is introduced.

# Remaining Blockers

No local Step-11 blocker is accepted. External items remain DEP-001..008, live Azure/Entra/telemetry/DR/UAT evidence, owners/signoffs, and MSIX certificate.

# Post-baseline CR-001 addendum

CR-001 was received after the verified Step 11 baseline. The evidence above remains valid only for the pre-CR-001 baseline and is preserved as history; it is not evidence for the changed scope. The formal impact reconciliation is recorded in `docs/governance/CR-001.md` and `docs/governance/cr-001-impact-reconciliation.json`.

CR-001 affects Steps 2–11 and has ten open design-decision gates. No feature, schema, OpenAPI, client, migration, or release-evidence change is authorized by the business input alone. Step 12 is now explicitly `NOT STARTED — BLOCKED BY CR-001`; after the governed delta is implemented, Step 11 must run targeted and full regression against the new baseline.
