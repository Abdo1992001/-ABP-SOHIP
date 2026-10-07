# ABP Role Route Matrix

Status date: 2026-09-08. This matrix records the intended effective UAT access from the permission registry, workspace gate, customer country scope, ownership and explicit shares. `CONTEXT ONLY` means the route is available but every returned record remains subject to row-level customer/country/binding rules. The matrix must be runtime-verified before release.

**Role names against seeded role codes.** The columns below use the names this design was written with; the database seeds different codes for four of them. Nothing reconciled the two until `ROLE_CODE_ALIASES` in `apps/web/src/app/role-route-matrix.ts`, so every lookup for a real non-manager role missed the matrix and silently defaulted to visible:

| This document | Seeded role code        |
| ------------- | ----------------------- |
| Sales User    | `SALES_REP`             |
| Logistics     | `LOGISTICS_COORDINATOR` |
| Operations    | `OPERATIONS_ANALYST`    |
| Finance       | `FINANCE_ANALYST`       |
| Sales Manager | `SALES_MANAGER`         |
| System Admin  | `SYSTEM_ADMIN`          |

`R_AND_D` is seeded and has no column here; it holds `research.view` alone and reaches `/research`. `Sales User B` and `Sales Support` are design columns with no seeded role behind them.

| Route                             | System Admin | Sales Manager | Sales User   | Sales User B | Sales Support | Logistics    | Operations   | Finance      | Customer Portal |
| --------------------------------- | ------------ | ------------- | ------------ | ------------ | ------------- | ------------ | ------------ | ------------ | --------------- |
| `/` Sales Overview                | ALLOW        | ALLOW         | ALLOW        | ALLOW        | ALLOW         | DENY         | DENY         | DENY         | DENY            |
| `/search`                         | ALLOW        | ALLOW         | CONTEXT ONLY | CONTEXT ONLY | CONTEXT ONLY  | CONTEXT ONLY | CONTEXT ONLY | CONTEXT ONLY | DENY            |
| `/customers`                      | ALLOW        | CONTEXT ONLY  | CONTEXT ONLY | CONTEXT ONLY | CONTEXT ONLY  | DENY         | DENY         | DENY         | DENY            |
| `/customers/:accountId`           | ALLOW        | CONTEXT ONLY  | CONTEXT ONLY | CONTEXT ONLY | CONTEXT ONLY  | DENY         | DENY         | DENY         | DENY            |
| `/contacts`                       | ALLOW        | CONTEXT ONLY  | CONTEXT ONLY | CONTEXT ONLY | CONTEXT ONLY  | DENY         | DENY         | DENY         | DENY            |
| `/contacts/:contactId`            | ALLOW        | CONTEXT ONLY  | CONTEXT ONLY | CONTEXT ONLY | CONTEXT ONLY  | DENY         | DENY         | DENY         | DENY            |
| `/projects`                       | ALLOW        | CONTEXT ONLY  | CONTEXT ONLY | CONTEXT ONLY | CONTEXT ONLY  | DENY         | DENY         | DENY         | DENY            |
| `/projects/:projectId`            | ALLOW        | CONTEXT ONLY  | CONTEXT ONLY | CONTEXT ONLY | CONTEXT ONLY  | DENY         | DENY         | DENY         | DENY            |
| `/opportunities`                  | ALLOW        | CONTEXT ONLY  | CONTEXT ONLY | CONTEXT ONLY | DENY          | DENY         | DENY         | DENY         | DENY            |
| `/opportunities/:opportunityId`   | ALLOW        | CONTEXT ONLY  | CONTEXT ONLY | CONTEXT ONLY | DENY          | DENY         | DENY         | DENY         | DENY            |
| `/activities`                     | ALLOW        | CONTEXT ONLY  | CONTEXT ONLY | CONTEXT ONLY | DENY          | DENY         | DENY         | DENY         | DENY            |
| `/activities/calendar`            | ALLOW        | CONTEXT ONLY  | CONTEXT ONLY | CONTEXT ONLY | DENY          | DENY         | DENY         | DENY         | DENY            |
| `/products`                       | ALLOW        | ALLOW         | ALLOW        | ALLOW        | DENY          | DENY         | ALLOW        | DENY         | DENY            |
| `/quotations`                     | ALLOW        | CONTEXT ONLY  | CONTEXT ONLY | CONTEXT ONLY | DENY          | DENY         | DENY         | DENY         | DENY            |
| `/quotations/:quotationId`        | ALLOW        | CONTEXT ONLY  | CONTEXT ONLY | CONTEXT ONLY | DENY          | DENY         | DENY         | DENY         | DENY            |
| `/orders`                         | ALLOW        | CONTEXT ONLY  | DENY         | DENY         | DENY          | CONTEXT ONLY | DENY         | DENY         | DENY            |
| `/orders/:salesOrderId`           | ALLOW        | CONTEXT ONLY  | DENY         | DENY         | DENY          | CONTEXT ONLY | DENY         | DENY         | DENY            |
| `/capacity`                       | ALLOW        | DENY          | DENY         | DENY         | DENY          | DENY         | ALLOW        | DENY         | DENY            |
| `/capacity/estimates/:estimateId` | ALLOW        | DENY          | DENY         | DENY         | DENY          | DENY         | ALLOW        | DENY         | DENY            |
| `/logistics/plans`                | ALLOW        | CONTEXT ONLY  | CONTEXT ONLY | CONTEXT ONLY | DENY          | CONTEXT ONLY | DENY         | DENY         | DENY            |
| `/logistics/plans/:planId`        | ALLOW        | CONTEXT ONLY  | CONTEXT ONLY | CONTEXT ONLY | DENY          | CONTEXT ONLY | DENY         | DENY         | DENY            |
| `/shipments`                      | ALLOW        | DENY          | DENY         | DENY         | DENY          | CONTEXT ONLY | DENY         | DENY         | DENY            |
| `/shipments/:shipmentId`          | ALLOW        | DENY          | DENY         | DENY         | DENY          | CONTEXT ONLY | DENY         | DENY         | DENY            |
| `/finance/fx`                     | ALLOW        | DENY          | DENY         | DENY         | DENY          | DENY         | DENY         | ALLOW        | DENY            |
| `/finance/payments`               | ALLOW        | DENY          | DENY         | DENY         | DENY          | DENY         | DENY         | CONTEXT ONLY | DENY            |
| `/finance/payments/:paymentId`    | ALLOW        | DENY          | DENY         | DENY         | DENY          | DENY         | DENY         | CONTEXT ONLY | DENY            |
| `/finance/cheques`                | ALLOW        | DENY          | DENY         | DENY         | DENY          | DENY         | DENY         | CONTEXT ONLY | DENY            |
| `/returns`                        | ALLOW        | DENY          | DENY         | DENY         | DENY          | DENY         | DENY         | CONTEXT ONLY | DENY            |
| `/returns/:caseId`                | ALLOW        | DENY          | DENY         | DENY         | DENY          | DENY         | DENY         | CONTEXT ONLY | DENY            |
| `/data/imports`                   | ALLOW        | DENY          | DENY         | DENY         | ALLOW         | DENY         | DENY         | DENY         | DENY            |
| `/data/imports/:jobId`            | ALLOW        | DENY          | DENY         | DENY         | ALLOW         | DENY         | DENY         | DENY         | DENY            |
| `/data/quality`                   | ALLOW        | DENY          | DENY         | DENY         | ALLOW         | DENY         | DENY         | DENY         | DENY            |
| `/data/reconciliation`            | ALLOW        | DENY          | DENY         | DENY         | ALLOW         | DENY         | DENY         | DENY         | DENY            |
| `/documents`                      | ALLOW        | ALLOW         | CONTEXT ONLY | CONTEXT ONLY | ALLOW         | CONTEXT ONLY | DENY         | CONTEXT ONLY | DENY            |
| `/reports`                        | ALLOW        | ALLOW         | CONTEXT ONLY | CONTEXT ONLY | DENY          | DENY         | ALLOW        | CONTEXT ONLY | DENY            |
| `/targets`                        | ALLOW        | ALLOW         | DENY         | DENY         | DENY          | DENY         | DENY         | DENY         | DENY            |
| `/ai/brief`                       | ALLOW        | ALLOW         | DENY         | DENY         | DENY          | DENY         | DENY         | DENY         | DENY            |
| `/complaints`                     | ALLOW        | CONTEXT ONLY  | DENY         | DENY         | DENY          | DENY         | DENY         | DENY         | DENY            |
| `/complaints/:complaintId`        | ALLOW        | CONTEXT ONLY  | DENY         | DENY         | DENY          | DENY         | DENY         | DENY         | DENY            |
| `/research`                       | ALLOW        | ALLOW         | DENY         | DENY         | DENY          | DENY         | DENY         | DENY         | DENY            |
| `/notifications`                  | ALLOW        | ALLOW         | ALLOW        | ALLOW        | ALLOW         | ALLOW        | ALLOW        | ALLOW        | DENY            |
| `/actions`                        | ALLOW        | ALLOW         | ALLOW        | ALLOW        | ALLOW         | ALLOW        | ALLOW        | ALLOW        | DENY            |
| `/messages`                       | ALLOW        | ALLOW         | ALLOW        | ALLOW        | ALLOW         | ALLOW        | ALLOW        | ALLOW        | DENY            |
| `/settings`                       | ALLOW        | ALLOW         | ALLOW        | ALLOW        | ALLOW         | ALLOW        | ALLOW        | ALLOW        | DENY            |
| `/sales/management`               | ALLOW        | ALLOW         | DENY         | DENY         | DENY          | DENY         | DENY         | DENY         | DENY            |
| `/sales/support`                  | ALLOW        | DENY          | DENY         | DENY         | ALLOW         | DENY         | DENY         | DENY         | DENY            |
| `/admin/users`                    | ALLOW        | DENY          | DENY         | DENY         | DENY          | DENY         | DENY         | DENY         | DENY            |
| `/admin/roles`                    | ALLOW        | DENY          | DENY         | DENY         | DENY          | DENY         | DENY         | DENY         | DENY            |
| `/admin/countries`                | ALLOW        | DENY          | DENY         | DENY         | DENY          | DENY         | DENY         | DENY         | DENY            |
| `/admin/policies`                 | ALLOW        | DENY          | DENY         | DENY         | DENY          | DENY         | DENY         | DENY         | DENY            |
| `/admin/pricing`                  | ALLOW        | DENY          | DENY         | DENY         | DENY          | DENY         | DENY         | DENY         | DENY            |
| `/admin/capacity`                 | ALLOW        | DENY          | DENY         | DENY         | DENY          | DENY         | DENY         | DENY         | DENY            |
| `/admin/import-sources`           | ALLOW        | DENY          | DENY         | DENY         | DENY          | DENY         | DENY         | DENY         | DENY            |
| `/admin/data-quality`             | ALLOW        | DENY          | DENY         | DENY         | DENY          | DENY         | DENY         | DENY         | DENY            |
| `/admin/templates`                | ALLOW        | DENY          | DENY         | DENY         | DENY          | DENY         | DENY         | DENY         | DENY            |
| `/admin/audit`                    | ALLOW        | DENY          | DENY         | DENY         | DENY          | DENY         | DENY         | DENY         | DENY            |
| `/admin/customer-segments`        | ALLOW        | DENY          | DENY         | DENY         | DENY          | DENY         | DENY         | DENY         | DENY            |
| `/admin/client-identities`        | ALLOW        | DENY          | DENY         | DENY         | DENY          | DENY         | DENY         | DENY         | DENY            |
| `/portal`                         | DENY         | DENY          | DENY         | DENY         | DENY          | DENY         | DENY         | DENY         | CONTEXT ONLY    |

## Required row-level proofs

| Fixture                                         | Expected result for `uat.sales.user` |
| ----------------------------------------------- | ------------------------------------ |
| UAT-ACC-A — Egypt, owned by Sales User          | ALLOW                                |
| UAT-ACC-B — Egypt, private manager-owned        | DENY                                 |
| UAT-ACC-C — Saudi Arabia, owned by Sales User B | DENY                                 |
| UAT-ACC-D — Egypt, explicitly shared            | ALLOW                                |
| UAT-ACC-E — Saudi Arabia, explicitly shared     | DENY — country scope wins            |

The Customer Portal row is bound to UAT-ACC-A through `ExternalClientIdentity` and `ClientCustomerBinding`. Internal CRM routes remain denied even though the portal APIs resolve account, order, shipment, document and complaint context.
