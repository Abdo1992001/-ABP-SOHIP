# ABP Final UI SSOT Contract

Status: implementation authority for the application shell and visual/interaction architecture.

Sources, in precedence order:

1. Final SSOT Reconciliation Baseline R1 and Organization/Workspace Addendum R1.
2. Step 10 final dashboard, workspace-access, metric and reporting contracts.
3. Step 9 final route/screen, interaction, responsive, security UX, design, accessibility and i18n contracts.
4. Step 4 final shell, screen inventory and functional requirements where they do not conflict with later SSOT.
5. Step 3 locked authorization, ownership and sharing policies.

## Product shape

- Sales is the core application workspace.
- Sales Management is a permissioned management view over authorized Sales scope.
- Sales Support is a constrained support interface inside the Sales organization.
- Logistics, Operations and Financial are isolated workspaces over permissioned projections of shared backend truth.
- Cross-workspace status/intelligence returns through controlled handoffs; workspace access is never widened implicitly.
- Country Scope is enforced by the server before ownership, manager context or sharing.
- UI visibility is a convenience only; every route, action and field projection is server-authorized.

## Global shell

- Desktop uses a grouped, permission-aware, collapsible sidebar. The collapsed state is icon-only with tooltips and a saved user preference.
- Mobile uses an accessible navigation drawer.
- Topbar contains global search / command palette, Quick Create, notifications, current context when relevant and the user menu.
- Page-specific actions belong in the page/resource header, not the global topbar.
- Nested business routes use clickable breadcrumbs; top-level grids do not.
- Resource pages use a reusable header with reference, name, status, context and authorized actions. Long pages use a compact sticky form.

## Visual system

- Primary brand tokens are ABP Navy `#0E0B53` and ABP Crimson `#C81D25`.
- Semantic colors are separate from brand colors and always include text/icon meaning.
- Light and dark themes are supported from semantic tokens; no one-off per-page palette.
- Compact and comfortable enterprise density are supported.
- Typography supports Arabic and Latin. Codes, SKUs, dimensions and money use Latin digits.
- Layout uses logical CSS properties and real RTL mirroring, not text alignment alone.
- Visible focus, WCAG AA contrast, 200% zoom, reduced motion and keyboard operation are baseline requirements.

## Dashboard

One permission-aware layout framework is used; widgets vary by role and authorized scope.

Sales / Sales Management dashboard order:

1. Page header with context, period and primary authorized action.
2. Top KPI strip from server-owned semantic metrics: Company Target, WON Achieved, Remaining, Achievement %, and My/Team WON Contribution as permitted.
3. Action Queue for due follow-ups, approvals, quotation attention/expiry, DQ blockers and permitted handoff alerts.
4. Pipeline and quotation panels.
5. Customer geography and customer health/dormancy panels.
6. ERP history and Logistics/Operations status projections.
7. AI advisory/next-actions panel with evidence and advisory-only labeling.
8. Recent Work (5–8 items) and controlled drill-down links.

Dashboard anti-rules:

- Record totals must not be presented as governed KPIs.
- React must not calculate authoritative target, pipeline, pricing, ERP, capacity or logistics truth.
- Unavailable semantic data is shown as unavailable with basis/freshness—not replaced by demo numbers.
- No personal target entity, peer leaderboard, fake Net Commercial Sales, Shipment/POD or production/MES widgets.

## Enterprise data screens

- Customer, Contact, Project, Opportunity, Quotation, ERP, Finance, DQ and administration lists use server-filtered/sorted/paginated enterprise grids.
- Grids provide column priority, sticky headers, keyboard access, explicit loading/empty/error/denied states and responsive card/list transformations where contracted.
- List routes preserve filters and scroll position in the URL/navigation lifecycle.
- Customer List has governed views for My, Shared, Dormant and follow-up context as available, plus Country, category and archive filters.
- Customer 360 is a dedicated page with Overview, Contacts, Projects, Opportunities, Quotations, ERP History, Activities, Documents, Complaints and Returns only when authorized.
- Restricted/source fields are omitted from projections, not merely hidden with CSS.

## Interaction boundaries

- Dedicated pages: 360 views, Quotation Studio, Import flow, Logistics Planner and other complex workflows.
- Drawers: compact inspection and scoped actions such as Customer quick view and Share manager.
- Modals/wizards: small critical forms, transfer, merge and confirmed high-impact actions.
- No browser-like internal tabs.
- Draft autosave uses 500–1200 ms debounce with Saving, Saved, Offline and Conflict states.
- High-impact commands are pessimistic and use typed 409/412/422/503 handling.
- Durable work uses a real job card with queued/running/completed/failed states; never an indefinite spinner or fake success.

## Locked business truth visible in UX

- Quotations have no formal revisions. Draft edits in place; changes after SENT create a new quotation linked by `supersedes_quotation_id`.
- ERP Sales Orders are imported read-only facts; no internal Create/Confirm/Amend/Handover lifecycle.
- Capacity is estimate-only: Standard 900/day, Ordinary 700/day, Curved 600/day, 24 hours/day; no reservations/MES/QC/routing.
- Logistics is planning/optimizer only, Flat-on-Face, 0/90 face rotation; no Shipment/Dispatch/Delivery/POD.
- Targets are ACROW Company Target; achievement is Opportunity WON only.
- Finance is isolated; FX is the default, Payments/Cheques require explicit permissions and trusted facts.

## Acceptance boundary

A screen is not accepted because it renders. It must use the generated typed client, real server data, real authorization and field projection, typed errors, responsive RTL/LTR behavior, accessible interaction and zero dead/fake actions.
