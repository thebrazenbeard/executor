param(
  [string]$RuntimeRoot = (Join-Path $env:LOCALAPPDATA "Executor"),
  [string]$ProfilePath = "",
  [string]$TunnelClient = "tunnel-client"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$StatePath = Join-Path $RuntimeRoot "direct-state.json"
$DeviceStatePath = Join-Path $RuntimeRoot "device.json"

function Read-NextValue([string[]]$Lines,[int]$Index,[string]$Inline) {
  if (-not [string]::IsNullOrWhiteSpace($Inline)) { return $Inline.Trim() }
  for ($i = $Index + 1; $i -lt $Lines.Count; $i++) {
    $candidate = [string]$Lines[$i]
    if (-not [string]::IsNullOrWhiteSpace($candidate)) { return $candidate.Trim() }
  }
  return ""
}

function Read-TunnelCredentials([string]$Path) {
  if ([string]::IsNullOrWhiteSpace($Path) -or -not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    return @{ id = ""; secret = "" }
  }
  $lines = @(Get-Content -LiteralPath $Path -Encoding UTF8)
  $id = ""
  $secret = ""
  for ($i = 0; $i -lt $lines.Count; $i++) {
    $line = [string]$lines[$i]
    if ($line -match '^\s*tunnel[_\s-]*id\s*:\s*(.*)$') {
      $id = Read-NextValue $lines $i $Matches[1]
    }
    elseif ($line -match '^\s*(api[_\s-]*)?secret([_\s-]*key)?\s*:\s*(.*)$') {
      $secret = Read-NextValue $lines $i $Matches[3]
    }
  }
  return @{ id = $id; secret = $secret }
}

function New-RandomSecret {
  $bytes = New-Object byte[] 32
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  return [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+","-").Replace("/","_")
}

$originalClientToken = [Environment]::GetEnvironmentVariable("EXECUTOR_CLIENT_TOKEN")
$originalTunnelId = [Environment]::GetEnvironmentVariable("EXECUTOR_TUNNEL_ID")
$originalTunnelSecret = [Environment]::GetEnvironmentVariable("EXECUTOR_TUNNEL_API_SECRET")
$originalPort = [Environment]::GetEnvironmentVariable("PORT")
$originalDevicePort = [Environment]::GetEnvironmentVariable("EXECUTOR_DEVICE_PORT")
$originalDefaultDevice = [Environment]::GetEnvironmentVariable("EXECUTOR_DEFAULT_DEVICE")
$originalDeviceTokensFile = [Environment]::GetEnvironmentVariable("EXECUTOR_DEVICE_TOKENS_FILE")

$credentials = @{ id = ""; secret = "" }
$directState = $null
try {
  if (Test-Path -LiteralPath $StatePath -PathType Leaf) {
    $directState = Get-Content -Raw -Encoding UTF8 -LiteralPath $StatePath | ConvertFrom-Json
  }

  if ([string]::IsNullOrWhiteSpace($ProfilePath)) {
    if ($directState -and $directState.tunnel_profile_path) {
      $ProfilePath = [string]$directState.tunnel_profile_path
    }
    else {
      $ProfilePath = Join-Path $PSScriptRoot "..\deploy\tunnel-client.executor.example.yaml"
    }
  }

  if ([string]::IsNullOrWhiteSpace($env:PORT) -and $directState -and $directState.local_mcp_port) {
    $env:PORT = [string]$directState.local_mcp_port
  }
  if ([string]::IsNullOrWhiteSpace($env:EXECUTOR_DEVICE_PORT) -and $directState -and $directState.local_device_port) {
    $env:EXECUTOR_DEVICE_PORT = [string]$directState.local_device_port
  }
  if ([string]::IsNullOrWhiteSpace($env:EXECUTOR_DEVICE_TOKENS_FILE)) {
    $env:EXECUTOR_DEVICE_TOKENS_FILE = Join-Path $RuntimeRoot "device-tokens.json"
  }

  if ([string]::IsNullOrWhiteSpace($env:EXECUTOR_DEFAULT_DEVICE) -and
      (Test-Path -LiteralPath $DeviceStatePath -PathType Leaf)) {
    try {
      $deviceState = Get-Content -Raw -Encoding UTF8 -LiteralPath $DeviceStatePath | ConvertFrom-Json
      if ($deviceState.device_id) { $env:EXECUTOR_DEFAULT_DEVICE = [string]$deviceState.device_id }
    }
    catch {}
  }

  if (($directState -and $directState.credential_file) -and
      ([string]::IsNullOrWhiteSpace($env:EXECUTOR_TUNNEL_ID) -or
       [string]::IsNullOrWhiteSpace($env:EXECUTOR_TUNNEL_API_SECRET))) {
    $credentials = Read-TunnelCredentials ([string]$directState.credential_file)
    if ([string]::IsNullOrWhiteSpace($env:EXECUTOR_TUNNEL_ID)) {
      $env:EXECUTOR_TUNNEL_ID = [string]$credentials.id
    }
    if ([string]::IsNullOrWhiteSpace($env:EXECUTOR_TUNNEL_API_SECRET)) {
      $env:EXECUTOR_TUNNEL_API_SECRET = [string]$credentials.secret
    }
  }

  if ([string]::IsNullOrWhiteSpace($env:EXECUTOR_CLIENT_TOKEN)) {
    $env:EXECUTOR_CLIENT_TOKEN = New-RandomSecret
  }
  $startArgs = @{
    RuntimeRoot = $RuntimeRoot
    ProfilePath = $ProfilePath
    TunnelClient = $TunnelClient
  }
  & (Join-Path $PSScriptRoot "Stop-ExecutorControlPlane.ps1") -RuntimeRoot $RuntimeRoot
  & (Join-Path $PSScriptRoot "Start-ExecutorControlPlane.ps1") @startArgs
}
finally {
  $env:EXECUTOR_CLIENT_TOKEN = $originalClientToken
  $env:EXECUTOR_TUNNEL_ID = $originalTunnelId
  $env:EXECUTOR_TUNNEL_API_SECRET = $originalTunnelSecret
  $env:PORT = $originalPort
  $env:EXECUTOR_DEVICE_PORT = $originalDevicePort
  $env:EXECUTOR_DEFAULT_DEVICE = $originalDefaultDevice
  $env:EXECUTOR_DEVICE_TOKENS_FILE = $originalDeviceTokensFile
  $credentials.secret = $null
}
