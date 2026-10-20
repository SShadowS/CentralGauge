param([string]$Lib = (Join-Path (Split-Path -Parent $PSScriptRoot) 'fs-digest.ps1'))
# Host-only self-check of the NST hold and Invoke-FsCaptureCore (no container).
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File infra\harness-reset\tests\fs-capture.selfcheck.ps1
# Owner addenda 2 and 5 (decisions\2026-10-20-h-35-l4-scope.md): the walk runs under a debugger hold, w2 is read
# before the release, the release always runs, and every failure fails closed.
$ErrorActionPreference = 'Stop'
. (Join-Path (Split-Path -Parent $Lib) 'reset-lib.ps1')
. $Lib

function Assert($cond, $msg) { if (-not $cond) { throw "FAIL: $msg" } }
function Throws([scriptblock]$b, [string]$like, [string]$what) {
  try { & $b; throw 'no-throw' } catch { Assert ($_.Exception.Message -match $like) "${what}: $($_.Exception.Message)" }
}

# Addendum 5, the real holder (run here on the host in a temp dir) against a busy process this check starts: while
# held it uses no CPU time; released, expired or with its holder killed, it runs again.
function global:Invoke-InContainer($Container, [scriptblock]$ScriptBlock, $ArgumentList) { & $ScriptBlock @ArgumentList }
$wd = Join-Path $env:TEMP ("cghold-" + [guid]::NewGuid())
$busy = Start-Process powershell.exe -WindowStyle Hidden -PassThru -ArgumentList '-NoProfile -Command "while ($true) { }"'
function Cpu { $busy.Refresh(); $busy.TotalProcessorTime.Ticks }
function Runs { $a = Cpu; Start-Sleep -Milliseconds 700; (Cpu) -gt $a }
function Holder([string]$tok) { Get-Process -Id ([int]($tok -split '\|')[1]) -ErrorAction SilentlyContinue }
function Gone([string]$tok) { $h = Holder $tok; (-not $h) -or $h.HasExited }
try {
  Start-Sleep -Milliseconds 500
  Assert (Runs) 'the busy process runs'
  # held: no CPU time for 2 s, the held-check passes; a second hold cannot attach; released, it runs again
  $t = Enable-NstFreeze 'x' 30 $wd $busy.Id
  Assert (-not (Runs)) 'held: no CPU time'
  Start-Sleep -Seconds 2
  Assert-NstFreezeHeld 'x' $t
  Throws { Enable-NstFreeze 'x' 30 $wd $busy.Id } 'NST freeze failed' 'a second hold'
  Disable-NstFreeze 'x' $t
  Assert (Gone $t) 'holder exited on release'
  Assert (Runs) 'runs after the release'
  Assert (-not (Get-ChildItem -LiteralPath $wd -Filter 'nst-freeze.*' -File)) 'hold files removed'
  # the bound elapses (a killed coordinator): the holder detaches by itself; held-check and release fail closed
  $t = Enable-NstFreeze 'x' 2 $wd $busy.Id
  Start-Sleep -Seconds 4
  Assert (Runs) 'runs after the bound'
  Throws { Assert-NstFreezeHeld 'x' $t } 'did not hold' 'held after the bound'
  Throws { Disable-NstFreeze 'x' $t } 'expired' 'release after the bound'
  # the holder is killed: the system detaches, the held-check fails closed, no leftover is live
  $t = Enable-NstFreeze 'x' 30 $wd $busy.Id
  Stop-Process -Id (Holder $t).Id -Force
  Start-Sleep -Milliseconds 500
  Assert (Runs) 'runs after the holder is killed'
  Throws { Assert-NstFreezeHeld 'x' $t } 'holder is gone' 'held with the holder killed'
  Assert ((Clear-NstFreezeLeftover 'x' $wd) -eq 0) 'a dead holder is no live leftover'
  # Sol hold M1: a leftover marker whose pid now names another process (reused: other start time) never kills it
  $fake = Join-Path $wd ('nst-freeze.' + ('b' * 32))
  Set-Content -LiteralPath $fake -Value "frozen|$($busy.Id)|1|$($busy.Id)|0|0" -Encoding ascii -NoNewline
  Assert ((Clear-NstFreezeLeftover 'x' $wd) -eq 0) 'a reused pid is no live leftover'
  $busy.Refresh()
  Assert (-not $busy.HasExited) 'the process behind a reused pid is not stopped'
  Assert (-not (Test-Path -LiteralPath $fake)) 'stale marker removed'
  # a live leftover (the coordinator died mid-walk): Clear ends it and the process runs
  $t = Enable-NstFreeze 'x' 30 $wd $busy.Id
  Assert ((Clear-NstFreezeLeftover 'x' $wd) -eq 1) 'one live leftover'
  Assert (Gone $t) 'leftover holder ended'
  Assert (Runs) 'runs after the leftover is cleared'
} finally {
  Stop-Process -Id $busy.Id -Force -ErrorAction SilentlyContinue
  Remove-Item -Recurse -Force $wd -ErrorAction SilentlyContinue
}

# orch r004 barrier M2/M3: the host-bounded session query, run -OnHost (a real local powershell; the query text stands in for the
# management call)
$qd = Join-Path $env:TEMP ("cgq-" + [guid]::NewGuid())
try {
  # a hung query (a frozen NST) times out and is killed: "NST unresponsive", never a hang
  $sw = [Diagnostics.Stopwatch]::StartNew()
  Throws { Get-NstSessionCount 'x' 0 2 'Start-Sleep -Seconds 60; 0' -OnHost } 'NST unresponsive' 'a hung query'
  Assert ($sw.Elapsed.TotalSeconds -lt 20) "bounded: $($sw.Elapsed.TotalSeconds) s"
  Assert ((Get-NstSessionCount 'x' 0 10 '0' -OnHost) -eq 0) 'a plain count'
  # drain: a queued session (count 1 for the first two queries) that ends within the bound passes ...
  $cf = Join-Path $qd 'n'
  New-Item -ItemType Directory -Force $qd | Out-Null
  Set-Content -LiteralPath $cf -Value 0
  $q = "`$n = [int](Get-Content -LiteralPath '$cf'); Set-Content -LiteralPath '$cf' -Value (`$n + 1); if (`$n -lt 2) { 1 } else { 0 }"
  Assert ((Get-NstSessionCount 'x' 15 10 $q -OnHost) -eq 0) 'a session that ends within the drain'
  # ... one that stays fails
  $sw = [Diagnostics.Stopwatch]::StartNew()
  Assert ((Get-NstSessionCount 'x' 3 10 '1' -OnHost) -eq 1) 'a session that stays'
  Assert ($sw.Elapsed.TotalSeconds -ge 3) 'the drain waited its bound'
  Throws { Get-NstSessionCount 'x' 0 10 "'x'" -OnHost } 'unreadable' 'an unreadable count'
} finally { Remove-Item -Recurse -Force $qd -ErrorAction SilentlyContinue }

function Run([hashtable]$o) {
  $script:calls = [Collections.Generic.List[string]]::new()
  $script:o = $o
  $script:heldNow = $false
  $script:quiescentCalls = 0
  $script:wmCalls = 0
  # script: so the mocks replace the dot-sourced originals in this script's scope (Sol S3 r3)
  function script:Clear-NstFreezeLeftover($c) { $script:calls.Add('leftover?'); [int]$script:o.leftHeld }
  function script:Test-NstSuspended($c) { $script:calls.Add('suspended?'); [bool]$script:o.leftSuspended }
  function script:Set-NstSuspended($c, [bool]$s) { $script:calls.Add($(if ($s) { 'suspend' } else { 'resume' })) }
  function script:Enable-NstFreeze($c) {
    $script:calls.Add('hold')
    if ($script:o.holdFails) { throw 'NST freeze failed: failed|1|DebugActiveProcess: error 5' }
    $script:heldNow = $true
    "$('a' * 32)|1|C:\m"
  }
  function script:Assert-NstFreezeHeld($c, $t) {
    $script:calls.Add('held?')
    if ($script:o.heldFails) { throw 'the NST hold did not hold: the NST used CPU time while held (1 -> 2 ticks)' }
  }
  function script:Disable-NstFreeze($c, $t) {
    $script:calls.Add('release')
    $script:heldNow = $false
    if ($script:o.releaseFails) { throw 'NST release: expired: the hold bound elapsed before the release' }
  }
  function script:Test-NstQuiescent($c) {
    $script:calls.Add('quiescent')
    $after = ($script:quiescentCalls++) -gt 0
    if ($after -and $script:o.unreadableAfter) { throw 'NST management API timed out' }
    if ($after) { -not $script:o.busyAfter } else { -not $script:o.busy }
  }
  function script:Get-NstSessionWatermark($c) {
    $script:calls.Add("watermark(held=$script:heldNow)")
    if ($script:o.wmThrows) { throw 'Execution Timeout Expired' }
    if ($script:o.wmMoves -and ($script:wmCalls++) -gt 0) { return '31|2026-10-20T10:00:19.000' }
    # the healthcheck queued during the hold logs right after the release
    if ($script:heldNow) { '30|2026-10-20T10:00:18.000' } else { '32|2026-10-20T10:00:48.000' }
  }
  function script:Get-FsDigest($c, $r) {
    $script:calls.Add('walk')
    if ($script:o.walkThrows) { throw 'docker exec died' }
    'D|16|1|C:\W'
  }
  $out = @(Invoke-FsCaptureCore 'x' @('C:\W'))
  [pscustomobject]@{ out = $out; calls = @($script:calls) }
}

# happy path: w1 and w2 both read while held (a post-release healthcheck row does not count), held-check, release
$r = Run @{}
Assert (($r.calls -join ',') -eq 'leftover?,suspended?,quiescent,hold,watermark(held=True),walk,watermark(held=True),held?,release,quiescent') "order: $($r.calls -join ',')"
Assert (($r.out -join ';') -eq 'D|16|1|C:\W;T|1') "out: $($r.out -join ';')"
# a hold that did not last the walk fails the capture; the release still runs
$r = Run @{ heldFails = $true }
Assert ($r.out[0] -like 'E|(fs-capture)|*did not hold*') "held error: $($r.out -join ';')"
Assert ($r.calls -contains 'release') 'release after a broken hold'
# a live hold a killed capture left: ended, this capture fails closed before anything else
$r = Run @{ leftHeld = 1 }
Assert (($r.calls -join ',') -eq 'leftover?') "left held: $($r.calls -join ',')"
Assert ($r.out[0] -like 'E|(fs-capture)|*left the NST held*') 'left held error'
# run 004 #5: an NST an older build left suspended is resumed first and this capture fails closed
$r = Run @{ leftSuspended = $true }
Assert (($r.calls -join ',') -eq 'leftover?,suspended?,resume') "left suspended: $($r.calls -join ',')"
Assert ($r.out[0] -like 'E|(fs-capture)|*left suspended*') 'left suspended error'
# the hold cannot be taken: no walk, no release (nothing held), fails closed
$r = Run @{ holdFails = $true }
Assert (-not ($r.calls -contains 'walk')) 'no walk without a hold'
Assert (-not ($r.calls -contains 'release')) 'no release without a hold'
Assert ($r.out[0] -like 'E|(fs-capture)|*NST freeze failed*') 'hold error'
# a release that fails (expired) fails the capture closed
$r = Run @{ releaseFails = $true }
Assert ($r.out | Where-Object { $_ -like 'E|(fs-capture)|*expired*' }) 'release error'
# the walk throws: the release still runs, the capture fails closed
$r = Run @{ walkThrows = $true }
Assert ($r.calls -contains 'release') 'release after a throwing walk'
Assert ($r.out[0] -like 'E|(fs-capture)|*docker exec died*') "walk error: $($r.out -join ';')"
Assert ($r.out[-1] -eq "T|$($r.out.Count - 1)") 'T marker'
# not quiescent before: nothing held, nothing walked
$r = Run @{ busy = $true }
Assert (($r.calls -join ',') -eq 'leftover?,suspended?,quiescent') "busy: $($r.calls -join ',')"
Assert ($r.out[0] -like 'E|(fs-capture)|NST not quiescent before*') 'busy error'
# the watermark read fails, or moves while held: the release still runs, fails closed
$r = Run @{ wmThrows = $true }
Assert ($r.calls -contains 'release') 'release after a failed watermark read'
Assert ($r.out[0] -like 'E|(fs-capture)|*Execution Timeout*') "watermark read error: $($r.out -join ';')"
$r = Run @{ wmMoves = $true }
Assert ($r.calls -contains 'release') 'release after a moved watermark'
Assert ($r.out[0] -like 'E|(fs-capture)|*moved while held*') "watermark moved: $($r.out -join ';')"
# after the release: a busy or unreadable NST fails closed
$r = Run @{ busyAfter = $true }
Assert ($r.out | Where-Object { $_ -like 'E|(fs-capture)|NST not quiescent after*' }) 'busy after'
$r = Run @{ unreadableAfter = $true }
Assert ($r.out | Where-Object { $_ -like 'E|(fs-capture)|*management API timed out*' }) 'unreadable after'
'FS CAPTURE SELFCHECK OK'
