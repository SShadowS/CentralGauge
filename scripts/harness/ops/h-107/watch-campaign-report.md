# M12-05 report: low-churn campaign watcher (lane ops)

Run 001 (0a66cea4, 2026-11-17) was sent back with one fix; run 002 makes it. Files: `watch-campaign.ps1`,
`watch-campaign-test.ps1` (this folder).

## Plan reference amended (run 002)

The plan's M12-05 text names the watcher's own stop file `<P>.STOP-watch`. That name is superseded: stops.sh
`active_stops` counts every `P.*` file except `P.cleared-*` as an active stop, so a `P.*` name would also block
resume chains until renamed. The watcher's stop file is now **`<prefix dir>\watch.STOP`** (outside `P.*`). The
orchestrator updates the plan text (M12-05, M12-08). The watcher still writes only `<P>.watch`, the stops.sh `watch`
name, as its campaign stop.

## Acceptance

- Dry test: 26 passed, 0 failed (`pwsh -NoProfile -File scripts/harness/ops/h-107/watch-campaign-test.ps1`). New in
  run 002: the first instance ends on `<prefix dir>\watch.STOP`; with that file present, stops.sh `active_stops`
  prints `CLEAR`; as a self-check of that test, `active_stops` does list `<P>.watch`.
- No child process in the loop: `grep -nE 'bash|Start-Process|pwsh(\.exe)?[^.]|& *\$|Invoke-Expression|\[Diagnostics\.Process\]::Start'`
  matches only comments (the header and the start instructions) and the `-QuietAllow` default. RAM is read in-process
  (Get-CimInstance); the reused hostwatch.ps1 helpers (Write-Stop, Read-Registry, Lock-Take) are .NET-only.
- Live run (run 001 code, 2026-11-17 22:25:31-22:35:42Z, dummy target with scratch registry, quarantine dir and
  results; live RAM, hostwatch heartbeat and memlog): one `daemons.tsv` row (pid 99124) while running, none after
  "exiting: max lifetime 0.1667 h"; no stop written; a live Unity.exe HOST-BUSY window 22:31:30-22:33:06Z logged.

## Known limits (accepted)

- **HOST-BUSY is memory only.** The memlog records pid, parent pid, private MB, name and command line, with no CPU
  column, so the plan's `-BusyCpu` cannot be judged from it. Busy = a process outside `-QuietAllow` at or above
  `-BusyMb` (default 3000 MB) in three samples in a row. On 2026-11-17 claude.exe was about 1 GB, browsers about
  1.4 GB, MsMpEng 1.2 GB; Wow.exe 3.5-11 GB; Unity.exe crossed 3000 MB in the evening.
- Extra parameters beyond the plan: `-Experiment` (to find the campaign for the cost line, as in watch.sh),
  `-MemlogDir`, `-QuietAllow`, `-BusyMb`, `-FromUtc` (memlog samples from before the start minus 60 s are ignored, so
  a new campaign does not log earlier windows); test hooks `-Feed`, `-Iter`, `-StallSeconds`, `-DaemonRegistry`.
- The single-instance lock is the directory `<Prefix>.watch-ps.lock`; `active_stops` counts files only, so it blocks
  nothing.
