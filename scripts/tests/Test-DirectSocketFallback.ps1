$ErrorActionPreference='Stop'
$p=Join-Path (Split-Path $PSScriptRoot -Parent) 'Get-ExecutorDirectStatus.ps1'
$t=$null;$errs=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($p,[ref]$t,[ref]$errs)
if($errs.Count){throw 'Direct parser failed'}
$matches=@($ast.FindAll({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Get-ProcessState'},$true))
if($matches.Count -ne 1){throw 'Direct function not singular'}
. ([scriptblock]::Create($matches[0].Extent.Text))
$script:process=[pscustomobject]@{Name='caddy.exe';CommandLine=$null}
$script:sockets=@([pscustomobject]@{LocalPort=9443;OwningProcess=321;LocalAddress='::'})
$script:deny=$false
function Get-CimInstance {
 param([string]$ClassName,[string]$Filter)
 if($ClassName -ne 'Win32_Process'){throw 'Wrong CIM type'}
 return $script:process
}
function Get-NetTCPConnection {
 param([string]$State,[int]$LocalPort)
 if($script:deny){throw 'Socket introspection failure'}
 return @($script:sockets|Where-Object{$_.LocalPort -eq $LocalPort -and $State -eq 'Listen'})
}
$a=Get-ProcessState 321 'caddy' 'caddy.exe' 9443
if(-not $a.identity_match -or $a.identity_source -ne 'TLS_SOCKET_OWNER'){throw 'Caddy scheduled identity fallback failed'}
Write-Output 'PASS caddy owns TLS listener under hidden command line'
$script:sockets=@([pscustomobject]@{LocalPort=9443;OwningProcess=111;LocalAddress='::'})
if((Get-ProcessState 321 'caddy' 'caddy.exe' 9443).identity_match){throw 'Mismatched PID passed'}
Write-Output 'PASS mismatched socket owner fails'
$script:sockets=@()
if((Get-ProcessState 321 'caddy' 'caddy.exe' 9443).identity_match){throw 'Missing listener passed'}
Write-Output 'PASS missing listener fails'
$script:sockets=@([pscustomobject]@{LocalPort=9443;OwningProcess=321;LocalAddress='192.0.2.20'})
if((Get-ProcessState 321 'caddy' 'caddy.exe' 9443).identity_match){throw 'Unexpected bound address passed'}
Write-Output 'PASS unrelated bind address fails'
$script:sockets=@([pscustomobject]@{LocalPort=9443;OwningProcess=321;LocalAddress='::'})
$script:process=[pscustomobject]@{Name='something-else.exe';CommandLine=$null}
if((Get-ProcessState 321 'caddy' 'caddy.exe' 9443).identity_match){throw 'Wrong process type passed'}
Write-Output 'PASS unexpected executable fails'
$script:process=[pscustomobject]@{Name='caddy.exe';CommandLine='caddy.exe different-mode'}
if((Get-ProcessState 321 'caddy run --config' 'caddy.exe' 9443).identity_match){throw 'Visible command mismatch passed'}
Write-Output 'PASS exposed wrong command fails'
$script:process=[pscustomobject]@{Name='caddy.exe';CommandLine=$null}
$script:deny=$true
if((Get-ProcessState 321 'caddy' 'caddy.exe' 9443).identity_match){throw 'Denied socket introspection passed'}
Write-Output 'PASS denied socket ownership query fails'
$script:deny=$false
$script:process=$null
if((Get-ProcessState 321 'caddy' 'caddy.exe' 9443).identity_match){throw 'Absent process passed'}
Write-Output 'PASS absent Caddy fails'
