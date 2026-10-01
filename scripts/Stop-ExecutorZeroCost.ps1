param(
  [string]$RuntimeRoot = (Join-Path $env:LOCALAPPDATA "Executor")
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$StatePath = Join-Path $RuntimeRoot "zero-cost-state.json"

function Stop-RecordedProcess([int]$ProcessId,[string]$CommandNeedle) {
  if ($ProcessId -le 0) { return $true }
  $record = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
  if (-not $record) { return $true }
  $commandLine = [string]$record.CommandLine
  if ($commandLine -notlike "*$CommandNeedle*") {
    Write-Warning "Refusing to stop PID $ProcessId because its CommandLine no longer matches $CommandNeedle"
    return $false
  }
  Stop-Process -Id $ProcessId -Force -ErrorAction Stop
  return $true
}

if (-not (Test-Path -LiteralPath $StatePath -PathType Leaf)) {
  & (Join-Path $PSScriptRoot "Stop-ExecutorControlPlane.ps1") -RuntimeRoot $RuntimeRoot
  return
}

$state = Get-Content -Raw -Encoding UTF8 -LiteralPath $StatePath | ConvertFrom-Json
$allSafe = $true
if (-not (Stop-RecordedProcess ([int]$state.quick_tunnel_pid) "cloudflared")) { $allSafe = $false }

if (-not $allSafe) {
  Write-Warning "Zero-cost state retained because the recorded Quick Tunnel PID no longer belongs to cloudflared."
  throw "Executor zero-cost stop aborted on PID identity mismatch"
}

& (Join-Path $PSScriptRoot "Stop-ExecutorControlPlane.ps1") -RuntimeRoot $RuntimeRoot
Remove-Item -LiteralPath $StatePath -Force -ErrorAction SilentlyContinue
Write-Host "EXECUTOR ZERO-COST QUICKSTART STOPPED"
