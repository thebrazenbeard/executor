param(
  [string]$RuntimeRoot = (Join-Path $env:LOCALAPPDATA "Executor")
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$configPath = Join-Path $RuntimeRoot "device.json"
$credentialPath = Join-Path $RuntimeRoot "device-token.dpapi"
$logRoot = Join-Path $RuntimeRoot "logs"
New-Item -ItemType Directory -Force -Path $logRoot | Out-Null

if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) { throw "Executor device config not found: $configPath" }
if (-not (Test-Path -LiteralPath $credentialPath -PathType Leaf)) { throw "Executor DPAPI credential not found: $credentialPath" }

$config = Get-Content -Raw -Encoding UTF8 -LiteralPath $configPath | ConvertFrom-Json
if ($config.schema -ne "EXECUTOR_INSTALLED_DEVICE_V1") { throw "Unsupported Executor installed-device config schema" }

$secure = (Get-Content -Raw -Encoding ASCII -LiteralPath $credentialPath).Trim() | ConvertTo-SecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
}
finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}

$env:EXECUTOR_SERVICE_URL = [string]$config.service_url
$env:EXECUTOR_DEVICE_ID = [string]$config.device_id
$env:EXECUTOR_DEVICE_TOKEN = $token
$env:EXECUTOR_INSTALL_ROOT = [string]$config.payload_root
$env:EXECUTOR_TRUSTED_MANIFEST_SHA256 = [string]$config.manifest_sha256
if ($config.PSObject.Properties.Name -contains "ca_path" -and -not [string]::IsNullOrWhiteSpace([string]$config.ca_path)) {
  $env:EXECUTOR_DEVICE_CA_FILE = [string]$config.ca_path
}
if ($config.PSObject.Properties.Name -contains "tls_server_name" -and -not [string]::IsNullOrWhiteSpace([string]$config.tls_server_name)) {
  $env:EXECUTOR_DEVICE_TLS_SERVER_NAME = [string]$config.tls_server_name
}

$node = (Get-Command node -ErrorAction Stop).Source
$agent = Join-Path ([string]$config.agent_root) "dist\device-agent.js"
if (-not (Test-Path -LiteralPath $agent -PathType Leaf)) { throw "Executor device agent not found: $agent" }

$log = Join-Path $logRoot ("device-" + ([string]$config.device_id) + ".log")
$stdoutLog = Join-Path $logRoot ("device-" + ([string]$config.device_id) + ".out.log")
try {
  $agentArgument = '"' + $agent + '"'
  $process = Start-Process -FilePath $node -ArgumentList $agentArgument -WorkingDirectory ([string]$config.agent_root) -PassThru -Wait -WindowStyle Hidden -RedirectStandardOutput $stdoutLog -RedirectStandardError $log
  exit $process.ExitCode
}
finally {
  $env:EXECUTOR_DEVICE_TOKEN = $null
  $env:EXECUTOR_DEVICE_CA_FILE = $null
  $env:EXECUTOR_DEVICE_TLS_SERVER_NAME = $null
  $token = $null
}
