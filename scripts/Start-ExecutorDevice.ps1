param(
  [Parameter(Mandatory=$true)][string]$ServiceUrl,
  [Parameter(Mandatory=$true)][string]$DeviceId,
  [Parameter(Mandatory=$true)][string]$DeviceToken,
  [Parameter(Mandatory=$true)][string]$TrustedManifestSha256,
  [Parameter(Mandatory=$true)][string]$InstallRoot
)

$ErrorActionPreference = "Stop"

$env:EXECUTOR_SERVICE_URL = $ServiceUrl
$env:EXECUTOR_DEVICE_ID = $DeviceId
$env:EXECUTOR_DEVICE_TOKEN = $DeviceToken
$env:EXECUTOR_INSTALL_ROOT = $InstallRoot
$env:EXECUTOR_TRUSTED_MANIFEST_SHA256 = $TrustedManifestSha256

node (Join-Path $PSScriptRoot "..\dist\device-agent.js")
