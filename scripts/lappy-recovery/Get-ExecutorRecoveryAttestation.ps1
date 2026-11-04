#requires -Version 5.1
# Read-only source/task evidence. Never starts a task, process or recovery action.
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$CanonicalScriptPath,
  [Parameter(Mandatory = $true)][string]$ExpectedCanonicalSha256,
  [Parameter(Mandatory = $true)][string]$ExpectedTaskUserId,
  [string]$RuntimeRoot = (Join-Path $env:LOCALAPPDATA 'Executor')
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Get-ExecutorRecoveryAttestation {
  [CmdletBinding()]
  param(
    [string]$CanonicalScriptPath,
    [string]$ExpectedCanonicalSha256,
    [string]$ExpectedTaskUserId,
    [string]$RuntimeRoot
  )
  $name = 'Vera-Executor-ControlPlane-Recovery'
  $issues = [Collections.Generic.List[string]]::new()
  $installedScript = $null
  $checks = [ordered]@{
    canonical_source_pinned = $false
    installed_script_matches_source = $false
    exact_root_task = $false
    exact_task_principal = $false
    interactive_logon_type = $false
    limited_run_level = $false
    exact_executable = $false
    exact_arguments = $false
    exact_logon_trigger = $false
    exact_five_minute_trigger = $false
  }

  if ([string]::IsNullOrWhiteSpace($ExpectedTaskUserId)) {
    $issues.Add('EXPECTED_TASK_PRINCIPAL_UNAVAILABLE')
  }

  if ([string]::IsNullOrWhiteSpace($RuntimeRoot)) {
    $issues.Add('RUNTIME_ROOT_UNAVAILABLE')
  } else {
    try { $RuntimeRoot = [IO.Path]::GetFullPath($RuntimeRoot) }
    catch { $issues.Add('RUNTIME_ROOT_INVALID') }
  }

  if ($ExpectedCanonicalSha256 -cnotmatch '^[0-9a-f]{64}$') {
    $issues.Add('CANONICAL_SOURCE_SHA256_PIN_INVALID')
  } elseif (-not [IO.Path]::IsPathRooted($CanonicalScriptPath) -or
            -not (Test-Path -LiteralPath $CanonicalScriptPath -PathType Leaf)) {
    $issues.Add('CANONICAL_SOURCE_NOT_FOUND')
  } else {
    try {
      $canonical = Get-Item -LiteralPath $CanonicalScriptPath -ErrorAction Stop
      if (($canonical.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        $issues.Add('CANONICAL_SOURCE_REPARSE_POINT')
      } elseif ($canonical.Name -cne 'Invoke-ExecutorRecovery.ps1') {
        $issues.Add('CANONICAL_SOURCE_FILENAME_MISMATCH')
      } else {
        $actualCanonicalHash = (Get-FileHash -LiteralPath $CanonicalScriptPath -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actualCanonicalHash -cne $ExpectedCanonicalSha256) {
          $issues.Add('CANONICAL_SOURCE_PIN_MISMATCH')
        } else {
          $checks.canonical_source_pinned = $true
        }
      }
    } catch { $issues.Add('CANONICAL_SOURCE_UNREADABLE') }
  }

  if ([string]::IsNullOrWhiteSpace($RuntimeRoot) -or
      -not [IO.Path]::IsPathRooted($RuntimeRoot)) {
    $issues.Add('INSTALLED_SCRIPT_PATH_UNRESOLVED')
  } else {
    $installedScript = Join-Path $RuntimeRoot 'Recovery\Invoke-ExecutorRecovery.ps1'
    if (-not (Test-Path -LiteralPath $installedScript -PathType Leaf)) {
      $issues.Add('INSTALLED_SCRIPT_NOT_FOUND')
    } else {
      try {
        $installed = Get-Item -LiteralPath $installedScript -ErrorAction Stop
        if (($installed.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
          $issues.Add('INSTALLED_SCRIPT_REPARSE_POINT')
        } elseif ($checks.canonical_source_pinned) {
          $installedHash = (Get-FileHash -LiteralPath $installedScript -Algorithm SHA256).Hash.ToLowerInvariant()
          if ($installedHash -cne $ExpectedCanonicalSha256) {
            $issues.Add('INSTALLED_SCRIPT_SOURCE_DRIFT')
          } else {
            $checks.installed_script_matches_source = $true
          }
        } else {
          $issues.Add('INSTALLED_SCRIPT_CANNOT_COMPARE_WITH_UNPINNED_SOURCE')
        }
      } catch { $issues.Add('INSTALLED_SCRIPT_UNREADABLE') }
    }
  }

  try {
    $tasks = @(Get-ScheduledTask -TaskName $name -TaskPath '\' -ErrorAction Stop)
    if ($tasks.Count -ne 1 -or $tasks[0].TaskName -cne $name -or
        $tasks[0].TaskPath -cne '\') {
      $issues.Add('ROOT_TASK_NOT_UNIQUE_OR_IDENTITY_MISMATCH')
    } else {
      $checks.exact_root_task = $true
      $task = $tasks[0]
      if (-not [string]::IsNullOrWhiteSpace($ExpectedTaskUserId) -and
          [string]::Equals([string]$task.Principal.UserId, $ExpectedTaskUserId,
                           [StringComparison]::OrdinalIgnoreCase)) {
        $checks.exact_task_principal = $true
      } else { $issues.Add('TASK_PRINCIPAL_USER_MISMATCH') }
      if ([string]$task.Principal.LogonType -ceq 'Interactive') {
        $checks.interactive_logon_type = $true
      } else { $issues.Add('TASK_PRINCIPAL_LOGON_TYPE_MISMATCH') }
      if ([string]$task.Principal.RunLevel -ne 'Limited') {
        $issues.Add('TASK_RUN_LEVEL_NOT_LIMITED')
      } else { $checks.limited_run_level = $true }

      $actions = @($task.Actions)
      if ($actions.Count -ne 1) {
        $issues.Add('TASK_ACTION_COUNT_MISMATCH')
      } else {
        $expectedExe = Join-Path $PSHOME 'powershell.exe'
        if ([string]::Equals([string]$actions[0].Execute, $expectedExe,
                            [StringComparison]::OrdinalIgnoreCase)) {
          $checks.exact_executable = $true
        } else { $issues.Add('TASK_EXECUTABLE_MISMATCH') }

        if ($null -ne $installedScript) {
          $expectedArgs = '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $installedScript + '"'
          if ([string]$actions[0].Arguments -ceq $expectedArgs) {
            $checks.exact_arguments = $true
          } else { $issues.Add('TASK_ARGUMENTS_MISMATCH') }
        } else { $issues.Add('TASK_ARGUMENT_EXPECTATION_UNAVAILABLE') }
      }
      $triggers = @($task.Triggers)
      $logonTriggers = @($triggers | Where-Object { $_.CimClass.CimClassName -ceq 'MSFT_TaskLogonTrigger' })
      $timeTriggers = @($triggers | Where-Object { $_.CimClass.CimClassName -ceq 'MSFT_TaskTimeTrigger' })
      if ($triggers.Count -ne 2 -or $logonTriggers.Count -ne 1 -or $timeTriggers.Count -ne 1) {
        $issues.Add('TASK_TRIGGER_TOPOLOGY_MISMATCH')
      } else {
        if ($logonTriggers[0].Enabled -and
            -not [string]::IsNullOrWhiteSpace($ExpectedTaskUserId) -and
            [string]::Equals([string]$logonTriggers[0].UserId, $ExpectedTaskUserId,
                             [StringComparison]::OrdinalIgnoreCase)) {
          $checks.exact_logon_trigger = $true
        } else { $issues.Add('TASK_LOGON_TRIGGER_USER_OR_ENABLED_MISMATCH') }
        if ($timeTriggers[0].Enabled -and
            [string]$timeTriggers[0].Repetition.Interval -ceq 'PT5M') {
          $checks.exact_five_minute_trigger = $true
        } else { $issues.Add('TASK_REPETITION_TRIGGER_MISMATCH') }
      }
    }
  } catch { $issues.Add('TASK_QUERY_UNAVAILABLE') }

  [pscustomobject]@{
    schema = 'EXECUTOR_RECOVERY_SOURCE_TASK_PREFLIGHT_V1'
    status = if ($issues.Count -eq 0) { 'SOURCE_TASK_MATCH_NOT_RUNTIME_QUALIFIED' } else { 'HOLD' }
    safe_to_start = $false
    task_name = $name
    source_pin_origin = 'OPERATOR_SUPPLIED_NOT_AUTHENTICATED'
    expected_principal_origin = 'OPERATOR_SUPPLIED_NOT_AUTHENTICATED'
    ancestor_reparse_chain_verified = $false
    checks = $checks
    issues = @($issues)
  }
}

Get-ExecutorRecoveryAttestation -CanonicalScriptPath $CanonicalScriptPath `
  -ExpectedCanonicalSha256 $ExpectedCanonicalSha256 `
  -ExpectedTaskUserId $ExpectedTaskUserId -RuntimeRoot $RuntimeRoot |
  ConvertTo-Json -Depth 6
