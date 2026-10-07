# Client Handover Checklist

## Demo

- [x] Repository and demo tag identified.
- [x] Guarded seed, build/test, dashboard and scroll evidence recorded.
- [x] Backup/restore local drill recorded.
- [ ] Review the 18 audit documents with the technical owner.
- [ ] Choose host versus Compose demo runtime.

## Production

- [ ] Provision clean PostgreSQL with agreed major version.
- [ ] Configure real target/product/reference data; do not run demo seed.
- [ ] Configure Entra/MFA, secrets, HTTPS/reverse proxy and telemetry.
- [ ] Complete security negatives, dependency remediation, E2E, RTL/mobile and missing workflows.
- [ ] Configure encrypted off-host backups and run restore drill.
- [ ] Run production smoke test and obtain UAT/business-owner sign-off.
- [ ] Create a release candidate tag only after mandatory gates are PASS.
