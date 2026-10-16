$ErrorActionPreference='Stop'
$source=Join-Path (Split-Path $PSScriptRoot -Parent) 'Get-ExecutorControlPlaneStatus.ps1'
$t=$null;$err=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($source,[ref]$t,[ref]$err)
if($err.Count){throw 'Parser error'}
$functions=@($ast.FindAll({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Get-RecordedProcessState'},$true))
if($functions.Count -ne 1){throw 'Expected exact process function'}
. ([ScriptBlock]::Create($functions[0].Extent.Text))
$script:process=[pscustomobject]@{Name='node.exe';CommandLine=$null}
$script:sockets=@()
$script:socketFailure=$false
function Get-CimInstance {
  param([string]$ClassName,[string]$Filter)
  if($ClassName -ne 'Win32_Process'){throw 'unexpected CIM class'}
  return $script:process
}
function Get-NetTCPConnection {
  param([string]$State,[int]$LocalPort)
  if($script:socketFailure){throw 'synthetic socket query failed'}
  $matching=@($script:sockets|Where-Object {$_.LocalPort -eq $LocalPort -and $State -eq 'Listen'})
  return $matching
}
function AddSocket([int]$port,[int]$ownerId,[string]$hostAddress='127.0.0.1'){
  $script:sockets += [pscustomobject]@{LocalPort=$port;OwningProcess=$ownerId;LocalAddress=$hostAddress}
}
$script:sockets=@()
AddSocket 19887 123
AddSocket 19888 123
$pass=Get-RecordedProcessState 123 'dist/server.js' 'node.exe' @(19887,19888)
if(-not $pass.identity_match -or $pass.identity_source -ne 'LOOPBACK_SOCKET_OWNER'){throw 'Expected fallback acceptance'}
Write-Output 'PASS unreadable command line + exact process and two owned loopback listeners'
$script:sockets=@()
AddSocket 19887 456
AddSocket 19888 456
if((Get-RecordedProcessState 123 'dist/server.js' 'node.exe' @(19887,19888)).identity_match){throw 'PID mismatch incorrectly passes'}
Write-Output 'PASS mismatched PID fails'
$script:sockets=@()
AddSocket 19887 123
if((Get-RecordedProcessState 123 'dist/server.js' 'node.exe' @(19887,19888)).identity_match){throw 'Missing listener incorrectly passes'}
Write-Output 'PASS missing listener fails'
$script:sockets=@()
AddSocket 19887 123 '0.0.0.0'
AddSocket 19888 123 '0.0.0.0'
if((Get-RecordedProcessState 123 'dist/server.js' 'node.exe' @(19887,19888)).identity_match){throw 'Nonloopback listener incorrectly passes'}
Write-Output 'PASS non-loopback listener fails'
$script:sockets=@()
AddSocket 19887 123
AddSocket 19888 123
$script:process=[pscustomobject]@{Name='unrelated.exe';CommandLine=$null}
if((Get-RecordedProcessState 123 'dist/server.js' 'node.exe' @(19887,19888)).identity_match){throw 'Wrong executable incorrectly passes'}
Write-Output 'PASS unexpected executable name fails'
$script:process=[pscustomobject]@{Name='node.exe';CommandLine='node.exe unexpected.js'}
if((Get-RecordedProcessState 123 'dist/server.js' 'node.exe' @(19887,19888)).identity_match){throw 'Visible wrong command incorrectly passes'}
Write-Output 'PASS readable mismatched command line fails even with correct socket owner'
$script:process=[pscustomobject]@{Name='node.exe';CommandLine=$null}
$script:socketFailure=$true
if((Get-RecordedProcessState 123 'dist/server.js' 'node.exe' @(19887,19888)).identity_match){throw 'Socket query failure incorrectly passes'}
Write-Output 'PASS socket query failure fails closed'
$script:socketFailure=$false
$script:process=$null
if((Get-RecordedProcessState 123 'dist/server.js' 'node.exe' @(19887,19888)).identity_match){throw 'Absent process incorrectly passes'}
Write-Output 'PASS missing process fails'
