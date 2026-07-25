# Compiler-Folder Adoption + Single-Task Matrix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Skip the per-container compiler-folder rebuild when the existing folder is provably good, decided entirely host-side so no PowerShell spawns at all, and make a one-task bench run readable.

**Architecture:** `docker inspect` yields each container's `artifactUrl` in ~0.36 s — it is the exact source `Get-BcContainerArtifactUrl` reads. That lets TypeScript compute the cache key, read a marker file, stat the expected folder contents, and return without ever calling `pwsh`. Any validation failure falls through to today's rebuild script, which then writes the marker.

**Tech Stack:** Deno 2.x + TypeScript, Cliffy commands, `@std/assert` tests, `@std/fmt/colors`, Web Crypto (`crypto.subtle`) for SHA-256, existing Chrome-Trace tracer.

**Source spec:** `docs/superpowers/specs/2026-07-25-compiler-folder-adoption-design.md`

## Global Constraints

- Deno 2.x. Run tests only via `deno task test:unit` or scoped `deno test --allow-all <path>`; bare `deno test` lacks `--allow-all` and fails.
- Never pass `--parallel` to tests (shared static state).
- After every change: `deno check <changed-files>`, `deno lint <changed-dirs>`, `deno fmt <changed-files>` — scoped to changed files only. The repo has CRLF/LF drift; a directory-wide `deno fmt` rewrites dozens of unrelated files. Never `deno fmt` under `site/`.
- Console output uses `@std/fmt/colors` (`colors.green("[OK]")`), never emojis.
- Import order: `@std/...`, then type imports from project modules, then implementation imports, then relative imports.
- Deno 2.8: mock statics and `Deno.*` globals with `Object.defineProperty(Obj, "name", { value, configurable: true })`, never plain assignment; restore in `finally`.
- **SAFETY:** `BcContainerProvider.clearCompilerFolders()` and `purgeArtifactCache()` with default arguments delete real directories under `C:\ProgramData\BcContainerHelper`. Every test passes an explicit temp path or stubs the static.
- Never run container-touching tests while a bench is live. Check `find results/.bench-running.json -mmin -2` (no output = safe); otherwise use `--ignore=tests/unit/container`.
- Cliffy footgun: a `--no-X` option must NOT declare `{ default: false }` — cliffy treats the default as the value and the field is permanently false.
- BCH is pinned to 6.1.14 via `BCCH_PINNED_VERSION` in `src/container/bcch-config.ts`. A bare `pwsh` on this machine resolves 6.1.15 — import the pin explicitly for any ad-hoc check.
- Shell is Git Bash on Windows; use Windows paths in tool calls. Never `2>nul`.
- Commit after each task, conventional-commit prefixes. Do not push.

---

### Task 1: Cache-key derivation in TypeScript

Phase 1 computed this hash inside PowerShell because `$artifactUrl` was only known in-script. It is about to be known host-side, so the hash moves to TypeScript where it is testable — and the PowerShell copy is deleted in Task 5 rather than duplicated.

**Files:**
- Create: `src/container/compiler-cache-key.ts`
- Test: `tests/unit/container/compiler-cache-key.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export async function compilerCacheKey(artifactUrl: string): Promise<string>` — 12 lowercase hex chars.
  - `export function normalizeArtifactUrl(url: string): string` — strips the query string at the first `?`.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/container/compiler-cache-key.test.ts`:

```typescript
import { assertEquals, assertNotEquals } from "@std/assert";
import {
  compilerCacheKey,
  normalizeArtifactUrl,
} from "../../../src/container/compiler-cache-key.ts";

const BASE = "https://bcartifacts.azureedge.net/sandbox/28.3.52162.52884/dk";

Deno.test("normalizeArtifactUrl strips the query string at the first ?", () => {
  assertEquals(normalizeArtifactUrl(`${BASE}?sv=2021&sig=abc`), BASE);
  assertEquals(normalizeArtifactUrl(`${BASE}?a=1?b=2`), BASE);
  assertEquals(normalizeArtifactUrl(BASE), BASE);
});

Deno.test("compilerCacheKey is 12 lowercase hex chars", async () => {
  const key = await compilerCacheKey(BASE);
  assertEquals(key.length, 12);
  assertEquals(/^[0-9a-f]{12}$/.test(key), true);
});

Deno.test("compilerCacheKey is deterministic", async () => {
  assertEquals(await compilerCacheKey(BASE), await compilerCacheKey(BASE));
});

Deno.test("compilerCacheKey ignores a SAS token", async () => {
  // A volatile SAS token must not churn the key — that would silently defeat
  // the cache on every run.
  assertEquals(
    await compilerCacheKey(`${BASE}?sv=2021&sig=abc`),
    await compilerCacheKey(BASE),
  );
});

Deno.test("compilerCacheKey changes when the BC version changes", async () => {
  // This is the whole point: an artifact upgrade must land in a fresh cache.
  assertNotEquals(
    await compilerCacheKey(BASE),
    await compilerCacheKey(
      "https://bcartifacts.azureedge.net/sandbox/28.4.00000.00000/dk",
    ),
  );
});

Deno.test("compilerCacheKey changes when the country changes", async () => {
  assertNotEquals(
    await compilerCacheKey(BASE),
    await compilerCacheKey(
      "https://bcartifacts.azureedge.net/sandbox/28.3.52162.52884/w1",
    ),
  );
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `deno test --allow-all tests/unit/container/compiler-cache-key.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/container/compiler-cache-key.ts`:

```typescript
/**
 * Artifact-URL-keyed compiler cache naming.
 *
 * BCH repopulates a compiler cache only when its `symbols/` folder is absent,
 * so a single unkeyed cache directory serves every artifact URL forever once
 * populated — meaning a BC artifact upgrade would silently compile against the
 * previous version's symbols. Keying the directory by artifact URL makes an
 * upgrade land in a fresh directory that BCH populates normally.
 *
 * This lives in TypeScript (not the PowerShell script that calls
 * New-BcCompilerFolder) because the artifact URL is resolved host-side via
 * `docker inspect`. Keep it that way: two implementations of the same hash
 * that must agree and cannot be compared is worse than one that is tested.
 */

/**
 * Strip the query string. Some artifact URLs carry a SAS token; hashing it
 * would produce a different key on every run and defeat the cache entirely.
 * BCH normalizes the same way (`New-BcCompilerFolder.ps1:46` uses
 * `$artifactUrl.Split('?')[0]`).
 */
export function normalizeArtifactUrl(url: string): string {
  const q = url.indexOf("?");
  return q === -1 ? url : url.slice(0, q);
}

/** 12 lowercase hex chars of SHA-256 over the normalized artifact URL. */
export async function compilerCacheKey(artifactUrl: string): Promise<string> {
  const bytes = new TextEncoder().encode(normalizeArtifactUrl(artifactUrl));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 12);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `deno test --allow-all tests/unit/container/compiler-cache-key.test.ts`

Expected: PASS (6 tests).

- [ ] **Step 5: Verify, format, commit**

```bash
deno check src/container/compiler-cache-key.ts tests/unit/container/compiler-cache-key.test.ts
deno lint src/container tests/unit/container
deno fmt src/container/compiler-cache-key.ts tests/unit/container/compiler-cache-key.test.ts
git add src/container/compiler-cache-key.ts tests/unit/container/compiler-cache-key.test.ts
git commit -m "feat(container): add testable TypeScript compiler-cache-key derivation

Phase 1 computed this hash inside the PowerShell script because the artifact
URL was only resolved in-script, which left the derivation untestable. The
artifact URL is about to be resolved host-side, so the hash moves here."
```

---

### Task 2: Resolve artifact URL and running state via `docker inspect`

`Get-BcContainerArtifactUrl` is, in full (`BcContainerHelper/6.1.14/ContainerInfo/Get-NavContainerArtifactUrl.ps1:19-23`), a `docker inspect` piped into `ConvertFrom-Json` that reads the `artifactUrl=` environment entry. Calling `docker inspect` directly is therefore an exact substitute — same source, same value — at ~0.36 s against roughly 5 s for a cold `pwsh` plus `bcchImport()`.

**Files:**
- Create: `src/container/docker-inspect.ts`
- Test: `tests/unit/container/docker-inspect.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export interface ContainerInspection { artifactUrl: string | undefined; running: boolean; }`
  - `export async function inspectContainer(containerName: string): Promise<ContainerInspection | undefined>` — `undefined` when the container does not exist or `docker` fails.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/container/docker-inspect.test.ts`:

```typescript
import { assertEquals } from "@std/assert";
import { parseInspectJson } from "../../../src/container/docker-inspect.ts";

// Shape mirrors real `docker inspect <name>` output, trimmed to what we read.
function inspectPayload(env: string[], running: boolean): string {
  return JSON.stringify([{ Config: { Env: env }, State: { Running: running } }]);
}

Deno.test("parseInspectJson reads artifactUrl and running state", () => {
  const out = parseInspectJson(
    inspectPayload([
      "foo=bar",
      "artifactUrl=https://x/sandbox/28.3/dk",
      "platformArtifactUrl=",
    ], true),
  );
  assertEquals(out?.artifactUrl, "https://x/sandbox/28.3/dk");
  assertEquals(out?.running, true);
});

Deno.test("parseInspectJson reports a stopped container as not running", () => {
  // This is the Cronus284 case: Test-BcContainer reported it healthy while
  // Docker reported it not running, and the whole bench measured wrong.
  const out = parseInspectJson(
    inspectPayload(["artifactUrl=https://x/sandbox/28.3/dk"], false),
  );
  assertEquals(out?.running, false);
});

Deno.test("parseInspectJson returns undefined artifactUrl when absent", () => {
  const out = parseInspectJson(inspectPayload(["foo=bar"], true));
  assertEquals(out?.artifactUrl, undefined);
  assertEquals(out?.running, true);
});

Deno.test("parseInspectJson returns undefined on unusable output", () => {
  assertEquals(parseInspectJson(""), undefined);
  assertEquals(parseInspectJson("not json"), undefined);
  assertEquals(parseInspectJson("[]"), undefined);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `deno test --allow-all tests/unit/container/docker-inspect.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/container/docker-inspect.ts`:

```typescript
import { log } from "../utils/logger.ts";

/** The two facts we read straight from Docker, no BCH involved. */
export interface ContainerInspection {
  /** Value of the container's `artifactUrl` env entry, if present. */
  artifactUrl: string | undefined;
  /** Docker's own view of whether the container is running. */
  running: boolean;
}

/**
 * Parse `docker inspect <name>` output.
 *
 * Split out from the subprocess call so it is unit-testable without Docker.
 */
export function parseInspectJson(raw: string): ContainerInspection | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return undefined;
  const entry = parsed[0] as {
    Config?: { Env?: unknown };
    State?: { Running?: unknown };
  };
  const env = Array.isArray(entry.Config?.Env)
    ? entry.Config.Env as string[]
    : [];
  const hit = env.find((e) => typeof e === "string" && e.startsWith("artifactUrl="));
  return {
    artifactUrl: hit ? hit.slice("artifactUrl=".length) : undefined,
    running: entry.State?.Running === true,
  };
}

/**
 * Read a container's artifact URL and running state directly from Docker.
 *
 * This is exactly what `Get-BcContainerArtifactUrl` does
 * (`Get-NavContainerArtifactUrl.ps1:19-23`: `docker inspect | ConvertFrom-Json`,
 * then the `artifactUrl=` env entry), so it is an exact substitute rather than
 * an approximation — at roughly 0.36 s against ~5 s for a cold pwsh plus
 * `bcchImport()`. Works on stopped containers.
 *
 * Returns `undefined` when the container does not exist or `docker` fails;
 * callers treat that as "cannot adopt" and fall back to a rebuild.
 */
export async function inspectContainer(
  containerName: string,
): Promise<ContainerInspection | undefined> {
  try {
    const cmd = new Deno.Command("docker", {
      args: ["inspect", containerName],
      stdout: "piped",
      stderr: "null",
    });
    const { code, stdout } = await cmd.output();
    if (code !== 0) return undefined;
    return parseInspectJson(new TextDecoder().decode(stdout));
  } catch (error) {
    log.warn(`docker inspect failed for ${containerName}: ${error}`);
    return undefined;
  }
}
```

Check `src/utils/logger.ts` exports `log` with a `warn` method and match the import path other files in `src/container/` use.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `deno test --allow-all tests/unit/container/docker-inspect.test.ts`

Expected: PASS (4 tests).

- [ ] **Step 5: Sanity-check against a real container**

```bash
docker inspect Cronus28 --format '{{json .Config.Env}}' | tr ',' '\n' | grep artifactUrl
```

Expected: a line like `"artifactUrl=https://bcartifacts-....azurefd.net/sandbox/28.3.52162.52884/dk"`. Record the value in your report — Task 5 uses it to sanity-check the derived cache-folder name.

- [ ] **Step 6: Verify, format, commit**

```bash
deno check src/container/docker-inspect.ts tests/unit/container/docker-inspect.test.ts
deno lint src/container tests/unit/container
deno fmt src/container/docker-inspect.ts tests/unit/container/docker-inspect.test.ts
git add src/container/docker-inspect.ts tests/unit/container/docker-inspect.test.ts
git commit -m "feat(container): read artifactUrl and running state via docker inspect

Get-BcContainerArtifactUrl is literally 'docker inspect | ConvertFrom-Json'
reading the artifactUrl env entry, so this is an exact substitute at ~0.36s
against ~5s for a cold pwsh plus bcchImport. Also surfaces Docker's own
running state, which Test-BcContainer does not reliably reflect."
```

---

### Task 3: Compiler-folder marker

**Files:**
- Create: `src/container/compiler-folder-marker.ts`
- Test: `tests/unit/container/compiler-folder-marker.test.ts`

**Interfaces:**
- Consumes: nothing (takes the artifact URL and BCH version as arguments).
- Produces:
  - `export const MARKER_FILENAME = ".centralgauge-marker.json"`
  - `export const LAYOUT_VERSION = 1`
  - `export interface FolderMarker { layoutVersion: number; artifactUrl: string; cacheKey: string; bchVersion: string; containerName: string; createdAt: string; }`
  - `export async function writeMarker(folder: string, marker: FolderMarker): Promise<void>` — temp-then-rename.
  - `export async function validateFolder(folder: string, expected: { artifactUrl: string; bchVersion: string }): Promise<{ ok: true } | { ok: false; reason: string }>`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/container/compiler-folder-marker.test.ts`:

```typescript
import { assertEquals } from "@std/assert";
import {
  LAYOUT_VERSION,
  MARKER_FILENAME,
  validateFolder,
  writeMarker,
} from "../../../src/container/compiler-folder-marker.ts";

const URL_A = "https://x/sandbox/28.3.52162.52884/dk";
const BCH = "6.1.14";

/** Build a folder that satisfies every expected-file check. */
async function makeGoodFolder(): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "cg-marker-" });
  await Deno.mkdir(`${dir}/compiler/extension/bin`, { recursive: true });
  await Deno.writeTextFile(`${dir}/compiler/extension/bin/alc.exe`, "x");
  await Deno.mkdir(`${dir}/symbols`, { recursive: true });
  await Deno.writeTextFile(`${dir}/symbols/Base.app`, "x");
  await Deno.writeTextFile(`${dir}/symbols/cache_AppInfo.json`, "{}");
  await Deno.writeTextFile(`${dir}/manifest.json`, "{}");
  await Deno.mkdir(`${dir}/dlls/Test Assemblies`, { recursive: true });
  await writeMarker(dir, {
    layoutVersion: LAYOUT_VERSION,
    artifactUrl: URL_A,
    cacheKey: "036dceedc9cc",
    bchVersion: BCH,
    containerName: "Cronus282",
    createdAt: "2026-07-25T00:00:00.000Z",
  });
  return dir;
}

Deno.test("validateFolder accepts a complete, matching folder", async () => {
  const dir = await makeGoodFolder();
  try {
    const r = await validateFolder(dir, { artifactUrl: URL_A, bchVersion: BCH });
    assertEquals(r.ok, true);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("validateFolder rejects an artifact-URL mismatch", async () => {
  // The staleness case: adopting here would compile against old symbols.
  const dir = await makeGoodFolder();
  try {
    const r = await validateFolder(dir, {
      artifactUrl: "https://x/sandbox/28.4.00000.00000/dk",
      bchVersion: BCH,
    });
    assertEquals(r.ok, false);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("validateFolder rejects a BCH-version mismatch", async () => {
  const dir = await makeGoodFolder();
  try {
    const r = await validateFolder(dir, {
      artifactUrl: URL_A,
      bchVersion: "6.1.15",
    });
    assertEquals(r.ok, false);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("validateFolder rejects a layout-version mismatch", async () => {
  const dir = await makeGoodFolder();
  try {
    await Deno.writeTextFile(
      `${dir}/${MARKER_FILENAME}`,
      JSON.stringify({
        layoutVersion: LAYOUT_VERSION + 1,
        artifactUrl: URL_A,
        cacheKey: "036dceedc9cc",
        bchVersion: BCH,
        containerName: "Cronus282",
        createdAt: "2026-07-25T00:00:00.000Z",
      }),
    );
    const r = await validateFolder(dir, { artifactUrl: URL_A, bchVersion: BCH });
    assertEquals(r.ok, false);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("validateFolder rejects a torn marker", async () => {
  const dir = await makeGoodFolder();
  try {
    await Deno.writeTextFile(`${dir}/${MARKER_FILENAME}`, '{"layoutVersion":1,');
    const r = await validateFolder(dir, { artifactUrl: URL_A, bchVersion: BCH });
    assertEquals(r.ok, false);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("validateFolder rejects a missing marker", async () => {
  const dir = await makeGoodFolder();
  try {
    await Deno.remove(`${dir}/${MARKER_FILENAME}`);
    const r = await validateFolder(dir, { artifactUrl: URL_A, bchVersion: BCH });
    assertEquals(r.ok, false);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("validateFolder rejects each missing expected entry", async () => {
  const victims = [
    "compiler/extension/bin",
    "symbols/cache_AppInfo.json",
    "manifest.json",
    "dlls/Test Assemblies",
  ];
  for (const victim of victims) {
    const dir = await makeGoodFolder();
    try {
      await Deno.remove(`${dir}/${victim}`, { recursive: true });
      const r = await validateFolder(dir, {
        artifactUrl: URL_A,
        bchVersion: BCH,
      });
      assertEquals(r.ok, false, `expected rebuild when ${victim} is missing`);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  }
});

Deno.test("validateFolder rejects a symbols folder with no .app", async () => {
  const dir = await makeGoodFolder();
  try {
    await Deno.remove(`${dir}/symbols/Base.app`);
    const r = await validateFolder(dir, { artifactUrl: URL_A, bchVersion: BCH });
    assertEquals(r.ok, false);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("writeMarker leaves no temp file behind", async () => {
  const dir = await Deno.makeTempDir({ prefix: "cg-marker-tmp-" });
  try {
    await writeMarker(dir, {
      layoutVersion: LAYOUT_VERSION,
      artifactUrl: URL_A,
      cacheKey: "036dceedc9cc",
      bchVersion: BCH,
      containerName: "Cronus282",
      createdAt: "2026-07-25T00:00:00.000Z",
    });
    const names: string[] = [];
    for await (const e of Deno.readDir(dir)) names.push(e.name);
    assertEquals(names, [MARKER_FILENAME]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `deno test --allow-all tests/unit/container/compiler-folder-marker.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/container/compiler-folder-marker.ts`:

```typescript
/**
 * Marker file proving a compiler folder is safe to adopt.
 *
 * `New-BcCompilerFolder` deletes and rebuilds the folder on every call
 * (`New-BcCompilerFolder.ps1:64-68`), which is the cost adoption removes. The
 * marker plus a concrete file check is what makes skipping that call safe.
 */

export const MARKER_FILENAME = ".centralgauge-marker.json";

/**
 * Bump to invalidate every marker on every machine at once — use this when the
 * expected-entry list below changes, rather than waiting for an artifact URL
 * to change.
 */
export const LAYOUT_VERSION = 1;

export interface FolderMarker {
  layoutVersion: number;
  artifactUrl: string;
  cacheKey: string;
  bchVersion: string;
  containerName: string;
  createdAt: string;
}

export type ValidationResult = { ok: true } | { ok: false; reason: string };

/**
 * Entries BCH populates that must all be present for the folder to be usable.
 * `dir` entries are checked for existence as directories; `file` entries as
 * files. `symbols` is special-cased: it must contain at least one `.app`.
 */
const EXPECTED: Array<{ path: string; kind: "dir" | "file" }> = [
  { path: "compiler/extension/bin", kind: "dir" },
  { path: "symbols", kind: "dir" },
  { path: "symbols/cache_AppInfo.json", kind: "file" },
  { path: "manifest.json", kind: "file" },
  { path: "dlls", kind: "dir" },
  { path: "dlls/Test Assemblies", kind: "dir" },
];

/** Atomic write: temp file then rename, so a torn marker can never validate. */
export async function writeMarker(
  folder: string,
  marker: FolderMarker,
): Promise<void> {
  const target = `${folder}/${MARKER_FILENAME}`;
  const tmp = `${target}.tmp-${Deno.pid}`;
  await Deno.writeTextFile(tmp, JSON.stringify(marker, null, 2));
  await Deno.rename(tmp, target);
}

/**
 * Decide whether an existing compiler folder can be adopted.
 *
 * Every failure returns a reason rather than throwing: adoption is an
 * optimization, and the caller falls back to a rebuild on any `ok: false`.
 */
export async function validateFolder(
  folder: string,
  expected: { artifactUrl: string; bchVersion: string },
): Promise<ValidationResult> {
  let marker: FolderMarker;
  try {
    marker = JSON.parse(
      await Deno.readTextFile(`${folder}/${MARKER_FILENAME}`),
    ) as FolderMarker;
  } catch {
    return { ok: false, reason: "marker missing or unreadable" };
  }

  if (marker.layoutVersion !== LAYOUT_VERSION) {
    return {
      ok: false,
      reason:
        `layout version ${marker.layoutVersion} != ${LAYOUT_VERSION}`,
    };
  }
  if (marker.artifactUrl !== expected.artifactUrl) {
    return { ok: false, reason: "artifact URL changed" };
  }
  if (marker.bchVersion !== expected.bchVersion) {
    return {
      ok: false,
      reason: `BCH version ${marker.bchVersion} != ${expected.bchVersion}`,
    };
  }

  for (const entry of EXPECTED) {
    try {
      const stat = await Deno.stat(`${folder}/${entry.path}`);
      if (entry.kind === "dir" && !stat.isDirectory) {
        return { ok: false, reason: `${entry.path} is not a directory` };
      }
      if (entry.kind === "file" && !stat.isFile) {
        return { ok: false, reason: `${entry.path} is not a file` };
      }
    } catch {
      return { ok: false, reason: `missing ${entry.path}` };
    }
  }

  // symbols/ must actually carry symbol packages, not just exist.
  let sawApp = false;
  try {
    for await (const e of Deno.readDir(`${folder}/symbols`)) {
      if (e.isFile && e.name.toLowerCase().endsWith(".app")) {
        sawApp = true;
        break;
      }
    }
  } catch {
    return { ok: false, reason: "symbols unreadable" };
  }
  if (!sawApp) return { ok: false, reason: "symbols contains no .app" };

  return { ok: true };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `deno test --allow-all tests/unit/container/compiler-folder-marker.test.ts`

Expected: PASS (9 tests).

- [ ] **Step 5: Verify, format, commit**

```bash
deno check src/container/compiler-folder-marker.ts tests/unit/container/compiler-folder-marker.test.ts
deno lint src/container tests/unit/container
deno fmt src/container/compiler-folder-marker.ts tests/unit/container/compiler-folder-marker.test.ts
git add src/container/compiler-folder-marker.ts tests/unit/container/compiler-folder-marker.test.ts
git commit -m "feat(container): add compiler-folder marker with concrete file validation

Marker carries artifact URL, BCH version and a layout version; validation also
stats every entry BCH populates. Written temp-then-rename so a torn marker can
never validate."
```

---

### Task 4: Cross-process folder lock

`trap-probe` and `bench` are deliberately separate processes, and `compilerFolderQueue` serializes only within one process. The adopt path is read-only and needs no lock; only rebuild mutates.

**Files:**
- Create: `src/container/folder-lock.ts`
- Test: `tests/unit/container/folder-lock.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export interface HeldLock { release(): Promise<void>; acquired: boolean; }`
  - `export async function acquireLock(lockPath: string, opts?: { timeoutMs?: number; staleMs?: number }): Promise<HeldLock>` — `acquired: false` means the timeout elapsed; the caller proceeds anyway (a redundant rebuild is wasteful, not incorrect).

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/container/folder-lock.test.ts`:

```typescript
import { assertEquals } from "@std/assert";
import { acquireLock } from "../../../src/container/folder-lock.ts";

Deno.test("acquireLock takes a free lock and releases it", async () => {
  const dir = await Deno.makeTempDir({ prefix: "cg-lock-" });
  try {
    const lock = await acquireLock(`${dir}/a.lock`);
    assertEquals(lock.acquired, true);
    await lock.release();
    // Released means re-acquirable.
    const again = await acquireLock(`${dir}/a.lock`);
    assertEquals(again.acquired, true);
    await again.release();
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("acquireLock times out when the lock is held by a live process", async () => {
  const dir = await Deno.makeTempDir({ prefix: "cg-lock-busy-" });
  try {
    const held = await acquireLock(`${dir}/b.lock`);
    assertEquals(held.acquired, true);
    // staleMs high so the live holder is never considered stale.
    const second = await acquireLock(`${dir}/b.lock`, {
      timeoutMs: 150,
      staleMs: 60_000,
    });
    // Not acquired — but the caller still proceeds, so this must not throw.
    assertEquals(second.acquired, false);
    await held.release();
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("acquireLock breaks a stale lock", async () => {
  const dir = await Deno.makeTempDir({ prefix: "cg-lock-stale-" });
  try {
    // A lock file from a process that died without releasing.
    await Deno.writeTextFile(
      `${dir}/c.lock`,
      JSON.stringify({ pid: 999999, at: new Date(0).toISOString() }),
    );
    const lock = await acquireLock(`${dir}/c.lock`, {
      timeoutMs: 2000,
      staleMs: 1,
    });
    assertEquals(lock.acquired, true);
    await lock.release();
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("release is safe to call twice", async () => {
  const dir = await Deno.makeTempDir({ prefix: "cg-lock-rel-" });
  try {
    const lock = await acquireLock(`${dir}/d.lock`);
    await lock.release();
    await lock.release();
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `deno test --allow-all tests/unit/container/folder-lock.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/container/folder-lock.ts`:

```typescript
import { log } from "../utils/logger.ts";

/**
 * Cross-process advisory lock built on atomic file creation.
 *
 * Needed because `trap-probe` and `bench` run as separate processes by design,
 * so the in-process `compilerFolderQueue` cannot serialize them. Only the
 * rebuild path takes this lock — adoption is read-only.
 */
export interface HeldLock {
  /** False when the timeout elapsed. Callers proceed anyway. */
  acquired: boolean;
  release(): Promise<void>;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_STALE_MS = 300_000;
const POLL_MS = 200;

interface LockPayload {
  pid: number;
  at: string;
}

function processAlive(pid: number): boolean {
  try {
    // Signal 0 checks for existence without delivering a signal.
    Deno.kill(pid, "SIGCONT");
    return true;
  } catch {
    return false;
  }
}

async function breakIfStale(lockPath: string, staleMs: number): Promise<void> {
  let payload: LockPayload;
  let mtime: Date | null = null;
  try {
    const stat = await Deno.stat(lockPath);
    mtime = stat.mtime;
    payload = JSON.parse(await Deno.readTextFile(lockPath)) as LockPayload;
  } catch {
    // Unreadable or already gone — nothing to break.
    return;
  }
  const ageMs = mtime ? Date.now() - mtime.getTime() : Number.MAX_SAFE_INTEGER;
  if (ageMs < staleMs) return;
  if (payload.pid && processAlive(payload.pid)) return;
  try {
    await Deno.remove(lockPath);
    log.warn(`Broke stale compiler-folder lock: ${lockPath}`);
  } catch {
    // Someone else broke it first.
  }
}

export async function acquireLock(
  lockPath: string,
  opts?: { timeoutMs?: number; staleMs?: number },
): Promise<HeldLock> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const staleMs = opts?.staleMs ?? DEFAULT_STALE_MS;
  const deadline = Date.now() + timeoutMs;
  let released = false;

  const makeHeld = (): HeldLock => ({
    acquired: true,
    release: async () => {
      if (released) return;
      released = true;
      try {
        await Deno.remove(lockPath);
      } catch {
        // Already gone (broken as stale by another process).
      }
    },
  });

  for (;;) {
    try {
      const file = await Deno.open(lockPath, { createNew: true, write: true });
      try {
        await file.write(
          new TextEncoder().encode(
            JSON.stringify({ pid: Deno.pid, at: new Date().toISOString() }),
          ),
        );
      } finally {
        file.close();
      }
      return makeHeld();
    } catch (error) {
      if (!(error instanceof Deno.errors.AlreadyExists)) {
        // Cannot lock at all (permissions, missing parent). Proceed unlocked:
        // a redundant rebuild is wasteful, not incorrect.
        log.warn(`Could not create lock ${lockPath}: ${error}`);
        return { acquired: false, release: () => Promise.resolve() };
      }
    }

    await breakIfStale(lockPath, staleMs);

    if (Date.now() >= deadline) {
      log.warn(`Timed out waiting for compiler-folder lock: ${lockPath}`);
      return { acquired: false, release: () => Promise.resolve() };
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}
```

If `Deno.kill` with `"SIGCONT"` is not permitted or not meaningful on Windows, fall back to treating any lock older than `staleMs` as stale (drop the `processAlive` guard) and say so in your report — the mtime age is the load-bearing check; PID liveness is a refinement.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `deno test --allow-all tests/unit/container/folder-lock.test.ts`

Expected: PASS (4 tests).

- [ ] **Step 5: Verify, format, commit**

```bash
deno check src/container/folder-lock.ts tests/unit/container/folder-lock.test.ts
deno lint src/container tests/unit/container
deno fmt src/container/folder-lock.ts tests/unit/container/folder-lock.test.ts
git add src/container/folder-lock.ts tests/unit/container/folder-lock.test.ts
git commit -m "feat(container): add cross-process compiler-folder lock

trap-probe and bench run as separate processes by design, so the in-process
compilerFolderQueue cannot serialize them. Atomic createNew file lock, stale
detection by mtime age plus PID liveness, bounded timeout that proceeds
unlocked rather than failing the run."
```

---

### Task 5: Wire adoption into the provider

The load-bearing task. After this, a warm run makes no `pwsh` call for compiler folders at all.

**Files:**
- Modify: `src/container/bc-container-provider.ts` (`createCompilerFolder` ~`:1178-1270`, `warmupCompilerFolders` ~`:1272`)
- Test: `tests/unit/container/compiler-folder-adoption.test.ts` (create)

**Interfaces:**
- Consumes: `compilerCacheKey` (Task 1), `inspectContainer` (Task 2), `validateFolder`/`writeMarker`/`LAYOUT_VERSION` (Task 3), `acquireLock` (Task 4).
- Produces:
  - `BcContainerProvider.setReuseCompilerFolders(enabled: boolean): void`
  - `BcContainerProvider.lastWarmupStats: { adopted: number; rebuilt: number }` — read by Task 8's span args.
  - `private async tryAdoptCompilerFolder(containerName: string): Promise<string | undefined>`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/container/compiler-folder-adoption.test.ts`. Stub `inspectContainer` is not possible across module boundaries here, so drive the decision through `validateFolder` on a real temp folder and assert `tryAdoptCompilerFolder`'s outcome via a seam: add the private method but test it through a small exported helper. Write these tests:

```typescript
import { assertEquals } from "@std/assert";
import { BcContainerProvider } from "../../../src/container/bc-container-provider.ts";

Deno.test("setReuseCompilerFolders toggles adoption", () => {
  const p = new BcContainerProvider();
  // Default is on — adoption is opt-out, not opt-in.
  assertEquals(p.isReuseCompilerFoldersEnabled(), true);
  p.setReuseCompilerFolders(false);
  assertEquals(p.isReuseCompilerFoldersEnabled(), false);
  p.setReuseCompilerFolders(true);
  assertEquals(p.isReuseCompilerFoldersEnabled(), true);
});

Deno.test("warmup stats start at zero and count outcomes", () => {
  const p = new BcContainerProvider();
  assertEquals(p.lastWarmupStats, { adopted: 0, rebuilt: 0 });
});

Deno.test("adoption is skipped entirely when disabled", async () => {
  // With reuse off, tryAdoptCompilerFolder must not even inspect the container.
  const p = new BcContainerProvider();
  p.setReuseCompilerFolders(false);
  let inspected = false;
  const original = (p as unknown as { inspectForAdoption: unknown })
    .inspectForAdoption;
  Object.defineProperty(p, "inspectForAdoption", {
    value: () => {
      inspected = true;
      return Promise.resolve(undefined);
    },
    configurable: true,
  });
  try {
    const adopted = await (p as unknown as {
      tryAdoptCompilerFolder(n: string): Promise<string | undefined>;
    }).tryAdoptCompilerFolder("Cronus282");
    assertEquals(adopted, undefined);
    assertEquals(inspected, false);
  } finally {
    Object.defineProperty(p, "inspectForAdoption", {
      value: original,
      configurable: true,
    });
  }
});
```

Add an `isReuseCompilerFoldersEnabled(): boolean` accessor and a `private inspectForAdoption(containerName)` wrapper around `inspectContainer` purely so the above is stubbable — a one-line seam, and note it in a comment.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `deno test --allow-all tests/unit/container/compiler-folder-adoption.test.ts`

Expected: FAIL — `setReuseCompilerFolders` does not exist.

- [ ] **Step 3: Add the imports and fields**

In `src/container/bc-container-provider.ts`, add to the implementation-import group (match the relative depth the file already uses):

```typescript
import { compilerCacheKey } from "./compiler-cache-key.ts";
import { inspectContainer } from "./docker-inspect.ts";
import {
  LAYOUT_VERSION,
  validateFolder,
  writeMarker,
} from "./compiler-folder-marker.ts";
import { acquireLock } from "./folder-lock.ts";
import { BCCH_PINNED_VERSION } from "./bcch-config.ts";
```

Check `bcch-config.ts`'s actual export name for the pinned version and use whatever it really is.

Next to `_compilerCacheEnabled` (`:297`) add:

```typescript
  /**
   * Adopt an existing compiler folder instead of rebuilding it, when a marker
   * plus a concrete file check proves it matches the container's current
   * artifact URL. On by default; `--no-reuse-compiler-folders` turns it off.
   */
  private _reuseCompilerFolders = true;
  /** Per-warmup counters, read by the setup.warmup-compiler trace span. */
  lastWarmupStats: { adopted: number; rebuilt: number } = {
    adopted: 0,
    rebuilt: 0,
  };
```

And the accessors:

```typescript
  setReuseCompilerFolders(enabled: boolean): void {
    this._reuseCompilerFolders = enabled;
  }

  isReuseCompilerFoldersEnabled(): boolean {
    return this._reuseCompilerFolders;
  }
```

- [ ] **Step 4: Add the adoption path**

Add these two private methods next to `createCompilerFolder`:

```typescript
  /**
   * Seam so tests can stub the Docker call. One line on purpose.
   */
  private inspectForAdoption(containerName: string) {
    return inspectContainer(containerName);
  }

  /**
   * Try to adopt the existing compiler folder for `containerName`.
   *
   * Entirely host-side: `docker inspect` (~0.36s) is the exact source
   * `Get-BcContainerArtifactUrl` reads, so no pwsh spawn is needed to decide.
   * Returns the folder path on success, `undefined` to mean "rebuild".
   */
  private async tryAdoptCompilerFolder(
    containerName: string,
  ): Promise<string | undefined> {
    if (!this._reuseCompilerFolders) return undefined;

    const inspection = await this.inspectForAdoption(containerName);
    if (!inspection?.artifactUrl) return undefined;

    const folder =
      `${BcContainerProvider.COMPILER_FOLDER_DIR}\\CentralGauge-${containerName}`;
    const result = await validateFolder(folder, {
      artifactUrl: inspection.artifactUrl,
      bchVersion: BCCH_PINNED_VERSION,
    });
    if (!result.ok) {
      log.info(`Rebuilding compiler folder for ${containerName}: ${result.reason}`);
      return undefined;
    }

    await this.pruneCompilerOutput(folder);
    log.info(`Adopted compiler folder for ${containerName} (no rebuild needed)`);
    return folder;
  }

  /**
   * Bound `output/` growth.
   *
   * Every compile creates `${compilerFolder}\output\${name}_${uuid8}`. BCH's
   * unconditional folder delete used to garbage-collect these incidentally;
   * adoption preserves the folder, so without this the directory grows one
   * entry per compile forever. Best-effort — never fails a run.
   */
  private async pruneCompilerOutput(folder: string, keep = 10): Promise<void> {
    const outputDir = `${folder}\\output`;
    try {
      const entries: Array<{ name: string; mtime: number }> = [];
      for await (const e of Deno.readDir(outputDir)) {
        if (!e.isDirectory) continue;
        try {
          const stat = await Deno.stat(`${outputDir}\\${e.name}`);
          entries.push({ name: e.name, mtime: stat.mtime?.getTime() ?? 0 });
        } catch {
          // Vanished mid-scan; skip.
        }
      }
      entries.sort((a, b) => b.mtime - a.mtime);
      for (const stale of entries.slice(keep)) {
        await Deno.remove(`${outputDir}\\${stale.name}`, { recursive: true })
          .catch(() => {});
      }
    } catch {
      // No output dir yet, or unreadable. Nothing to prune.
    }
  }
```

- [ ] **Step 5: Use adoption in `getOrCreateCompilerFolder`, and lock the rebuild**

In `createCompilerFolder`, immediately after the in-queue cache re-check (after the block ending near `:1189`), insert:

```typescript
    // Host-side adoption: if the existing folder already matches this
    // container's current artifact URL, skip the pwsh spawn entirely.
    const adopted = await this.tryAdoptCompilerFolder(containerName);
    if (adopted) {
      this.compilerFolderCache.set(containerName, adopted);
      this.lastWarmupStats.adopted++;
      return adopted;
    }

    // Rebuild mutates the folder, so take the cross-process lock — trap-probe
    // and bench run as separate processes and compilerFolderQueue only
    // serializes within one.
    const lockPath =
      `${BcContainerProvider.COMPILER_FOLDER_DIR}\\.cg-${containerName}.lock`;
    const lock = await acquireLock(lockPath);
    try {
      // Double-check under the lock: another process may have finished a
      // rebuild while we waited, in which case adopting is now correct.
      const afterWait = await this.tryAdoptCompilerFolder(containerName);
      if (afterWait) {
        this.compilerFolderCache.set(containerName, afterWait);
        this.lastWarmupStats.adopted++;
        return afterWait;
      }
      return await this.rebuildCompilerFolder(containerName);
    } finally {
      await lock.release();
    }
  }
```

Rename the remainder of the existing method body (from `log.info(\`Creating compiler folder for ${containerName}...\`)` through the `return compilerFolder;`) into a new `private async rebuildCompilerFolder(containerName: string): Promise<string>`.

- [ ] **Step 6: Compute the cache folder host-side and delete the PowerShell hash**

Inside `rebuildCompilerFolder`, replace the `cacheKeyBlock` / `cacheParams` construction (currently `:1203-1223`) with a host-side computation. Resolve the artifact URL via `inspectForAdoption`; if it is unavailable, fall back to today's in-script resolution rather than failing:

```typescript
    const inspection = await this.inspectForAdoption(containerName);
    const artifactUrl = inspection?.artifactUrl;

    // Cache folder is computed here, in TypeScript, because the artifact URL
    // is now known host-side. The PowerShell hash this replaces was untestable
    // by construction; do not reintroduce it.
    let cacheParams = "";
    let cacheFolder: string | undefined;
    if (this._compilerCacheEnabled && artifactUrl) {
      const key = await compilerCacheKey(artifactUrl);
      cacheFolder =
        `${BcContainerProvider.COMPILER_CACHE_ROOT}\\${BcContainerProvider.COMPILER_CACHE_PREFIX}-${key}`;
      cacheParams =
        ` -containerName "CentralGauge-${containerName}" -cacheFolder "${cacheFolder}"`;
      log.info(`Compiler cache folder: ${cacheFolder}`);
    }
```

Then the script becomes:

```typescript
    const script = `
      ${bcchImport()}
      $artifactUrl = Get-BcContainerArtifactUrl -containerName "${containerName}"
      Write-Output "ARTIFACT_URL:$artifactUrl"
      # No -includeTestToolkit: BCH 6.1.14's New-BcCompilerFolder has no such
      # parameter (it lands in $args and is ignored). Do NOT substitute
      # -includeAL — that forces Download-Artifacts on every call and defeats
      # the cache. Test-toolkit symbols arrive via the unconditional app copy
      # inside New-BcCompilerFolder.
      $compilerFolder = New-BcCompilerFolder -artifactUrl $artifactUrl${cacheParams}
      Write-Output "COMPILER_FOLDER:$compilerFolder"
    `;
```

Keep the `extractCacheFolder` call and its log only if `cacheFolder` was not computed host-side; otherwise the host-side `log.info` above covers it. Preserve the existing `!compilerFolder` failure throw exactly.

- [ ] **Step 7: Write the marker after a successful rebuild**

Immediately before `this.compilerFolderCache.set(containerName, compilerFolder)` in `rebuildCompilerFolder`:

```typescript
    this.lastWarmupStats.rebuilt++;
    if (artifactUrl) {
      await writeMarker(compilerFolder, {
        layoutVersion: LAYOUT_VERSION,
        artifactUrl,
        cacheKey: cacheFolder ? cacheFolder.split("-").pop() ?? "" : "",
        bchVersion: BCCH_PINNED_VERSION,
        containerName,
        createdAt: new Date().toISOString(),
      }).catch((error) => {
        // A missing marker only costs a rebuild next run.
        log.warn(`Could not write compiler-folder marker: ${error}`);
      });
    }
```

- [ ] **Step 8: Reset stats per warmup**

In `warmupCompilerFolders` (`:1272`), reset the counters first:

```typescript
  async warmupCompilerFolders(containerNames: string[]): Promise<void> {
    this.lastWarmupStats = { adopted: 0, rebuilt: 0 };
    for (const name of containerNames) {
      await this.getOrCreateCompilerFolder(name);
    }
  }
```

- [ ] **Step 9: Run the tests**

```bash
deno test --allow-all tests/unit/container/compiler-folder-adoption.test.ts
deno test --allow-all tests/unit/container/bc-container-provider.test.ts
```

Expected: both PASS. The second must show no regressions — it covers `clearCompilerFolders` and `purgeArtifactCache`, which this task does not touch.

- [ ] **Step 10: Verify, format, commit**

```bash
deno check src/container/bc-container-provider.ts tests/unit/container/compiler-folder-adoption.test.ts
deno lint src/container tests/unit/container
deno fmt src/container/bc-container-provider.ts tests/unit/container/compiler-folder-adoption.test.ts
git add src/container/bc-container-provider.ts tests/unit/container/compiler-folder-adoption.test.ts
git commit -m "feat(container): adopt existing compiler folders instead of rebuilding

Decides host-side via docker inspect (~0.36s, the exact source
Get-BcContainerArtifactUrl reads), so a warm run makes no pwsh call for
compiler folders at all. New-BcCompilerFolder deletes and rebuilds the folder
on every call regardless of cache state, which measured 48.96s across three
containers even fully warm.

Rebuild takes a cross-process lock and re-checks the marker under it. The
PowerShell cache-key hash is deleted in favour of the tested TypeScript one.
output/ is pruned on adopt, since BCH's folder delete was garbage-collecting
it incidentally."
```

---

### Task 6: `--no-reuse-compiler-folders` option threading

**Files:**
- Modify: `cli/commands/bench-command.ts` (option near `:118`, mapping near `:489`)
- Modify: `cli/types/cli-types.ts` (near `:37`)
- Modify: `cli/commands/bench/parallel-executor.ts` (`setupOpts` near `:270`)
- Modify: `cli/commands/bench/container-setup.ts` (apply to the provider)
- Test: `tests/unit/cli/reuse-compiler-folders.test.ts` (create)

**Interfaces:**
- Consumes: `setReuseCompilerFolders` (Task 5).
- Produces: `noReuseCompilerFolders?: boolean` on the setup options object.

Mirror exactly how `noCompilerCache` threads today — that path is proven. Do NOT add `{ default: false }` to the `--no-` option; cliffy treats the default as the value and the field is permanently false.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/cli/reuse-compiler-folders.test.ts`:

```typescript
import { assertEquals } from "@std/assert";
import type { ContainerProvider } from "../../../src/container/interface.ts";
import { setupContainers } from "../../../cli/commands/bench/container-setup.ts";
import { ContainerProviderRegistry } from "../../../src/container/registry.ts";

function makeProvider(calls: boolean[]) {
  return {
    isHealthy: () => Promise.resolve(true),
    setCredentials: () => {},
    setCompilerCacheEnabled: () => {},
    setReuseCompilerFolders: (enabled: boolean) => calls.push(enabled),
    prenukeCentralGaugeApps: () => Promise.resolve(),
    warmupCompilerFolders: () => Promise.resolve(),
    ensureTestHarness: () => Promise.resolve(),
  } as unknown as ContainerProvider;
}

Deno.test("setupContainers leaves folder reuse ON by default", async () => {
  const calls: boolean[] = [];
  ContainerProviderRegistry.register("fake-reuse-on", () => makeProvider(calls));
  try {
    await setupContainers(["Cronus28"], "fake-reuse-on", { name: "Cronus28" });
    // Either never disabled, or explicitly enabled — never disabled.
    assertEquals(calls.includes(false), false);
  } finally {
    ContainerProviderRegistry.clearInstances();
  }
});

Deno.test("setupContainers disables folder reuse when asked", async () => {
  const calls: boolean[] = [];
  ContainerProviderRegistry.register("fake-reuse-off", () => makeProvider(calls));
  try {
    await setupContainers(["Cronus28"], "fake-reuse-off", { name: "Cronus28" }, {
      noReuseCompilerFolders: true,
    });
    assertEquals(calls.includes(false), true);
  } finally {
    ContainerProviderRegistry.clearInstances();
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `deno test --allow-all tests/unit/cli/reuse-compiler-folders.test.ts`

Expected: FAIL — the option type does not exist.

- [ ] **Step 3: Declare the CLI option**

In `cli/commands/bench-command.ts`, immediately after the existing `--no-compiler-cache` option (`:118-121`):

```typescript
    .option(
      "--no-reuse-compiler-folders",
      "Rebuild each container's compiler folder even when it already matches the container's artifact URL (adoption is on by default and skips the rebuild entirely)",
    )
```

- [ ] **Step 4: Map it**

Near `:489`, beside `noCompilerCache: !options.compilerCache`:

```typescript
        noReuseCompilerFolders: !options.reuseCompilerFolders,
```

Add to `cli/types/cli-types.ts` beside `noCompilerCache?: boolean;` (`:37`):

```typescript
  noReuseCompilerFolders?: boolean;
```

- [ ] **Step 5: Thread it through the executor and setup**

In `cli/commands/bench/parallel-executor.ts` (`:270`), extend `setupOpts` so both flags travel together rather than one replacing the other. Read the existing ternary and widen it to build an object carrying whichever flags are set.

In `cli/commands/bench/container-setup.ts`, widen the `options` parameter type on both `setupContainer` and `setupContainers` to include `noReuseCompilerFolders?: boolean`, and where the provider capabilities are probed, add:

```typescript
  if ("setReuseCompilerFolders" in containerProvider) {
    (containerProvider as BcContainerProvider).setReuseCompilerFolders(
      !options?.noReuseCompilerFolders,
    );
  }
```

- [ ] **Step 6: Run the tests**

```bash
deno test --allow-all tests/unit/cli/reuse-compiler-folders.test.ts
deno test --allow-all tests/unit/cli/container-setup.test.ts
```

Expected: both PASS. The second must show no regressions.

- [ ] **Step 7: Confirm the flag is not permanently false**

```bash
deno task start bench --help | grep -A 2 "reuse-compiler-folders"
```

Expected: the option renders. This is the cliffy footgun check — if you added `{ default: false }`, the field would be permanently false and adoption silently never runs.

- [ ] **Step 8: Verify, format, commit**

```bash
deno check cli/commands/bench-command.ts cli/types/cli-types.ts cli/commands/bench/parallel-executor.ts cli/commands/bench/container-setup.ts tests/unit/cli/reuse-compiler-folders.test.ts
deno lint cli/commands cli/types tests/unit/cli
deno fmt cli/commands/bench-command.ts cli/types/cli-types.ts cli/commands/bench/parallel-executor.ts cli/commands/bench/container-setup.ts tests/unit/cli/reuse-compiler-folders.test.ts
git add -A cli tests/unit/cli/reuse-compiler-folders.test.ts
git commit -m "feat(bench): add --no-reuse-compiler-folders opt-out

Adoption is on by default; this is the escape hatch. Threads the same route as
--no-compiler-cache. No { default: false } on the --no- option, which cliffy
would treat as the value and pin permanently false."
```

---

### Task 7: Report adoption in the trace, and fix the health check

**Files:**
- Modify: `cli/commands/bench/container-setup.ts` (the `setup.warmup-compiler` spans in both `setupContainer` and `setupContainers`)
- Modify: `src/container/bc-container-provider.ts` (`isHealthy`, `:2341-2362`)
- Test: `tests/unit/container/is-healthy-running.test.ts` (create)

**Interfaces:**
- Consumes: `lastWarmupStats` (Task 5), `inspectContainer` (Task 2).
- Produces: nothing consumed later.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/container/is-healthy-running.test.ts`:

```typescript
import { assertEquals } from "@std/assert";
import { BcContainerProvider } from "../../../src/container/bc-container-provider.ts";

Deno.test("isHealthy reports false when Docker says the container is not running", async () => {
  // The Cronus284 case: Test-BcContainer passed while Docker reported the
  // container not running, so every task dispatched there failed and the
  // Phase 1 measurement was contaminated.
  const p = new BcContainerProvider();
  Object.defineProperty(p, "inspectForAdoption", {
    value: () =>
      Promise.resolve({ artifactUrl: "https://x/sandbox/28.3/dk", running: false }),
    configurable: true,
  });
  assertEquals(await p.isHealthy("Cronus284"), false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `deno test --allow-all tests/unit/container/is-healthy-running.test.ts`

Expected: FAIL — `isHealthy` currently spawns pwsh and does not consult Docker.

- [ ] **Step 3: Add the running-state gate to `isHealthy`**

In `src/container/bc-container-provider.ts`, at the top of `isHealthy`'s `try` block, after the existing abort check:

```typescript
      // Docker's own view first: Test-BcContainer has been observed reporting
      // healthy for a container Docker reports as not running, which silently
      // contaminated a whole benchmark measurement. Cheap (~0.36s) and
      // authoritative on liveness.
      const inspection = await this.inspectForAdoption(containerName);
      if (inspection && !inspection.running) return false;
```

Leave the existing `Test-BcContainer` call in place. It verifies more than liveness, and nothing here establishes what — this is a correctness gate, not a replacement.

- [ ] **Step 4: Add `adopted`/`rebuilt` to the warmup span**

In `cli/commands/bench/container-setup.ts`, both `setup.warmup-compiler` spans currently pass `{ cat: "setup" }`. Capture the stats after the call and attach them. Since span args are supplied before the body runs, restructure so the counts are read afterwards — e.g. run the warmup inside the span and record stats into a variable the surrounding code logs, or use whatever the tracer offers for post-hoc args. If the tracer has no mechanism for setting args after the fact, emit a second zero-duration span named `setup.warmup-compiler.stats` carrying `{ cat: "setup", args: { adopted, rebuilt } }` and note the choice in your report.

This matters because without it a re-measurement cannot distinguish "adoption worked" from "the phase happened to be fast".

- [ ] **Step 5: Run the tests**

```bash
deno test --allow-all tests/unit/container/is-healthy-running.test.ts
deno test --allow-all tests/unit/cli/container-setup-tracing.test.ts
deno test --allow-all tests/unit/cli/container-setup.test.ts
```

Expected: all PASS. If the tracing test asserts an exact sorted span-name list and you added a stats span, update that expectation deliberately.

- [ ] **Step 6: Verify, format, commit**

```bash
deno check src/container/bc-container-provider.ts cli/commands/bench/container-setup.ts tests/unit/container/is-healthy-running.test.ts
deno lint src/container cli/commands/bench tests/unit/container tests/unit/cli
deno fmt src/container/bc-container-provider.ts cli/commands/bench/container-setup.ts tests/unit/container/is-healthy-running.test.ts
git add -A src/container cli/commands/bench tests/unit/container/is-healthy-running.test.ts
git commit -m "fix(container): gate isHealthy on Docker running state; trace adoption counts

Test-BcContainer reported Cronus284 healthy while Docker reported it not
running, so every task dispatched there failed and roughly half of
setup.harness in the Phase 1 measurement was a doomed publish. The docker
inspect gate is authoritative on liveness and costs ~0.36s.

setup.warmup-compiler now carries adopted/rebuilt counts so a re-measurement
can tell adoption working apart from a phase that happened to be fast."
```

---

### Task 8: Structured empty-response field (W5 groundwork)

"Model returned empty response" is a bare string at `llm-work-pool.ts:278`. An empty response scores as a failed attempt 1 while carrying zero trap signal, so reading it as a genuine catch corrupts exactly the judgement the authoring loop exists to support.

**Files:**
- Modify: `src/parallel/llm-work-pool.ts` (`:270-284`)
- Modify: the result type that carries `error` (find it via the `result.error` assignments in that block)
- Test: `tests/unit/parallel/empty-response-field.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `failureKind?: "empty_response" | "safety_refusal" | "low_confidence"` on the LLM work result.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/parallel/empty-response-field.test.ts` asserting that a result built for each of the three branches carries the matching `failureKind`, and that a successful extraction carries none. Import the result type and whatever factory the surrounding tests use; if the block is only reachable through the pool, export a small pure helper `classifyExtractionFailure(finishReason, cleanedCode, confidence)` from `llm-work-pool.ts` and test that directly.

- [ ] **Step 2: Run the test to verify it fails**

Run: `deno test --allow-all tests/unit/parallel/empty-response-field.test.ts`

Expected: FAIL — `failureKind` does not exist.

- [ ] **Step 3: Add the field**

Add `failureKind` to the result type, and set it alongside each existing `result.error` assignment in the `if (!isReadyForCompile)` block — `"safety_refusal"` for the `content_filter` branch, `"empty_response"` for the zero-length branch, `"low_confidence"` for the else. **Keep the existing `error` strings byte-identical**; they appear in operator-facing output and other code may match on them.

- [ ] **Step 4: Run the test to verify it passes**

Run: `deno test --allow-all tests/unit/parallel/empty-response-field.test.ts`

Expected: PASS.

- [ ] **Step 5: Verify, format, commit**

```bash
deno check src/parallel/llm-work-pool.ts tests/unit/parallel/empty-response-field.test.ts
deno lint src/parallel tests/unit/parallel
deno fmt src/parallel/llm-work-pool.ts tests/unit/parallel/empty-response-field.test.ts
git add -A src/parallel tests/unit/parallel/empty-response-field.test.ts
git commit -m "feat(parallel): add structured failureKind to LLM extraction failures

An empty response scores as a failed attempt 1 but carries zero trap signal.
Reading it as a genuine catch corrupts the judgement the authoring loop
exists to support, and string-matching the message is not a foundation to
build a reporter on. Existing error strings are unchanged."
```

---

### Task 9: Compact single-task matrix (W5)

Per F5, the existing matrix is gated on `outputFormat === "verbose"` **and** `taskCount > 1` (`results-writer.ts:537,541`), so a one-task run gets nothing in any format.

**Files:**
- Create: `cli/commands/bench/single-task-matrix.ts`
- Modify: `cli/commands/bench/results-writer.ts` (`:537-548`)
- Test: `tests/unit/cli/single-task-matrix.test.ts` (create)

**Interfaces:**
- Consumes: `failureKind` (Task 8).
- Produces:
  - `export type AttemptCategory = "PASS" | "COMPILE" | "TEST" | "EMPTY" | "INFRA"`
  - `export function categorizeAttempt(attempt: ...): AttemptCategory`
  - `export function formatSingleTaskMatrix(input: { results: ... }): string`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/cli/single-task-matrix.test.ts` covering `categorizeAttempt` for every precedence row, each as its own assertion:

| Situation | Expected |
|---|---|
| compiled, all tests passed | `PASS` |
| compile failed | `COMPILE` |
| compiled, tests ran, some failed | `TEST` |
| compiled successfully, **zero tests ran** | `INFRA` |
| `failureKind === "empty_response"` | `EMPTY` |
| infra-retry recovered | category of the final outcome |
| quarantined by an alert drain | `INFRA` |

Plus a `formatSingleTaskMatrix` test asserting the rendered string contains one row per model and both attempt columns, and that an `EMPTY` attempt 1 followed by a `COMPILE` attempt 2 renders both rather than collapsing.

Read the existing `formatTaskMatrix` and its `TaskMatrixInput` type first, and mirror their shape so the two reporters stay recognisably related.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `deno test --allow-all tests/unit/cli/single-task-matrix.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `categorizeAttempt` and the formatter**

Create `cli/commands/bench/single-task-matrix.ts`. Order the checks so the precedence above is enforced by construction, and comment the two non-obvious rows:

- compile success with **zero** tests is `INFRA`, not `PASS` — GH #13 records that scoring it as a model failure once hid a broken BCH version across an entire bench run.
- an infra-retry-recovered attempt reports its **final** outcome, because the retry is infrastructure noise, not model behaviour.

Use `@std/fmt/colors` for any colouring, never emojis.

- [ ] **Step 4: Render it for single-task runs in every format**

In `cli/commands/bench/results-writer.ts`, the current structure is:

```typescript
  if (outputFormat === "verbose") {
    console.log(formatBenchmarkStats(formatterInput));
    console.log(formatModelSummaryTable(formatterInput));

    if (taskCount > 1) {
      ...formatTaskMatrix(matrixInput)...
    }
  } else {
```

Add the single-task matrix so it renders whenever `taskCount === 1`, on **both** branches — that is the format half of F5, and printing it only under `verbose` would reproduce the bug this task exists to fix.

- [ ] **Step 5: Run the tests**

```bash
deno test --allow-all tests/unit/cli/single-task-matrix.test.ts
deno test --allow-all tests/unit/cli/
```

Expected: PASS, with no regressions in the existing results-writer tests.

- [ ] **Step 6: Verify, format, commit**

```bash
deno check cli/commands/bench/single-task-matrix.ts cli/commands/bench/results-writer.ts tests/unit/cli/single-task-matrix.test.ts
deno lint cli/commands/bench tests/unit/cli
deno fmt cli/commands/bench/single-task-matrix.ts cli/commands/bench/results-writer.ts tests/unit/cli/single-task-matrix.test.ts
git add -A cli/commands/bench tests/unit/cli/single-task-matrix.test.ts
git commit -m "feat(bench): compact matrix for single-task runs, in every output format

The existing matrix was gated on verbose AND taskCount > 1, so a one-task run
- the authoring loop's whole shape - rendered no matrix at all. Categories are
PASS/COMPILE/TEST/EMPTY/INFRA with explicit precedence: compile-success with
zero tests is INFRA (GH #13), and an infra-retry-recovered attempt reports its
final outcome."
```

---

### Task 10: Measure adoption — the acceptance gate

**Files:**
- Create: `docs/superpowers/plans/2026-07-25-compiler-folder-adoption-measurements.md`

**Interfaces:**
- Consumes: Tasks 1-9.
- Produces: the numbers that decide whether adoption delivered.

- [ ] **Step 1: Preflight**

```bash
find results/.bench-running.json -mmin -2
```

Expected: no output. If a bench is live, STOP.

Confirm all three containers are actually up — the Phase 1 measurement was contaminated because one was not:

```bash
for c in Cronus282 Cronus283 Cronus284; do
  echo "$c: $(docker inspect "$c" --format '{{.State.Running}}')"
done
```

Expected: `true` for all three. If any is `false`, start it or substitute a live container, and record what you did.

- [ ] **Step 2: Warm run with adoption ON**

Do NOT purge. The point is to measure a warm run against Phase 1's warm baseline of 48.96 s.

```bash
pwsh -NoProfile -File ./run-xiterate.ps1 tasks/hard/CG-AL-X035-poisoned-rescue.yml -NoSanity -TraceFile results/trace-adopt.json
```

Run it in the background — it takes longer than a foreground command may block. Record wall time.

- [ ] **Step 3: Warm run with adoption OFF (the control)**

```bash
pwsh -NoProfile -File ./run-xiterate.ps1 tasks/hard/CG-AL-X035-poisoned-rescue.yml -NoSanity -TraceFile results/trace-noadopt.json
```

This needs `--no-reuse-compiler-folders` to reach the bench. If `run-xiterate.ps1` has no pass-through for extra bench arguments, add one rather than editing the argument list by hand, and commit that separately.

- [ ] **Step 4: Extract**

```bash
for f in results/trace-adopt.json results/trace-noadopt.json; do
  echo "=== $f"
  jq -r '.traceEvents[] | select(.ph=="X") | select(.name|startswith("setup.")) | "\(.name)\t\(.args.container // "")\t\(.args.adopted // "")\t\(.args.rebuilt // "")\t\(.dur/1000000)s"' "$f"
  jq -r '.traceEvents[] | select(.ph=="X") | select(.name=="bench") | "root \(.dur/1000000)s"' "$f"
done
```

- [ ] **Step 5: Record the findings**

Create `docs/superpowers/plans/2026-07-25-compiler-folder-adoption-measurements.md` with: `setup.warmup-compiler` adopted-vs-control, both against Phase 1's 48.96 s warm baseline; the `adopted`/`rebuilt` counts proving adoption engaged; setup total and its share of the run; and total wall time.

Answer explicitly: **did adoption deliver the predicted ~34 s of the ~49 s phase** (the remainder being pwsh spawn plus artifact-URL resolution, which adoption removes too — so state whether the observed saving is closer to the full 49 s)?

State the n=1 caveat honestly, and which deltas clear the noise floor: Phase 1's `timing.log` records per-attempt totals of p50 40.9 s, p90 67.2 s, max 199.4 s. Ground the verdict on the mechanism (adoption engaged per the counters) rather than on a ratio.

Note anything the run revealed that the design did not anticipate.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/plans/2026-07-25-compiler-folder-adoption-measurements.md
git commit -m "docs(bench): record compiler-folder adoption measurements

setup.warmup-compiler with adoption on versus off, both warm, against Phase
1's 48.96s warm baseline, with adopted/rebuilt counts proving adoption
actually engaged rather than the phase happening to be fast."
```

---

## Self-Review

**Spec coverage.** W3 flow → Tasks 1-5. Marker → Task 3. Cross-process safety → Task 4. `output/` retention → Task 5 Step 4. Default-on plus opt-out → Task 6. Instrumentation (`adopted`/`rebuilt`) → Task 7. Health-check correctness fix → Task 7. W5 structured empty field → Task 8. W5 categories, precedence and format-independent rendering → Task 9. Acceptance test → Task 10. The spec's non-goals (daemon, replacing `Test-BcContainer`, reworking `setup.harness`) appear in no task, correctly.

**Placeholder scan.** Tasks 1-4 and 6-7 carry literal code. Tasks 5 and 9 carry literal code for every non-obvious block and name the exact file regions for the mechanical ones. Task 8 Step 1 and Task 9 Step 1 describe tests by exhaustive table rather than literal source, because both depend on result-type shapes the implementer must read first — each names the file to read and the exact cases to cover.

**Type consistency.** `compilerCacheKey` / `normalizeArtifactUrl` (Task 1) are used in Task 5 Step 6. `inspectContainer` / `ContainerInspection` (Task 2) are used via the `inspectForAdoption` seam in Tasks 5 and 7. `validateFolder` / `writeMarker` / `LAYOUT_VERSION` (Task 3) are used in Task 5 Steps 4 and 7. `acquireLock` / `HeldLock` (Task 4) are used in Task 5 Step 5. `lastWarmupStats` is defined in Task 5 and read in Task 7. `setReuseCompilerFolders` is defined in Task 5 and called in Task 6. `failureKind` is defined in Task 8 and consumed in Task 9. `BCCH_PINNED_VERSION`'s real export name must be confirmed in Task 5 Step 3.

**Known risks carried forward.** Task 5 is by far the largest and touches the file three other tasks also touch; its Step 9 re-runs the existing provider suite for exactly that reason. Task 7 Step 4 has a genuine unknown — whether the tracer supports setting span args after the body runs — and gives an explicit fallback rather than pretending otherwise.
