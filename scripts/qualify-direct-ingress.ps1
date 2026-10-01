$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$root = Join-Path $env:RUNNER_TEMP ("executor-direct-" + [Guid]::NewGuid().ToString("N"))
$server = $null
$caddy = $null
$oldData = $env:XDG_DATA_HOME
$oldConfig = $env:XDG_CONFIG_HOME

try {
  New-Item -ItemType Directory -Force -Path $root | Out-Null
  $env:PORT = "18991"
  $env:HOST = "127.0.0.1"
  $env:EXECUTOR_DEVICE_PORT = "18992"
  $env:EXECUTOR_DEVICE_HOST = "127.0.0.1"
  $env:EXECUTOR_CLIENT_TOKEN = "direct-ci-client"
  $env:EXECUTOR_DEVICE_TOKEN = "direct-ci-device"
  $env:EXECUTOR_EXECUTION_CAPACITY = "8"
  $env:EXECUTOR_LOGIC_CAPACITY = "64"

  $server = Start-Process node -ArgumentList "dist/server.js" -PassThru -NoNewWindow
  $ready = $false
  for ($i=0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 250
    try {
      $h = Invoke-RestMethod "http://127.0.0.1:18992/health" -TimeoutSec 2
      if ($h.role -eq "device-ingress") { $ready = $true; break }
    } catch {}
  }
  if (-not $ready) { throw "Executor device ingress did not become healthy" }

  $installed = (& .\scripts\Install-ExecutorCaddy.ps1 -RuntimeRoot $root | Out-String | ConvertFrom-Json)
  $caddyExe = [string]$installed.path
  $dataHome = Join-Path $root "caddy-data"
  $configHome = Join-Path $root "caddy-config"
  New-Item -ItemType Directory -Force -Path $dataHome,$configHome | Out-Null
  $env:XDG_DATA_HOME = $dataHome
  $env:XDG_CONFIG_HOME = $configHome

  $caddyfile = Join-Path $root "Caddyfile"
  @"
{
  admin off
  auto_https disable_redirects
}
https://127.0.0.1:19443 {
  tls internal
  reverse_proxy 127.0.0.1:18992
}
"@ | Set-Content -LiteralPath $caddyfile -Encoding UTF8

  $caddy = Start-Process -FilePath $caddyExe -ArgumentList @("run","--config",$caddyfile,"--adapter","caddyfile") -PassThru -NoNewWindow
  $ca = Join-Path $dataHome "caddy\pki\authorities\local\root.crt"
  for ($i=0; $i -lt 80 -and -not (Test-Path -LiteralPath $ca -PathType Leaf); $i++) { Start-Sleep -Milliseconds 250 }
  if (-not (Test-Path -LiteralPath $ca -PathType Leaf)) { throw "Caddy internal CA root was not created" }

  $env:EXECUTOR_DIRECT_QUAL_URL = "https://127.0.0.1:19443"
  $env:EXECUTOR_DIRECT_QUAL_CA = $ca
  $env:EXECUTOR_DIRECT_QUAL_TOKEN = "direct-ci-device"
  node scripts/qualify-direct-ingress.mjs
  if ($LASTEXITCODE -ne 0) { throw "direct WSS qualification failed" }
}
finally {
  if ($caddy -and -not $caddy.HasExited) { Stop-Process -Id $caddy.Id -Force -ErrorAction SilentlyContinue }
  if ($server -and -not $server.HasExited) { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue }
  $env:XDG_DATA_HOME = $oldData
  $env:XDG_CONFIG_HOME = $oldConfig
  if (Test-Path -LiteralPath $root) { Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue }
}
