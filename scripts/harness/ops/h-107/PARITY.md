# hostwatch.ps1 parity with hostwatch.sh (H-107)

Port: `hostwatch.ps1`. Tests: `hostwatch-dry-test.ps1` (`pwsh -NoProfile -File hostwatch-dry-test.ps1 [-Work <dir>] [-SkipChurn]`).
Source of truth: `jobs\W2-10\ops\hostwatch.sh`, `stops.sh`, `hostwatch-dry-test.sh` (344 lines).
Final run: **pass 124 fail 0**, exit 0 (full output at the end).

## Case map

`=` ported as is (same name in the ps1 output). `~` ported with a different mechanism (reason given). `skip` not ported.

| bash case (hostwatch-dry-test.sh) | ps1 case | |
|---|---|---|
| thresholds: all 13 checks (normal x3, low-commit x3, low-free x2, all-commit, all-free, np-rise, np-small, repeat) | same names | = |
| bad readings: comma x2, unparsed-stall, stall-low x2, stall-180, stall-all, stall-reset | same names | = |
| awk fails on a normal reading: host-low; awk failure is logged | "verdict code fails on a normal reading", "verdict failure is logged" | ~ no awk: `HW_VERDICT_FAIL=1` makes the in-process verdict code throw |
| registry missing/empty/comments/nonnumeric/nopriority (x2 each) | same names | = |
| indented comment, CRLF, tab, spaces in a prefix, no final newline | same name | = |
| registry turns malformed while running x2 | same names | = |
| lock: second instance refuses (exit 3) | same name (first instance launched via `conhost --headless`) | = |
| STOP-hostwatch: host-low first; exits and frees its lock | same names (lock dir is `lock-ps`) | = |
| lock without an owner file x3 | same names, on `lock-ps` | ~ the ps1 lock is created atomically with its owner, so this state only arises by hand |
| lock of a dead pid is taken over | same name (`999999 1`; Windows pids are multiples of 4) | = |
| lock of a live pid with another start time | same name (test's own pid, start `1`) | = |
| watch.sh: 9 checks (w-fresh ... w-single) | skip: consumer-only (watch.sh, unchanged by this port) |
| stops.sh names: P.foo, cleared-*, STOP.WATCH, backslash prefix, .false-* | skip: consumer-only (active_stops/stops_clear; hostwatch never calls them) |
| planned stop present: host-low still written | same name | = |
| resume chain refuses: host-low still active after the planned stops are archived | "host-low still active after the planned stops are archived (hostwatch deleted nothing)" | ~ checks the files with the test's own active_stops equivalent, no chain script |
| stop_args gives one --stop-file per writer name | skip: consumer-only (harness argument builder) |
| 8 concurrent stop_write calls: exactly one creates the file | same name (8 pwsh processes, start barrier) | = |
| real PowerShell timeout boundary (`timeout -k 5 3 powershell`) | "[new] in-process read timeout" block (4 checks, feed line `HANG`, `HW_PS_TIMEOUT=2`) | ~ there is no timeout.exe; the in-process runspace timeout is what is tested |
| time, not count: step30-3, step30-4 x2, step90-2 x2, step90-3 | same names | = |
| wall clock jumping back 1000 s per call (fake `date`) | "real monotonic clock, 4 stalls 1 s apart, STALL_LOW 2: host-low still written" (+ no host-all) | ~ no `date` fork exists to fake; the Stopwatch does not read the wall clock at all |
| a heartbeat 10 min in the future is unsafe | skip: consumer-only (stops.sh hb_check) |
| a fresh heartbeat is safe | "[new] stops.sh hb_ok accepts the heartbeat hostwatch.ps1 wrote" | ~ runs the real hb_ok (sources stops.sh only) on the ps1's heartbeat |
| lock race: 4 processes, exactly one owner; ticket released | same names (4 pwsh processes) | = |
| a stale takeover ticket blocks takeover (exit 3, lock untouched) | same name | = |
| proc_state of a missing pid is dead; of this shell is live | same names (Windows pid + creation ticks) | = |
| write-fail x2, write-fail-all x2 | same names | = |
| clock-back, clock-partial-back (HW_NOW_FEED) | same names | = |
| hostwatch: awk prints OK then exits 2: host-low | covered by the verdict-failure cases | ~ in-process the verdict either returns or throws; there is no "printed, then failed" state |
| prio-big x2 | same names | = |
| missing stops directory is active; P.emergency_2 is active | skip: consumer-only (active_stops) |
| real resume chain refuses / starts | skip: consumer-only (resume chains) |
| gates-on.sh: 14 checks (item 1) | skip: consumer-only (gates-on.sh) |
| proc_state prints nothing / fails: live lock left alone | same names (function overridden in a child pwsh) | = |
| gates/watch with empty active_stops or hb_check (5) | skip: consumer-only |
| resume chain with empty active_stops | skip: consumer-only |
| neg-all: stall clock back 500 s, floor 240 s: host-all | same name | = |
| gates/watch quarantine and jq checks (7) | skip: consumer-only (quarantined_count is not used by hostwatch) |
| parse_reg: a prefix that cannot be resolved | "[new] registry unresolved" x2 + "parse_reg: a prefix that cannot be resolved makes the registry malformed" | ~ the unresolvable case is now real: an MSYS path outside a drive (`/tmp/...`) |
| an empty heartbeat file is unsafe | skip: consumer-only (hb_check) |
| a root-level prefix with no stops is clear | skip: consumer-only (active_stops) |

New cases (marked `[new]` in the output): heartbeat content, format and tmp cleanup; log line formats (reading, started, ALERT with MSYS prefix); stop file content; HW_ITER exit reason; np window of 15; empty answer; 9-digit priority limit; MSYS drive-form prefix; registry recovery ("registry valid again") and single ALERT; headless launch with MainWindowHandle 0; lock-ps owner format; live owner not taken over; bash lock + fresh heartbeat refusal, fresh bash lock with no heartbeat refusal, stale bash lock start; existing stop never overwritten; stop_write return codes 1/2; in-process timeout x4; proc_state with empty start; concurrent lock messages all logged; escalated stop text; sticky delivery-failed; backward clock logged; max lifetime x3; invalid HW_MAX_HOURS; churn check x7.

## Deliberate differences

- **No forks.** Memory is read with `Get-CimInstance` in a private runspace inside the pwsh process; files are read and written with .NET. The churn check saw no child process in 88 samples over 60 s (12 real readings).
- **In-process read timeout.** `BeginInvoke` plus `WaitOne(HW_PS_TIMEOUT)`, and `-OperationTimeoutSec` on both CIM queries. A timeout is rc 124 (the code `timeout` gave) and the runspace is dropped (`BeginStop`); the next read gets a new runspace. Ceiling: each hung read leaks one thread (marked `ponytail:` in the code).
- **Lock.** `<dir>\lock-ps`, owner `"<Windows pid> <creation time, UTC ticks>"`. It is created atomically by renaming a temp dir that already holds `owner`, so a lock without an owner never exists in normal operation. Takeover keeps the bash ticket protocol (`lock-ps.takeover`). The bash lock `<dir>\lock` (MSYS pids) cannot be checked without a fork. The ps1 refuses (exit 3) while `<dir>\lock` exists and either the heartbeat or the lock's owner file (or the lock dir, if it has no owner) is younger than 180 s or in the future. Consequence: after a bash instance is killed without cleanup, the ps1 can start 180 s later. The bash lock dir is never touched.
- **Stall clock.** `[Diagnostics.Stopwatch]`, which is monotonic and immune to wall-clock changes. Bash `$SECONDS` follows the wall clock, which is why the bash keeps the `bad_n * MIN_STEP` floor; the ps1 keeps the floor too.
- **Verdict failure.** It cannot fail the way awk can, so `HW_VERDICT_FAIL=1` is the test hook. On failure the log line reads `np_low=? verdict=none` and the stop reason is `no clean verdict (verdict error: <message>): <why>`. Bash wrote `(awk rc N)`. The `no clean verdict` prefix is kept.
- **Exit logging.** Every exit path logs a line. These are new: `exiting after N readings (HW_ITER)`, `stopping on max lifetime (H h, HW_MAX_HOURS)`, `REFUSED to start: lock not taken (rc N)`, `REFUSED to start: the bash hostwatch lock ...`, `exiting on error: ...` (exit 4). After a bad reading with an exception or timeout, an extra `read error: <message>` line follows the unchanged `bad reading (rc N, '...')` line.
- **Max lifetime.** `HW_MAX_HOURS` (default none). On expiry it acts like STOP-hostwatch: host-low to the lowest-priority targets, then exit 0.
- **Log appends.** Appends use an AppendData-only handle, which is atomic like bash `>>`. An earlier `FileMode.Append` version lost lines under concurrent writers; the test caught it.
- **Prefixes.** Logs show the MSYS form (`/c/...`) of backslash prefixes, as `cygpath -u` produced. I/O uses the Windows path. An MSYS path outside a drive letter (`/tmp/x`, `/usr/...`) cannot be resolved without cygpath, so it now makes the registry malformed. Bash accepted it. `reg.err` is no longer written; the error goes into the log and stderr, as before.
- **Registry encoding.** .NET strips a UTF-8 BOM. Bash would have seen the BOM as part of the first line.
- **Daemon registry.** `Register-Daemon` and `Unregister-Daemon` are empty stubs, called after the lock is taken and in the final `finally`. `daemons.tsv` is not written.
- **Start command.** `Start-Process conhost.exe -ArgumentList '--headless','"C:\Program Files\PowerShell\7\pwsh.exe"','-NoProfile','-File','<path>'`. The process tree is conhost.exe (created before pwsh) -> pwsh.exe (MainWindowHandle 0) and nothing below.

## Findings in the bash version (reported, kept as is)

1. **A failed CIM query reads as 0 GB, not as a bad reading.** `Get-CimInstance` fails non-terminating, `$null/1MB` is 0, and `[string]::Format` still exits 0. The result is `0.0 0.0 0.00` with rc 0, which parses as a good reading. So a WMI failure gives host-all on every target at once and resets the stall clock, instead of going through the 90/180 s stall tiers. It is fail-safe but over-escalates. The ps1 uses the identical expression (no `-ErrorAction Stop`) to keep the behaviour; switching would be a one-word change.
2. **A lock taker racing a normal release fails instead of retrying.** If the lock dir vanishes between the failed mkdir and the owner poll, `lock_take` waits 10 s and fails with "no owner after 10 s" (exit 3), instead of retrying the mkdir. The ps1 keeps the same shape; it was observed once in the 4-taker race.
3. **Comment and code disagree on DELIVERY_FAILED.** The comment says "Any write that still fails sets DELIVERY_FAILED"; the code sets it on the first failed primary write, even when every escalated write then succeeds. The code matches task rule 4, and the ps1 follows the code.
4. **Two bash exit paths log nothing.** The `HW_ITER` exit writes nothing to the log, and the lock refusal writes only to stderr (lock_take's own line does reach the log). The ps1 logs both.

## Full test output (final run)

```
== thresholds
[OK]   normal readings write no stop
[OK]   normal readings are logged with a verdict
[OK]   hostwatch refreshes its heartbeat
[OK]   [new] heartbeat content is one UTC ISO time line, as date -u +%FT%TZ wrote it
[OK]   [new] heartbeat.tmp is not left behind
[OK]   [new] log line format: "<UTC> free=X commit_headroom=Y np=Z np_low=L verdict=V"
[OK]   [new] started line: "started (pid N), 3 targets"
[OK]   [new] HW_ITER exit logs its reason, exit 0
[OK]   [new] lock-ps freed on exit
[OK]   commit 5.5 GB: host-low on lowest priority (A, G)
[OK]   commit 5.5 GB: B (priority 2) untouched, no host-all
[OK]   commit 5.5 GB: no host-all
[OK]   [new] stop file content "<name> <UTC>: <reason>"
[OK]   [new] ALERT line uses the MSYS prefix form, as the bash log did
[OK]   free 7.5 GB: host-low on A and G only
[OK]   free 7.5 GB: not on B
[OK]   commit 2.5 GB: host-all reaches every target
[OK]   free 3.5 GB: host-all reaches every target
[OK]   nonpaged 7.0 -> 8.6 GB: host-low
[OK]   nonpaged 7.0 -> 8.4 GB (1.4 GB): no stop
[OK]   [new] np low is over the last 15 good readings: 7.00 left the window, 8.00 -> 8.60 is no stop
[OK]   a stop is written once: 2 ALERTs (A, G), not 4
== bad readings are stalls, timed from the last good reading (fake clock 60 s per reading)
[OK]   one comma-decimal reading (60 s): logged as bad, no stop
[OK]   one comma-decimal reading (60 s): no stop
[OK]   2 unparsed readings (120 s > 90 s): host-low
[OK]   no answer for 120 s (> 90 s): host-low, not host-all
[OK]   no answer for 120 s: no host-all
[OK]   no answer for exactly 180 s: still host-low only
[OK]   no answer for 240 s (> 180 s): host-all reaches every target
[OK]   a good reading resets the stall clock: no stop
[OK]   [new] empty answers are bad readings (rc 1): host-low at 120 s
== fail-safe comparisons (bash: fake awk; here: HW_VERDICT_FAIL makes the verdict code throw)
[OK]   verdict code fails on a normal reading: host-low (no clean verdict)
[OK]   verdict failure is logged
[OK]   verdict failure: the reading line logs np_low=? verdict=none
== registry
[OK]   registry missing: refuses to start (exit 2, loud)
[OK]   registry missing: wrote no heartbeat
[OK]   registry empty: refuses to start (exit 2, loud)
[OK]   registry empty: wrote no heartbeat
[OK]   registry comments: refuses to start (exit 2, loud)
[OK]   registry comments: wrote no heartbeat
[OK]   registry nonnumeric: refuses to start (exit 2, loud)
[OK]   registry nonnumeric: wrote no heartbeat
[OK]   registry nopriority: refuses to start (exit 2, loud)
[OK]   registry nopriority: wrote no heartbeat
[OK]   [new] registry toolong: refuses to start (exit 2, loud)
[OK]   [new] registry toolong: wrote no heartbeat
[OK]   [new] registry unresolved: refuses to start (exit 2, loud)
[OK]   [new] registry unresolved: wrote no heartbeat
[OK]   parse_reg: a prefix that cannot be resolved makes the registry malformed (the error names it)
[OK]   indented comment, CRLF, tab, spaces in a prefix, no final newline: all targets hit
[OK]   [new] an MSYS drive-form prefix (/c/...) resolves: host-low reaches A
[OK]   registry turns malformed while running: ALERT logged
[OK]   registry turns malformed while running: the last good copy still gets the stop
[OK]   [new] the malformed-registry ALERT is logged once
[OK]   [new] registry recovers while running: "registry valid again" logged
== lock
[OK]   [new] headless launch: hostwatch pwsh found under the conhost launcher, MainWindowHandle 0
[OK]   second instance refuses while the first is alive (exit 3)
[OK]   [new] lock-ps owner is "<Windows pid> <creation ticks>" of the live instance
[OK]   STOP-hostwatch: host-low written to the lowest-priority targets first
[OK]   STOP-hostwatch: watcher exits and frees its lock
[OK]   [new] STOP-hostwatch: exit 0, reason logged
[OK]   [new] STOP-hostwatch: B (priority 2) gets no host-low
[OK]   lock without an owner file is not taken over (exit 3, after 10 s)
[OK]   lock without an owner file: the lock is left alone
[OK]   lock without an owner file: no monitoring started
[OK]   lock of a dead pid is taken over
[OK]   lock of a live pid with another start time (reused pid) is taken over
[OK]   [new] lock of a live pid with its own start time is not taken over (exit 3)
== [new] the old bash lock ($DIR\lock) and the heartbeat
[OK]   [new] bash lock + heartbeat younger than 180 s: refuses (exit 3, loud), no lock-ps
[OK]   [new] bash lock refusal is logged
[OK]   [new] bash lock 0 s old, no heartbeat yet (a bash instance just started): refuses (exit 3)
[OK]   [new] bash lock and heartbeat both 300 s old: starts (exit 0), the bash lock is left alone
== stop_write
[OK]   planned stop present: host-low still written
[OK]   host-low still active after the planned stops are archived (hostwatch deleted nothing)
[OK]   [new] an existing stop is never overwritten (exit-1 path, no ALERT for it)
[OK]   8 concurrent stop_write calls: exactly one creates the file
[OK]   [new] lib: stop_write returns 1 on an existing file, 2 on a missing directory
== [new] in-process read timeout (replaces the real PowerShell timeout boundary case)
[OK]   [new] a hanging read is cut by the in-process timeout (HW_PS_TIMEOUT 2: run took 3s < 15 s, exit 0)
[OK]   [new] a timed-out read is a bad reading, rc 124
[OK]   [new] 2 timed-out reads (120 s): host-low
[OK]   [new] reads work again after a timed-out one (fresh runspace): 2 good readings, no stop
== H-89b item 2: time, not count (feed steps of 30 s and 90 s tell them apart)
[OK]   30 s steps, 3 stalls = 90 s (not > 90): no stop (counting would have stopped at 2)
[OK]   30 s steps, 4 stalls = 120 s: host-low
[OK]   30 s steps, 4 stalls = 120 s: not host-all
[OK]   90 s steps, 2 stalls = 180 s (not > 180): host-low present
[OK]   90 s steps, 2 stalls = 180 s: no host-all
[OK]   90 s steps, 3 stalls = 270 s: host-all (counting needed 5)
== H-89b item 2: the real stall clock (Stopwatch, no fake clock)
[OK]   real monotonic clock, 4 stalls 1 s apart, STALL_LOW 2: host-low still written
[OK]   real monotonic clock: no host-all (STALL_ALL 100)
[OK]   [new] stops.sh hb_ok (the consumers' check) accepts the heartbeat hostwatch.ps1 wrote (HBOK)
== H-89b item 3: lock takeover
[OK]   4 separate processes take one dead owner's lock: exactly one owner
[OK]   takeover ticket released afterwards
[OK]   [new] concurrent lock messages all reach the shared log (4 takers, 4 lines, 1 takeover)
[OK]   [new] the winner released the lock
[OK]   a stale takeover ticket blocks takeover visibly (exit 3, lock untouched)
[OK]   proc_state of a missing pid is dead
[OK]   proc_state of this process with its own start time is live
[OK]   [new] proc_state with an empty recorded start is unknown
== H-89b item 4: a failed stop write is retried, logged and escalated
[OK]   target dir missing: ALERT 'stop write FAILED twice' logged
[OK]   the failed host-low goes to every other target too (B, priority 2)
[OK]   [new] the escalated stop says so
[OK]   escalated write also fails: ALERT 'escalated stop write FAILED twice'
[OK]   a stop that could not be delivered anywhere: heartbeat not refreshed
[OK]   [new] heartbeat NOT refreshed is logged
[OK]   [new] after one failed delivery the heartbeat is never refreshed for the rest of the run
== self-check r1: clock going backwards, verdict failure, priorities
[OK]   stall clock goes back (100 -> 50) during a stall: host-low
[OK]   [new] the backward clock is logged
[OK]   clock steps back but stays above last_good (100, 180, 150): the bad-reading floor (2 x 60 s) still gives host-low
[OK]   priorities 1000000 and 0000001 are accepted (exit 0)
[OK]   0000001 is the lowest priority: A gets host-low, B does not
== H-89b run 002
[OK]   proc_state prints nothing: live lock left alone, no takeover (rc 1)
[OK]   proc_state fails (throws): live lock left alone, no takeover (rc 1)
[OK]   stall clock back 500 s, 4 bad readings (floor 240 s > 180 s): host-all reaches every target
== [new] max lifetime (HW_MAX_HOURS)
[OK]   [new] HW_MAX_HOURS 0.0005 (1.8 s): exits by itself, exit 0 (took 3s)
[OK]   [new] max lifetime: reason logged
[OK]   [new] max lifetime: host-low to the lowest-priority targets, lock freed
[OK]   [new] an invalid HW_MAX_HOURS refuses to start (exit 2)
== churn check: real reading (no HW_FEED), HW_INTERVAL 5, about 60 s, production start command
   launcher conhost.exe pid 75272 created 13:14:12.120Z -> pwsh pid 72564 created 13:14:12.128Z, MainWindowHandle 0
[OK]   churn: the hostwatch pwsh has exactly one parent, the conhost.exe launcher we started, created before pwsh
[OK]   churn: the hostwatch pwsh has MainWindowHandle 0
   hostwatch pid 72564, 88 samples of Win32_Process ParentProcessId over 60 s, 12 readings logged
   children of the hostwatch pwsh: none
   first reading: 2026-11-16T13:14:13Z free=44.3 commit_headroom=65.8 np=4.46 np_low=4.46 verdict=OK
[OK]   churn: at least 10 real readings in 60 s (12)
[OK]   churn: the hostwatch pwsh started no child process (88 samples)
[OK]   churn: the conhost launcher exits with it
[OK]   churn: real readings parse (no bad reading logged)
[OK]   churn: stopped by its scratch STOP-hostwatch (exit 0, reason logged)
pass 124 fail 0 (work dir C:\Users\SShadowS\AppData\Local\Temp\hw-ps-test-298d0dd0)
```
