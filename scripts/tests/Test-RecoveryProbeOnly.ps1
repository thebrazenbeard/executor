#requires -Version 5.1
# This test intentionally uses a synthetic LOCALAPPDATA. Never invoke on a
# production runtime root or use real recovery credentials.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$invokeScript = Join-Path (Split-Path -Parent $PSScriptRoot) 'lappy-recovery\Invoke-ExecutorRecovery.ps1'
if (-not (Test-Path -LiteralPath $invokeScript -PathType Leaf)) { throw 'Recovery source script absent.' }

$fixtureRoot = Join-Path $env:TEMP ('executor-recovery-probe-' + [guid]::NewGuid().ToString('N'))
$originalLocalAppData = $env:LOCALAPPDATA
$runtimeRoot = Join-Path $fixtureRoot 'Executor'
$repair = Join-Path $runtimeRoot 'Recovery'
$agentScripts = Join-Path $runtimeRoot 'Agent\scripts'
$health = Join-Path $repair 'health.json'
$cooldown = Join-Path $repair 'last-restart-attempt.txt'
$fakeDirect = Join-Path $agentScripts 'Get-ExecutorDirectStatus.ps1'
$listeners = @()

function Assert-ProbePreservesState([string]$expectedState, [string]$caseName) {
  $healthBefore = [Convert]::ToBase64String([IO.File]::ReadAllBytes($health))
  $cooldownBefore = [Convert]::ToBase64String([IO.File]::ReadAllBytes($cooldown))
  $response = (& $invokeScript -ProbeOnly | Out-String | ConvertFrom-Json)
  if ($response.status -ne $expectedState) {
    throw ("$caseName expected $expectedState, observed $($response.status)")
  }
  if ($healthBefore -cne [Convert]::ToBase64String([IO.File]::ReadAllBytes($health))) {
    throw ("$caseName -ProbeOnly overwrote health.json")
  }
  if ($cooldownBefore -cne [Convert]::ToBase64String([IO.File]::ReadAllBytes($cooldown))) {
    throw ("$caseName -ProbeOnly changed cooldown marker")
  }
  $unexpected = @(Get-ChildItem -LiteralPath $repair -Filter 'health.*.tmp' -File -ErrorAction SilentlyContinue)
  if ($unexpected.Count -ne 0) { throw ("$caseName left transient status files") }
  Write-Output ("PASS $caseName persisted recovery state unchanged")
}

try {
  New-Item -ItemType Directory -Force -Path $repair, $agentScripts | Out-Null
  $env:LOCALAPPDATA = $fixtureRoot
  [IO.File]::WriteAllText($health, 'EXISTING_HEALTH_SENTINEL')
  [IO.File]::WriteAllText($cooldown, 'EXISTING_COOLDOWN_SENTINEL')

  # An unhealthy local status returns without entering any credential/start path.
  Set-Content -LiteralPath $fakeDirect -Encoding ASCII -Value 'param([string]$RuntimeRoot); Write-Output ''{"running":false}'''
  Assert-ProbePreservesState 'NOT_READY' 'NOT_READY'

  # A healthy local status must not erase the cooldown or write health either.
  Set-Content -LiteralPath $fakeDirect -Encoding ASCII -Value 'param([string]$RuntimeRoot); Write-Output ''{"running":true}'''
  foreach ($port in @(19887,19888,9443)) {
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, [int]$port)
    $listener.Start()
    $listeners += $listener
  }
  Assert-ProbePreservesState 'LOCAL_READY' 'LOCAL_READY'

  # A new installation with no prior status must stay without one in probe mode.
  Remove-Item -LiteralPath $health -Force
  $response = (& $invokeScript -ProbeOnly | Out-String | ConvertFrom-Json)
  if ($response.status -ne 'LOCAL_READY') { throw 'Healthy probe did not return LOCAL_READY.' }
  if (Test-Path -LiteralPath $health) { throw '-ProbeOnly created a previously absent health.json.' }
  Write-Output 'PASS absent status stays absent under -ProbeOnly'
} finally {
  foreach ($listener in $listeners) { try { $listener.Stop() } catch {} }
  $env:LOCALAPPDATA = $originalLocalAppData
  if (Test-Path -LiteralPath $fixtureRoot) {
    Remove-Item -LiteralPath $fixtureRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}
