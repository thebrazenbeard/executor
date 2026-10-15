param(
  [string]$RuntimeRoot = (Join-Path $env:LOCALAPPDATA 'Executor')
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$configPath = Join-Path $RuntimeRoot 'device.json'
if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) { throw "Missing Executor device configuration" }
$config = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($config.schema -ne 'EXECUTOR_INSTALLED_DEVICE_V1') { throw 'Unsupported device configuration' }
$deviceId = [string]$config.device_id
$agentPath = [IO.Path]::GetFullPath((Join-Path ([string]$config.agent_root) 'dist\device-agent.js'))
$endpoint = [Uri][string]$config.service_url
if ($endpoint.Scheme -ne 'https' -and $endpoint.Scheme -ne 'http') { throw 'Unsupported endpoint scheme' }
$targetIps = @([Net.Dns]::GetHostAddresses($endpoint.DnsSafeHost) | ForEach-Object { $_.ToString() })
$matches = @(
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object {
      # The installed launcher passes the full absolute JS path on the command line.
      $_.CommandLine -and $_.CommandLine.Contains($agentPath)
    }
)
$connected = @()
foreach ($process in $matches) {
  $connections = @(Get-NetTCPConnection -OwningProcess $process.ProcessId -State Established -ErrorAction SilentlyContinue)
  foreach ($connection in $connections) {
    if ($connection.RemotePort -eq $endpoint.Port -and $targetIps -contains $connection.RemoteAddress) {
      $connected += $process.ProcessId
      break
    }
  }
}
$status = if ($connected.Count) { 'TRANSPORT_ESTABLISHED' }
          elseif ($matches.Count) { 'AGENT_PRESENT_NO_ESTABLISHED_TRANSPORT' }
          else { 'AGENT_PROCESS_NOT_FOUND' }
[pscustomobject]@{
  schema = 'EXECUTOR_LOCAL_DEVICE_TRANSPORT_OBSERVATION_V1'
  device_id = $deviceId
  status = $status
  agent_process_count = $matches.Count
  transport_connected_process_count = $connected.Count
  endpoint_host = $endpoint.DnsSafeHost
  endpoint_port = $endpoint.Port
  authenticated_server_ready = 'NOT_VERIFIED'
  observation = 'Local process and TCP state only. Not server attestation or effect authority.'
} | ConvertTo-Json -Compress
