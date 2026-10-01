param(
  [string]$RuntimeRoot = (Join-Path $env:LOCALAPPDATA "Executor"),
  [switch]$Force
)
$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$ToolsRoot=Join-Path $RuntimeRoot "tools";$Destination=Join-Path $ToolsRoot "caddy.exe";$ManifestPath=Join-Path $ToolsRoot "caddy-install.json"
New-Item -ItemType Directory -Force -Path $ToolsRoot|Out-Null
if(-not$Force-and(Test-Path $Destination)-and(Test-Path $ManifestPath)){try{$m=Get-Content -Raw -Encoding UTF8 $ManifestPath|ConvertFrom-Json;$h=(Get-FileHash -Algorithm SHA512 $Destination).Hash.ToLowerInvariant();if($m.sha512-eq$h){[pscustomobject]@{status="cached";path=$Destination;version=$m.version;sha512=$h}|ConvertTo-Json;return}}catch{}}
$release=Invoke-RestMethod -UseBasicParsing -Uri "https://api.github.com/repos/caddyserver/caddy/releases/latest" -Headers @{"User-Agent"="Executor"}
$tag=[string]$release.tag_name;if($tag-notmatch'^v[0-9]+\.[0-9]+\.[0-9]+$'){throw "unexpected Caddy release tag"};$version=$tag.Substring(1)
$arch=[Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString();switch($arch){"X64"{$assetArch="amd64"}"Arm64"{$assetArch="arm64"}default{throw "unsupported Windows architecture: $arch"}}
$assetName=("caddy_{0}_windows_{1}.zip" -f $version,$assetArch);$checksumsName=("caddy_{0}_checksums.txt" -f $version)
$asset=@($release.assets|Where-Object{$_.name-eq$assetName})|Select-Object -First 1;$checksums=@($release.assets|Where-Object{$_.name-eq$checksumsName})|Select-Object -First 1
if(-not$asset-or-not$checksums){throw "Caddy release assets missing"}
$zip=Join-Path $ToolsRoot "$assetName.download.zip";$sum=Join-Path $ToolsRoot "$checksumsName.download";$extract=Join-Path $ToolsRoot ("caddy-extract-"+[Guid]::NewGuid().ToString("N"))
try{
 Invoke-WebRequest -UseBasicParsing -Uri ([string]$asset.browser_download_url) -OutFile $zip
 Invoke-WebRequest -UseBasicParsing -Uri ([string]$checksums.browser_download_url) -OutFile $sum
 $escaped=[regex]::Escape($assetName);$line=Get-Content $sum|Where-Object{$_-match("^([0-9a-fA-F]{128})\s+\*?"+$escaped+"$")}|Select-Object -First 1
 if(-not$line){throw "SHA512 checksum entry missing"};[void]($line-match'^([0-9a-fA-F]{128})');$expected=$Matches[1].ToLowerInvariant();$actual=(Get-FileHash -Algorithm SHA512 $zip).Hash.ToLowerInvariant();if($expected-ne$actual){throw "Caddy SHA512 mismatch"}
 Expand-Archive $zip $extract -Force;$exe=Get-ChildItem $extract -Filter caddy.exe -Recurse|Select-Object -First 1;if(-not$exe){throw "caddy.exe missing"};Copy-Item $exe.FullName $Destination -Force;$exeHash=(Get-FileHash -Algorithm SHA512 $Destination).Hash.ToLowerInvariant()
 [pscustomobject]@{schema="EXECUTOR_CADDY_INSTALL_V1";version=$version;archive=$assetName;archive_sha512=$actual;sha512=$exeHash;installed_utc=[DateTime]::UtcNow.ToString("o")}|ConvertTo-Json|Set-Content -Encoding UTF8 $ManifestPath
 [pscustomobject]@{status="installed";path=$Destination;version=$version;sha512=$exeHash}|ConvertTo-Json
}finally{Remove-Item $zip,$sum -Force -ErrorAction SilentlyContinue;Remove-Item $extract -Recurse -Force -ErrorAction SilentlyContinue}
