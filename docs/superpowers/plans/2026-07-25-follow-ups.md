# Follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clear the four open entries in `docs/follow-ups.md` — the ~26.5 s test-harness startup phase, the model-validator divergence, the GUID sweep's cross-process hazard, and `validateFolder`'s narrow expected-file list.

**Architecture:** Four independent changes. The largest (harness) routes a read-only presence probe through the existing warm session slot and parallelizes the per-container loop, leaving the rare publish path serial and unchanged.

**Tech Stack:** Deno 2.x + TypeScript, Cliffy commands, `@std/assert`, existing Chrome-Trace tracer, `bccontainerhelper` pinned to 6.1.14.

**Source:** `docs/follow-ups.md` entries 1-4. Entry 5 (`infra-invalidation` comment) is **already done** — the comment exists at `src/health/infra-invalidation.ts`; Task 5 removes the stale entry.

## Global Constraints

- Deno 2.x. Tests only via `deno task test:unit` or scoped `deno test --allow-all <path>`; bare `deno test` lacks `--allow-all`. Never `--parallel`.
- **NEVER `git commit --amend` on this branch.** A prior phase had an amend clobber another agent's commit.
- **Exactly one implementer in flight at a time.**
- Deno 2.8: mock statics and `Deno.*` globals with `Object.defineProperty(Obj, "name", { value, configurable: true })`, never plain assignment; restore in `finally`.
- **SAFETY:** no test may touch `C:\ProgramData\BcContainerHelper` — real compiler folders and artifact caches live there.
- After changes: `deno check <changed>`, `deno lint <changed dirs>`, `deno fmt <changed>` — scoped to changed files only. A directory-wide `deno fmt` rewrites dozens of unrelated files (CRLF/LF drift). Never `deno fmt` under `site/`.
- **Import order: `@std/...`, then type imports, then implementation imports, then relative.** Neither `deno lint` nor `deno fmt` catches this; three tasks slipped on it in prior phases.
- Console output uses `@std/fmt/colors`, never emojis.
- Check the bench lock before container tests: `find results/.bench-running.json -mmin -2` (no output = safe).
- Do NOT run a bench without explicit instruction — real LLM spend.
- Commit per task, conventional-commit prefixes. Do not push.

---

### Task 1: Route the harness presence probe through the warm session slot, and parallelize

**Files:**
- Modify: `src/container/bc-container-provider.ts` (`ensureTestHarness`, ~`:1479-1550`)
- Test: `tests/unit/container/ensure-test-harness.test.ts` (create)

**Interfaces:**
- Consumes: `private runScriptThroughSession(containerName, script, scriptLabel?)` (~`:759`), returning `{ output, exitCode }`.
- Produces: no signature change. `ensureTestHarness(containerNames: string[]): Promise<void>` is unchanged.

**The measurement this closes.** Both Phase 2 runs logged `Test harness already published` for all three containers, and `setup.harness` was 26.2-26.6 s — so the whole phase is three presence probes, ~8.8 s each, for a read-only "is this app installed?" check. Roughly 5 s of each is `pwsh` spawn plus `bcchImport()`, priced from `setup.health`'s steady-state 5.2-5.7 s (identical shape).

- [ ] **Step 1: Read the current implementation at HEAD**

Read `ensureTestHarness` in full before editing. Line numbers in this plan have drifted before. Note its exact structure: a serial `for` loop, each iteration doing a presence probe via `executePowerShell`, an early `continue` when present, then a compile+publish path, all wrapped in a per-container `try/catch` that logs non-fatally.

Also read `runScriptThroughSession` and at least one existing caller, so you match how `scriptLabel` is used and what `SCRIPT_LABEL_OPERATION` expects.

- [ ] **Step 2: Write the failing tests**

Create `tests/unit/container/ensure-test-harness.test.ts` covering:

- The presence probe goes through `runScriptThroughSession`, **not** `executePowerShell`. Stub both; assert the session path was used and the cold path was not.
- All containers are probed **concurrently**, not serially. Make each stubbed probe resolve on a deferred promise; assert all N probes have started before any resolves.
- A container whose probe reports `HARNESS_PRESENT` does no further work (no compile, no publish).
- A probe that throws for one container does **not** prevent the others from being probed, and does not reject `ensureTestHarness`. This is the existing non-fatal contract — a harness failure disables the SOAP path for that container but must never abort a bench.
- `isWindows() === false` still short-circuits with no work at all.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `deno test --allow-all tests/unit/container/ensure-test-harness.test.ts`

- [ ] **Step 4: Split probe from publish**

Restructure into two phases:

1. **Probe phase — concurrent, warm slot.** Build the presence-check script exactly as today (same `Get-BcContainerAppInfo` filter on `HARNESS_APP_NAME` + `HARNESS_APP_VERSION`, same `HARNESS_PRESENT`/`HARNESS_ABSENT` output), but send it via `runScriptThroughSession` instead of `executePowerShell`. Run all containers with `Promise.allSettled` so one failure cannot sink the rest.
2. **Publish phase — serial, unchanged.** For containers reporting absent (or whose probe failed), keep today's exact compile+publish logic, still serial, still `executePowerShell`, still per-container `try/catch` logging non-fatally.

Rationale to put in a comment: the probe is read-only and independent per container, so it is safe to parallelize and safe on the warm slot; the publish path mutates container state and runs rarely, so it stays serial and on the cold path where it has been proven.

**Do not change** the `bcchImport()` usage inside the publish script, the `Unpublish` loop, or the `HARNESS_PUBLISHED:` sentinel.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `deno test --allow-all tests/unit/container/ensure-test-harness.test.ts` and `deno test --allow-all tests/unit/container/`

Expected: PASS, no regressions.

- [ ] **Step 6: Verify, format, commit**

```bash
deno check src/container/bc-container-provider.ts tests/unit/container/ensure-test-harness.test.ts
deno lint src/container tests/unit/container
deno fmt src/container/bc-container-provider.ts tests/unit/container/ensure-test-harness.test.ts
git add src/container/bc-container-provider.ts tests/unit/container/ensure-test-harness.test.ts
git commit -m "perf(container): probe the test harness via the warm slot, concurrently

setup.harness measured 26.2-26.6s across both Phase 2 runs, and both logged
'already published' for every container -- so the entire phase was three
serial presence probes, ~8.8s each, to answer 'is this app installed?'.
Roughly 5s of each was pwsh spawn plus bcchImport.

The probe is read-only and independent per container, so it now runs through
the warm session slot and concurrently. The publish path underneath mutates
container state and runs rarely; it stays serial on the cold path."
```

---

### Task 2: Make the GUID sweep safe against a concurrent process

**Files:**
- Modify: `src/container/bc-container-provider.ts` (`clearCompilerFolders`, ~`:2667`)
- Test: `tests/unit/container/bc-container-provider.test.ts` (extend)

**Interfaces:**
- Consumes: `BcContainerProvider.GUID_FOLDER_RE`.
- Produces: `clearCompilerFolders(compilerDir?, opts?: { minAgeMs?: number })`.

**The hazard.** `trap-probe` and `bench` are deliberately separate processes. Under `--no-compiler-cache` BCH names folders `[GUID]::NewGuid()` (`New-BcCompilerFolder.ps1:60-62`), and the sweep deletes every GUID-shaped folder — including one another process is compiling into.

- [ ] **Step 1: Write the failing tests**

Extend `tests/unit/container/bc-container-provider.test.ts`:

- A GUID-shaped folder with a **recent** mtime is NOT deleted.
- A GUID-shaped folder with an **old** mtime IS deleted.
- `CentralGauge-*` folders are deleted regardless of age (deterministic per container; the existing lock covers them).
- Existing survivors still survive: `someone-elses-folder`, `backup-<guid>`, `<guid>-old`, a 31-hex near-GUID, and `.cg-*.lock` files.

Use `Deno.makeTempDir()` and set mtimes explicitly with `Deno.utime`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `deno test --allow-all tests/unit/container/bc-container-provider.test.ts`

- [ ] **Step 3: Add the age guard**

Add a `GUID_FOLDER_MIN_AGE_MS` constant (default 30 minutes) and skip GUID-shaped folders younger than it. Comment why: a GUID folder carries no container name, so the per-container lock cannot cover it; mtime age is the available signal, and a live build touches its folder continuously. Note this is a diagnostic-only path (`--no-compiler-cache`), so a conservative skip costs at most a stale orphan that the next sweep collects.

Keep `CentralGauge-*` unconditional. Keep `entry.isDirectory` ANDed so lock files survive. Keep the NotFound-returns-silently behaviour.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `deno test --allow-all tests/unit/container/bc-container-provider.test.ts`

- [ ] **Step 5: Verify, format, commit** (`fix(container):` prefix, describing the concurrent-process hazard)

---

### Task 3: Widen `validateFolder`'s expected-file list

**Files:**
- Modify: `src/container/compiler-folder-marker.ts`
- Test: `tests/unit/container/compiler-folder-marker.test.ts` (extend)

**Interfaces:** no signature change. `LAYOUT_VERSION` increments.

**Why the bump is mandatory.** Existing markers on disk were written against the old list. Without incrementing `LAYOUT_VERSION`, a folder missing one of the newly-required entries would still validate, because the marker says the layout matched. The constant exists precisely for this.

- [ ] **Step 1: Write the failing tests**

Extend the existing test file. The helper that builds a good folder must now also create `dlls/Service`, `dlls/Mock Assemblies`, `dlls/OpenXML`, and an `alc.exe` inside `compiler/extension/bin`. Add a rejection case for each new entry being absent, mirroring the existing per-entry victim loop.

Confirm the existing layout-version-mismatch test still passes with the bumped constant.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `deno test --allow-all tests/unit/container/compiler-folder-marker.test.ts`

- [ ] **Step 3: Widen the list and bump the version**

Add the four entries to `EXPECTED` with the right `kind` for each. `alc.exe` needs care: BCH puts the compiler under `compiler/extension/bin` or `compiler/extension/bin/win32` depending on version, so check for the file in either location and treat presence in either as satisfied — do not hard-fail on the `win32` variant being absent.

Increment `LAYOUT_VERSION` and note in its doc comment that this bump invalidates every marker on every machine, costing one rebuild per container on the next run.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `deno test --allow-all tests/unit/container/compiler-folder-marker.test.ts` and `deno test --allow-all tests/unit/container/`

- [ ] **Step 5: Verify, format, commit** (`fix(container):` prefix; the message must state that the `LAYOUT_VERSION` bump forces one rebuild per container on the next run)

---

### Task 4: Make `models --check` and bench's `validateModels()` agree

**Files:**
- Investigate then modify: the `models --check` path and/or `src/llm/registry.ts` (`validateModelAsync`, ~`:250`)
- Test: as appropriate to the fix chosen

**The divergence.** `anthropic/claude-haiku-4-5` passes `--check` but bench rejects it; only the dated `anthropic/claude-haiku-4-5-20251001` works. `--check` verifies callability with a raw provider call, which resolves the alias; `validateModelAsync` checks Anthropic's live `/v1/models` discovery list, which omits it. The catalog carries both slugs.

This shipped a broken default in `run-xiterate.ps1` (fixed in `e5fd38c0`). The consequence that remains: `--check` passing is not sufficient evidence a bench will start.

- [ ] **Step 1: Establish the actual behaviour before changing anything**

Read both paths. Then verify empirically against the live API which slugs each accepts — at minimum `anthropic/claude-haiku-4-5` and `anthropic/claude-haiku-4-5-20251001`. `models --check` is a cheap single call; do NOT run a bench. Record the real outputs in your report.

- [ ] **Step 2: Choose the direction and say why**

Two candidates, both acceptable:
- Make `--check` use `validateModelAsync`, so it answers the same question bench asks.
- Make `validateModelAsync` fall back to the catalog when discovery omits a slug the catalog knows.

Pick based on what you find, and state the trade-off. The binding requirement is that **the two agree** — a user must not be able to get a green `--check` for a slug that fails a bench. If neither is right, say so and stop rather than forcing one.

- [ ] **Step 3: Write the failing test**

Assert both paths agree for the alias and for the dated slug. Mock the provider/discovery layer; do not hit the live API from a test.

- [ ] **Step 4: Implement, run tests, verify no regressions**

Run the scoped test plus `deno test --allow-all tests/unit/llm/`.

- [ ] **Step 5: Verify, format, commit** (`fix(llm):` prefix)

---

### Task 5: Update `docs/follow-ups.md`

**Files:** Modify `docs/follow-ups.md`

- [ ] **Step 1: Remove every entry this plan closed**

Delete entries 1-4 as their tasks land. **Also delete entry 5** — it is stale: the comment it asks for already exists in `src/health/infra-invalidation.ts`, added by the Phase 2 final fix wave. Verify that by reading the file before deleting the entry.

If the file ends up with no entries, keep the heading and a line saying there are currently none, rather than deleting the file — the convention it documents is worth preserving.

- [ ] **Step 2: Commit** (`docs:` prefix)

---

### Task 6: Re-measure `setup.harness`

**Files:** Create `docs/superpowers/plans/2026-07-25-follow-ups-measurements.md`

**This requires a real bench run and is therefore gated.** Do NOT run it without explicit confirmation from the controller.

- [ ] **Step 1: Preflight**

`find results/.bench-running.json -mmin -2` must return nothing. Verify all three bench containers report `Running: true` via `docker inspect <name> --format '{{.State.Running}}'` — Phase 1's measurement was contaminated by skipping exactly this check.

- [ ] **Step 2: One warm run with tracing**

```bash
pwsh -NoProfile -File ./run-xiterate.ps1 tasks/hard/CG-AL-X035-poisoned-rescue.yml -NoSanity -TraceFile results/trace-harness.json
```

Background it. Note Task 3's `LAYOUT_VERSION` bump means this run rebuilds compiler folders once — so `setup.warmup-compiler` will be high and is **not** a regression. Say so explicitly in the writeup.

- [ ] **Step 3: Extract and record**

```bash
jq -r '.traceEvents[]|select(.ph=="X")|select(.name|startswith("setup."))|"\(.name)\t\(.args.container // "")\t\(.dur/1000000)s"' results/trace-harness.json
```

Compare `setup.harness` against the 26.2-26.6 s baseline. State whether the predicted ~4 s materialised, and if not, diagnose rather than editorialise. A partial win honestly reported is the deliverable.

- [ ] **Step 4: Commit** (`docs(bench):` prefix)

---

## Self-Review

**Coverage.** `docs/follow-ups.md` entry 1 → Task 1 + Task 6. Entry 2 → Task 4. Entry 3 → Task 2. Entry 4 → Task 3. Entry 5 → Task 5 (stale, already implemented).

**Placeholder scan.** Task 4 deliberately specifies investigation-then-decision rather than a literal patch, because the right fix depends on live API behaviour that must be established first; its acceptance criterion (the two paths agree) is concrete. Every other task names exact files, exact constants, and exact test cases.

**Ordering.** Task 3 bumps `LAYOUT_VERSION`, which forces one rebuild per container — Task 6 must run after it and must say so, or the measurement reads as a `setup.warmup-compiler` regression.

**Risk.** Task 1 is the only one that changes production control flow on a hot path. Its non-fatal per-container contract is the thing most likely to be broken by restructuring, which is why Step 2 tests it explicitly.
