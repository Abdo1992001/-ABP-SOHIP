param([Parameter(Mandatory)][string]$ReleaseImageTag)
Write-Host "Rollback requires an image tag produced by the local release process: $ReleaseImageTag"
Write-Host "This script intentionally does not mutate the database. Restore a verified backup before any destructive schema rollback."
