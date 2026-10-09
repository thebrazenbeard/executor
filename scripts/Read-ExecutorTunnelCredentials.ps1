# Parse an existing tunnel credential profile; this helper never starts or stops services.
function Read-NextValue([string[]]$Lines,[int]$Index,[string]$Inline) {
  if (-not [string]::IsNullOrWhiteSpace($Inline)) { return $Inline.Trim() }
  for ($i = $Index + 1; $i -lt $Lines.Count; $i++) {
    $candidate = [string]$Lines[$i]
    if ([string]::IsNullOrWhiteSpace($candidate) -or $candidate.TrimStart().StartsWith("#")) { continue }
    # A missing scalar must not consume the next YAML key as a credential.
    # Otherwise a broken profile can pass preflight and stop a healthy session.
    if ($candidate -match '^\s*[A-Za-z_][A-Za-z0-9_-]*\s*:') { return "" }
    return $candidate.Trim()
  }
  return ""
}

function Read-TunnelCredentials([string]$Path) {
  if ([string]::IsNullOrWhiteSpace($Path) -or -not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    return @{ id = ""; secret = "" }
  }
  $lines = @(Get-Content -LiteralPath $Path -Encoding UTF8)
  $id = ""
  $secret = ""
  $sawId = $false
  $sawSecret = $false
  for ($i = 0; $i -lt $lines.Count; $i++) {
    $line = [string]$lines[$i]
    if ($line -match '^\s*tunnel[_\s-]*id\s*:\s*(.*)$') {
      if ($sawId) { throw "duplicate tunnel ID field in credential file" }
      $sawId = $true
      $id = Read-NextValue $lines $i $Matches[1]
    }
    elseif ($line -match '^\s*(api[_\s-]*)?secret([_\s-]*key)?\s*:\s*(.*)$') {
      if ($sawSecret) { throw "duplicate tunnel secret field in credential file" }
      $sawSecret = $true
      $secret = Read-NextValue $lines $i $Matches[3]
    }
  }
  return @{ id = $id; secret = $secret }
}

