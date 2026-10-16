param(
  [string]$RuntimeRoot = (Join-Path $env:LOCALAPPDATA "Executor")
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$StatePath = Join-Path $RuntimeRoot "control-plane-state.json"

function Get-RecordedProcessState([int]$ProcessId,[string]$CommandNeedle,[string]$ExpectedName,[int[]]$ExpectedPorts) {
  $failed = @{ alive = $false; identity_match = $false; identity_source = 'NOT_FOUND' }
  if ($ProcessId -le 0) { return $failed }
  $record = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
  if (-not $record) { return $failed }
  $commandLine = [string]$record.CommandLine
  if (-not [string]::IsNullOrWhiteSpace($commandLine)) {
    # When available, preserve the original strict process command identity check.
    return @{ alive = $true; identity_match = ($commandLine -like "*$CommandNeedle*"); identity_source = 'COMMAND_LINE' }
  }
  # Limited Task Scheduler tokens cannot inspect command lines of elevated processes.
  # Fallback requires matching executable name AND ownership of every expected
  # local health listener, not merely an open port or a recorded PID.
  if ([string]$record.Name -ine $ExpectedName -or $ExpectedPorts.Count -eq 0) {
    return @{ alive = $true; identity_match = $false; identity_source = 'INACCESSIBLE_UNQUALIFIED' }
  }
  try {
    foreach ($port in $ExpectedPorts) {
      $owned = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction Stop |
        Where-Object { $_.LocalAddress -eq '127.0.0.1' -and $_.OwningProcess -eq $ProcessId })
      if ($owned.Count -eq 0) {
        return @{ alive = $true; identity_match = $false; identity_source = 'SOCKET_OWNER_MISMATCH' }
      }
    }
    return @{ alive = $true; identity_match = $true; identity_source = 'LOOPBACK_SOCKET_OWNER' }
  }
  catch {
    return @{ alive = $true; identity_match = $false; identity_source = 'SOCKET_QUERY_FAILED' }
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
$mcpUri = [uri]([string]$state.local_mcp)
$ingressUri = [uri]([string]$state.local_device_ingress)
$tunnelUri = [uri]([string]$state.tunnel_health_url)
foreach($endpoint in @($mcpUri,$ingressUri,$tunnelUri)) {
  if ($endpoint.DnsSafeHost -ne '127.0.0.1') { throw 'Expected loopback local Executor status endpoint' }
}
$server = Get-RecordedProcessState ([int]$state.server_pid) 'dist/server.js' 'node.exe' @($mcpUri.Port,$ingressUri.Port)
$tunnel = Get-RecordedProcessState ([int]$state.tunnel_pid) 'tunnel-client' 'tunnel-client.exe' @($tunnelUri.Port)

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
