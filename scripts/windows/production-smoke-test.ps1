. (Join-Path $PSScriptRoot "abp-common.ps1")
& (Join-Path $PSScriptRoot "health-check.ps1")
Invoke-AbpCompose @("ps")
Write-Host "Production smoke baseline completed: reverse proxy readiness and service state. Business journey E2E remains a separate gate."
