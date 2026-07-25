# Compiler-folder adoption and single-task reporting (Phase 2)

Date: 2026-07-25
Status: design approved, ready for planning
Supersedes: W3 and W5 of `docs/superpowers/specs/2026-07-24-fast-trap-iteration-design.md`

## Problem

Phase 1 stopped the bench destroying its own compiler cache and instrumented
the startup path. The resulting measurement
(`docs/superpowers/plans/2026-07-24-fast-trap-iteration-measurements.md`) found
that startup is **61.9% of a warm run**, and that `setup.warmup-compiler` is
its largest phase at **48.96 s** even when everything is already cached.

That residual exists because `New-BcCompilerFolder` deletes and rebuilds the
folder on every call regardless of cache state
(`New-BcCompilerFolder.ps1:64-68`, unconditional `Remove-Item -Recurse` then
`New-Item`). A warm artifact cache only makes the refill local; it does not
avoid the refill.

Phase 2 removes that work when the existing folder is provably good, and makes
a single-task run readable enough to act on.

## The finding that changes the original W3 design

The Phase 1 spec gated W3 on resolving each container's artifact URL, and
warned the step "may itself be a BCH PowerShell spawn — measure it, or W3 risks
replacing one expensive BCH call with another."

It does not have to be. `Get-BcContainerArtifactUrl` is, in its entirety
(`BcContainerHelper/6.1.14/ContainerInfo/Get-NavContainerArtifactUrl.ps1:19-23`):

```powershell
$inspect = docker inspect $containerName | ConvertFrom-Json
$artifactUrlEnv = $inspect.config.Env | Where-Object { $_ -like "artifactUrl=*" }
if ($artifactUrlEnv) { return $artifactUrlEnv.SubString("artifactUrl=".Length) }
```

So `docker inspect` reads the **same source, giving the same value** — it is an
exact substitute, not an approximation. Measured on this machine: **0.36 s**,
against roughly 5 s for a cold `pwsh -NoProfile` plus `bcchImport()`. It also
works on stopped containers.

This moves the entire adopt-or-rebuild decision host-side, which in turn means
adoption can skip the pwsh spawn **entirely** rather than only skipping
`New-BcCompilerFolder`'s work — approximately 49 s per run rather than 34 s.

## Decisions

- **Adoption is on by default**, with `--no-reuse-compiler-folders` as the
  escape hatch. The spec made it opt-in because marker validation was unproven;
  validation is now exact on the dimension that matters, and every failure mode
  falls back to the existing rebuild path rather than failing the run. Cliffy
  footgun: the `--no-` option must not declare `{ default: false }`.
- **The cache-key hash moves to TypeScript.** With `artifactUrl` known
  host-side, `-cacheFolder` is passed to PowerShell as a literal string. The
  PowerShell hash block added by Phase 1's Task 6b is deleted, not duplicated.
  This also resolves a finding parked in Phase 1: no test guarded that
  derivation, and the suggested golden-text guard is no longer needed because
  the hash becomes ordinary unit-testable TypeScript.
- **Scope is W3 + W5.** They are independent; W5 does not gate W3.

## W3. Host-side compiler-folder adoption

### Flow, per container

```
docker inspect <container>          artifactUrl + .State.Running   (~0.36 s)
  cacheKey  = sha256(artifactUrl minus query string).hex[0..12]    (TypeScript)
  folder    = <COMPILER_FOLDER_DIR>\CentralGauge-<container>
  marker    = <folder>\.centralgauge-marker.json

  validate marker fields, then stat expected files
    all pass  -> prune output/, seed compilerFolderCache, return   NO PWSH
    any fail  -> rebuild through the existing script, write marker
```

### Marker

```jsonc
{
  "layoutVersion": 1,          // bump to invalidate every marker at once
  "artifactUrl": "https://.../sandbox/28.3.52162.52884/dk",
  "cacheKey": "036dceedc9cc",
  "bchVersion": "6.1.14",
  "containerName": "Cronus282",
  "createdAt": "2026-07-25T00:00:00.000Z"
}
```

Adoption requires all of: `layoutVersion === LAYOUT_VERSION`, `artifactUrl`
equal to the freshly-inspected value, and `bchVersion === BCCH_PINNED_VERSION`
(`src/container/bcch-config.ts`). `createdAt` and `cacheKey` are diagnostic.

`layoutVersion` exists so a future change to the expected-file list invalidates
every marker without waiting for an artifact URL to change.

Markers are written to a temp file and `Deno.rename`d into place, so a torn
marker can never validate.

### Expected files

Enumerated concretely, not sampled:

- `compiler/extension/bin` (directory, non-empty)
- `symbols/` containing at least one `*.app`
- `symbols/cache_AppInfo.json`
- `manifest.json`
- `dlls/`
- `dlls/Test Assemblies`

Any missing entry means rebuild.

### Cross-process safety

`trap-probe` and `bench` run as separate processes by design, and
`compilerFolderQueue` serializes only within one process. The adopt path is
mostly read-only (stat plus one file read to validate the marker), but on a
match `tryAdoptCompilerFolder` also calls `pruneCompilerOutput`, which
deletes stale `output/` subdirectories — before any lock is taken. This is
deliberate, not an oversight: the residual risk is bounded on three sides.
Live output dirs (from an in-flight compile in the other process) have the
freshest mtimes, so `pruneCompilerOutput`'s `keep = 10` retention leaves them
alone; the compile pool caps in-flight output dirs at 3 per container, well
under that retention floor; and Windows refuses to delete a directory with an
open handle, so even a race that targeted a live dir would fail the delete,
not corrupt it — `pruneCompilerOutput` swallows that failure and moves on
(best-effort, never fails a run). Only rebuild mutates the folder's
compiler/symbols contents, so:

1. Try adoption unlocked.
2. On miss, acquire a lock file at `<COMPILER_FOLDER_DIR>\.cg-<container>.lock`
   via `Deno.open` with `createNew: true` (atomic create).
3. **Re-read the marker under the lock** — another process may have finished a
   rebuild while this one waited. Adopt if it now validates.
4. Otherwise rebuild, write the marker, release.

Stale locks are detected by mtime age plus PID liveness, and broken rather than
waited on forever. Lock acquisition has a bounded timeout; on timeout, log and
rebuild without the lock rather than failing the run — a redundant rebuild is
wasteful, not incorrect.

### `output/` retention

Every compile creates `${compilerFolder}\output\${name}_${uuid8}`. BCH's
unconditional folder delete was garbage-collecting these incidentally; adoption
preserves the folder, so without action the directory grows one entry per
compile forever. Prune on adopt: keep the newest N (default 10) by mtime,
delete the rest. Best-effort — a prune failure must never fail a run.

### Instrumentation

`setup.warmup-compiler` keeps its name so the Phase 1 measurement stays
comparable. Add `args: { adopted: <count>, rebuilt: <count> }` so a re-measured
trace shows whether adoption actually engaged rather than only that the phase
got faster.

## Health-check correctness fix

The Phase 1 measurement was contaminated because `Test-BcContainer` reported
`Cronus284` healthy while Docker reported the container not running — the trace
showed `args.ok: true` and only the run log revealed the truth. Every task
dispatched there failed, and roughly half of `setup.harness` was a doomed
publish.

Since W3 already calls `docker inspect` per container, `.State.Running` is
effectively free. `isHealthy` gains that check.

**Scoped deliberately as a correctness fix, not a speed one.** Whether
`docker inspect` could *replace* the `Test-BcContainer` spawn depends on what
that cmdlet verifies beyond liveness, which is not established here. Do not
remove the existing check on the strength of this document.

## W5. Compact single-task matrix

### Structured empty-response field

"Model returned empty response" is a bare string at `llm-work-pool.ts:278`.
W5 adds a structured field on the LLM result; the reporter reads that field and
never string-matches. This matters because an empty response scores as a failed
attempt 1 while carrying zero trap signal — reading it as a genuine catch
corrupts exactly the judgement the authoring loop exists to support.

### Categories and precedence

Attempt-level: `PASS`, `COMPILE`, `TEST`, `EMPTY`, `INFRA`.

Precedence, for attempts carrying more than one signal:

| Situation | Category |
|---|---|
| Compiled and all tests passed | `PASS` |
| Compile failed | `COMPILE` |
| Compiled, tests ran, some failed | `TEST` |
| Compiled successfully but **zero tests ran** | `INFRA` (GH #13) |
| Model returned an empty response | `EMPTY` |
| Infra-retry recovered the attempt | category of the **final** outcome |
| Attempt quarantined by an alert drain | `INFRA` |

Each attempt carries its own category, so an `EMPTY` attempt 1 followed by a
`COMPILE` attempt 2 renders as both rather than collapsing.

### Rendering

Per F5, the existing matrix is gated on `outputFormat === "verbose"` **and**
`taskCount > 1` (`results-writer.ts:537,541`). The compact matrix renders
whenever `taskCount === 1`, regardless of output format.

## Non-goals

- A long-lived daemon. Still the largest possible win on the cold-spawn tax,
  still a large lifecycle change, still out of scope.
- Replacing `Test-BcContainer` with `docker inspect`. See above.
- Reworking `setup.harness`. It costs ~30 s warm, but the only measurement of
  it is contaminated by the Cronus284 outage. Re-measure on three live
  containers first.

## Risks

| Risk | Mitigation |
|---|---|
| A corrupt folder passes file validation and is adopted | Validation enumerates the specific files BCH populates; `layoutVersion` allows invalidating every marker at once when that list proves insufficient |
| Two processes race the same folder | Adopt is read-only; rebuild takes a lock and re-checks the marker under it |
| Stale lock blocks a run | mtime plus PID liveness detection, bounded timeout, then rebuild without the lock |
| `output/` grows unbounded | Bounded retention on adopt |
| Artifact URL carries a volatile SAS token | Query string stripped before hashing, as Phase 1 established and BCH itself does (`New-BcCompilerFolder.ps1:46` uses `Split('?')[0]`) |
| Adoption silently never engages, and nobody notices | `setup.warmup-compiler` carries `adopted`/`rebuilt` counts |

## Testing

Unit:

- Cache-key derivation: stable across calls, SAS-token-invariant, version-sensitive, stripped at the first `?`. Now plain TypeScript.
- Marker validation: match, artifact-URL mismatch, BCH-version mismatch, layout-version mismatch, each missing expected file, torn/partial marker. Each must produce the right adopt-or-rebuild decision.
- Lock: contention, stale-lock breaking, timeout fallback, and the double-check that adopts a folder another process just built.
- `output/` retention: keeps newest N, deletes older, tolerates a failure.
- W5 matrix against fixtures covering every category and every precedence row above.

Integration / manual:

- Warm run after this lands, comparing `setup.warmup-compiler` against Phase 1's 48.96 s baseline, with `adopted`/`rebuilt` proving adoption engaged. **This is the acceptance test.**
- `trap-probe` then `bench` back to back, proving the second process adopts rather than rebuilds.
- Two processes racing the same container's folder.
- An artifact-URL change forces a rebuild rather than adopting stale symbols.

Container-touching tests must not run while a bench is live
(`guard-bench-lock.sh`); use `--ignore=tests/unit/container`.
