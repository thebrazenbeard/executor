param(
  [string]$InstallRoot = "C:\ProgramData\Executor\DesktopCommanderMCP",
  [switch]$RunUpstreamTests
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$UpstreamRepository = "https://github.com/wonderwhy-er/DesktopCommanderMCP.git"
$UpstreamCommit = "550a0b3e31da18b7cf25e87ed840e3d953b6da42"
$ExpectedVersion = "0.2.51"

function Require-Command([string]$Name) {
  return (Get-Command $Name -ErrorAction Stop).Source
}

function Initialize-ExecutorRipgrepDownloadCache([string]$NodeExecutable) {
  $packageVersion = "1.17.0"
  $releaseVersion = "v15.0.0"
  $arch = (& $NodeExecutable -p "process.arch").Trim()

  switch ($arch) {
    "x64" {
      $target = "x86_64-pc-windows-msvc"
      $expectedSha256 = "5b7f6a3020739ac4bdf2c32300f14388456361bea054d35270a18a3c9949b932"
    }
    "arm64" {
      $target = "aarch64-pc-windows-msvc"
      $expectedSha256 = "77757a3a8fc99705062e2594d4bbf48aafaee0faca65816455edb0d671bd534e"
    }
    "ia32" {
      $target = "i686-pc-windows-msvc"
      $expectedSha256 = "4f98e8fcdfc2206b831cb8032f8a1befbb99119a57033c08f244874d52345416"
    }
    default {
      throw "unsupported Node architecture for pinned ripgrep bootstrap: $arch"
    }
  }

  $assetName = "ripgrep-$releaseVersion-$target.zip"
  $cacheDir = Join-Path ([IO.Path]::GetTempPath()) "vscode-ripgrep-cache-$packageVersion"
  $assetPath = Join-Path $cacheDir $assetName

  if (Test-Path -LiteralPath $assetPath -PathType Leaf) {
    $cachedSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $assetPath).Hash.ToLowerInvariant()
    if ($cachedSha256 -eq $expectedSha256) { return }
    Remove-Item -LiteralPath $assetPath -Force
  }

  New-Item -ItemType Directory -Force -Path $cacheDir | Out-Null
  $downloadPath = "$assetPath.download.$([Guid]::NewGuid().ToString("N"))"
  $assetUrl = "https://github.com/microsoft/ripgrep-prebuilt/releases/download/$releaseVersion/$assetName"

  try {
    Invoke-WebRequest -UseBasicParsing -Uri $assetUrl -OutFile $downloadPath
    $downloadSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $downloadPath).Hash.ToLowerInvariant()
    if ($downloadSha256 -ne $expectedSha256) {
      throw "ripgrep bootstrap hash mismatch: expected $expectedSha256 got $downloadSha256"
    }
    Move-Item -LiteralPath $downloadPath -Destination $assetPath -Force
  }
  finally {
    if (Test-Path -LiteralPath $downloadPath) {
      Remove-Item -LiteralPath $downloadPath -Force -ErrorAction SilentlyContinue
    }
  }
}


$git = Require-Command "git"
$node = Require-Command "node"
$npm = Require-Command "npm"

$parent = Split-Path -Parent $InstallRoot
New-Item -ItemType Directory -Force -Path $parent | Out-Null

$staging = Join-Path $parent ("DesktopCommanderMCP.staging." + [Guid]::NewGuid().ToString("N"))
$backup = $null

try {
  & $git clone --no-tags $UpstreamRepository $staging
  if ($LASTEXITCODE -ne 0) { throw "Desktop Commander clone failed" }

  Push-Location $staging
  try {
    & $git checkout --detach $UpstreamCommit
    if ($LASTEXITCODE -ne 0) { throw "Desktop Commander checkout failed" }

    $head = (& $git rev-parse HEAD).Trim()
    if ($head -ne $UpstreamCommit) {
      throw "Desktop Commander source mismatch: expected $UpstreamCommit got $head"
    }

    $package = Get-Content -Raw -Encoding UTF8 "package.json" | ConvertFrom-Json
    if ($package.name -ne "@wonderwhy-er/desktop-commander") {
      throw "unexpected Desktop Commander package name: $($package.name)"
    }
    if ($package.version -ne $ExpectedVersion) {
      throw "unexpected Desktop Commander version: $($package.version)"
    }

    & $npm ci --ignore-scripts --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw "Desktop Commander npm ci failed" }

    Initialize-ExecutorRipgrepDownloadCache -NodeExecutable $node

    & $npm rebuild "@vscode/ripgrep"
    if ($LASTEXITCODE -ne 0) { throw "Desktop Commander ripgrep rebuild failed" }

    & $npm run build
    if ($LASTEXITCODE -ne 0) { throw "Desktop Commander build failed" }

    if ($RunUpstreamTests) {
      & $npm test
      if ($LASTEXITCODE -ne 0) { throw "Desktop Commander upstream tests failed" }
    }

    $entrypoint = Join-Path $staging "dist\index.js"
    if (-not (Test-Path -LiteralPath $entrypoint -PathType Leaf)) {
      throw "built Desktop Commander entrypoint is missing"
    }

    $runtime = Join-Path $staging "executor-runtime"
    New-Item -ItemType Directory -Force -Path $runtime | Out-Null
    $runtimeNode = Join-Path $runtime "node.exe"
    Copy-Item -LiteralPath $node -Destination $runtimeNode -Force

    $manifest = [ordered]@{
      schema = "EXECUTOR_DESKTOP_COMMANDER_PAYLOAD_V1"
      upstream_repository = $UpstreamRepository
      upstream_commit = $UpstreamCommit
      upstream_version = $ExpectedVersion
      node_executable_relative = "executor-runtime\node.exe"
      node_sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $runtimeNode).Hash.ToLowerInvariant()
      entrypoint_relative = "dist\index.js"
      entrypoint_sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $entrypoint).Hash.ToLowerInvariant()
      mcp_args = @("dist\index.js", "--no-onboarding")
      full_authority_only = $true
      unrestricted_command_string_shell = $true
      executor_execution_lanes = 8
      executor_logic_lanes = 64
    }

    $manifestPath = Join-Path $staging "executor-desktop-commander.manifest.json"
    $manifest | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 $manifestPath
  }
  finally {
    Pop-Location
  }

  if (Test-Path -LiteralPath $InstallRoot) {
    $backup = "$InstallRoot.backup.$([DateTime]::UtcNow.ToString('yyyyMMddHHmmss'))"
    Move-Item -LiteralPath $InstallRoot -Destination $backup
  }

  Move-Item -LiteralPath $staging -Destination $InstallRoot

  if ($backup -and (Test-Path -LiteralPath $backup)) {
    Remove-Item -LiteralPath $backup -Recurse -Force
  }

  $installedManifest = Join-Path $InstallRoot "executor-desktop-commander.manifest.json"
  $manifestHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $installedManifest).Hash.ToLowerInvariant()
  $installed = Get-Content -Raw -Encoding UTF8 $installedManifest | ConvertFrom-Json

  [pscustomobject]@{
    status = "installed"
    install_root = $InstallRoot
    manifest_sha256 = $manifestHash
    upstream_commit = $installed.upstream_commit
    upstream_version = $installed.upstream_version
    full_authority_only = $installed.full_authority_only
    execution_lanes = 8
    logic_lanes = 64
  } | ConvertTo-Json -Depth 4
}
catch {
  if (Test-Path -LiteralPath $staging) {
    Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
  }
  if ($backup -and (Test-Path -LiteralPath $backup) -and -not (Test-Path -LiteralPath $InstallRoot)) {
    Move-Item -LiteralPath $backup -Destination $InstallRoot
  }
  throw
}
