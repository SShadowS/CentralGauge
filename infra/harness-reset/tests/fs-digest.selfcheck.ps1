param([string]$Lib = (Join-Path (Split-Path -Parent $PSScriptRoot) 'fs-digest.ps1'))
# Host-only self-check of fs-digest.ps1 (no container): run under Windows PowerShell 5.1, as inside the container:
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File infra\harness-reset\tests\fs-digest.selfcheck.ps1
$ErrorActionPreference = 'Stop'
. (Join-Path (Split-Path -Parent $Lib) 'reset-lib.ps1')
function Invoke-InContainer($Container, [scriptblock]$ScriptBlock, $ArgumentList) { & $ScriptBlock @ArgumentList }
. $Lib
$root = Join-Path $env:TEMP ("fsd-" + [guid]::NewGuid())
New-Item -ItemType Directory "$root\sub" | Out-Null
[IO.File]::WriteAllText("$root\sub\a.txt", 'AAAA')
$d0 = @(Get-FsDigest 'x' @($root))
if (@($d0 | Where-Object { $_ -like 'E|*' }).Count) { throw "errors: $d0" }
if (-not ($d0 | Where-Object { $_ -like 'F|*a.txt' })) { throw "no F line: $d0" }
# same-size overwrite, restored mtime: detected by hash
$t = (Get-Item "$root\sub\a.txt").LastWriteTimeUtc
[IO.File]::WriteAllText("$root\sub\a.txt", 'BBBB'); (Get-Item "$root\sub\a.txt").LastWriteTimeUtc = $t
$d1 = @(Get-FsDigest 'x' @($root))
if (-not (Compare-Object $d0 $d1)) { throw 'same-size restored-mtime overwrite not detected' }
# file ADS and directory ADS
Set-Content -LiteralPath "$root\sub\a.txt" -Stream hid -Value 'secret'
Set-Content -LiteralPath "$root\sub" -Stream dirhid -Value 'x'
$d2 = @(Get-FsDigest 'x' @($root))
if (-not ($d2 | Where-Object { $_ -like 'S|*a.txt:hid' })) { throw "file ADS missed: $d2" }
if (-not ($d2 | Where-Object { $_ -like 'S|*sub:dirhid' })) { throw "dir ADS missed: $d2" }
# junction: recorded as L, not followed
cmd /c mklink /J "$root\j" "$root\sub" | Out-Null
$d3 = @(Get-FsDigest 'x' @($root))
if (-not ($d3 | Where-Object { $_ -like 'L|*\j|*' })) { throw "junction not recorded: $d3" }
if ($d3 | Where-Object { $_ -like '*\j\a.txt*' }) { throw 'junction followed' }
if ((Get-FsDigest 'x' @("$root\nope")) -notlike 'E|*root missing') { throw 'missing root not E' }
# a root that is itself a junction: one L line, never traversed (Sol r1 #6)
$jr = @(Get-FsDigest 'x' @("$root\j"))
if ($jr.Count -ne 1 -or $jr[0] -notlike 'L|*') { throw "junction root followed: $jr" }
# run 004 #7: F records sort by their path (field 6), not their head bytes (field 5)
$ord = Join-Path $root 'ord'
New-Item -ItemType Directory $ord | Out-Null
[IO.File]::WriteAllText("$ord\a.txt", 'bb'); [IO.File]::WriteAllText("$ord\z.txt", 'aa')
$fl = @(Get-FsDigest 'x' @($ord) | Where-Object { $_ -like 'F|*' })
if ($fl.Count -ne 2 -or $fl[0] -notlike '*\a.txt' -or $fl[0] -notlike '*|6262|*') { throw "F order by head, not path: $($fl -join ' ; ')" }
# ordinal order, culture-independent (Sol r1 #9)
$o = @(Sort-Ordinal @('b', 'B', 'a', [string][char]0xE4))
if (($o -join ',') -ne "B,a,b,$([char]0xE4)") { throw "not ordinal: $($o -join ',')" }
cmd /c rmdir "$root\j"; Remove-Item -Recurse -Force $root
'FS SELFCHECK OK'
$d3 | Select-Object -First 3
