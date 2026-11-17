# H-107 run 001 report: daemon registry, orphan reaper, low-churn watchers (lane ops)

2026-11-16 to 2026-11-17. Files in this folder are copies; the live copies are under `H:\cg-coord` (paths below).
No harness code changed. No token or lease content is committed (scanned: the only `coord-lease` matches are the
masking code and comments).

## 1. Daemon registry

`H:\cg-coord\daemons.tsv`, columns `pid start_utc script owner purpose max_hours stop_file`. `start_utc` is the
process creation time, so a reused PID never matches. Module `H:\cg-coord\jobs\daemons\daemons.psm1`
(`Get-ProcStartUtc`, `Read-Daemons`, `Register-Daemon`, `Unregister-Daemon`): writes take a lock file, write a tmp
file, then `[IO.File]::Replace`; works in PowerShell 5.1 and 7. Test `daemons-test.ps1`: 9/9 in both shells.

Rows at 2026-11-17 ~20:00Z: memlog.ps1 (53448), poollog.ps1 (63100, orchestrator, 48 h), hostwatch.ps1 (51032).
Earlier rows (heartbeat.ps1, the stop bridges, the M8-21 qualify runs) were removed by their own exit paths or by
lane ops when their run ended. heartbeat.ps1 exited by itself at 2026-11-17T19:20:04Z ("no lease file left").

## 2. Reaper (dry-run)

`H:\cg-coord\jobs\reaper\reaper.ps1`, one pass per run, started hourly by the scheduled task `cg-coord-reaper`
(`reaper-task.ps1`: Interactive, Limited, as the owner's user; action
`conhost.exe --headless "pwsh.exe" -NoProfile -NonInteractive -File reaper.ps1`).

- Candidates: unregistered bash/sh older than 15 min with no live claude.exe ancestor; sleep past its own argument plus
  a grace period; registered processes past max_hours. Never anything but bash, sh or sleep.
- Protected (logged, never a candidate): a process whose own or descendant command line names `harness`, or with a live
  descendant deno, pwsh, powershell or docker (added 2026-11-17 after the 08:00Z run below).
- Kill mode refuses any command line naming a live registry script. Command lines are masked (`--coord-lease X=***`).
- New candidates go to cg-orchestrator through `coord ask`, at most once a day.
- Test `reaper-test.ps1`: 20/20 (run by the owner).
- First dry-run log: `reaper-dry-run-2026-11-16.log` (14 runs, all candidates=0). 2026-11-17: 21 runs; the only run
  with candidates was 08:00:57Z (candidates=4: the relaunched M8-21 back half, which lane ops had not registered). The
  7-day clean clock restarted at about 08:10Z; every run since shows candidates=0.

**Kill mode stays off and the reaper stays in dry-run.** The orchestrator files H-107b for the kill-mode go, at
2026-11-24 08:10Z at the earliest, if the dry-run logs stay at candidates=0.

## 3. Low-churn watchers

Each is one pwsh process with no git-bash child per iteration. Each exits by itself on its target's EXIT (or empty
input), at its max lifetime, or when its stop file appears, and registers and unregisters itself.

| Watcher | Live path | Replaces | Test |
| --- | --- | --- | --- |
| watch-qualify.ps1 | tasks\M8-21\ops | watch-qualify.sh / -n.sh | watchers-test.ps1 16/16 |
| stop-bridge.ps1 | tasks\H-102 | stop-bridge.sh | watchers-test.ps1 |
| heartbeat.ps1 | jobs\W2-10 | heartbeat.sh | heartbeat-test.ps1 7/7 |
| hostwatch.ps1 | jobs\W2-10\ops (source tasks\H-107\hostwatch-ps) | hostwatch.sh | hostwatch-dry-test.ps1 134/134; PARITY.md |
| running-checkpoint.ps1 | jobs\W2-10 | running-checkpoint-loop.sh (retired, refuses to run) | running-checkpoint-test.ps1 8/8 |

hostwatch.ps1 keeps hostwatch.sh's priority order, stop semantics and the H-89 stall fail-safe (PARITY.md).
running-checkpoint.ps1 is not running: `running.tsv` has no run. `inventory.ps1` lists bash/sh/sleep with ancestry for
audits.

## 4. Runbook rule

Accepted by the orchestrator as proposed; the orchestrator adds it to
`docs/superpowers/runbooks/harness-autonomy/lane.md` when integrating H-107 (not edited here).

## 5. Measure: idle vs loaded

`churn.ps1` (5 min, polled every 200 ms, so a lower bound) with `pooltags2.ps1` for Toke.

| | before.json (2026-11-16 12:16Z, loaded) | after-idle.json (2026-11-17 19:21Z, idle) |
| --- | --- | --- |
| bash/sh/sleep seen per min | 169.0 (bash 721, sh 114, sleep 11) | 7.6 (bash 36, sh 2, sleep 0) |
| Toke growth per min | +303.0 | -5.8 |
| Toke paged pool at end | 2950.7 MB | 286.5 MB |

Caveat: this is idle vs loaded, not like for like. The before sample was pre-reboot, during active sessions with
bash watchers running and dominated by the Claude Bash tool. The after sample had no harness run, the ops containers
stopped, and no tool calls from this session. The 36 bash processes are not from lane-ops daemons, which are all
pwsh, so they are most likely other sessions' Bash tool (not attributed). The loaded split between Claude-session and
daemon churn is measured during the next campaign as part of H-107b.

## Files

daemons.psm1, daemons-test.ps1, reaper.ps1, reaper-task.ps1, reaper-test.ps1, reaper-dry-run-2026-11-16.log,
heartbeat.ps1, heartbeat-test.ps1, hostwatch.ps1, hostwatch-dry-test.ps1, PARITY.md, stop-bridge.ps1,
watch-qualify.ps1, watchers-test.ps1, running-checkpoint.ps1, running-checkpoint-test.ps1, inventory.ps1, churn.ps1,
pooltags2.ps1, before.json, after-idle.json.
