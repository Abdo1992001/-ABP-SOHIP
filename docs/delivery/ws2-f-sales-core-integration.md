# WS2-F Sales Core Integration

## Implemented

- Sales overview, Sales Management, and Sales Support queue are real React
  routes using generated-client calls for completed Customer, Project,
  Opportunity, and Activity operations.
- Global Sales search uses the server-side search parameter of the implemented
  Customer, Project, and Opportunity APIs only. It has no cross-workspace
  lookup.
- Navigation and each panel remain permission-gated. Logistics, Operations,
  Finance, quotations, targets, and intelligence are not presented as
  implemented Sales Core work.
- Record totals are explicitly scoped response totals, not KPI calculations.

## Evidence

- `apps/web/src/app/SalesCorePage.test.tsx` covers generated-client-only
  overview/management rendering and verifies no Logistics call is made.
- Existing PostgreSQL integration covers Customer, Contact, Project,
  Opportunity, Activity, Country Scope, DENY, audit, and concurrency.

## Remaining acceptance evidence

An authenticated browser E2E session is still unavailable in this local
technical-preparation environment. Therefore WS2-F is implemented and tested
at API/integration/component level, but its browser E2E acceptance evidence is
not claimed as PASS.
