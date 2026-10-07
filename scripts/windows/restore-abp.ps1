# Put a backup back: the database and every document. Destructive -- the live
# data is replaced -- so it needs -ConfirmRestore. The backup is checked and
# restored into a scratch database first; if that fails the live data is not
# touched. The application is stopped while it runs and started again after.
param(
  [Parameter(Mandatory)][string]$BackupName,
  [switch]$ConfirmRestore
)
. (Join-Path $PSScriptRoot "abp-common.ps1")
if (-not $ConfirmRestore) { throw "Restore replaces the live data. Re-run with -ConfirmRestore." }
Invoke-AbpCompose @("stop", "web", "api", "worker")
try {
  Invoke-AbpCompose @("run", "--rm", "-T", "backup", "restore", $BackupName, "--confirm")
} finally {
  Invoke-AbpCompose @("start", "api", "worker", "web")
}
Write-Host "Restored $BackupName."
