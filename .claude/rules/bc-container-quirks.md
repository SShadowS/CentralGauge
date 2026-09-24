---
paths:
  - "src/container/**"
  - "cli/commands/bench/**"
  - "cli/commands/doctor*"
  - "scripts/**/*.ps1"
  - "scripts/microbench-soap.ts"
  - "tests/unit/container/**"
  - "infra/**"
  - "mcp/**"
  - "src/workbench/**"
---

Moved from `CLAUDE.md` by /doctor on 2026-09-24 so it loads only when working on matching files.

## bccontainerhelper config quirks

- Pinned to **6.1.14** via `BCCH_PINNED_VERSION` in `src/container/bcch-config.ts`
  (single source of truth since GH #13; bumped from 6.1.11 on 2026-05-15; the
  6.1.12+ change that disables the Windows-PowerShell PSSession by default does
  NOT break Publish/Unpublish in 6.1.14 when the workaround below stays on).
  Every script site emits `bcchImport()`, which imports the pinned version AND
  **fails loudly** when the cmdlets would resolve to a different version
  (`Get-Command Invoke-ScriptInBcContainer` check) — `Import-Module
  -RequiredVersion` otherwise silently no-ops to an already-loaded version
  (GH #13: a pin can appear validated while a different BCH runs underneath).
  Never inline a version string at a script site.
- **Two BCH execution settings are pinned by our scripts** (GH #12), single
  source of truth `src/container/bcch-config.ts` (`bcchConfigInit()`), emitted at
  every BCH script site in `bc-container-provider.ts` + `bc-script-builders.ts` +
  `pwsh-session.ts` — so behavior does NOT depend on the machine-level
  `BcContainerHelper.config.json`:
  - **`usePsSessionForBc28 = $false`** (default) — BCH's own default since
    6.1.12: use `docker exec` instead of the PS7 remote PSSession. The PS7
    session is what loses the .NET-Framework NAV admin module after an Unpublish
    (→ `Get-NavServerInstance is not recognized` → next Publish fails). docker
    exec avoids that class of bug entirely. The ROOT CAUSE of our slowness +
    publish breakage was the machine config forcing this `$true`.
  - **`usePwshForBc24 = $true`** (default) — fast in-container pwsh. SAFE under
    docker exec (verified end-to-end: microbench full flow + chained-prereq nuke
    + canary on BC28), and ~30-40x faster than the WinPS-5.1 workaround.
  - **No env vars needed.** Escape hatches for diagnostics only:
    `CENTRALGAUGE_BCCH_USE_PWSH_BC24=0` forces the slow WinPS workaround;
    `CENTRALGAUGE_BCCH_USE_PSSESSION_BC28=1` re-enables the PS7 session (which
    reintroduces the Unpublish bug on affected images). `[CG-PIN]` sentinels
    print the resolved `usePwshForBc24` so bench output proves the mode.
- **Historical note — why the WinPS workaround existed.** It was the pre-docker-exec
  way to dodge the Get-NavServerInstance-after-Unpublish bug; the real fix is
  keeping `usePsSessionForBc28=$false`.
  6.1.14 fixes the simple multi-cycle publish-then-unpublish flow
  (`scripts/bcch-pwsh-repro.ps1` Phase A passes 3 cycles) but does NOT fix
  the production flow where `Run-TestsInBcContainer` precedes
  `Unpublish-BcContainerApp` on the same container — see
  `scripts/microbench-soap.ts` log. Without the workaround, the next
  `Unpublish-BcContainerApp` from any pwsh 7 process inherits the corrupted
  BC NST PSSession and throws `Get-NAVAppInfo is not recognized`. Cost of
  the workaround: each fresh-pwsh `Get-BcContainerAppInfo` call forks a
  Windows PowerShell sub-session (~120 s vs ~5 s without). Production
  amortizes this through the long-lived per-container session slot
  (`runScriptThroughSession`), where BCH caches the sub-session once.
  - **GH #12: on BC28 / Windows Server 2025 / ltsc2025 the `$false` (WinPS 5.1
    in-container) path costs ~380-440 s per heavy op (~30-40x), dominating bench
    wall time and blowing the 300 s session timeout (which then triggers a
    fresh-spawn re-run — a double-execution amplifier).** A 6-task easy bench:
    67.5 min pinned → 6.9 min with the knob off, identical pass results. If you
    are on such an image AND have verified the Unpublish bug doesn't reproduce,
    set `CENTRALGAUGE_BCCH_USE_PWSH_BC24=1` for the speedup.
- Before flipping the workaround off, re-run BOTH:
  - `scripts/bcch-pwsh-repro.ps1` against the new bcch version (must pass), and
  - `scripts/microbench-soap.ts` end-to-end (the prenuke between L2 and L3
    must succeed without `Get-NAVAppInfo` error).
- **SOAP test harness path is ON by default** (2026-05-15, after Phase 2
  of `BenchBattleplan.md`). Opt out via `CENTRALGAUGE_SOAP_TEST_RUNNER=0`
  if the legacy path is needed for diagnostics. Mini bench A+C:
  `1 h 1 m legacy → 29 m 29 s SOAP` (52 % faster) on 2 models × 3 tasks ×
  2 containers; projected benchsmall ~3.5-4 h vs ~7-8 h legacy.
  - The SOAP test step itself (`runTestsViaSoap`) is ~38× faster than
    `Run-TestsInBcContainer` (microbench: 14.7 s → 0.11 s).
  - The pre-publish cleanup + new candidate publish go through
    `BcContainerProvider.prepareCandidateApp()` — ONE warm-slot script
    invocation that bypasses BCH's slow host-side `Unpublish-BcContainerApp`
    wrapper. Cleanup runs `Invoke-ScriptInBcContainer { Get-NAVAppInfo
    | Uninstall-NAVApp; Unpublish-NAVApp }` directly inside the
    container (reuses the container's already-running WinPS PSSession,
    ~4 s). Publish stays on host-side `Publish-BcContainerApp` because
    it needs `-sync -syncMode ForceSync -install` in one call.
  - Smoke trace `results/smoke-trace-AplusC-<stamp>/trace.json`:
    `prepare-candidate` span = 14.6 s, replacing what was previously
    `cleanup` 125 s + `publish-app` 128 s = 253 s/task.
  - Old `cleanupStaleCandidates` + `publishApp` methods stay for prereq
    publishing and the bench-startup prenuke. Only the per-task SOAP-fork
    hot path uses the combined `prepareCandidateApp`.
  - The prenuke ALSO runs at end-of-run (`endOfRunNuke` in
    `cli/commands/bench/container-setup.ts`, GH #13 footnote) — without it the
    LAST task's candidate + prereq stayed published until the next bench, and
    a stale candidate blocks ad-hoc publishes with "same App ID and Version"
    (all candidates share one fixed app ID). Best-effort, never fails a run.
  - DO NOT split `prepareCandidateApp` back into separate
    `cleanupStaleCandidates` + `publishApp` calls on the hot path. BCH
    disposes its Windows-PowerShell sub-session at end-of-script under
    `usePwshForBc24=$false`, so each separate `runScriptThroughSession`
    call would re-pay the ~120 s bridge setup.
- **Compiler artifact cache — bench startup never touches it.** `setupContainer`/
  `setupContainers` no longer clear BCH compiler folders unconditionally; that's
  now gated on `--no-compiler-cache` (`BcContainerProvider.clearCompilerFolders`),
  and the shared artifact cache is NEVER purged from the startup path at all
  (the old implicit purge was destroying the cache it was meant to preserve).
  The cache is keyed by artifact URL:
  `C:\ProgramData\BcContainerHelper\compiler-cache-<12hex>`, where `<12hex>` is
  the first 12 hex chars of a SHA-256 of the artifact URL with its query string
  stripped (a SAS token in the URL would otherwise churn the key every run),
  computed host-side in `src/container/compiler-cache-key.ts` (it was an
  in-script PowerShell hash until compiler-folder adoption made the artifact
  URL known host-side; that version is deleted — do not reintroduce a second
  implementation).
  - The legacy unkeyed `compiler-cache` directory is orphaned on every machine
    at first run after this change (can be multi-GB); one new keyed directory
    accrues per BC artifact version thereafter.
  - `centralgauge doctor purge-compiler-cache` is the manual escape hatch — the
    only recovery for a cache left incomplete by a run killed mid-population
    (BCH only repopulates when `symbols/` is absent). What it does NOT do: it
    costs a local cache repopulation (VSIX expansion + symbol/compiler/DLL
    copies), not a network re-download — `Download-Artifacts` keys its own
    separate cache at `C:\bcartifacts.cache` and gates on `Test-Path` there.
  - A bare `pwsh` on this machine resolves bccontainerhelper **6.1.15** while
    `BCCH_PINNED_VERSION` pins **6.1.14** (they differ: 6.1.15 adds
    `-platformArtifactUrl`). Runtime scripts are protected by `bcchImport()`'s
    loud-fail version check; ad-hoc operator `pwsh` checks are NOT — import the
    pin explicitly (`Import-Module bccontainerhelper -RequiredVersion 6.1.14`)
    before trusting one against this machine.
- **Compiler-folder adoption is ON by default**; `--no-reuse-compiler-folders`
  opts out. An existing folder is adopted outright rather than rebuilt when a
  marker plus a file check proves it matches the container's current artifact
  URL — decided entirely host-side from `docker inspect` (the exact source
  `Get-BcContainerArtifactUrl` reads), so a warm run makes no `pwsh` call for
  compiler folders at all. `New-BcCompilerFolder` deletes and rebuilds the
  folder on every call regardless of cache state, which measured 48.96 s across
  three containers even fully warm.
  - Adoption requires the compiler cache to be ENABLED. Under
    `--no-compiler-cache` no `-containerName` is passed, so BCH names the
    folder `[GUID]::NewGuid()` (`New-BcCompilerFolder.ps1:60-62`) — there is no
    stable folder to adopt and adoption correctly short-circuits.
  - `scripts/bench.ps1` and `scripts/benchsmall.ps1` are **gitignored** operator
    wrappers (`.gitignore:98-110` allowlist). Their local copies were changed to
    default `-NoCompilerCache` to `$false` so full benches get adoption. **That
    change does not survive a fresh clone — re-apply it.** Passing
    `-NoCompilerCache` restores rebuild-every-run, which is what the R2
    baseline's published scores were produced under.
