# Follow-ups

Known issues and deferred work, with the evidence behind each. Recorded here
rather than in an issue tracker so the reasoning travels with the code.

Each entry states what the problem is, why it was not fixed at the time, and
what would resolve it. Entries are removed when fixed, not marked done.

---

## 1. `setup.harness` costs ~26.5 s per bench run doing three serial presence probes

**Where:** `src/container/bc-container-provider.ts:1479` (`ensureTestHarness`)

`setup.harness` is now the largest remaining startup phase at 26.2-26.6 s,
measured across both Phase 2 measurement runs. In steady state the entire phase
is **three presence probes and nothing else** — both runs logged
`Test harness already published` for all three containers. That is ~8.8 s per
container to answer "is this app installed?".

Two independent causes:

1. **A cold spawn per container.** Each loop iteration runs a fresh
   `executePowerShell`: `pwsh -NoProfile` + `bcchImport()` + one
   `Get-BcContainerAppInfo`. Roughly 5 s of the 8.8 s is spawn plus module
   load, priced from `setup.health`'s steady-state 5.2-5.7 s, which has the
   identical shape. Routing the probe through the warm session slot
   (`runScriptThroughSession`) would avoid it.
2. **The loop is serial.** Nothing about a read-only presence check requires
   serializing across containers.

Combined, 26.5 s could plausibly become ~4 s.

This answers open question #2 in
`docs/superpowers/specs/2026-07-24-fast-trap-iteration-design.md`. That question
was previously unanswerable because Phase 1's `setup.harness` figure was
contaminated — `Cronus284` was stopped while `Test-BcContainer` reported it
healthy, so roughly half that measurement was a doomed publish. Phase 2 fixed
the health check and verified all three containers `Running: true` before both
runs, making this the first clean measurement.

**Caveat:** only the steady-state path is this cheap to fix. The publish path
underneath compiles and publishes an app and is legitimately expensive, but it
only runs when the harness is absent or its version changed.

---

## 2. `models --check` accepts a model alias that bench's `validateModels()` rejects

**Where:** `cli/commands/bench/parallel-executor.ts:1285` vs the `models --check` path

`anthropic/claude-haiku-4-5` passes `deno task start models <slug> --check` but
is rejected by bench, which only accepts the dated
`anthropic/claude-haiku-4-5-20251001`.

They diverge because `--check` verifies callability with a raw provider API
call, which resolves the alias, while `validateModels()` goes through
`LLMAdapterRegistry.validateModelAsync` — for Anthropic that checks the live
`/v1/models` discovery list, which omits the bare alias. The catalog carries
both slugs as separate entries, so neither side is obviously wrong.

**Impact:** this shipped a broken default. `run-xiterate.ps1`'s `-Models`
default used the bare alias, so running it with no arguments failed fast with
`ModelValidationError`. Fixed in `e5fd38c0` by using the dated slug in both
wrappers; the underlying inconsistency remains. The practical consequence is
that `--check` passing is not sufficient evidence a bench run will start.

**Resolution:** either make `--check` use the same validator bench does, or have
`validateModels()` fall back to the catalog when discovery omits a slug the
catalog knows about.

---

## 3. `clearCompilerFolders`' GUID sweep can delete a concurrent `trap-probe`'s live folder

**Where:** `src/container/bc-container-provider.ts` (`clearCompilerFolders`)

The sweep was widened to remove GUID-named compiler folders as well as
`CentralGauge-*` ones, because adoption preserves folders that BCH's
unconditional delete used to garbage-collect incidentally (37 orphans were
already on disk). It is not cross-process-safe: a bench starting with
`--no-compiler-cache` deletes every GUID-shaped folder under
`COMPILER_FOLDER_DIR`, including one a concurrently-running `trap-probe` is
compiling into.

This matters here specifically because `trap-probe` and `bench` are deliberately
separate processes — the trap-authoring loop runs the sanity lane and the model
bench in parallel by design. Under `--no-compiler-cache` no `-containerName` is
passed, so BCH names the folder `[GUID]::NewGuid()`
(`New-BcCompilerFolder.ps1:60-62`), exactly the shape the sweep targets.

**Severity:** low, and pre-existing in kind — `CentralGauge-*` folders were
already swept the same way. It only fires on the `--no-compiler-cache`
diagnostic path, which is no longer the default.

**Resolution:** take the cross-process lock (`src/container/folder-lock.ts`)
before sweeping, or skip folders whose mtime suggests an active build.

---

## 4. `validateFolder`'s expected-file list under-covers what the compiler reads

**Where:** `src/container/compiler-folder-marker.ts` (`validateFolder`)

Checked: `compiler/extension/bin` (as a directory), `symbols/` with at least one
`.app`, `symbols/cache_AppInfo.json`, `manifest.json`, `dlls/`,
`dlls/Test Assemblies`.

Read by `Compile-AppWithBcCompilerFolder.ps1` but **not** checked:
`dlls/Service`, `dlls/Mock Assemblies`, `dlls/OpenXML`, and `alc.exe` inside
`compiler/extension/bin[/win32]` — the directory is checked for existence, not
for containing the compiler.

**Why this is currently acceptable**, recorded as a deliberate judgement rather
than an oversight: a stronger invariant already covers it. The marker is only
written after `extractCompilerFolder` parses `COMPILER_FOLDER:` out of the
script output, which BCH emits only after `New-BcCompilerFolder` returns. Marker
presence therefore proves the folder was built to completion *by this code*, for
the recorded artifact URL, under the pinned BCH version. The file list is a
second line of defence against post-build damage, not the primary guarantee.
`symbols/cache_AppInfo.json` is also literally the last file BCH writes
(`New-BcCompilerFolder.ps1:315-318`), making it a genuine completion sentinel.

**When to revisit:** if an adoption failure is ever traced to a partially
damaged folder that passed validation. `LAYOUT_VERSION` in the same module is
the escape hatch — bumping it invalidates every marker on every machine at once,
so the list can be widened without waiting for artifact URLs to change.

---

## 5. `infra-invalidation` still string-matches `"Infra error:"` — the fallback must stay

**Where:** `src/health/infra-invalidation.ts` (`isInfraInvalidatedAttempt`)

The function answers "is this attempt an infra failure?" two ways: the
structural `attempt.infraSynthesized` flag first, then a fallback matching
`failureReasons[0].startsWith("Infra error:")`.

The fallback is **correct and must not be removed**, but nothing in the code
says why — the reasoning currently lives only here.

`infraSynthesized` was introduced in `a133e6e7`. Benchmark result files written
before that commit carry no such flag, and `centralgauge ingest <results-file>`
replays saved runs. Deleting the string fallback would silently reclassify every
historical infra failure in those files as a genuine model failure — and this
function gates **scoring exclusion and leaderboard payloads**, so the blast
radius is published numbers, not a display detail.

**Resolution:** add a comment at the fallback explaining the replay constraint,
so a future tidy-up that sees "structural flag exists, string match is
redundant" has the counter-argument in front of it.

**Related:** the same concept is answered structurally in `categorizeAttempt`
(`cli/commands/bench/single-task-matrix.ts`). The two agree only because
`synthesizeInfraFailureResult` writes both the `Infra error:` prefix and the
flag; that coupling is also undocumented.
