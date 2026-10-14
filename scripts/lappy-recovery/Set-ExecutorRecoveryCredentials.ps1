#requires -Version 5.1
# Run interactively in Lappy PowerShell. No secrets sent to ChatGPT.
[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$root=Join-Path $env:LOCALAPPDATA 'Executor\Recovery'
$path=Join-Path $root 'tunnel-credentials.dpapi.json'
if(Test-Path -LiteralPath $path -PathType Leaf){
  throw 'Existing DPAPI credentials already stored; refusing silent overwrite.'
}
$id=Read-Host -Prompt 'Existing Executor OpenAI tunnel ID (entered privately)' -AsSecureString
$key=Read-Host -Prompt 'Existing Executor tunnel API secret (entered privately)' -AsSecureString
if($id.Length -lt 8 -or $key.Length -lt 8){throw 'Credentials appear incomplete; nothing saved.'}
$bytes=New-Object byte[] 32
$rng=[Security.Cryptography.RandomNumberGenerator]::Create()
try{$rng.GetBytes($bytes)}finally{$rng.Dispose()}
$clientToken=[Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_')
$secureClient=ConvertTo-SecureString -String $clientToken -AsPlainText -Force
try{
  $record=[ordered]@{
    schema='VERA_EXECUTOR_TUNNEL_DPAPI_V1'
    protection='DPAPI_CURRENT_WINDOWS_USER'
    tunnel_id_dpapi=($id|ConvertFrom-SecureString)
    tunnel_secret_dpapi=($key|ConvertFrom-SecureString)
    client_token_dpapi=($secureClient|ConvertFrom-SecureString)
  }
  $tmp=Join-Path $root ('creds.'+[Guid]::NewGuid().ToString('N')+'.tmp')
  try{
    $record|ConvertTo-Json -Depth 3|Set-Content -LiteralPath $tmp -Encoding UTF8
    Move-Item -LiteralPath $tmp -Destination $path -ErrorAction Stop
  }finally{
    Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
  }
  Write-Output 'DPAPI_CREDENTIALS_SEALED_FOR_CURRENT_WINDOWS_USER'
  Write-Output 'Stored tunnel identity reused; new client bearer is internal to local Executor ingress.'
}finally{
  $id.Dispose();$key.Dispose();$secureClient.Dispose()
  $clientToken=$null
  [Array]::Clear($bytes,0,$bytes.Length)
}