#requires -Version 5.1
# Runs only against a synthetic task object and a disposable filesystem fixture.
[CmdletBinding()]
param([string]$SubjectPath = (Join-Path (Split-Path -Parent $PSScriptRoot) 'lappy-recovery\Get-ExecutorRecoveryAttestation.ps1'))
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if (-not (Test-Path -LiteralPath $SubjectPath -PathType Leaf)) {
  throw 'Attestation source file not found.'
}
$scratch = Join-Path $env:TEMP ('executor-recovery-attestation-' + [guid]::NewGuid().ToString('N'))
$runtime = Join-Path $scratch 'Executor'
$recovery = Join-Path $runtime 'Recovery'
$canonicalDir = Join-Path $scratch 'source'
$canonical = Join-Path $canonicalDir 'Invoke-ExecutorRecovery.ps1'
$installed = Join-Path $recovery 'Invoke-ExecutorRecovery.ps1'
$taskName = 'Vera-Executor-ControlPlane-Recovery'
$script:fakeTasks = @()

function Get-ScheduledTask {
  [CmdletBinding()]
  param([string]$TaskName, [string]$TaskPath)
  if ($TaskName -cne $script:taskName -or $TaskPath -cne '\') {
    throw 'Attestation attempted to query a different scheduler subject.'
  }
  return $script:fakeTasks
}

function Run-Fixture([string]$pin) {
  & $SubjectPath -CanonicalScriptPath $canonical `
    -ExpectedCanonicalSha256 $pin -RuntimeRoot $runtime |
    Out-String | ConvertFrom-Json
}

function Assert-Issue([object]$report, [string]$issue) {
  if ($report.status -ne 'HOLD' -or $report.safe_to_start -ne $false) {
    throw ("Expected fail-closed HOLD for $issue")
  }
  if (@($report.issues) -cnotcontains $issue) {
    throw ("Missing expected issue $issue; found: " + (@($report.issues) -join ', '))
  }
  Write-Output ("PASS $issue")
}

try {
  New-Item -ItemType Directory -Force -Path $recovery, $canonicalDir | Out-Null
  [IO.File]::WriteAllText($canonical, '# synthetic canonical recovery script')
  Copy-Item -LiteralPath $canonical -Destination $installed
  $pin = (Get-FileHash -LiteralPath $canonical -Algorithm SHA256).Hash.ToLowerInvariant()
  $expectedArgs = '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $installed + '"'
  $task = [pscustomobject]@{
    TaskName = $taskName
    TaskPath = '\'
    Principal = [pscustomobject]@{RunLevel='Limited'}
    Actions = @([pscustomobject]@{
      Execute = (Join-Path $PSHOME 'powershell.exe')
      Arguments = $expectedArgs
    })
  }
  $script:fakeTasks = @($task)

  $ok = Run-Fixture $pin
  if ($ok.status -ne 'SOURCE_TASK_MATCH_NOT_RUNTIME_QUALIFIED' -or
      $ok.safe_to_start -ne $false -or @($ok.issues).Count -ne 0) {
    throw ('Expected exact synthetic source/task agreement without runtime qualification. Actual: ' + ($ok | ConvertTo-Json -Depth 6 -Compress))
  }
  Write-Output 'PASS exact source/task fixture remains NOT_RUNTIME_QUALIFIED'

  $task.Principal.RunLevel = 'Highest'
  Assert-Issue (Run-Fixture $pin) 'TASK_RUN_LEVEL_NOT_LIMITED'
  $task.Principal.RunLevel = 'Limited'

  $task.Actions[0].Execute = 'C:\Untrusted\powershell.exe'
  Assert-Issue (Run-Fixture $pin) 'TASK_EXECUTABLE_MISMATCH'
  $task.Actions[0].Execute = Join-Path $PSHOME 'powershell.exe'

  $task.Actions[0].Arguments = '-NoProfile -Command whoami'
  Assert-Issue (Run-Fixture $pin) 'TASK_ARGUMENTS_MISMATCH'
  $task.Actions[0].Arguments = $expectedArgs

  $task.TaskPath = '\Unexpected\'
  Assert-Issue (Run-Fixture $pin) 'ROOT_TASK_NOT_UNIQUE_OR_IDENTITY_MISMATCH'
  $task.TaskPath = '\'

  $script:fakeTasks = @($task, $task)
  Assert-Issue (Run-Fixture $pin) 'ROOT_TASK_NOT_UNIQUE_OR_IDENTITY_MISMATCH'
  $script:fakeTasks = @($task)

  [IO.File]::AppendAllText($installed, 'tampered')
  Assert-Issue (Run-Fixture $pin) 'INSTALLED_SCRIPT_SOURCE_DRIFT'
  Copy-Item -LiteralPath $canonical -Destination $installed -Force

  Assert-Issue (Run-Fixture ('a'*64)) 'CANONICAL_SOURCE_PIN_MISMATCH'
  Assert-Issue (Run-Fixture 'not-a-sha') 'CANONICAL_SOURCE_SHA256_PIN_INVALID'

  $script:fakeTasks = @()
  Assert-Issue (Run-Fixture $pin) 'ROOT_TASK_NOT_UNIQUE_OR_IDENTITY_MISMATCH'
} finally {
  if (Test-Path -LiteralPath $scratch) {
    Remove-Item -LiteralPath $scratch -Recurse -Force
  }
}
