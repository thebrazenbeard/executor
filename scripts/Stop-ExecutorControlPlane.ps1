param(
  [string]$RuntimeRoot = (Join-Path $env:LOCALAPPDATA "Executor")
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$StatePath = Join-Path $RuntimeRoot "control-plane-state.json"

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
  Write-Host "Executor control-plane state not found: $StatePath"
  return
}

$state = Get-Content -Raw -Encoding UTF8 $StatePath | ConvertFrom-Json
$allSafe = $true
if (-not (Stop-RecordedProcess ([int]$state.tunnel_pid) "tunnel-client")) { $allSafe = $false }
if (-not (Stop-RecordedProcess ([int]$state.server_pid) "dist/server.js")) { $allSafe = $false }

if (-not $allSafe) {
  Write-Warning "Control-plane state retained because at least one recorded PID no longer belongs to Executor."
  throw "Executor control-plane stop aborted on PID identity mismatch"
}

Remove-Item -LiteralPath $StatePath -Force -ErrorAction SilentlyContinue
Write-Host "EXECUTOR CONTROL PLANE STOPPED"
