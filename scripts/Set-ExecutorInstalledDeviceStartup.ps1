param(
 [string]$RuntimeRoot=(Join-Path $env:LOCALAPPDATA 'Executor'),
 [string]$TaskName='',
 [switch]$AtStartup,
 [System.Management.Automation.PSCredential]$Credential,
 [switch]$DryRun
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
if($AtStartup -and -not $Credential){throw 'AtStartup requires the current Windows account credential'}
if($Credential -and -not $AtStartup){throw 'Credential is accepted only with AtStartup'}
$user=[Security.Principal.WindowsIdentity]::GetCurrent()
if($Credential) {
 $sid=(New-Object Security.Principal.NTAccount($Credential.UserName)).Translate([Security.Principal.SecurityIdentifier])
 if($sid.Value -ne $user.User.Value){throw 'Credential must identify the current account that owns the DPAPI device token'}
}
$config=Get-Content -LiteralPath (Join-Path $RuntimeRoot 'device.json') -Raw|ConvertFrom-Json
if($config.schema -ne 'EXECUTOR_INSTALLED_DEVICE_V1'){throw 'Unsupported Executor installed-device config schema'}
if(-not $TaskName){$TaskName=[string]$config.task_name}
$launcher=Join-Path ([string]$config.agent_root) 'scripts\Start-ExecutorInstalledDevice.ps1'
if(-not(Test-Path -LiteralPath $launcher -PathType Leaf)){throw 'Installed Executor launcher is missing'}
$plan=[pscustomobject]@{
 task_name=$TaskName;user=$user.Name
 mode=$(if($AtStartup){'boot-and-logon'}else{'logon'})
 logon_type=$(if($AtStartup){'Password'}else{'Interactive'})
 execution_time_limit='PT0S';restart_count=3;restart_interval='PT1M'
}
if($DryRun){$plan|ConvertTo-Json -Compress;return}
$action=New-ScheduledTaskAction -Execute (Get-Command powershell.exe -ErrorAction Stop).Source -Argument ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "'+$launcher+'" -RuntimeRoot "'+$RuntimeRoot+'"')
$triggers=@(New-ScheduledTaskTrigger -AtLogOn -User $user.Name)
if($AtStartup){$triggers=@((New-ScheduledTaskTrigger -AtStartup))+$triggers}
$settings=New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Seconds 0) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew -StartWhenAvailable -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries
$existing=Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if($existing) {
 $backup=Join-Path $RuntimeRoot 'startup-backups'
 New-Item -ItemType Directory -Force $backup|Out-Null
 Export-ScheduledTask -TaskName $TaskName|Set-Content -Encoding Unicode (Join-Path $backup ([datetime]::UtcNow.ToString('yyyyMMdd-HHmmssfff')+'.xml'))
}
try {
 if($AtStartup) {
  $password=$Credential.GetNetworkCredential().Password
  if($existing){Set-ScheduledTask -TaskName $TaskName -Action $action -Trigger $triggers -Settings $settings -User $Credential.UserName -Password $password|Out-Null}
  else{Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $triggers -Settings $settings -User $Credential.UserName -Password $password|Out-Null}
 } else {
  $principal=New-ScheduledTaskPrincipal -UserId $user.Name -LogonType Interactive -RunLevel Limited
  if($existing){Set-ScheduledTask -TaskName $TaskName -Action $action -Trigger $triggers -Settings $settings -Principal $principal|Out-Null}
  else{Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $triggers -Settings $settings -Principal $principal|Out-Null}
 }
} finally {$password=$null}
$plan|ConvertTo-Json -Compress
