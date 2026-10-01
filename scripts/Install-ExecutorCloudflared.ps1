param(
  [string]$Destination = (Join-Path (Join-Path $env:LOCALAPPDATA "Executor") "tools\cloudflared.exe"),
  [switch]$Force
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Assert-CloudflareBinary([string]$Path) {
  $signature = Get-AuthenticodeSignature -FilePath $Path
  if ($signature.Status -ne "Valid") {
    throw "cloudflared Authenticode signature is not valid: $($signature.Status)"
  }
  $subject = [string]$signature.SignerCertificate.Subject
  if ($subject -notmatch "Cloudflare") {
    throw "cloudflared signer is not Cloudflare: $subject"
  }
  return $signature
}

if (-not $Force) {
  $existing = Get-Command cloudflared.exe -ErrorAction SilentlyContinue
  if (-not $existing) { $existing = Get-Command cloudflared -ErrorAction SilentlyContinue }
  if ($existing) {
    $resolved = $existing.Source
    $sig = Assert-CloudflareBinary -Path $resolved
    [pscustomobject]@{
      status = "existing"
      path = $resolved
      signer = [string]$sig.SignerCertificate.Subject
    } | ConvertTo-Json -Depth 3
    return
  }

  if (Test-Path -LiteralPath $Destination -PathType Leaf) {
    $sig = Assert-CloudflareBinary -Path $Destination
    [pscustomobject]@{
      status = "installed"
      path = $Destination
      signer = [string]$sig.SignerCertificate.Subject
    } | ConvertTo-Json -Depth 3
    return
  }
}

$arch = [Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
switch ($arch) {
  "X64" { $asset = "cloudflared-windows-amd64.exe" }
  "X86" { $asset = "cloudflared-windows-386.exe" }
  default { throw "Automatic cloudflared download supports Windows X64/X86 only; install a signed cloudflared binary on PATH for architecture $arch" }
}

$parent = Split-Path -Parent $Destination
New-Item -ItemType Directory -Force -Path $parent | Out-Null
$temp = "$Destination.download.$([Guid]::NewGuid().ToString("N"))"
$url = "https://github.com/cloudflare/cloudflared/releases/latest/download/$asset"

try {
  Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $temp
  $sig = Assert-CloudflareBinary -Path $temp
  Move-Item -LiteralPath $temp -Destination $Destination -Force

  [pscustomobject]@{
    status = "installed"
    path = $Destination
    signer = [string]$sig.SignerCertificate.Subject
  } | ConvertTo-Json -Depth 3
}
finally {
  Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue
}
