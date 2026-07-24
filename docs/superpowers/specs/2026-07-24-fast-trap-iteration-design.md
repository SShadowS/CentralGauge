# Fast trap-task iteration loop

Date: 2026-07-24
Status: design approved, ready for planning

## Problem

Authoring a hard trap-task (`CG-AL-X###`) is an edit → run → read-verdict loop:
edit the task YAML and its AL oracle, then find out whether frontier models
actually fail it. Today the only way to get that verdict is a full `bench` run,
which costs roughly 15 minutes of wall time before any useful signal. At that
cadence the loop is not usable, so tasks ship under-tested.

The goal is a low-single-digit-minute loop for **one task against ~3 models**,
without forking the scoring semantics of the real bench.

## Fixed decisions (from brainstorming)

- The loop runs **real LLM models**, not just reference solutions. The author
  hand-writes the traps; a trap invented by a model is one models already know.
- **Staged escalation is already free.** `orchestrator.ts:894-943` breaks the
  attempt loop on `attempt.success`, so attempt 2 only runs when attempt 1
  failed. No new machinery.
- **Optional sanity lane.** When `scratch/<task>/correct/` exists, run it
  through `scripts/trap-probe.ts` first (no LLM) so an all-models-fail result
  can be told apart from a broken oracle. Silently skipped when absent.
- **No file watcher.** Explicit trigger only — a watcher would fire real API
  calls on half-typed saves.
- `--runs 1` in the loop; run-to-run noise is handled on the final
  confirmation bench.

## Verified findings

Everything below was read out of the code or the installed BCH module, not
inferred. The wall-time split itself has **not** been measured — see
Workstream 6.

### F1. `New-BcCompilerFolder` never reuses a folder

`BcContainerHelper/6.1.14/CompilerFolderHandling/New-BcCompilerFolder.ps1:64-68`:

```powershell
$compilerFolder = Join-Path $bcContainerHelperConfig.hostHelperFolder "compiler\$containerName"
if (Test-Path $compilerFolder) {
    Remove-Item -Path $compilerFolder -Force -Recurse -ErrorAction Ignore
}
```

The folder is deleted and rebuilt on every call, unconditionally. Since
`compilerFolderCache` (`bc-container-provider.ts:302`) is a per-instance field,
it is empty at every process start, so `warmupCompilerFolders` always calls into
BCH again. **Any design that keeps calling `New-BcCompilerFolder` pays folder
rebuild regardless of what else it skips.**

### F2. What `-cacheFolder` actually saves

`Download-Artifacts` is gated at `:83` on `!(Test-Path $symbolsPath)`, and with
`-cacheFolder` that path lives in the cache rather than the doomed folder. So:

- **with** cache: local file copies only (`:241-256`)
- **without** cache (`--no-compiler-cache`): full artifact download + 7-zip
  extraction, per container, serialized through `compilerFolderQueue`

`run-xbench.ps1:54` passes `--no-compiler-cache` across 5 containers. Its help
text (`bench-command.ts:119`) reads "re-downloads artifacts each run"; commit
4a2f8e7 added it as a plain opt-out with no bug workaround attached.

### F3. `clearCompilerCache()` makes the persistent cache self-defeating

`container-setup.ts:50` and `:180` call it unconditionally, and it removes both
the `CentralGauge-*` folders and `COMPILER_CACHE_DIR`
(`C:\ProgramData\BcContainerHelper\compiler-cache`,
`bc-container-provider.ts:297-298`). The "keep folders for cache reuse" branch
in `cleanupCompilerFolders()` is therefore dead letter — the next startup
deletes them anyway.

### F4. Skipping startup prenuke generates false verdicts

Two behaviours combine:

- `cleanupOrphanedPrereqs` matches expected prereqs **by name with the version
  stripped** (`bc-container-provider.ts:1696-1700`), so it preserves them.
- `publishApp`'s fast path skips republish on an exact
  (Name, Publisher, Version) match — stated in the comment at `:1459-1462`.

So editing a prereq's AL source **without bumping `app.json`** leaves the old
binary installed while the candidate compiles against the new package. Startup
prenuke is currently the thing that clears this. Editing prereqs is a routine
part of the authoring loop this feature exists to serve, so the protection must
stay.

### F5. Single-task runs get no matrix

`results-writer.ts:541` gates the comparison matrix on `taskCount > 1`. The
exact shape this loop produces is the one with no matrix.

### F6. `--no-ingest` already skips the precheck

`bench-command.ts:562`: `if (benchPrecheckEnabled && options.ingest !== false)`.
`CENTRALGAUGE_BENCH_PRECHECK=0` is redundant under current code.
`run-xbench.ps1:9-10`'s comment that both are needed predates this gate. Keep
the env var anyway — free, and the comment records a real prod-pollution
incident.

### F7. `-includeTestToolkit` is a dead argument

`bc-container-provider.ts:1170` passes it, but 6.1.14's param block (`:35-42`)
has no such parameter. Confirmed by experiment that a non-advanced PowerShell
function swallows it into `$args`:

```
bound: url=http://x/a/b/c/28.0/w1 name=CG-Cronus28 includeAL=False
args: -includeTestToolkit
```

Harmless, and mildly beneficial — `includeAL=$true` would force
`Download-Artifacts` on every call via the `:83` gate. Test symbols still arrive
via `:157-166`. Delete the argument for honesty; do not "fix" it to `-includeAL`.

## Non-goals

- A file watcher.
- A long-lived daemon. It would preserve compiler paths, warm sessions, and
  pricing caches, but it is a large lifecycle change and should follow
  measurement, not precede it.
- A broad `--warm` flag. Compiler-folder reuse is source-independent and
  validatable against the artifact URL; installed-app reuse is source-dependent
  and validated only by name/version. Putting both behind one bit creates an
  unsafe provenance boundary.

## Design

Six workstreams, numbered by risk-adjusted value. **Execution order is different:
W6 lands first**, because W1-W3 are ranked on code reading alone and W6 is what
turns that into measurement.

### W1. Wrapper edits (no TypeScript change)

New `run-xiterate.ps1`, modelled on `run-xbench.ps1` but:

- **no** `--no-compiler-cache`
- 3 containers, not 5 — one task has at most 3 active model pipelines
- `--no-ingest --no-dashboard --runs 1 --attempts 2`
- `CENTRALGAUGE_BENCH_PRECHECK=0` retained as belt-and-braces (F6)
- takes a single task path as its required argument
- runs the sanity lane first when `scratch/<task>/correct/` exists

Also drop `--no-compiler-cache` from `run-xbench.ps1:54` — it is a
straightforward regression there too.

### W2. Split `clearCompilerCache()`

Stop purging `COMPILER_CACHE_DIR` during ordinary startup. Split into:

- working-folder cleanup (`CentralGauge-*`), retained on the `noCompilerCache`
  path
- an explicit artifact-cache purge for maintenance/debug, reachable from the
  CLI but not run implicitly

Benefits every run including real benches. No new flag.

### W3. Validated cross-process folder adoption

Narrowly named `--reuse-compiler-folders`. Before calling
`New-BcCompilerFolder`, for each container:

1. resolve the container's current artifact URL
2. read a marker file recording artifact URL, BCH version, and a layout version
3. verify the expected compiler/symbol files are present
4. on full match, seed `compilerFolderCache` with the existing path and **skip
   the BCH call entirely**
5. otherwise rebuild and rewrite the marker

This is the only route around F1. The layout-version field exists so a future
change to what we expect inside the folder can invalidate every marker without
relying on the artifact URL changing.

**Prerequisite:** run `Get-Command New-BcCompilerFolder -Syntax` inside the
actual imported session before building on the signature. This machine has 17
BCH copies under `Program Files` and 8 under `Documents`, and `bcchImport()`
validates the module serving `Invoke-ScriptInBcContainer`, not this command.

### W4. Keep both app nukes

`prenukeCentralGaugeApps` and `endOfRunNuke` stay unconditional. Per F4 the
first prevents false verdicts; the second stops a stale candidate blocking the
next ad-hoc publish, which is exactly what the sanity lane does. Both route
through the warm session slot at seconds of cost, and `endOfRunNuke` runs in the
outer `finally` **after** the verdict is already on screen
(`parallel-executor.ts:733-755` then `:845-879`), so it does not delay signal at
all.

### W5. Compact single-task matrix

A terse reporter for `taskCount === 1` (F5): one row per model, columns for
attempt 1 and attempt 2, and the decisive failure line when it fails.

Attempt-level categories rather than bare pass/fail: `PASS`, `COMPILE`, `TEST`,
`EMPTY`, `INFRA`. `EMPTY` is called out separately because "Model returned empty
response" scores as a failed attempt-1 and carries zero trap signal — reading it
as a catch corrupts the whole judgement the loop exists to support.

### W6. Instrument startup

Trace spans around: task loading/hashing, model validation, pricing init, each
health check, prenuke, per-container compiler warmup, harness check, end nuke.

No one has measured the startup split; W1-W3 are ranked on code reading alone,
which is why this workstream is executed before them. `timing.log` (1562 lines) covers the per-task pipeline —
compile 17-21 s, tests 6-24 s, totals 34-48 s, with `Prereq resolution` swinging
0.0 s → ~20 s and `Publish prereqs` 0 → 15 s across the file — but has no
startup spans at all.

Open question W6 must answer: `ensureTestHarness` costs one cold
`executePowerShell` spawn per container even on the `HARNESS_PRESENT` path. One
reviewer ranked this a notable residual; the other did not rank it. Measure
before deciding whether it needs work.

## Change surface

| File | Change |
|---|---|
| `run-xiterate.ps1` | new (W1) |
| `run-xbench.ps1` | drop `--no-compiler-cache` (W1) |
| `cli/types/cli-types.ts` | `reuseCompilerFolders?: boolean` on `ExtendedBenchmarkOptions` (W3) |
| `cli/commands/bench-command.ts` | new option; copy into `benchOptions` (W3) |
| `cli/commands/bench/parallel-executor.ts` | thread through `setupOpts` at `:270` (W3) |
| `cli/commands/bench/container-setup.ts` | gate folder clearing; keep both nukes (W2, W4) |
| `src/container/bc-container-provider.ts` | split `clearCompilerCache`; marker read/write; drop `-includeTestToolkit` (W2, W3, F7) |
| `cli/commands/bench/results-writer.ts` | single-task matrix (W5) |

Threading a new option through **four** files, not three: the `ExtendedBenchmarkOptions`
hop is easy to miss and the option silently does nothing without it.

## Risks

| Risk | Mitigation |
|---|---|
| Adopted folder is stale after a BC artifact change | Marker carries artifact URL + BCH version + layout version; any mismatch rebuilds |
| Sanity lane and bench are separate processes, each rebuilding the folder | W3 makes adoption cross-process, which is what removes the double cost |
| Single-container loop has no infra-retry reroute target | Loop uses 3 containers; accept exit-and-rerun on infra failure |
| Harness edited without bumping `HARNESS_APP_VERSION` | Pre-existing (`ensureTestHarness` checks name+version only); unchanged here, noted so W3 is not blamed for it |

## Testing

- Unit: marker validation — match, artifact-URL mismatch, BCH-version mismatch,
  layout-version mismatch, missing files. Each must produce the right
  adopt-or-rebuild decision.
- Unit: option threading through all four hops, both single- and
  multi-container setup paths.
- Unit: matrix reporter against fixture results covering each of `PASS`,
  `COMPILE`, `TEST`, `EMPTY`, `INFRA`.
- Manual: cold run then warm run on Cronus28, comparing W6 spans. This is the
  acceptance test — the feature is justified by that delta or not at all.

Container-touching tests must not run while a bench is live
(`guard-bench-lock.sh`); use `--ignore=tests/unit/container`.

## Open questions

1. Actual startup split — resolved by W6, gates W3's priority.
2. Whether `ensureTestHarness`'s per-container cold spawn is worth optimising.
3. Whether 3 containers is right, or 2 is enough once startup is cheap.
