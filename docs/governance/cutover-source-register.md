# Cutover Source Register

Status: TEMPLATE READY / SOURCE FACTS PENDING DEP-005.

No production source systems are assumed. The Data Migration Owner must complete this record for Customers, Contacts, Projects, migrated Opportunities, product/SKU references, ERP commercial facts, FX/reference data, approved Payments/Cheques, legacy Complaints, Shipment tracking sources, user/access mappings, segment definitions and geography/reference data.

For each source capture: source name, system, owner, format, cutoff, extraction method, record count, checksum, classification, import method, validation, reconciliation, rollback/recovery and status.

The enforced path is SOURCE → STAGING → VALIDATION → DQ → RECONCILIATION → COMMIT. Raw lineage and mappings are retained; ambiguous values and DATA_CONFLICT never auto-commit. No production migration may start until the register, extracts, backup, environment and owners are approved.
