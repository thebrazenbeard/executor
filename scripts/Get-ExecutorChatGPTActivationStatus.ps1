param(
  [string]$RuntimeRoot = (Join-Path $env:LOCALAPPDATA "Executor"),
  [string]$OpenAITunnelCredentialsFile = "",
  [string]$TunnelClient = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

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
    return @{ id = ""; key = "" }
  }
  $lines = @(Get-Content -LiteralPath $Path -Encoding UTF8)
  $id = ""
  $key = ""
  for ($i = 0; $i -lt $lines.Count; $i++) {
    $line = [string]$lines[$i]
    if ($line -match '^\s*tunnel[_\s-]*id\s*:\s*(.*)$') {
      $id = Read-NextValue $lines $i $Matches[1]
    }
    elseif ($line -match '^\s*(api[_\s-]*)?secret([_\s-]*key)?\s*:\s*(.*)$') {
      $key = Read-NextValue $lines $i $Matches[3]
    }
  }
  return @{ id = $id; key = $key }
}

$controlStatus = (& (Join-Path $PSScriptRoot "Get-ExecutorControlPlaneStatus.ps1") -RuntimeRoot $RuntimeRoot | Out-String | ConvertFrom-Json)

$directStatePath = Join-Path $RuntimeRoot "direct-state.json"
if ([string]::IsNullOrWhiteSpace($OpenAITunnelCredentialsFile) -and (Test-Path -LiteralPath $directStatePath -PathType Leaf)) {
  try {
    $directState = Get-Content -Raw -Encoding UTF8 -LiteralPath $directStatePath | ConvertFrom-Json
    if ($directState.PSObject.Properties.Name -contains "credential_file") {
      $OpenAITunnelCredentialsFile = [string]$directState.credential_file
    }
  }
  catch {}
}

$credentials = Read-TunnelCredentials $OpenAITunnelCredentialsFile
$tunnelId = [Environment]::GetEnvironmentVariable("EXECUTOR_TUNNEL_ID")
if ([string]::IsNullOrWhiteSpace($tunnelId)) { $tunnelId = [string]$credentials.id }

$runtimeKey = [Environment]::GetEnvironmentVariable("EXECUTOR_TUNNEL_API_SECRET")
if ([string]::IsNullOrWhiteSpace($runtimeKey)) { $runtimeKey = [Environment]::GetEnvironmentVariable("CONTROL_PLANE_API_KEY") }
if ([string]::IsNullOrWhiteSpace($runtimeKey)) { $runtimeKey = [string]$credentials.key }

if ([string]::IsNullOrWhiteSpace($TunnelClient)) {
  $bundledClient = Join-Path $RuntimeRoot "tools\tunnel-client.exe"
  if (Test-Path -LiteralPath $bundledClient -PathType Leaf) {
    $TunnelClient = $bundledClient
  }
  else {
    $TunnelClient = (Get-Command tunnel-client -ErrorAction SilentlyContinue).Source
  }
}

$metadata = $null
$metadataOk = $false
$metadataError = $null
$originalControlPlaneKey = [Environment]::GetEnvironmentVariable("CONTROL_PLANE_API_KEY")
try {
  if (-not [string]::IsNullOrWhiteSpace($tunnelId) -and
      -not [string]::IsNullOrWhiteSpace($runtimeKey) -and
      -not [string]::IsNullOrWhiteSpace($TunnelClient)) {
    $env:CONTROL_PLANE_API_KEY = $runtimeKey
    $rawMetadata = & $TunnelClient admin --json tunnels get $tunnelId 2>$null
    if ($LASTEXITCODE -eq 0 -and $rawMetadata) {
      $metadata = ($rawMetadata | Out-String | ConvertFrom-Json)
      $metadataOk = ([string]$metadata.id -eq $tunnelId)
    }
    else {
      $metadataError = "tunnel metadata lookup failed"
    }
  }
  elseif ([string]::IsNullOrWhiteSpace($tunnelId)) {
    $metadataError = "tunnel id unavailable"
  }
  elseif ([string]::IsNullOrWhiteSpace($runtimeKey)) {
    $metadataError = "runtime tunnel key unavailable"
  }
  else {
    $metadataError = "tunnel-client unavailable"
  }
}
catch {
  $metadataError = "tunnel metadata lookup failed"
}
finally {
  $env:CONTROL_PLANE_API_KEY = $originalControlPlaneKey
  $runtimeKey = $null
  $credentials.key = $null
}

$ready = [bool]$controlStatus.running -and
         [bool]$controlStatus.tunnel_ready -and
         [bool]$controlStatus.mcp_session_verified -and
         $metadataOk

[pscustomobject]@{
  schema = "EXECUTOR_CHATGPT_ACTIVATION_STATUS_V1"
  ready_for_chatgpt_activation = $ready
  control_plane_running = [bool]$controlStatus.running
  tunnel_ready = [bool]$controlStatus.tunnel_ready
  mcp_session_verified = [bool]$controlStatus.mcp_session_verified
  tunnel_metadata_verified = $metadataOk
  tunnel_id = if ([string]::IsNullOrWhiteSpace($tunnelId)) { $null } else { $tunnelId }
  tunnel_name = if ($metadataOk) { [string]$metadata.name } else { $null }
  tunnel_description = if ($metadataOk) { [string]$metadata.description } else { $null }
  organization_ids = if ($metadataOk) { @($metadata.organization_ids) } else { @() }
  chatgpt_connection_method = "Tunnel"
  metadata_error = $metadataError
} | ConvertTo-Json -Depth 6
