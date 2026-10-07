# Security Test Report

OpenAPI checks pass and the production-seed guard works. `pnpm audit --audit-level high` remains FAIL: 0 critical, 2 high and 8 moderate advisories after overrides. Both high findings are `image-size@2.0.2`; the available registry did not provide the patched `>=2.0.3` release.

The required negative IDOR, country-scope, ownership/sharing, finance/logistics isolation, field-level and unauthorized-export tests were not all executed. Policy surfaces exist, but the security gate remains FAIL until adversarial fixtures and runs are captured.
