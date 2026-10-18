#requires -Version 5.1
# Offline negative/recovery cadence test. Does NOT load real credentials or stop live processes.
[CmdletBinding()]
param(
  [string]$RecoveryScript = (Join-Path $PSScriptRoot '..\lappy-recovery\Invoke-ExecutorRecovery.ps1')
)
$ErrorActionPreference = 'Stop'
$source = Get-Content -Raw -LiteralPath $RecoveryScript
if (-not $source.Contains('TotalSeconds -lt 90')) {
  throw 'Expected 90-second fail-closed recovery contract absent'
}
$mutexName = 'Local\VeraExecutorControlPlaneRecoveryV1'
if (-not $source.Contains($mutexName)) { throw 'Expected recovery mutex absent' }
$originalAppData = $env:LOCALAPPDATA
$fixtureRoot = Join-Path $env:TEMP ('executor-recovery-test-' + [guid]::NewGuid().ToString('N'))
$fixtureRecovery = Join-Path $fixtureRoot 'Executor\Recovery'
[void](New-Item -ItemType Directory -Path $fixtureRecovery -Force)
$fixtureScript = Join-Path $fixtureRecovery 'recovery-test.ps1'
$fixtureMutex = 'Local\RecoveryTest' + [guid]::NewGuid().ToString('N')
[IO.File]::WriteAllText($fixtureScript, $source.Replace($mutexName, $fixtureMutex))
# A deliberately non-secret marker only; branches under test must never unseal it.
[IO.File]::WriteAllText(
  (Join-Path $fixtureRecovery 'tunnel-credentials.dpapi.json'), 'fixture-presence-only'
)
$results = @()
try {
  $env:LOCALAPPDATA = $fixtureRoot
  foreach ($age in @(20,60,120,180)) {
    [IO.File]::WriteAllText(
      (Join-Path $fixtureRecovery 'last-restart-attempt.txt'),
      ([DateTime]::UtcNow.AddSeconds(-$age).ToString('o'))
    )
    try { $null = & $fixtureScript } catch {}
    $health = Get-Content -Raw (Join-Path $fixtureRecovery 'health.json') | ConvertFrom-Json
    $expected = if ($age -lt 90) { 'BACKOFF' } else { 'BLOCKED' }
    $results += [pscustomobject]@{
      age_seconds = $age
      actual = [string]$health.status
      expected = $expected
      pass = ([string]$health.status -eq $expected)
    }
  }
}
finally {
  $env:LOCALAPPDATA = $originalAppData
  Remove-Item -LiteralPath $fixtureRoot -Recurse -Force -ErrorAction SilentlyContinue
}
$passed = @($results | Where-Object {$_.pass}).Count
$failed = @($results | Where-Object {-not $_.pass}).Count
[pscustomobject]@{
  schema='EXECUTOR_OFFLINE_RECOVERY_FAST_RETRY_TEST_V1'
  pass=$passed
  fail=$failed
  cases=$results
} | ConvertTo-Json -Depth 5
if ($failed) { throw 'Isolated recovery-contract test failed' }
