# Production Rollback

Status: TECHNICAL PLAN READY / REHEARSAL PENDING.

Application rollback redeploys the last approved immutable container digests through the authoritative GitHub OIDC/Bicep path. Configuration rollback restores the previous Key Vault references and versioned configuration. Front Door/DNS changes use the approved IaC revision. Desktop rollback uses the last signed MSIX/update channel artifact.

Database changes follow expand/contract. Prefer forward-fix; use PITR/restore only under the incident and data-recovery decision. Never edit an applied migration or run ad-hoc production DDL.

Rollback triggers include critical security, authorization or data-integrity defects; customer-isolation failure; authentication outage; unrecoverable migration failure; severe performance regression; or reconciliation failure. Evidence must capture decision, owner role, deployment IDs, digests, restore point, start/end time, validation and incident reference. RG-15 remains blocked until a staging rehearsal and ownership evidence exist.
