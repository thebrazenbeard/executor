param(
  [string]$RuntimeRoot = (Join-Path $env:LOCALAPPDATA "Executor")
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$StatePath = Join-Path $RuntimeRoot "zero-cost-state.json"

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
  } | ConvertTo-Json -Depth 6
  return
}

$state = Get-Content -Raw -Encoding UTF8 -LiteralPath $StatePath | ConvertFrom-Json
$quick = Get-RecordedProcessState ([int]$state.quick_tunnel_pid) "cloudflared"

$control = $null
$controlOk = $false
try {
  $control = (& (Join-Path $PSScriptRoot "Get-ExecutorControlPlaneStatus.ps1") -RuntimeRoot $RuntimeRoot | Out-String | ConvertFrom-Json)
  $controlOk = [bool]$control.running
} catch {}

$publicHealth = $null
$publicOk = $false
try {
  $publicHealth = Invoke-RestMethod -Uri (([string]$state.public_device_url).TrimEnd("/") + "/health") -Method Get -TimeoutSec 5
  $publicOk = ($publicHealth.status -eq "ok" -and $publicHealth.role -eq "device-ingress")
} catch {}

[pscustomobject]@{
  running = ($quick.alive -and $quick.identity_match -and $controlOk -and $publicOk)
  state_present = $true
  state_path = $StatePath
  quick_tunnel = $quick
  public_device_url = $state.public_device_url
  public_health_ok = $publicOk
  public_health = $publicHealth
  control_plane_ok = $controlOk
  control_plane = $control
  source_head = $state.source_head
  started_utc = $state.started_utc
} | ConvertTo-Json -Depth 10
