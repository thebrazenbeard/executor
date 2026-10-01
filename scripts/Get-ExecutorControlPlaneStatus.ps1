param(
  [string]$RuntimeRoot = (Join-Path $env:LOCALAPPDATA "Executor")
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$StatePath = Join-Path $RuntimeRoot "control-plane-state.json"

function Get-RecordedProcessState([int]$ProcessId,[string]$CommandNeedle) {
  if ($ProcessId -le 0) { return @{ alive = $false; identity_match = $false } }
  $record = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
  if (-not $record) { return @{ alive = $false; identity_match = $false } }
  $commandLine = [string]$record.CommandLine
  return @{ alive = $true; identity_match = ($commandLine -like "*$CommandNeedle*") }
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
$tunnel = Get-RecordedProcessState ([int]$state.tunnel_pid) "tunnel-client"

$mcpHealth = $null
$mcpHealthOk = $false
try {
  $healthUrl = ([string]$state.local_mcp) -replace '/mcp$', '/health'
  $mcpHealth = Invoke-RestMethod -Uri $healthUrl -Method Get -TimeoutSec 2
  $mcpHealthOk = ($mcpHealth.status -eq "ok")
}
catch {}

$deviceHealth = $null
$deviceHealthOk = $false
try {
  $deviceHealth = Invoke-RestMethod -Uri (([string]$state.local_device_ingress).TrimEnd("/") + "/health") -Method Get -TimeoutSec 2
  $deviceHealthOk = ($deviceHealth.status -eq "ok" -and $deviceHealth.role -eq "device-ingress")
}
catch {}

$tunnelReady = $false
try {
  $ready = Invoke-WebRequest -UseBasicParsing -Uri (([string]$state.tunnel_health_url).TrimEnd("/") + "/readyz") -TimeoutSec 2
  $tunnelReady = ($ready.StatusCode -eq 200)
}
catch {}

[pscustomobject]@{
  running = ($server.alive -and $server.identity_match -and $tunnel.alive -and $tunnel.identity_match -and $mcpHealthOk -and $deviceHealthOk -and $tunnelReady)
  state_present = $true
  state_path = $StatePath
  server = $server
  tunnel = $tunnel
  mcp_health_ok = $mcpHealthOk
  mcp_health = $mcpHealth
  device_ingress_health_ok = $deviceHealthOk
  device_ingress_health = $deviceHealth
  tunnel_ready = $tunnelReady
  tunnel_health_url = $state.tunnel_health_url
  mcp_session_verified = [bool]$state.mcp_session_verified
  started_utc = $state.started_utc
} | ConvertTo-Json -Depth 8
