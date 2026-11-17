#Requires -Version 7
# M12-05 dry test for watch-campaign.ps1: scratch dir, dummy targets, injected RAM readings (-Feed), a scratch
# daemon registry and memlog. No container, no live registry, no live stop file. Each case is named like the
# watch.sh checks of hostwatch-dry-test.sh (w-*), plus the exit, cost, registry and HOST-BUSY cases.
# It never kills: every run ends by the watcher's own exit paths (-Iter, EXIT, STOP-watch, -MaxHours); a run that
# does not end in time gets its stop file and then fails its check.
# Usage: pwsh -NoProfile -File scripts/harness/ops/h-107/watch-campaign-test.ps1   (exit = number of failures)
$ErrorActionPreference = 'Stop'
$S = Join-Path $PSScriptRoot 'watch-campaign.ps1'
$Root = Join-Path ([IO.Path]::GetTempPath()) "wc-test-$PID"
$fail = 0; $n = 0
function Check([string]$name, [bool]$ok, [string]$detail = '') {
  $script:n++
  if ($ok) { "[OK]   $name" } else { "[FAIL] $name $detail"; $script:fail++ }
}
$utc = { param([DateTime]$t) $t.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ', [cultureinfo]::InvariantCulture) }
# One scratch campaign: <D>\camp\STOP is the prefix; registry, heartbeat, quarantine dir, results root, memlog dir.
function Setup([string]$name) {
  $D = Join-Path $Root $name
  foreach ($sub in 'camp', 'q', 'results\campaigns', 'results\executions', 'memlog', 'reg') { [void](New-Item -ItemType Directory -Force (Join-Path $D $sub)) }
  $c = [pscustomobject]@{
    D = $D; P = Join-Path $D 'camp\STOP'; Log = Join-Path $D 'run.log'; Hb = Join-Path $D 'heartbeat'
    Reg = Join-Path $D 'targets.tsv'; Q = Join-Path $D 'q'; Results = Join-Path $D 'results'; Mem = Join-Path $D 'memlog'
    Feed = Join-Path $D 'feed.txt'; Daemons = Join-Path $D 'reg\daemons.tsv'; WLog = Join-Path $D 'camp\watch.log'
  }
  Set-Content $c.Log 'run started'
  Set-Content $c.Hb 'ok'
  Set-Content $c.Reg "# test registry`n$($c.P) 0"
  Set-Content $c.Feed (@('20.0') * 50)
  # a fresh, quiet memlog (3 samples, newest 10 s ago)
  Set-Content (Join-Path $c.Mem "memlog-$((Get-Date).ToUniversalTime().ToString('yyyy-MM-dd')).log") (Mem @('quiet', 'quiet', 'quiet') 10)
  return $c
}
# memlog samples, oldest first, 15 s apart, the newest $ageS seconds ago. 'busy' adds a 9000 MB Wow.exe line.
function Mem([string[]]$kinds, [int]$ageS) {
  $now = (Get-Date).ToUniversalTime(); $out = @(); $i = 0
  foreach ($k in $kinds) {
    $t = $now.AddSeconds(- $ageS - 15 * ($kinds.Count - 1 - $i)); $i++
    $out += "=== $(& $utc $t) avail_mb=30000 pool_nonpaged_b=1 pool_paged_b=1 committed_b=1 commit_limit_b=2"
    if ($k -eq 'busy') { $out += '   78228    29300     9000MB Wow.exe | "C:\Games\Wow.exe"' }
    $out += '   41088    25768     8723MB vmmem | '
    $out += '   57168    50536     1065MB claude.exe | "C:\Users\x\.local\bin\claude.exe" -c'
    $out += '    7276     2456     1200MB MsMpEng.exe | '
  }
  return $out
}
# Run the watcher (one child per case, from the test only) and wait for it; returns @{ Ok; Code }.
function Run($c, [string[]]$extra, [int]$waitS = 60, [scriptblock]$during = {}) {
  $a = @('-NoProfile', '-File', $S, '-Prefix', $c.P, '-RunLog', $c.Log, '-Pool', 'Cronus901,Cronus902', '-Results', $c.Results,
    '-Heartbeat', $c.Hb, '-Registry', $c.Reg, '-QuarantineDir', $c.Q, '-MemlogDir', $c.Mem, '-Feed', $c.Feed, '-EverySeconds', '1') + $extra
  if ($extra -notcontains '-FromUtc') { $a += @('-FromUtc', '2000-01-01T00:00:00Z') }
  $p = Start-Process 'C:\Program Files\PowerShell\7\pwsh.exe' -ArgumentList $a -PassThru -WindowStyle Hidden
  & $during $p
  if (-not $p.WaitForExit($waitS * 1000)) {
    New-Item -ItemType File "$($c.P).STOP-watch" -Force | Out-Null; [void]$p.WaitForExit(20000)
    return @{ Ok = $false; Code = -1 }
  }
  return @{ Ok = $true; Code = $p.ExitCode }
}
function LogText($c) { if (Test-Path $c.WLog) { Get-Content $c.WLog -Raw } else { '' } }
function Watched($c) { Test-Path "$($c.P).watch" }
$reg = @('-NoRegister')

try {
  # w-fresh: fresh heartbeat, listed, RAM fine: no stop
  $c = Setup 'w-fresh'; $r = Run $c ($reg + @('-Iter', '3'))
  Check 'w-fresh: no stop when everything is fine' ($r.Ok -and $r.Code -eq 0 -and -not (Watched $c)) (LogText $c)

  # w-free: free RAM under 4 GB
  $c = Setup 'w-free'; Set-Content $c.Feed (@('3.5') * 5); $r = Run $c ($reg + @('-Iter', '2'))
  Check 'w-free: free RAM under 4 GB writes <P>.watch' ((Watched $c) -and (Get-Content "$($c.P).watch" -Raw) -match '^watch \S+Z: free RAM 3.5 GB')

  # w-hang: no good RAM reading for longer than the stall limit
  $c = Setup 'w-hang'; Set-Content $c.Feed (@('STALL') * 10); $r = Run $c ($reg + @('-Iter', '5', '-StallSeconds', '2'))
  Check 'w-hang: no good RAM reading for the stall limit writes <P>.watch' ((Watched $c) -and (Get-Content "$($c.P).watch" -Raw) -match 'no good RAM reading')

  # w-stale: heartbeat older than 180 s
  $c = Setup 'w-stale'; (Get-Item $c.Hb).LastWriteTimeUtc = (Get-Date).ToUniversalTime().AddSeconds(-200); $r = Run $c ($reg + @('-Iter', '2'))
  Check 'w-stale: heartbeat older than 180 s writes <P>.watch' ((Watched $c) -and (Get-Content "$($c.P).watch" -Raw) -match 'heartbeat \d+s old')

  # w-missing: heartbeat missing
  $c = Setup 'w-missing'; Remove-Item $c.Hb; $r = Run $c ($reg + @('-Iter', '2'))
  Check 'w-missing: heartbeat missing writes <P>.watch' ((Watched $c) -and (Get-Content "$($c.P).watch" -Raw) -match 'heartbeat missing')

  # w-unlisted: the registry does not list the prefix
  $c = Setup 'w-unlisted'; Set-Content $c.Reg "$(Join-Path $c.D 'other\STOP') 2"; $r = Run $c ($reg + @('-Iter', '2'))
  Check 'w-unlisted: target missing from the registry writes <P>.watch' ((Watched $c) -and (Get-Content "$($c.P).watch" -Raw) -match 'not listed')

  # w-quar-all: every pool container quarantined
  $c = Setup 'w-quar-all'
  foreach ($x in 'Cronus901', 'Cronus902') { Set-Content (Join-Path $c.Q "$x.json") (@{ v = 3; state = 'quarantined'; container = $x } | ConvertTo-Json) }
  $r = Run $c ($reg + @('-Iter', '2'))
  Check 'w-quar-all: every pool container quarantined writes <P>.watch' ((Watched $c) -and (Get-Content "$($c.P).watch" -Raw) -match 'every pool container quarantined')

  # w-quar-one: one of two quarantined: no stop, one ALERT line
  $c = Setup 'w-quar-one'
  Set-Content (Join-Path $c.Q 'a.json') (@{ v = 3; state = 'quarantined'; container = 'Cronus901' } | ConvertTo-Json)
  Set-Content (Join-Path $c.Q 'b.json') (@{ v = 3; state = 'in_use'; container = 'Cronus902' } | ConvertTo-Json)
  $r = Run $c ($reg + @('-Iter', '3'))
  $alerts = @((LogText $c) -split "`n" | Where-Object { $_ -match 'ALERT .*Cronus901 quarantined' })
  Check 'w-quar-one: one of two quarantined: not written, one ALERT line' ((-not (Watched $c)) -and $alerts.Count -eq 1) (LogText $c)

  # w-jqfail: an unreadable quarantine record is never "none quarantined"
  $c = Setup 'w-jqfail'; Set-Content (Join-Path $c.Q 'bad.json') '{ not json'; $r = Run $c ($reg + @('-Iter', '2'))
  Check 'w-jqfail: an unreadable quarantine record writes <P>.watch' ((Watched $c) -and (Get-Content "$($c.P).watch" -Raw) -match 'quarantine records unreadable')

  # w-single: a second instance for the same prefix refuses with exit 3
  $c = Setup 'w-single'
  $second = $null
  $r = Run $c ($reg + @('-Iter', '30')) 60 {
    param($p)
    Start-Sleep -Seconds 4
    $script:second = Run $c ($reg + @('-Iter', '1')) 30
    New-Item -ItemType File "$($c.P).STOP-watch" | Out-Null
  }
  Check 'w-single: a second instance refuses (exit 3)' ($second.Ok -and $second.Code -eq 3) "second exit $($second.Code)"
  Check 'w-single: the first ends on <P>.STOP-watch' ($r.Ok -and $r.Code -eq 0 -and (LogText $c) -match 'exiting: STOP-watch')

  # exits: the run log's EXIT line, and -MaxHours
  $c = Setup 'x-exit'
  $r = Run $c $reg 60 { param($p) Start-Sleep -Seconds 3; Add-Content $c.Log 'EXIT 0 2026-11-18T00:00:00Z' }
  Check 'exit: on the run log EXIT line' ($r.Ok -and $r.Code -eq 0 -and (LogText $c) -match 'exiting: run log EXIT')
  $c = Setup 'x-maxhours'; $r = Run $c ($reg + @('-MaxHours', '0.001'))
  Check 'exit: at -MaxHours' ($r.Ok -and $r.Code -eq 0 -and (LogText $c) -match 'exiting: max lifetime')

  # daemon registry: one row while running, none after (scratch registry, never the live one)
  $c = Setup 'x-register'
  $rows = -1
  $r = Run $c @('-DaemonRegistry', $c.Daemons) 60 {
    param($p)
    Start-Sleep -Seconds 4
    $script:rows = @(Get-Content $c.Daemons -ErrorAction SilentlyContinue | Where-Object { $_ -match "^$($p.Id)`t" }).Count
    Add-Content $c.Log 'EXIT 0 2026-11-18T00:00:00Z'
  }
  $after = @(Get-Content $c.Daemons -ErrorAction SilentlyContinue | Where-Object { $_ -match 'watch-campaign\.ps1' }).Count
  Check 'register: one daemons.tsv row while running' ($rows -eq 1) "rows=$rows"
  Check 'register: the row is removed on exit' ($r.Ok -and $after -eq 0) "after=$after"

  # cost: every 20 executions, one total number, never per arm
  $c = Setup 'x-cost'
  $camp = [guid]::NewGuid().ToString(); [void](New-Item -ItemType Directory (Join-Path $c.Results "executions\$camp"))
  Set-Content (Join-Path $c.Results "campaigns\$camp.json") (@{ id = $camp; experiment = @{ id = 'exp-t' } } | ConvertTo-Json)
  foreach ($i in 1..21) {
    $arm = if ($i % 2) { 'a' } else { 'b' }
    Set-Content (Join-Path $c.Results "executions\$camp\$i.json") (@{ arm = $arm; telemetry = @{ cost_usd = 0.5 } } | ConvertTo-Json)
  }
  $r = Run $c ($reg + @('-Iter', '2', '-Experiment', 'exp-t'))
  $cost = if (Test-Path (Join-Path $c.D 'camp\cost.log')) { Get-Content (Join-Path $c.D 'camp\cost.log') -Raw } else { '' }
  Check 'cost: one line at 20 executions with the total only' ($cost -match "\[cost\] \S+Z exp-t $camp n=21 usd=10.5\b" -and @($cost -split "`n" | Where-Object { $_ }).Count -eq 1) $cost
  Check 'cost: no per-arm figure' ($cost -notmatch 'by_arm|"a"|"b"|arm')

  # HOST-BUSY: three busy samples then three quiet ones: one start and one end line, never a stop
  $c = Setup 'h-busy'
  Set-Content (Join-Path $c.Mem "memlog-$((Get-Date).ToUniversalTime().ToString('yyyy-MM-dd')).log") (Mem @('quiet', 'busy', 'busy', 'busy', 'quiet', 'quiet', 'quiet') 10)
  $r = Run $c ($reg + @('-Iter', '2'))
  $t = LogText $c
  Check 'host-busy: three busy samples give one HOST-BUSY start line' (@($t -split "`n" | Where-Object { $_ -match 'HOST-BUSY start Wow\.exe \S+Z' }).Count -eq 1) $t
  Check 'host-busy: three quiet samples give one HOST-BUSY end line' (@($t -split "`n" | Where-Object { $_ -match 'HOST-BUSY end \S+Z' }).Count -eq 1) $t
  Check 'host-busy: never a stop' (-not (Watched $c))
  # two busy samples are not enough
  $c = Setup 'h-two'
  Set-Content (Join-Path $c.Mem "memlog-$((Get-Date).ToUniversalTime().ToString('yyyy-MM-dd')).log") (Mem @('busy', 'busy', 'quiet', 'quiet') 10)
  $r = Run $c ($reg + @('-Iter', '2'))
  Check 'host-busy: two busy samples in a row give no start' ((LogText $c) -notmatch 'HOST-BUSY start')
  # a busy window from before the watcher's -FromUtc is not reported
  $c = Setup 'h-before'
  Set-Content (Join-Path $c.Mem "memlog-$((Get-Date).ToUniversalTime().ToString('yyyy-MM-dd')).log") (Mem @('busy', 'busy', 'busy', 'quiet', 'quiet', 'quiet') 10)
  $r = Run $c ($reg + @('-Iter', '2', '-FromUtc', (& $utc (Get-Date).AddSeconds(-30))))
  Check 'host-busy: samples before -FromUtc are not reported' ((LogText $c) -notmatch 'HOST-BUSY (start|end)') (LogText $c)
  # a stale memlog (newest sample 10 min old) and a missing one say "unknown", never nothing
  $c = Setup 'h-stale'
  Set-Content (Join-Path $c.Mem "memlog-$((Get-Date).ToUniversalTime().ToString('yyyy-MM-dd')).log") (Mem @('quiet') 600)
  $r = Run $c ($reg + @('-Iter', '2'))
  Check 'host-busy: a stale memlog gives HOST-BUSY unknown' ((LogText $c) -match 'HOST-BUSY unknown')
  $c = Setup 'h-missing'; Get-ChildItem $c.Mem | Remove-Item; $r = Run $c ($reg + @('-Iter', '2'))
  Check 'host-busy: a missing memlog gives HOST-BUSY unknown' ((LogText $c) -match 'HOST-BUSY unknown')
} finally {
  Remove-Item -Recurse -Force $Root -ErrorAction SilentlyContinue
}
"pass $($n - $fail) fail $fail"
exit $fail
