param(
  [string]$RuntimeRoot = (Join-Path $env:LOCALAPPDATA "Executor"),
  [string]$OpenAITunnelCredentialsFile = "",
  [string]$DeviceId = "",
  [string]$ProfilePath = (Join-Path $PSScriptRoot "..\deploy\tunnel-client.executor.example.yaml"),
  [string]$TunnelClient = "tunnel-client",
  [string]$CloudflaredPath = ""
)

$ErrorActionPreference = "Stop"
$StatePath = Join-Path $RuntimeRoot "zero-cost-state.json"

if ([string]::IsNullOrWhiteSpace($OpenAITunnelCredentialsFile) -and (Test-Path -LiteralPath $StatePath -PathType Leaf)) {
  try {
    $oldState = Get-Content -Raw -Encoding UTF8 -LiteralPath $StatePath | ConvertFrom-Json
    if ($oldState.PSObject.Properties.Name -contains "credential_file") {
      $OpenAITunnelCredentialsFile = [string]$oldState.credential_file
    }
  } catch {}
}

& (Join-Path $PSScriptRoot "Stop-ExecutorZeroCost.ps1") -RuntimeRoot $RuntimeRoot
& (Join-Path $PSScriptRoot "Start-ExecutorZeroCost.ps1") -RuntimeRoot $RuntimeRoot -OpenAITunnelCredentialsFile $OpenAITunnelCredentialsFile -DeviceId $DeviceId -ProfilePath $ProfilePath -TunnelClient $TunnelClient -CloudflaredPath $CloudflaredPath
