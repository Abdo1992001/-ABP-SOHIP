param([switch]$ConfirmRemoval)
if (-not $ConfirmRemoval) { throw "This operation is destructive. Re-run with -ConfirmRemoval after a verified backup." }
throw "Demo-data removal must be implemented as a reviewed, audited database command before production use; no implicit destructive SQL is run by this scaffold."
