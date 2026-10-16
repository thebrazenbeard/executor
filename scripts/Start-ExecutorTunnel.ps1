param(
  [string]$TunnelClient = "tunnel-client",
  [string]$ProfilePath = (Join-Path $PSScriptRoot "..\deploy\tunnel-client.executor.example.yaml")
)

$ErrorActionPreference = "Stop"

$required = @(
  "EXECUTOR_TUNNEL_ID",
  "EXECUTOR_TUNNEL_API_SECRET",
  "EXECUTOR_CLIENT_TOKEN"
)
foreach ($name in $required) {
  if (-not [Environment]::GetEnvironmentVariable($name)) {
    throw "$name is required"
  }
}

$health = Invoke-RestMethod -Uri "http://127.0.0.1:8787/health" -Method Get
if ($health.status -ne "ok") {
  throw "Executor is not healthy on loopback"
}

$env:CONTROL_PLANE_TUNNEL_ID = $env:EXECUTOR_TUNNEL_ID
$env:CONTROL_PLANE_API_KEY = $env:EXECUTOR_TUNNEL_API_SECRET
$env:MCP_EXTRA_HEADERS = "Authorization: Bearer $env:EXECUTOR_CLIENT_TOKEN"

& $TunnelClient doctor --profile-file $ProfilePath --explain
if ($LASTEXITCODE -ne 0) {
  throw "tunnel-client doctor failed"
}

& $TunnelClient run --profile-file $ProfilePath
exit $LASTEXITCODE
