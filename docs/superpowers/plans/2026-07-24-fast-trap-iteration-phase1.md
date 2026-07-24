# Fast Trap-Task Iteration Loop — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the bench destroying its own compiler cache on every startup, instrument the startup path so the real bottleneck can be measured, and ship a single-task wrapper for authoring trap-tasks.

**Architecture:** Split the unconditional `clearCompilerCache()` into a folder clear (only when the cache is explicitly disabled) and an explicit maintenance purge (never implicit). Add trace spans to the existing, already-wired tracer at each startup phase. Add a PowerShell wrapper that runs one task against three models with a Cronus28-isolated sanity lane.

**Tech Stack:** Deno 2.x + TypeScript, Cliffy commands, `@std/assert` for tests, PowerShell 7 wrapper scripts, existing Chrome-Trace-format tracer in `src/tracing/tracer.ts`.

**Source spec:** `docs/superpowers/specs/2026-07-24-fast-trap-iteration-design.md`

## Scope

This plan is **Phase 1 of 2**. It covers spec workstreams W6 (instrumentation), W2 (cache split), W1 (wrapper) and finding F7 (dead argument).

Deliberately **excluded**:

- **W3 (cross-process compiler-folder adoption)** — the spec gates it on W6's measurement. If the measurement shows folder rebuild is not the binding constraint, W3's cross-process locking and marker protocol is complexity for nothing. Plan it after Task 8 produces numbers.
- **W5 (single-task matrix)** — independent of speed, off the critical path. Its own plan.

**Ordering deviation from the spec:** the spec says W6 lands first. This plan does W2 first. Reason: `setupContainers` currently calls `BcContainerProvider.clearCompilerCache()` unconditionally at `container-setup.ts:180`, which deletes real directories under `C:\ProgramData\BcContainerHelper`. Any test that exercises the startup path — including a tracing test — would destroy the developer's actual artifact cache. Task 1 and Task 2 make that path safe and injectable, which is what makes W6 testable.

## Global Constraints

- Deno 2.x. Run tests only via `deno task test:unit` or a scoped `deno test --allow-all <path>`; bare `deno test` lacks `--allow-all` and will fail.
- Do NOT use `--parallel` for tests — some tests share static state.
- After every change: `deno check <changed-files>`, `deno lint <changed-dirs>`, `deno fmt <changed-files>`. Scope to changed files only; the repo has CRLF/LF drift and a directory-wide `deno fmt` rewrites dozens of unrelated files.
- Do NOT run `deno fmt` on anything under `site/` (prettier owns it).
- **Never run the full `deno task test:unit` while a bench is live.** `tests/unit/container/` publishes to real Cronus containers. Use `deno test --allow-all --ignore=tests/unit/container tests/unit/`, or confirm the bench is stopped. A `guard-bench-lock.sh` hook enforces this.
- Console output uses `@std/fmt/colors`, never emojis: `colors.green("[OK]")`, not `✅`.
- Import order: `@std/...` first, then type imports from project modules, then implementation imports, then relative imports.
- Cliffy footgun: `--no-X` options must NOT declare `{ default: false }` — cliffy treats the default as the value and the field is permanently false. Positive flags like `--warm` may use `default: false` safely.
- BC container credentials on this machine are `sshadows` / `1234`. Only **Cronus28** has credentials wired for `scripts/trap-probe.ts`; other containers return 401.
- Commit after each task. Conventional-commit prefixes (`feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`).

---

### Task 1: Split `clearCompilerCache` into folder-clear and cache-purge

The single method today does two unrelated things, and callers always get both. Splitting them is what allows ordinary startup to keep the artifact cache. Both new methods take an injectable directory so they are testable without touching `C:\ProgramData`.

**Files:**
- Modify: `src/container/bc-container-provider.ts` (constant near `:297`; method `clearCompilerCache` at `:2371-2402`)
- Test: `tests/unit/container/bc-container-provider.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `static clearCompilerFolders(compilerDir?: string): Promise<void>` — removes `CentralGauge-*` directories only.
  - `static purgeArtifactCache(cacheDir?: string): Promise<void>` — removes the shared artifact cache directory.
  - `static readonly COMPILER_FOLDER_DIR: string` — `"C:\\ProgramData\\BcContainerHelper\\compiler"`.
  - `clearCompilerCache` is **removed**; Task 2 updates its two call sites.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/container/bc-container-provider.test.ts`:

```typescript
Deno.test("clearCompilerFolders removes only CentralGauge-* directories", async () => {
  const dir = await Deno.makeTempDir({ prefix: "cg-compiler-" });
  try {
    await Deno.mkdir(`${dir}/CentralGauge-Cronus28`);
    await Deno.mkdir(`${dir}/CentralGauge-Cronus282`);
    await Deno.mkdir(`${dir}/someone-elses-folder`);

    await BcContainerProvider.clearCompilerFolders(dir);

    const remaining: string[] = [];
    for await (const e of Deno.readDir(dir)) remaining.push(e.name);
    assertEquals(remaining, ["someone-elses-folder"]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("clearCompilerFolders is a no-op when the directory is absent", async () => {
  // Must not throw — a machine that has never run a bench has no compiler dir.
  await BcContainerProvider.clearCompilerFolders(
    "C:\\definitely\\not\\a\\real\\path\\cg-test",
  );
});

Deno.test("clearCompilerFolders does NOT touch the artifact cache", async () => {
  const root = await Deno.makeTempDir({ prefix: "cg-split-" });
  try {
    const compilerDir = `${root}/compiler`;
    const cacheDir = `${root}/compiler-cache`;
    await Deno.mkdir(`${compilerDir}/CentralGauge-Cronus28`, {
      recursive: true,
    });
    await Deno.mkdir(cacheDir, { recursive: true });
    await Deno.writeTextFile(`${cacheDir}/marker.txt`, "keep me");

    await BcContainerProvider.clearCompilerFolders(compilerDir);

    // The cache survives — this is the whole point of the split.
    assertEquals(await Deno.readTextFile(`${cacheDir}/marker.txt`), "keep me");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("purgeArtifactCache removes the cache directory", async () => {
  const root = await Deno.makeTempDir({ prefix: "cg-purge-" });
  try {
    const cacheDir = `${root}/compiler-cache`;
    await Deno.mkdir(cacheDir, { recursive: true });
    await Deno.writeTextFile(`${cacheDir}/marker.txt`, "delete me");

    await BcContainerProvider.purgeArtifactCache(cacheDir);

    let stillThere = true;
    try {
      await Deno.stat(cacheDir);
    } catch {
      stillThere = false;
    }
    assertEquals(stillThere, false);
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
});

Deno.test("purgeArtifactCache is a no-op when the cache is absent", async () => {
  await BcContainerProvider.purgeArtifactCache(
    "C:\\definitely\\not\\a\\real\\path\\cg-cache",
  );
});
```

Ensure the file's import block has `assertEquals` from `@std/assert` and `BcContainerProvider` from `../../../src/container/bc-container-provider.ts`. Add only what is missing.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `deno test --allow-all tests/unit/container/bc-container-provider.test.ts`

Expected: FAIL — `Property 'clearCompilerFolders' does not exist on type 'typeof BcContainerProvider'` (and the same for `purgeArtifactCache`).

- [ ] **Step 3: Add the folder-dir constant**

In `src/container/bc-container-provider.ts`, immediately above the existing `COMPILER_CACHE_DIR` declaration (near `:297`), add:

```typescript
  /** Where BCH creates per-container compiler working folders. */
  static readonly COMPILER_FOLDER_DIR =
    "C:\\ProgramData\\BcContainerHelper\\compiler";
```

- [ ] **Step 4: Replace `clearCompilerCache` with the two split methods**

Delete the whole `static async clearCompilerCache()` method (currently `:2371-2402`) and put these in its place:

```typescript
  /**
   * Remove the per-container `CentralGauge-*` compiler working folders.
   *
   * Does NOT touch the shared artifact cache — see `purgeArtifactCache`.
   * Callers must only invoke this when the persistent compiler cache is
   * explicitly disabled: clearing folders on every ordinary startup is what
   * made the persistent cache self-defeating (each run re-downloaded and
   * re-extracted BC artifacts, serialized across containers).
   *
   * @param compilerDir Override for tests; defaults to the real BCH location.
   */
  static async clearCompilerFolders(
    compilerDir: string = BcContainerProvider.COMPILER_FOLDER_DIR,
  ): Promise<void> {
    try {
      for await (const entry of Deno.readDir(compilerDir)) {
        if (entry.isDirectory && entry.name.startsWith("CentralGauge-")) {
          const folderPath = `${compilerDir}\\${entry.name}`;
          try {
            await Deno.remove(folderPath, { recursive: true });
            log.info(`Cleared compiler folder: ${entry.name}`);
          } catch {
            log.warn(`Failed to clear compiler folder: ${entry.name}`);
          }
        }
      }
    } catch (error) {
      // NotFound is expected (directory doesn't exist yet); warn on anything else.
      if (error instanceof Deno.errors.NotFound) return;
      log.warn(`Could not enumerate compiler directory: ${error}`);
    }
  }

  /**
   * Purge the shared BCH artifact cache.
   *
   * MAINTENANCE ONLY — never call this from the bench startup path. It is
   * exposed to operators via `centralgauge doctor purge-compiler-cache` as the
   * escape hatch for a cache left incomplete by a run killed mid-population
   * (BCH's population gate is `!(Test-Path $symbolsPath)`, so a partial cache
   * is otherwise sticky forever).
   *
   * @param cacheDir Override for tests; defaults to the real cache location.
   */
  static async purgeArtifactCache(
    cacheDir: string = BcContainerProvider.COMPILER_CACHE_DIR,
  ): Promise<void> {
    try {
      await Deno.remove(cacheDir, { recursive: true });
      log.info("Cleared compiler cache directory");
    } catch {
      // cache directory doesn't exist — nothing to clear
    }
  }
```

Note: `COMPILER_CACHE_DIR` is currently `private static readonly`. A default parameter referencing it from inside the class body is legal TypeScript, so it stays private.

Note the Windows path separator: `clearCompilerFolders` builds `folderPath` with `\\`. Keep that — these are Windows-only paths and the surrounding code uses the same convention. The temp dirs in the tests use `/`, which Deno accepts on Windows for `readDir`/`remove`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `deno test --allow-all tests/unit/container/bc-container-provider.test.ts`

Expected: PASS, including the pre-existing tests in that file.

You will also see compile errors from `cli/commands/bench/container-setup.ts`, which still calls the now-deleted `clearCompilerCache`. That is expected and Task 2 fixes it. If `deno check` on the test file surfaces it, proceed anyway — the test run itself only type-checks its own import graph.

- [ ] **Step 6: Verify, format, commit**

```bash
deno check src/container/bc-container-provider.ts tests/unit/container/bc-container-provider.test.ts
deno lint src/container tests/unit/container
deno fmt src/container/bc-container-provider.ts tests/unit/container/bc-container-provider.test.ts
git add src/container/bc-container-provider.ts tests/unit/container/bc-container-provider.test.ts
git commit -m "refactor(container): split clearCompilerCache into folder clear and cache purge

The single method deleted both the CentralGauge-* compiler working folders
and the shared artifact cache, and bench startup called it unconditionally.
That made the persistent compiler cache structurally self-defeating: every
run re-downloaded and re-extracted BC artifacts, serialized across all
containers, and cleanupCompilerFolders' 'keep folders for cache reuse'
branch was dead letter across processes.

Both methods now take an injectable directory so they are testable without
touching C:\\ProgramData."
```

---

### Task 2: Gate folder clearing on `noCompilerCache`

This is the load-bearing change. Ordinary startup must now preserve both the compiler folders and the artifact cache.

**Files:**
- Modify: `cli/commands/bench/container-setup.ts` (`:50` in `setupContainer`, `:180` in `setupContainers`)
- Test: `tests/unit/cli/container-setup.test.ts`

**Interfaces:**
- Consumes: `BcContainerProvider.clearCompilerFolders(compilerDir?)` and `BcContainerProvider.purgeArtifactCache(cacheDir?)` from Task 1.
- Produces: no signature changes. `setupContainer` and `setupContainers` keep their existing `options?: { noCompilerCache?: boolean }` parameter; only the behaviour behind it changes.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/cli/container-setup.test.ts`:

```typescript
/**
 * Build a fake ContainerProvider that satisfies every capability
 * `setupContainers` probes for via the `"method" in provider` checks.
 */
function makeFakeProvider(): {
  provider: ContainerProvider;
  calls: string[];
} {
  const calls: string[] = [];
  const provider = {
    isHealthy: (_name: string) => {
      calls.push("isHealthy");
      return Promise.resolve(true);
    },
    setCredentials: () => {
      calls.push("setCredentials");
    },
    setCompilerCacheEnabled: () => {
      calls.push("setCompilerCacheEnabled");
    },
    prenukeCentralGaugeApps: (_names: string[]) => {
      calls.push("prenuke");
      return Promise.resolve();
    },
    warmupCompilerFolders: (_names: string[]) => {
      calls.push("warmup");
      return Promise.resolve();
    },
    ensureTestHarness: (_names: string[]) => {
      calls.push("ensureTestHarness");
      return Promise.resolve();
    },
  } as unknown as ContainerProvider;
  return { provider, calls };
}

Deno.test("setupContainers does NOT clear compiler folders by default", async () => {
  const { provider } = makeFakeProvider();
  ContainerProviderRegistry.register("fake-warm", () => provider);

  let clearCalled = false;
  const originalClear = BcContainerProvider.clearCompilerFolders;
  const originalPurge = BcContainerProvider.purgeArtifactCache;
  let purgeCalled = false;
  Object.defineProperty(BcContainerProvider, "clearCompilerFolders", {
    value: () => {
      clearCalled = true;
      return Promise.resolve();
    },
    configurable: true,
  });
  Object.defineProperty(BcContainerProvider, "purgeArtifactCache", {
    value: () => {
      purgeCalled = true;
      return Promise.resolve();
    },
    configurable: true,
  });

  try {
    await setupContainers(["Cronus28"], "fake-warm", { name: "Cronus28" });
    assertEquals(clearCalled, false);
    // The artifact cache must NEVER be purged from the startup path.
    assertEquals(purgeCalled, false);
  } finally {
    Object.defineProperty(BcContainerProvider, "clearCompilerFolders", {
      value: originalClear,
      configurable: true,
    });
    Object.defineProperty(BcContainerProvider, "purgeArtifactCache", {
      value: originalPurge,
      configurable: true,
    });
    ContainerProviderRegistry.clearInstances();
  }
});

Deno.test("setupContainers clears compiler folders when noCompilerCache is set", async () => {
  const { provider } = makeFakeProvider();
  ContainerProviderRegistry.register("fake-cold", () => provider);

  let clearCalled = false;
  let purgeCalled = false;
  const originalClear = BcContainerProvider.clearCompilerFolders;
  const originalPurge = BcContainerProvider.purgeArtifactCache;
  Object.defineProperty(BcContainerProvider, "clearCompilerFolders", {
    value: () => {
      clearCalled = true;
      return Promise.resolve();
    },
    configurable: true,
  });
  Object.defineProperty(BcContainerProvider, "purgeArtifactCache", {
    value: () => {
      purgeCalled = true;
      return Promise.resolve();
    },
    configurable: true,
  });

  try {
    await setupContainers(["Cronus28"], "fake-cold", { name: "Cronus28" }, {
      noCompilerCache: true,
    });
    assertEquals(clearCalled, true);
    // Even the explicit opt-out only clears folders, never the shared cache.
    assertEquals(purgeCalled, false);
  } finally {
    Object.defineProperty(BcContainerProvider, "clearCompilerFolders", {
      value: originalClear,
      configurable: true,
    });
    Object.defineProperty(BcContainerProvider, "purgeArtifactCache", {
      value: originalPurge,
      configurable: true,
    });
    ContainerProviderRegistry.clearInstances();
  }
});
```

Add to that file's imports (keeping the established order — `@std` first, then type imports, then implementation imports):

```typescript
import { setupContainers } from "../../../cli/commands/bench/container-setup.ts";
import { BcContainerProvider } from "../../../src/container/bc-container-provider.ts";
import { ContainerProviderRegistry } from "../../../src/container/registry.ts";
```

`cleanupContainer` and `endOfRunNuke` are already imported there; extend the existing import rather than adding a duplicate specifier.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `deno test --allow-all tests/unit/cli/container-setup.test.ts`

Expected: FAIL — `container-setup.ts` still calls `BcContainerProvider.clearCompilerCache`, which Task 1 deleted, so the module fails to type-check/resolve.

- [ ] **Step 3: Gate the call in `setupContainer`**

In `cli/commands/bench/container-setup.ts`, replace lines 49-50:

```typescript
  // Clear all compiler folders so they are recreated fresh
  await BcContainerProvider.clearCompilerCache();
```

with:

```typescript
  // Only clear compiler folders when the persistent cache is explicitly
  // disabled. Clearing on every startup destroyed the cache it was meant to
  // preserve — see the split in BcContainerProvider.clearCompilerFolders.
  // The shared artifact cache is NEVER purged from this path.
  if (options?.noCompilerCache) {
    await BcContainerProvider.clearCompilerFolders();
  }
```

- [ ] **Step 4: Gate the call in `setupContainers`**

Replace lines 179-180 (the identical pair inside `setupContainers`) with exactly the same gated block as Step 3.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `deno test --allow-all tests/unit/cli/container-setup.test.ts`

Expected: PASS, including the four pre-existing `endOfRunNuke` tests and the `cleanupContainer` tests.

- [ ] **Step 6: Verify, format, commit**

```bash
deno check cli/commands/bench/container-setup.ts tests/unit/cli/container-setup.test.ts
deno lint cli/commands/bench tests/unit/cli
deno fmt cli/commands/bench/container-setup.ts tests/unit/cli/container-setup.test.ts
git add cli/commands/bench/container-setup.ts tests/unit/cli/container-setup.test.ts
git commit -m "fix(bench): stop destroying the compiler cache on every startup

setupContainer and setupContainers called clearCompilerCache()
unconditionally, deleting both the CentralGauge-* compiler folders and the
shared BCH artifact cache before every run. Folder clearing is now gated on
--no-compiler-cache, and the artifact cache is never purged from the startup
path at all.

Ordinary startup therefore preserves both, which is the precondition for any
cross-process compiler-folder reuse."
```

---

### Task 3: Expose the artifact-cache purge to operators

Task 2 removed the implicit purge, which was also an accidental self-heal for a cache left incomplete by an interrupted run. Operators need a deliberate way back.

**Files:**
- Modify: `cli/commands/doctor-command.ts` (add a subcommand alongside `ingest` at `:137` and `admin` at `:168`)
- Test: `tests/unit/cli/doctor-purge-cache.test.ts` (create)

**Interfaces:**
- Consumes: `BcContainerProvider.purgeArtifactCache(cacheDir?)` from Task 1.
- Produces: `centralgauge doctor purge-compiler-cache` CLI command, and an exported `runPurgeCompilerCache(): Promise<void>` for direct testing.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/cli/doctor-purge-cache.test.ts`:

```typescript
// The artifact cache purge is the operator escape hatch for a cache left
// incomplete by a run killed mid-population. BCH only repopulates when
// `symbols/` is absent, so a partial cache is otherwise sticky forever.
import { assertEquals } from "@std/assert";
import { BcContainerProvider } from "../../../src/container/bc-container-provider.ts";
import { runPurgeCompilerCache } from "../../../cli/commands/doctor-command.ts";

Deno.test("runPurgeCompilerCache delegates to purgeArtifactCache", async () => {
  let called = false;
  const original = BcContainerProvider.purgeArtifactCache;
  Object.defineProperty(BcContainerProvider, "purgeArtifactCache", {
    value: () => {
      called = true;
      return Promise.resolve();
    },
    configurable: true,
  });

  try {
    await runPurgeCompilerCache();
    assertEquals(called, true);
  } finally {
    Object.defineProperty(BcContainerProvider, "purgeArtifactCache", {
      value: original,
      configurable: true,
    });
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `deno test --allow-all tests/unit/cli/doctor-purge-cache.test.ts`

Expected: FAIL — `runPurgeCompilerCache` is not exported from `doctor-command.ts`.

- [ ] **Step 3: Implement the handler and register the subcommand**

In `cli/commands/doctor-command.ts`, add the import (following the file's existing import ordering):

```typescript
import { BcContainerProvider } from "../../src/container/bc-container-provider.ts";
```

Add the exported handler at module scope, above the function that builds `doctorCmd`:

```typescript
/**
 * Purge the shared BCH artifact cache.
 *
 * Bench startup no longer does this implicitly (it was destroying the cache
 * it was meant to preserve). The one case that still needs it: a run killed
 * mid-population leaves `symbols/` present but incomplete, and BCH's
 * population gate is `!(Test-Path $symbolsPath)` — so every later run
 * silently builds from the broken cache until it is purged by hand.
 */
export async function runPurgeCompilerCache(): Promise<void> {
  await BcContainerProvider.purgeArtifactCache();
  console.log(colors.green("[OK]") + " Compiler artifact cache purged.");
  console.log(
    colors.gray("  The next bench run repopulates it (slower than usual)."),
  );
}
```

If `colors` is not already imported in this file, add `import * as colors from "@std/fmt/colors";` to the `@std` import group.

Then register the subcommand immediately after the `admin` block (after `:185`, before `cli.command("doctor", doctorCmd)`):

```typescript
  doctorCmd
    .command(
      "purge-compiler-cache",
      "Purge the shared BCH artifact cache (maintenance; forces a full re-download next run)",
    )
    .action(() => runPurgeCompilerCache());
```

Finally, update the bare `doctor` action's help text at `:128-134` so the new section is discoverable:

```typescript
    .action(() => {
      console.log("Available sections: ingest, admin, purge-compiler-cache");
      console.log(
        "Run `centralgauge doctor ingest` to check ingest health (bench/publish).",
      );
      console.log(
        "Run `centralgauge doctor admin` to check admin health (lifecycle status/digest).",
      );
      console.log(
        "Run `centralgauge doctor purge-compiler-cache` to clear a corrupted BCH artifact cache.",
      );
    });
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `deno test --allow-all tests/unit/cli/doctor-purge-cache.test.ts`

Expected: PASS.

- [ ] **Step 5: Verify the command is reachable**

Run: `deno task start doctor`

Expected: the printed section list includes `purge-compiler-cache`.

Run: `deno task start doctor purge-compiler-cache --help`

Expected: the description renders. **Do not run it without `--help`** unless you actually intend to force a full artifact re-download on the next bench.

- [ ] **Step 6: Verify, format, commit**

```bash
deno check cli/commands/doctor-command.ts tests/unit/cli/doctor-purge-cache.test.ts
deno lint cli/commands tests/unit/cli
deno fmt cli/commands/doctor-command.ts tests/unit/cli/doctor-purge-cache.test.ts
git add cli/commands/doctor-command.ts tests/unit/cli/doctor-purge-cache.test.ts
git commit -m "feat(doctor): add purge-compiler-cache maintenance command

Bench startup no longer purges the BCH artifact cache implicitly, which also
removed an accidental self-heal: BCH repopulates the cache only when
symbols/ is absent, so a run killed mid-population leaves a partial cache
that every later run silently builds from. This is the deliberate way out."
```

---

### Task 4: Add startup trace spans

The tracer is already fully wired — `--trace` / `--trace-file` flags at `bench-command.ts:213-217`, path resolution at `:240`, a root `bench` span at `:261`, and `closeTracer()` at `:733`. All that is missing is spans on the startup phases, which is where the unmeasured time is.

**Files:**
- Modify: `cli/commands/bench/container-setup.ts`
- Test: `tests/unit/cli/container-setup-tracing.test.ts` (create)

**Interfaces:**
- Consumes: `setupContainers` behaviour from Task 2; `getTracer`, `initTracer`, `closeTracer` from `src/tracing/tracer.ts`.
- Produces: trace spans named `setup.health`, `setup.prenuke`, `setup.warmup-compiler`, `setup.harness`, each with `cat: "setup"`. `setup.health` carries `args: { container }`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/cli/container-setup-tracing.test.ts`:

```typescript
// The startup path is where the unmeasured bench time lives. These spans are
// what turn the spec's ranked hypothesis (cold-spawn tax vs compiler rebuild
// vs per-task variance) into a measurement.
import { assertEquals } from "@std/assert";
import type { ContainerProvider } from "../../../src/container/interface.ts";
import { setupContainers } from "../../../cli/commands/bench/container-setup.ts";
import { ContainerProviderRegistry } from "../../../src/container/registry.ts";
import { closeTracer, initTracer } from "../../../src/tracing/tracer.ts";

Deno.test("setupContainers emits a span for each startup phase", async () => {
  const provider = {
    isHealthy: () => Promise.resolve(true),
    setCredentials: () => {},
    prenukeCentralGaugeApps: () => Promise.resolve(),
    warmupCompilerFolders: () => Promise.resolve(),
    ensureTestHarness: () => Promise.resolve(),
  } as unknown as ContainerProvider;
  ContainerProviderRegistry.register("fake-trace", () => provider);

  const traceFile = await Deno.makeTempFile({ suffix: ".json" });
  try {
    initTracer(traceFile);
    await setupContainers(["Cronus28", "Cronus282"], "fake-trace", {
      name: "Cronus28",
    });
    await closeTracer();

    const trace = JSON.parse(await Deno.readTextFile(traceFile)) as {
      traceEvents: Array<{ name: string; ph: string; args?: Record<string, unknown> }>;
    };
    const spanNames = trace.traceEvents
      .filter((e) => e.ph === "X")
      .map((e) => e.name)
      .sort();

    assertEquals(spanNames, [
      "setup.harness",
      "setup.health",
      "setup.health",
      "setup.prenuke",
      "setup.warmup-compiler",
    ]);

    // Health spans are per-container and must say which one.
    const healthArgs = trace.traceEvents
      .filter((e) => e.ph === "X" && e.name === "setup.health")
      .map((e) => e.args?.container)
      .sort();
    assertEquals(healthArgs, ["Cronus28", "Cronus282"]);
  } finally {
    await closeTracer();
    await Deno.remove(traceFile).catch(() => {});
    ContainerProviderRegistry.clearInstances();
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `deno test --allow-all tests/unit/cli/container-setup-tracing.test.ts`

Expected: FAIL — the assertion on `spanNames` gets `[]` because no spans are emitted yet.

- [ ] **Step 3: Add the tracer import**

In `cli/commands/bench/container-setup.ts`, add to the implementation-import group:

```typescript
import { getTracer } from "../../../src/tracing/tracer.ts";
```

Check the relative depth against the file's existing project imports and match it.

- [ ] **Step 4: Wrap the health-check loop in `setupContainers`**

In the `for (const name of containerNames)` loop (starting `:198`), wrap the health probe. Replace:

```typescript
    let healthy = false;
    try {
      healthy = await containerProvider.isHealthy(name);
    } catch {
      // container doesn't exist
    }
```

with:

```typescript
    let healthy = false;
    try {
      healthy = await getTracer().span(
        "setup.health",
        { cat: "setup", args: { container: name } },
        () => containerProvider.isHealthy(name),
      );
    } catch {
      // container doesn't exist
    }
```

- [ ] **Step 5: Wrap prenuke, warmup and harness in `setupContainers`**

Replace the three blocks at `:228-245` with:

```typescript
  // Pre-nuke any stale CentralGauge apps left over from a previous bench
  // that was killed mid-test — without this the next publishApp hits
  // bccontainerhelper@6.1.11's Unpublish-success-but-not-really race.
  if ("prenukeCentralGaugeApps" in containerProvider) {
    await getTracer().span(
      "setup.prenuke",
      { cat: "setup" },
      () =>
        (containerProvider as BcContainerProvider)
          .prenukeCentralGaugeApps(containerNames),
    );
  }

  // Pre-create compiler folders for all containers before any work is enqueued
  if ("warmupCompilerFolders" in containerProvider) {
    await getTracer().span(
      "setup.warmup-compiler",
      { cat: "setup" },
      () =>
        (containerProvider as BcContainerProvider).warmupCompilerFolders(
          containerNames,
        ),
    );
  }

  // Publish test harness during setup
  if ("ensureTestHarness" in containerProvider) {
    await getTracer().span(
      "setup.harness",
      { cat: "setup" },
      () =>
        (containerProvider as BcContainerProvider).ensureTestHarness(
          containerNames,
        ),
    );
  }
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `deno test --allow-all tests/unit/cli/container-setup-tracing.test.ts`

Expected: PASS.

- [ ] **Step 7: Confirm the tracing tests did not break Task 2's tests**

Run: `deno test --allow-all tests/unit/cli/container-setup.test.ts`

Expected: PASS. The tracer is disabled by default (`DISABLED_TRACER` passes the body straight through), so Task 2's tests see no behaviour change.

- [ ] **Step 8: Verify, format, commit**

```bash
deno check cli/commands/bench/container-setup.ts tests/unit/cli/container-setup-tracing.test.ts
deno lint cli/commands/bench tests/unit/cli
deno fmt cli/commands/bench/container-setup.ts tests/unit/cli/container-setup-tracing.test.ts
git add cli/commands/bench/container-setup.ts tests/unit/cli/container-setup-tracing.test.ts
git commit -m "feat(bench): trace the container startup phases

Adds setup.health (per container), setup.prenuke, setup.warmup-compiler and
setup.harness spans to the already-wired tracer. The startup split has never
been measured, so the ranked hypothesis in the spec -- cold-spawn tax vs
compiler-folder rebuild vs per-task variance -- has had nothing to test it."
```

---

### Task 5: Drop the dead `-includeTestToolkit` argument

`New-BcCompilerFolder` in the pinned BCH 6.1.14 has no such parameter (param block at `New-BcCompilerFolder.ps1:35-42`), and the function has no `[CmdletBinding()]`, so PowerShell silently swallows the argument into `$args`. Verified by experiment:

```
bound: url=http://x/a/b/c/28.0/w1 name=CG-Cronus28 includeAL=False
args: -includeTestToolkit
```

**Do not "fix" this to `-includeAL`.** `includeAL=$true` forces `Download-Artifacts` on every call via the `:83` gate, defeating the cache. Test-toolkit symbols already arrive through the unconditional app copy at `:157-166`.

**Files:**
- Modify: `src/container/bc-container-provider.ts:1170` (inside `createCompilerFolder`)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing. Behaviour is unchanged by construction — this removes an argument that was already inert.

- [ ] **Step 1: Confirm the argument is genuinely inert on this machine**

Run:

```bash
pwsh -NoProfile -Command "Get-Command New-BcCompilerFolder -Syntax"
```

Expected: a syntax line with `-artifactUrl`, `-containerName`, `-cacheFolder`, `-packagesFolder`, `-vsixFile`, `-includeAL` — and **no** `-includeTestToolkit`.

If `-includeTestToolkit` IS listed, a different BCH version is resolving than the pinned 6.1.14 (this machine has 17 copies under `Program Files` and 8 under `Documents`). **Stop and report** — that is a pin-integrity problem worth more than this cleanup.

- [ ] **Step 2: Remove the argument**

In `src/container/bc-container-provider.ts`, in the script template inside `createCompilerFolder` (near `:1170`), change:

```typescript
      $compilerFolder = New-BcCompilerFolder -artifactUrl $artifactUrl -includeTestToolkit${cacheParams}
```

to:

```typescript
      # No -includeTestToolkit: BCH 6.1.14's New-BcCompilerFolder has no such
      # parameter (it lands in $args and is ignored). Do NOT substitute
      # -includeAL — that forces Download-Artifacts on every call and defeats
      # the cache. Test-toolkit symbols arrive via the unconditional app copy
      # inside New-BcCompilerFolder.
      $compilerFolder = New-BcCompilerFolder -artifactUrl $artifactUrl${cacheParams}
```

Watch the interpolation: `${cacheParams}` must stay directly appended with no space before it, exactly as now.

- [ ] **Step 3: Run the container provider tests**

Run: `deno test --allow-all tests/unit/container/bc-container-provider.test.ts`

Expected: PASS. Behaviour is unchanged, so no test should move.

- [ ] **Step 4: Verify, format, commit**

```bash
deno check src/container/bc-container-provider.ts
deno lint src/container
deno fmt src/container/bc-container-provider.ts
git add src/container/bc-container-provider.ts
git commit -m "chore(container): drop inert -includeTestToolkit argument

BCH 6.1.14's New-BcCompilerFolder has no -includeTestToolkit parameter and no
[CmdletBinding()], so the argument was silently swallowed into \$args. The
call read as if the toolkit were explicitly requested when it never was.

Deliberately not replaced with -includeAL: that flag forces Download-Artifacts
on every call regardless of a warm cache. Test-toolkit symbols already arrive
via the unconditional app copy inside New-BcCompilerFolder."
```

---

### Task 6: Verify the `--no-compiler-cache` provenance, then drop it from `run-xbench.ps1`

The spec flags this as **unverified**: the claim that commit 4a2f8e7 added `--no-compiler-cache` as a plain opt-out came from a `git log -S` summary, not from reading the diff. If it was added to work around cache corruption, Task 2 makes that corruption *more* likely, not less — so this must be checked before the flag is removed anywhere.

**Files:**
- Modify: `run-xbench.ps1:54`

**Interfaces:**
- Consumes: Task 2's gating (without it, dropping the flag changes nothing useful).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Read the actual commit**

```bash
git show 4a2f8e7 --stat
git show 4a2f8e7 -- cli/commands/bench-command.ts src/container/bc-container-provider.ts
```

Read the commit message and diff. Decide: was the flag introduced as a neutral opt-out, or as a workaround for a specific cache failure?

- [ ] **Step 2: Branch on the answer**

**If it was a neutral opt-out** (expected): continue to Step 3.

**If it was a corruption workaround:** STOP. Do not remove the flag. Record the finding in `docs/superpowers/specs/2026-07-24-fast-trap-iteration-design.md` under F2, replacing the "*Unverified*" note with what the commit actually says, and commit that doc change alone. Then report — Task 2's safety needs re-examination before anything else proceeds.

- [ ] **Step 3: Remove the flag from the shakedown wrapper**

In `run-xbench.ps1`, delete this line from the `$benchArgs` array (currently `:54`):

```powershell
  "--no-compiler-cache",
```

- [ ] **Step 4: Confirm the script still parses**

Run: `pwsh -NoProfile -Command "& { . ./run-xbench.ps1 -WhatIf } " 2>&1 | Select-Object -First 5`

If the script has no `-WhatIf` support (it does not), instead just parse-check it:

```bash
pwsh -NoProfile -Command "\$null = [System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path ./run-xbench.ps1), [ref]\$null, [ref]\$null); 'parse ok'"
```

Expected: `parse ok`.

- [ ] **Step 5: Commit**

```bash
git add run-xbench.ps1
git commit -m "fix(bench): stop forcing artifact re-download in the shakedown wrapper

run-xbench.ps1 passed --no-compiler-cache, which strips both -cacheFolder and
the deterministic -containerName from New-BcCompilerFolder. Across five
containers that meant five serialized full artifact downloads and
extractions on every run. The flag's own help text says 're-downloads
artifacts each run'; commit 4a2f8e7 added it as a plain opt-out with no bug
workaround attached (verified by reading the diff)."
```

---

### Task 7: Create the `run-xiterate.ps1` wrapper

One task, three models, with the sanity lane isolated onto Cronus28 so a `Commit()`ing oracle cannot poison the containers the models run on.

**Files:**
- Create: `run-xiterate.ps1`

**Interfaces:**
- Consumes: Task 2's gating (so the run is actually warm), Task 6's decision on `--no-compiler-cache`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the script**

Create `run-xiterate.ps1`:

```powershell
#Requires -Version 7
<#
.SYNOPSIS
  Fast authoring loop for a SINGLE trap-task against ~3 models.

.DESCRIPTION
  FULLY LOCAL — never touches the prod scoreboard:
    * --no-ingest                    -> results are not uploaded
    * CENTRALGAUGE_BENCH_PRECHECK=0  -> belt-and-braces; --no-ingest alone
      already gates the precheck (bench-command.ts: `benchPrecheckEnabled &&
      options.ingest !== false`), but run-xbench.ps1 records a real prod
      pollution incident, so both stay.

  Container split is deliberate. The sanity lane runs the known-good reference
  solution through trap-probe on Cronus28; the model bench runs on the OTHER
  three containers. endOfRunNuke unpublishes apps but does NOT roll back data,
  and a trap oracle containing Commit() defeats the test runner's rollback —
  its rows then collide with the next run's [GIVEN] seed and score as a FALSE
  FAILURE with no infra signature to trigger a reroute. Sharing containers
  between lane and bench would manufacture exactly the false failures this
  loop exists to detect. Cronus28 is also the only container with credentials
  wired for trap-probe (others 401).

.EXAMPLE
  .\run-xiterate.ps1 tasks/hard/CG-AL-X037-inner-commit.yml

.EXAMPLE
  .\run-xiterate.ps1 tasks/hard/CG-AL-X037-inner-commit.yml -Models "anthropic/claude-opus-4-8,anthropic/claude-sonnet-4-6"
#>
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string] $TaskPath,

  [string] $Models = "anthropic/claude-opus-4-8,anthropic/claude-sonnet-4-6,anthropic/claude-haiku-4-5",

  # Bench containers. Cronus28 is deliberately EXCLUDED — it belongs to the
  # sanity lane. See .DESCRIPTION.
  [string] $Containers = "Cronus282,Cronus283,Cronus284",

  [string] $SanityContainer = "Cronus28",

  [string] $DebugOutput = "h:\Temp3",

  # Skip the sanity lane even when a reference solution exists.
  [switch] $NoSanity
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Test-Path $TaskPath)) { throw "Task file not found: $TaskPath" }

$env:CENTRALGAUGE_BENCH_PRECHECK = "0"

# Resolve the task id from the YAML's `id:` field — NOT the filename. The
# reference solution lives at scratch/<id>/correct/ and trap-probe takes an id.
$idLine = Select-String -Path $TaskPath -Pattern '^id:\s*(\S+)' | Select-Object -First 1
if (-not $idLine) { throw "No 'id:' field found in $TaskPath" }
$taskId = $idLine.Matches[0].Groups[1].Value
Write-Host "Task: $taskId  ($TaskPath)" -ForegroundColor Cyan

# ---- Sanity lane (optional, no LLM calls) -------------------------------
$correctDir = Join-Path "scratch" (Join-Path $taskId "correct")
if (-not $NoSanity -and (Test-Path $correctDir)) {
  Write-Host "Sanity lane: $correctDir on $SanityContainer" -ForegroundColor Cyan
  deno run -A scripts/trap-probe.ts `
    --task $taskId `
    --solution $correctDir `
    --expect pass `
    --container $SanityContainer
  $probe = $LASTEXITCODE
  if ($probe -eq 3) {
    Write-Host "[WARN] Sanity lane inconclusive (infra). Re-run it before trusting an all-fail result." -ForegroundColor Yellow
  } elseif ($probe -ne 0) {
    throw "Sanity lane FAILED: the reference solution does not pass this oracle. Fix the test before spending model calls."
  } else {
    Write-Host "[OK] Oracle is satisfiable — an all-models-fail result is real signal." -ForegroundColor Green
  }
} elseif (-not $NoSanity) {
  Write-Host "No reference solution at $correctDir — skipping sanity lane." -ForegroundColor DarkGray
}

# ---- Model bench --------------------------------------------------------
$benchArgs = @(
  "--llms",         $Models,
  "-t",             $TaskPath,
  "--no-ingest",
  "--no-dashboard",
  "--stream",
  "--containers",   $Containers,
  "--runs",         "1",
  "--attempts",     "2",
  "--debug-output", $DebugOutput,
  "--debug-level",  "verbose",
  "--debug"
)

Write-Host "Benching $taskId | models=$Models | containers=$Containers | LOCAL" -ForegroundColor Green
deno task start bench @benchArgs
exit $LASTEXITCODE
```

- [ ] **Step 2: Parse-check the script**

```bash
pwsh -NoProfile -Command "\$null = [System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path ./run-xiterate.ps1), [ref]\$null, [ref]\$null); 'parse ok'"
```

Expected: `parse ok`.

- [ ] **Step 3: Verify argument handling without running a bench**

```bash
pwsh -NoProfile -File ./run-xiterate.ps1 tasks/hard/does-not-exist.yml
```

Expected: throws `Task file not found: tasks/hard/does-not-exist.yml` and exits non-zero. This confirms the guard fires before any container or model work.

- [ ] **Step 4: Verify task-id extraction against a real task**

```bash
pwsh -NoProfile -Command "\$m = Select-String -Path 'tasks/hard/CG-AL-X035-poisoned-rescue.yml' -Pattern '^id:\s*(\S+)' | Select-Object -First 1; \$m.Matches[0].Groups[1].Value"
```

Expected: `CG-AL-X035`. If a different task file is present, substitute it — the point is that the regex extracts the id, not the filename.

- [ ] **Step 5: Commit**

```bash
git add run-xiterate.ps1
git commit -m "feat(bench): add run-xiterate.ps1 single-task authoring wrapper

One task, three models, --runs 1, local-only. The sanity lane runs the
reference solution through trap-probe on Cronus28 while the model bench runs
on Cronus282-284.

That split is load-bearing, not cosmetic: endOfRunNuke unpublishes apps but
does not roll back data, and a trap oracle containing Commit() defeats the
runner's rollback. Its rows collide with the next run's [GIVEN] seed and
score as a false failure with no infra signature to trigger a reroute --
inside the loop built to detect false failures. Cronus28 is also the only
container with trap-probe credentials wired."
```

---

### Task 8: Measure cold vs warm — the acceptance gate

This is what the whole plan is for. Everything above is justified only if this measurement shows a real delta, and the result decides whether W3 gets built at all.

**Files:**
- Create: `docs/superpowers/plans/2026-07-24-fast-trap-iteration-measurements.md`

**Interfaces:**
- Consumes: Tasks 1-7.
- Produces: the measured phase breakdown that Phase 2 planning (W3, W5) depends on.

- [ ] **Step 1: Confirm no bench is running**

```bash
find results/.bench-running.json -mmin -2
```

Expected: no output. If the file is listed, a bench is live — wait, or the container work below will corrupt it.

- [ ] **Step 2: Capture a COLD baseline**

Force the cold path explicitly so this measures the old behaviour:

```bash
deno task start doctor purge-compiler-cache
pwsh -NoProfile -File ./run-xiterate.ps1 tasks/hard/CG-AL-X035-poisoned-rescue.yml -NoSanity
```

Before running, temporarily add `"--trace-file", "results/trace-cold.json",` to `$benchArgs` in `run-xiterate.ps1`. Record the wall time.

- [ ] **Step 3: Capture a WARM run**

Immediately after the cold run, without purging:

```bash
pwsh -NoProfile -File ./run-xiterate.ps1 tasks/hard/CG-AL-X035-poisoned-rescue.yml -NoSanity
```

with `--trace-file results/trace-warm.json`. Record the wall time.

- [ ] **Step 4: Extract the phase breakdown from both traces**

```bash
for f in results/trace-cold.json results/trace-warm.json; do
  echo "=== $f"
  jq -r '.traceEvents[] | select(.ph=="X") | select(.name|startswith("setup.")) | "\(.name)\t\(.dur/1000000)s"' "$f"
done
```

- [ ] **Step 5: Record the findings**

Create `docs/superpowers/plans/2026-07-24-fast-trap-iteration-measurements.md` with: cold vs warm total wall time; the per-phase `setup.*` durations for each; and a verdict paragraph ranking the four candidate constraints from the spec's "Binding-constraint hypothesis" section — per-task variance, LLM latency, cold-spawn tax, compiler folder rebuild.

Answer explicitly: **does compiler-folder rebuild account for enough of the delta to justify W3's cross-process locking and marker protocol?** If not, say so — a negative result here saves the whole of Phase 2's most complex workstream.

- [ ] **Step 6: Revert the temporary trace-file edits and commit**

Remove the hardcoded `--trace-file` lines from `run-xiterate.ps1` (a permanent `--trace` flag can be added later if it proves useful).

```bash
git add docs/superpowers/plans/2026-07-24-fast-trap-iteration-measurements.md run-xiterate.ps1
git commit -m "docs(bench): record cold vs warm startup measurements

Phase-by-phase setup.* span durations for a one-task, three-model run, cold
and warm. Ranks the spec's four candidate binding constraints against real
numbers for the first time, and decides whether W3 (cross-process compiler
folder adoption) is worth its complexity."
```

---

## Self-Review

**Spec coverage.** W2 → Tasks 1-3. W6 → Task 4. F7 → Task 5. W1 → Tasks 6-7. Acceptance test ("cold run then warm run comparing W6 spans") → Task 8. W3 and W5 are explicitly deferred with a stated gate, not silently dropped. The spec's four open questions are all answered by Task 8 except #2 (`ensureTestHarness` moving to the warm slot), which becomes actionable only once Task 8 shows whether `setup.harness` is material.

**Placeholder scan.** No TBD/TODO. Every code step carries the literal text to write. Task 8's judgement steps are measurements with exact commands, not "analyze the results".

**Type consistency.** `clearCompilerFolders` and `purgeArtifactCache` are named identically in Tasks 1, 2, 3 and their tests. `COMPILER_FOLDER_DIR` is defined in Task 1 and used only there. Span names `setup.health` / `setup.prenuke` / `setup.warmup-compiler` / `setup.harness` match between Task 4's implementation, its test, and Task 8's `jq` filter. `runPurgeCompilerCache` matches between Task 3's implementation, its test, and Task 8's Step 2 invocation.

**Known risk carried forward:** Task 2 removes the accidental self-heal for a partially-populated artifact cache. Task 3 is the deliberate replacement. If Task 8's cold run behaves oddly, purge first and re-measure.
