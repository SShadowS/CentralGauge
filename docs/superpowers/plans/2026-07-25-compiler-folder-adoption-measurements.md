# Compiler-folder adoption: control vs adoption measurements

Task 10 of the Phase 2 implementation plan (`2026-07-25-compiler-folder-adoption`).
This is the acceptance gate: it measures whether host-side adoption
(`tryAdoptCompilerFolder` in `src/container/bc-container-provider.ts`) actually
removes the `New-BcCompilerFolder` cost that Phase 1 measured at 48.96 s warm
(`docs/superpowers/plans/2026-07-24-fast-trap-iteration-measurements.md`).

## Method

- Task: `tasks/hard/CG-AL-X035-poisoned-rescue.yml` (same hard trap-task as
  Phase 1, for comparability).
- Models: `anthropic/claude-opus-4-8`, `anthropic/claude-sonnet-4-6`,
  `anthropic/claude-haiku-4-5-20251001` (`run-xiterate.ps1` default).
- Containers: `Cronus282,Cronus283,Cronus284`. `Cronus28` sanity lane skipped
  via `-NoSanity`.
- Runner: `run-xiterate.ps1`, `--runs 1 --attempts 2 --no-ingest`,
  `CENTRALGAUGE_BENCH_PRECHECK=0` (both already baked into the script — fully
  local, nothing reached the prod scoreboard).
- Both runs launched via `pwsh -NoProfile -File ./run-xiterate.ps1 ...` in the
  background, sequentially, never overlapping.

### Preflight

- `find results/.bench-running.json -mmin -2` — no output before either run;
  no bench was live.
- `docker inspect <name> --format '{{.State.Running}}'` before the control
  run: `Cronus282: true`, `Cronus283: true`, `Cronus284: false`.
  **`Cronus284` had exited two weeks earlier** (`Exited (3221225786)`) — the
  same class of contamination Phase 1 hit, caught before spending anything
  this time. Ran `docker start Cronus284`, then polled
  `docker inspect --format '{{.State.Health.Status}}'` every 10 s until it
  reported `healthy` (4 checks, ~40 s). Re-verified all three `Running: true`
  immediately before the control run started. **Unlike Phase 1, this
  measurement is not contaminated — all three containers were live for both
  runs, including the harness-publish and test-execution steps.**

### `run-xiterate.ps1` change (prerequisite, committed separately)

`run-xiterate.ps1` had no way to forward `--no-reuse-compiler-folders` to
`deno task start bench` short of hand-editing `$benchArgs`. Added a
`[string[]] $ExtraArgs` parameter, appended to `$benchArgs` only when
supplied — `$benchArgs` stays byte-identical to before when `-ExtraArgs` is
omitted. Commit `1fa1cd6b` (`feat(bench):`), landed before either measured
run.

### Run order — control first, adoption second, and why

The brief's template listed adoption-on before adoption-off, but the two
runs are not independent: adoption reads a marker
(`.centralgauge-marker.json`, written by `writeMarker` at the end of
`rebuildCompilerFolder`) to decide whether the existing folder still matches
the container's current artifact URL. Before running anything, all three
containers already had a compiler folder on disk (built the prior session,
2026-07-25 01:09-01:10) but **no container had a marker file** —
`validateFolder` treats a missing marker as "rebuild," so an adoption-on run
launched first would have silently fallen back to rebuilding all three
folders, producing a false negative (`adopted=0`) caused by marker absence
in this session, not a mechanism failure.

Running the control (`--no-reuse-compiler-folders`) first forces
`rebuildCompilerFolder` unconditionally, which unconditionally writes a
fresh, valid marker as a side effect
(`bc-container-provider.ts:1421-1438`). That guarantees the adoption run
immediately after has a genuine, freshly-written marker to validate against
— a fair test of the mechanism rather than of session history. Verified
directly: before the control run, `.centralgauge-marker.json` was absent for
all three containers; after it, all three existed with `createdAt` timestamps
matching the run (09:28:02Z-09:28:38Z) and `artifactUrl` matching each
container. **No purge ran before or between the two runs** — both are warm
with respect to the artifact cache, satisfying the "warm vs Phase 1's warm
baseline" comparison.

## Raw extraction

```
=== results/trace-noadopt.json  (control, --no-reuse-compiler-folders)
setup.health    Cronus282                    5.674184s
setup.health    Cronus283                    5.230440s
setup.health    Cronus284                    5.596161s
setup.prenuke                                8.153570s
setup.warmup-compiler    adopted=0 rebuilt=3  57.930791s
setup.harness                                26.218174s
root "bench"                                168.448575s

=== results/trace-adopt.json  (adoption ON, default)
setup.health    Cronus282                    8.219040s
setup.health    Cronus283                    5.261033s
setup.health    Cronus284                    5.469686s
setup.prenuke                                6.598241s
setup.warmup-compiler    adopted=3 rebuilt=0  0.373089s
setup.harness                                26.567090s
root "bench"                                 91.546544s
```

Extracted with the brief's own `jq` command; independently re-run and
confirmed byte-for-byte against the numbers above (not taken on trust).

Run logs confirm the mechanism, not just the counters: `run-adopt.log`
lines 99-101 read `Adopted compiler folder for Cronus282 (no rebuild
needed)`, `...Cronus283...`, `...Cronus284...` — one line per container, no
`Rebuilding compiler folder for X: <reason>` lines anywhere in that log.
`run-noadopt.log` shows the opposite: no `Adopted` lines, three
`Creating compiler folder for <name>...` rebuilds.

## Per-phase comparison

| Phase | Control (adoption off) | Adoption on | Delta |
|---|---|---|---|
| `setup.health` (sum, 3 containers) | 16.50 s | 18.95 s | +2.45 s |
| `setup.prenuke` | 8.15 s | 6.60 s | -1.55 s |
| **`setup.warmup-compiler`** | **57.93 s** | **0.37 s** | **-57.56 s** |
| `setup.harness` | 26.22 s | 26.57 s | +0.35 s |
| **setup TOTAL** | **108.80 s** | **52.49 s** | **-56.31 s** |
| Non-setup (LLM + compile + test + rest) | 59.65 s | 39.06 s | -20.59 s |
| **Root `bench` span TOTAL** | **168.45 s** | **91.55 s** | **-76.90 s** |

Setup as a share of the run: control 64.6%, adoption-on 57.3%.
`setup.warmup-compiler` alone: 34.4% of the control run, **0.4% of the
adoption-on run**.

`adopted`/`rebuilt` counters on the span's own `args`, proving the mechanism
engaged rather than the phase merely being fast: control `adopted=0,
rebuilt=3`; adoption-on `adopted=3, rebuilt=0`.

## Against Phase 1's warm baseline (48.96 s)

Quoting both comparisons rather than picking the flattering one:

- **Control vs Phase 1 warm baseline**: 57.93 s vs 48.96 s — **about 18%
  higher** for nominally the same work (a full `New-BcCompilerFolder`
  rebuild, warm artifact cache, 3 containers). This gap is unexplained
  run-to-run variance on n=1 in each direction; not investigated further
  here, and not folded into the verdict below.
- **Adoption-on vs Phase 1 warm baseline**: 0.373 s vs 48.96 s — the phase
  the design targeted for near-elimination is, per this measurement,
  effectively eliminated: three `docker inspect` calls plus marker file
  reads/stats, no pwsh spawn.

## What did NOT change (sanity check)

`setup.harness` (26.22 s -> 26.57 s) and `setup.health` (16.50 s -> 18.95 s,
+2.45 s) are flat to slightly up between the two runs. Adoption should touch
neither phase — it only changes `tryAdoptCompilerFolder`'s decision inside
`setup.warmup-compiler` — and the trace confirms it didn't. The +2.45 s on
`setup.health` and -1.55 s on `setup.prenuke` are the kind of small
per-spawn jitter visible throughout both traces; neither clears a noise
floor worth interpreting.

This is also the **first clean measurement of `setup.harness`**: Phase 1's
30.19 s warm figure was contaminated by `Cronus284` being down (roughly half
of it was a doomed publish attempt against a non-running container). With
all three containers verified live here, `setup.harness` at ~26.2-26.6 s is
now the largest remaining startup phase in a warm run — worth naming as the
next optimization target, per the design's own W6/cold-spawn-tax follow-up.

## The root delta exceeds the setup delta — do not claim the full 76.9 s

76.90 s root-span delta vs 56.31 s setup delta leaves ~20.59 s of non-setup
delta that is not attributable to adoption. Unlike Phase 1 (where non-setup
time was flat, 70.51 s vs 67.60 s, and used as its own control), non-setup
time here is **not** flat: 59.65 s control vs 39.06 s adoption-on.

Diagnosed from the per-run summary tables rather than left as an assumption:

| | Control | Adoption-on |
|---|---|---|
| `llm_time` | 14.7 s | 22.1 s |
| `compile_time` | 44.2 s | 44.2 s |
| `test_time` | 10.1 s | 0 ms |
| Task result | Opus PASS (attempt 2), Sonnet/Haiku FAIL | Opus/Sonnet/Haiku all FAIL (both attempts) |

`compile_time` is identical (44.2 s = 44.2 s — flat, as it should be;
compile workload doesn't depend on adoption). `llm_time` is actually 7.4 s
*higher* on the adoption-on run — ordinary LLM latency variance, working
against the adoption-on run's favor, not for it. The real driver is
`test_time`: the control run's Opus attempt 2 compiled successfully and ran
a full publish+test cycle (10.1 s); the adoption-on run's Opus attempt 2
failed to compile, so it never reached publish or test. Summing the three
named components only accounts for ~2.7 s of the 20.59 s non-setup delta
(control 69.0 s named vs adoption-on 66.3 s named) — the remaining ~18 s is
unaccounted-for orchestration/queue overhead tied to that extra
publish+test cycle (dispatch, prereq handling, results aggregation), not
individually broken out by the trace.

**Conclusion: the non-setup delta is per-task/per-attempt LLM output
stochasticity (a different model happened to pass on a different run of the
same task/model set), the same phenomenon Phase 1 flagged, not an adoption
effect.** The defensible, mechanism-backed claim is the 57.56 s
`setup.warmup-compiler` delta, not the 76.90 s root-span delta.

## n=1 caveat and the noise floor

Phase 1's `timing.log` (249 recorded task attempts) gives per-attempt
totals: min 27.8 s, p50 40.9 s, p90 67.2 s, max 199.4 s.

- **The 57.56 s `setup.warmup-compiler` delta clears the noise floor.** It
  is backed by a mechanism (`adopted=3, rebuilt=0` vs `adopted=0, rebuilt=3`
  on the span's own counters, plus matching log lines), not just a magnitude
  comparison — the same standard Phase 1 used to certify its own 97.21 s
  delta. A single-phase, counter-verified delta of this size, on a
  mechanism directly readable in source (`tryAdoptCompilerFolder` short-
  circuiting before any pwsh spawn), is not the kind of thing per-task LLM
  variance produces.
- **The 76.90 s root-span delta does not clear the noise floor as an
  adoption claim** — per the diagnosis above, ~20.59 s of it is LLM/compile-
  outcome variance, which is exactly the kind of swing the p50-p90 (26.3 s)
  and p50-max (158.5 s) spread says n=1 cannot separate from a favorable
  draw.
- **The +2.45 s `setup.health` delta and the 18% control-vs-Phase-1-baseline
  gap do not clear the noise floor.** Both are within ordinary per-spawn
  jitter and are reported as observations, not evidence of anything.

## Independent verification: adoption did not change scoring outcomes

`compile_time` being byte-identical (44.2 s = 44.2 s, above) is suggestive but
thin — a wall-clock match does not rule out a compiler folder silently
resolving different symbols. Reviewed directly against the raw result files
(`results/benchmark-results-1784971802124.json` = control,
`results/benchmark-results-1784972045576.json` = adoption) and the pinned
BCH 6.1.14 source, not taken on trust:

- **Two of three models produced byte-identical attempt-2 failure signatures
  across both runs.** Haiku: `'Codeunit "CG X035 Worker"' does not contain a
  definition for 'Process'` in both files. Sonnet: `'Codeunit "CG X035
  Worker"' does not contain a definition for 'SetRecord'` in both files. A
  compiler-folder defect (stale or wrong symbols) would not spare two models
  and hit only the third.
- **All six attempt-1 compiles produced identical error strings in both
  runs, including the compiler's candidate list**: `No overload for method
  'Run' takes 1 arguments. Candidates: built-in method 'Run()'`, for Haiku,
  Sonnet, and Opus, in both the control and adoption runs. That candidate
  list is resolved out of `System.app` in the compiler folder's `symbols/`
  — identical enumeration across a rebuilt folder (control) and an adopted
  one (adoption-on) is direct proof the adopted folder supplied the same
  platform symbols as a fresh rebuild would have.
- **Every failure in both runs is an AL semantic error about the model's own
  generated code**, not a symbol-resolution problem. Grepping both
  `results/run-adopt.log` and `results/run-noadopt.log` for
  `system symbols|Unable to locate|symbols folder|dependency` returns zero
  hits in either file.
- **Opus's adoption-run attempt 2 repeated the exact attempt-1 error**
  (`No overload for method 'Run' takes 1 arguments. Candidates: built-in
  method 'Run()'`) — a model that failed to repair its own mistake, not a
  compiler that failed to resolve something on the second pass.
- **Container assignment is not the explanation either, though not for the
  reason a same-container comparison would suggest.** Each attempt's
  `containerName` in the result JSON shows the three containers were used
  unevenly and *differently* between the two runs: control was
  Haiku=Cronus282(x2), Sonnet=Cronus284(x2), Opus=Cronus283(x2);
  adoption-on was Haiku=Cronus284→Cronus282, Opus=Cronus282→Cronus283,
  Sonnet=Cronus283→Cronus284 (attempt 1 -> attempt 2). No model ran on the
  same container for both attempts in the adoption run, and no model's
  container assignment matched between the two runs for attempt 1. That the
  Haiku/Sonnet attempt-2 error strings stayed byte-identical anyway, despite
  neither model staying on a fixed container, is stronger evidence against a
  container-specific confound than a same-container comparison would have
  been — it rules out "one specific container's folder was stale" as an
  explanation, since the identical output survived a container change.

**Mechanism, verified at the BCH source level (pinned 6.1.14,
`CompilerFolderHandling/Compile-AppWithBcCompilerFolder.ps1`), not asserted:**
`$appSymbolsFolder` defaults to `(Join-Path $appProjectFolder ".alpackages")`
(line 79) — the candidate app's own project folder, not the compiler
folder's `symbols/` — and the only place the script ever writes an app file
into `$appSymbolsFolder` is gated behind the `-CopyAppToSymbolsFolder` switch
(line 546-547). Both of CentralGauge's compile call sites
(`buildCompileScript` in `src/container/bc-script-builders.ts:122` for
per-task candidate compiles, and the harness compile in
`bc-container-provider.ts:1517`) pass neither `-appSymbolsFolder` nor
`-CopyAppToSymbolsFolder`. So there is no code path, in this BCH version,
by which compiling one model's candidate app through a shared adopted
compiler folder could write into or otherwise mutate that folder's
`symbols/` — there is no cross-run, cross-model, or cross-container
pollution channel to begin with, independent of which container ran which
attempt.

Separately, the marker itself proves completeness by construction, not just
presence: `rebuildCompilerFolder` only calls `writeMarker` (line 1436) after
successfully parsing a `COMPILER_FOLDER:` line out of the script's own output
via `extractCompilerFolder` (line 1420) — i.e. after `New-BcCompilerFolder`
returned a path at all. A rebuild that failed or was killed before printing
that line leaves no marker, so `validateFolder` on the next run correctly
falls back to "rebuild" rather than adopting a partial folder.

**One claim from the review that did NOT hold up under this verification:**
an earlier pass characterized this as "all six model-runs landed on
Cronus282 in both runs." The `containerName` field per attempt (above)
contradicts that directly — only 2 of 12 attempts (control Haiku's two
attempts) actually ran on Cronus282, and every model used a different
container across the two runs for at least one of its two attempts. This
section states only what the JSON actually shows.

## Verdict

**Adoption delivered.** `setup.warmup-compiler` went from 57.93 s (control,
`rebuilt=3`) to 0.373 s (adoption on, `adopted=3`) — a 57.56 s reduction on
the single phase the design targeted, confirmed by the span's own
`adopted`/`rebuilt` counters and by explicit `Adopted compiler folder for
<container> (no rebuild needed)` log lines for all three containers, with no
`Rebuilding` fallback lines anywhere in that run. Against Phase 1's 48.96 s
warm baseline, adoption-on's 0.373 s is a reduction to essentially zero —
closer to eliminating the full phase than to the ~32 s the design's own
prediction called out as the addressable target (the prediction assumed
adoption would still pay pwsh-spawn + `bcchImport` + artifact-URL-resolution
overhead; the host-side `docker inspect` implementation skips the spawn
entirely, removing that ~15 s tax too — matching the brief's alternative
framing that the saving could be "closer to the full 49 s").

Setup total fell from 108.80 s (64.6% of the control run) to 52.49 s (57.3%
of the adoption-on run). The verdict rests on the mechanism-backed
`setup.warmup-compiler` delta (57.56 s, counters-verified) and explicitly
excludes the larger 76.90 s root-span delta as overstated — ~20.59 s of that
is per-task LLM/compile-outcome variance (Opus passed under control, failed
under adoption-on, on the same task/model set), not something adoption
caused or should be credited for. `setup.health` and `setup.harness` stayed
flat-to-slightly-up as expected, confirming adoption's change is scoped to
exactly the phase it was meant to touch.

## What the design did not anticipate

- **No pre-existing markers going in.** All three containers had a warm
  compiler folder from a prior session but zero markers, because marker
  writing is new in this phase. Without deliberately sequencing control
  before adoption-on, the very first adoption measurement would have
  silently degraded to a rebuild-only result — not a bug, but a trap for
  whoever runs this measurement next without reading this reasoning first.
- **The predicted ~32 s "addressable target" undersold the actual saving.**
  The design's own estimate (~15 s spawn/import/artifact-URL tax + ~32-34 s
  of `New-BcCompilerFolder` proper) assumed adoption would still pay the
  spawn tax. The shipped implementation's host-side `docker inspect` check
  (`dockerInspectSeam` / `tryAdoptCompilerFolder`) avoids spawning pwsh at
  all when adopting, so the realized saving (57.56 s) is close to the full
  measured phase cost, not just the rebuild-internals portion.
- **`setup.harness` is now clearly the next-largest fixed cost** (~26.2-26.6
  s, flat across both conditions, and for the first time measured without
  container-outage contamination) — consistent with Phase 1's cold-spawn-tax
  candidate, now the natural next target once this phase is resolved.

## Cost and outcome (for completeness, not part of the verdict)

Control: 3 models x 2 attempts, $0.0257 total, Opus PASS (attempt 2), Sonnet
and Haiku FAIL. Adoption-on: $0.0269 total, all three models FAIL both
attempts. Combined spend across both runs: $0.0526, entirely local
(`--no-ingest`, `CENTRALGAUGE_BENCH_PRECHECK=0`) — nothing reached the prod
scoreboard.
