param(
  [string]$RuntimeRoot = (Join-Path $env:LOCALAPPDATA "Executor"),
  [switch]$Force
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$ToolsRoot = Join-Path $RuntimeRoot "tools"
$Destination = Join-Path $ToolsRoot "tunnel-client.exe"
$ManifestPath = Join-Path $ToolsRoot "tunnel-client-install.json"
New-Item -ItemType Directory -Force -Path $ToolsRoot | Out-Null

if (-not $Force -and (Test-Path -LiteralPath $Destination -PathType Leaf) -and (Test-Path -LiteralPath $ManifestPath -PathType Leaf)) {
  try {
    $manifest = Get-Content -Raw -Encoding UTF8 -LiteralPath $ManifestPath | ConvertFrom-Json
    $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $Destination).Hash.ToLowerInvariant()
    if ($manifest.sha256 -eq $actual) {
      [pscustomobject]@{
        status = "cached"
        path = $Destination
        version = $manifest.version
        sha256 = $actual
      } | ConvertTo-Json -Depth 4
      return
    }
  }
  catch {}
}

$curl = (Get-Command curl.exe -ErrorAction Stop).Source
$latestUrl = "https://github.com/openai/tunnel-client/releases/latest"
$effective = (& $curl -sS -L -o NUL -w "%{url_effective}" $latestUrl).Trim()
if ($LASTEXITCODE -ne 0) { throw "failed to resolve latest OpenAI tunnel-client release" }
if ($effective -notmatch '/tag/(v[0-9]+\.[0-9]+\.[0-9]+)$') {
  throw "unexpected OpenAI tunnel-client latest release redirect: $effective"
}
$tag = $Matches[1]
$version = $tag.Substring(1)

$arch = [Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
switch ($arch) {
  "X64" { $assetArch = "amd64" }
  "Arm64" { $assetArch = "arm64" }
  default { throw "unsupported Windows architecture for automatic tunnel-client install: $arch" }
}

$assetName = ("tunnel-client-v{0}-windows-{1}.zip" -f $version,$assetArch)
$checksumsName = "SHA256SUMS.txt"
$releaseBase = "https://github.com/openai/tunnel-client/releases/download/$tag"
$assetUrl = "$releaseBase/$assetName"
$checksumsUrl = "$releaseBase/$checksumsName"

$zip = Join-Path $ToolsRoot "$assetName.download.zip"
$sumFile = Join-Path $ToolsRoot "$checksumsName.download"
$extract = Join-Path $ToolsRoot ("tunnel-client-extract-" + [Guid]::NewGuid().ToString("N"))

try {
  Invoke-WebRequest -UseBasicParsing -Uri $assetUrl -OutFile $zip
  Invoke-WebRequest -UseBasicParsing -Uri $checksumsUrl -OutFile $sumFile

  $escaped = [regex]::Escape($assetName)
  $line = Get-Content -LiteralPath $sumFile | Where-Object {
    $_ -match ("^([0-9a-fA-F]{64})\s+\*?" + $escaped + "$")
  } | Select-Object -First 1
  if (-not $line) { throw "SHA256 checksum entry not found for $assetName" }

  [void]($line -match '^([0-9a-fA-F]{64})')
  $expected = $Matches[1].ToLowerInvariant()
  $actualArchive = (Get-FileHash -Algorithm SHA256 -LiteralPath $zip).Hash.ToLowerInvariant()
  if ($expected -ne $actualArchive) { throw "OpenAI tunnel-client release SHA256 mismatch" }

  Expand-Archive -LiteralPath $zip -DestinationPath $extract -Force
  $exe = Get-ChildItem -LiteralPath $extract -Filter "tunnel-client.exe" -Recurse | Select-Object -First 1
  if (-not $exe) { throw "tunnel-client.exe missing from verified OpenAI release archive" }

  Copy-Item -LiteralPath $exe.FullName -Destination $Destination -Force
  $exeSha = (Get-FileHash -Algorithm SHA256 -LiteralPath $Destination).Hash.ToLowerInvariant()

  [pscustomobject]@{
    schema = "EXECUTOR_OPENAI_TUNNEL_CLIENT_INSTALL_V1"
    upstream_repository = "https://github.com/openai/tunnel-client"
    version = $version
    archive = $assetName
    archive_sha256 = $actualArchive
    sha256 = $exeSha
    installed_utc = [DateTime]::UtcNow.ToString("o")
  } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $ManifestPath -Encoding UTF8

  [pscustomobject]@{
    status = "installed"
    path = $Destination
    version = $version
    sha256 = $exeSha
  } | ConvertTo-Json -Depth 4
}
finally {
  Remove-Item -LiteralPath $zip,$sumFile -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $extract -Recurse -Force -ErrorAction SilentlyContinue
}
