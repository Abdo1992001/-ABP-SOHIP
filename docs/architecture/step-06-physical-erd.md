+# Step 6 Physical ERD

Implemented PostgreSQL 17 physical schema. Sales uses `accounts` as the canonical Customer table.

```mermaid
erDiagram
  accounts ||--o{ contacts : owns
  accounts ||--o{ projects : participates
  accounts ||--o{ opportunities : owns
  opportunities ||--o{ quotations : sources
  quotations ||--o{ quotation_lines : contains
  quotations ||--o{ quotation_approvals : records
  quotations ||--o{ official_quotation_documents : renders
  quotations ||--o{ quotation_send_events : proves
  import_batches ||--o{ import_rows : contains
  import_batches ||--o{ erp_orders : imports
  erp_orders ||--o{ erp_order_lines : contains
  capacity_rates ||--o{ capacity_estimates : calculates
  logistics_plans ||--o{ logistics_plan_versions : snapshots
  logistics_plan_versions ||--o{ logistics_placements : places
  returned_scrap_requests ||--o{ returned_scrap_items : contains
  company_targets ||--o{ target_allocations : allocates
```

All material links above are enforced by PostgreSQL foreign keys. No formal quotation-revision, internal-order, production/MES, shipment, dispatch, delivery, POD, PersonalTarget, or NetCommercialSales tables exist.
