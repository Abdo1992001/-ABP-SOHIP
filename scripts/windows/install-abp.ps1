. (Join-Path $PSScriptRoot "abp-common.ps1")
New-Item -ItemType Directory -Force (Join-Path $RepoRoot "config"), (Join-Path $RepoRoot "secrets"), (Join-Path $RepoRoot "backups") | Out-Null
$target = Join-Path $RepoRoot ".env.production"
if (-not (Test-Path $target)) { Copy-Item (Join-Path $RepoRoot ".env.production.example") $target }
Write-Host "ABP local installation scaffold is ready. Set POSTGRES_PASSWORD and local secrets in .env.production, then run start-abp.ps1."
