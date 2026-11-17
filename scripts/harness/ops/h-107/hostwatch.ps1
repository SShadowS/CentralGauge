#Requires -Version 7
# H-107: pwsh port of jobs\W2-10\ops\hostwatch.sh (H-89 / H-89b), one process that never forks.
# Every short-lived git-bash process leaks about one kernel token on this host; the bash version forks
# about 10 a minute. This one sleeps internally, reads its files itself and reads memory in-process
# (Get-CimInstance in a private runspace, with an in-process timeout). Per loop it spawns no child.
#
# Fail-safe: when it cannot tell that memory is fine, it acts as if memory is low.
# Every INTERVAL s it reads free RAM, commit headroom (FreeVirtualMemory) and nonpaged pool in
# invariant culture, logs them, refreshes $DIR\heartbeat, and writes named stops (stops.sh names):
#   host-low  to the lowest-priority targets: commit < 6 GB, free < 8 GB, nonpaged pool more than
#             1.5 GB above its low over the last 15 good readings, no good reading for more than 90 s
#             (a timeout, an empty or unparsed answer, a failed read all count), a backward stall
#             clock, or a comparison that gives no clean verdict (the verdict code throws)
#   host-all  to every target: commit < 3 GB, free < 4 GB, or no good reading for more than 180 s
# Nothing is ever removed. A stop is written by exclusive create (0 created, 1 exists, 2 failed); a
# failed write is retried once after 1 s, logged as an ALERT and sent to every other target as
# "escalated: ..."; any failed delivery stops the heartbeat refresh for the rest of the run, so every
# consumer (watch.sh, gates-on.sh: stops.sh hb_check, by mtime) then stops itself after 180 s.
# Stall age = max(monotonic age since the last good reading, bad readings * MIN_STEP); a negative
# age (the stall clock went backwards) is replaced by that floor and always gets at least host-low.
# The real clock is a [Diagnostics.Stopwatch] (QueryPerformanceCounter): wall-clock changes cannot
# move it.
#
# Registry (HW_REG, default $DIR\targets.tsv), parse_reg format: one target per line,
# "<stop prefix> <priority>", the priority is the last field (at most 9 digits after leading zeros,
# 01 = 1, lower = stopped first), so a prefix may contain spaces; blank lines and "#" lines (after
# leading blanks) are ignored; CRLF and a last line without a newline are accepted. Prefixes may be
# Windows (C:\x, \\srv\x), MSYS drive form (/c/x) or relative. An MSYS path outside a drive (/tmp/x)
# cannot be resolved without cygpath, so it makes the registry malformed. Logs show prefixes in MSYS
# form, exactly as the bash version printed them (cygpath -u of a backslash path). Refuses to start on
# a missing, empty or malformed registry (exit 2). Re-read every loop; if it turns malformed while
# running, the last good copy stays in use, the ALERT is logged once, and "registry valid again"
# when it recovers.
#
# Single instance: lock dir $DIR\lock-ps, created atomically (a temp dir holding "owner" is renamed
# into place, so the lock never exists without its owner). Owner = "<Windows pid> <process creation
# time, UTC ticks>"; a reused pid has another creation time. Taken over only from a verifiably dead
# owner (pid gone, or another creation time); unknown means no takeover. Takeover is serialised by a
# ticket dir $DIR\lock-ps.takeover, as in stops.sh lock_take. The old bash lock ($DIR\lock, MSYS pids)
# cannot be checked without forks, so: while $DIR\lock exists and either $DIR\heartbeat or the lock's
# owner file (the lock dir itself when it has no owner) is younger than 180 s (or in the future), this
# refuses to start (exit 3). A dead bash instance therefore blocks a start for at most 180 s.
#
# Exits (each logs its reason): STOP-hostwatch in $DIR (host-low to the lowest-priority targets, then
# "stopping on STOP-hostwatch", exit 0); HW_MAX_HOURS reached (same, "stopping on max lifetime");
# HW_ITER readings done (tests, exit 0); refusals (exit 2 registry or settings, exit 3 lock); an
# unexpected error ("exiting on error", exit 4).
#
# Start detached, so the Claude Code reaper cannot end it, under a headless console host (pwsh
# -WindowStyle Hidden still flashes a console window: the console exists before pwsh can hide it):
#   Start-Process conhost.exe -ArgumentList '--headless','"C:\Program Files\PowerShell\7\pwsh.exe"','-NoProfile','-File','H:\cg-coord\tasks\H-107\hostwatch-ps\hostwatch.ps1'
# The process tree is then conhost.exe (the launcher, created before pwsh) -> pwsh.exe (this script,
# MainWindowHandle 0) and nothing below it.
# Stop: create $DIR\STOP-hostwatch.
# Test hooks (env): HW_DIR, HW_REG, HW_INTERVAL (s, default 60), HW_ITER (readings, 0 = forever),
# HW_FEED (file, one "free commit np" line per reading; "STALL" = no answer; "HANG" = a read that
# hangs, so the in-process timeout fires), HW_STEP (fake clock: k * HW_STEP), HW_NOW_FEED (fake clock:
# one integer time per reading), HW_MIN_STEP (default HW_INTERVAL), HW_PS_TIMEOUT (default 45),
# HW_STALL_LOW / HW_STALL_ALL (default 90 / 180), HW_MAX_HOURS (default none), HW_VERDICT_FAIL=1 (the
# verdict code throws; replaces the bash fake-awk cases).
# Library use (tests): . .\hostwatch.ps1 -LibOnly   defines the functions and returns.
param([switch]$LibOnly)

function Get-Utc { [DateTime]::UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", [cultureinfo]::InvariantCulture) }

# Atomic append like bash >> (O_APPEND): a handle with only FILE_APPEND_DATA access always writes at
# the current end, so concurrent writers never overwrite each other (FileMode.Append only seeks once).
function Add-Line([string]$f, [string]$s) {
  $b = [Text.Encoding]::UTF8.GetBytes("$s`n")
  foreach ($try in 1..5) {
    try {
      $fs = [IO.FileSystemAclExtensions]::Create([IO.FileInfo]::new($f), [IO.FileMode]::OpenOrCreate, [Security.AccessControl.FileSystemRights]::AppendData,
        ([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete), 4096, [IO.FileOptions]::None, $null)
      try { $fs.Write($b, 0, $b.Length) } finally { $fs.Dispose() }
      return $true
    } catch { Start-Sleep -Milliseconds 50 }
  }
  return $false
}
function Say([string]$m) {
  if (-not (Add-Line $script:LOG "$(Get-Utc) $m")) { [Console]::Error.WriteLine("hostwatch: log write failed: $m") }
}

# Lock messages go to the log raw (no timestamp), as lock_take's stderr did in the bash version.
function Write-LockMsg([string]$m) {
  if ($script:LockLog -and (Add-Line $script:LockLog $m)) { return }
  [Console]::Error.WriteLine($m)
}

# ---- Daemon registry (H-107 item 1, H:\cg-coord\daemons.tsv through jobs\daemons\daemons.psm1). Registers once
# after the lock is taken and unregisters on every exit after that (finally block). Skipped when HW_DIR is set
# (tests and scratch runs never touch the live registry). A registry failure is logged and never stops hostwatch.
function Register-HwDaemon {
  if ($env:HW_DIR) { return }
  try {
    Import-Module 'H:\cg-coord\jobs\daemons\daemons.psm1' -ErrorAction Stop
    Register-Daemon -ProcessId $PID -Script $PSCommandPath -Owner ops -MaxHours none `
      -Purpose 'H-89 host memory watcher (pwsh port): host-low/host-all stops to targets.tsv by priority, heartbeat' `
      -StopFile (Join-Path $script:DIR 'STOP-hostwatch')
  } catch { Say "ALERT daemon registry write failed: $($_.Exception.Message)" }
}
function Unregister-HwDaemon {
  if ($env:HW_DIR) { return }
  try { Unregister-Daemon -ProcessId $PID } catch { Say "ALERT daemon registry removal failed: $($_.Exception.Message)" }
}

# stop_path: the MSYS slash form the bash version stored and logged (cygpath -u of a backslash path).
function ConvertTo-MsysPath([string]$p) {
  if (-not $p.Contains('\')) { return $p }
  if ($p -match '^([A-Za-z]):\\*(.*)$') {
    $r = $Matches[2] -replace '\\', '/'
    if ($r) { return '/' + $Matches[1].ToLower() + '/' + $r } else { return '/' + $Matches[1].ToLower() }
  }
  return $p -replace '\\', '/'
}

# The path .NET opens for an MSYS-form prefix; $null when it cannot be resolved without cygpath.
function Resolve-IoPath([string]$q) {
  if (-not $q.StartsWith('/')) { return $q }
  if ($q -match '^/([A-Za-z])(/(.*))?$') { return $Matches[1].ToUpper() + ':\' + ($Matches[3] -replace '/', '\') }
  if ($q.StartsWith('//')) { return $q -replace '/', '\' }
  return $null
}

# parse_reg. Returns { Ok, Err, P (MSYS display form), N (int priority), IO (path to write) }.
function Read-Registry([string]$reg) {
  $res = [pscustomobject]@{ Ok = $false; Err = ''; P = [Collections.Generic.List[string]]::new(); N = [Collections.Generic.List[int]]::new(); IO = [Collections.Generic.List[string]]::new() }
  if (-not [IO.File]::Exists($reg)) { $res.Err = "registry $reg missing"; return $res }
  try { $text = [IO.File]::ReadAllText($reg) } catch { $res.Err = "registry $reg unreadable: $($_.Exception.Message)"; return $res }
  $ws = [char[]]@(' ', "`t", "`n", "`v", "`f", "`r")   # [[:space:]] in the C locale
  $ln = 0
  foreach ($raw in $text.Split("`n")) {
    $ln++
    $line = $raw
    if ($line.EndsWith("`r")) { $line = $line.Substring(0, $line.Length - 1) }
    $line = $line.Trim($ws)
    if ($line -eq '' -or $line.StartsWith('#')) { continue }
    $i = $line.LastIndexOfAny($ws)
    if ($i -ge 0) { $n = $line.Substring($i + 1); $p = $line.Substring(0, $i).TrimEnd($ws) } else { $n = $line; $p = $line }
    $m = [regex]::Match($n, '^0*([0-9]{1,9})$')
    if (-not $m.Success -or $p -eq '' -or $p -eq $line) {
      $res.Err = "registry $reg line $ln malformed: '$line' (want '<stop prefix> <integer priority, at most 9 digits after leading zeros>')"; return $res
    }
    $q = ConvertTo-MsysPath $p; $io = Resolve-IoPath $q
    if (-not $q -or -not $io) { $res.Err = "registry $reg line ${ln}: prefix '$p' could not be resolved"; return $res }
    $res.P.Add($q); $res.N.Add([int]$m.Groups[1].Value); $res.IO.Add($io)
  }
  if ($res.P.Count -eq 0) { $res.Err = "registry $reg has no targets"; return $res }
  $res.Ok = $true; return $res
}

# stop_write: <prefix>.<name> holding "<name> <UTC>: <reason>", by exclusive create.
# 0 created, 1 already exists, 2 could not be written.
function Write-Stop([string]$io, [string]$name, [string]$reason) {
  if (-not $io) { return 2 }
  $f = $io + '.' + $name
  if ([IO.File]::Exists($f) -or [IO.Directory]::Exists($f)) { return 1 }
  $fs = $null
  try {
    $fs = [IO.File]::Open($f, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    $b = [Text.Encoding]::UTF8.GetBytes("$name $(Get-Utc): $reason`n"); $fs.Write($b, 0, $b.Length)
    $fs.Dispose(); $fs = $null
    return 0
  } catch {
    if ($fs) { try { $fs.Dispose() } catch {} }
    if ([IO.File]::Exists($f) -or [IO.Directory]::Exists($f)) { return 1 }
    return 2
  }
}

# ---- Lock (stops.sh lock_take / lock_release, with Windows pid + creation time as identity).
function Get-ProcStart([int]$id) {
  try { return [string][Diagnostics.Process]::GetProcessById($id).StartTime.ToUniversalTime().Ticks } catch { return $null }
}
# dead | live | unknown (an empty recorded start, or a process whose start cannot be read, is unknown)
function Get-ProcState([string]$id, [string]$start) {
  $n = 0
  if ($id -notmatch '^[0-9]+$' -or -not $start -or -not [int]::TryParse($id, [ref]$n)) { return 'unknown' }
  try { $p = [Diagnostics.Process]::GetProcessById($n) }
  catch { if ($_.Exception -is [ArgumentException] -or $_.Exception.InnerException -is [ArgumentException]) { return 'dead' }; return 'unknown' }
  try { $s = [string]$p.StartTime.ToUniversalTime().Ticks } catch { return 'unknown' }
  if ($s -eq $start) { return 'live' } else { return 'dead' }
}
# Atomic create of <target> (a dir), already holding <target>\owner when $owner is given.
function New-AtomicDir([string]$target, [string]$owner) {
  $tmp = $target + '.new-' + $PID + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8)
  try {
    [void][IO.Directory]::CreateDirectory($tmp)
    if ($owner) { [IO.File]::WriteAllText([IO.Path]::Combine($tmp, 'owner'), "$owner`n") }
    [IO.Directory]::Move($tmp, $target)
    return $true
  } catch {
    try { if ([IO.Directory]::Exists($tmp)) { [IO.Directory]::Delete($tmp, $true) } } catch {}
    return $false
  }
}
function Read-Owner([string]$L) { try { return ([IO.File]::ReadAllText([IO.Path]::Combine($L, 'owner'))).Trim() } catch { return '' } }
$script:LOCK_ME = ''
# 0 taken, 3 held by a live owner (or a takeover in progress), 1 any other failure.
function Lock-Take([string]$L) {
  $me = Get-ProcStart $PID
  if (-not $me) { Write-LockMsg "lock: cannot read our own start time; not taking $L"; return 1 }
  $script:LOCK_ME = "$PID $me"
  foreach ($i in 1..3) {
    if (New-AtomicDir $L $script:LOCK_ME) { return 0 }
    if (-not [IO.Directory]::Exists($L)) { Write-LockMsg "lock: cannot create $L"; return 1 }
    foreach ($w in 1..20) { if (Read-Owner $L) { break }; Start-Sleep -Milliseconds 500 }
    $o = Read-Owner $L
    if (-not $o) { Write-LockMsg "lock: $L has no owner after 10 s; not taking it over"; return 1 }
    $opid, $ost = $o -split '\s+', 2
    try { $state = Get-ProcState $opid $ost } catch { $state = 'unknown' }
    if (-not $state) { $state = 'unknown' }
    if ($state -eq 'live') { Write-LockMsg "lock: held by live pid $opid"; return 3 }
    if ($state -ne 'dead') { Write-LockMsg "lock: owner pid $opid state unknown ('$state'); not taking it over"; return 1 }
    if (-not (New-AtomicDir "$L.takeover" '')) {
      Write-LockMsg "lock: another takeover of $L is in progress (or a stale $L.takeover; remove it by hand)"; return 3
    }
    try {
      if ((Read-Owner $L) -eq $o) {
        $side = "$L.stale-$PID-$i"
        try { [IO.Directory]::Move($L, $side); Write-LockMsg "lock: took over from dead owner '$o'"; [IO.Directory]::Delete($side, $true) } catch {}
      }
    } finally { try { [IO.Directory]::Delete("$L.takeover", $true) } catch {} }
  }
  Write-LockMsg "lock: could not take $L"; return 1
}
function Lock-Release([string]$L) {
  if (-not $script:LOCK_ME) { return }
  try { if ((Read-Owner $L) -eq $script:LOCK_ME) { [IO.Directory]::Delete($L, $true) } } catch {}
}

# ---- Readings and verdict.
# One reading through a private runspace with an in-process timeout. rc 0 answer, 1 empty/failed,
# 124 timeout (the code timeout(1) gave). Feed mode returns the feed line (rc 1 for empty or STALL).
function Read-Mem {
  try {
    if ($script:Feed) {
      $ls = [IO.File]::ReadAllText($script:Feed).Split("`n"); $i = $script:k - 1
      $arg = if ($i -lt $ls.Count) { $ls[$i] } else { '' }
    } else { $arg = $script:PST }
    if ($null -eq $script:Rs) { $script:Rs = [runspacefactory]::CreateRunspace(); $script:Rs.Open() }
    $ps = [powershell]::Create(); $ps.Runspace = $script:Rs
    [void]$ps.AddScript($script:ReadScript).AddArgument($arg)
    $h = $ps.BeginInvoke()
    if (-not $h.AsyncWaitHandle.WaitOne([int]($script:PST * 1000))) {
      # ponytail: a hung read abandons its runspace (one thread + its memory per timeout); add a
      # bounded pool and refuse new reads past N hung ones if real hangs turn out frequent.
      try { [void]$ps.BeginStop($null, $null) } catch {}
      $script:Rs = $null
      return [pscustomobject]@{ rc = 124; out = ''; err = "read timed out after $($script:PST) s" }
    }
    $r = $ps.EndInvoke($h); $ps.Dispose()
    $out = (@($r) | ForEach-Object { "$_" }) -join "`n"
    if ($script:Feed) {
      if ($out -ne '' -and $out -ne 'STALL') { return [pscustomobject]@{ rc = 0; out = $out; err = $null } }
      return [pscustomobject]@{ rc = 1; out = ''; err = $null }
    }
    return [pscustomobject]@{ rc = 0; out = ($out -replace "`r", '').TrimEnd("`n"); err = $null }
  } catch {
    return [pscustomobject]@{ rc = 1; out = ''; err = $_.Exception.Message }
  }
}

# The stall clock: HW_NOW_FEED line k (line 1 at k = 0), HW_STEP * k, or whole Stopwatch seconds.
function Get-Now {
  if ($script:NowFeed) {
    try {
      $ls = [IO.File]::ReadAllText($script:NowFeed).Split("`n"); $i = [Math]::Max($script:k, 1) - 1
      $x = 0L; if ($i -lt $ls.Count -and [long]::TryParse($ls[$i].Trim(), [ref]$x)) { return $x }
    } catch {}
    return 0L   # an unreadable fake time counts as 0, as an empty bash arithmetic operand did
  }
  if ($null -ne $script:Step) { return [long]($script:k * $script:Step) }
  return [long][Math]::Floor($script:Sw.Elapsed.TotalSeconds)
}

# The awk comparison: ALL / LOW / OK plus the window low (its original text).
function Get-Verdict([string]$f, [string]$c, [string]$n, $w) {
  if ([Environment]::GetEnvironmentVariable('HW_VERDICT_FAIL')) { throw 'forced verdict failure (HW_VERDICT_FAIL test hook)' }
  $inv = [cultureinfo]::InvariantCulture
  $lo = $w[0]
  for ($i = 1; $i -lt $w.Count; $i++) { if ([double]::Parse($w[$i], $inv) -lt [double]::Parse($lo, $inv)) { $lo = $w[$i] } }
  # Own names: PowerShell variables are case-insensitive, and $f/$c/$n are [string] parameters.
  $dF = [double]::Parse($f, $inv); $dC = [double]::Parse($c, $inv); $dN = [double]::Parse($n, $inv); $dLo = [double]::Parse($lo, $inv)
  $v = if ($dC -lt 3 -or $dF -lt 4) { 'ALL' } elseif ($dC -lt 6 -or $dF -lt 8 -or ($dN - $dLo) -gt 1.5) { 'LOW' } else { 'OK' }
  return [pscustomobject]@{ Verdict = $v; Lo = $lo }
}

# hit: host-low to the lowest-priority targets of the last good registry, host-all to every target.
function Invoke-Hit([string]$what, [string]$why) {
  $min = $null
  foreach ($x in $script:GoodN) { if ($null -eq $min -or $x -lt $min) { $min = $x } }
  $failed = [Collections.Generic.List[int]]::new()
  for ($i = 0; $i -lt $script:GoodP.Count; $i++) {
    if ($what -eq 'host-low' -and $script:GoodN[$i] -ne $min) { continue }
    $rc = Write-Stop $script:GoodIO[$i] $what $why
    if ($rc -eq 2) { Start-Sleep -Seconds 1; $rc = Write-Stop $script:GoodIO[$i] $what $why }
    if ($rc -eq 0) { Say "ALERT $what -> $($script:GoodP[$i]).$what ($why)" }
    elseif ($rc -eq 2) { Say "ALERT stop write FAILED twice: $($script:GoodP[$i]).$what ($why)"; $failed.Add($i) }
  }
  # A target that could not be stopped: the same stop goes to every other target too (H-89b item 4).
  if ($failed.Count -gt 0) {
    $script:DeliveryFailed = $true
    $esc = "escalated: a stop write to another target failed; $why"
    for ($i = 0; $i -lt $script:GoodP.Count; $i++) {
      if ($failed.Contains($i)) { continue }
      $rc = Write-Stop $script:GoodIO[$i] $what $esc
      if ($rc -eq 2) { Start-Sleep -Seconds 1; $rc = Write-Stop $script:GoodIO[$i] $what $esc }
      if ($rc -eq 0) { Say "ALERT $what -> $($script:GoodP[$i]).$what (escalated after a failed write)" }
      elseif ($rc -eq 2) { Say "ALERT escalated stop write FAILED twice: $($script:GoodP[$i]).$what" }
    }
  }
}

function Get-EnvLong([string]$n, $def) {
  $v = [Environment]::GetEnvironmentVariable($n)
  if ([string]::IsNullOrEmpty($v)) { return $def }
  $x = 0L
  if (-not [long]::TryParse($v, [Globalization.NumberStyles]::AllowLeadingSign, [cultureinfo]::InvariantCulture, [ref]$x)) { throw "$n='$v' is not an integer" }
  return $x
}

if ($LibOnly) { return }

function Invoke-Main {
  $script:Sw = [Diagnostics.Stopwatch]::StartNew()
  $script:DIR = if ($env:HW_DIR) { $env:HW_DIR } else { 'H:\cg-coord\jobs\W2-10\hostwatch' }
  $DIR = $script:DIR
  $REG = if ($env:HW_REG) { $env:HW_REG } else { Join-Path $DIR 'targets.tsv' }
  $script:LOG = Join-Path $DIR 'hostwatch.log'
  try { [void][IO.Directory]::CreateDirectory($DIR) } catch { [Console]::Error.WriteLine("hostwatch: cannot create $DIR"); $script:Code = 2; return }
  try {
    $INTERVAL = Get-EnvLong HW_INTERVAL 60L; $ITER = Get-EnvLong HW_ITER 0L; $script:PST = Get-EnvLong HW_PS_TIMEOUT 45L
    $STALL_LOW = Get-EnvLong HW_STALL_LOW 90L; $STALL_ALL = Get-EnvLong HW_STALL_ALL 180L
    $MIN_STEP = Get-EnvLong HW_MIN_STEP $INTERVAL; $script:Step = Get-EnvLong HW_STEP $null
    $maxH = $env:HW_MAX_HOURS; $maxSec = 0.0
    if ($maxH -and $maxH -ne 'none') {
      $h = 0.0
      if (-not [double]::TryParse($maxH, [Globalization.NumberStyles]::Float, [cultureinfo]::InvariantCulture, [ref]$h) -or $h -le 0) { throw "HW_MAX_HOURS='$maxH' is not a positive number" }
      $maxSec = $h * 3600
    }
  } catch {
    [Console]::Error.WriteLine("hostwatch refuses to start: $($_.Exception.Message)"); Say "REFUSED to start: $($_.Exception.Message)"; $script:Code = 2; return
  }
  $script:Feed = $env:HW_FEED; $script:NowFeed = $env:HW_NOW_FEED
  # Orchestrator ruling 2026-11-16: a failed or empty CIM query is a bad reading (stall tiers), never 0 GB. The bash
  # version formatted a null result as "0.0 0.0 0.00" with rc 0, which wrote host-all to every target at once.
  # HW_CIM_CLASS (test hook) replaces Win32_OperatingSystem, so a test can make the real query fail.
  $osClass = if ($env:HW_CIM_CLASS) { $env:HW_CIM_CLASS } else { 'Win32_OperatingSystem' }
  $script:ReadScript = if ($script:Feed) { 'param($l) if ($l -eq "HANG") { Start-Sleep -Seconds 600 }; $l' } else {
    'param($t) $o=Get-CimInstance ' + $osClass + ' -OperationTimeoutSec $t -ErrorAction Stop; $pm=Get-CimInstance Win32_PerfRawData_PerfOS_Memory -OperationTimeoutSec $t -ErrorAction Stop; if ($null -eq $o -or $null -eq $pm -or $null -eq $o.FreePhysicalMemory -or $null -eq $o.FreeVirtualMemory -or $null -eq $pm.PoolNonpagedBytes) { throw "CIM returned no memory data" }; [string]::Format([cultureinfo]::InvariantCulture,"{0:F1} {1:F1} {2:F2}",$o.FreePhysicalMemory/1MB,$o.FreeVirtualMemory/1MB,$pm.PoolNonpagedBytes/1GB)'
  }

  # One checked parse at startup (H-89b item 6): what is validated is what gets stored.
  $r = Read-Registry $REG
  if (-not $r.Ok) { [Console]::Error.WriteLine("hostwatch refuses to start: $($r.Err)"); Say "REFUSED to start: $($r.Err)"; $script:Code = 2; return }
  $script:GoodP = $r.P; $script:GoodN = $r.N; $script:GoodIO = $r.IO; $regOk = $true

  # The bash lock ($DIR\lock) holds an MSYS pid that cannot be checked without a fork: refuse while it
  # exists and the heartbeat or the lock itself is younger than 180 s (or in the future).
  $bl = Join-Path $DIR 'lock'
  if ([IO.Directory]::Exists($bl)) {
    $now = [DateTime]::UtcNow; $why = @()
    $hb = Join-Path $DIR 'heartbeat'
    if ([IO.File]::Exists($hb)) { $a = [long]($now - [IO.File]::GetLastWriteTimeUtc($hb)).TotalSeconds; if ($a -lt 180) { $why += "heartbeat ${a}s old" } }
    $bo = Join-Path $bl 'owner'
    $lt = if ([IO.File]::Exists($bo)) { [IO.File]::GetLastWriteTimeUtc($bo) } else { [IO.Directory]::GetLastWriteTimeUtc($bl) }
    $a = [long]($now - $lt).TotalSeconds; if ($a -lt 180) { $why += "bash lock ${a}s old" }
    if ($why.Count) {
      $msg = "the bash hostwatch lock $bl exists and is recent ($($why -join ', '); < 180 s): a bash hostwatch may be live"
      [Console]::Error.WriteLine("hostwatch refuses to start: $msg"); Say "REFUSED to start: $msg"; $script:Code = 3; return
    }
  }

  $script:LockLog = $script:LOG
  $rc = Lock-Take (Join-Path $DIR 'lock-ps')
  if ($rc -ne 0) {
    [Console]::Error.WriteLine("hostwatch: lock not taken (see $($script:LOG))")
    if ($rc -eq 3) { [Console]::Error.WriteLine('hostwatch already runs') }
    Say "REFUSED to start: lock not taken (rc $rc)"; $script:Code = 3; return
  }
  $script:LockHeld = $true
  Register-HwDaemon; $script:Registered = $true
  Say "started (pid $PID), $($script:GoodP.Count) targets"

  $script:k = 0
  $nps = [Collections.Generic.List[string]]::new()
  $lastGood = Get-Now; $badN = 0L; $script:DeliveryFailed = $false
  $num = '[0-9]+(\.[0-9]+)?'; $re = "^$num $num $num\z"
  while ($true) {
    $script:k++
    if ([IO.File]::Exists((Join-Path $DIR 'STOP-hostwatch'))) {
      Invoke-Hit host-low 'hostwatch stopping (STOP-hostwatch)'; Say 'stopping on STOP-hostwatch'; $script:Code = 0; return
    }
    if ($maxSec -gt 0 -and $script:Sw.Elapsed.TotalSeconds -ge $maxSec) {
      Invoke-Hit host-low "hostwatch stopping (max lifetime $maxH h)"; Say "stopping on max lifetime ($maxH h, HW_MAX_HOURS)"; $script:Code = 0; return
    }
    $r = Read-Registry $REG
    if ($r.Ok) {
      $script:GoodP = $r.P; $script:GoodN = $r.N; $script:GoodIO = $r.IO
      if (-not $regOk) { Say 'registry valid again' }; $regOk = $true
    } elseif ($regOk) { $regOk = $false; Say "ALERT registry malformed, keeping the last good copy: $($r.Err)" }
    $m = Read-Mem
    $t = Get-Now   # after the read, so a hung read counts toward the stall age
    # Guard (orchestrator ruling): exactly 0 free and 0 commit headroom is not a real reading, it is a failed one.
    if ($m.rc -eq 0 -and [regex]::IsMatch($m.out, $re)) {
      $zp = $m.out.Split(' ')
      if ([double]::Parse($zp[0], [cultureinfo]::InvariantCulture) -eq 0 -and [double]::Parse($zp[1], [cultureinfo]::InvariantCulture) -eq 0) {
        $m = [pscustomobject]@{ rc = 1; out = $m.out; err = 'zero free and zero commit headroom: not a real reading' }
      }
    }
    if ($m.rc -eq 0 -and [regex]::IsMatch($m.out, $re)) {
      $FREE, $COMMIT, $NP = $m.out.Split(' ')
      $lastGood = $t; $badN = 0L; $nps.Add($NP); while ($nps.Count -gt 15) { $nps.RemoveAt(0) }
      $verdict = ''; $lo = ''; $verr = $null
      try { $v = Get-Verdict $FREE $COMMIT $NP $nps; $verdict = $v.Verdict; $lo = $v.Lo } catch { $verr = $_.Exception.Message }
      $loS = if ($lo) { $lo } else { '?' }; $vS = if ($verdict) { $verdict } else { 'none' }
      Say "free=$FREE commit_headroom=$COMMIT np=$NP np_low=$loS verdict=$vS"
      $why = "free $FREE GB, commit headroom $COMMIT GB, nonpaged $loS -> $NP GB"
      if ($verr -or -not $verdict) { Invoke-Hit host-low "no clean verdict (verdict error: $verr): $why" }
      elseif ($verdict -eq 'ALL') { Invoke-Hit host-all $why }
      elseif ($verdict -eq 'LOW') { Invoke-Hit host-low $why }
      elseif ($verdict -ne 'OK') { Invoke-Hit host-low "unexpected verdict '$verdict': $why" }
    } else {
      # A negative age (the clock went backwards) is replaced by the floor, goes through the same
      # tiers (host-all included) and gets at least host-low (H-89b run 002 item 3).
      $badN++; $age = $t - $lastGood; $floor = $badN * $MIN_STEP; $back = ''
      if ($age -lt 0) { $back = " (stall clock went backwards by $(-$age)s)"; $age = $floor }
      if ($floor -gt $age) { $age = $floor }
      Say "bad reading (rc $($m.rc), '$($m.out)'), ${age}s since the last good one$back"
      if ($m.err) { Say "read error: $($m.err)" }
      if ($age -gt $STALL_ALL) { Invoke-Hit host-all "no good reading for ${age}s$back" }
      elseif ($age -gt $STALL_LOW -or $back) { Invoke-Hit host-low "no good reading for ${age}s$back" }
    }
    if ($script:DeliveryFailed) {
      Say 'heartbeat NOT refreshed: a stop could not be delivered (consumers stop themselves after 180 s)'
    } else {
      # Atomic publication: a failed write never leaves a fresh-looking (truncated) heartbeat.
      try {
        $tmp = Join-Path $DIR 'heartbeat.tmp'
        [IO.File]::WriteAllText($tmp, "$(Get-Utc)`n")
        if ([IO.FileInfo]::new($tmp).Length -le 0) { throw 'empty heartbeat.tmp' }
        [IO.File]::Move($tmp, (Join-Path $DIR 'heartbeat'), $true)
      } catch { Say 'ALERT heartbeat write failed' }
    }
    if ($ITER -gt 0 -and $script:k -ge $ITER) { Say "exiting after $ITER readings (HW_ITER)"; $script:Code = 0; return }
    Start-Sleep -Seconds $INTERVAL
  }
}

$script:Code = 4; $script:LockHeld = $false; $script:Registered = $false; $script:LOG = $null
try { $null = Invoke-Main }
catch {
  $m = "exiting on error: $($_.Exception.Message) ($($_.InvocationInfo.ScriptLineNumber))"
  if ($script:LOG) { Say $m }; [Console]::Error.WriteLine("hostwatch: $m"); $script:Code = 4
} finally {
  if ($script:Registered) { try { Unregister-HwDaemon } catch {} }
  if ($script:LockHeld) { Lock-Release (Join-Path $script:DIR 'lock-ps') }
}
[Environment]::Exit($script:Code)
