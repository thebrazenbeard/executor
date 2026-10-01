param(
  [string]$RuntimeRoot = (Join-Path $env:LOCALAPPDATA "Executor"),
  [string]$ProfilePath = (Join-Path $PSScriptRoot "..\deploy\tunnel-client.executor.example.yaml"),
  [string]$TunnelClient = "tunnel-client"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$SourceRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$LogRoot = Join-Path $RuntimeRoot "logs"
$StatePath = Join-Path $RuntimeRoot "runtime-state.json"

New-Item -ItemType Directory -Force -Path $RuntimeRoot,$LogRoot | Out-Null

function Require-Env([string]$Name) {
  $value = [Environment]::GetEnvironmentVariable($Name)
  if ([string]::IsNullOrWhiteSpace($value)) { throw "$Name is required" }
  return $value
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
  $commandLine = [string]$record.CommandLine
  if ($commandLine -notlike "*$CommandNeedle*") {
    Write-Warning "Refusing to stop PID $ProcessId because its command line no longer matches $CommandNeedle"
    return
  }
  Stop-Process -Id $ProcessId -Force -ErrorAction Stop
}

if (Test-Path -LiteralPath $StatePath -PathType Leaf) {
  & (Join-Path $PSScriptRoot "Stop-ExecutorRuntime.ps1") -RuntimeRoot $RuntimeRoot
}

$node = (Get-Command node -ErrorAction Stop).Source
$tunnelExe = (Get-Command $TunnelClient -ErrorAction Stop).Source

$clientToken = Require-Env "EXECUTOR_CLIENT_TOKEN"
$deviceId = Require-Env "EXECUTOR_DEVICE_ID"
$installRoot = Require-Env "EXECUTOR_INSTALL_ROOT"
$manifestHash = Require-Env "EXECUTOR_TRUSTED_MANIFEST_SHA256"
$tunnelId = Require-Env "EXECUTOR_TUNNEL_ID"
$tunnelSecret = Require-Env "EXECUTOR_TUNNEL_API_SECRET"

$sharedDeviceToken = [Environment]::GetEnvironmentVariable("EXECUTOR_DEVICE_TOKEN")
$deviceTokenMap = [Environment]::GetEnvironmentVariable("EXECUTOR_DEVICE_TOKENS_JSON")
if ([string]::IsNullOrWhiteSpace($sharedDeviceToken) -and [string]::IsNullOrWhiteSpace($deviceTokenMap)) {
  throw "EXECUTOR_DEVICE_TOKEN or EXECUTOR_DEVICE_TOKENS_JSON is required for server ingress"
}

$agentToken = [Environment]::GetEnvironmentVariable("EXECUTOR_DEVICE_AGENT_TOKEN")
if ([string]::IsNullOrWhiteSpace($agentToken) -and -not [string]::IsNullOrWhiteSpace($deviceTokenMap)) {
  $parsedTokens = $deviceTokenMap | ConvertFrom-Json
  $property = $parsedTokens.PSObject.Properties[$deviceId]
  if ($property) { $agentToken = [string]$property.Value }
}
if ([string]::IsNullOrWhiteSpace($agentToken)) { $agentToken = $sharedDeviceToken }
if ([string]::IsNullOrWhiteSpace($agentToken)) {
  throw "No device-agent credential resolves for EXECUTOR_DEVICE_ID=$deviceId"
}

if (-not $env:EXECUTOR_EXECUTION_CAPACITY) { $env:EXECUTOR_EXECUTION_CAPACITY = "8" }
if (-not $env:EXECUTOR_LOGIC_CAPACITY) { $env:EXECUTOR_LOGIC_CAPACITY = "64" }
if (-not $env:HOST) { $env:HOST = "127.0.0.1" }
if (-not $env:PORT) { $env:PORT = "8787" }

$originalDeviceToken = [Environment]::GetEnvironmentVariable("EXECUTOR_DEVICE_TOKEN")
$originalServiceUrl = [Environment]::GetEnvironmentVariable("EXECUTOR_SERVICE_URL")
$originalControlTunnel = [Environment]::GetEnvironmentVariable("CONTROL_PLANE_TUNNEL_ID")
$originalControlKey = [Environment]::GetEnvironmentVariable("CONTROL_PLANE_API_KEY")
$originalExtraHeaders = [Environment]::GetEnvironmentVariable("MCP_EXTRA_HEADERS")

$server = $null
$device = $null
$tunnel = $null

try {
  $serverOut = Join-Path $LogRoot "executor-server.out.log"
  $serverErr = Join-Path $LogRoot "executor-server.err.log"
  $server = Start-Process -FilePath $node -ArgumentList "dist/server.js" -WorkingDirectory $SourceRoot -PassThru -WindowStyle Hidden -RedirectStandardOutput $serverOut -RedirectStandardError $serverErr

  Wait-Until {
    $h = Invoke-RestMethod -Uri ("http://127.0.0.1:" + $env:PORT + "/health") -Method Get -TimeoutSec 2
    return ($h.status -eq "ok")
  } 30 "Executor server did not become healthy"

  $env:EXECUTOR_SERVICE_URL = "http://127.0.0.1:$($env:PORT)"
  $env:EXECUTOR_DEVICE_TOKEN = $agentToken

  $deviceOut = Join-Path $LogRoot "executor-device.out.log"
  $deviceErr = Join-Path $LogRoot "executor-device.err.log"
  $device = Start-Process -FilePath $node -ArgumentList "dist/device-agent.js" -WorkingDirectory $SourceRoot -PassThru -WindowStyle Hidden -RedirectStandardOutput $deviceOut -RedirectStandardError $deviceErr

  Wait-Until {
    $h = Invoke-RestMethod -Uri ("http://127.0.0.1:" + $env:PORT + "/health") -Method Get -TimeoutSec 2
    return ([int]$h.connectedDeviceCount -ge 1)
  } 30 "Executor device agent did not attach"

  $env:CONTROL_PLANE_TUNNEL_ID = $tunnelId
  $env:CONTROL_PLANE_API_KEY = $tunnelSecret
  $env:MCP_EXTRA_HEADERS = "Authorization: Bearer $clientToken"

  & $tunnelExe doctor --profile-file $ProfilePath --explain
  if ($LASTEXITCODE -ne 0) { throw "tunnel-client doctor failed" }

  $tunnelOut = Join-Path $LogRoot "tunnel-client.out.log"
  $tunnelErr = Join-Path $LogRoot "tunnel-client.err.log"
  Remove-Item -LiteralPath $tunnelOut,$tunnelErr -Force -ErrorAction SilentlyContinue
  $tunnel = Start-Process -FilePath $tunnelExe -ArgumentList @("run","--profile-file",$ProfilePath) -PassThru -WindowStyle Hidden -RedirectStandardOutput $tunnelOut -RedirectStandardError $tunnelErr

  Wait-Until {
    if (-not (Test-Path -LiteralPath $tunnelErr -PathType Leaf)) { return $false }
    return [bool](Select-String -LiteralPath $tunnelErr -SimpleMatch "mcp session initialized" -Quiet)
  } 60 "tunnel-client started but did not initialize the Executor MCP session"

  $health = Invoke-RestMethod -Uri ("http://127.0.0.1:" + $env:PORT + "/health") -Method Get -TimeoutSec 2
  if ([int]$health.executionCapacityPerDevice -ne 8 -or [int]$health.upstreamContextCapacity -ne 64) {
    throw "Executor runtime did not report the required 8 execution / 64 logic lane profile"
  }

  [pscustomobject]@{
    schema = "EXECUTOR_LOCAL_RUNTIME_V1"
    server_pid = $server.Id
    device_pid = $device.Id
    tunnel_pid = $tunnel.Id
    device_id = $deviceId
    local_mcp = "http://127.0.0.1:$($env:PORT)/mcp"
    execution_lanes = 8
    logic_lanes = 64
    mcp_session_verified = $true
    log_root = $LogRoot
    started_utc = [DateTime]::UtcNow.ToString("o")
  } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $StatePath -Encoding UTF8

  Write-Host ""
  Write-Host "EXECUTOR READY"
  Write-Host "Device: $deviceId"
  Write-Host "Parallel lanes: 8 execution / 64 logic"
  Write-Host "State: $StatePath"
  Write-Host "Logs: $LogRoot"
}
catch {
  if ($tunnel) { Stop-RecordedProcess $tunnel.Id "tunnel-client" }
  if ($device) { Stop-RecordedProcess $device.Id "dist/device-agent.js" }
  if ($server) { Stop-RecordedProcess $server.Id "dist/server.js" }
  Remove-Item -LiteralPath $StatePath -Force -ErrorAction SilentlyContinue
  throw
}
finally {
  $env:EXECUTOR_DEVICE_TOKEN = $originalDeviceToken
  $env:EXECUTOR_SERVICE_URL = $originalServiceUrl
  $env:CONTROL_PLANE_TUNNEL_ID = $originalControlTunnel
  $env:CONTROL_PLANE_API_KEY = $originalControlKey
  $env:MCP_EXTRA_HEADERS = $originalExtraHeaders
  $clientToken = $null
  $agentToken = $null
  $tunnelSecret = $null
}
