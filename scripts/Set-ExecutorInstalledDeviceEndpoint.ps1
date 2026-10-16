param(
  [Parameter(Mandatory=$true)][string]$ServiceUrl,
  [string]$RuntimeRoot = (Join-Path $env:LOCALAPPDATA "Executor")
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

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
if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) {
  throw "Executor installed-device config not found: $configPath"
}

$config = Get-Content -Raw -Encoding UTF8 -LiteralPath $configPath | ConvertFrom-Json
if ($config.schema -ne "EXECUTOR_INSTALLED_DEVICE_V1") {
  throw "Unsupported Executor installed-device config schema"
}
if ([string]::IsNullOrWhiteSpace([string]$config.task_name)) {
  throw "Executor installed-device task_name is missing"
}

$config.service_url = $uri.GetLeftPart([UriPartial]::Authority).TrimEnd("/")
$temp = "$configPath.tmp.$([Guid]::NewGuid().ToString("N"))"
try {
  $config | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $temp -Encoding UTF8
  Move-Item -LiteralPath $temp -Destination $configPath -Force
}
finally {
  Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue
}

$taskName = [string]$config.task_name
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if (-not $task) {
  throw "Executor scheduled task not found: $taskName"
}

Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
Start-ScheduledTask -TaskName $taskName

[pscustomobject]@{
  status = "updated"
  device_id = [string]$config.device_id
  service_url = [string]$config.service_url
  task_name = $taskName
  config_path = $configPath
} | ConvertTo-Json -Depth 4
