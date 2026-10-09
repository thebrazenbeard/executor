$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot "Read-ExecutorTunnelCredentials.ps1")

$root = Join-Path ([IO.Path]::GetTempPath()) ("executor-parser-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $root -Force | Out-Null
$file = Join-Path $root "fixture.yaml"

function Set-Fixture([string]$Value) {
  Set-Content -LiteralPath $file -Value $Value -Encoding UTF8
}

function Assert-Credentials([string]$Id, [string]$Secret) {
  $actual = Read-TunnelCredentials $file
  if ($actual.id -cne $Id -or $actual.secret -cne $Secret) {
    throw "credential fixture parsed an unexpected scalar"
  }
}

function Assert-DuplicateRejected([string]$Value) {
  Set-Fixture $Value
  try {
    $null = Read-TunnelCredentials $file
  }
  catch {
    if ($_.Exception.Message -notmatch "duplicate tunnel") { throw }
    return
  }
  throw "duplicate tunnel credentials should have been rejected"
}

try {
  Set-Fixture "tunnel_id: example-id`nsecret: example-secret"
  Assert-Credentials "example-id" "example-secret"

  Set-Fixture "tunnel_id:`n  nested-id`n# comment`nsecret:`n  nested-secret"
  Assert-Credentials "nested-id" "nested-secret"

  Set-Fixture "tunnel_id:`nsecret: example-secret"
  Assert-Credentials "" "example-secret"

  Assert-DuplicateRejected "tunnel_id: first`ntunnel_id: second`nsecret: example-secret"
  Assert-DuplicateRejected "tunnel_id: example-id`nsecret: first`nsecret: second"
  Write-Output "EXECUTOR_TUNNEL_CREDENTIALS_TEST_PASS"
}
finally {
  Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}
