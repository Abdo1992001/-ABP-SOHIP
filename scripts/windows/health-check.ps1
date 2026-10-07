. (Join-Path $PSScriptRoot "abp-common.ps1")
Assert-ProductionFiles
$healthHost = "abp-commercial.local"
$healthUri = "https://$healthHost/api/v1/health/ready"
$headers = @{}
try {
  [void][System.Net.Dns]::GetHostAddresses($healthHost)
} catch {
  $healthUri = "https://127.0.0.1/api/v1/health/ready"
  $headers.Host = $healthHost
}
$invokeParameters = @{ Uri = $healthUri; Headers = $headers }
$supportsSkipCertificateCheck = (Get-Command Invoke-WebRequest).Parameters.ContainsKey("SkipCertificateCheck")
if ($supportsSkipCertificateCheck) {
  $invokeParameters.SkipCertificateCheck = $true
  $response = Invoke-WebRequest @invokeParameters
} else {
  $curlArgs = @("--insecure", "--ssl-no-revoke", "--fail", "--silent", "--show-error", "-H", "Host: $healthHost", $healthUri)
  $curlContent = & curl.exe @curlArgs
  if ($LASTEXITCODE -ne 0) { throw "ABP readiness request failed with curl exit code $LASTEXITCODE" }
  $response = [pscustomobject]@{ StatusCode = 200; Content = ($curlContent -join [Environment]::NewLine) }
}
if ($supportsSkipCertificateCheck) {
  # The response was obtained through Invoke-WebRequest above.
} elseif (-not $response) {
  throw "ABP readiness response was empty"
}
if ($response.StatusCode -ne 200) { throw "ABP readiness returned $($response.StatusCode)" }
$response.Content
