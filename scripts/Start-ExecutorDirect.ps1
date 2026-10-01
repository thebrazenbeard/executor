param(
 [string]$RuntimeRoot=(Join-Path $env:LOCALAPPDATA "Executor"),
 [string]$OpenAITunnelCredentialsFile="",
 [string]$PublicHost="",
 [int]$PublicPort=9443,
 [string]$DeviceId="",
 [string]$ProfilePath=(Join-Path $PSScriptRoot "..\deploy\tunnel-client.executor.example.yaml"),
 [string]$TunnelClient="tunnel-client"
)
$ErrorActionPreference="Stop";Set-StrictMode -Version Latest
$StatePath=Join-Path $RuntimeRoot "direct-state.json";$LogRoot=Join-Path $RuntimeRoot "logs";$CaddyRoot=Join-Path $RuntimeRoot "caddy";$CaddyDataHome=Join-Path $CaddyRoot "data";$CaddyConfigHome=Join-Path $CaddyRoot "config";$Caddyfile=Join-Path $CaddyRoot "Caddyfile"
New-Item -ItemType Directory -Force -Path $RuntimeRoot,$LogRoot,$CaddyRoot,$CaddyDataHome,$CaddyConfigHome|Out-Null
function NV([string[]]$L,[int]$I,[string]$V){if($V){return $V.Trim()};for($j=$I+1;$j-lt$L.Count;$j++){if($L[$j].Trim()){return $L[$j].Trim()}};return ""}
function RK([string]$P){if(-not(Test-Path $P)){throw "credential file not found"};$l=@(Get-Content -Encoding UTF8 $P);$i="";$s="";for($j=0;$j-lt$l.Count;$j++){$x=[string]$l[$j];if($x-match'^\s*tunnel[_\s-]*id\s*:\s*(.*)$'){$i=NV $l $j $Matches[1]};if($x-match'^\s*(api[_\s-]*)?secret([_\s-]*key)?\s*:\s*(.*)$'){$s=NV $l $j $Matches[3]}};return @{id=$i;secret=$s}}
function RS{$b=New-Object byte[] 32;$r=[Security.Cryptography.RandomNumberGenerator]::Create();try{$r.GetBytes($b)}finally{$r.Dispose()};return [Convert]::ToBase64String($b).TrimEnd("=").Replace("+","-").Replace("/","_")}
function W([scriptblock]$P,[int]$S,[string]$F){$d=[DateTime]::UtcNow.AddSeconds($S);do{try{if(&$P){return}}catch{};Start-Sleep -Milliseconds 500}while([DateTime]::UtcNow-lt$d);throw $F}
function SP([int]$I,[string]$N){if($I-le0){return};$p=Get-CimInstance Win32_Process -Filter "ProcessId = $I" -ErrorAction SilentlyContinue;if(-not$p){return};if([string]$p.CommandLine-notlike"*$N*"){throw "PID identity mismatch"};Stop-Process -Id $I -Force}
if(Test-Path $StatePath){&(Join-Path $PSScriptRoot "Stop-ExecutorDirect.ps1") -RuntimeRoot $RuntimeRoot}
$id=$env:EXECUTOR_TUNNEL_ID;$sec=$env:EXECUTOR_TUNNEL_API_SECRET;if((!$id-or!$sec)-and$OpenAITunnelCredentialsFile){$k=RK $OpenAITunnelCredentialsFile;if(!$id){$id=[string]$k.id};if(!$sec){$sec=[string]$k.secret}};if(!$id-or!$sec){throw "OpenAI tunnel credentials are required"}
$client=$env:EXECUTOR_CLIENT_TOKEN;if(!$client){$client=RS};if(!$PublicHost){$PublicHost=([string](Invoke-RestMethod -UseBasicParsing -Uri "https://api.ipify.org")).Trim()}
$pi=$null;if(-not[Net.IPAddress]::TryParse($PublicHost,[ref]$pi)-and[Uri]::CheckHostName($PublicHost)-eq[UriHostNameType]::Unknown){throw "PublicHost must be IP or hostname"};if($pi-and$pi.AddressFamily-ne[Net.Sockets.AddressFamily]::InterNetwork){throw "direct V1 supports public IPv4 only"};if($PublicPort-lt1-or$PublicPort-gt65535){throw "PublicPort invalid"}
$oi=$env:EXECUTOR_TUNNEL_ID;$os=$env:EXECUTOR_TUNNEL_API_SECRET;$oc=$env:EXECUTOR_CLIENT_TOKEN;$od=$env:XDG_DATA_HOME;$og=$env:XDG_CONFIG_HOME;$caddy=$null;$fw=$false;$upnp=$false;$fwName="Executor Direct $PublicPort"
try{
 $env:EXECUTOR_TUNNEL_ID=$id;$env:EXECUTOR_TUNNEL_API_SECRET=$sec;$env:EXECUTOR_CLIENT_TOKEN=$client;&(Join-Path $PSScriptRoot "Start-ExecutorControlPlane.ps1") -RuntimeRoot $RuntimeRoot -ProfilePath $ProfilePath -TunnelClient $TunnelClient
 $ins=(&(Join-Path $PSScriptRoot "Install-ExecutorCaddy.ps1") -RuntimeRoot $RuntimeRoot|Out-String|ConvertFrom-Json);$ce=[string]$ins.path;$dp=if($env:EXECUTOR_DEVICE_PORT){[int]$env:EXECUTOR_DEVICE_PORT}else{8788};$site=("https://{0}:{1}" -f $PublicHost,$PublicPort)
 @"
{
 admin off
 auto_https disable_redirects
}
$site {
 tls internal
 @executorDevice path /device /health
 handle @executorDevice {
  reverse_proxy 127.0.0.1:$dp
 }
 respond 404
}
"@|Set-Content -Encoding UTF8 $Caddyfile
 try{if(-not(Get-NetFirewallRule -DisplayName $fwName -ErrorAction SilentlyContinue)){New-NetFirewallRule -DisplayName $fwName -Direction Inbound -Action Allow -Protocol TCP -LocalPort $PublicPort -Profile Any|Out-Null;$fw=$true}}catch{Write-Warning "Windows Firewall rule could not be created automatically"}
 $lip="";try{$cfg=Get-NetIPConfiguration|Where-Object{$_.IPv4DefaultGateway-and$_.NetAdapter.Status-eq"Up"}|Select-Object -First 1;if($cfg){$lip=[string]$cfg.IPv4Address.IPAddress};if($lip){$maps=(New-Object -ComObject HNetCfg.NATUPnP).StaticPortMappingCollection;if($maps){[void]$maps.Add($PublicPort,"TCP",$PublicPort,$lip,$true,"Executor Direct");$upnp=$true}}}catch{Write-Warning "UPnP unavailable; manual forwarding may be required"}
 $env:XDG_DATA_HOME=$CaddyDataHome;$env:XDG_CONFIG_HOME=$CaddyConfigHome;$co=Join-Path $LogRoot "caddy-direct.out.log";$cr=Join-Path $LogRoot "caddy-direct.err.log";Remove-Item $co,$cr -Force -ErrorAction SilentlyContinue;$caddy=Start-Process -FilePath $ce -ArgumentList @("run","--config",$Caddyfile,"--adapter","caddyfile") -PassThru -WindowStyle Hidden -RedirectStandardOutput $co -RedirectStandardError $cr
 $root=Join-Path $CaddyDataHome "caddy\pki\authorities\local\root.crt";W {Test-Path $root} 30 "Caddy root CA was not provisioned";$curl=(Get-Command curl.exe -ErrorAction Stop).Source;$resolve=("{0}:{1}:127.0.0.1" -f $PublicHost,$PublicPort);$body=&$curl --silent --show-error --fail --cacert $root --resolve $resolve ($site+"/health");if($LASTEXITCODE-ne0){throw "local TLS probe failed"};$h=$body|ConvertFrom-Json;if($h.role-ne"device-ingress"){throw "route mismatch"}
 [pscustomobject]@{schema="EXECUTOR_DIRECT_RUNTIME_V1";caddy_pid=$caddy.Id;public_device_url=$site;public_host=$PublicHost;public_port=$PublicPort;local_device_port=$dp;ca_certificate_path=$root;caddy_config_path=$Caddyfile;caddy_data_home=$CaddyDataHome;firewall_rule_name=$fwName;firewall_rule_created=$fw;upnp_mapping_created=$upnp;local_lan_ip=$lip;credential_file=if($OpenAITunnelCredentialsFile){$OpenAITunnelCredentialsFile}else{$null};started_utc=[DateTime]::UtcNow.ToString("o")}|ConvertTo-Json -Depth 5|Set-Content -Encoding UTF8 $StatePath
 Write-Host "EXECUTOR DIRECT INGRESS READY";Write-Host "Device endpoint: $site";Write-Host "CA certificate: $root";Write-Host "No traffic relay is in the device path.";if($upnp){Write-Host "UPnP TCP mapping created."}else{Write-Warning "Forward TCP $PublicPort to $lip manually if required."};if($DeviceId){&(Join-Path $PSScriptRoot "New-ExecutorDeviceEnrollment.ps1") -DeviceId $DeviceId -DeviceServiceUrl $site -CaCertificatePath $root}
}catch{if($caddy){try{SP $caddy.Id "caddy"}catch{}};try{&(Join-Path $PSScriptRoot "Stop-ExecutorControlPlane.ps1") -RuntimeRoot $RuntimeRoot}catch{};if($fw){Remove-NetFirewallRule -DisplayName $fwName -ErrorAction SilentlyContinue};throw}
finally{$env:EXECUTOR_TUNNEL_ID=$oi;$env:EXECUTOR_TUNNEL_API_SECRET=$os;$env:EXECUTOR_CLIENT_TOKEN=$oc;$env:XDG_DATA_HOME=$od;$env:XDG_CONFIG_HOME=$og;$sec=$null;$client=$null}
