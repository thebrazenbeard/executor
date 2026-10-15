#requires -Version 5.1
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$PublishDir,
  [Parameter(Mandatory=$true)][string]$VersionId,
  [switch]$Apply
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($VersionId -notmatch '^[0-9]{8}-[0-9a-f]{7}$') { throw 'Invalid immutable version ID' }
$source = Join-Path $PublishDir 'ExecutorKeeper.exe'
if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw 'Published executable missing' }
$targetDir = Join-Path $env:LOCALAPPDATA ('ExecutorKeeper\' + $VersionId)
$target = Join-Path $targetDir 'ExecutorKeeper.exe'
$taskName = 'Executor Keeper Tray'
$desktop = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Executor Keeper.lnk'
if (Test-Path $targetDir) { throw 'Immutable version directory already exists' }
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) { throw 'Keeper task already exists' }
if (Test-Path $desktop) { throw 'Keeper shortcut already exists' }
$user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
if (-not $Apply) {
  [pscustomobject]@{mode='PLAN_ONLY'; user=$user; target=$target; task=$taskName;
    shortcut=$desktop; modifies_existing_executor=$false; modifies_portal=$false
  } | ConvertTo-Json
  return
}
New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
$registered = $false
try {
  # Framework-dependent publishing requires the managed DLL and runtimeconfig
  # beside the Windows executable; copy and hash-verify the complete package.
  $packageFiles = @(Get-ChildItem -LiteralPath $PublishDir -File)
  if (@($packageFiles | Where-Object Name -eq 'ExecutorKeeper.dll').Count -ne 1 -or
      @($packageFiles | Where-Object Name -eq 'ExecutorKeeper.runtimeconfig.json').Count -ne 1) {
    throw 'Incomplete .NET Windows package'
  }
  foreach ($file in $packageFiles) {
    Copy-Item -LiteralPath $file.FullName -Destination (Join-Path $targetDir $file.Name) -ErrorAction Stop
    $actual = Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $targetDir $file.Name)
    $expected = Get-FileHash -Algorithm SHA256 -LiteralPath $file.FullName
    if ($expected.Hash -ne $actual.Hash) { throw ('Package file mismatch: ' + $file.Name) }
  }
  $to = (Get-FileHash -Algorithm SHA256 -LiteralPath $target).Hash
  $action = New-ScheduledTaskAction -Execute $target
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
  $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Executor Keeper per-user tray; monitor existing recovery without credentials or PORTAL changes' | Out-Null
  $registered = $true
  $wsh = New-Object -ComObject WScript.Shell
  $link = $wsh.CreateShortcut($desktop)
  $link.TargetPath = $target
  $link.WorkingDirectory = $targetDir
  $link.Description = 'Executor Keeper - local health and existing recovery'
  $link.Save()
  $check = $wsh.CreateShortcut($desktop)
  $task = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
  if ($check.TargetPath -ne $target -or $task.Actions.Count -ne 1 -or
      $task.Actions[0].Execute -ne $target -or
      $task.Principal.LogonType -ne 'Interactive') {
    throw 'Launcher or task readback mismatch'
  }
  [pscustomobject]@{state='INSTALLED_TASK_CONFIGURED';target=$target;
    task=$taskName;shortcut=$desktop;sha256=$to;
    actual_logon_verified=$false;portal_changed=$false} | ConvertTo-Json
}
catch {
  if ($registered) { Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue }
  Remove-Item -LiteralPath $desktop -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $targetDir -Recurse -Force -ErrorAction SilentlyContinue
  throw
}