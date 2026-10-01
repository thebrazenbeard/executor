param(
  [string]$RuntimeRoot = (Join-Path $env:LOCALAPPDATA "Executor"),
  [string]$OpenAITunnelCredentialsFile = "",
  [string]$DeviceId = "",
  [string]$ProfilePath = (Join-Path $PSScriptRoot "..\deploy\tunnel-client.executor.example.yaml"),
  [string]$TunnelClient = "tunnel-client",
  [string]$CloudflaredPath = "",
  [int]$QuickTunnelTimeoutSeconds = 45
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$SourceRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$LogRoot = Join-Path $RuntimeRoot "logs"
$StatePath = Join-Path $RuntimeRoot "zero-cost-state.json"
$ControlPlaneStatePath = Join-Path $RuntimeRoot "control-plane-state.json"
New-Item -ItemType Directory -Force -Path $RuntimeRoot,$LogRoot | Out-Null

function New-RandomSecret {
  $bytes = New-Object byte[] 32
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  return [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+","-").Replace("/","_")
}

function Read-NextValue([string[]]$Lines,[int]$Index,[string]$Inline) {
  if (-not [string]::IsNullOrWhiteSpace($Inline)) { return $Inline.Trim() }
  for ($i = $Index + 1; $i -lt $Lines.Count; $i++) {
    $candidate = $Lines[$i].Trim()
    if (-not [string]::IsNullOrWhiteSpace($candidate)) { return $candidate }
  }
  return ""
}

function Read-OpenAITunnelCredentials([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "OpenAI tunnel credential file not found: $Path"
  }
  $lines = @(Get-Content -LiteralPath $Path -Encoding UTF8)
  $id = ""
  $secret = ""
  for ($i = 0; $i -lt $lines.Count; $i++) {
    $line = [string]$lines[$i]
    if ($line -match '^\s*tunnel[_\s-]*id\s*:\s*(.*)$') {
      $id = Read-NextValue -Lines $lines -Index $i -Inline $Matches[1]
      continue
    }
    if ($line -match '^\s*(api[_\s-]*)?secret([_\s-]*key)?\s*:\s*(.*)$') {
      $secret = Read-NextValue -Lines $lines -Index $i -Inline $Matches[3]
      continue
    }
  }
  return @{ tunnel_id = $id; tunnel_secret = $secret }
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
    throw "Refusing to stop PID $ProcessId because its CommandLine no longer matches $CommandNeedle"
  }
  Stop-Process -Id $ProcessId -Force -ErrorAction Stop
}

function Find-QuickTunnelUrl([string[]]$Paths) {
  foreach ($path in $Paths) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { continue }
    $raw = Get-Content -Raw -Encoding UTF8 -LiteralPath $path -ErrorAction SilentlyContinue
    $matches = [regex]::Matches([string]$raw, 'https://[^\s|''"<>]+', [Text.RegularExpressions.RegexOptions]::IgnoreCase)
    foreach ($match in $matches) {
      $candidate = $match.Value.TrimEnd(')',',','.',';')
      $uri = $null
      if (-not [Uri]::TryCreate($candidate, [UriKind]::Absolute, [ref]$uri)) { continue }
      if ($uri.Scheme -ne "https") { continue }
      if (-not [string]::IsNullOrEmpty($uri.UserInfo)) { continue }
      if ($uri.Host -notlike "*.trycloudflare.com") { continue }
      return $uri.GetLeftPart([UriPartial]::Authority)
    }
  }
  return ""
}

if (Test-Path -LiteralPath $StatePath -PathType Leaf) {
  & (Join-Path $PSScriptRoot "Stop-ExecutorZeroCost.ps1") -RuntimeRoot $RuntimeRoot
}

if (-not (Test-Path -LiteralPath (Join-Path $SourceRoot "dist\server.js") -PathType Leaf)) {
  $npm = (Get-Command npm -ErrorAction Stop).Source
  Push-Location $SourceRoot
  try {
    & $npm install --ignore-scripts --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw "Executor npm install failed" }
    & $npm run build
    if ($LASTEXITCODE -ne 0) { throw "Executor build failed" }
  }
  finally { Pop-Location }
}

$tunnelId = [Environment]::GetEnvironmentVariable("EXECUTOR_TUNNEL_ID")
$tunnelSecret = [Environment]::GetEnvironmentVariable("EXECUTOR_TUNNEL_API_SECRET")
if (([string]::IsNullOrWhiteSpace($tunnelId) -or [string]::IsNullOrWhiteSpace($tunnelSecret)) -and -not [string]::IsNullOrWhiteSpace($OpenAITunnelCredentialsFile)) {
  $parsed = Read-OpenAITunnelCredentials -Path $OpenAITunnelCredentialsFile
  if ([string]::IsNullOrWhiteSpace($tunnelId)) { $tunnelId = [string]$parsed.tunnel_id }
  if ([string]::IsNullOrWhiteSpace($tunnelSecret)) { $tunnelSecret = [string]$parsed.tunnel_secret }
}
if ([string]::IsNullOrWhiteSpace($tunnelId) -or [string]::IsNullOrWhiteSpace($tunnelSecret)) {
  throw "OpenAI tunnel identity/API secret are required through environment variables or -OpenAITunnelCredentialsFile"
}

$clientToken = [Environment]::GetEnvironmentVariable("EXECUTOR_CLIENT_TOKEN")
if ([string]::IsNullOrWhiteSpace($clientToken)) { $clientToken = New-RandomSecret }

$originalTunnelId = [Environment]::GetEnvironmentVariable("EXECUTOR_TUNNEL_ID")
$originalTunnelSecret = [Environment]::GetEnvironmentVariable("EXECUTOR_TUNNEL_API_SECRET")
$originalClientToken = [Environment]::GetEnvironmentVariable("EXECUTOR_CLIENT_TOKEN")

$quick = $null
try {
  $env:EXECUTOR_TUNNEL_ID = $tunnelId
  $env:EXECUTOR_TUNNEL_API_SECRET = $tunnelSecret
  $env:EXECUTOR_CLIENT_TOKEN = $clientToken

  & (Join-Path $PSScriptRoot "Start-ExecutorControlPlane.ps1") -RuntimeRoot $RuntimeRoot -ProfilePath $ProfilePath -TunnelClient $TunnelClient
  if (-not (Test-Path -LiteralPath $ControlPlaneStatePath -PathType Leaf)) {
    throw "Executor control plane did not create runtime state"
  }

  if ([string]::IsNullOrWhiteSpace($CloudflaredPath)) {
    $installed = (& (Join-Path $PSScriptRoot "Install-ExecutorCloudflared.ps1") | Out-String | ConvertFrom-Json)
    $CloudflaredPath = [string]$installed.path
  }
  if (-not (Test-Path -LiteralPath $CloudflaredPath -PathType Leaf)) {
    throw "cloudflared executable not found: $CloudflaredPath"
  }

  $devicePort = if ($env:EXECUTOR_DEVICE_PORT) { [int]$env:EXECUTOR_DEVICE_PORT } else { 8788 }
  $origin = "http://127.0.0.1:$devicePort"
  $quickOut = Join-Path $LogRoot "cloudflared-quick.out.log"
  $quickErr = Join-Path $LogRoot "cloudflared-quick.err.log"
  Remove-Item -LiteralPath $quickOut,$quickErr -Force -ErrorAction SilentlyContinue

  $quick = Start-Process -FilePath $CloudflaredPath -ArgumentList @("tunnel","--no-autoupdate","--url",$origin) -PassThru -WindowStyle Hidden -RedirectStandardOutput $quickOut -RedirectStandardError $quickErr

  $publicUrl = ""
  Wait-Until {
    $script:publicUrl = Find-QuickTunnelUrl -Paths @($quickOut,$quickErr)
    return (-not [string]::IsNullOrWhiteSpace($script:publicUrl))
  } $QuickTunnelTimeoutSeconds "cloudflared did not publish a Quick Tunnel URL"
  $publicUrl = $script:publicUrl

  $publicUri = [Uri]$publicUrl
  if ($publicUri.Scheme -ne "https" -or $publicUri.Host -notlike "*.trycloudflare.com" -or -not [string]::IsNullOrEmpty($publicUri.UserInfo)) {
    throw "cloudflared returned an invalid zero-cost endpoint"
  }

  Wait-Until {
    $health = Invoke-RestMethod -Uri ($publicUrl.TrimEnd("/") + "/health") -Method Get -TimeoutSec 5
    return ($health.status -eq "ok" -and $health.role -eq "device-ingress")
  } $QuickTunnelTimeoutSeconds "public Quick Tunnel device-ingress health check failed"

  $sourceHead = ""
  try {
    $git = (Get-Command git -ErrorAction Stop).Source
    $sourceHead = (& $git -C $SourceRoot rev-parse HEAD).Trim()
  } catch {}

  [pscustomobject]@{
    schema = "EXECUTOR_ZERO_COST_RUNTIME_V1"
    quick_tunnel_pid = $quick.Id
    public_device_url = $publicUrl
    control_plane_state_path = $ControlPlaneStatePath
    cloudflared_path = $CloudflaredPath
    source_head = $sourceHead
    credential_file = if ([string]::IsNullOrWhiteSpace($OpenAITunnelCredentialsFile)) { $null } else { $OpenAITunnelCredentialsFile }
    log_root = $LogRoot
    started_utc = [DateTime]::UtcNow.ToString("o")
  } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $StatePath -Encoding UTF8

  Write-Host ""
  Write-Host "EXECUTOR ZERO-COST QUICKSTART READY"
  Write-Host "Device endpoint: $publicUrl"
  Write-Host "Cost model: temporary Cloudflare Quick Tunnel; no paid fallback"
  Write-Host "Important: this hostname changes when the Quick Tunnel restarts."

  if (-not [string]::IsNullOrWhiteSpace($DeviceId)) {
    Write-Host ""
    Write-Host "DEVICE ENROLLMENT"
    & (Join-Path $PSScriptRoot "New-ExecutorDeviceEnrollment.ps1") -DeviceId $DeviceId -DeviceServiceUrl $publicUrl
  }
}
catch {
  if ($quick) {
    try { Stop-RecordedProcess -ProcessId $quick.Id -CommandNeedle "cloudflared" } catch {}
  }
  try { & (Join-Path $PSScriptRoot "Stop-ExecutorControlPlane.ps1") -RuntimeRoot $RuntimeRoot } catch {}
  Remove-Item -LiteralPath $StatePath -Force -ErrorAction SilentlyContinue
  throw
}
finally {
  $env:EXECUTOR_TUNNEL_ID = $originalTunnelId
  $env:EXECUTOR_TUNNEL_API_SECRET = $originalTunnelSecret
  $env:EXECUTOR_CLIENT_TOKEN = $originalClientToken
  $tunnelSecret = $null
  $clientToken = $null
}
