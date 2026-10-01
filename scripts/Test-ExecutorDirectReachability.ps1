param(
  [Parameter(Mandatory=$true)][string]$PublicDeviceUrl,
  [Parameter(Mandatory=$true)][string]$CaCertificatePath,
  [switch]$ResolveToLoopback
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if (-not (Test-Path -LiteralPath $CaCertificatePath -PathType Leaf)) {
  throw "CA certificate not found: $CaCertificatePath"
}

$uri = [Uri]$PublicDeviceUrl
if ($uri.Scheme -ne "https") { throw "HTTPS required" }

$curl = (Get-Command curl.exe -ErrorAction Stop).Source
$args = @("--silent","--show-error","--fail","--ssl-revoke-best-effort","--cacert",$CaCertificatePath)
if ($ResolveToLoopback) {
  $port = if ($uri.Port -gt 0) { $uri.Port } else { 443 }
  $args += @("--resolve",("{0}:{1}:127.0.0.1" -f $uri.Host,$port))
}
$args += ($PublicDeviceUrl.TrimEnd("/") + "/health")

$body = & $curl @args
if ($LASTEXITCODE -ne 0) { throw "direct reachability failed" }

$health = $body | ConvertFrom-Json
if ($health.status -ne "ok" -or $health.role -ne "device-ingress") {
  throw "unexpected health response"
}

[pscustomobject]@{
  reachable = $true
  endpoint = $PublicDeviceUrl
  role = $health.role
} | ConvertTo-Json -Depth 4
