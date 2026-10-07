# ABP Commercial System — Production Handoff

## Release

- Product: ABP Commercial System
- RC: `v1.0.0-rc.1`
- Frozen RC commit: `1c94fc9`
- Technical RC: **FROZEN**
- Exact-tag production smoke: **PASS**
- Visual / interaction acceptance: **PASS**
- Role UAT: **PASS** (9/9)

## Acceptance evidence

- PostgreSQL: 17.11
- Applied migrations: 41
- OpenAPI: 255/255
- Generated drift: 0
- Database tests: 13/13
- API tests: 47/47
- Web tests: 22/22
- Worker tests: 1/1
- Authorization: 4/4
- Role lifecycle: 9/9
- Visual UAT: 156/156
- Long forms: 14/14
- Visible control audit: 1,118 inspected; 1,073 observable PASS; 45 intentional skip; 0 failure
- Production smoke: PASS
- Backup/restore: PASS

## Production administrator

- Display name: Eng. Abdelrahman Adel
- Username: `abdelrahman`
- Email: `abdelrahman@abp.local`
- Role: SYSTEM_ADMIN
- Status: ACTIVE
- Country scope: ALL COUNTRIES (all active production country codes)
- Language: English
- Timezone: Africa/Cairo
- Must change password: YES
- MFA: REQUIRED; enrollment pending first handoff login
- Sessions: previous sessions revoked before handoff

The temporary password was generated with the production Argon2id workflow and displayed once in the protected terminal handoff. It is intentionally absent from this document, source control, environment files, screenshots, logs and database plaintext.

The production login, forced password change, MFA enrollment, dashboard, System Admin navigation, audit/health navigation and logout flow were validated against the production HTTPS endpoint before the account was re-armed with a fresh temporary handoff credential.

## Production cleanliness

Accounts: 0 business records; opportunities: 0; quotations: 0; payments: 0; cheques: 0; activities: 0; company targets: 0. The administrator account is the only intentional production identity.

## Runtime image digests

- API: `sha256:a059259789e2d716c4f9462fc4f82c19b0aef5ee4333f84faa277de0bbb57e30`
- Web: `sha256:aa5c293ca1fab87f47d76bf2567c36e5591a8d2e6d826b63bc11e10349491444`
- Worker: `sha256:9d9b0527b7075fdefa3b99b1a9e3bcc15dd806e8d8d3ea4e7151fc9b9e593958`
- Reverse proxy (`caddy:2.10-alpine`): `sha256:4c6e91c6ed0e2fa03efd5b44747b625fec79bc9cd06ac5235a779726618e530d`
- PostgreSQL (`postgres:17-alpine`): `sha256:18cfe3ef5e6815560c98237d6216d1e5119702fb0f3894c8785dd58b8bbe5d73`

## Endpoints and handoff status

- Production URL: <https://abp-commercial.local>
- Final v1.0.0 promotion: **NO** — promotion remains explicitly deferred until the customer confirms the administrator handoff.
- Remaining technical blockers: **NONE**
- Remaining operational item: customer receives the one-time temporary password from the protected terminal handoff, completes the required password change and MFA enrollment, then confirms access.

No credentials or secrets are stored in this document.
