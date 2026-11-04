param(
  [Parameter(Mandatory=$true)][string]$ServiceUrl,
  [Parameter(Mandatory=$true)][string]$DeviceId,
  [Parameter(Mandatory=$true)][string]$DeviceToken,
  [string]$CaCertificateBase64 = "",
  [string]$TlsServerName = "",
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

function Assert-FreshInstallTargets {
  # Bootstrap is intentionally fresh-only. An upgrade must preserve and separately
  # qualify the installed agent, payload, scheduler task, and DPAPI credentials.
  foreach ($target in @($AgentRoot,$PayloadRoot,$configPath,$credentialPath,$caPath)) {
    if (Test-Path -LiteralPath $target) {
      throw "EXISTING_EXECUTOR_INSTALL: refusing to overwrite $target. Use a qualified maintenance upgrade."
    }
  }
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    throw "EXISTING_EXECUTOR_INSTALL: refusing to replace scheduled task '$TaskName'. Use a qualified maintenance upgrade."
  }
}

function WriteNewFileBytes([string]$Path,[byte[]]$Bytes) {
  # CreateNew fails instead of overwriting if another process creates the file.
  $stream = [IO.File]::Open($Path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
  try {
    $stream.Write($Bytes,0,$Bytes.Length)
    $stream.Flush()
  }
  finally { $stream.Dispose() }
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

$configPath = Join-Path $RuntimeRoot "device.json"
$credentialPath = Join-Path $RuntimeRoot "device-token.dpapi"
$caPath = Join-Path $RuntimeRoot "device-ca.crt"
Assert-FreshInstallTargets

$git = Require-Command "git"
$node = Require-Command "node"
$npm = Require-Command "npm"
$powershell = (Get-Command powershell.exe -ErrorAction Stop).Source

New-Item -ItemType Directory -Force -Path $RuntimeRoot | Out-Null
$staging = Join-Path $RuntimeRoot ("Agent.staging." + [Guid]::NewGuid().ToString("N"))
$payloadCandidate = "$PayloadRoot.candidate.$([Guid]::NewGuid().ToString('N'))"

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

    & $npm install --ignore-scripts --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw "Executor npm install failed" }
    & $npm run build
    if ($LASTEXITCODE -ne 0) { throw "Executor npm run build failed" }

    # The nested installer supports replacement. Give it a unique, never-used
    # candidate directory instead of the installed payload path.
    & (Join-Path $staging "scripts\Install-ExecutorDesktopCommander.ps1") -InstallRoot $payloadCandidate | Out-Host
  }
  finally {
    Pop-Location
  }

  $manifestPath = Join-Path $payloadCandidate "executor-desktop-commander.manifest.json"
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw "Qualified Desktop Commander manifest was not built"
  }
  $manifestHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $manifestPath).Hash.ToLowerInvariant()

  Assert-FreshInstallTargets
  # Directory.Move fails on an occupied destination. No backup/replace/delete.
  [IO.Directory]::Move($payloadCandidate,$PayloadRoot)
  [IO.Directory]::Move($staging,$AgentRoot)

  if (-not [string]::IsNullOrWhiteSpace($CaCertificateBase64)) {
    try { $caBytes = [Convert]::FromBase64String($CaCertificateBase64) }
    catch { throw "CaCertificateBase64 is not valid base64" }
    WriteNewFileBytes -Path $caPath -Bytes $caBytes
  }

  $secureToken = ConvertTo-SecureString -String $DeviceToken -AsPlainText -Force
  $encryptedToken = $secureToken | ConvertFrom-SecureString
  WriteNewFileBytes -Path $credentialPath -Bytes ([Text.Encoding]::ASCII.GetBytes($encryptedToken + [Environment]::NewLine))

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
    tls_server_name = if ([string]::IsNullOrWhiteSpace($TlsServerName)) { $null } else { $TlsServerName }
  } | ConvertTo-Json -Depth 4
  WriteNewFileBytes -Path $configPath -Bytes ([Text.Encoding]::UTF8.GetBytes($configJson + [Environment]::NewLine))

  $launcher = Join-Path $AgentRoot "scripts\Start-ExecutorInstalledDevice.ps1"
  $arguments = '-NoProfile -WindowStyle Hidden -File "{0}" -RuntimeRoot "{1}"' -f $launcher,$RuntimeRoot
  $action = New-ScheduledTaskAction -Execute $powershell -Argument $arguments
  $userId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
  $principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal | Out-Null
  Start-ScheduledTask -TaskName $TaskName

  [pscustomobject]@{
    status = "installed"
    device_id = $DeviceId
    service_url = $ServiceUrl
    source_commit = $sourceCommit
    manifest_sha256 = $manifestHash
    task_name = $TaskName
    config_path = $configPath
    tls_server_name = if ([string]::IsNullOrWhiteSpace($TlsServerName)) { $null } else { $TlsServerName }
    credential_storage = "Windows DPAPI for current user"
  } | ConvertTo-Json -Depth 4
}
catch {
  # Preserve any created candidate/partial installation for diagnosis.
  # No fallback cleanup may delete an installation owned by another process.
  throw
}
finally {
  $DeviceToken = $null
}
