$ErrorActionPreference = "Stop"
$script:RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "../..")).Path
$script:ComposeFile = Join-Path $script:RepoRoot "docker-compose.production.yml"
$script:EnvFile = Join-Path $script:RepoRoot ".env.production"

function Assert-ProductionFiles {
  if (-not (Test-Path -LiteralPath $script:EnvFile)) {
    throw "Missing .env.production. Copy .env.production.example, set protected values, and retry."
  }
  if (-not (Test-Path -LiteralPath $script:ComposeFile)) { throw "Missing docker-compose.production.yml" }
}

function Invoke-AbpCompose {
  param([Parameter(Mandatory)][string[]]$Arguments)
  Assert-ProductionFiles
  & docker compose --env-file $script:EnvFile -f $script:ComposeFile @Arguments
  if ($LASTEXITCODE -ne 0) { throw "docker compose failed with exit code $LASTEXITCODE" }
}
