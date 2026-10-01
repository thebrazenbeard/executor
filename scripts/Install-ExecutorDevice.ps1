param(
  [Parameter(Mandatory=$true)][string]$ServiceUrl,
  [Parameter(Mandatory=$true)][string]$DeviceId,
  [Parameter(Mandatory=$true)][string]$DeviceToken,
  [string]$CaCertificateBase64 = "",
  [string]$SourceRepository = "https://github.com/thebrazenbeard/executor.git",
  [string]$SourceRef = "build/executor-v1",
  [string]$RuntimeRoot = (Join-Path $env:LOCALAPPDATA "Executor"),
  [string]$AgentRoot = (Join-Path (Join-Path $env:LOCALAPPDATA "Executor") "Agent"),
  [string]$PayloadRoot = (Join-Path (Join-Path $env:LOCALAPPDATA "Executor") "DesktopCommanderMCP"),
  [string]$TaskName = "Executor Device"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Require-Command([string]$Name) {
  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if (-not $command) { throw "Required command is not installed or not on PATH: $Name" }
  return $command.Source
}

if ($DeviceId -notmatch '^[A-Za-z0-9._:-]{1,128}$') {
  throw "DeviceId must match ^[A-Za-z0-9._:-]{1,128}$"
}
$uri = $null
if (-not [Uri]::TryCreate($ServiceUrl, [UriKind]::Absolute, [ref]$uri)) {
  throw "ServiceUrl must be an absolute URL"
}
$loopback = $uri.Scheme -eq "http" -and @("127.0.0.1","localhost","::1") -contains $uri.Host
if ($uri.Scheme -ne "https" -and -not $loopback) {
  throw "ServiceUrl must use HTTPS except for loopback testing"
}
if (-not [string]::IsNullOrEmpty($uri.UserInfo)) {
  throw "ServiceUrl must not embed credentials"
}

$git = Require-Command "git"
$node = Require-Command "node"
$npm = Require-Command "npm"
$powershell = (Get-Command powershell.exe -ErrorAction Stop).Source

New-Item -ItemType Directory -Force -Path $RuntimeRoot | Out-Null
$staging = Join-Path $RuntimeRoot ("Agent.staging." + [Guid]::NewGuid().ToString("N"))
$backup = $null
$configPath = Join-Path $RuntimeRoot "device.json"
$credentialPath = Join-Path $RuntimeRoot "device-token.dpapi"
$caPath = Join-Path $RuntimeRoot "device-ca.crt"

$existingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existingTask) {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
}

try {
  & $git clone --no-tags $SourceRepository $staging
  if ($LASTEXITCODE -ne 0) { throw "Executor clone failed" }

  Push-Location $staging
  try {
    & $git fetch --depth 1 origin $SourceRef
    if ($LASTEXITCODE -ne 0) { throw "Executor source ref fetch failed: $SourceRef" }
    & $git checkout --detach FETCH_HEAD
    if ($LASTEXITCODE -ne 0) { throw "Executor source checkout failed" }
    $sourceCommit = (& $git rev-parse HEAD).Trim()

    & $npm ci --ignore-scripts --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw "Executor npm install failed" }
    & $npm run build
    if ($LASTEXITCODE -ne 0) { throw "Executor npm run build failed" }

    & (Join-Path $staging "scripts\Install-ExecutorDesktopCommander.ps1") -InstallRoot $PayloadRoot | Out-Host
  }
  finally {
    Pop-Location
  }

  $manifestPath = Join-Path $PayloadRoot "executor-desktop-commander.manifest.json"
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw "Qualified Desktop Commander manifest was not installed"
  }
  $manifestHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $manifestPath).Hash.ToLowerInvariant()

  if (Test-Path -LiteralPath $AgentRoot) {
    $backup = "$AgentRoot.backup.$([DateTime]::UtcNow.ToString('yyyyMMddHHmmss'))"
    Move-Item -LiteralPath $AgentRoot -Destination $backup
  }
  Move-Item -LiteralPath $staging -Destination $AgentRoot
  if ($backup -and (Test-Path -LiteralPath $backup)) {
    Remove-Item -LiteralPath $backup -Recurse -Force
    $backup = $null
  }

  if (-not [string]::IsNullOrWhiteSpace($CaCertificateBase64)) {
    try { [IO.File]::WriteAllBytes($caPath, [Convert]::FromBase64String($CaCertificateBase64)) }
    catch { throw "CaCertificateBase64 is not valid base64" }
  }

  $secureToken = ConvertTo-SecureString -String $DeviceToken -AsPlainText -Force
  $secureToken | ConvertFrom-SecureString | Set-Content -LiteralPath $credentialPath -Encoding ASCII

  $configJson = [ordered]@{
    schema = "EXECUTOR_INSTALLED_DEVICE_V1"
    service_url = $ServiceUrl
    device_id = $DeviceId
    agent_root = $AgentRoot
    payload_root = $PayloadRoot
    manifest_sha256 = $manifestHash
    source_commit = $sourceCommit
    task_name = $TaskName
    ca_path = if (Test-Path -LiteralPath $caPath -PathType Leaf) { $caPath } else { $null }
  } | ConvertTo-Json -Depth 4
  $configJson | Set-Content -LiteralPath $configPath -Encoding UTF8

  $launcher = Join-Path $AgentRoot "scripts\Start-ExecutorInstalledDevice.ps1"
  $arguments = '-NoProfile -WindowStyle Hidden -File "{0}" -RuntimeRoot "{1}"' -f $launcher,$RuntimeRoot
  $action = New-ScheduledTaskAction -Execute $powershell -Argument $arguments
  $userId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
  $principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Force | Out-Null
  Start-ScheduledTask -TaskName $TaskName

  [pscustomobject]@{
    status = "installed"
    device_id = $DeviceId
    service_url = $ServiceUrl
    source_commit = $sourceCommit
    manifest_sha256 = $manifestHash
    task_name = $TaskName
    config_path = $configPath
    credential_storage = "Windows DPAPI for current user"
  } | ConvertTo-Json -Depth 4
}
catch {
  if (Test-Path -LiteralPath $staging) {
    Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
  }
  if ($backup -and (Test-Path -LiteralPath $backup) -and -not (Test-Path -LiteralPath $AgentRoot)) {
    Move-Item -LiteralPath $backup -Destination $AgentRoot
  }
  throw
}
finally {
  $DeviceToken = $null
}
