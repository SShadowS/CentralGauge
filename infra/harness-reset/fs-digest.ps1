# H-35 S3 L4 (design-r5 2.4 as amended: decisions\2026-10-20-h-35-l4-scope.md). Dot-sourced after reset-lib.ps1.
# Scope: L4 detects differences in the specified file/stream contents and recorded metadata between observation
# points within declared roots, excluding recorded exclusions and untraversed reparse targets. It is not a complete
# write history or persistence boundary. Each capture walks with the NST process held by a debugger (owner,
# addenda 2 and 5 of decisions\2026-10-20-h-35-l4-scope.md), so no AL runs during it; a writer outside the NST process
# (for example a detached process an OnPrem DotNet call started) is not stopped by the hold and is not covered.
#
# fsDigest(W): every entry under the roots, hashed in full every time (no size/mtime gate). One line per entry,
# sorted ordinal by path, fields separated by '|':
#   D|<attrs>|<lastWriteUtcTicks>|<path>                    directory (its own named streams follow as S lines)
#   F|<sha256>|<size>|<attrs>|<lastWriteUtcTicks>|<head>|<path>   file, unnamed stream; head = its first min(26, size) bytes, hex (v4)
#   S|<sha256>|<size>|<path>:<stream>                       named NTFS stream of a file or directory
#   L|<attrs>|<lastWriteUtcTicks>|<path>|<target>           reparse point (a root too): recorded, never followed
#   E|<path>|<reason>                                       access error or change during the scan: fails closed
# A file, stream or directory that changes while it is read or enumerated is an E line. Invoke-FsCaptureCore wraps
# the walk (quiescence, debugger hold, watermark) and ends the capture with `T|<entry lines>` (src/harness/reset.ts
# fsDiff refuses a capture without it). DIGEST_VERSION enters env_fp through the lineage; bump it on any change to
# the line format or the walk.
$FsDigestVersion = 4

# A second check under the hold: the NST's session-log watermark, read twice while it is held. A
# held NST writes nothing, so a change means the hold did not hold. READ UNCOMMITTED with a timeout, so a
# lock a held NST thread holds can never hang the read (a timeout fails closed).
function Get-NstSessionWatermark([string]$Container) {
  $w = Invoke-InContainer $Container {
    (Invoke-Sqlcmd -Database CRONUS -QueryTimeout 30 -ErrorAction Stop -Query "SELECT CONCAT(COUNT_BIG(*), '|', CONVERT(varchar(33), MAX([Event Datetime]), 126)) AS w FROM [Session Event] WITH (NOLOCK)").w
  }
  if ("$w".Trim() -notmatch '^\d+\|') { throw "NST session watermark unreadable: '$w'" }
  "$w".Trim()
}

# Owner, addendum 2: suspend / resume every thread of the NST process (NtSuspendProcess / NtResumeProcess). Suspend
# verifies every thread reports WaitReason Suspended; either throws on any failure. Since addendum 5 only the resume
# is used (an NST an older build left suspended); the capture holds with a debugger (Enable-NstFreeze).
function Set-NstSuspended([string]$Container, [bool]$Suspended) {
  $r = Invoke-InContainer $Container { param($suspend)
    if (-not ('CgNtProc' -as [type])) {
      Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class CgNtProc {
  [DllImport("ntdll.dll")] public static extern int NtSuspendProcess(IntPtr h);
  [DllImport("ntdll.dll")] public static extern int NtResumeProcess(IntPtr h);
}
'@
    }
    $p = @(Get-Process -Name 'Microsoft.Dynamics.Nav.Server' -ErrorAction Stop)
    if ($p.Count -ne 1) { throw "expected one NST process, found $($p.Count)" }
    $st = if ($suspend) { [CgNtProc]::NtSuspendProcess($p[0].Handle) } else { [CgNtProc]::NtResumeProcess($p[0].Handle) }
    if ($st -ne 0) { throw "NT status 0x$('{0:X8}' -f $st)" }
    $p[0].Refresh()
    if ($suspend) {
      $running = @($p[0].Threads | Where-Object { "$($_.WaitReason)" -ne 'Suspended' }).Count
      if ($running -gt 0) { throw "$running NST thread(s) not suspended" }
    } else {
      # run 005 smoke: a freeze NtResumeProcess does not undo (a job freeze) leaves the threads suspended
      $still = @($p[0].Threads | Where-Object { "$($_.WaitReason)" -eq 'Suspended' }).Count
      if ($still -gt 0) { throw "$still NST thread(s) still suspended: frozen by something a resume does not undo; recreate the container" }
    }
    'ok'
  } $Suspended
  if ("$r".Trim() -ne 'ok') { throw "NST $(if ($Suspended) { 'suspend' } else { 'resume' }) failed: $r" }
}

# run 004 #5: whether any NST thread is suspended (a coordinator killed mid-capture leaves it so). Throws when it
# cannot tell.
function Test-NstSuspended([string]$Container) {
  $r = Invoke-InContainer $Container {
    $p = @(Get-Process -Name 'Microsoft.Dynamics.Nav.Server' -ErrorAction Stop)
    if ($p.Count -ne 1) { throw "expected one NST process, found $($p.Count)" }
    "$(@($p[0].Threads | Where-Object { "$($_.WaitReason)" -eq 'Suspended' }).Count)"
  }
  if ("$r".Trim() -notmatch '^\d+$') { throw "NST thread state unreadable: '$r'" }
  [int]"$r".Trim() -gt 0
}

# Owner addendum 5 (decisions\2026-10-20-h-35-l4-scope.md), replacing NtSuspendProcess, which does not freeze threads
# the thread pool creates during the walk (lane-ops, run 004): the NST is held by a DEBUGGER. A detached holder
# process in the container attaches (DebugActiveProcess, DebugSetProcessKillOnExit(FALSE)), breaks in
# (DebugBreakProcess) and never continues a debug event, so every thread, including one created later, stays
# stopped. It holds until the capture asks for the release or its bound elapses, then detaches. A killed coordinator:
# the bound ends the hold. A killed holder: the system detaches (kill-on-exit off) and the NST runs on. So no
# separate watchdog. The bound (default 38 s) stays below one healthcheck interval plus its timeout (30 s + 10 s), so
# a hold costs at most one failing healthcheck; a walk that outlasts it fails closed (expired).
# Generation G names this hold's files: <dir>\nst-freeze.<G> (the marker) and <dir>\nst-freeze.<G>.release. A
# holder only ever reads and writes its own files and ends only its own debug session, so a stale holder cannot touch
# a later hold (and a second debugger cannot attach while one holds). Marker values:
#   frozen|<holder pid>|<holder start ticks>|<nst pid>|<nst cpu ticks>|<nst cycles>   held; cpu = TotalProcessorTime
#     (user + kernel) and cycles = QueryProcessCycleTime (diagnostic) at the freeze; the bound is a monotonic clock from the attach
#   expired|... / released|... / failed|<holder pid>|<reason>
# The holder's code goes in -EncodedCommand (no script file). Its files, and its TEMP (Add-Type), live under
# C:\ProgramData\cg-harness, outside every fs root of the lineage (L4 ruling item 3). Returns "<G>|<holder pid>|<holder start ticks>|<marker>".
$NstFreezeDir = 'C:\ProgramData\cg-harness'
$NstHoldSeconds = 38
function Enable-NstFreeze([string]$Container, [int]$Seconds = $NstHoldSeconds, [string]$Dir = $NstFreezeDir, [int]$TargetPid = 0) {
  $t = Invoke-InContainer $Container { param($s, $dir, $tpid)
    New-Item -ItemType Directory -Force (Join-Path $dir 'tmp') | Out-Null
    $g = [guid]::NewGuid().ToString('N')
    $marker = Join-Path $dir "nst-freeze.$g"
    $cmd = @"
`$env:TEMP = `$env:TMP = '$dir\tmp'
`$marker = '$marker'
`$release = "`$marker.release"
function Put([string]`$v) { `$t = "`$marker.tmp"; Set-Content -LiteralPath `$t -Value `$v -Encoding ascii -NoNewline; Move-Item -LiteralPath `$t -Destination `$marker -Force }
try {
  Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class CgDbg { [DllImport("kernel32.dll", SetLastError = true)] public static extern bool DebugActiveProcess(int p); [DllImport("kernel32.dll", SetLastError = true)] public static extern bool DebugActiveProcessStop(int p); [DllImport("kernel32.dll", SetLastError = true)] public static extern bool DebugSetProcessKillOnExit(bool k); [DllImport("kernel32.dll", SetLastError = true)] public static extern bool DebugBreakProcess(IntPtr h); [DllImport("kernel32.dll", SetLastError = true)] public static extern bool WaitForDebugEvent(byte[] e, int ms); [DllImport("kernel32.dll", SetLastError = true)] public static extern bool QueryProcessCycleTime(IntPtr h, out ulong c); public static int Err() { return Marshal.GetLastWin32Error(); } }'
  `$p = if ($tpid -gt 0) { Get-Process -Id $tpid } else {
    `$a = @(Get-Process -Name 'Microsoft.Dynamics.Nav.Server')
    if (`$a.Count -ne 1) { throw "expected one NST process, found `$(`$a.Count)" }
    `$a[0]
  }
  if (-not [CgDbg]::DebugActiveProcess(`$p.Id)) { throw "DebugActiveProcess: error `$([CgDbg]::Err())" }
  # Sol hold M2: the bound is monotonic and counts from the attach
  `$sw = [Diagnostics.Stopwatch]::StartNew()
  # orch r004 barrier M1: the default kills the NST when the holder exits; never publish frozen without this. A holder
  # killed between the attach and this call can still terminate the NST (a recreation, never a silent pass).
  if (-not [CgDbg]::DebugSetProcessKillOnExit(`$false)) {
    `$e = [CgDbg]::Err()
    [void][CgDbg]::DebugActiveProcessStop(`$p.Id)
    throw "DebugSetProcessKillOnExit: error `$e (detached)"
  }
  if (-not [CgDbg]::DebugBreakProcess(`$p.Handle)) { throw "DebugBreakProcess: error `$([CgDbg]::Err())" }
  # the attach's first event; it is never continued, so the debuggee stays stopped
  if (-not [CgDbg]::WaitForDebugEvent((New-Object byte[] 4096), [Math]::Max(1, [Math]::Min(10000, [int]($s * 1000 - `$sw.ElapsedMilliseconds))))) { throw "no debug event: error `$([CgDbg]::Err())" }
  Start-Sleep -Milliseconds 500
  `$p.Refresh()
  `$cyc = [uint64]0
  if (-not [CgDbg]::QueryProcessCycleTime(`$p.Handle, [ref]`$cyc)) { throw "QueryProcessCycleTime: error `$([CgDbg]::Err())" }
  Put "frozen|`$PID|`$((Get-Process -Id `$PID).StartTime.Ticks)|`$(`$p.Id)|`$(`$p.TotalProcessorTime.Ticks)|`$cyc"
  while (-not (Test-Path -LiteralPath `$release) -and `$sw.Elapsed.TotalSeconds -lt $s) { Start-Sleep -Milliseconds 200 }
  # expired is written BEFORE the detach: a marker that reads frozen means the hold is still in place
  `$how = if (Test-Path -LiteralPath `$release) { 'released' } else { 'expired' }
  if (`$how -eq 'expired') { Put "expired|`$PID|`$(`$p.Id)" }
  `$ok = [CgDbg]::DebugActiveProcessStop(`$p.Id)
  Put "`$how|`$PID|`$(`$p.Id)|detached=`$ok"
} catch {
  try { Put "failed|`$PID|`$((`$_.Exception.Message -replace '[\r\n|]+', ' ').Trim())" } catch { }
  exit 1
}
"@
    $enc = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($cmd))
    $h = Start-Process powershell.exe -WindowStyle Hidden -PassThru `
      -ArgumentList "-NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand $enc"
    $deadline = (Get-Date).AddSeconds(30)
    do {
      $m = Get-Content -LiteralPath $marker -Raw -ErrorAction SilentlyContinue
      # Sol hold M1: the token carries the holder's start time, its identity beyond a reusable pid
      if ($m -match '^frozen\|\d+\|(\d+)\|') { return "$g|$($h.Id)|$($Matches[1])|$marker" }
      if ($m -like 'failed|*') { break }
      Start-Sleep -Milliseconds 200
    } while ((Get-Date) -lt $deadline)
    # ending the holder ends its debug session (kill-on-exit off): the NST runs on
    Stop-Process -Id $h.Id -Force -ErrorAction SilentlyContinue
    Wait-Process -Id $h.Id -Timeout 10 -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $marker, "$marker.tmp" -Force -ErrorAction SilentlyContinue
    "FAILED $(if ($m) { $m } else { 'no freeze within 30 s' })"
  } $Seconds, $Dir, $TargetPid
  if ("$t".Trim() -notmatch '^[0-9a-f]{32}\|\d+\|\d+\|.+$') { throw "NST freeze failed: $("$t".Trim())" }
  "$t".Trim()
}

# Before the release: the hold lasted the whole walk. This hold's marker still reads frozen (not expired), its holder
# (same pid AND start time) is alive, a debugger is attached to the NST (same pid), and the NST used no CPU time
# (user + kernel) since the freeze. Thread states cannot show it: threads the debug port holds at creation read
# Executive, not Suspended. The release then requires the holder's own `released` report. Processor cycles are
# recorded in the marker but not compared: kernel work for the frozen process (a thread-pool thread created and
# stopped at its creation event, before user mode) moves them (lane-ops smoke: 1 of 10 captures, +20,640 cycles with
# CPU time flat), which is not NST code running.
function Assert-NstFreezeHeld([string]$Container, [string]$Token) {
  $r = Invoke-InContainer $Container { param($tok)
    if (-not ('CgHold' -as [type])) {
      Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class CgHold { [DllImport("kernel32.dll", SetLastError = true)] public static extern bool CheckRemoteDebuggerPresent(IntPtr h, ref bool p); }'
    }
    $null, $hpid, $hstart, $marker = $tok -split '\|', 4
    $m = Get-Content -LiteralPath $marker -Raw -ErrorAction SilentlyContinue
    if ($m -notmatch "^frozen\|$hpid\|$hstart\|(\d+)\|(\d+)\|\d+$") { return "marker reads '$m', not this hold's (expired or failed)" }
    $npid = [int]$Matches[1]; $cpu = [long]$Matches[2]
    $h = Get-Process -Id ([int]$hpid) -ErrorAction SilentlyContinue
    if (-not $h -or $h.HasExited -or $h.StartTime.Ticks -ne [long]$hstart) { return 'the holder is gone' }
    $p = Get-Process -Id $npid -ErrorAction SilentlyContinue
    if (-not $p) { return "NST process $npid is gone" }
    $dbg = $false
    if (-not [CgHold]::CheckRemoteDebuggerPresent($p.Handle, [ref]$dbg)) { return 'debugger state unreadable' }
    if (-not $dbg) { return 'no debugger attached to the NST' }
    $now = $p.TotalProcessorTime.Ticks
    if ($now -ne $cpu) { return "the NST used CPU time while held ($cpu -> $now ticks)" }
    'held'
  } (, $Token)
  if ("$r".Trim() -ne 'held') { throw "the NST hold did not hold: $r" }
}

# Release: ask the holder to detach and wait for it. A holder that does not exit is stopped (only the process this
# capture started; the system then detaches). Throws unless the holder reported a release.
function Disable-NstFreeze([string]$Container, [string]$Token) {
  $r = Invoke-InContainer $Container { param($tok)
    $null, $hpid, $hstart, $marker = $tok -split '\|', 4
    Set-Content -LiteralPath "$marker.release" -Value '' -Encoding ascii -NoNewline
    # HasExited, not mere presence: an exited process stays listed while a handle to it is open. Sol hold M1: a pid
    # with another start time is not the holder (reused); it is never stopped.
    $sw = [Diagnostics.Stopwatch]::StartNew()
    do {
      $h = Get-Process -Id ([int]$hpid) -ErrorAction SilentlyContinue
      $alive = $h -and -not $h.HasExited -and $h.StartTime.Ticks -eq [long]$hstart
      if ($alive) { Start-Sleep -Milliseconds 200 }
    } while ($alive -and $sw.Elapsed.TotalSeconds -lt 15)
    # through the handle that was just checked, not the pid again
    if ($alive) { try { $h.Kill() } catch { } }
    $m = Get-Content -LiteralPath $marker -Raw -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $marker, "$marker.release" -Force -ErrorAction SilentlyContinue
    if ($alive) { "holder did not exit, stopped (marker '$m')" }
    elseif ($m -like "released|$hpid|*") { 'ok' }
    elseif ($m -like 'expired|*') { 'expired: the hold bound elapsed before the release' }
    else { "marker reads '$m'" }
  } (, $Token)
  if ("$r".Trim() -ne 'ok') { throw "NST release: $r" }
}

# A hold a killed coordinator left behind: end its live holder (which detaches) and remove its files. Returns how
# many holders were still live. Concurrent captures on one container cannot happen (leases + in_use claims).
function Clear-NstFreezeLeftover([string]$Container, [string]$Dir = $NstFreezeDir) {
  $n = Invoke-InContainer $Container { param($dir)
    $live = 0
    foreach ($f in @(Get-ChildItem -LiteralPath $dir -Filter 'nst-freeze.*' -File -ErrorAction SilentlyContinue)) {
      $m = Get-Content -LiteralPath $f.FullName -Raw -ErrorAction SilentlyContinue
      if ($f.Name -match '^nst-freeze\.[0-9a-f]{32}$' -and "$m" -match '^frozen\|(\d+)\|(\d+)\|') {
        $start = [long]$Matches[2]
        $h = Get-Process -Id ([int]$Matches[1]) -ErrorAction SilentlyContinue
        # Sol hold M1: only the recorded holder (pid AND start time), through the handle just checked
        if ($h -and -not $h.HasExited -and $h.StartTime.Ticks -eq $start) {
          $live++
          try { $h.Kill() } catch { }
          # orch r004 barrier M2: a holder that did not exit keeps its marker (evidence) and fails closed
          if (-not $h.WaitForExit(10000)) { return "STUCK holder $($h.Id) did not exit ($($f.Name))" }
        }
      }
      Remove-Item -LiteralPath $f.FullName -Force -ErrorAction SilentlyContinue
    }
    "$live"
  } (, $Dir)
  if ("$n".Trim() -like 'STUCK *') { throw "NST hold leftover: $("$n".Trim().Substring(6)); recreate the container" }
  if ("$n".Trim() -notmatch '^\d+$') { throw "NST hold leftovers unreadable: '$n'" }
  [int]"$n".Trim()
}

# One capture (fs-capture.ps1): a hold a killed capture left (end it, fail closed)? NST left suspended by an older
# NtSuspendProcess build (resume, fail closed)? -> quiescent -> hold (debugger, addendum 5) -> watermark w1 -> walk ->
# watermark w2 -> held? -> release (always, in finally) -> quiescent. w2 is read before the release: a healthcheck
# request queued during the hold logs its session after the release and must not count. Any failure is an E| line
# and the capture fails closed.
function Invoke-FsCaptureCore([string]$Container, [string[]]$Roots) {
  $lines = @()
  $held = $null
  # R-09: timing (measurement only) rides on the T| marker as JSON: hold_setup_ms (Enable-NstFreeze, the holder's
  # bound already running), held_ms (from the hold until the held-check ends: what the bound must cover, less the
  # setup), its phases, the bound, and per root the entries and in-container walk ms (Get-FsDigest).
  $timing = [ordered]@{ hold_setup_ms = $null; held_ms = $null; w1_ms = $null; walk_ms = $null; w2_ms = $null
    assert_ms = $null; bound_s = $NstHoldSeconds; roots = @() }
  $hold = $null
  $script:FsDigestRoots = @()
  try {
    if ((Clear-NstFreezeLeftover $Container) -gt 0) {
      throw 'a killed capture left the NST held; ended, this capture fails closed'
    }
    # run 004 #5: a coordinator killed after an NtSuspendProcess (before addendum 5) leaves the NST suspended
    if (Test-NstSuspended $Container) {
      Set-NstSuspended $Container $false
      throw 'the NST was left suspended (a killed capture); resumed, this capture fails closed'
    }
    if (-not (Test-NstQuiescent $Container)) { throw 'NST not quiescent before the scan' }
    $phase = [Diagnostics.Stopwatch]::StartNew()
    $held = Enable-NstFreeze $Container $NstHoldSeconds
    $timing.hold_setup_ms = $phase.ElapsedMilliseconds
    $hold = [Diagnostics.Stopwatch]::StartNew()
    $phase.Restart()
    $w1 = Get-NstSessionWatermark $Container
    $timing.w1_ms = $phase.ElapsedMilliseconds
    $phase.Restart()
    $lines = @(Get-FsDigest $Container $Roots)
    $timing.walk_ms = $phase.ElapsedMilliseconds
    $phase.Restart()
    $w2 = Get-NstSessionWatermark $Container
    $timing.w2_ms = $phase.ElapsedMilliseconds
    if ($w2 -ne $w1) { throw "the NST session log moved while held ($w1 -> $w2)" }
    # Sol r1 H3: the hold lasted the whole walk (proof, not the watermark)
    $phase.Restart()
    Assert-NstFreezeHeld $Container $held
    $timing.assert_ms = $phase.ElapsedMilliseconds
  } catch {
    $lines = @("E|(fs-capture)|$((($_.Exception.Message -replace '[\r\n|]+', ' ').Trim()))")
  } finally {
    if ($hold) { $timing.held_ms = $hold.ElapsedMilliseconds }
    $timing.roots = @($script:FsDigestRoots)
    if ($held) {
      try { Disable-NstFreeze $Container $held }
      catch { $lines += "E|(fs-capture)|$((($_.Exception.Message -replace '[\r\n|]+', ' ').Trim()))" }
    }
  }
  if (-not ($lines | Where-Object { $_ -like 'E|(fs-capture)|*' })) {
    try { if (-not (Test-NstQuiescent $Container)) { $lines += 'E|(fs-capture)|NST not quiescent after the scan' } }
    catch { $lines += "E|(fs-capture)|$((($_.Exception.Message -replace '[\r\n|]+', ' ').Trim()))" }
  }
  $lines
  "T|$($lines.Count)|$(ConvertTo-Json ([pscustomobject]$timing) -Compress -Depth 4)"
}

# The NST's user + background session count, read by a query bounded ON THE HOST (orch r004 barrier M2): a plain
# `docker exec` (not BCH) the host waits on for $DrainSeconds + $TimeoutSec and kills after that, so a frozen NST makes
# this throw "NST unresponsive" instead of hanging; the container must then be recreated. lane-ops (run 005) measured
# that an in-container bound is not enough: on a job-frozen NST the BCH exec's host side never returned although
# nothing of it was left in the container. With $DrainSeconds > 0 the query repeats once a second until the count is
# 0 or that bound passes (orch r004 barrier M3: a healthcheck request queued during a hold starts its session right
# after the release). No session type is exempt. $Query replaces the default management query and -OnHost runs it in
# a local powershell (the self-check); the query's output must be the count. Host temp files only, removed after.
function Get-NstSessionCount([string]$Container, [int]$DrainSeconds = 0, [int]$TimeoutSec = 15, [string]$Query = '',
  [switch]$OnHost) {
  if (-not $Query) {
    # the plain exec has no BCH session: load the NST management cmdlets from the image
    $Query = "`$d = Get-Item 'C:\Program Files\Microsoft Dynamics NAV\*\Service\Microsoft.Dynamics.Nav.Management.dll' -ErrorAction SilentlyContinue | Select-Object -First 1; if (`$d) { Import-Module `$d.FullName -WarningAction SilentlyContinue } else { . (Get-Item 'C:\Program Files\Microsoft Dynamics NAV\*\Service\NavAdminTool.ps1' | Select-Object -First 1).FullName *> `$null }; @(Get-NAVServerSession -ServerInstance BC -Tenant default -ErrorAction Stop | Where-Object { `$_.SessionID -ge 0 -or `"`$(`$_.ClientType)`" -eq 'Background' }).Count"
  }
  $script = "`$ProgressPreference = 'SilentlyContinue'; `$sw = [Diagnostics.Stopwatch]::StartNew(); while (`$true) { `$v = `"`$(& { $Query })`".Trim(); if (`$v -notmatch '^\d+$' -or [int]`$v -eq 0 -or `$sw.Elapsed.TotalSeconds -ge $DrainSeconds) { `$v; break }; Start-Sleep -Seconds 1 }"
  $ps = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand $([Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($script)))"
  $out = [IO.Path]::Combine([IO.Path]::GetTempPath(), "cg-nstq-$([guid]::NewGuid().ToString('N')).txt")
  try {
    $p = if ($OnHost) {
      Start-Process powershell.exe -ArgumentList $ps -NoNewWindow -PassThru -RedirectStandardOutput $out -RedirectStandardError "$out.err"
    } else {
      Start-Process docker -ArgumentList "exec $Container powershell $ps" -NoNewWindow -PassThru -RedirectStandardOutput $out -RedirectStandardError "$out.err"
    }
    if (-not $p.WaitForExit(($DrainSeconds + $TimeoutSec) * 1000)) {
      try { $p.Kill() } catch { }
      [void]$p.WaitForExit(5000)
      throw "NST unresponsive: the session query exceeded $($DrainSeconds + $TimeoutSec) s (an unknown freeze); recreate the container"
    }
    $n = "$(Get-Content -LiteralPath $out -Raw -ErrorAction SilentlyContinue)".Trim()
    if ($n -notmatch '^\d+$') {
      $e = "$(Get-Content -LiteralPath "$out.err" -Raw -ErrorAction SilentlyContinue)" -replace '[\r\n|]+', ' '
      throw "NST session count unreadable: '$n' $($e.Trim())"
    }
    [int]$n
  } finally {
    Remove-Item -LiteralPath $out, "$out.err" -Force -ErrorAction SilentlyContinue
  }
}

# Observation point (decision item 3): no user or background session on the NST, after a bounded drain. Throws when
# it cannot tell.
function Test-NstQuiescent([string]$Container, [int]$DrainSeconds = 15) {
  (Get-NstSessionCount $Container $DrainSeconds) -eq 0
}

function Get-FsDigest([string]$Container, [string[]]$Roots) {
  $lines = Invoke-InContainer $Container { param($roots)
    $sha = [Security.Cryptography.SHA256]::Create()
    function Get-Sha([byte[]]$b) { [BitConverter]::ToString($sha.ComputeHash($b)).Replace('-', '').ToLower() }
    function Clean([string]$s) { ($s -replace '[\r\n|]+', ' ').Trim() }
    # FindFirstStreamW: Get-Item -Stream misses directory streams in Windows PowerShell 5.1.
    if (-not ('CgFsStreams' -as [type])) {
      Add-Type -TypeDefinition @'
using System; using System.Collections.Generic; using System.Runtime.InteropServices;
public static class CgFsStreams {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct W32 { public long Size; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 296)] public string Name; }
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern IntPtr FindFirstStreamW(string p, int level, out W32 d, int flags);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool FindNextStreamW(IntPtr h, out W32 d);
  [DllImport("kernel32.dll")] static extern bool FindClose(IntPtr h);
  public static string[] Names(string path) {
    var r = new List<string>(); W32 d;
    IntPtr h = FindFirstStreamW(path, 0, out d, 0);
    if (h == new IntPtr(-1)) {
      int e = Marshal.GetLastWin32Error();
      if (e == 38) return r.ToArray(); // ERROR_HANDLE_EOF: no streams (a directory without ADS)
      throw new System.ComponentModel.Win32Exception(e);
    }
    try {
      do { r.Add(d.Name); } while (FindNextStreamW(h, out d));
      int e = Marshal.GetLastWin32Error();
      if (e != 38) throw new System.ComponentModel.Win32Exception(e); // only ERROR_HANDLE_EOF ends it
    } finally { FindClose(h); }
    return r.ToArray();
  }
}
'@
    }
    function ReadStream([string]$path, [string]$name) {
      $b = [byte[]](Get-Content -LiteralPath $path -Stream $name -Encoding Byte -Raw -ErrorAction Stop)
      if ($null -eq $b) { $b = [byte[]]@() }
      , $b
    }
    function Streams($item) {
      $names = [CgFsStreams]::Names($item.FullName)
      foreach ($n in $names) {
        if ($n -eq '::$DATA') { continue }
        $name = $n -replace '^:([^:]*):\$DATA$', '$1'
        $p = "$($item.FullName):$name"
        try {
          # read twice: a stream rewritten during the scan is an error, never a record
          $h1 = Get-Sha (ReadStream $item.FullName $name)
          $b = ReadStream $item.FullName $name
          if ((Get-Sha $b) -ne $h1) { "E|$p|changed during the scan" }
          else { "S|$h1|$($b.Length)|$p" }
        } catch { "E|$p|$(Clean $_.Exception.Message)" }
      }
      # Sol S3 r2: a stream added or removed while the others were read
      if ((@([CgFsStreams]::Names($item.FullName)) -join '|') -ne (@($names) -join '|')) {
        "E|$($item.FullName)|streams changed during the scan"
      }
    }
    # One entry; a directory's children are enumerated, then its last-write time is re-read (a child added or
    # removed meanwhile changes it).
    function Entry($i) {
      try {
        # enumeration reads the parent's index, which NTFS updates lazily: stat the entry itself
        $i = Get-Item -LiteralPath $i.FullName -Force -ErrorAction Stop
        $attrs = [int]$i.Attributes
        $t = $i.LastWriteTimeUtc.Ticks
        if ($i.Attributes -band [IO.FileAttributes]::ReparsePoint) {
          "L|$attrs|$t|$($i.FullName)|$(Clean "$($i.Target)")"
        } elseif ($i.PSIsContainer) {
          $lines = @("D|$attrs|$t|$($i.FullName)") + @(Streams $i)
          foreach ($c in @(Get-ChildItem -LiteralPath $i.FullName -Force -ErrorAction Stop)) { $lines += @(Entry $c) }
          $after = Get-Item -LiteralPath $i.FullName -Force -ErrorAction Stop
          if ($after.LastWriteTimeUtc.Ticks -ne $t) { $lines += "E|$($i.FullName)|changed during the scan" }
          $lines
        } else {
          $b = [IO.File]::ReadAllBytes($i.FullName)
          $after = Get-Item -LiteralPath $i.FullName -Force -ErrorAction Stop
          if ($after.Length -ne $b.Length -or $after.LastWriteTimeUtc.Ticks -ne $t) {
            "E|$($i.FullName)|changed during the scan"
          } else {
            $head = [BitConverter]::ToString($b, 0, [Math]::Min(26, $b.Length)).Replace('-', '').ToLowerInvariant()
            "F|$(Get-Sha $b)|$($b.Length)|$attrs|$t|$head|$($i.FullName)"
            Streams $i
            # and the file itself after its streams were read
            $again = Get-Item -LiteralPath $i.FullName -Force -ErrorAction Stop
            if ($again.Length -ne $b.Length -or $again.LastWriteTimeUtc.Ticks -ne $t) {
              "E|$($i.FullName)|changed during the scan"
            }
          }
        }
      } catch { "E|$($i.FullName)|$(Clean $_.Exception.Message)" }
    }
    foreach ($r in $roots) {
      # R-09: each root's entry lines and walk ms, as an R| line the host side takes out (never a digest line)
      $sw = [Diagnostics.Stopwatch]::StartNew()
      $out = @(if (-not (Test-Path -LiteralPath $r)) { "E|$r|root missing" } else {
          try { Entry (Get-Item -LiteralPath $r -Force -ErrorAction Stop) }
          catch { "E|$r|$(Clean $_.Exception.Message)" }
        })
      $out
      "R|$r|$($out.Count)|$($sw.ElapsedMilliseconds)"
    }
  } (, $Roots)
  # R-09: the per-root timing for Invoke-FsCaptureCore's T| marker; only digest lines go on
  $script:FsDigestRoots = @($lines | Where-Object { $_ -like 'R|*' } | ForEach-Object {
      $p = $_ -split '\|'
      [ordered]@{ root = $p[1]; entries = [int]$p[2]; ms = [long]$p[3] }
    })
  $lines = @($lines | Where-Object { $_ -notlike 'R|*' })
  # the path field: F (v3) 6, E 1, D/S/L 3
  Sort-Ordinal $lines { $p = $args[0] -split '\|'; switch ($p[0]) { 'F' { $p[6] } 'E' { $p[1] } default { $p[3] } } }
}

# The NST service identity (account, groups, privileges) and every root's file count and bytes (measurement only).
function Get-FsDigestFacts([string]$Container, [string[]]$Roots) {
  Invoke-InContainer $Container { param($roots)
    $svc = Get-CimInstance Win32_Service -Filter "Name='MicrosoftDynamicsNavServer`$BC'"
    "service_account|$($svc.StartName)"
    "service_path|$($svc.PathName)"
    foreach ($r in $roots) {
      $f = @(Get-ChildItem -LiteralPath $r -Recurse -Force -File -ErrorAction SilentlyContinue)
      "root|$r|files=$($f.Count)|bytes=$(($f | Measure-Object Length -Sum).Sum)"
    }
  } (, $Roots)
}

# Decision addendum 3 (platform_cache): the NST's app caches, with the shapes measured on Cronus283 (lane-ops,
# tasks\H-35\ops\suspend; 59 + 7,333 new files, all matching, uppercase hex, <xx> = the hash's first two chars).
# Only NEW files of these shapes and new or time-only-changed directories of the dir shapes are tolerated.
$FsPlatformCacheShapes = @(
  [ordered]@{
    files  = '^assembly\\release\\[0-9.]+_\d+\\([0-9A-F]{2})\\\1[0-9A-F]{62}\.dll$'
    dirs   = '^assembly(\\release(\\[0-9.]+_\d+(\\[0-9A-F]{2})?)?)?$'
    magic  = '4d5a'
    reason = 'NST compiled-assembly cache: .NET assemblies the NST compiles from published apps, named by content hash (PE files, MZ header); AL cannot write here without File/DotNet (L1/L3)'
  },
  [ordered]@{
    files  = '^metadata\\3\\([0-9A-F]{2})\\\1[0-9A-F]{62}\.(cs|xml)$'
    dirs   = '^metadata(\\3(\\[0-9A-F]{2})?)?$'
    reason = 'NST app metadata cache: generated .cs/.xml per published object, named by content hash; AL cannot write here without File/DotNet (L1/L3)'
  }
)

# The lineage's platform_cache exclude entries, the base resolved on the image (the NST's apps folder).
function Get-FsPlatformCaches([string]$Container) {
  $base = Invoke-InContainer $Container {
    $svc = Get-CimInstance Win32_Service -Filter "Name='MicrosoftDynamicsNavServer`$BC'"
    $ver = Split-Path -Leaf (Split-Path -Parent (Split-Path -Parent ($svc.PathName -replace '^"([^"]+)".*$', '$1')))
    $p = "C:\ProgramData\Microsoft\Microsoft Dynamics NAV\$ver\Server\MicrosoftDynamicsNavServer`$BC\apps"
    if (-not (Test-Path -LiteralPath $p)) { throw "NST apps folder not found: $p" }
    (Get-Item -LiteralPath $p -Force).FullName
  }
  foreach ($s in $FsPlatformCacheShapes) {
    $e = [ordered]@{ disposition = 'platform_cache'; base = "$base".Trim(); files = $s.files; dirs = $s.dirs }
    if ($s.magic) { $e.magic = $s.magic }
    $e.reason = $s.reason
    $e
  }
}

# Candidate roots of W for discovery on the image (decision 2026-10-20 item 2): resolved absolute paths.
function Get-FsDigestCandidateRoots([string]$Container) {
  Invoke-InContainer $Container {
    $svc = Get-CimInstance Win32_Service -Filter "Name='MicrosoftDynamicsNavServer`$BC'"
    $exe = ($svc.PathName -replace '^"([^"]+)".*$', '$1')
    @(
      'C:\Windows\Temp',
      'C:\Windows\System32\config\systemprofile\AppData',
      (Split-Path -Parent $exe),
      'C:\ProgramData\Microsoft\Microsoft Dynamics NAV',
      'C:\Run\my'
    ) | Where-Object { Test-Path -LiteralPath $_ } | ForEach-Object { (Get-Item -LiteralPath $_ -Force).FullName }
  }
}
