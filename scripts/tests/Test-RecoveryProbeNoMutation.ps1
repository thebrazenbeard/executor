#requires -Version 5.1
# Regression: -ProbeOnly may report status, but must not rewrite the persisted
# recovery snapshot or create a new one. Run only a copied script in temp state.
# The source still uses a fixed named mutex, so execute on a disposable CI
# runner without an installed recovery task; do not run on active Lappy.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$source = Join-Path $PSScriptRoot '..\lappy-recovery\Invoke-ExecutorRecovery.ps1'
$fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ('bt2-executor-probeonly-' + [Guid]::NewGuid().ToString('N'))
$recoveryDir = Join-Path $fixtureRoot 'Executor\Recovery'
$copy = Join-Path $fixtureRoot 'Invoke-ExecutorRecovery.ps1'
$health = Join-Path $recoveryDir 'health.json'
$restartStamp = Join-Path $recoveryDir 'last-restart-attempt.txt'
$previousLocalAppData = $env:LOCALAPPDATA

try {
  New-Item -ItemType Directory -Path $recoveryDir -Force | Out-Null
  Copy-Item -LiteralPath $source -Destination $copy -ErrorAction Stop
  $sentinel = '{"sentinel":"existing-scheduler-observation"}'
  [IO.File]::WriteAllText($health, $sentinel)
  $expectedHash = (Get-FileHash -LiteralPath $health -Algorithm SHA256).Hash

  # No Agent\scripts directory is provided in this fixture; Direct-Status
  # deterministically returns false without inspecting installed Executor.
  $env:LOCALAPPDATA = $fixtureRoot
  $status = @(& $copy -ProbeOnly) | Out-String | ConvertFrom-Json
  if ($status.status -ne 'NOT_READY' -or $status.reason -ne 'READ_ONLY_PROBE_NO_START') {
    throw 'Isolated ProbeOnly did not return the expected NOT_READY diagnosis.'
  }
  if ((Get-FileHash -LiteralPath $health -Algorithm SHA256).Hash -ne $expectedHash) {
    throw 'ProbeOnly overwrote an existing scheduler health snapshot.'
  }
  if (Test-Path -LiteralPath $restartStamp) {
    throw 'ProbeOnly unexpectedly created a restart-attempt stamp.'
  }

  Remove-Item -LiteralPath $health -Force
  $null = @(& $copy -ProbeOnly)
  if (Test-Path -LiteralPath $health) {
    throw 'ProbeOnly unexpectedly created a persisted health snapshot.'
  }

  Write-Output 'PASS: copied Executor ProbeOnly reports status without persisting state'
} finally {
  $env:LOCALAPPDATA = $previousLocalAppData
  if (Test-Path -LiteralPath $fixtureRoot -PathType Container) {
    Remove-Item -LiteralPath $fixtureRoot -Recurse -Force
  }
}
