# Step 3 Verdict

PASS — local PostgreSQL evidence completed on 2026-08-21. Production Entra provisioning is deliberately deferred; it is not substituted with test identities.

# Existing AuthZ Reused

Persistent `AppUser`, `Role`, `Permission`, `RolePermission`, `UserRole`, `UserCountryAccess`, `UserPermissionOverride`, Customer sharing, transfer, merge, audit, ETag, and query-scoped Sales Core services were retained.

# Identity Model

`AppUser` is the authenticated employee/system identity. `Contact` remains a commercial Customer contact and has no identity relationship. `AppSession` is persisted and a revoked session is rejected server-side on the next request. The test-only header issuer is enabled only by `ABP_TEST_AUTH_ENABLED`.

# Workspace Model

SALES owns Sales User, Sales Management, and Sales Support. LOGISTICS, OPERATIONS, and FINANCE remain isolated workspaces. The navigation keeps Management and Support under `/sales/*`.

# Role Model

Stable baseline roles are SALES_USER, SALES_MANAGER, SALES_SUPPORT, LOGISTICS_PLANNER, OPERATIONS, and FINANCE. Roles provide baseline grants; Country Scope, DENY, and resource context remain separate dimensions.

# Permission Inventory

The stable contract inventory separates view/create/edit/archive/share/transfer/merge, Sales workspace/management/support, catalog, logistics planning, operations, finance FX, quotation/pricing approvals, and export. Server-side persistent role grants and time-effective overrides are authoritative.

# Country Scope

Country access is persisted in `user_country_access` and is applied inside repository query conditions. Ownership, manager relationships, shares, and group membership never widen scope. Customer HQ and Project country remain distinct; Project uses its own country predicate.

# DENY Model

`UserPermissionOverride` with `DENY` is evaluated after role/allow grants and denies the action. The policy unit suite and PostgreSQL API integration cover allow-plus-deny.

# Ownership

Ownership is a resource context only after session, Country Scope, workspace, permission, and DENY checks.

# Manager / Team Context

Manager context requires SALES workspace, `SALES_MANAGER`, and `sales.management.view`; a reporting-line row alone does not grant CRM access. Query predicates retain Country Scope before the manager context.

# Sharing

Customer and Contact sharing are persistent, auditable, revocable, effective-dated contexts. Recipient Country Scope is required when a Customer share is issued and still applies during retrieval.

# Transfer

Customer transfer validates target eligibility and Country Scope, is transactional, ETag-protected, audited, and emits a notification-only outbox event.

# Merge Authorization

Customer merge requires the manager role plus separate merge and merge-approve permissions. Both resources are accessed through scoped predicates and merge history/audit remains persisted.

# Field Projection

Customer list/detail DTOs deliberately omit source lineage and restricted metadata. The backend sends the projection; React does not decide sensitive-field access.

# Cross-Workspace Matrix

Logistics, Operations, and Finance direct Sales CRM API access is denied. Sales may receive only `logistics.plan` when explicitly granted; it receives no Logistics administration permission.

# Sales → Logistics Rule

`logistics.plan` is a distinct permission; it is not implied by Sales or Sales Management.

# Session / Revocation

Session status, expiry, user binding, and revocation are PostgreSQL-backed. No Redis or permission cache is authoritative.

# Audit

Share, revoke, transfer, merge, and business security mutations use structured audit records with actor/session, resource, before/after, trace, and correlation identifiers. Test credentials, tokens, and secrets are not audited.

# Frontend Authorization

Routes carry permission metadata and test Sales-first nesting/isolation. Frontend visibility is UX only; all implemented API controllers use the server identity guard and service policy checks.

# IDOR / Path Tampering

List, detail, child, and mutation predicates use the same scoped Country/context rules. Existing PostgreSQL tests cover inaccessible IDs, Customer/Contact context, Project geography, Opportunity and Activity contexts.

# Search Security

Customer and Sales-Core query filters apply Country Scope and context in Prisma before results return; no client-side unauthorized-row filtering is used.

# Golden Personas

`docs/security/authorization-matrix.json` lists synthetic TEST/DEMO/STAGING-only personas. It contains no real employee identity or production credential.

# PostgreSQL Evidence

`corepack pnpm proof:authorization` runs the real `customer.integration.test.ts` PostgreSQL suite. It covered 9 integration tests in the final run, including a revoked persisted session.

# Authorization Test Matrix

Country scope, explicit DENY, owner/share non-widening, manager scope, cross-workspace denial, field omission, ETag, transfer, merge, audit, idempotency, and direct API protection are covered by the policy and integration suites.

# proof:authorization

`pnpm proof:authorization` = PASS.

# Step 1 Regression

Required in the final `pnpm verify` run.

# Step 2 Regression

Required in the final `pnpm verify` run.

# Deferred Production Identity Evidence

Production Entra provisioning: DEFERRED TO STEP 11/12. Production MFA evidence: DEFERRED TO STEP 11. Production access certification: DEFERRED TO STEP 12 / RG-12.

# SSOT Deviations

0

# Remaining Step-3 Blockers

NONE
