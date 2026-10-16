param(
  [string]$RuntimeRoot = (Join-Path $env:LOCALAPPDATA "Executor"),
  [switch]$Force
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$ToolsRoot = Join-Path $RuntimeRoot "tools"
$Destination = Join-Path $ToolsRoot "caddy.exe"
$ManifestPath = Join-Path $ToolsRoot "caddy-install.json"
New-Item -ItemType Directory -Force -Path $ToolsRoot | Out-Null

if (-not $Force -and (Test-Path -LiteralPath $Destination -PathType Leaf) -and (Test-Path -LiteralPath $ManifestPath -PathType Leaf)) {
  try {
    $manifest = Get-Content -Raw -Encoding UTF8 -LiteralPath $ManifestPath | ConvertFrom-Json
    $actual = (Get-FileHash -Algorithm SHA512 -LiteralPath $Destination).Hash.ToLowerInvariant()
    if ($manifest.sha512 -eq $actual) {
      [pscustomobject]@{
        status = "cached"
        path = $Destination
        version = $manifest.version
        sha512 = $actual
      } | ConvertTo-Json -Depth 4
      return
    }
  }
  catch {}
}

$curl = (Get-Command curl.exe -ErrorAction Stop).Source
$latestUrl = "https://github.com/caddyserver/caddy/releases/latest"
$effective = (& $curl -sS -L -o NUL -w "%{url_effective}" $latestUrl).Trim()
if ($LASTEXITCODE -ne 0) { throw "failed to resolve latest Caddy release" }
if ($effective -notmatch '/tag/(v[0-9]+\.[0-9]+\.[0-9]+)$') {
  throw "unexpected Caddy latest release redirect: $effective"
}
$tag = $Matches[1]
$version = $tag.Substring(1)

$arch = [Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
switch ($arch) {
  "X64" { $assetArch = "amd64" }
  "Arm64" { $assetArch = "arm64" }
  default { throw "unsupported Windows architecture: $arch" }
}

$assetName = ("caddy_{0}_windows_{1}.zip" -f $version,$assetArch)
$checksumsName = ("caddy_{0}_checksums.txt" -f $version)
$releaseBase = "https://github.com/caddyserver/caddy/releases/download/$tag"
$assetUrl = "$releaseBase/$assetName"
$checksumsUrl = "$releaseBase/$checksumsName"

$zip = Join-Path $ToolsRoot "$assetName.download.zip"
$sum = Join-Path $ToolsRoot "$checksumsName.download"
$extract = Join-Path $ToolsRoot ("caddy-extract-" + [Guid]::NewGuid().ToString("N"))

try {
  Invoke-WebRequest -UseBasicParsing -Uri $assetUrl -OutFile $zip
  Invoke-WebRequest -UseBasicParsing -Uri $checksumsUrl -OutFile $sum

  $escaped = [regex]::Escape($assetName)
  $line = Get-Content -LiteralPath $sum | Where-Object {
    $_ -match ("^([0-9a-fA-F]{128})\s+\*?" + $escaped + "$")
  } | Select-Object -First 1
  if (-not $line) { throw "SHA512 checksum entry missing for $assetName" }

  [void]($line -match '^([0-9a-fA-F]{128})')
  $expected = $Matches[1].ToLowerInvariant()
  $actualArchive = (Get-FileHash -Algorithm SHA512 -LiteralPath $zip).Hash.ToLowerInvariant()
  if ($expected -ne $actualArchive) { throw "Caddy SHA512 mismatch" }

  Expand-Archive -LiteralPath $zip -DestinationPath $extract -Force
  $exe = Get-ChildItem -LiteralPath $extract -Filter "caddy.exe" -Recurse | Select-Object -First 1
  if (-not $exe) { throw "caddy.exe missing from verified release archive" }

  Copy-Item -LiteralPath $exe.FullName -Destination $Destination -Force
  $exeHash = (Get-FileHash -Algorithm SHA512 -LiteralPath $Destination).Hash.ToLowerInvariant()

  [pscustomobject]@{
    schema = "EXECUTOR_CADDY_INSTALL_V1"
    upstream_repository = "https://github.com/caddyserver/caddy"
    version = $version
    archive = $assetName
    archive_sha512 = $actualArchive
    sha512 = $exeHash
    installed_utc = [DateTime]::UtcNow.ToString("o")
  } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $ManifestPath -Encoding UTF8

  [pscustomobject]@{
    status = "installed"
    path = $Destination
    version = $version
    sha512 = $exeHash
  } | ConvertTo-Json -Depth 4
}
finally {
  Remove-Item -LiteralPath $zip,$sum -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $extract -Recurse -Force -ErrorAction SilentlyContinue
}
