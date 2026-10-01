param(
  [string]$RuntimeRoot = (Join-Path $env:LOCALAPPDATA "Executor")
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$StatePath = Join-Path $RuntimeRoot "runtime-state.json"

function Get-RecordedProcessState([int]$ProcessId,[string]$CommandNeedle) {
  if ($ProcessId -le 0) {
    return @{ alive = $false; identity_match = $false }
  }

  $record = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
  if (-not $record) {
    return @{ alive = $false; identity_match = $false }
  }

  $commandLine = [string]$record.CommandLine
  return @{
    alive = $true
    identity_match = ($commandLine -like "*$CommandNeedle*")
  }
}

if (-not (Test-Path -LiteralPath $StatePath -PathType Leaf)) {
  [pscustomobject]@{
    running = $false
    state_present = $false
    state_path = $StatePath
  } | ConvertTo-Json -Depth 5
  return
}

$state = Get-Content -Raw -Encoding UTF8 $StatePath | ConvertFrom-Json
$server = Get-RecordedProcessState ([int]$state.server_pid) "dist/server.js"
$device = Get-RecordedProcessState ([int]$state.device_pid) "dist/device-agent.js"
$tunnel = Get-RecordedProcessState ([int]$state.tunnel_pid) "tunnel-client"

$health = $null
$healthOk = $false
try {
  $healthUrl = ([string]$state.local_mcp) -replace '/mcp$', '/health'
  $health = Invoke-RestMethod -Uri $healthUrl -Method Get -TimeoutSec 2
  $healthOk = ($health.status -eq "ok")
}
catch {}

$tunnelReady = $false
if ($state.PSObject.Properties.Name -contains "tunnel_health_url") {
  try {
    $ready = Invoke-WebRequest -UseBasicParsing -Uri (([string]$state.tunnel_health_url).TrimEnd("/") + "/readyz") -TimeoutSec 2
    $tunnelReady = ($ready.StatusCode -eq 200)
  }
  catch {}
}

[pscustomobject]@{
  running = ($server.alive -and $server.identity_match -and $device.alive -and $device.identity_match -and $tunnel.alive -and $tunnel.identity_match -and $healthOk -and $tunnelReady)
  state_present = $true
  state_path = $StatePath
  device_id = $state.device_id
  server = $server
  device = $device
  tunnel = $tunnel
  health_ok = $healthOk
  health = $health
  tunnel_ready = $tunnelReady
  tunnel_health_url = if ($state.PSObject.Properties.Name -contains "tunnel_health_url") { $state.tunnel_health_url } else { $null }
  mcp_session_verified = [bool]$state.mcp_session_verified
  started_utc = $state.started_utc
} | ConvertTo-Json -Depth 8
