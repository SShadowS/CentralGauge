# H-107 orphan reaper: one pass per run, started hourly by the scheduled task "cg-coord-reaper" (reaper-task.ps1).
# Read-only by default. It looks only at bash.exe, sh.exe and sleep.exe.
#
# Candidates:
#   - unregistered, with no claude.exe among its ancestors:
#       bash/sh older than -MinAgeMin (default 15);
#       sleep older than its own argument + 300 s (an unparsed argument: older than 1 h);
#   - registered (the process or an ancestor matches a daemons.tsv row by pid + start time), with the
#     registered root older than its max_hours.
# Never touched: a registered daemon within its lifetime and everything under it, a descendant of a live
# claude.exe, any other image. Ancestors are followed by ParentProcessId, and a "parent" created after its
# child is a reused pid, so the chain stops there.
#
# Mode: dry-run unless H:\cg-coord\jobs\reaper\MODE holds exactly "kill" (only the orchestrator sets it, after 7
# clean dry-run days). Dry-run logs the candidates to <dir>\YYYY-MM-DD.log (UTC date). When any candidate is new
# (not in <dir>\seen.txt), it files `coord ask --task H-107 --from reaper`, at most once per UTC day. Kill mode
# re-reads each candidate's creation time and stops it by PID only when it still matches.
param([int]$MinAgeMin = 15, [string]$Dir = 'H:\cg-coord\jobs\reaper', [string]$Registry = 'H:\cg-coord\daemons.tsv',
  [switch]$NoAsk, [int]$SleepGraceS = 300, [string]$OnlyPids = '')
# -OnlyPids "1,2": kill mode stops only these candidates (tests: never anything but the planted processes).
$only = @($OnlyPids -split ',' | Where-Object { $_.Trim() } | ForEach-Object { [int]$_ })
$ErrorActionPreference = 'Stop'
Import-Module 'H:\cg-coord\jobs\daemons\daemons.psm1' -Force
$now = (Get-Date).ToUniversalTime()
$log = Join-Path $Dir ($now.ToString('yyyy-MM-dd') + '.log')
function Say([string]$s) { Add-Content -LiteralPath $log -Value ("{0} {1}" -f (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ'), $s) }
$modeFile = Join-Path $Dir 'MODE'
$mode = if ((Test-Path -LiteralPath $modeFile) -and ((Get-Content -LiteralPath $modeFile -Raw).Trim() -eq 'kill')) { 'kill' } else { 'dry-run' }

# One pass at a time: a run still going (hung CIM query) blocks the next one instead of overlapping it.
$lock = Join-Path $Dir 'reaper.lock'
try { $lockFs = [IO.File]::Open($lock, 'CreateNew', 'Write', 'None') }
catch {
  $age = ((Get-Date) - (Get-Item -LiteralPath $lock).LastWriteTime).TotalMinutes
  if ($age -lt 120) { Say "skip: another pass holds $lock ($([int]$age) min)"; exit 0 }
  Remove-Item -LiteralPath $lock -Force; $lockFs = [IO.File]::Open($lock, 'CreateNew', 'Write', 'None')
}
try {
  $procs = @{}
  Get-CimInstance Win32_Process | ForEach-Object { $procs[[int]$_.ProcessId] = $_ }
  $reg = @{}
  foreach ($r in Read-Daemons $Registry) { $reg["$($r.pid)|$($r.start_utc)"] = $r }
  function Key($p) { "$($p.ProcessId)|$($p.CreationDate.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ'))" }
  function Mask([string]$c) { if (-not $c) { return '' }; $c = $c -replace '(--coord-lease\s+\S+=)\S+', '$1***'; $c.Substring(0, [Math]::Min(300, $c.Length)) }

  # Protection (H-107 fix 2026-11-17: the 08:00Z dry run listed the live, owner-launched M8-21 back-half chain): a
  # process is never a candidate when its own command line or a live descendant's mentions "harness", or when a live
  # descendant runs deno, pwsh, powershell or docker. Owner-launched runs have no claude.exe ancestor, so that
  # heuristic alone is unsafe. Descendants are followed by ParentProcessId; a "child" created before its parent is a
  # reused pid and is not followed.
  $kids = @{}
  foreach ($q in $procs.Values) { $pp = [int]$q.ParentProcessId; if (-not $kids.ContainsKey($pp)) { $kids[$pp] = @() }; $kids[$pp] += $q }
  function Protection($p) {
    if ($p.CommandLine -match '\bharness\b') { return 'its command line mentions harness' }
    $queue = [Collections.Generic.Queue[object]]::new(); $queue.Enqueue($p); $seenD = @{}
    while ($queue.Count) {
      $cur = $queue.Dequeue()
      foreach ($c in @($kids[[int]$cur.ProcessId])) {
        if (-not $c -or $seenD.ContainsKey([int]$c.ProcessId) -or $c.CreationDate -lt $cur.CreationDate) { continue }
        $seenD[[int]$c.ProcessId] = 1
        if ($c.Name -in 'deno.exe', 'pwsh.exe', 'powershell.exe', 'docker.exe') { return "live descendant $($c.Name) pid $($c.ProcessId)" }
        if ($c.CommandLine -match '\bharness\b') { return "live descendant pid $($c.ProcessId) mentions harness" }
        $queue.Enqueue($c)
      }
    }
    return $null
  }
  $protected = 0
  $cands = @()
  foreach ($p in $procs.Values) {
    if ($p.Name -notin 'bash.exe', 'sh.exe', 'sleep.exe') { continue }
    $ageS = ($now - $p.CreationDate.ToUniversalTime()).TotalSeconds
    # Walk the ancestors: claude.exe means "a live session owns it"; a registry row means "a daemon".
    $claude = $false; $row = $null; $rowProc = $null; $cur = $p; $seen = @{}
    while ($true) {
      $k = Key $cur
      if (-not $row -and $reg.ContainsKey($k)) { $row = $reg[$k]; $rowProc = $cur }
      if ($cur -ne $p -and $cur.Name -eq 'claude.exe') { $claude = $true; break }
      $pp = [int]$cur.ParentProcessId
      if ($seen.ContainsKey($pp) -or -not $procs.ContainsKey($pp)) { break }
      $par = $procs[$pp]
      if ($par.CreationDate -gt $cur.CreationDate) { break }
      $seen[$pp] = 1; $cur = $par
    }
    if ($claude) { continue }
    $why = $null
    if ($row) {
      if ($row.max_hours -ne 'none') {
        $rootH = ($now - $rowProc.CreationDate.ToUniversalTime()).TotalHours
        if ($rootH -gt [double]$row.max_hours) { $why = "registered $($row.script) past max_hours $($row.max_hours) ($([Math]::Round($rootH, 1)) h)" }
      }
    } elseif ($p.Name -eq 'sleep.exe') {
      $arg = if ($p.CommandLine -match 'sleep(\.exe)?"?\s+(\d+(\.\d+)?)\s*$') { [double]$Matches[2] } else { $null }
      if ($null -ne $arg) { if ($ageS -gt $arg + $SleepGraceS) { $why = "unregistered sleep $arg s still alive after $([int]$ageS) s" } }
      elseif ($ageS -gt 3600) { $why = "unregistered sleep (argument not parsed) older than 1 h" }
    } elseif ($ageS -gt $MinAgeMin * 60) {
      $why = "unregistered $($p.Name), no claude.exe ancestor, $([int]($ageS / 60)) min old"
    }
    if ($why) {
      $guard = Protection $p
      if ($guard) { $protected++; Say ("protected pid={0} {1}: {2} (would have been: {3})" -f $p.ProcessId, $p.Name, $guard, $why); continue }
      $cands += [pscustomobject]@{ key = (Key $p); pid = $p.ProcessId; name = $p.Name; why = $why; cmd = (Mask $p.CommandLine) }
    }
  }

  Say "run mode=$mode candidates=$($cands.Count) protected=$protected processes=$($procs.Count) registry_rows=$($reg.Count)"
  foreach ($c in $cands) { Say ("candidate pid={0} start={1} {2}: {3} | {4}" -f $c.pid, ($c.key -split '\|')[1], $c.name, $c.why, $c.cmd) }

  if ($mode -eq 'kill') {
    # Hard rule (orchestrator 2026-11-16): never kill a process whose command line names a script listed in the LIVE
    # registry, whatever -Registry says and even when its row is stale (pid/start no longer match). Paths are compared
    # case-insensitively in one form (forward slashes, "h:/" as "/h/"), so MSYS command lines match Windows rows.
    function Norm([string]$s) { ($s.ToLowerInvariant() -replace '\\', '/') -replace '\b([a-z]):/', '/$1/' }
    $liveScripts = @(Read-Daemons 'H:\cg-coord\daemons.tsv' | ForEach-Object { Norm $_.script } | Where-Object { $_ })
    foreach ($c in $cands) {
      $cn = Norm $c.cmd
      $hit = @($liveScripts | Where-Object { $cn.Contains($_) })[0]
      if ($hit) { Say "kill refused pid=$($c.pid): its command line names live-registry script $hit"; continue }
      if ($only.Count -gt 0 -and $c.pid -notin $only) { Say "kill skipped pid=$($c.pid): not in -OnlyPids"; continue }
      $q = Get-CimInstance Win32_Process -Filter "ProcessId=$($c.pid)" -ErrorAction SilentlyContinue
      if (-not $q -or (Key $q) -ne $c.key) { Say "kill skipped pid=$($c.pid): gone or pid reused"; continue }
      try { Stop-Process -Id $c.pid -Force -ErrorAction Stop; Say "killed pid=$($c.pid) $($c.name)" }
      catch { Say "kill FAILED pid=$($c.pid): $($_.Exception.Message)" }
    }
  }

  # Tell the orchestrator about new candidates, at most once per UTC day.
  $seenFile = Join-Path $Dir 'seen.txt'
  $known = @{}; if (Test-Path -LiteralPath $seenFile) { foreach ($l in Get-Content -LiteralPath $seenFile) { $known[$l] = 1 } }
  $new = @($cands | Where-Object { -not $known.ContainsKey($_.key) })
  if ($new.Count -gt 0) {
    Add-Content -LiteralPath $seenFile -Value ($new | ForEach-Object { $_.key })
    $askMark = Join-Path $Dir ("asked-" + $now.ToString('yyyy-MM-dd'))
    if (-not $NoAsk -and -not (Test-Path -LiteralPath $askMark)) {
      $text = "reaper ($mode): $($cands.Count) candidate(s), $($new.Count) new, at $($now.ToString('yyyy-MM-ddTHH:mm:ssZ')). See $log."
      $env:CG_COORD_ROOT = 'H:\cg-coord'
      $deno = 'C:\Users\SShadowS\AppData\Local\Microsoft\WinGet\Packages\DenoLand.Deno_Microsoft.Winget.Source_8wekyb3d8bbwe\deno.EXE'
      $out = & $deno run --allow-all 'H:/cg-coord/jobs/orch-master/scripts/coord/coord.ts' ask $text --task H-107 --from reaper 2>&1
      if ($LASTEXITCODE -eq 0) { New-Item -ItemType File -Path $askMark | Out-Null; Say "asked the orchestrator: $out" }
      else { Say "coord ask FAILED (rc $LASTEXITCODE): $out" }
    }
  }
} catch {
  Say "ERROR: $($_.Exception.Message)"; exit 1
} finally {
  $lockFs.Dispose(); Remove-Item -LiteralPath $lock -Force -ErrorAction SilentlyContinue
}
