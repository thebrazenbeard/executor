param(
  [string]$RuntimeRoot = (Join-Path $env:LOCALAPPDATA "Executor")
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$StatePath = Join-Path $RuntimeRoot "runtime-state.json"

function Stop-RecordedProcess([int]$ProcessId,[string]$CommandNeedle) {
  if ($ProcessId -le 0) { return }
  $record = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
  if (-not $record) { return }

  $commandLine = [string]$record.CommandLine
  if ($commandLine -notlike "*$CommandNeedle*") {
    Write-Warning "Refusing to stop PID $ProcessId because its CommandLine no longer matches $CommandNeedle"
    return
  }

  Stop-Process -Id $ProcessId -Force -ErrorAction Stop
}

if (-not (Test-Path -LiteralPath $StatePath -PathType Leaf)) {
  Write-Host "Executor runtime state not found: $StatePath"
  return
}

$state = Get-Content -Raw -Encoding UTF8 $StatePath | ConvertFrom-Json

Stop-RecordedProcess ([int]$state.tunnel_pid) "tunnel-client"
Stop-RecordedProcess ([int]$state.device_pid) "dist/device-agent.js"
Stop-RecordedProcess ([int]$state.server_pid) "dist/server.js"

Remove-Item -LiteralPath $StatePath -Force -ErrorAction SilentlyContinue
Write-Host "EXECUTOR STOPPED"
