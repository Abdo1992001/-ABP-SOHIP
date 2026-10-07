. (Join-Path $PSScriptRoot "abp-common.ps1")
# An upgrade runs database migrations. Take a backup that restores first, so
# there is always a way back; if it fails, nothing is upgraded.
Invoke-AbpCompose @("up", "-d", "db")
Invoke-AbpCompose @("run", "--rm", "-T", "backup", "now")
Invoke-AbpCompose @("up", "-d", "--build", "migrate", "api", "worker", "web", "backup", "reverse-proxy")
