param([string]$RuntimeRoot = (Join-Path $env:LOCALAPPDATA "Executor"))

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$statePath = Join-Path $RuntimeRoot "direct-state.json"

function Stop-RecordedProcess([int]$ProcessId,[string]$CommandNeedle) {
  if ($ProcessId -le 0) { return $true }
  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
  if (-not $process) { return $true }
  if ([string]$process.CommandLine -notlike "*$CommandNeedle*") { return $false }
  Stop-Process -Id $ProcessId -Force
  return $true
}

if (Test-Path -LiteralPath $statePath -PathType Leaf) {
  $state = Get-Content -Raw -Encoding UTF8 $statePath | ConvertFrom-Json

  if (-not (Stop-RecordedProcess ([int]$state.caddy_pid) "caddy")) {
    throw "Caddy PID identity mismatch"
  }

  $natPmpCreated = ($state.PSObject.Properties.Name -contains "nat_pmp_mapping_created") -and [bool]$state.nat_pmp_mapping_created
  $natPmpGateway = if ($state.PSObject.Properties.Name -contains "nat_pmp_gateway") { [string]$state.nat_pmp_gateway } else { "" }
  $natPmpPid = if ($state.PSObject.Properties.Name -contains "nat_pmp_pid" -and $state.nat_pmp_pid) { [int]$state.nat_pmp_pid } else { 0 }

  if ($natPmpCreated -and -not [string]::IsNullOrWhiteSpace($natPmpGateway)) {
    try {
      $node = (Get-Command node -ErrorAction Stop).Source
      & $node (Join-Path $PSScriptRoot "nat-pmp-port-map.mjs") delete --gateway $natPmpGateway --protocol tcp --internal-port ([int]$state.public_port) *> $null
    }
    catch {}
  }
  if ($natPmpPid -gt 0 -and -not (Stop-RecordedProcess $natPmpPid "nat-pmp-port-map.mjs")) {
    throw "NAT-PMP PID identity mismatch"
  }

  if ([bool]$state.upnp_mapping_created) {
    try {
      $mappings = (New-Object -ComObject HNetCfg.NATUPnP).StaticPortMappingCollection
      if ($mappings) { $mappings.Remove([int]$state.public_port,"TCP") }
    }
    catch {}
  }

  if ([bool]$state.firewall_rule_created) {
    Remove-NetFirewallRule -DisplayName ([string]$state.firewall_rule_name) -ErrorAction SilentlyContinue
  }
}

& (Join-Path $PSScriptRoot "Stop-ExecutorControlPlane.ps1") -RuntimeRoot $RuntimeRoot
Remove-Item -LiteralPath $statePath,(Join-Path $RuntimeRoot "nat-pmp-ready.json") -Force -ErrorAction SilentlyContinue
Write-Host "EXECUTOR DIRECT INGRESS STOPPED"