# Take a backup now, the same way the nightly backup service does: pg_dump
# writes the file inside the container (nothing is piped through PowerShell,
# which corrupts binary output), every document is archived, and the copy is
# restored into a scratch database before it counts.
. (Join-Path $PSScriptRoot "abp-common.ps1")
Assert-ProductionFiles
Invoke-AbpCompose @("run", "--rm", "-T", "backup", "now")
Write-Host "Backup taken and restore-checked. It is in ABP_BACKUP_DIR (default .\backups)."
Write-Host "Set ABP_BACKUP_OFFSITE_DIR so every backup is also copied to a second disk or share."
