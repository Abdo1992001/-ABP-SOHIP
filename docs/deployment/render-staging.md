# Render staging deployment

## Boundary

ENVIRONMENT = STAGING. Render is only an integration, demonstration and
runtime-evidence environment for ABP. It is not production authority. The locked
production target remains Azure Container Apps, Azure Database for PostgreSQL
Flexible Server, Blob Storage, Key Vault, Entra ID, Azure Monitor/Application
Insights and Bicep.

Do not load production customers, ERP files, finance data, access rosters or
secrets. Any fixture is explicitly DEMO/STAGING ONLY; it is not a production
seed, SSOT fact or release evidence.

## Blueprint topology

render.yaml defines four same-region Frankfurt staging resources:

- abp-postgres-staging: PostgreSQL 17, abp_commercial_staging, with an empty
  ipAllowList so public database access is blocked.
- abp-api-staging: Docker web service. It is the sole migration owner and runs
  corepack pnpm db:migrate:deploy as its pre-deploy command.
- abp-worker-staging: Docker background worker. It never migrates the schema;
  its logs and durable-job outcome are its runtime evidence.
- abp-web-staging: Docker web service serving the compiled React shell.

The API and worker receive DATABASE_URL from the database private
connectionString; do not substitute the public database URL.

## First synchronization

1. Push this repository and render.yaml to the intended GitHub branch.
2. In Render, create a Blueprint from the repository root and confirm the four
   names above and region frankfurt.
3. At the first Blueprint prompt provide these two staging-only values:
   - ABP_ALLOWED_ORIGINS on abp-api-staging: the final HTTPS URL of
     abp-web-staging.
   - ABP_API_BASE_URL on abp-web-staging: the final HTTPS origin of
     abp-api-staging followed by /api/v1.
4. Synchronize the Blueprint. If Render assigns the service URLs after the first
   creation, set the two values in the service dashboards and redeploy API and
   Web. Do not use a wildcard for allowed origins.
5. Confirm the Postgres service reports major version 17 and has no external IP
   allow-list entries. Do not reveal or copy its credentials into source.

No Entra tenant, client secret, production user or MFA record is created by this
guide. Existing staging/test auth can only be used if it is legitimately
configured and labelled STAGING AUTH ONLY.

## Evidence sequence

1. Let GitHub Actions verify complete from a clean checkout. It runs
   corepack pnpm verify with PostgreSQL 17 and uploads verify-log.
2. Confirm the API pre-deploy migration succeeds before API startup.
3. Confirm the API readiness endpoint returns HTTP 200 with ready true.
4. Confirm the worker deploy stays running, logs a successful database poll and
   completes one controlled staging durable job. Do not create a public proof
   endpoint.
5. Confirm the Web root serves the application shell and SPA fallback.
6. Run scripts/staging/render-smoke.mjs with --web and --api staging origins.
7. Capture commit SHA, GitHub run URL, Render deploy IDs, API health response,
   worker job evidence, Web smoke output and migration output in the Step 1
   delivery record.

## Redeploy and rollback

Render auto-deploy is set to checksPass; do not manually bypass a failed GitHub
verification. For an application rollback, redeploy the preceding known good
commit through Render. Migrations are forward-only: investigate a failed
migration and apply a compatible forward fix rather than resetting the staging
database or running prisma migrate dev.

render.yaml is staging evidence configuration. It never replaces Bicep or
changes the Azure production authority.
