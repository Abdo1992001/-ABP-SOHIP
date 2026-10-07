# Check a backup: the checksums match and it restores into a scratch
# database. Names are the folders in ABP_BACKUP_DIR, e.g. 20261004-020000.
param([Parameter(Mandatory)][string]$BackupName)
. (Join-Path $PSScriptRoot "abp-common.ps1")
Invoke-AbpCompose @("run", "--rm", "-T", "backup", "verify", $BackupName)
Write-Host "Backup $BackupName verified: checksums match and it restores."
