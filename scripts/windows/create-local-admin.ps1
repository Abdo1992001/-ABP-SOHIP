param([string]$Username = "", [string]$Email = "", [string]$DisplayName = "")
. (Join-Path $PSScriptRoot "abp-common.ps1")
Assert-ProductionFiles
if ([string]::IsNullOrWhiteSpace($Username)) { $Username = Read-Host "Username" }
if ([string]::IsNullOrWhiteSpace($Email)) { $Email = Read-Host "Email" }
if ([string]::IsNullOrWhiteSpace($DisplayName)) { $DisplayName = Read-Host "Display name" }
$password = Read-Host "Password" -AsSecureString
$confirmation = Read-Host "Confirm password" -AsSecureString
$plain = [System.Net.NetworkCredential]::new("", $password).Password
$plainConfirmation = [System.Net.NetworkCredential]::new("", $confirmation).Password
if ($plain -cne $plainConfirmation) { throw "Passwords do not match" }
try {
  $env:ABP_ADMIN_USERNAME = $Username
  $env:ABP_ADMIN_EMAIL = $Email
  $env:ABP_ADMIN_DISPLAY_NAME = $DisplayName
  $env:ABP_ADMIN_PASSWORD = $plain
  Push-Location $RepoRoot
  & docker compose --env-file $EnvFile -f $ComposeFile run --rm -T `
    -e ABP_ADMIN_USERNAME -e ABP_ADMIN_EMAIL -e ABP_ADMIN_DISPLAY_NAME `
    -e ABP_ADMIN_PASSWORD api node apps/api/dist/security/local-admin-cli.js create
  if ($LASTEXITCODE -ne 0) { throw "Local administrator creation failed" }
} finally {
  Pop-Location
  Remove-Item Env:ABP_ADMIN_USERNAME, Env:ABP_ADMIN_EMAIL, Env:ABP_ADMIN_DISPLAY_NAME, Env:ABP_ADMIN_PASSWORD -ErrorAction SilentlyContinue
  $plain = $null
  $plainConfirmation = $null
}
