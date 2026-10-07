param([string]$Username = "")
. (Join-Path $PSScriptRoot "abp-common.ps1")
Assert-ProductionFiles
if ([string]::IsNullOrWhiteSpace($Username)) { $Username = Read-Host "Username" }
$password = Read-Host "New password" -AsSecureString
$confirmation = Read-Host "Confirm new password" -AsSecureString
$plain = [System.Net.NetworkCredential]::new("", $password).Password
$plainConfirmation = [System.Net.NetworkCredential]::new("", $confirmation).Password
if ($plain -cne $plainConfirmation) { throw "Passwords do not match" }
try {
  $env:ABP_TARGET_USERNAME = $Username
  $env:ABP_ADMIN_PASSWORD = $plain
  Push-Location $RepoRoot
  & docker compose --env-file $EnvFile -f $ComposeFile run --rm -T `
    -e ABP_TARGET_USERNAME -e ABP_ADMIN_PASSWORD api `
    node apps/api/dist/security/local-admin-cli.js reset-password
  if ($LASTEXITCODE -ne 0) { throw "Password reset failed" }
} finally {
  Pop-Location
  Remove-Item Env:ABP_TARGET_USERNAME, Env:ABP_ADMIN_PASSWORD -ErrorAction SilentlyContinue
  $plain = $null
  $plainConfirmation = $null
}
