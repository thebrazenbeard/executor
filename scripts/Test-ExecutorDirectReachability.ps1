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

$node = (Get-Command node -ErrorAction Stop).Source
$probeScript = Join-Path $PSScriptRoot "probe-device-ingress.mjs"
$args = @($probeScript,"--url",$PublicDeviceUrl,"--ca",$CaCertificatePath)
if ($ResolveToLoopback) { $args += "--resolve-to-loopback" }

& $node @args
if ($LASTEXITCODE -ne 0) { throw "direct reachability failed" }
