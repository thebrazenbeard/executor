# Read-only regression: extract just the credential parsing functions.
# Do NOT dot-source the restart script: that would invoke its control-plane effects.
$ErrorActionPreference = "Stop"
$scriptPath = Join-Path $PSScriptRoot "..\Restart-ExecutorControlPlane.ps1"
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile(
  $scriptPath, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -gt 0) { throw "Restart script does not parse" }
foreach ($name in @("Read-NextValue", "Read-TunnelCredentials")) {
  $found = @($ast.FindAll({
    param($node)
    $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
      $node.Name -eq $name
  }, $true))
  if ($found.Count -ne 1) { throw "Missing or duplicate function: $name" }
  . ([scriptblock]::Create($found[0].Extent.Text))
}
function Assert-Equal($actual, $expected, [string]$case) {
  if ($actual -cne $expected) { throw "$case expected [$expected], got [$actual]" }
}
Assert-Equal (Read-NextValue @("tunnel_id: stable-id") 0 "stable-id") "stable-id" "inline"
Assert-Equal (Read-NextValue @("tunnel_id:", "", "  # comment", "stable-id") 0 "") "stable-id" "multiline"
Assert-Equal (Read-NextValue @("tunnel_id:", "api_secret: secret-value") 0 "") "" "missing ID"
Assert-Equal (Read-NextValue @("api_secret:", "tunnel_id: valid-id") 0 "") "" "missing secret"
Write-Output "EXECUTOR_CREDENTIAL_PARSE_TEST_PASS"
