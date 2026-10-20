param([string]$Lib = (Join-Path (Split-Path -Parent $PSScriptRoot) 'fs-digest.ps1'))
# Host-only self-check of Invoke-FsCaptureCore (no container): the container calls are stubbed after dot-sourcing.
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File infra\harness-reset\tests\fs-capture.selfcheck.ps1
# Owner addendum 2 (decisions\2026-10-20-h-35-l4-scope.md): the walk runs suspended, w2 is read before the resume,
# the resume always runs, and every failure fails closed.
$ErrorActionPreference = 'Stop'
. (Join-Path (Split-Path -Parent $Lib) 'reset-lib.ps1')
. $Lib

function Assert($cond, $msg) { if (-not $cond) { throw "FAIL: $msg" } }

# run 004 #5, the coordinator-killed-after-suspend path: the real container-side watchdog (run here on the host, no
# NST process: its resume is a no-op) fires on its own after the delay, with nobody to disarm it ...
function global:Invoke-InContainer($Container, [scriptblock]$ScriptBlock, $ArgumentList) { & $ScriptBlock @ArgumentList }
$tok = Enable-NstAutoResume 'x' 2
$marker = ($tok -split '\|')[0]
Assert (Test-Path -LiteralPath $marker) 'marker armed'
$deadline = (Get-Date).AddSeconds(30)
while ((Test-Path -LiteralPath $marker) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 250 }
Assert (-not (Test-Path -LiteralPath $marker)) 'the watchdog fired without the coordinator (marker consumed)'
# ... and a disarmed one never fires (its marker is gone and its process is stopped)
$tok = Enable-NstAutoResume 'x' 30
Disable-NstAutoResume 'x' $tok
Assert (-not (Get-Process -Id ([int]($tok -split '\|')[1]) -ErrorAction SilentlyContinue)) 'watchdog stopped on disarm'

function Run([hashtable]$o) {
  $script:calls = [Collections.Generic.List[string]]::new()
  $script:o = $o
  $script:suspendedNow = $false
  $script:quiescentCalls = 0
  $script:wmCalls = 0
  # script: so the mocks replace the dot-sourced originals in this script's scope (Sol S3 r3)
  function script:Test-NstSuspended($c) { $script:calls.Add('suspended?'); [bool]$script:o.leftSuspended }
  function script:Enable-NstAutoResume($c) { $script:calls.Add('arm'); 'C:\m.marker|1' }
  function script:Disable-NstAutoResume($c, $t) {
    $script:calls.Add('disarm')
    if ($script:o.disarmFails) { throw 'marker remains' }
  }
  function script:Test-NstQuiescent($c) {
    $script:calls.Add('quiescent')
    $after = ($script:quiescentCalls++) -gt 0
    if ($after -and $script:o.unreadableAfter) { throw 'NST management API timed out' }
    if ($after) { -not $script:o.busyAfter } else { -not $script:o.busy }
  }
  function script:Set-NstSuspended($c, [bool]$s) {
    $script:calls.Add($(if ($s) { 'suspend' } else { 'resume' }))
    if ($s -and $script:o.suspendFails) { throw 'NT status 0xC0000022' }
    if (-not $s -and $script:o.resumeFails) { throw 'NT status 0xC0000008' }
    $script:suspendedNow = $s
  }
  function script:Get-NstSessionWatermark($c) {
    $script:calls.Add("watermark(suspended=$script:suspendedNow)")
    if ($script:o.wmThrows) { throw 'Execution Timeout Expired' }
    if ($script:o.wmMoves -and ($script:wmCalls++) -gt 0) { return '31|2026-10-20T10:00:19.000' }
    # the healthcheck queued during the suspension logs right after the resume
    if ($script:suspendedNow) { '30|2026-10-20T10:00:18.000' } else { '32|2026-10-20T10:00:48.000' }
  }
  function script:Get-FsDigest($c, $r) {
    $script:calls.Add('walk')
    if ($script:o.walkThrows) { throw 'docker exec died' }
    'D|16|1|C:\W'
  }
  $out = @(Invoke-FsCaptureCore 'x' @('C:\W'))
  [pscustomobject]@{ out = $out; calls = @($script:calls) }
}

# happy path: w1 and w2 both read while suspended (a post-resume healthcheck row does not count), resume, then disarm
$r = Run @{}
Assert (($r.calls -join ',') -eq 'suspended?,quiescent,arm,suspend,watermark(suspended=True),walk,watermark(suspended=True),resume,disarm,quiescent') "order: $($r.calls -join ',')"
Assert (($r.out -join ';') -eq 'D|16|1|C:\W;T|1') "out: $($r.out -join ';')"
# run 004 #5: an NST a killed capture left suspended is resumed first and this capture fails closed
$r = Run @{ leftSuspended = $true }
Assert (($r.calls -join ',') -eq 'suspended?,resume') "left suspended: $($r.calls -join ',')"
Assert ($r.out[0] -like 'E|(fs-capture)|*left suspended*') 'left suspended error'
# a disarm that fails fails the capture closed
$r = Run @{ disarmFails = $true }
Assert ($r.out | Where-Object { $_ -like 'E|(fs-capture)|*not disarmed*' -or $_ -like 'E|(fs-capture)|*marker remains*' }) 'disarm error'
# the walk throws: resume still runs, the capture fails closed
$r = Run @{ walkThrows = $true }
Assert ($r.calls -contains 'resume') 'resume after a throwing walk'
Assert ($r.out[0] -like 'E|(fs-capture)|*docker exec died*') "walk error: $($r.out -join ';')"
Assert ($r.out[-1] -eq "T|$($r.out.Count - 1)") 'T marker'
# suspend fails: no walk, resume attempted, fails closed
$r = Run @{ suspendFails = $true }
Assert (-not ($r.calls -contains 'walk')) 'no walk without a suspension'
Assert ($r.calls -contains 'resume') 'resume after a failed suspend'
Assert ($r.calls -contains 'disarm') 'disarm after a failed suspend'
Assert ($r.out[0] -like 'E|(fs-capture)|*0xC0000022*') 'suspend error'
# resume fails: the capture fails closed (quarantine), the digest is not trusted
$r = Run @{ resumeFails = $true }
Assert ($r.out | Where-Object { $_ -like 'E|(fs-capture)|NST resume failed*' }) 'resume error'
# not quiescent before: nothing suspended, nothing walked
$r = Run @{ busy = $true }
Assert (($r.calls -join ',') -eq 'suspended?,quiescent') "busy: $($r.calls -join ',')"
Assert ($r.out[0] -like 'E|(fs-capture)|NST not quiescent before*') 'busy error'
# the watermark read fails, or moves while suspended: resume still runs, fails closed
$r = Run @{ wmThrows = $true }
Assert ($r.calls -contains 'resume') 'resume after a failed watermark read'
Assert ($r.out[0] -like 'E|(fs-capture)|*Execution Timeout*') "watermark read error: $($r.out -join ';')"
$r = Run @{ wmMoves = $true }
Assert ($r.calls -contains 'resume') 'resume after a moved watermark'
Assert ($r.out[0] -like 'E|(fs-capture)|*moved while suspended*') "watermark moved: $($r.out -join ';')"
# after the resume: a busy or unreadable NST fails closed
$r = Run @{ busyAfter = $true }
Assert ($r.out | Where-Object { $_ -like 'E|(fs-capture)|NST not quiescent after*' }) 'busy after'
$r = Run @{ unreadableAfter = $true }
Assert ($r.out | Where-Object { $_ -like 'E|(fs-capture)|*management API timed out*' }) 'unreadable after'
'FS CAPTURE SELFCHECK OK'
