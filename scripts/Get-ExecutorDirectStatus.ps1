param([string]$RuntimeRoot = (Join-Path $env:LOCALAPPDATA "Executor"))

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$statePath = Join-Path $RuntimeRoot "direct-state.json"

function Get-ProcessState([int]$ProcessId,[string]$CommandNeedle) {
  if ($ProcessId -le 0) { return @{ alive = $false; identity_match = $false } }
  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
  if (-not $process) { return @{ alive = $false; identity_match = $false } }
  return @{ alive = $true; identity_match = ([string]$process.CommandLine -like "*$CommandNeedle*") }
}

if (-not (Test-Path -LiteralPath $statePath -PathType Leaf)) {
  [pscustomobject]@{ running = $false; state_present = $false } | ConvertTo-Json
  return
}

$state = Get-Content -Raw -Encoding UTF8 $statePath | ConvertFrom-Json
$caddy = Get-ProcessState ([int]$state.caddy_pid) "caddy"

$controlPlaneOk = $false
try {
  $control = (& (Join-Path $PSScriptRoot "Get-ExecutorControlPlaneStatus.ps1") -RuntimeRoot $RuntimeRoot | Out-String | ConvertFrom-Json)
  $controlPlaneOk = [bool]$control.running
}
catch {}

$localTlsOk = $false
try {
  & (Join-Path $PSScriptRoot "Test-ExecutorDirectReachability.ps1") `
    -PublicDeviceUrl ([string]$state.public_device_url) `
    -CaCertificatePath ([string]$state.ca_certificate_path) `
    -TlsServerName ([string]$state.tls_server_name) `
    -ResolveToLoopback | Out-Null
  $localTlsOk = $true
}
catch {}

$natPmpCreated = ($state.PSObject.Properties.Name -contains "nat_pmp_mapping_created") -and [bool]$state.nat_pmp_mapping_created
$natPmpPid = if ($state.PSObject.Properties.Name -contains "nat_pmp_pid" -and $state.nat_pmp_pid) { [int]$state.nat_pmp_pid } else { 0 }
$natPmp = if ($natPmpCreated) { Get-ProcessState $natPmpPid "nat-pmp-port-map.mjs" } else { @{ alive = $false; identity_match = $false } }
$natPmpAlive = $natPmpCreated -and $natPmp.alive -and $natPmp.identity_match
$upnpCreated = [bool]$state.upnp_mapping_created

[pscustomobject]@{
  running = ($caddy.alive -and $caddy.identity_match -and $controlPlaneOk -and $localTlsOk -and ((-not $natPmpCreated) -or $natPmpAlive))
  state_present = $true
  caddy = $caddy
  control_plane_ok = $controlPlaneOk
  local_tls_ok = $localTlsOk
  public_device_url = $state.public_device_url
  tls_server_name = $state.tls_server_name
  ca_certificate_path = $state.ca_certificate_path
  port_mapping_mode_requested = if ($state.PSObject.Properties.Name -contains "port_mapping_mode_requested") { $state.port_mapping_mode_requested } else { $null }
  port_mapping_method = if ($state.PSObject.Properties.Name -contains "port_mapping_method") { $state.port_mapping_method } else { $null }
  upnp_mapping_created = $upnpCreated
  nat_pmp_mapping_created = $natPmpCreated
  nat_pmp_alive = $natPmpAlive
  nat_pmp_gateway = if ($state.PSObject.Properties.Name -contains "nat_pmp_gateway") { $state.nat_pmp_gateway } else { $null }
  public_route_configured = ($upnpCreated -or $natPmpAlive)
} | ConvertTo-Json -Depth 8