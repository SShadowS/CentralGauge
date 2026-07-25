# `setup.harness` re-measurement (Task 6 of `2026-07-25-follow-ups`)

Verifies commit `43dcabe8` — the fix that made the three per-container test-
harness presence probes run **concurrently through the warm session slot**
instead of serially via cold `pwsh` spawns. Baseline is
`docs/superpowers/plans/2026-07-25-compiler-folder-adoption-measurements.md`
(Phase 2), which measured `setup.harness` at 26.2-26.6 s across both its runs
with all three containers confirmed live and both runs logging `Test harness
already published` for all three — the same "already published" condition
this run must reproduce for the comparison to be like-for-like.

## Method

- Task: `tasks/hard/CG-AL-X035-poisoned-rescue.yml` (same hard trap-task as
  Phase 1 and Phase 2, for comparability).
- Models: `anthropic/claude-opus-4-8`, `anthropic/claude-sonnet-4-6`,
  `anthropic/claude-haiku-4-5-20251001` (`run-xiterate.ps1` default).
- Containers: `Cronus282,Cronus283,Cronus284`. `Cronus28` sanity lane skipped
  via `-NoSanity`.
- Runner: `run-xiterate.ps1`, `--runs 1 --attempts 2 --no-ingest`,
  `CENTRALGAUGE_BENCH_PRECHECK=0` (both baked into the script — fully local,
  nothing reached the prod scoreboard). Real Anthropic API calls, authorised
  by the human partner for this one run.
- Command, launched in the background:
  ```
  pwsh -NoProfile -File ./run-xiterate.ps1 tasks/hard/CG-AL-X035-poisoned-rescue.yml -NoSanity -TraceFile results/trace-harness.json
  ```

### Preflight

- `find results/.bench-running.json -mmin -2` — no output, no other bench
  live.
- `docker inspect <name> --format '{{.State.Running}}'` for all six local
  containers immediately before launch:

  | Container | Running |
  |---|---|
  | Cronus28 | true |
  | Cronus281 | true |
  | Cronus282 | true |
  | Cronus283 | true |
  | Cronus284 | true |
  | Cronus285 | false |

  All three containers this run actually dispatches to (Cronus282, Cronus283,
  Cronus284) were confirmed `Running: true`. `Cronus285` is not in the bench
  set and its state is irrelevant here — recorded for completeness only. This
  is the check Phase 1 skipped and that contaminated its `setup.harness`
  figure; it was not skipped this time. The run log's `[Container] Using
  existing: Cronus282/283/284` lines confirm the same three containers were
  actually used.

### `setup.warmup-compiler` will read high — expected, not a regression

Task 3 of this same follow-ups branch bumped `LAYOUT_VERSION` from 1 to 2,
which invalidates every `.centralgauge-marker.json` on this machine (the
adoption check in `tryAdoptCompilerFolder` treats a version mismatch as
"rebuild"). This run therefore rebuilds the compiler folder once per
container before adoption can resume on the *next* run. **This is expected
and is not a harness-fix regression** — it is orthogonal to the phase this
measurement is about. Confirmed directly on the span's own counters, not
assumed: see Raw extraction below (`adopted=0, rebuilt=3`). The next run
against these same three containers, with markers now freshly written at the
new layout version, should return `setup.warmup-compiler` to ~0.4 s
(`adopted=3, rebuilt=0`) per the Phase 2 baseline — expected, but unverified
by this run, which only exercised the rebuild path.

## Raw extraction

Extracted with the brief's own `jq` command:

```
jq -r '.traceEvents[]|select(.ph=="X")|select(.name|startswith("setup."))|"\(.name)\t\(.args.container // "")\t\(.dur/1000000)s"' results/trace-harness.json

setup.health    Cronus282    5.326054s
setup.health    Cronus283    5.195811s
setup.health    Cronus284    5.26102s
setup.prenuke                6.807365s
setup.warmup-compiler       43.29398s
setup.harness                5.351151s
```

Independently re-run (not taken on trust from the teammate who first
extracted it) and confirmed byte-for-byte against the numbers above.

`setup.warmup-compiler` args, confirming the rebuild-not-regression read:

```
jq -r '.traceEvents[]|select(.ph=="X")|select(.name=="setup.warmup-compiler")|.args' results/trace-harness.json
{ "adopted": 0, "rebuilt": 3, "ok": true }
```

Root span:

```
jq -r '.traceEvents[]|select(.ph=="X")|select(.name=="bench")|"\(.name)\t\(.dur/1000000)s"' results/trace-harness.json
bench    107.344734s
```

Harness log lines proving all three containers took the "already published"
path — the condition that makes this a like-for-like comparison against the
26.2-26.6 s baseline rather than a different (publish) workload:

```
[container:bc] Test harness already published on Cronus282
[container:bc] Test harness already published on Cronus283
[container:bc] Test harness already published on Cronus284
```

(`results/task6-run.log` lines 114-116. No `Publishing test harness to
<container>` line appears anywhere in the log for any of the three
containers.)

## `setup.harness`: 26.2-26.6 s -> 5.351 s

**The predicted ~4 s did not quite materialise; 5.351 s landed close to it,
and the gap is diagnosable rather than being spun as a clean win.**

The fix's mechanism was to move the three probes from serial cold `pwsh`
spawns (~8.8 s each, summing to 26.2-26.6 s) to concurrent execution through
the warm session slot, so wall time should approach the cost of a *single*
probe rather than three. The trace does break the probes out individually
(`runScriptThroughSession` spans tagged `scriptLabel: "harness-probe"`, one
per container), and they settle the question directly rather than leaving it
as a hypothesis:

```
jq '.traceEvents[]|select(.args.scriptLabel=="harness-probe")' results/trace-harness.json
tid 100  ts 66595343  dur 4.831812s
tid 110  ts 66595390  dur 4.725950s
tid 120  ts 66595410  dur 5.350514s
```

All three start within **67 microseconds** of each other — genuinely
concurrent, not serial. `setup.harness` (5.351151 s) lands within ~0.6 ms of
the slowest probe alone (5.350514 s on tid 120), so there is essentially
**zero** non-probe overhead in the phase: wall time already *is* the cost of
one probe, not three, exactly as the fix intended.

That also rules out the session-establishment hypothesis this section
previously offered. `setup.prenuke` ran immediately before this phase
through the *same three session-slot tids* (100/110/120, first hit at
`ts=16493675`, well ahead of the harness probes at `ts≈66595390`), and
`src/container/pwsh-session.ts` has no idle reaper that would tear a slot
down between the two phases — so the slots were already warm, not
first-use, by the time the harness probe ran. The ~5 s residual is not
one-time setup; it is the recurring per-call cost of `Get-BcContainerAppInfo`
(the probe script's body, `ensureTestHarness` in
`bc-container-provider.ts:1495`) through an already-warm slot, ~4.7-5.4 s
per call. That call cost, not session establishment, is the next lever if
`setup.harness` is revisited.

The delta clears the noise floor (see below) and the concurrency mechanism
is directly evidenced twice over: three concurrent hits, zero serial cold
spawns, observed both in the trace above and on the harness log.

## Full `setup.*` breakdown and total wall time

| Phase | This run | Phase 2 baseline (adoption-on) | Note |
|---|---|---|---|
| `setup.health` (sum, 3 containers) | 15.783 s | 18.95 s | Flat-ish; not the phase under test |
| `setup.prenuke` | 6.807 s | 6.60 s | Flat |
| `setup.warmup-compiler` | 43.294 s (`adopted=0, rebuilt=3`) | 0.373 s (`adopted=3, rebuilt=0`) | **Expected** — `LAYOUT_VERSION` bump forces one rebuild/container this run, see above. Not part of this measurement's verdict. |
| **`setup.harness`** | **5.351 s** | **26.22-26.57 s** | **The phase under test. -20.9 to -21.2 s.** |
| **setup TOTAL** | **71.235 s** | 52.49 s | Higher only because of the expected compiler rebuild above |
| Non-setup (LLM + compile + rest) | 36.110 s | 39.06 s | Not investigated further; see n=1 caveat |
| **Root `bench` span TOTAL** | **107.345 s** | 91.55 s | Higher only because of the expected compiler rebuild above |

Task outcome for context (not part of the timing verdict): all three models
(Opus, Sonnet, Haiku) failed to compile on both attempts against this trap
task — score 0.0 all round, $0.0257 combined spend, entirely local
(`--no-ingest`, `CENTRALGAUGE_BENCH_PRECHECK=0`).

### Projected steady state

Once `LAYOUT_VERSION`-driven markers are back in place (next run,
unverified), `setup.warmup-compiler` should return to ~0.4 s per the Phase 2
baseline, giving a projected steady-state setup phase of roughly:

```
15.8 (health) + 6.8 (prenuke) + 0.4 (warmup) + 5.4 (harness) ≈ 28.4 s
```

That makes **`setup.health` the new largest startup phase** at ~15.8 s —
three cold `Test-BcContainer` spawns at ~5.2-5.3 s each, structurally the
same serial-cold-spawn shape `setup.harness` just had fixed. Worth recording
as the next optimization target rather than acting on now.

## n=1 caveat and the noise floor

Phase 1's `timing.log` (249 recorded task attempts) gives per-attempt
totals: p50 40.9 s, p90 67.2 s, max 199.4 s.

- **The `setup.harness` delta (20.9-21.2 s) clears the noise floor.** It is
  backed by a mechanism directly observable in the log (three "already
  published" hits, zero cold-spawn publish fallbacks) and by matching
  container identity between this run and the Phase 2 baseline (same three
  containers, same "already published" precondition), not just a magnitude
  comparison. A single-phase delta of this size sitting above p50 is not the
  kind of swing per-task LLM/compile variance produces on its own.
- **The `setup.health` and `setup.prenuke` deltas do not clear the noise
  floor** and are not characterised as changes — both are flat to within
  ordinary per-spawn jitter (health: 15.78 s vs 18.95 s; prenuke: 6.81 s vs
  6.60 s), the same conclusion Phase 2 reached about these same two phases.
- **`setup.warmup-compiler`'s 43.294 s and the resulting +15.7 s setup-total
  / +15.8 s root-span deltas are not attributable to the harness fix at
  all** — they are the known, expected `LAYOUT_VERSION` rebuild cost
  discussed above, not noise and not signal for this measurement's question.

## Verdict

**The harness fix delivered.** `setup.harness` fell from the 26.2-26.6 s
baseline to 5.351 s — a 20.9-21.2 s reduction, confirmed like-for-like by all
three containers hitting the "already published" path in both this run and
the baseline runs (no container fell back to a publish workload, which would
have made the comparison invalid). This is the single largest engineering
target this measurement set out to verify, and it is now resolved on this
metric.

The predicted ~4 s undershot slightly (5.351 s measured) rather than
overshot — reported honestly rather than rounded down. The remaining cost is
not session establishment: the per-probe trace spans show the three probes
running fully concurrently (67 microseconds apart) with `setup.harness`
tracking the slowest probe to within ~0.6 ms, and the same session slots
were already warm from `setup.prenuke` moments earlier. The residual is the
recurring per-call cost of `Get-BcContainerAppInfo` through a warm slot,
~4.7-5.4 s per call — that is the next lever, not one-time setup.

This run also **cannot speak to whether `setup.warmup-compiler` returns to
~0.4 s** — that's the next run's job, deliberately not re-verified here
because Task 3's `LAYOUT_VERSION` bump makes a rebuild-once-per-container
outcome expected and uninformative about the harness fix. Total wall time
(107.345 s) and setup total (71.235 s) both read higher than the Phase 2
baseline purely because of that expected rebuild, not because of any
regression in the harness fix or elsewhere — the phase-by-phase table above
isolates that explicitly rather than leaving the headline total to be
misread as a regression.
