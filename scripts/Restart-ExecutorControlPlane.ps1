param(
  [string]$RuntimeRoot = (Join-Path $env:LOCALAPPDATA "Executor"),
  [string]$ProfilePath = (Join-Path $PSScriptRoot "..\deploy\tunnel-client.executor.example.yaml"),
  [string]$TunnelClient = "tunnel-client"
)

$ErrorActionPreference = "Stop"

& (Join-Path $PSScriptRoot "Stop-ExecutorControlPlane.ps1") -RuntimeRoot $RuntimeRoot
& (Join-Path $PSScriptRoot "Start-ExecutorControlPlane.ps1") -RuntimeRoot $RuntimeRoot -ProfilePath $ProfilePath -TunnelClient $TunnelClient
