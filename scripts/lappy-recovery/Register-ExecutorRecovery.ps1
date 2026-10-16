#requires -Version 5.1
# Installs one per-user, least-privilege health/recovery task.
[CmdletBinding()]
param([switch]$Apply)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$name='Vera-Executor-ControlPlane-Recovery'
$script=Join-Path $PSScriptRoot 'Invoke-ExecutorRecovery.ps1'
if(-not(Test-Path -LiteralPath $script -PathType Leaf)){
  throw 'Recovery script absent.'
}
$user=[Security.Principal.WindowsIdentity]::GetCurrent().Name
if([string]::IsNullOrWhiteSpace($user)){throw 'Unknown Windows user.'}
$existing=Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
if(-not $Apply){
  [pscustomobject]@{
    action='READ_ONLY_PLAN'
    task_name=$name
    user=$user
    already_exists=[bool]$existing
    repeat_interval_minutes=5
    run_level='LIMITED'
    script=$script
    local_gateway_ports='19887,19888'
    ready='NOT_QUALIFIED'
  }|ConvertTo-Json -Depth 3
  return
}
if($existing){throw 'Recovery task already exists; refusing overwrite.'}
$exe=Join-Path $PSHOME 'powershell.exe'
$arguments='-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "'+$script+'"'
$action=New-ScheduledTaskAction -Execute $exe -Argument $arguments
$logon=New-ScheduledTaskTrigger -AtLogOn -User $user
$repeat=New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
$principal=New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
$settings=New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 9) -StartWhenAvailable
Register-ScheduledTask -TaskName $name -Action $action -Trigger @($logon,$repeat) -Principal $principal -Settings $settings -Description 'Executor control-plane fail-closed restart on allowed localhost ports. Status in %LOCALAPPDATA%\Executor\Recovery\health.json.' -ErrorAction Stop | Out-Null
$check=Get-ScheduledTask -TaskName $name -ErrorAction Stop
if($check.Actions.Count -ne 1 -or $check.Actions[0].Execute -ne $exe -or $check.Actions[0].Arguments -notlike ('*'+$script+'*')){
  throw 'Task readback did not match the installed intended program.'
}
Write-Output ('TASK_INSTALLED '+$check.TaskName+' USER='+$user+' REPEATS_5_MINUTES')
Write-Output 'Not proof of working Executor: check health.json plus remote connector.'