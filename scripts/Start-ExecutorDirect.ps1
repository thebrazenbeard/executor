param(
  [string]$RuntimeRoot = (Join-Path $env:LOCALAPPDATA "Executor"),
  [string]$OpenAITunnelCredentialsFile = "",
  [string]$PublicHost = "",
  [int]$PublicPort = 9443,
  [int]$McpPort = 18887,
  [int]$DevicePort = 18888,
  [string]$DeviceId = "",
  [switch]$InstallLocalDevice,
  [string]$ProfilePath = "",
  [string]$TunnelClient = "tunnel-client"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$StatePath = Join-Path $RuntimeRoot "direct-state.json"
$LogRoot = Join-Path $RuntimeRoot "logs"
$CaddyRoot = Join-Path $RuntimeRoot "caddy"
$CaddyDataHome = Join-Path $CaddyRoot "data"
$CaddyConfigHome = Join-Path $CaddyRoot "config"
$Caddyfile = Join-Path $CaddyRoot "Caddyfile"
$GeneratedProfilePath = Join-Path $RuntimeRoot "direct-tunnel-profile.yaml"

New-Item -ItemType Directory -Force -Path $RuntimeRoot,$LogRoot,$CaddyRoot,$CaddyDataHome,$CaddyConfigHome | Out-Null

function Read-NextValue([string[]]$Lines,[int]$Index,[string]$Inline) {
  if (-not [string]::IsNullOrWhiteSpace($Inline)) { return $Inline.Trim() }
  for ($i = $Index + 1; $i -lt $Lines.Count; $i++) {
    $candidate = $Lines[$i].Trim()
    if (-not [string]::IsNullOrWhiteSpace($candidate)) { return $candidate }
  }
  return ""
}

function Read-TunnelCredentials([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "credential file not found: $Path" }
  $lines = @(Get-Content -LiteralPath $Path -Encoding UTF8)
  $id = ""
  $secret = ""
  for ($i = 0; $i -lt $lines.Count; $i++) {
    $line = [string]$lines[$i]
    if ($line -match '^\s*tunnel[_\s-]*id\s*:\s*(.*)$') {
      $id = Read-NextValue $lines $i $Matches[1]
    }
    elseif ($line -match '^\s*(api[_\s-]*)?secret([_\s-]*key)?\s*:\s*(.*)$') {
      $secret = Read-NextValue $lines $i $Matches[3]
    }
  }
  return @{ id = $id; secret = $secret }
}

function New-RandomSecret {
  $bytes = New-Object byte[] 32
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  return [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+","-").Replace("/","_")
}

function Wait-Until([scriptblock]$Probe,[int]$Seconds,[string]$Failure) {
  $deadline = [DateTime]::UtcNow.AddSeconds($Seconds)
  do {
    try { if (& $Probe) { return } } catch {}
    Start-Sleep -Milliseconds 500
  } while ([DateTime]::UtcNow -lt $deadline)
  throw $Failure
}

function Stop-RecordedProcess([int]$ProcessId,[string]$CommandNeedle) {
  if ($ProcessId -le 0) { return }
  $record = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
  if (-not $record) { return }
  if ([string]$record.CommandLine -notlike "*$CommandNeedle*") { throw "PID identity mismatch" }
  Stop-Process -Id $ProcessId -Force
}

foreach ($port in @($PublicPort,$McpPort,$DevicePort)) {
  if ($port -lt 1 -or $port -gt 65535) { throw "all Executor ports must be between 1 and 65535" }
}
if (($PublicPort -eq $McpPort) -or ($PublicPort -eq $DevicePort) -or ($McpPort -eq $DevicePort)) {
  throw "PublicPort, McpPort, and DevicePort must be distinct"
}

if (Test-Path -LiteralPath $StatePath -PathType Leaf) {
  & (Join-Path $PSScriptRoot "Stop-ExecutorDirect.ps1") -RuntimeRoot $RuntimeRoot
}

$tunnelId = [Environment]::GetEnvironmentVariable("EXECUTOR_TUNNEL_ID")
$tunnelSecret = [Environment]::GetEnvironmentVariable("EXECUTOR_TUNNEL_API_SECRET")
if (([string]::IsNullOrWhiteSpace($tunnelId) -or [string]::IsNullOrWhiteSpace($tunnelSecret)) -and -not [string]::IsNullOrWhiteSpace($OpenAITunnelCredentialsFile)) {
  $credentials = Read-TunnelCredentials $OpenAITunnelCredentialsFile
  if ([string]::IsNullOrWhiteSpace($tunnelId)) { $tunnelId = [string]$credentials.id }
  if ([string]::IsNullOrWhiteSpace($tunnelSecret)) { $tunnelSecret = [string]$credentials.secret }
}
if ([string]::IsNullOrWhiteSpace($tunnelId) -or [string]::IsNullOrWhiteSpace($tunnelSecret)) {
  throw "OpenAI tunnel credentials are required"
}

$clientToken = [Environment]::GetEnvironmentVariable("EXECUTOR_CLIENT_TOKEN")
if ([string]::IsNullOrWhiteSpace($clientToken)) { $clientToken = New-RandomSecret }

if ([string]::IsNullOrWhiteSpace($PublicHost)) {
  $PublicHost = ([string](Invoke-RestMethod -UseBasicParsing -Uri "https://api.ipify.org" -TimeoutSec 10)).Trim()
}

$parsedIp = $null
if (-not [Net.IPAddress]::TryParse($PublicHost,[ref]$parsedIp) -and [Uri]::CheckHostName($PublicHost) -eq [UriHostNameType]::Unknown) {
  throw "PublicHost must be an IP address or hostname"
}
if ($parsedIp -and $parsedIp.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork) {
  throw "direct V1 supports public IPv4 only"
}

if ([string]::IsNullOrWhiteSpace($ProfilePath)) {
  @"
config_version: 1
mcp:
  server_urls:
    - channel: main
      url: http://127.0.0.1:$McpPort/mcp
  startup_wait_timeout: 60s
  max_concurrent_requests: 64
health:
  listen_addr: 127.0.0.1:0
admin_ui:
  open_browser: false
"@ | Set-Content -LiteralPath $GeneratedProfilePath -Encoding UTF8
  $ProfilePath = $GeneratedProfilePath
}

$originalTunnelId = [Environment]::GetEnvironmentVariable("EXECUTOR_TUNNEL_ID")
$originalTunnelSecret = [Environment]::GetEnvironmentVariable("EXECUTOR_TUNNEL_API_SECRET")
$originalClientToken = [Environment]::GetEnvironmentVariable("EXECUTOR_CLIENT_TOKEN")
$originalPort = [Environment]::GetEnvironmentVariable("PORT")
$originalDevicePort = [Environment]::GetEnvironmentVariable("EXECUTOR_DEVICE_PORT")
$originalDataHome = [Environment]::GetEnvironmentVariable("XDG_DATA_HOME")
$originalConfigHome = [Environment]::GetEnvironmentVariable("XDG_CONFIG_HOME")

$caddy = $null
$firewallCreated = $false
$upnpCreated = $false
$firewallName = "Executor Direct $PublicPort"
$localLanIp = ""

try {
  $env:EXECUTOR_TUNNEL_ID = $tunnelId
  $env:EXECUTOR_TUNNEL_API_SECRET = $tunnelSecret
  $env:EXECUTOR_CLIENT_TOKEN = $clientToken
  $env:PORT = [string]$McpPort
  $env:EXECUTOR_DEVICE_PORT = [string]$DevicePort

  & (Join-Path $PSScriptRoot "Start-ExecutorControlPlane.ps1") -RuntimeRoot $RuntimeRoot -ProfilePath $ProfilePath -TunnelClient $TunnelClient

  $installedCaddy = (& (Join-Path $PSScriptRoot "Install-ExecutorCaddy.ps1") -RuntimeRoot $RuntimeRoot | Out-String | ConvertFrom-Json)
  $caddyExe = [string]$installedCaddy.path

  $publicUrl = ("https://{0}:{1}" -f $PublicHost,$PublicPort)
  $localDeviceUrl = ("https://127.0.0.1:{0}" -f $PublicPort)
  $siteAddresses = if ($PublicHost -eq "127.0.0.1") { $publicUrl } else { "{0}, {1}" -f $publicUrl,$localDeviceUrl }

  @"
{
  admin off
  skip_install_trust
  auto_https disable_redirects
}
$siteAddresses {
  tls internal
  @executorDevice path /device /health
  handle @executorDevice {
    reverse_proxy 127.0.0.1:$DevicePort
  }
  respond 404
}
"@ | Set-Content -LiteralPath $Caddyfile -Encoding UTF8

  try {
    if (-not (Get-NetFirewallRule -DisplayName $firewallName -ErrorAction SilentlyContinue)) {
      New-NetFirewallRule -DisplayName $firewallName -Direction Inbound -Action Allow -Protocol TCP -LocalPort $PublicPort -Profile Any | Out-Null
      $firewallCreated = $true
    }
  }
  catch { Write-Warning "Windows Firewall rule could not be created automatically" }

  try {
    $network = Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq "Up" } | Select-Object -First 1
    if ($network) { $localLanIp = [string]$network.IPv4Address.IPAddress }
    if (-not [string]::IsNullOrWhiteSpace($localLanIp)) {
      $mappings = (New-Object -ComObject HNetCfg.NATUPnP).StaticPortMappingCollection
      if ($mappings) {
        [void]$mappings.Add($PublicPort,"TCP",$PublicPort,$localLanIp,$true,"Executor Direct")
        $upnpCreated = $true
      }
    }
  }
  catch { Write-Warning "UPnP unavailable; manual forwarding may be required" }

  $env:XDG_DATA_HOME = $CaddyDataHome
  $env:XDG_CONFIG_HOME = $CaddyConfigHome
  $caddyOut = Join-Path $LogRoot "caddy-direct.out.log"
  $caddyErr = Join-Path $LogRoot "caddy-direct.err.log"
  Remove-Item -LiteralPath $caddyOut,$caddyErr -Force -ErrorAction SilentlyContinue
  $caddy = Start-Process -FilePath $caddyExe -ArgumentList @("run","--config",$Caddyfile,"--adapter","caddyfile") -PassThru -WindowStyle Hidden -RedirectStandardOutput $caddyOut -RedirectStandardError $caddyErr

  $rootCa = Join-Path $CaddyDataHome "caddy\pki\authorities\local\root.crt"
  Wait-Until { Test-Path -LiteralPath $rootCa -PathType Leaf } 30 "Caddy root CA was not provisioned"

  $curl = (Get-Command curl.exe -ErrorAction Stop).Source
  $resolve = ("{0}:{1}:127.0.0.1" -f $PublicHost,$PublicPort)
  $body = & $curl --silent --show-error --fail --cacert $rootCa --resolve $resolve ($publicUrl + "/health")
  if ($LASTEXITCODE -ne 0) { throw "local TLS probe failed" }
  $health = $body | ConvertFrom-Json
  if ($health.role -ne "device-ingress") { throw "route mismatch" }

  [pscustomobject]@{
    schema = "EXECUTOR_DIRECT_RUNTIME_V1"
    caddy_pid = $caddy.Id
    public_device_url = $publicUrl
    public_host = $PublicHost
    public_port = $PublicPort
    local_mcp_port = $McpPort
    local_device_port = $DevicePort
    tunnel_profile_path = $ProfilePath
    ca_certificate_path = $rootCa
    caddy_config_path = $Caddyfile
    caddy_data_home = $CaddyDataHome
    firewall_rule_name = $firewallName
    firewall_rule_created = $firewallCreated
    upnp_mapping_created = $upnpCreated
    local_lan_ip = $localLanIp
    credential_file = if ($OpenAITunnelCredentialsFile) { $OpenAITunnelCredentialsFile } else { $null }
    started_utc = [DateTime]::UtcNow.ToString("o")
  } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $StatePath -Encoding UTF8

  Write-Host "EXECUTOR DIRECT INGRESS READY"
  Write-Host "MCP loopback: 127.0.0.1:$McpPort"
  Write-Host "Device loopback: 127.0.0.1:$DevicePort"
  Write-Host "Device endpoint: $publicUrl"
  Write-Host "CA certificate: $rootCa"
  Write-Host "No traffic relay is in the device path."
  if ($upnpCreated) { Write-Host "UPnP TCP mapping created." }
  else { Write-Warning "Forward TCP $PublicPort to $localLanIp manually if required." }

  if (-not [string]::IsNullOrWhiteSpace($DeviceId)) {
    if ($InstallLocalDevice) {
      & (Join-Path $PSScriptRoot "New-ExecutorDeviceEnrollment.ps1") -DeviceId $DeviceId -DeviceServiceUrl $localDeviceUrl -CaCertificatePath $rootCa -InstallLocal | Out-Host
      Wait-Until {
        $localHealth = Invoke-RestMethod ("http://127.0.0.1:$DevicePort/health") -TimeoutSec 2
        return ([int]$localHealth.connectedDeviceCount -ge 1)
      } 120 "local Executor device did not connect"
      Write-Host "Local Executor device connected: $DeviceId"
    }
    else {
      & (Join-Path $PSScriptRoot "New-ExecutorDeviceEnrollment.ps1") -DeviceId $DeviceId -DeviceServiceUrl $publicUrl -CaCertificatePath $rootCa
    }
  }
}
catch {
  if ($caddy) { try { Stop-RecordedProcess $caddy.Id "caddy" } catch {} }
  try { & (Join-Path $PSScriptRoot "Stop-ExecutorControlPlane.ps1") -RuntimeRoot $RuntimeRoot } catch {}
  if ($firewallCreated) { Remove-NetFirewallRule -DisplayName $firewallName -ErrorAction SilentlyContinue }
  throw
}
finally {
  $env:EXECUTOR_TUNNEL_ID = $originalTunnelId
  $env:EXECUTOR_TUNNEL_API_SECRET = $originalTunnelSecret
  $env:EXECUTOR_CLIENT_TOKEN = $originalClientToken
  $env:PORT = $originalPort
  $env:EXECUTOR_DEVICE_PORT = $originalDevicePort
  $env:XDG_DATA_HOME = $originalDataHome
  $env:XDG_CONFIG_HOME = $originalConfigHome
  $tunnelSecret = $null
  $clientToken = $null
}
