param()
$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot 'Start-ExecutorInstalledDevice.ps1'
$root = Join-Path $env:TEMP ('executor-mutex-test-' + [guid]::NewGuid().ToString('N'))
$deviceId = 'mutex-test-' + [guid]::NewGuid().ToString('N')
$mutex = $null
$held = $false
try {
  New-Item -ItemType Directory -Force -Path $root | Out-Null
  [pscustomobject]@{ schema = 'EXECUTOR_INSTALLED_DEVICE_V1'; device_id = $deviceId } |
    ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $root 'device.json')
  Set-Content -Encoding ASCII (Join-Path $root 'device-token.dpapi') 'invalid-test-placeholder'
  $material = [Text.Encoding]::UTF8.GetBytes(([IO.Path]::GetFullPath($root).ToLowerInvariant() + '|' + $deviceId))
  $sha = [Security.Cryptography.SHA256]::Create()
  try { $hash = $sha.ComputeHash($material) }
  finally { $sha.Dispose() }
  $suffix = ([BitConverter]::ToString($hash)).Replace('-', '').Substring(0, 32)
  $mutex = New-Object System.Threading.Mutex($false, ('Local\ExecutorDevice-' + $suffix))
  $held = $mutex.WaitOne(0)
  if (-not $held) { throw 'Synthetic test mutex already held' }
  $stdout = Join-Path $root 'stdout.txt'
  $stderr = Join-Path $root 'stderr.txt'
  $child = Start-Process -FilePath 'powershell.exe' -ArgumentList @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    ('"' + $source + '"'), '-RuntimeRoot', ('"' + $root + '"')
  ) -Wait -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
  $message = Get-Content -Raw -LiteralPath $stderr
  if ($child.ExitCode -ne 20) { throw ("Blocked mutex must exit 20, observed " + $child.ExitCode) }
  if ($message -notmatch 'NOT verified') { throw 'Held-lock branch did not reject health claim' }
  Write-Output 'PASS launcher lock held => exit20, health unverified, no token used'
}
finally {
  if ($held) { $mutex.ReleaseMutex() }
  if ($mutex) { $mutex.Dispose() }
  if (Test-Path $root) { Remove-Item -LiteralPath $root -Recurse -Force }
}
