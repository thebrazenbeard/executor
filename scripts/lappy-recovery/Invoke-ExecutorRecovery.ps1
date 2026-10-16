#requires -Version 5.1
# Local Executor repair V1: port migration, bounded retries, existing identity.
[CmdletBinding()]
param([switch]$ProbeOnly)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$runtime=Join-Path $env:LOCALAPPDATA 'Executor'
$repair=Join-Path $runtime 'Recovery'
$credential=Join-Path $repair 'tunnel-credentials.dpapi.json'
$statusFile=Join-Path $repair 'health.json'
$stampFile=Join-Path $repair 'last-restart-attempt.txt'
$scriptRoot=Join-Path $runtime 'Agent\scripts'
$mutex=New-Object System.Threading.Mutex($false,'Local\VeraExecutorControlPlaneRecoveryV1')
$locked=$false
function Write-Status([string]$state,[string]$reason) {
  $data=[ordered]@{
    schema='VERA_EXECUTOR_RECOVERY_V1'
    time_utc=[DateTime]::UtcNow.ToString('o')
    status=$state
    reason=$reason
    local_mcp_port=19887
    local_device_port=19888
    existing_local_tls_port=9443
    tunnel_credential_present=(Test-Path -LiteralPath $credential -PathType Leaf)
    chatgpt_connector_verified=$false
  }
  $tmp=Join-Path $repair ('health.'+[Guid]::NewGuid().ToString('N')+'.tmp')
  $data|ConvertTo-Json -Depth 4|Set-Content -Encoding UTF8 -LiteralPath $tmp
  Move-Item -LiteralPath $tmp -Destination $statusFile -Force
  $data|ConvertTo-Json -Depth 4
  if((-not $ProbeOnly) -and $state -ne 'LOCAL_READY') {throw ('EXECUTOR_NOT_READY_'+$state)}
}
function Is-PortOpen([int]$port) {
  $client=New-Object Net.Sockets.TcpClient
  try {
    $pending=$client.BeginConnect('127.0.0.1',$port,$null,$null)
    if(-not $pending.AsyncWaitHandle.WaitOne(800)){return $false}
    $client.EndConnect($pending)
    return $client.Connected
  }catch {return $false}
  finally {$client.Close()}
}
function Direct-Status {
  $script=Join-Path $scriptRoot 'Get-ExecutorDirectStatus.ps1'
  if(-not(Test-Path -LiteralPath $script)){return $false}
  try {
    $obj=(& $script -RuntimeRoot $runtime|Out-String|ConvertFrom-Json)
    return ($obj.running -eq $true)
  } catch {return $false}
}
function Unseal([string]$cipher) {
  $secure=ConvertTo-SecureString -String $cipher -ErrorAction Stop
  $ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)}
  finally {[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr);$secure.Dispose()}
}
try {
  try{$locked=$mutex.WaitOne(0)}catch [System.Threading.AbandonedMutexException]{$locked=$true}
  if(-not $locked) {Write-Output 'ANOTHER_EXECUTOR_RECOVERY_RUNNING';return}
  if((Direct-Status) -and (Is-PortOpen 19887) -and (Is-PortOpen 19888) -and (Is-PortOpen 9443)) {
    Write-Status 'LOCAL_READY' 'LOCAL_COMPONENTS_UP_CLOUD_REQUIRES_INDEPENDENT_CHECK'
    return
  }
  if($ProbeOnly) {
    Write-Status 'NOT_READY' 'READ_ONLY_PROBE_NO_START'
    return
  }
  if(-not(Test-Path -LiteralPath $credential -PathType Leaf)){
    Write-Status 'WAITING_CREDENTIALS' 'LOCAL_DPAPI_TUNNEL_AUTH_NOT_PROVISIONED'
    return
  }
  if(Test-Path -LiteralPath $stampFile -PathType Leaf){
    $last=[DateTime]::MinValue
    if([DateTime]::TryParse((Get-Content -Raw -LiteralPath $stampFile),[ref]$last)) {
      if([DateTime]::UtcNow.Subtract($last.ToUniversalTime()).TotalMinutes -lt 15){
        Write-Status 'BACKOFF' 'PRIOR_ATTEMPT_WITHIN_15_MINUTES'
        return
      }
    }
  }
  foreach($candidate in @('Start-ExecutorDirect.ps1','Get-ExecutorDirectStatus.ps1')){
    if(-not(Test-Path -LiteralPath (Join-Path $scriptRoot $candidate) -PathType Leaf)){
      Write-Status 'BLOCKED' 'INSTALLED_EXECUTOR_SCRIPT_MISSING'
      return
    }
  }
  $clientExe=Join-Path $runtime 'tools\tunnel-client.exe'
  if(-not(Test-Path -LiteralPath $clientExe -PathType Leaf)){
    Write-Status 'BLOCKED' 'INSTALLED_TUNNEL_CLIENT_MISSING'
    return
  }
  if(-not(Get-NetFirewallRule -DisplayName 'Executor Direct 9443' -ErrorAction SilentlyContinue)){
    Write-Status 'BLOCKED' 'EXISTING_TLS_FIREWALL_RULE_NOT_PRESENT'
    return
  }
  $data=Get-Content -Raw -LiteralPath $credential|ConvertFrom-Json
  if($data.schema -ne 'VERA_EXECUTOR_TUNNEL_DPAPI_V1'){
    Write-Status 'BLOCKED' 'UNKNOWN_ENCRYPTED_CREDENTIAL_SCHEMA'
    return
  }
  $prev=@{}
  foreach($n in @('EXECUTOR_TUNNEL_ID','EXECUTOR_TUNNEL_API_SECRET','EXECUTOR_CLIENT_TOKEN')){
    $prev[$n]=[Environment]::GetEnvironmentVariable($n)
  }
  try {
    $env:EXECUTOR_TUNNEL_ID=Unseal ([string]$data.tunnel_id_dpapi)
    $env:EXECUTOR_TUNNEL_API_SECRET=Unseal ([string]$data.tunnel_secret_dpapi)
    $env:EXECUTOR_CLIENT_TOKEN=Unseal ([string]$data.client_token_dpapi)
    if(-not $env:EXECUTOR_TUNNEL_ID -or -not $env:EXECUTOR_TUNNEL_API_SECRET -or -not $env:EXECUTOR_CLIENT_TOKEN){
      throw 'INCOMPLETE_DPAPI_RECORD'
    }
    [DateTime]::UtcNow.ToString('o')|Set-Content -Encoding ASCII -LiteralPath $stampFile
    & (Join-Path $scriptRoot 'Start-ExecutorDirect.ps1') -RuntimeRoot $runtime -PublicHost '127.0.0.1' -TlsServerName 'executor-device.invalid' -PublicPort 9443 -McpPort 19887 -DevicePort 19888 -PortMappingMode 'Manual' -TunnelClient $clientExe | Out-Null
    if((Direct-Status) -and (Is-PortOpen 19887) -and (Is-PortOpen 19888) -and (Is-PortOpen 9443)){
      # A successful startup must not rate-limit a later independent outage.
      Remove-Item -LiteralPath $stampFile -Force -ErrorAction SilentlyContinue
      Write-Status 'LOCAL_READY' 'LOCAL_RESTART_SUCCESS_VERIFY_CLOUD_AND_DEVICE_SEPARATELY'
    } else {
      Write-Status 'NOT_READY' 'COMPONENTS_FAILED_POST_START_READBACK'
    }
  }catch{
    # Error details may contain credentials: never serialize the exception.
    Write-Status 'START_FAILED' 'CHECK_LOCAL_EXECUTOR_LOGS_NO_SECRET_OUTPUT'
  }finally{
    foreach($n in $prev.Keys){[Environment]::SetEnvironmentVariable($n,$prev[$n])}
    $data=$null
  }
}finally{
  if($locked){try{$mutex.ReleaseMutex()}catch{}}
  $mutex.Dispose()
}