param(
  [Parameter(Mandatory=$true)][string]$DeviceId,
  [Parameter(Mandatory=$true)][string]$DeviceServiceUrl,
  [string]$CredentialFile = "",
  [string]$CaCertificatePath = "",
  [string]$TlsServerName = "",
  [string]$SourceRef = "",
  [switch]$InstallLocal
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if ([string]::IsNullOrWhiteSpace($SourceRef)) {
  try {
    $git = (Get-Command git -ErrorAction Stop).Source
    $repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
    $candidate = (& $git -C $repoRoot rev-parse HEAD).Trim()
    if ($candidate -match '^[0-9a-fA-F]{40}$') {
      $SourceRef = $candidate
    }
  }
  catch {}
}
if ([string]::IsNullOrWhiteSpace($SourceRef)) {
  $SourceRef = "build/executor-v1"
}

if ($DeviceId -notmatch '^[A-Za-z0-9._:-]{1,128}$') {
  throw "DeviceId must match ^[A-Za-z0-9._:-]{1,128}$"
}

$uri = $null
if (-not [Uri]::TryCreate($DeviceServiceUrl, [UriKind]::Absolute, [ref]$uri)) {
  throw "DeviceServiceUrl must be an absolute URL"
}
$loopback = $uri.Scheme -eq "http" -and @("127.0.0.1","localhost","::1") -contains $uri.Host
if ($uri.Scheme -ne "https" -and -not $loopback) {
  throw "DeviceServiceUrl must use HTTPS except for loopback testing"
}
if (-not [string]::IsNullOrEmpty($uri.UserInfo)) {
  throw "DeviceServiceUrl must not embed credentials"
}

if ([string]::IsNullOrWhiteSpace($CredentialFile)) {
  $CredentialFile = [Environment]::GetEnvironmentVariable("EXECUTOR_DEVICE_TOKENS_FILE")
}
if ([string]::IsNullOrWhiteSpace($CredentialFile)) {
  $CredentialFile = Join-Path (Join-Path $env:LOCALAPPDATA "Executor") "device-tokens.json"
}

$parent = Split-Path -Parent $CredentialFile
if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }

$tokens = @{}
if (Test-Path -LiteralPath $CredentialFile -PathType Leaf) {
  $raw = Get-Content -Raw -Encoding UTF8 -LiteralPath $CredentialFile
  if (-not [string]::IsNullOrWhiteSpace($raw)) {
    $parsed = $raw | ConvertFrom-Json
    foreach ($property in $parsed.PSObject.Properties) {
      if ($property.Name -notmatch '^[A-Za-z0-9._:-]{1,128}$') {
        throw "invalid device id in credential file: $($property.Name)"
      }
      $tokens[$property.Name] = [string]$property.Value
    }
  }
}

$bytes = New-Object byte[] 32
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
$token = [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+","-").Replace("/","_")
$tokens[$DeviceId] = $token

$temp = "$CredentialFile.tmp.$([Guid]::NewGuid().ToString("N"))"
try {
  $tokens | ConvertTo-Json -Compress | Set-Content -LiteralPath $temp -Encoding UTF8
  Move-Item -LiteralPath $temp -Destination $CredentialFile -Force
}
finally {
  Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue
}

$caCertificateBase64 = ""
if (-not [string]::IsNullOrWhiteSpace($CaCertificatePath)) {
  if (-not (Test-Path -LiteralPath $CaCertificatePath -PathType Leaf)) { throw "CA certificate not found: $CaCertificatePath" }
  $caCertificateBase64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($CaCertificatePath))
}

function Quote-PowerShell([string]$Value) {
  return "'" + $Value.Replace("'","''") + "'"
}

$installerUrl = "https://raw.githubusercontent.com/thebrazenbeard/executor/$SourceRef/scripts/Install-ExecutorDevice.ps1"
$bootstrapPath = '$env:TEMP\Install-ExecutorDevice.ps1'
$localInstallResult = $null
if ($InstallLocal) {
  $localInstallResult = & (Join-Path $PSScriptRoot "Install-ExecutorDevice.ps1") -ServiceUrl $DeviceServiceUrl -DeviceId $DeviceId -DeviceToken $token -CaCertificateBase64 $caCertificateBase64 -TlsServerName $TlsServerName -SourceRef $SourceRef | Out-String
}

$command = "Invoke-WebRequest -UseBasicParsing -Uri " + (Quote-PowerShell $installerUrl) +
  " -OutFile " + $bootstrapPath +
  "; & " + $bootstrapPath +
  " -ServiceUrl " + (Quote-PowerShell $DeviceServiceUrl) +
  " -DeviceId " + (Quote-PowerShell $DeviceId) +
  " -DeviceToken " + (Quote-PowerShell $token) +
  $(if ([string]::IsNullOrWhiteSpace($caCertificateBase64)) { "" } else { " -CaCertificateBase64 " + (Quote-PowerShell $caCertificateBase64) }) +
  $(if ([string]::IsNullOrWhiteSpace($TlsServerName)) { "" } else { " -TlsServerName " + (Quote-PowerShell $TlsServerName) }) +
  " -SourceRef " + (Quote-PowerShell $SourceRef)

[pscustomobject]@{
  device_id = $DeviceId
  device_service_url = $DeviceServiceUrl
  credential_file = $CredentialFile
  source_ref = $SourceRef
  tls_server_name = if ([string]::IsNullOrWhiteSpace($TlsServerName)) { $null } else { $TlsServerName }
  bootstrap_command = if ($InstallLocal) { $null } else { $command }
  local_install = if ($InstallLocal) { $localInstallResult.Trim() } else { $null }
  note = if ($InstallLocal) { "Device installed locally without placing its credential in shell history." } else { "The bootstrap command contains this device's credential. Treat it as a secret and use it only on the target laptop." }
} | ConvertTo-Json -Depth 4
