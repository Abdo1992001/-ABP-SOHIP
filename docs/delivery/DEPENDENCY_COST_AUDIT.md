# Dependency Cost Audit

Repository search found Azure/Entra/Key Vault/Application Insights references in legacy cloud governance and staging documentation and in the previous production-config branch. Those references are classified **LEGACY/OPTIONAL** for the self-hosted profile; the new `ABP_DEPLOYMENT_MODE=self-hosted` branch does not require them. They must not be copied into a self-hosted production env file.

| Search family                                                             | Classification                                              | Action                                                               |
| ------------------------------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------- |
| Azure / Entra / Key Vault / App Insights                                  | legacy cloud deployment docs and old config branch          | keep as historical alternative; self-hosted profile bypasses them    |
| AWS / S3 / Firebase / Supabase / Auth0 / Clerk / Okta                     | no mandatory core runtime dependency found                  | no action                                                            |
| Twilio / SendGrid / Mailgun / Sentry / Datadog / New Relic                | no mandatory core runtime dependency found                  | no action                                                            |
| Power BI / Tableau / Cloudinary / Algolia / Stripe / Google Maps / Mapbox | no mandatory core runtime dependency found                  | no action                                                            |
| `aws-ssl-profiles` in SBOM                                                | transitive package metadata, not an ABP service integration | retain only if package graph requires it; review on lockfile changes |
| `localhost` / test auth                                                   | development/test configuration only                         | production self-hosted config rejects test auth and insecure origins |

No paid SaaS, cloud account, API quota or recurring service is required by the self-hosted production compose profile. The package lock and generated SBOM should be re-audited whenever dependencies change.
