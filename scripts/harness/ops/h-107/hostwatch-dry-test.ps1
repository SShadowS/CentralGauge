#Requires -Version 7
# H-107 dry test for hostwatch.ps1: the hostwatch cases of jobs\W2-10\ops\hostwatch-dry-test.sh,
# ported, plus cases for the new parts (in-process read timeout, lock-ps, bash-lock refusal, max
# lifetime, MSYS prefixes) and a churn check (real reading, no child processes per loop).
# Everything runs in a scratch dir ($env:TEMP\hw-ps-test-<random>) with fed readings and a fake
# clock. No live registry, STOP path or hostwatch dir is touched. Processes are only ever stopped by
# the PID this script started. usage: pwsh -NoProfile -File hostwatch-dry-test.ps1 [-Work <dir>] [-SkipChurn]
# Exit 0 only when every check passes.
param([string]$Work, [switch]$SkipChurn)

$HW = Join-Path $PSScriptRoot 'hostwatch.ps1'
$W = if ($Work) { $Work } else { Join-Path $env:TEMP ('hw-ps-test-' + [guid]::NewGuid().ToString('N').Substring(0, 8)) }
if ($W -match '\s') { throw "work dir must not contain spaces: $W" }
if ($W -like 'H:\cg-coord\jobs\*') { throw "refusing a work dir under jobs\: $W" }
[void][IO.Directory]::CreateDirectory($W)
$script:pass = 0; $script:fail = 0
$HWVARS = 'HW_DIR', 'HW_REG', 'HW_FEED', 'HW_INTERVAL', 'HW_STEP', 'HW_ITER', 'HW_NOW_FEED', 'HW_MIN_STEP', 'HW_PS_TIMEOUT', 'HW_STALL_LOW', 'HW_STALL_ALL', 'HW_MAX_HOURS', 'HW_VERDICT_FAIL', 'HW_CIM_CLASS'

# Parameter names must not collide with the case variables ($D, $c...): PowerShell names are
# case-insensitive and the condition block runs in this function's scope.
function Check([string]$chkDesc, [scriptblock]$chkCond) {
  $chkOk = $false; try { $chkOk = [bool](& $chkCond) } catch { $chkOk = $false }
  if ($chkOk) { $script:pass++; Write-Output "[OK]   $chkDesc" } else { $script:fail++; Write-Output "[FAIL] $chkDesc" }
}
function Has { foreach ($f in $args) { if (-not [IO.File]::Exists($f)) { return $false } }; $true }
function Hasnt { foreach ($f in $args) { if (Test-Path -LiteralPath $f) { return $false } }; $true }
function Logged([string]$f, [string]$s) { [IO.File]::Exists($f) -and ([IO.File]::ReadAllText($f)).Contains($s) }
function CountIn([string]$f, [string]$s) { if (-not [IO.File]::Exists($f)) { return 0 }; @([IO.File]::ReadAllLines($f) | Where-Object { $_.Contains($s) }).Count }
# Active stops of prefix P (active_stops semantics, for the test only): P or P.* except P.cleared-*.
function Active([string]$p) {
  $d = Split-Path $p; $b = Split-Path $p -Leaf
  @(Get-ChildItem -LiteralPath $d -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -eq $b -or ($_.Name -like "$b.*" -and $_.Name -notlike "$b.cleared-*") }).Count -gt 0
}
function Inactive([string]$p) { -not (Active $p) }
function None { (Inactive "$D\A\STOP") -and (Inactive "$D\B\STOP") -and (Inactive "$D\G\STOP-gates-Cronus999") }
function Put([string]$f, [string]$s) { [IO.File]::WriteAllText($f, $s) }
function Msys([string]$p) { '/' + $p.Substring(0, 1).ToLower() + ($p.Substring(2) -replace '\\', '/') }

# A fresh case dir with three dummy targets: campaign A (priority 1), campaign B (2), gate pool G (1).
function Setup([string]$name) {
  $script:D = Join-Path $W $name
  if (Test-Path -LiteralPath $D) { Remove-Item -LiteralPath $D -Recurse -Force }
  foreach ($s in 'A', 'B', 'G') { [void][IO.Directory]::CreateDirectory((Join-Path $D $s)) }
  Put "$D\targets.tsv" "# target priority`n$D\A\STOP 1`n$D\B\STOP 2`n$D\G\STOP-gates-Cronus999 1`n"
}
# Run hostwatch.ps1 with the default test env plus overrides ($null removes a variable). Foreground:
# returns the exit code, output in $D\out. -Bg: returns the started process.
function Invoke-HW([hashtable]$e = @{}, [switch]$Bg) {
  $env2 = @{ HW_DIR = $D; HW_REG = "$D\targets.tsv"; HW_FEED = "$D\feed"; HW_INTERVAL = '0'; HW_STEP = '60' }
  foreach ($key in $e.Keys) { $env2[$key] = $e[$key] }
  $saved = @{}
  foreach ($n in $HWVARS) { $saved[$n] = [Environment]::GetEnvironmentVariable($n); [Environment]::SetEnvironmentVariable($n, $null) }
  foreach ($key in $env2.Keys) { if ($null -ne $env2[$key]) { [Environment]::SetEnvironmentVariable($key, [string]$env2[$key]) } }
  try {
    if ($Bg) {
      return Start-Process pwsh -ArgumentList '-NoProfile', '-File', "`"$HW`"" -NoNewWindow -PassThru -RedirectStandardOutput "$D\bg.out" -RedirectStandardError "$D\bg.err"
    }
    & pwsh -NoProfile -File $HW *> "$D\out"
    return $LASTEXITCODE
  } finally {
    foreach ($n in $HWVARS) { [Environment]::SetEnvironmentVariable($n, $saved[$n]) }
  }
}
# The production launch: conhost.exe --headless pwsh -NoProfile -File hostwatch.ps1, with the test
# env. Returns { Conhost, Pwsh } processes (Pwsh = the hostwatch, the conhost's pwsh child).
function Start-Headless([hashtable]$e) {
  $saved = @{}
  foreach ($n in $HWVARS) { $saved[$n] = [Environment]::GetEnvironmentVariable($n); [Environment]::SetEnvironmentVariable($n, $null) }
  foreach ($key in $e.Keys) { if ($null -ne $e[$key]) { [Environment]::SetEnvironmentVariable($key, [string]$e[$key]) } }
  try { $ch = Start-Process conhost.exe -ArgumentList '--headless', '"C:\Program Files\PowerShell\7\pwsh.exe"', '-NoProfile', '-File', "`"$HW`"" -PassThru }
  finally { foreach ($n in $HWVARS) { [Environment]::SetEnvironmentVariable($n, $saved[$n]) } }
  $pw = $null
  Wait-For { $script:c = @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$($ch.Id) AND Name='pwsh.exe'"); $script:c.Count -gt 0 } 100
  if ($script:c.Count) { $pw = [Diagnostics.Process]::GetProcessById([int]$script:c[0].ProcessId); $null = $pw.Handle }  # handle now, so ExitCode is readable later
  [pscustomobject]@{ Conhost = $ch; Pwsh = $pw }
}
function Feed([string[]]$lines, [hashtable]$e = @{}) {
  Put "$D\feed" (($lines -join "`n") + "`n"); $e['HW_ITER'] = "$($lines.Count)"; $script:rc = Invoke-HW $e
}
# Wait for a started process by its PID; stop only that PID if it overstays.
function Wait-Proc($p, [int]$sec) {
  if (-not $p.WaitForExit($sec * 1000)) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue; return $null }
  $p.WaitForExit(); return $p.ExitCode
}
function Wait-For([scriptblock]$wfCond, [int]$wfTenths = 100) { $wfI = 0; while (-not (& $wfCond) -and $wfI -lt $wfTenths) { Start-Sleep -Milliseconds 100; $wfI++ } }
# A child pwsh that dot-sources the library and runs $code; returns its exit code.
function Invoke-Lib([string]$code) {
  & pwsh -NoProfile -Command ". '$HW' -LibOnly; $code" *> "$D\lib.out"; return $LASTEXITCODE
}

Write-Output '== thresholds'
Setup normal; Feed '30.0 25.0 7.00', '29.5 24.0 7.10', '30.1 26.0 7.05'
Check 'normal readings write no stop' { None }
Check 'normal readings are logged with a verdict' { (CountIn "$D\hostwatch.log" 'verdict=OK') -eq 3 }
Check 'hostwatch refreshes its heartbeat' { Has "$D\heartbeat" }
Check '[new] heartbeat content is one UTC ISO time line, as date -u +%FT%TZ wrote it' { [IO.File]::ReadAllText("$D\heartbeat") -match '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ\n\z' }
Check '[new] heartbeat.tmp is not left behind' { Hasnt "$D\heartbeat.tmp" }
Check '[new] log line format: "<UTC> free=X commit_headroom=Y np=Z np_low=L verdict=V"' { @([IO.File]::ReadAllLines("$D\hostwatch.log") | Where-Object { $_ -match '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ free=29\.5 commit_headroom=24\.0 np=7\.10 np_low=7\.00 verdict=OK$' }).Count -eq 1 }
Check '[new] started line: "started (pid N), 3 targets"' { [IO.File]::ReadAllText("$D\hostwatch.log") -match 'Z started \(pid \d+\), 3 targets\n' }
Check '[new] HW_ITER exit logs its reason, exit 0' { $rc -eq 0 -and (Logged "$D\hostwatch.log" 'exiting after 3 readings (HW_ITER)') }
Check '[new] lock-ps freed on exit' { Hasnt "$D\lock-ps" }
Setup low-commit; Feed '30.0 5.5 7.00'
Check 'commit 5.5 GB: host-low on lowest priority (A, G)' { Has "$D\A\STOP.host-low" "$D\G\STOP-gates-Cronus999.host-low" }
Check 'commit 5.5 GB: B (priority 2) untouched, no host-all' { Inactive "$D\B\STOP" }
Check 'commit 5.5 GB: no host-all' { Hasnt "$D\A\STOP.host-all" }
Check '[new] stop file content "<name> <UTC>: <reason>"' { [IO.File]::ReadAllText("$D\A\STOP.host-low") -match '^host-low \d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ: free 30\.0 GB, commit headroom 5\.5 GB, nonpaged 7\.00 -> 7\.00 GB\n\z' }
Check '[new] ALERT line uses the MSYS prefix form, as the bash log did' { Logged "$D\hostwatch.log" "ALERT host-low -> $(Msys "$D\A\STOP").host-low (free 30.0 GB" }
Setup low-free; Feed '7.5 25.0 7.00'
Check 'free 7.5 GB: host-low on A and G only' { Has "$D\A\STOP.host-low" "$D\G\STOP-gates-Cronus999.host-low" }
Check 'free 7.5 GB: not on B' { Hasnt "$D\B\STOP.host-low" }
Setup all-commit; Feed '30.0 2.5 7.00'
Check 'commit 2.5 GB: host-all reaches every target' { Has "$D\A\STOP.host-all" "$D\B\STOP.host-all" "$D\G\STOP-gates-Cronus999.host-all" }
Setup all-free; Feed '3.5 25.0 7.00'
Check 'free 3.5 GB: host-all reaches every target' { Has "$D\A\STOP.host-all" "$D\B\STOP.host-all" "$D\G\STOP-gates-Cronus999.host-all" }
Setup np-rise; Feed '30.0 25.0 7.00', '30.0 25.0 7.60', '30.0 25.0 8.20', '30.0 25.0 8.60'
Check 'nonpaged 7.0 -> 8.6 GB: host-low' { Has "$D\A\STOP.host-low" }
Setup np-small; Feed '30.0 25.0 7.00', '30.0 25.0 7.80', '30.0 25.0 8.40'
Check 'nonpaged 7.0 -> 8.4 GB (1.4 GB): no stop' { None }
Setup np-window; Feed (@('30.0 25.0 7.00') + @('30.0 25.0 8.00') * 15 + @('30.0 25.0 8.60'))
Check '[new] np low is over the last 15 good readings: 7.00 left the window, 8.00 -> 8.60 is no stop' { None }
Setup repeat; Feed '30.0 5.5 7.00', '30.0 5.4 7.00'
Check 'a stop is written once: 2 ALERTs (A, G), not 4' { (CountIn "$D\hostwatch.log" 'ALERT') -eq 2 }

Write-Output '== bad readings are stalls, timed from the last good reading (fake clock 60 s per reading)'
Setup comma; Feed '11,9 5,0 7,0', '30.0 25.0 7.00'
Check 'one comma-decimal reading (60 s): logged as bad, no stop' { Logged "$D\hostwatch.log" "bad reading (rc 0, '11,9 5,0 7,0')" }
Check 'one comma-decimal reading (60 s): no stop' { None }
Setup unparsed-stall; Feed '11,9 5,0 7,0', 'garbage'
Check '2 unparsed readings (120 s > 90 s): host-low' { Has "$D\A\STOP.host-low" }
Setup stall-low; Feed 'STALL', 'STALL'
Check 'no answer for 120 s (> 90 s): host-low, not host-all' { Has "$D\A\STOP.host-low" }
Check 'no answer for 120 s: no host-all' { Hasnt "$D\A\STOP.host-all" }
Setup stall-180; Feed 'STALL', 'STALL', 'STALL'
Check 'no answer for exactly 180 s: still host-low only' { Hasnt "$D\A\STOP.host-all" }
Setup stall-all; Feed 'STALL', 'STALL', 'STALL', 'STALL'
Check 'no answer for 240 s (> 180 s): host-all reaches every target' { Has "$D\A\STOP.host-all" "$D\B\STOP.host-all" "$D\G\STOP-gates-Cronus999.host-all" }
Setup stall-reset; Feed 'STALL', '30.0 25.0 7.00', 'STALL'
Check 'a good reading resets the stall clock: no stop' { None }
Setup empty-line; Feed '', ''
Check '[new] empty answers are bad readings (rc 1): host-low at 120 s' { (Logged "$D\hostwatch.log" "bad reading (rc 1, '')") -and (Has "$D\A\STOP.host-low") }

Write-Output '== fail-safe comparisons (bash: fake awk; here: HW_VERDICT_FAIL makes the verdict code throw)'
Setup verdict-fail; Feed '30.0 25.0 7.00' @{ HW_VERDICT_FAIL = '1' }
Check 'verdict code fails on a normal reading: host-low (no clean verdict)' { Has "$D\A\STOP.host-low" }
Check 'verdict failure is logged' { Logged "$D\hostwatch.log" 'no clean verdict' }
Check 'verdict failure: the reading line logs np_low=? verdict=none' { Logged "$D\hostwatch.log" 'np_low=? verdict=none' }

Write-Output '== registry'
foreach ($c in 'missing', 'empty', 'comments', 'nonnumeric', 'nopriority', 'toolong', 'unresolved') {
  Setup "reg-$c"; Put "$D\feed" "30.0 25.0 7.00`n"
  switch ($c) {
    'missing' { Remove-Item -LiteralPath "$D\targets.tsv" }
    'empty' { Put "$D\targets.tsv" '' }
    'comments' { Put "$D\targets.tsv" "# none`n   # indented`n`n" }
    'nonnumeric' { Put "$D\targets.tsv" "$D\A\STOP 1`n$D\B\STOP bogus`n" }
    'nopriority' { Put "$D\targets.tsv" "$D\A\STOP`n" }
    'toolong' { Put "$D\targets.tsv" "$D\A\STOP 1000000000`n" }
    'unresolved' { Put "$D\targets.tsv" "/tmp/h107-no-such/STOP 1`n" }
  }
  $rc = Invoke-HW @{ HW_ITER = '1' }
  $tag = if ($c -in 'toolong', 'unresolved') { '[new] ' } else { '' }
  Check "${tag}registry ${c}: refuses to start (exit 2, loud)" { $rc -eq 2 -and (CountIn "$D\out" 'refuses to start') -eq 1 }
  Check "${tag}registry ${c}: wrote no heartbeat" { Hasnt "$D\heartbeat" }
}
Check 'parse_reg: a prefix that cannot be resolved makes the registry malformed (the error names it)' { Logged "$D\hostwatch.log" "prefix '/tmp/h107-no-such/STOP' could not be resolved" }
Setup reg-forms; [void][IO.Directory]::CreateDirectory("$D\A dir")
Put "$D\targets.tsv" ("  # indented comment`r`n$D\A dir\STOP 1`r`n`t$D\B\STOP   2")
Feed '30.0 2.5 7.00'
Check 'indented comment, CRLF, tab, spaces in a prefix, no final newline: all targets hit' { Has "$D\A dir\STOP.host-all" "$D\B\STOP.host-all" }
Setup reg-msys; Put "$D\targets.tsv" "$(Msys "$D\A\STOP") 1`n$D\B\STOP 2`n"
Feed '30.0 5.5 7.00'
Check '[new] an MSYS drive-form prefix (/c/...) resolves: host-low reaches A' { Has "$D\A\STOP.host-low" }
Setup reg-midrun; Put "$D\feed" "30.0 25.0 7.00`n30.0 25.0 7.00`n30.0 5.5 7.00`n"
$p = Invoke-HW @{ HW_ITER = '3'; HW_INTERVAL = '2' } -Bg
Wait-For { [IO.File]::Exists("$D\heartbeat") }
Put "$D\targets.tsv" "garbage`n"; $null = Wait-Proc $p 60
Check 'registry turns malformed while running: ALERT logged' { Logged "$D\hostwatch.log" 'ALERT registry malformed, keeping the last good copy' }
Check 'registry turns malformed while running: the last good copy still gets the stop' { Has "$D\A\STOP.host-low" "$D\G\STOP-gates-Cronus999.host-low" }
Check '[new] the malformed-registry ALERT is logged once' { (CountIn "$D\hostwatch.log" 'ALERT registry malformed') -eq 1 }
Setup reg-recover; Put "$D\feed" "30.0 25.0 7.00`n30.0 25.0 7.00`n30.0 25.0 7.00`n30.0 25.0 7.00`n"
$good = [IO.File]::ReadAllText("$D\targets.tsv")
$p = Invoke-HW @{ HW_ITER = '4'; HW_INTERVAL = '2' } -Bg
Wait-For { [IO.File]::Exists("$D\heartbeat") }
Put "$D\targets.tsv" "garbage`n"
Wait-For { Logged "$D\hostwatch.log" 'ALERT registry malformed' }
Put "$D\targets.tsv" $good; $null = Wait-Proc $p 60
Check '[new] registry recovers while running: "registry valid again" logged' { Logged "$D\hostwatch.log" 'registry valid again' }

Write-Output '== lock'
Setup lock-live; Put "$D\feed" (('30.0 25.0 7.00' + "`n") * 600)
$hl = Start-Headless @{ HW_DIR = $D; HW_REG = "$D\targets.tsv"; HW_FEED = "$D\feed"; HW_INTERVAL = '1' }
$first = $hl.Pwsh
Check '[new] headless launch: hostwatch pwsh found under the conhost launcher, MainWindowHandle 0' { $first -and (Get-Process -Id $first.Id).MainWindowHandle -eq 0 }
Wait-For { [IO.File]::Exists("$D\lock-ps\owner") -and [IO.FileInfo]::new("$D\lock-ps\owner").Length -gt 0 }
$rc = Invoke-HW @{ HW_ITER = '1' }
Check 'second instance refuses while the first is alive (exit 3)' { $rc -eq 3 -and (CountIn "$D\out" 'already runs') -eq 1 }
Check '[new] lock-ps owner is "<Windows pid> <creation ticks>" of the live instance' { (Get-Content -LiteralPath "$D\lock-ps\owner") -eq "$($first.Id) $($first.StartTime.ToUniversalTime().Ticks)" }
Put "$D\STOP-hostwatch" ''; $code = Wait-Proc $first 60; $null = Wait-Proc $hl.Conhost 30
Check 'STOP-hostwatch: host-low written to the lowest-priority targets first' { Has "$D\A\STOP.host-low" "$D\G\STOP-gates-Cronus999.host-low" }
Check 'STOP-hostwatch: watcher exits and frees its lock' { Hasnt "$D\lock-ps" }
Check '[new] STOP-hostwatch: exit 0, reason logged' { $code -eq 0 -and (Logged "$D\hostwatch.log" 'stopping on STOP-hostwatch') }
Check '[new] STOP-hostwatch: B (priority 2) gets no host-low' { Hasnt "$D\B\STOP.host-low" }
Setup lock-noowner; [void][IO.Directory]::CreateDirectory("$D\lock-ps"); Put "$D\feed" "30.0 25.0 7.00`n"
$rc = Invoke-HW @{ HW_ITER = '1' }
Check 'lock without an owner file is not taken over (exit 3, after 10 s)' { $rc -eq 3 -and (CountIn "$D\hostwatch.log" 'no owner after 10 s') -eq 1 }
Check 'lock without an owner file: the lock is left alone' { [IO.Directory]::Exists("$D\lock-ps") }
Check 'lock without an owner file: no monitoring started' { Hasnt "$D\heartbeat" }
Setup lock-dead; [void][IO.Directory]::CreateDirectory("$D\lock-ps"); Put "$D\lock-ps\owner" "999999 1`n"; Put "$D\feed" "30.0 25.0 7.00`n"
$rc = Invoke-HW @{ HW_ITER = '1' }
Check 'lock of a dead pid is taken over' { $rc -eq 0 -and (CountIn "$D\hostwatch.log" 'took over from dead owner') -eq 1 }
Setup lock-reused; [void][IO.Directory]::CreateDirectory("$D\lock-ps"); Put "$D\lock-ps\owner" "$PID 1`n"; Put "$D\feed" "30.0 25.0 7.00`n"
$rc = Invoke-HW @{ HW_ITER = '1' }
Check 'lock of a live pid with another start time (reused pid) is taken over' { $rc -eq 0 -and (CountIn "$D\hostwatch.log" 'took over from dead owner') -eq 1 }
Check '[new] lock of a live pid with its own start time is not taken over (exit 3)' {
  Setup lock-liveowner; [void][IO.Directory]::CreateDirectory("$D\lock-ps")
  Put "$D\lock-ps\owner" "$PID $([Diagnostics.Process]::GetCurrentProcess().StartTime.ToUniversalTime().Ticks)`n"; Put "$D\feed" "30.0 25.0 7.00`n"
  $rc = Invoke-HW @{ HW_ITER = '1' }; $rc -eq 3 -and (Hasnt "$D\heartbeat") -and (CountIn "$D\hostwatch.log" "held by live pid $PID") -eq 1
}

Write-Output '== [new] the old bash lock ($DIR\lock) and the heartbeat'
$old = [DateTime]::UtcNow.AddSeconds(-300)
Setup bashlock-hb; [void][IO.Directory]::CreateDirectory("$D\lock"); Put "$D\lock\owner" "1234 5678`n"
[IO.File]::SetLastWriteTimeUtc("$D\lock\owner", $old); Put "$D\heartbeat" "x`n"; Put "$D\feed" "30.0 25.0 7.00`n"
$rc = Invoke-HW @{ HW_ITER = '1' }
Check '[new] bash lock + heartbeat younger than 180 s: refuses (exit 3, loud), no lock-ps' { $rc -eq 3 -and (CountIn "$D\out" 'bash hostwatch lock') -ge 1 -and (Hasnt "$D\lock-ps") }
Check '[new] bash lock refusal is logged' { Logged "$D\hostwatch.log" 'REFUSED to start: the bash hostwatch lock' }
Setup bashlock-young; [void][IO.Directory]::CreateDirectory("$D\lock"); Put "$D\lock\owner" "1234 5678`n"; Put "$D\feed" "30.0 25.0 7.00`n"
$rc = Invoke-HW @{ HW_ITER = '1' }
Check '[new] bash lock 0 s old, no heartbeat yet (a bash instance just started): refuses (exit 3)' { $rc -eq 3 -and (Hasnt "$D\heartbeat") }
Setup bashlock-stale; [void][IO.Directory]::CreateDirectory("$D\lock"); Put "$D\lock\owner" "1234 5678`n"
[IO.File]::SetLastWriteTimeUtc("$D\lock\owner", $old); Put "$D\heartbeat" "x`n"; [IO.File]::SetLastWriteTimeUtc("$D\heartbeat", $old)
Put "$D\feed" "30.0 25.0 7.00`n"; $rc = Invoke-HW @{ HW_ITER = '1' }
Check '[new] bash lock and heartbeat both 300 s old: starts (exit 0), the bash lock is left alone' { $rc -eq 0 -and (Has "$D\lock\owner") -and (Logged "$D\hostwatch.log" 'started (pid') }

Write-Output '== stop_write'
Setup planned; Put "$D\A\STOP" "planned pause`n"; Put "$D\A\STOP.planned" "planned x: add container`n"
Feed '30.0 5.5 7.00'
Check 'planned stop present: host-low still written' { Has "$D\A\STOP.host-low" }
Rename-Item -LiteralPath "$D\A\STOP" 'STOP.cleared-1'; Rename-Item -LiteralPath "$D\A\STOP.planned" 'STOP.cleared-2'
Check 'host-low still active after the planned stops are archived (hostwatch deleted nothing)' { Active "$D\A\STOP" }
Setup existing; Put "$D\A\STOP.host-low" "by hand`n"; Feed '30.0 5.5 7.00'
Check '[new] an existing stop is never overwritten (exit-1 path, no ALERT for it)' { ([IO.File]::ReadAllText("$D\A\STOP.host-low") -eq "by hand`n") -and (CountIn "$D\hostwatch.log" 'ALERT host-low ->') -eq 1 }
Setup race
$racer = "$D\racer.ps1"
Put $racer ". '$HW' -LibOnly; while (-not [IO.File]::Exists('$D\go')) { Start-Sleep -Milliseconds 20 }; if ((Write-Stop '$D\A\STOP' host-low (`"writer `" + `$args[0])) -eq 0) { [IO.File]::WriteAllText('$D\won-' + `$args[0], 'x') }"
$ps = foreach ($i in 1..8) { Start-Process pwsh -ArgumentList '-NoProfile', '-File', $racer, $i -NoNewWindow -PassThru }
Start-Sleep -Seconds 3; Put "$D\go" ''
foreach ($x in $ps) { $null = Wait-Proc $x 60 }
Check '8 concurrent stop_write calls: exactly one creates the file' { @(Get-ChildItem -LiteralPath $D -Filter 'won-*').Count -eq 1 }
Check '[new] lib: stop_write returns 1 on an existing file, 2 on a missing directory' { (Invoke-Lib "exit ((Write-Stop '$D\A\STOP' host-low x) * 10 + (Write-Stop '$D\nodir\STOP' host-low x))") -eq 12 }

Write-Output '== [new] in-process read timeout (replaces the real PowerShell timeout boundary case)'
Setup hang1; $s = [Diagnostics.Stopwatch]::StartNew(); Feed 'HANG' @{ HW_PS_TIMEOUT = '2' }; $e = [int]$s.Elapsed.TotalSeconds
Check "[new] a hanging read is cut by the in-process timeout (HW_PS_TIMEOUT 2: run took ${e}s < 15 s, exit 0)" { $e -lt 15 -and $rc -eq 0 }
Check '[new] a timed-out read is a bad reading, rc 124' { Logged "$D\hostwatch.log" "bad reading (rc 124, '')" }
Setup hang2; Feed 'HANG', 'HANG' @{ HW_PS_TIMEOUT = '2' }
Check '[new] 2 timed-out reads (120 s): host-low' { Has "$D\A\STOP.host-low" }
Setup hang-then-ok; Feed 'HANG', '30.0 25.0 7.00', '30.0 25.0 7.00' @{ HW_PS_TIMEOUT = '2' }
Check '[new] reads work again after a timed-out one (fresh runspace): 2 good readings, no stop' { (CountIn "$D\hostwatch.log" 'verdict=OK') -eq 2 -and (None) }

Write-Output '== H-89b item 2: time, not count (feed steps of 30 s and 90 s tell them apart)'
Setup step30-3; Feed 'STALL', 'STALL', 'STALL' @{ HW_STEP = '30' }
Check '30 s steps, 3 stalls = 90 s (not > 90): no stop (counting would have stopped at 2)' { None }
Setup step30-4; Feed 'STALL', 'STALL', 'STALL', 'STALL' @{ HW_STEP = '30' }
Check '30 s steps, 4 stalls = 120 s: host-low' { Has "$D\A\STOP.host-low" }
Check '30 s steps, 4 stalls = 120 s: not host-all' { Hasnt "$D\A\STOP.host-all" }
Setup step90-2; Feed 'STALL', 'STALL' @{ HW_STEP = '90' }
Check '90 s steps, 2 stalls = 180 s (not > 180): host-low present' { Has "$D\A\STOP.host-low" }
Check '90 s steps, 2 stalls = 180 s: no host-all' { Hasnt "$D\A\STOP.host-all" }
Setup step90-3; Feed 'STALL', 'STALL', 'STALL' @{ HW_STEP = '90' }
Check '90 s steps, 3 stalls = 270 s: host-all (counting needed 5)' { Has "$D\A\STOP.host-all" "$D\B\STOP.host-all" }

Write-Output '== H-89b item 2: the real stall clock (Stopwatch, no fake clock)'
Setup clockreal; Feed 'STALL', 'STALL', 'STALL', 'STALL' @{ HW_STEP = $null; HW_INTERVAL = '1'; HW_STALL_LOW = '2'; HW_STALL_ALL = '100' }
Check 'real monotonic clock, 4 stalls 1 s apart, STALL_LOW 2: host-low still written' { Has "$D\A\STOP.host-low" }
Check 'real monotonic clock: no host-all (STALL_ALL 100)' { Hasnt "$D\A\STOP.host-all" }
Write-Output '== [new] CIM ruling (orchestrator 2026-11-16): a failed or zero reading is a bad reading, never 0 GB'
# A real Get-CimInstance failure (HW_CIM_CLASS = a class that does not exist), no feed, fake 60 s clock.
$cimFail = @{ HW_FEED = $null; HW_CIM_CLASS = 'Win32_NoSuchClass_H107'; HW_STEP = '60' }
Setup cim1; $cimFail['HW_ITER'] = '1'; $script:rc = Invoke-HW $cimFail
Check '[new] one failed CIM read: no stop at all (60 s < 90 s)' { None }
Check '[new] one failed CIM read: logged as a bad reading with its error' { (Logged "$D\hostwatch.log" 'bad reading (rc 1') -and (Logged "$D\hostwatch.log" 'read error:') }
Check '[new] one failed CIM read: never logged as a 0 GB verdict' { -not (Logged "$D\hostwatch.log" 'free=0.0') }
Setup cim2; $cimFail['HW_ITER'] = '2'; $script:rc = Invoke-HW $cimFail
Check '[new] failed CIM reads for 120 s: host-low on the lowest priority (A, G)' { Has "$D\A\STOP.host-low" "$D\G\STOP-gates-Cronus999.host-low" }
Check '[new] failed CIM reads for 120 s: B untouched, no host-all' { (Inactive "$D\B\STOP") -and (Hasnt "$D\A\STOP.host-all") }
Setup cim4; $cimFail['HW_ITER'] = '4'; $script:rc = Invoke-HW $cimFail
Check '[new] failed CIM reads for 240 s: host-all on every target' { Has "$D\A\STOP.host-all" "$D\B\STOP.host-all" "$D\G\STOP-gates-Cronus999.host-all" }
Setup zero1; Feed '0.0 0.0 7.00'
Check '[new] a 0 free + 0 commit reading: no stop (not taken as real)' { None }
Check '[new] a 0 free + 0 commit reading: logged as a bad reading' { Logged "$D\hostwatch.log" 'zero free and zero commit headroom' }
Setup zero3; Feed '0.0 0.0 7.00', '0.0 0.0 7.00', '0.0 0.0 7.00' @{ HW_STEP = '60' }
Check '[new] zero readings for 180 s: host-low via the stall tier, no host-all' { (Has "$D\A\STOP.host-low") -and (Hasnt "$D\A\STOP.host-all") }
Setup zerofree; Feed '0.0 25.0 7.00'
Check '[new] 0 free with real commit headroom is still a real (host-all) reading' { Has "$D\A\STOP.host-all" "$D\B\STOP.host-all" }
Setup hb-compat; Feed '30.0 25.0 7.00'
$hbf = "$D\heartbeat" -replace '\\', '/'
# Git Bash explicitly: a bare `bash` can resolve to WSL's C:\Windows\System32\bash.exe, which has no /h/ mount.
# The snippet goes in a file, so pwsh's native argument quoting cannot split it.
$hbSh = "$D\hb-check.sh"
[IO.File]::WriteAllText($hbSh, ". /h/cg-coord/jobs/W2-10/ops/stops.sh; hb_ok '$hbf' && echo HBOK || echo `"HBBAD `$HB_WHY`"`n")
$hbOut = & 'C:\Program Files\Git\bin\bash.exe' ($hbSh -replace '\\', '/') 2>&1
Check "[new] stops.sh hb_ok (the consumers' check) accepts the heartbeat hostwatch.ps1 wrote ($hbOut)" { "$hbOut" -eq 'HBOK' }

Write-Output '== H-89b item 3: lock takeover'
Setup lock-race; [void][IO.Directory]::CreateDirectory("$D\lock-ps"); Put "$D\lock-ps\owner" "999999 1`n"
$taker = "$D\taker.ps1"
Put $taker ". '$HW' -LibOnly; `$script:LockLog = '$D\race.err'; while (-not [IO.File]::Exists('$D\go')) { Start-Sleep -Milliseconds 20 }; if ((Lock-Take '$D\lock-ps') -eq 0) { [IO.File]::WriteAllText('$D\won-' + `$PID, 'x'); Start-Sleep 4; Lock-Release '$D\lock-ps' }"
$ps = foreach ($i in 1..4) { Start-Process pwsh -ArgumentList '-NoProfile', '-File', $taker -NoNewWindow -PassThru }
Start-Sleep -Seconds 3; Put "$D\go" ''
foreach ($x in $ps) { $null = Wait-Proc $x 60 }
Check '4 separate processes take one dead owner''s lock: exactly one owner' { @(Get-ChildItem -LiteralPath $D -Filter 'won-*').Count -eq 1 }
Check 'takeover ticket released afterwards' { Hasnt "$D\lock-ps.takeover" }
Check '[new] concurrent lock messages all reach the shared log (4 takers, 4 lines, 1 takeover)' { ([IO.File]::ReadAllLines("$D\race.err").Count -eq 4) -and (CountIn "$D\race.err" 'took over from dead owner') -eq 1 }
Check '[new] the winner released the lock' { Hasnt "$D\lock-ps" }
Setup lock-ticket; [void][IO.Directory]::CreateDirectory("$D\lock-ps"); [void][IO.Directory]::CreateDirectory("$D\lock-ps.takeover"); Put "$D\lock-ps\owner" "999999 1`n"
$rc = Invoke-Lib "exit (Lock-Take '$D\lock-ps')"
Check 'a stale takeover ticket blocks takeover visibly (exit 3, lock untouched)' { $rc -eq 3 -and ((Get-Content -LiteralPath "$D\lock-ps\owner") -eq '999999 1') }
Check 'proc_state of a missing pid is dead' { (Invoke-Lib "if ((Get-ProcState 999999 1) -eq 'dead') { exit 0 } else { exit 1 }") -eq 0 }
Check 'proc_state of this process with its own start time is live' { (Invoke-Lib "if ((Get-ProcState `$PID (Get-ProcStart `$PID)) -eq 'live') { exit 0 } else { exit 1 }") -eq 0 }
Check '[new] proc_state with an empty recorded start is unknown' { (Invoke-Lib "if ((Get-ProcState `$PID '') -eq 'unknown') { exit 0 } else { exit 1 }") -eq 0 }

Write-Output '== H-89b item 4: a failed stop write is retried, logged and escalated'
Setup write-fail; Put "$D\targets.tsv" "$D\gone\STOP 1`n$D\B\STOP 2`n"
Feed '30.0 5.5 7.00'
Check 'target dir missing: ALERT ''stop write FAILED twice'' logged' { Logged "$D\hostwatch.log" 'stop write FAILED twice' }
Check 'the failed host-low goes to every other target too (B, priority 2)' { Has "$D\B\STOP.host-low" }
Check '[new] the escalated stop says so' { [IO.File]::ReadAllText("$D\B\STOP.host-low").Contains('escalated: a stop write to another target failed; free 30.0 GB') }
Setup write-fail-all; Put "$D\targets.tsv" "$D\gone\STOP 1`n$D\gone2\STOP 2`n"
Feed '30.0 5.5 7.00'
Check 'escalated write also fails: ALERT ''escalated stop write FAILED twice''' { Logged "$D\hostwatch.log" 'escalated stop write FAILED twice' }
Check 'a stop that could not be delivered anywhere: heartbeat not refreshed' { Hasnt "$D\heartbeat" }
Check '[new] heartbeat NOT refreshed is logged' { Logged "$D\hostwatch.log" 'heartbeat NOT refreshed: a stop could not be delivered' }
Setup write-fail-sticky; Put "$D\targets.tsv" "$D\gone\STOP 1`n$D\B\STOP 2`n"
Feed '30.0 5.5 7.00', '30.0 25.0 7.00', '30.0 25.0 7.00'
Check '[new] after one failed delivery the heartbeat is never refreshed for the rest of the run' { (Hasnt "$D\heartbeat") -and (CountIn "$D\hostwatch.log" 'heartbeat NOT refreshed') -eq 3 }

Write-Output '== self-check r1: clock going backwards, verdict failure, priorities'
Setup clock-back; Put "$D\now" "100`n50`n"; Feed 'STALL', 'STALL' @{ HW_STEP = $null; HW_NOW_FEED = "$D\now" }
Check 'stall clock goes back (100 -> 50) during a stall: host-low' { Has "$D\A\STOP.host-low" }
Check '[new] the backward clock is logged' { Logged "$D\hostwatch.log" 'stall clock went backwards by 50s' }
Setup clock-partial-back; Put "$D\now" "100`n180`n150`n"; Feed '30.0 25.0 7.00', 'STALL', 'STALL' @{ HW_STEP = $null; HW_NOW_FEED = "$D\now"; HW_MIN_STEP = '60' }
Check 'clock steps back but stays above last_good (100, 180, 150): the bad-reading floor (2 x 60 s) still gives host-low' { Has "$D\A\STOP.host-low" }
Setup prio-big; Put "$D\targets.tsv" "$D\B\STOP 1000000`n$D\A\STOP 0000001`n"; Feed '30.0 5.5 7.00'
Check 'priorities 1000000 and 0000001 are accepted (exit 0)' { $rc -eq 0 }
Check '0000001 is the lowest priority: A gets host-low, B does not' { (Has "$D\A\STOP.host-low") -and (Hasnt "$D\B\STOP.host-low") }

Write-Output '== H-89b run 002'
Setup lock-procempty; [void][IO.Directory]::CreateDirectory("$D\lock-ps")
Put "$D\lock-ps\owner" "$PID $([Diagnostics.Process]::GetCurrentProcess().StartTime.ToUniversalTime().Ticks)`n"; $before = [IO.File]::ReadAllText("$D\lock-ps\owner")
$rc = Invoke-Lib "function Get-ProcState { }; exit (Lock-Take '$D\lock-ps')"
Check 'proc_state prints nothing: live lock left alone, no takeover (rc 1)' { $rc -eq 1 -and [IO.File]::ReadAllText("$D\lock-ps\owner") -eq $before }
$rc = Invoke-Lib "function Get-ProcState { throw 'x' }; exit (Lock-Take '$D\lock-ps')"
Check 'proc_state fails (throws): live lock left alone, no takeover (rc 1)' { $rc -eq 1 -and [IO.File]::ReadAllText("$D\lock-ps\owner") -eq $before }
Setup neg-all; Put "$D\now" "1000`n500`n500`n500`n500`n"
Feed '30.0 25.0 7.00', 'STALL', 'STALL', 'STALL', 'STALL' @{ HW_STEP = $null; HW_NOW_FEED = "$D\now"; HW_MIN_STEP = '60' }
Check 'stall clock back 500 s, 4 bad readings (floor 240 s > 180 s): host-all reaches every target' { Has "$D\A\STOP.host-all" "$D\B\STOP.host-all" "$D\G\STOP-gates-Cronus999.host-all" }

Write-Output '== [new] max lifetime (HW_MAX_HOURS)'
Setup maxlife; Put "$D\feed" (('30.0 25.0 7.00' + "`n") * 600)
$s = [Diagnostics.Stopwatch]::StartNew()
$p = Invoke-HW @{ HW_INTERVAL = '1'; HW_MAX_HOURS = '0.0005' } -Bg
$code = Wait-Proc $p 60; $e = [int]$s.Elapsed.TotalSeconds
Check "[new] HW_MAX_HOURS 0.0005 (1.8 s): exits by itself, exit 0 (took ${e}s)" { $code -eq 0 -and $e -lt 20 }
Check '[new] max lifetime: reason logged' { Logged "$D\hostwatch.log" 'stopping on max lifetime (0.0005 h, HW_MAX_HOURS)' }
Check '[new] max lifetime: host-low to the lowest-priority targets, lock freed' { (Has "$D\A\STOP.host-low" "$D\G\STOP-gates-Cronus999.host-low") -and (Hasnt "$D\B\STOP.host-low" "$D\lock-ps") }
Setup maxlife-bad; Put "$D\feed" "30.0 25.0 7.00`n"; $rc = Invoke-HW @{ HW_ITER = '1'; HW_MAX_HOURS = 'soon' }
Check '[new] an invalid HW_MAX_HOURS refuses to start (exit 2)' { $rc -eq 2 -and (Hasnt "$D\heartbeat") }

if (-not $SkipChurn) {
  Write-Output '== churn check: real reading (no HW_FEED), HW_INTERVAL 5, about 60 s, production start command'
  Setup churn
  $hl = Start-Headless @{ HW_DIR = $D; HW_REG = "$D\targets.tsv"; HW_INTERVAL = '5' }
  $p = $hl.Pwsh; $ch = $hl.Conhost
  if (-not $p) { Write-Output "   no pwsh child found under conhost pid $($ch.Id)"; $null = Wait-Proc $ch 1 }
  $me = Get-CimInstance Win32_Process -Filter "ProcessId=$($p.Id)"
  $par = Get-CimInstance Win32_Process -Filter "ProcessId=$($me.ParentProcessId)"
  $hwnd = (Get-Process -Id $p.Id).MainWindowHandle
  Write-Output "   launcher $($par.Name) pid $($par.ProcessId) created $($par.CreationDate.ToUniversalTime().ToString('HH:mm:ss.fff'))Z -> pwsh pid $($p.Id) created $($me.CreationDate.ToUniversalTime().ToString('HH:mm:ss.fff'))Z, MainWindowHandle $hwnd"
  Check 'churn: the hostwatch pwsh has exactly one parent, the conhost.exe launcher we started, created before pwsh' { $par.Name -eq 'conhost.exe' -and $par.ProcessId -eq $ch.Id -and $par.CreationDate -le $me.CreationDate }
  Check 'churn: the hostwatch pwsh has MainWindowHandle 0' { $hwnd -eq 0 }
  $seen = @{}; $samples = 0
  $s = [Diagnostics.Stopwatch]::StartNew()
  while ($s.Elapsed.TotalSeconds -lt 60 -and -not $p.HasExited) {
    foreach ($c in @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$($p.Id)")) {
      if (-not $seen.ContainsKey($c.ProcessId)) { $seen[$c.ProcessId] = "$($c.Name) pid $($c.ProcessId) created $($c.CreationDate.ToUniversalTime().ToString('HH:mm:ss.fff'))Z" }
    }
    $samples++; Start-Sleep -Milliseconds 500
  }
  $started = [IO.File]::ReadAllLines("$D\hostwatch.log") | Where-Object { $_ -match 'started \(pid' } | Select-Object -First 1
  $readings = CountIn "$D\hostwatch.log" ' verdict='
  Put "$D\STOP-hostwatch" ''; $code = Wait-Proc $p 60; $null = Wait-Proc $ch 30
  Write-Output "   hostwatch pid $($p.Id), $samples samples of Win32_Process ParentProcessId over 60 s, $readings readings logged"
  Write-Output "   children of the hostwatch pwsh: $(if ($seen.Count) { ($seen.Values | Sort-Object) -join '; ' } else { 'none' })"
  Write-Output "   first reading: $(([IO.File]::ReadAllLines("$D\hostwatch.log") | Where-Object { $_ -match ' verdict=' } | Select-Object -First 1))"
  Check "churn: at least 10 real readings in 60 s ($readings)" { $readings -ge 10 }
  Check "churn: the hostwatch pwsh started no child process ($samples samples)" { $samples -gt 50 -and $seen.Count -eq 0 }
  Check 'churn: the conhost launcher exits with it' { $ch.HasExited }
  Check 'churn: real readings parse (no bad reading logged)' { (CountIn "$D\hostwatch.log" 'bad reading') -eq 0 }
  Check 'churn: stopped by its scratch STOP-hostwatch (exit 0, reason logged)' { $code -eq 0 -and (Logged "$D\hostwatch.log" 'stopping on STOP-hostwatch') }
}

Write-Output "pass $($script:pass) fail $($script:fail) (work dir $W)"
exit ([int]($script:fail -ne 0))
