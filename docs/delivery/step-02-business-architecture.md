# Step 2 — Business Architecture

## Step 2 verdict

Current verdict: PASS when the Step 2 architecture guard and repository
verification pass. This step defines business ownership and boundaries; it does
not pretend that every contracted V1 endpoint is already an implemented module.

## Existing implementation reused

The following vertical slices are implemented and retained: Customer (the API
term `Account` maps to the single Customer aggregate), Contact, Project,
Opportunity, Activity, Country reference data, Product Catalog, authorization,
audit, outbox and durable jobs. The React route registry is Sales-first and the
database already contains Pricing Rule, Quotation, Quotation Line, Adjustment,
group-membership, and opportunity-WON snapshot foundations.

Pricing, Quotation, ERP/DQ, Capacity, Logistics, Finance, Returns, Documents,
Notifications, Analytics and AI have typed V1 contracts and/or persistence
foundations where shown in the domain map. Their incomplete runtime operations
are intentionally classified as `PARTIALLY_IMPLEMENTED` or `CONTRACTED`; they
are not exposed as fake implementations.

## Sales-first business architecture

Sales is the primary commercial workspace. Its canonical context is:

```text
Customer → Contact → Project → Opportunity → Activities / Follow-ups → Quotation
```

Opportunity can also reference Customer and Project directly. Activities can
reference the valid commercial context that they record. The model deliberately
does not force an artificial one-to-one chain.

## Workspace model

| Area             | Role in the architecture                                                                |
| ---------------- | --------------------------------------------------------------------------------------- |
| Sales            | Core commercial truth, Customer 360, opportunities, follow-up and quotation context.    |
| Sales Management | A permissioned Sales projection at `/sales/management`, never a top-level workspace.    |
| Sales Support    | A permissioned Sales projection at `/sales/support`, never a top-level workspace.       |
| Logistics        | Isolated planning/optimizer workspace; reads only authorized demand/source projections. |
| Operations       | Isolated capacity/readiness intelligence workspace; no CRM ownership.                   |
| Finance          | Isolated FX-first financial workspace; no broad Customer CRM ownership.                 |

## Domain map

The maintained, machine-readable inventory is
[business-domain-map.json](../architecture/business-domain-map.json). It
classifies Customer, Contact, Project, Opportunity, Activity and Product
Catalog as implemented; Pricing and Quotation as partially implemented; typed
V1 supporting domains as contracted; and Analytics runtime implementation as
outside this Step 2 boundary.

## Domain ownership

- Customer is the Sales-owned client aggregate. `Account` is API terminology,
  not a second aggregate and never an application user.
- Contact belongs to Customer and has no independent access universe.
- Project is Sales-owned commercial context. Its `countryCode` is actual
  project geography and is distinct from Customer HQ country.
- Opportunity owns pipeline stage. Project stage and Quotation status are
  independent state machines. Company target achievement consumes Opportunity
  WON only.
- Product Catalog owns canonical SKU/product reference. Pricing owns
  effective-dated min/reference/max rules. Quotation Line stores the selected
  price-rule reference and immutable price snapshot.
- Quotation owns headers, lines, adjustments, approval/document/send context.
  DRAFT is mutable; SENT is immutable; a material post-SENT change starts a
  new quotation linked by `supersedes_quotation_id`. There is no revision or
  family aggregate.

## Canonical business flow

Commercial writing happens in application services: `CustomerService`,
`ContactService`, `ProjectService`, `OpportunityService`, `ActivityService`,
`ProductService`, and, as their runtime slices are completed, their dedicated
Pricing/Quotation/Import/Capacity/Logistics/Finance counterparts. Controllers
are transport adapters and do not own commercial state transitions.

## Cross-domain relationships

```text
Sales Core (Customer, Contact, Project, Opportunity, Activity)
  └─> Product Catalog ─> Pricing ─> Quotation
Sales context ─> imported ERP facts ─> Capacity estimate ─> Logistics plan
Finance (FX; permitted Payments/Cheques; Returned Scrap) references authorized
commercial history only.
Reference, Documents, Notifications, Audit and Jobs are shared capabilities.
Analytics and AI consume authorized governed projections later; neither owns
transactional truth.
```

## Cross-workspace boundaries

The shared database does not grant shared unrestricted reads. Sales supplies
minimal, authorized demand/source projections to Logistics and Operations.
Finance receives only the commercial references required by its typed workflow.
Logistics has no broad Sales CRM visibility, and Finance does not become a
Customer CRM owner. Cross-domain work uses typed services/projections and
policy checks, not direct repository shortcuts.

## Dependency graph

The dependency direction is Sales → governed downstream projection. Product
Catalog → Pricing → Quotation is separate from ERP imported facts. ERP →
Capacity → Logistics is read/intelligence direction only. Finance, Analytics
and AI are consumers of authorized commercial references/projections. No
module is allowed to create a circular ownership claim.

## Database ownership map

| Entity                | Domain owner    | Canonical writer           | Read consumers                  | Import/manual rule                    |
| --------------------- | --------------- | -------------------------- | ------------------------------- | ------------------------------------- |
| `accounts` / Customer | Sales           | Customer service           | Sales; authorized projections   | Customer writer only.                 |
| `contacts`            | Sales           | Contact service            | Sales                           | Must belong to Customer.              |
| `projects`            | Sales           | Project service            | Sales; authorized ops context   | Project geography is its own country. |
| `opportunities`       | Sales           | Opportunity service        | Sales; Target projection        | WON is target source.                 |
| `products`            | Product Catalog | Product service/import     | Pricing, Quotation, Logistics   | Master is not pricing.                |
| `pricing_rules`       | Pricing         | Pricing service            | Quotation                       | Effective-dated min/reference/max.    |
| `quotations` / lines  | Quotation       | Quotation service          | Sales, Documents                | No formal revision writer.            |
| ERP order facts       | ERP Import/DQ   | Idempotent import pipeline | Sales, Capacity, Analytics      | Manual lifecycle edit forbidden.      |
| Capacity estimates    | Capacity        | Calculation service        | Operations; Sales projection    | 900/700/600, 24h, estimate only.      |
| Logistics plans       | Logistics       | Planning service           | Logistics; limited Sales status | Flat-on-Face; no shipment/POD.        |
| FX / finance facts    | Finance         | Authorized finance service | Finance; limited references     | No fabricated AR/balances.            |

## Application-service ownership

Only the owning service writes its aggregate. ERP facts are import-pipeline
only, Capacity is calculation-only, Logistics is planning-only, and AI has no
business-state writer. Returned Scrap derives 25% from eligible quantity and
original purchase unit price, requires original quote/item and manager approval,
allows Credit or Replacement only, and has no V1 Net Sales impact.

## Imported vs transactional data

ERP Sales Orders are canonical imported, raw-lineage, DQ/reconciliation facts:
no internal create, confirm, amend, handover or close workflow exists. Capacity
is 900 Standard / 700 Ordinary / 600 Curved boards per 24 hours as an estimate,
with no reservation, MES, routing, QC or production scheduling. Logistics is
Flat-on-Face planning with 0/90 rotation, never shipment, dispatch, delivery or
POD execution.

## Demo/Staging isolation

Fixtures are `DEMO/STAGING ONLY`. They are not SSOT facts, production seeds,
release authority, customer truth, ERP truth or Finance truth.

## Anti-regression rules

`pnpm architecture:step2` enforces the following from source, contract and
machine-readable map: Sales Management/Support stay under Sales; Customer HQ
and Project country stay distinct; stages/statuses remain separate;
Product/Pricing/Quotation boundaries stay separate; no quotation revision
aggregate exists; ERP lifecycle, Capacity reservation/MES/QC, Shipment/POD and
edge loading routes stay forbidden; Capacity stays 900/700/600 estimate-only;
Logistics stays Flat-on-Face 0/90 planning; and every documented domain declares
forbidden dependencies.

## Architecture tests

The guard is [check-step2-business-architecture.mjs](../../scripts/architecture/check-step2-business-architecture.mjs)
and is part of the authoritative `pnpm verify` command. It validates the route
registry, Prisma schema, V1 out-of-scope contract, capacity/logistics contracts
and maintained domain map.

## Remaining Step-2 blockers

None. Runtime implementation of contracted later domains is deliberately
sequenced into their implementation steps and remains visible as contracted,
not falsely claimed here.

## SSOT deviations

0.
