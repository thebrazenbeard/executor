param(
  [string]$RuntimeRoot = (Join-Path $env:LOCALAPPDATA "Executor"),
  [string]$OpenAITunnelCredentialsFile = "",
  [string]$PublicHost = "",
  [string]$TlsServerName = "executor-device.invalid",
  [int]$PublicPort = 9443,
  [int]$McpPort = 18887,
  [int]$DevicePort = 18888,
  [string]$DeviceId = "",
  [string]$ProfilePath = "",
  [string]$TunnelClient = "tunnel-client"
)

$ErrorActionPreference = "Stop"
$StatePath = Join-Path $RuntimeRoot "direct-state.json"

if (Test-Path -LiteralPath $StatePath -PathType Leaf) {
  try {
    $state = Get-Content -Raw -Encoding UTF8 -LiteralPath $StatePath | ConvertFrom-Json
    if ([string]::IsNullOrWhiteSpace($OpenAITunnelCredentialsFile)) { $OpenAITunnelCredentialsFile = [string]$state.credential_file }
    if ([string]::IsNullOrWhiteSpace($PublicHost)) { $PublicHost = [string]$state.public_host }
    if ($TlsServerName -eq "executor-device.invalid" -and $state.tls_server_name) { $TlsServerName = [string]$state.tls_server_name }
    if ($PublicPort -eq 9443 -and $state.public_port) { $PublicPort = [int]$state.public_port }
    if ($McpPort -eq 18887 -and $state.local_mcp_port) { $McpPort = [int]$state.local_mcp_port }
    if ($DevicePort -eq 18888 -and $state.local_device_port) { $DevicePort = [int]$state.local_device_port }
  }
  catch {}
}

& (Join-Path $PSScriptRoot "Stop-ExecutorDirect.ps1") -RuntimeRoot $RuntimeRoot

$startArgs = @{
  RuntimeRoot = $RuntimeRoot
  OpenAITunnelCredentialsFile = $OpenAITunnelCredentialsFile
  PublicHost = $PublicHost
  TlsServerName = $TlsServerName
  PublicPort = $PublicPort
  McpPort = $McpPort
  DevicePort = $DevicePort
  DeviceId = $DeviceId
  ProfilePath = $ProfilePath
  TunnelClient = $TunnelClient
}
& (Join-Path $PSScriptRoot "Start-ExecutorDirect.ps1") @startArgs
