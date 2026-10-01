param(
  [string]$RuntimeRoot = (Join-Path $env:LOCALAPPDATA "Executor"),
  [string]$ProfilePath = (Join-Path $PSScriptRoot "..\deploy\tunnel-client.executor.example.yaml"),
  [string]$TunnelClient = "tunnel-client"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$SourceRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$LogRoot = Join-Path $RuntimeRoot "logs"
$StatePath = Join-Path $RuntimeRoot "control-plane-state.json"
$TunnelHealthUrlFile = Join-Path $RuntimeRoot "control-plane-tunnel-health-url.txt"
$DefaultDeviceCredentialFile = Join-Path $RuntimeRoot "device-tokens.json"

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
    Write-Warning "Refusing to stop PID $ProcessId because its CommandLine no longer matches $CommandNeedle"
    return
  }
  Stop-Process -Id $ProcessId -Force -ErrorAction Stop
}

if (Test-Path -LiteralPath $StatePath -PathType Leaf) {
  & (Join-Path $PSScriptRoot "Stop-ExecutorControlPlane.ps1") -RuntimeRoot $RuntimeRoot
}

$node = (Get-Command node -ErrorAction Stop).Source
$tunnelCommand = Get-Command $TunnelClient -ErrorAction SilentlyContinue
if ($tunnelCommand) {
  $tunnelExe = $tunnelCommand.Source
}
elseif ($TunnelClient -eq "tunnel-client" -or $TunnelClient -eq "tunnel-client.exe") {
  $installedTunnelClient = (& (Join-Path $PSScriptRoot "Install-ExecutorTunnelClient.ps1") -RuntimeRoot $RuntimeRoot | Out-String | ConvertFrom-Json)
  $tunnelExe = [string]$installedTunnelClient.path
}
else {
  throw "tunnel-client not found: $TunnelClient"
}

$clientToken = Require-Env "EXECUTOR_CLIENT_TOKEN"
$tunnelId = Require-Env "EXECUTOR_TUNNEL_ID"
$tunnelSecret = Require-Env "EXECUTOR_TUNNEL_API_SECRET"

if (-not $env:EXECUTOR_EXECUTION_CAPACITY) { $env:EXECUTOR_EXECUTION_CAPACITY = "8" }
if (-not $env:EXECUTOR_LOGIC_CAPACITY) { $env:EXECUTOR_LOGIC_CAPACITY = "64" }
if (-not $env:HOST) { $env:HOST = "127.0.0.1" }
if (-not $env:PORT) { $env:PORT = "8787" }
if (-not $env:EXECUTOR_DEVICE_HOST) { $env:EXECUTOR_DEVICE_HOST = "127.0.0.1" }
if (-not $env:EXECUTOR_DEVICE_PORT) { $env:EXECUTOR_DEVICE_PORT = "8788" }

$originalDeviceTokenFile = [Environment]::GetEnvironmentVariable("EXECUTOR_DEVICE_TOKENS_FILE")
$sharedDeviceToken = [Environment]::GetEnvironmentVariable("EXECUTOR_DEVICE_TOKEN")
$deviceTokenMap = [Environment]::GetEnvironmentVariable("EXECUTOR_DEVICE_TOKENS_JSON")
$deviceTokenFile = [Environment]::GetEnvironmentVariable("EXECUTOR_DEVICE_TOKENS_FILE")
if ([string]::IsNullOrWhiteSpace($sharedDeviceToken) -and [string]::IsNullOrWhiteSpace($deviceTokenMap) -and [string]::IsNullOrWhiteSpace($deviceTokenFile)) {
  $deviceTokenFile = $DefaultDeviceCredentialFile
  if (-not (Test-Path -LiteralPath $deviceTokenFile -PathType Leaf)) {
    "{}" | Set-Content -LiteralPath $deviceTokenFile -Encoding UTF8
  }
  $env:EXECUTOR_DEVICE_TOKENS_FILE = $deviceTokenFile
}

$originalControlTunnel = [Environment]::GetEnvironmentVariable("CONTROL_PLANE_TUNNEL_ID")
$originalControlKey = [Environment]::GetEnvironmentVariable("CONTROL_PLANE_API_KEY")
$originalExtraHeaders = [Environment]::GetEnvironmentVariable("MCP_EXTRA_HEADERS")
$originalHealthUrlFile = [Environment]::GetEnvironmentVariable("HEALTH_URL_FILE")

$server = $null
$tunnel = $null

try {
  $serverOut = Join-Path $LogRoot "executor-control-plane.out.log"
  $serverErr = Join-Path $LogRoot "executor-control-plane.err.log"
  $server = Start-Process -FilePath $node -ArgumentList "dist/server.js" -WorkingDirectory $SourceRoot -PassThru -WindowStyle Hidden -RedirectStandardOutput $serverOut -RedirectStandardError $serverErr

  Wait-Until {
    $h = Invoke-RestMethod -Uri ("http://127.0.0.1:" + $env:PORT + "/health") -Method Get -TimeoutSec 2
    return ($h.status -eq "ok")
  } 30 "Executor MCP control plane did not become healthy"

  Wait-Until {
    $h = Invoke-RestMethod -Uri ("http://127.0.0.1:" + $env:EXECUTOR_DEVICE_PORT + "/health") -Method Get -TimeoutSec 2
    return ($h.status -eq "ok" -and $h.role -eq "device-ingress")
  } 30 "Executor device ingress did not become healthy"

  $env:CONTROL_PLANE_TUNNEL_ID = $tunnelId
  $env:CONTROL_PLANE_API_KEY = $tunnelSecret
  $env:MCP_EXTRA_HEADERS = "Authorization: Bearer $clientToken"
  $env:HEALTH_URL_FILE = $TunnelHealthUrlFile
  Remove-Item -LiteralPath $TunnelHealthUrlFile -Force -ErrorAction SilentlyContinue

  & $tunnelExe doctor --profile-file $ProfilePath --explain
  if ($LASTEXITCODE -ne 0) { throw "tunnel-client doctor failed" }

  $tunnelOut = Join-Path $LogRoot "executor-tunnel.out.log"
  $tunnelErr = Join-Path $LogRoot "executor-tunnel.err.log"
  Remove-Item -LiteralPath $tunnelOut,$tunnelErr -Force -ErrorAction SilentlyContinue
  $tunnel = Start-Process -FilePath $tunnelExe -ArgumentList @("run","--profile-file",$ProfilePath) -PassThru -WindowStyle Hidden -RedirectStandardOutput $tunnelOut -RedirectStandardError $tunnelErr

  Wait-Until {
    Test-Path -LiteralPath $TunnelHealthUrlFile -PathType Leaf
  } 20 "tunnel-client did not publish its health URL"

  $healthBase = (Get-Content -Raw -LiteralPath $TunnelHealthUrlFile).Trim()
  Wait-Until {
    $ready = Invoke-WebRequest -UseBasicParsing -Uri ($healthBase.TrimEnd("/") + "/readyz") -TimeoutSec 2
    return ($ready.StatusCode -eq 200)
  } 60 "tunnel-client did not become ready"

  Wait-Until {
    if (-not (Test-Path -LiteralPath $tunnelErr -PathType Leaf)) { return $false }
    return [bool](Select-String -LiteralPath $tunnelErr -SimpleMatch "mcp session initialized" -Quiet)
  } 60 "tunnel-client became ready but did not record Executor MCP session initialization"

  $health = Invoke-RestMethod -Uri ("http://127.0.0.1:" + $env:PORT + "/health") -Method Get -TimeoutSec 2
  if ([int]$health.executionCapacityPerDevice -ne 8 -or [int]$health.upstreamContextCapacity -ne 64) {
    throw "Executor control plane did not report the required 8 execution / 64 logic lane profile"
  }

  [pscustomobject]@{
    schema = "EXECUTOR_CONTROL_PLANE_RUNTIME_V1"
    server_pid = $server.Id
    tunnel_pid = $tunnel.Id
    local_mcp = "http://127.0.0.1:$($env:PORT)/mcp"
    local_device_ingress = "http://127.0.0.1:$($env:EXECUTOR_DEVICE_PORT)"
    tunnel_health_url = $healthBase
    execution_lanes = 8
    logic_lanes = 64
    mcp_session_verified = $true
    log_root = $LogRoot
    started_utc = [DateTime]::UtcNow.ToString("o")
  } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $StatePath -Encoding UTF8

  Write-Host ""
  Write-Host "EXECUTOR CONTROL PLANE READY"
  Write-Host "Connected devices: $($health.connectedDeviceCount)"
  Write-Host "Parallel lanes: 8 execution per device / 64 logic"
  Write-Host "State: $StatePath"
  Write-Host "Logs: $LogRoot"
}
catch {
  if ($tunnel) { Stop-RecordedProcess $tunnel.Id "tunnel-client" }
  if ($server) { Stop-RecordedProcess $server.Id "dist/server.js" }
  Remove-Item -LiteralPath $StatePath -Force -ErrorAction SilentlyContinue
  throw
}
finally {
  $env:CONTROL_PLANE_TUNNEL_ID = $originalControlTunnel
  $env:CONTROL_PLANE_API_KEY = $originalControlKey
  $env:MCP_EXTRA_HEADERS = $originalExtraHeaders
  $env:HEALTH_URL_FILE = $originalHealthUrlFile
  $env:EXECUTOR_DEVICE_TOKENS_FILE = $originalDeviceTokenFile
  $clientToken = $null
  $tunnelSecret = $null
}
