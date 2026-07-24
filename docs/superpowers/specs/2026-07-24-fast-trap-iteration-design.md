# Fast trap-task iteration loop

Date: 2026-07-24
Status: design revised after three-model panel review, ready for planning

## Problem

Authoring a hard trap-task (`CG-AL-X###`) is an edit → run → read-verdict loop:
edit the task YAML and its AL oracle, then find out whether frontier models
actually fail it. Today the only way to get that verdict is a full `bench` run,
which costs roughly 15 minutes of wall time before any useful signal. At that
cadence the loop is not usable, so tasks ship under-tested.

The goal is a low-single-digit-minute loop for **one task against ~3 models**,
without forking the scoring semantics of the real bench.

**This goal is a target, not an established result.** See "Binding-constraint
hypothesis" below — measurement (W6) decides whether it is reachable at all.

## Fixed decisions (from brainstorming)

- The loop runs **real LLM models**, not just reference solutions. The author
  hand-writes the traps; a trap invented by a model is one models already know.
- **Staged escalation is already free.** `orchestrator.ts:894-943` breaks the
  attempt loop on `attempt.success`, so attempt 2 only runs when attempt 1
  failed. No new machinery.
- **Optional sanity lane.** When a known-good reference solution exists, run it
  through `scripts/trap-probe.ts` first (no LLM) so an all-models-fail result
  can be told apart from a broken oracle. Silently skipped when absent. See
  "Sanity lane" for isolation requirements — a naive placement of this lane
  manufactures false failures.
- **No file watcher.** Explicit trigger only — a watcher would fire real API
  calls on half-typed saves.
- `--runs 1` in the loop; run-to-run noise is handled on the final
  confirmation bench.

## Verified findings

Read out of the code or the installed BCH module. Each was independently
re-verified by three reviewers; line numbers may drift by ~20 lines against a
moving file but the substance held. The wall-time split itself is **not**
measured — see W6.

### F1. `New-BcCompilerFolder` never reuses a folder

`BcContainerHelper/6.1.14/CompilerFolderHandling/New-BcCompilerFolder.ps1:64-68`:

```powershell
$compilerFolder = Join-Path $bcContainerHelperConfig.hostHelperFolder "compiler\$containerName"
if (Test-Path $compilerFolder) {
    Remove-Item -Path $compilerFolder -Force -Recurse -ErrorAction Ignore
}
```

Deleted and rebuilt on every call, unconditionally. `compilerFolderCache`
(`bc-container-provider.ts:302`) is a per-instance field, empty at every process
start, so `warmupCompilerFolders` always calls into BCH again. **Any design that
keeps calling `New-BcCompilerFolder` pays folder rebuild regardless of what else
it skips.**

### F2. What `-cacheFolder` actually saves

`Download-Artifacts` is gated at `:83` on `!(Test-Path $symbolsPath)`, and with
`-cacheFolder` that path lives in the cache rather than the doomed folder. So:

- **with** cache: local work only — DLL/symbol/compiler copies (`:241-256`) plus
  a `GetAppInfo` enumeration over every `.app` in symbols (`:313-318`). Local,
  but not free.
- **without** cache (`--no-compiler-cache`): VSIX expansion plus the full
  symbol/compiler/DLL copy set, per container, serialized through
  `compilerFolderQueue`. **Not** a repeated network download: `Download-Artifacts`
  has its own version-keyed cache at `bcartifactsCacheFolder`
  (`C:\bcartifacts.cache`), gated by its own `Test-Path` check, and
  `New-BcCompilerFolder` never passes `-force`. The network fetch happens once
  per artifact version, not once per container per run — substantial, but
  smaller than the "full re-download every run" framing below implies.

`run-xbench.ps1:54` passes `--no-compiler-cache` across 5 containers. Its help
text (`bench-command.ts:119`) reads "re-downloads artifacts each run".

**Verified:** commit `4a2f8e7` created the persistent compiler cache and the
`--no-compiler-cache` opt-out in the same commit, so the flag cannot be a
workaround for corruption of a cache that did not previously exist.
`scripts/bench.ps1:44` and `scripts/benchsmall.ps1:44` document the flag's
rationale as baseline comparability, not corruption avoidance.

### F3. `clearCompilerCache()` makes the persistent cache self-defeating

`container-setup.ts:50` and `:180` call it unconditionally, and it removes both
the `CentralGauge-*` folders and `COMPILER_CACHE_DIR`
(`C:\ProgramData\BcContainerHelper\compiler-cache`,
`bc-container-provider.ts:297-298`). The "keep folders for cache reuse" branch
in `cleanupCompilerFolders()` is dead letter **across processes** — the next
startup deletes them. Within a single process, after the one clear, the cache
still helps across containers.

### F4. Skipping startup prenuke generates false verdicts

Two behaviours combine:

- `cleanupOrphanedPrereqs` matches expected prereqs **by name with the version
  stripped** (`bc-container-provider.ts:1696-1700`), so it preserves them.
- `publishApp`'s fast path skips republish on an exact
  (Name, Publisher, Version) match — stated in the comment at `:1459-1462`.

Editing a prereq's AL source **without bumping `app.json`** therefore leaves the
old binary installed while the candidate compiles against the new package.
Startup prenuke currently clears this. Editing prereqs is routine in the
authoring loop this feature serves, so the protection stays.

*Not verified:* the exact comparison inside `buildPrereqCleanupScript()`. What
is verified is that the provider passes names only.

### F5. Single-task runs get no matrix

`results-writer.ts:541` gates the comparison matrix on `taskCount > 1` — and
that check sits inside `if (outputFormat === "verbose")` at `:537`. So the
matrix is **verbose-format-only and multi-task-only**. W5 must address both
dimensions, not just the task count.

### F6. `--no-ingest` alone already skips the precheck

`bench-command.ts:562`: `if (benchPrecheckEnabled && options.ingest !== false)`.

Scoped claim: `CENTRALGAUGE_BENCH_PRECHECK=0` is redundant **when `--no-ingest`
is passed**, which is the only case this wrapper exercises. It is *not*
redundant in general — running with ingest enabled but the precheck off requires
it. `run-xbench.ps1:9-10`'s comment that both are always needed predates the
gate. Keep the env var in the wrapper anyway: free, and the comment records a
real prod-pollution incident.

### F7. `-includeTestToolkit` is a dead argument

`bc-container-provider.ts:1170` passes it, but 6.1.14's param block (`:35-42`)
has no such parameter, and the function has no `[CmdletBinding()]`. Confirmed by
experiment that a non-advanced PowerShell function swallows it into `$args`:

```
bound: url=http://x/a/b/c/28.0/w1 name=CG-Cronus28 includeAL=False
args: -includeTestToolkit
```

Harmless, and mildly beneficial — `includeAL=$true` would force
`Download-Artifacts` on every call via the `:83` gate. Test symbols still arrive
via `:157-166`. Delete the argument for honesty; **do not "fix" it to
`-includeAL`.**

## Binding-constraint hypothesis

The spec previously ranked startup cost as dominant on the strength of code
reading. That ranking is now stated as a hypothesis for W6 to test, because the
measured evidence available contradicts a startup-only story.

`timing.log` (249 recorded task attempts, per-phase):

```
TOTAL:  min 27.8s   p50 40.9s   p90 67.2s   max 199.4s
Prereq resolution max 86.0s    Compile project max 96.6s
Publish prereqs   max 61.9s    Run tests       max 125.6s
```

An earlier draft of this spec summarised the same file as "totals 34-48 s" by
reading its head and tail rather than its distribution. That was wrong. **A
single attempt on an outlier task already costs low-single-digit minutes before
any LLM call**, which means the goal is unreachable for such tasks regardless of
what happens to startup.

Candidate constraints, to be ranked by measurement rather than argument:

1. **Per-task variance** — p90 67 s, max 199 s per attempt, ×3 models, ×up to 2
   attempts.
2. **LLM latency** — frontier reasoning models on a hard AL task; attempt 2 runs
   serially after attempt 1 fails, which on a *successful* trap is the common
   case.
3. **Cold-spawn tax** — "~15 s bccontainerhelper module-load tax" per cold
   `executePowerShell` spawn (`bc-container-provider.ts:317`), paid by health
   check, artifact-URL resolution, and `ensureTestHarness`'s presence probe, per
   container. Roughly 45 s across three containers, every run, even when
   everything is already warm.
4. **Compiler folder rebuild** — F1/F2/F3, the original hypothesis.

Note on a figure that does *not* apply: comments at `:1513` and `:1600` price a
"~120 s" BCH bridge setup. That is the Windows-PowerShell sub-session fork from
the `usePwshForBc24=$false` path, which CLAUDE.md records as disabled by default
("~120 s vs ~5 s without"). Do not budget for it.

## Non-goals

- A file watcher.
- A long-lived daemon. It would preserve compiler paths, warm sessions, and
  pricing caches — and is the only approach that removes constraint 3 entirely —
  but it is a large lifecycle change and must follow measurement, not precede
  it. If W6 shows the cold-spawn tax dominates, revisit this.
- A broad `--warm` flag. Compiler-folder reuse is source-independent and
  validatable against the artifact URL; installed-app reuse is source-dependent
  and validated only by name/version. One bit for both is an unsafe provenance
  boundary.

## Design constraint (not a workstream)

**Both app nukes stay unconditional.** `prenukeCentralGaugeApps` prevents F4's
false verdicts; `endOfRunNuke` stops a stale candidate blocking the next ad-hoc
publish, which is what the sanity lane does. Both route through the warm session
slot at seconds of cost, and `endOfRunNuke` runs in the outer `finally` **after**
the verdict is on screen (`parallel-executor.ts:733-755` then `:845-879`).

Caveat: it does not delay the printed verdict, but it does delay process exit,
so it is part of the practical edit-run-edit cadence if the author waits for the
prompt to return.

## Sanity lane

`scripts/trap-probe.ts` already implements this; do not reimplement it.

**Isolation requirement.** `endOfRunNuke` unpublishes apps; it does **not** roll
back data. The `extract-trap-task` skill documents that a `Commit()` in a trap
oracle defeats the runner's rollback, and that a later candidate then "hits a PK
collision at its `[GIVEN]` seed and is scored a FALSE FAILURE (not a recognized
infra signature → no auto-reroute)". Running the lane on a container the model
bench then uses would manufacture exactly the false failures this loop exists to
detect.

Therefore: **the lane runs on Cronus28; the model bench runs on the other three
containers.** This also resolves the fact that `trap-probe.ts` is
Cronus28-credential-bound (other containers 401) while the bench wants three.

**Identifier mapping.** The wrapper takes a task YAML path. `trap-probe.ts`
takes `--task <id>` and `--solution <dir>`. The wrapper derives the id from the
YAML's `id:` field, and looks for the reference solution at
`scratch/<id>/correct/` — id, not filename basename, not slug.

**Status.** Preflight only. `trap-probe` reaches the container through
`handleAlVerifyTask`, a different entrypoint from the bench's orchestrator, so
its result is not score-parity with a bench verdict and must not be reported as
one.

## Design

Five workstreams, numbered by risk-adjusted value. **Execution order differs:
W6 lands first**, because W1-W3 are ranked on code reading and W6 is what turns
that into measurement.

W4 is deliberately absent: it carried no code change and has become the "Design
constraint" section above. The remaining numbers are left as-is so review
comments referring to W5/W6 stay valid.

### W1. Wrapper edits (no TypeScript change)

New `run-xiterate.ps1`, modelled on `run-xbench.ps1` but:

- **no** `--no-compiler-cache` — gated on confirming F2's unverified commit note
- `--reuse-compiler-folders` **passed explicitly** (W3's flag is opt-in and
  defaults off; without this W3 does nothing for the fast loop)
- bench on 3 containers; sanity lane on Cronus28 (see "Sanity lane")
- container names are a parameter with a documented default, not hardcoded
- `--no-ingest --no-dashboard --runs 1 --attempts 2`
- `CENTRALGAUGE_BENCH_PRECHECK=0` retained as belt-and-braces (F6)
- takes a single task YAML path as its required argument

Also drop `--no-compiler-cache` from `run-xbench.ps1:54`, same gating.

### W2. Split `clearCompilerCache()`

Stop purging `COMPILER_CACHE_DIR` during ordinary startup. Split into:

- **working-folder cleanup** (`CentralGauge-*`) — runs **only** when
  `noCompilerCache` is set. **Ordinary startup with the cache enabled preserves
  the `CentralGauge-*` folders.** This is the load-bearing sentence: if ordinary
  startup still cleared them, W3 would find nothing to adopt and the headline
  optimization would be a silent no-op.
- **explicit artifact-cache purge** for maintenance/debug, exposed as a CLI
  entry point and never run implicitly.

Benefits every run including real benches. No new flag for this part.

### W3. Validated cross-process folder adoption

Opt-in flag `--reuse-compiler-folders`. Before calling `New-BcCompilerFolder`,
per container:

1. resolve the container's current artifact URL
2. read a marker recording artifact URL, BCH version, and a layout version
3. verify the expected files are present — **enumerate them concretely**:
   compiler binaries under `compiler/extension/bin`, `symbols/*.app`,
   `symbols/cache_AppInfo.json`, `manifest.json`, `dlls/`, `dlls/Test Assemblies`
4. on full match, seed `compilerFolderCache` and **skip the BCH call entirely**
5. otherwise rebuild and rewrite the marker

The layout version lets a future change to expected folder contents invalidate
every marker without waiting for an artifact URL change.

**Cross-process safety.** `compilerFolderQueue` serializes only within one
process, and this design deliberately runs `trap-probe` and `bench` as separate
processes. Required: a cross-process lock on the compiler folder, and marker
writes via temp-file-then-rename so a torn marker can never validate.

**Retention.** Every compile creates `${compilerFolder}\output\${name}_${uuid8}`
(`bc-container-provider.ts:1359-1367`). Today BCH's unconditional folder delete
garbage-collects these incidentally. Adoption preserves the folder, so W3 must
add explicit bounded retention or the directory grows one entry per compile,
forever.

**Prerequisite:** run `Get-Command New-BcCompilerFolder -Syntax` inside the
actual imported session before building on the signature. This machine has 17
BCH copies under `Program Files` and 8 under `Documents`, and `bcchImport()`
validates the module serving `Invoke-ScriptInBcContainer`
(`src/container/bcch-config.ts`), not this command. Prefer encoding this as a
startup assertion or test rather than an operator instruction.

### W5. Compact single-task matrix

Not on the critical path for speed; must not block W1-W3 or W6.

A terse reporter for `taskCount === 1`. Per F5 it must handle the **format**
dimension — the existing matrix only renders under `outputFormat === "verbose"`,
so the spec's intent is that the compact matrix renders for the wrapper's chosen
format regardless.

Attempt-level categories: `PASS`, `COMPILE`, `TEST`, `EMPTY`, `INFRA`.

- `EMPTY` matters because "Model returned empty response" scores as a failed
  attempt-1 and carries zero trap signal; reading it as a catch corrupts the
  judgement the loop exists to support.
- **It has no structured representation today** — it is a bare string at
  `llm-work-pool.ts:278` (`result.error = "Model returned empty response"`).
  W5 must add a structured field rather than string-matching.
- **Define precedence** for attempts carrying multiple signals: compile success
  with zero tests (infra per GH #13), empty response on attempt 1 followed by a
  compile failure on attempt 2, and infra-retry-recovered attempts.

### W6. Instrument startup and full wall time

Trace spans around: task loading/hashing, model validation, pricing init, each
health check, prenuke, per-container compiler warmup, harness presence probe,
artifact-URL resolution, end nuke.

Not startup alone — **correlate full wall time by phase for the one-task /
three-model case**, including LLM latency, attempt-2 rate, per-container
publish/test outliers, and cleanup-after-verdict. The hypothesis under test is
the four-way ranking above; the deliverable is which constraint actually binds.

Note that W3 step 1 resolves an artifact URL per container, which may itself be
a BCH PowerShell spawn — measure it, or W3 risks replacing one expensive BCH
call with another.

## Change surface

| File | Change |
|---|---|
| `run-xiterate.ps1` | new (W1) |
| `run-xbench.ps1` | drop `--no-compiler-cache` (W1) |
| `cli/types/cli-types.ts` | `reuseCompilerFolders?: boolean` on `ExtendedBenchmarkOptions` (W3) |
| `cli/commands/bench/types.ts` | re-export hop — `parallel-executor.ts:44` imports the type from here, not from `cli-types.ts` (W3) |
| `cli/commands/bench-command.ts` | new option + help text; copy into `benchOptions`; CLI entry for the explicit cache purge (W2, W3) |
| `cli/commands/bench/parallel-executor.ts` | thread through `setupOpts` at `:270`; tracing spans (W3, W6) |
| `cli/commands/bench/container-setup.ts` | gate folder clearing; extend setup options type for W3; tracing spans (W2, W3, W6) |
| `src/container/bc-container-provider.ts` | split `clearCompilerCache`; marker read/write + cross-process lock; `output/` retention; drop `-includeTestToolkit`; tracing spans (W2, W3, W6, F7) |
| `cli/commands/bench/results-writer.ts` | single-task matrix across formats (W5) |
| `src/parallel/llm-work-pool.ts` | structured empty-response field (W5) |

The option threads through **four** hops, not three: `cli-types.ts` →
`bench/types.ts` re-export → `bench-command.ts` → `parallel-executor.ts` →
`container-setup.ts`. Missing the re-export hop makes the option silently inert.

## Risks

| Risk | Mitigation |
|---|---|
| Adopted folder stale after a BC artifact change | Marker carries artifact URL + BCH version + layout version; any mismatch rebuilds |
| **Permanent cache poisoning** — BCH's population gate is `!(Test-Path $symbolsPath)`, so a run killed mid-population leaves an incomplete `symbols/` that every later run silently builds from. Today's unconditional purge accidentally self-heals this; W2 removes that | Marker must cover the shared cache, not only the compiler folder; explicit purge command as the escape hatch; test the interrupted-population case |
| **Cache staleness after a BC artifact upgrade** (the staleness half of "permanent cache poisoning" above) — **closed for Phase 1**: Task 6b keys the shared `-cacheFolder` by (query-string-stripped) artifact URL, so an upgrade lands in a fresh keyed directory and BCH repopulates it normally instead of silently compiling against the previous version's frozen symbols. The mid-population-corruption half above is unaffected | Closed by Task 6b; `purgeArtifactCache` now enumerates and removes every `compiler-cache*` directory (legacy unkeyed + all keyed) as the manual escape hatch |
| **Cross-process race** on first cache population or folder adoption | Cross-process lock + temp-then-rename marker writes (W3) |
| **`output/` accumulation** under adoption | Bounded retention in W3 |
| **Unbounded artifact-cache growth** once implicit purge is removed | Size/age cap, or documented manual purge cadence |
| **Sanity-lane data pollution** — a `Commit()`ing oracle leaves rows that collide with the next run's `[GIVEN]` seed and score as false failures | Lane runs on Cronus28, bench on the other three (see "Sanity lane") |
| Sanity lane and bench are separate processes, each rebuilding the folder | W3's adoption is cross-process, which is what removes the double cost |
| Single-container loop has no infra-retry reroute target | Bench uses 3 containers; accept exit-and-rerun on infra failure |
| Harness edited without bumping `HARNESS_APP_VERSION` | Pre-existing (`ensureTestHarness` checks name+version only); unchanged here, noted so W3 is not blamed for it |
| `trap-probe` and bench reach the container by different entrypoints | Lane is preflight, not a verdict; do not report it as score parity |

## Testing

Unit:

- Marker validation — match, artifact-URL mismatch, BCH-version mismatch,
  layout-version mismatch, missing files, torn/partial marker. Each must produce
  the right adopt-or-rebuild decision.
- Option threading across all four hops, both single- and multi-container setup.
- Matrix reporter against fixtures covering `PASS`, `COMPILE`, `TEST`, `EMPTY`,
  `INFRA`, plus each defined precedence case.

Integration / manual:

- Cold run then warm run on the bench containers, comparing W6 spans. **This is
  the acceptance test** — the feature is justified by that delta or not at all.
- End-to-end `run-xiterate.ps1`, cold and warm, proving wall time without
  dropping verdicts.
- Sanity lane then bench back-to-back with `scratch/<id>/correct/`, proving the
  second process adopts rather than rebuilds, and that the lane's container
  isolation holds.
- Two processes racing the same container's compiler folder.
- Crash during folder build: no marker, partial marker, marker with files
  missing.
- Prereq edited without a version bump: startup prenuke must still catch it, and
  no reuse path may reintroduce the F4 stale-prereq false verdict.
- `--reuse-compiler-folders` demonstrably affects both single- and
  multi-container paths and is actually passed by `run-xiterate.ps1`.

Container-touching tests must not run while a bench is live
(`guard-bench-lock.sh`); use `--ignore=tests/unit/container`.

## Open questions

1. Which constraint actually binds — resolved by W6, gates W3's priority and
   whether the daemon non-goal needs revisiting.
2. Whether `ensureTestHarness`'s per-container cold spawn should move to the
   warm session slot.
3. Whether 3 bench containers is right, or 2 suffices once startup is cheap.
4. Whether the F2 commit note holds, gating W1's removal of
   `--no-compiler-cache`.
