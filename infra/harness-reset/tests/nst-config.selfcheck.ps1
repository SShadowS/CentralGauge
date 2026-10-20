param([string]$Lib = (Join-Path (Split-Path -Parent $PSScriptRoot) 'reset-lib.ps1'))
# Host-only self-check of Get-NstConfigDigest (H-35 run 004 #4), no container:
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File infra\harness-reset\tests\nst-config.selfcheck.ps1
$ErrorActionPreference = 'Stop'
. $Lib
function Invoke-InContainer($Container, [scriptblock]$ScriptBlock, $ArgumentList) { & $ScriptBlock @ArgumentList }
function Assert($cond, $msg) { if (-not $cond) { throw "FAIL: $msg" } }
$dir = Join-Path $env:TEMP ("nstcfg-" + [guid]::NewGuid())
New-Item -ItemType Directory $dir | Out-Null
function Cfg([string]$name, [string[]]$adds) {
  $p = Join-Path $dir $name
  $body = "<?xml version=`"1.0`" encoding=`"utf-8`"?>`r`n<appSettings>`r`n" + (($adds | ForEach-Object { "  $_" }) -join "`r`n") + "`r`n</appSettings>`r`n"
  [IO.File]::WriteAllText($p, $body, [Text.UTF8Encoding]::new($true))
  $p
}
$ex = @('PublicWebBaseUrl', 'PublicSOAPBaseUrl')
$a = Cfg 'a.config' @('<add key="DatabaseName" value="CRONUS" />', '<add key="PublicWebBaseUrl" value="http://Cronus281/BC/" />', '<!-- c -->', '<add key="ServerInstance" value="BC" />')
$b = Cfg 'b.config' @('<add key="ServerInstance" value="BC" />', '<add key="PublicWebBaseUrl" value="http://Cronus283/BC/" />', '<add key="DatabaseName" value="CRONUS" />')
$c = Cfg 'c.config' @('<add key="DatabaseName" value="CRONUS_rebuild" />', '<add key="PublicWebBaseUrl" value="http://Cronus281/BC/" />', '<add key="ServerInstance" value="BC" />')
$da = Get-NstConfigDigest 'x' $a $ex
Assert ($da -match '^[0-9a-f]{64}\|2$') "digest shape: $da"
Assert ($da -eq (Get-NstConfigDigest 'x' $b $ex)) 'another hostname, another order: same digest'
Assert ($da -ne (Get-NstConfigDigest 'x' $c $ex)) 'a behaviour key changed: another digest'
$dup = Cfg 'd.config' @('<add key="DatabaseName" value="A" />', '<add key="DatabaseName" value="B" />')
try { Get-NstConfigDigest 'x' $dup $ex; throw 'no-throw' } catch { Assert ($_.Exception.Message -match 'twice') "duplicate: $($_.Exception.Message)" }
$empty = Cfg 'e.config' @()
try { Get-NstConfigDigest 'x' $empty $ex; throw 'no-throw' } catch { Assert ($_.Exception.Message -match 'no settings') "empty: $($_.Exception.Message)" }
Remove-Item -Recurse -Force $dir
'NST CONFIG SELFCHECK OK'
