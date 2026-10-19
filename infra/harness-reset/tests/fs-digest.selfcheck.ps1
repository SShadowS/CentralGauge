param([string]$Lib = (Join-Path (Split-Path -Parent $PSScriptRoot) 'fs-digest.ps1'))
# Host-only self-check of fs-digest.ps1 (no container): run under Windows PowerShell 5.1, as inside the container:
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File infra\harness-reset\tests\fs-digest.selfcheck.ps1
$ErrorActionPreference = 'Stop'
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
cmd /c rmdir "$root\j"; Remove-Item -Recurse -Force $root
'FS SELFCHECK OK'
$d3 | Select-Object -First 3
