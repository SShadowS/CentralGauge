/**
 * The harness BC lane (spec 1a section 5, D12 as amended). Host-side
 * compiles are admitted per container (Semaphore) and move on infra
 * errors; publish + test hold one container (Mutex) and reroute through
 * withInfraRetry; alerted containers are never selected.
 */

import { basename, dirname, join } from "@std/path";
import type { z } from "zod";
import type {
  ALProject,
  AnalysisSettings,
  CompilationError,
  CompilationResult,
  HarnessInstalledApp,
  HarnessSyncResult,
  TestResult,
} from "../container/types.ts";
import type { ContainerOutcome } from "../health/types.ts";
import type { InfraRetryRecord } from "../tasks/interfaces.ts";
import type { SymbolPackage } from "./identity.ts";
import type { TestResultSchema } from "./records.ts";
import { readAppGraph, readAppJsonRaw, type StagedApp } from "./staging.ts";
import { ContainerError, ValidationError } from "../errors.ts";
import {
  classifyPublishFailure,
  isCollisionPublishFailure,
} from "../health/classify-publish-failure.ts";
import { isInfraError } from "../health/is-infra-error.ts";
import { NoEligibleContainersError } from "../parallel/errors.ts";
import { withInfraRetry } from "../parallel/infra-retry.ts";
import { Mutex, Semaphore } from "../parallel/semaphore.ts";
import {
  applySync,
  appStamps,
  candidateFolders,
  invalidate,
  loadLedger,
  planAppSync,
  prereqVersion,
  saveLedger,
  trustedHarnessAppIds,
  type WantedApp,
} from "./bc-apps.ts";
import { exists, safeCopyTree } from "./fsutil.ts";
import { hashFile, hashJson, hashTree, isTaskBuildArtifact } from "./hash.ts";
import { restoreSymbols } from "./symbols.ts";

export interface HarnessBc {
  compileProject(
    container: string,
    project: ALProject,
  ): Promise<CompilationResult>;
  /** Artifact URL plus pinned BCH version: part of every prerequisite stamp. */
  harnessCompilerIdentity(container: string): Promise<string>;
  listHarnessApps(container: string): Promise<HarnessInstalledApp[]>;
  syncHarnessApps(
    container: string,
    plan: {
      removeIds: string[];
      publish: string[];
      /** Trusted removal allowlist (trustedHarnessAppIds): id to name regex. */
      allow: ReadonlyMap<string, string>;
      /** Owned apps to publish: kept tenant data purged when unpublished (M1-15a). */
      clean?: { id: string; name: string }[];
    },
  ): Promise<HarnessSyncResult>;
  runHarnessTests(container: string, codeunit: number): Promise<TestResult>;
  /**
   * H-35: the `Target` a compiled package's manifest records, or null when
   * it records none. Host-side (reads the package file), never a container.
   */
  packageTarget(file: string): Promise<string | null>;
}

/**
 * H-35 (design-r5 section 2.1, ruling r5): how a build is compiled. `Cloud`
 * writes `"target": "Cloud"` into the effective app.json before the cache
 * lookup and the compile (so the compiler refuses File, DotNet and every
 * OnPrem-scoped API); `as-declared` keeps the workspace's target (trusted
 * builds only: the oracle, analysis compiles). The policy id is in every
 * build key, and a cache hit must carry the policy's target.
 */
export interface BuildPolicy {
  target: "Cloud" | "as-declared";
  id: string;
}
export const CLOUD_POLICY: BuildPolicy = { target: "Cloud", id: "h35-cloud@1" };
export const DECLARED_POLICY: BuildPolicy = {
  target: "as-declared",
  id: "declared@1",
};

/**
 * H-35 (design-r4 section 3.3, ruling r5): mandatory, set by trusted code
 * only. `judge` publishes every app as a candidate at its pristine version
 * (normalized, nothing kept); `backend` is the agent tool environment's plan
 * (stamped prerequisites, kept across calls).
 */
export type VersionPlan = "judge" | "backend";

export type TestRow = z.output<typeof TestResultSchema>;

/** The part of ContainerHealthMonitor the lane reads. */
export interface HealthView {
  getState(): { containers: { containerName: string; alert?: unknown }[] };
  record(o: ContainerOutcome): unknown;
}

export interface Held<T> {
  result: T;
  container: string;
  /** Lock wait summed over every attempt, including rerouted ones. */
  queue_ms: number;
  retries: InfraRetryRecord[];
}

export class BcLane {
  private readonly locks = new Map<string, Mutex>();
  private readonly slots = new Map<string, Semaphore>();
  private readonly load = new Map<string, number>();
  private rotor = 0;
  /** Exclusive-hold tie-break: least recently routed first (fair rotation). */
  private readonly lastRouted = new Map<string, number>();
  private routeTick = 0;

  constructor(
    readonly bc: HarnessBc,
    readonly containers: string[],
    private readonly opts: {
      health?: HealthView;
      maxInfraRetries?: number;
      compileSlots?: number;
    } = {},
  ) {
    if (containers.length === 0) throw new Error("BcLane needs a container");
    for (const c of containers) {
      this.locks.set(c, new Mutex());
      this.slots.set(c, new Semaphore(opts.compileSlots ?? 2));
      this.load.set(c, 0);
    }
  }

  /** Containers whose cleanup failed: never selected until the operator clears them. */
  readonly quarantined = new Map<string, string>();

  quarantine(container: string, reason: string): void {
    this.quarantined.set(container, reason);
  }

  private healthy(): string[] {
    const alerted = new Set(
      (this.opts.health?.getState().containers ?? []).filter((c) => c.alert)
        .map((c) => c.containerName),
    );
    return this.containers.filter((c) =>
      !alerted.has(c) && !this.quarantined.has(c)
    );
  }

  private record(containerName: string, result: "pass" | "infra_error") {
    this.opts.health?.record({ containerName, result, timestamp: Date.now() });
  }

  /** After a wait: refuse if cancelled or if the container became ineligible (infra, so holds reroute). */
  private admit(c: string, signal?: AbortSignal): void {
    checkCancel(signal);
    if (!this.healthy().includes(c)) {
      throw new ContainerError(
        `${c} became ineligible while queued (${
          this.quarantined.get(c) ?? "health alert"
        })`,
        c,
        "setup",
      );
    }
  }

  /** Run fn under `container`'s compile slot (the oracle build must use a specific container). */
  async compileOn<T>(
    container: string,
    fn: (container: string) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    if (!this.slots.has(container)) {
      throw new Error(`unknown container ${container}`);
    }
    // The named container first; on an infra fault the same reroute rule as
    // compile(): each other allocated, eligible container at most once. A
    // failed build (diagnostics), a non-infra error or a cancellation is not
    // rerouted (M1-16b).
    const order = [
      container,
      ...this.containers.filter((c) => c !== container),
    ];
    let last: unknown;
    for (const [k, c] of order.entries()) {
      if (k > 0 && !this.healthy().includes(c)) continue;
      try {
        return await this.compileOnce(c, fn, signal);
      } catch (err) {
        if (signal?.aborted) throw cancelled(signal);
        if (!isInfraError(err)) throw err;
        last = err;
      }
    }
    throw last;
  }

  private async compileOnce<T>(
    container: string,
    fn: (container: string) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const slot = this.slots.get(container)!;
    this.admit(container, signal);
    const release = await slot.acquire();
    try {
      this.admit(container, signal);
      const out = await fn(container);
      checkCancel(signal); // an abort while fn was pending is not a success
      return out;
    } finally {
      release();
    }
  }

  /** Host-side compile job; admitted per container; next container on infra error. */
  async compile<T>(
    fn: (container: string) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    checkCancel(signal);
    const eligible = this.healthy();
    if (eligible.length === 0) {
      throw new NoEligibleContainersError(this.containers, this.containers);
    }
    // Each retry goes to a container this job has not tried yet.
    const tried = new Set<string>();
    for (;;) {
      const start = this.rotor++;
      let c = "";
      for (let j = 0; j < eligible.length; j++) {
        const x = eligible[(start + j) % eligible.length]!;
        if (!tried.has(x)) {
          c = x;
          break;
        }
      }
      tried.add(c);
      const release = await this.slots.get(c)!.acquire();
      try {
        this.admit(c, signal);
        const out = await fn(c);
        checkCancel(signal); // an abort while fn was pending is not a success
        return out;
      } catch (err) {
        if (signal?.aborted) throw cancelled(signal);
        if (!isInfraError(err) || tried.size >= eligible.length) throw err;
      } finally {
        release();
      }
    }
  }

  async exclusive<T>(
    ctx: { taskId: string; variantId: string; attemptNumber: number },
    fn: (container: string) => Promise<T>,
    signal?: AbortSignal,
    /**
     * Per-call reroute bound (e.g. one rerun for an agent suite); default: the
     * lane's. `exclude`: containers this call never routes to (a rerun that
     * must run elsewhere, H-26).
     */
    opts: { maxInfraRetries?: number; exclude?: readonly string[] } = {},
  ): Promise<Held<T>> {
    checkCancel(signal);
    let container = "";
    let queue_ms = 0;
    const { result, retries } = await withInfraRetry<T>(
      async ({ excludeContainers, onRouted }) => {
        checkCancel(signal);
        const eligible = this.healthy().filter((c) =>
          !excludeContainers.includes(c) && !opts.exclude?.includes(c)
        );
        if (eligible.length === 0) {
          throw new NoEligibleContainersError(
            [...excludeContainers, ...(opts.exclude ?? [])],
            this.containers,
          );
        }
        const lru = (x: string) => this.lastRouted.get(x) ?? -1;
        const c = eligible.reduce((a, b) => {
          const la = this.load.get(a)!, lb = this.load.get(b)!;
          return lb < la || (lb === la && lru(b) < lru(a)) ? b : a;
        });
        this.lastRouted.set(c, ++this.routeTick);
        onRouted(c);
        this.load.set(c, this.load.get(c)! + 1);
        const t0 = performance.now();
        const release = await this.locks.get(c)!.acquire();
        queue_ms += performance.now() - t0;
        container = c;
        let admitted = false;
        try {
          this.admit(c, signal);
          admitted = true;
          const out = await fn(c);
          // Quarantine inside the held region, before the lock is released (round 3 B4).
          const cleanupError = (out as { cleanupError?: string | null } | null)
            ?.cleanupError;
          if (cleanupError) this.quarantine(c, cleanupError);
          checkCancel(signal); // an abort while fn was pending: no pass recorded
          this.record(c, "pass");
          return out;
        } catch (err) {
          if (err instanceof CleanupFailedError) {
            this.quarantine(c, err.cleanupError);
          }
          // A cancellation (even a timeout reason) is never infra: no
          // reroute, no fault recorded against the container.
          if (signal?.aborted) throw cancelled(signal);
          // Refused before any work (ineligible while queued): not a fault of this container.
          if (admitted && isInfraError(err)) this.record(c, "infra_error");
          throw err;
        } finally {
          release();
          this.load.set(c, this.load.get(c)! - 1);
        }
      },
      {
        maxRetries: opts.maxInfraRetries ?? this.opts.maxInfraRetries ??
          Math.max(1, this.containers.length - 1),
        configuredContainers: this.containers,
        context: ctx,
      },
    );
    return { result, container, queue_ms, retries };
  }
}

/**
 * A lane operation cancelled through its AbortSignal. Deliberately not a
 * ContainerError and its message carries no infra hint, so withInfraRetry
 * never reroutes it; the abort reason is kept as the cause.
 */
export class LaneCancelledError extends Error {
  constructor(reason: unknown) {
    super("lane operation cancelled; no further BC step runs", {
      cause: reason,
    });
    this.name = "LaneCancelledError";
  }
}

const cancelled = (signal: AbortSignal) =>
  new LaneCancelledError(signal.reason);

function checkCancel(signal?: AbortSignal): void {
  if (signal?.aborted) throw cancelled(signal);
}

export interface LockedSymbols {
  store: string;
  packages: SymbolPackage[];
}

/** Tests (or deploy) failed and the cleanup failed too: the container is quarantined by the lane. */
export class CleanupFailedError extends ContainerError {
  constructor(
    readonly original: unknown,
    readonly cleanupError: string,
    container: string,
  ) {
    super(
      `${
        original instanceof Error ? original.message : String(original)
      } (and ${cleanupError})`,
      container,
      "setup",
    );
    this.name = "CleanupFailedError";
  }
}

export interface BuiltApp {
  folder: string;
  id: string;
  version: string;
  ok: boolean;
  attempted: boolean;
  file: string | null;
  diagnostics: CompilationError[];
  compile_ms: number;
  /** Analyzer warnings; set only by an analysis compile (M11-05). */
  warnings?: CompilationError[];
  /** Its build cache key (H-27): set for a built or reused app when a cache is used. */
  key?: string;
}

const synthetic = (message: string): CompilationError => ({
  code: "CG0001",
  message,
  file: "app.json",
  line: 0,
  column: 0,
  severity: "error",
});

/**
 * Compile apps in dependency order. Each app's .alpackages holds the locked
 * packages plus every earlier (or prebuilt) workspace app; after the
 * compile nothing else may be there (BCH filled a gap from its cache).
 */
/**
 * Built .app files keyed by the exact build inputs (buildKey): an unchanged
 * app is never compiled twice (M1-40). Since H-27 one cache is shared by the
 * agent backend and the judge of a run (under its private root). Failures
 * are never cached.
 */
export interface BuildCache {
  get(key: string): Promise<string | null>;
  put(key: string, file: string): Promise<void>;
}

/**
 * A run's build cache folder per consumer (H-27; H-35 design-r4 3.1: the
 * judge and the agent backend never share one, against PackageId
 * prelearning). The old shared `build-cache/` is read by neither.
 */
export const buildCacheDir = (
  privateRoot: string,
  consumer: "judge" | "agent",
) => join(privateRoot, `build-cache-${consumer}`);

/**
 * Entries and bytes of a build cache folder (H-27). No eviction yet.
 * ponytail: unbounded; add LRU eviction when disk use shows it is needed.
 */
export async function buildCacheReport(
  dir: string,
): Promise<{ entries: number; bytes: number }> {
  let entries = 0;
  let bytes = 0;
  try {
    for await (const e of Deno.readDir(dir)) {
      if (!e.isDirectory || e.name.startsWith(".tmp-")) continue;
      entries++;
      for await (const f of Deno.readDir(join(dir, e.name))) {
        bytes += (await Deno.stat(join(dir, e.name, f.name))).size;
      }
    }
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) throw err;
  }
  return { entries, bytes };
}

/**
 * A BuildCache in a private directory: <dir>/<key>/<the .app file name>.
 * A put is atomic (a whole entry is renamed into place) and safe under
 * concurrent builders: the first entry of a key wins and is never replaced.
 */
export function dirBuildCache(dir: string): BuildCache {
  return {
    async get(key) {
      try {
        for await (const e of Deno.readDir(join(dir, key))) {
          if (e.isFile && e.name.endsWith(".app")) {
            return join(dir, key, e.name);
          }
        }
      } catch (err) {
        if (!(err instanceof Deno.errors.NotFound)) throw err;
      }
      return null;
    },
    async put(key, file) {
      const tmp = join(dir, `.tmp-${crypto.randomUUID()}`);
      try {
        await Deno.mkdir(tmp, { recursive: true });
        await Deno.copyFile(file, join(tmp, basename(file)));
        await Deno.rename(tmp, join(dir, key));
      } catch (err) {
        await Deno.remove(tmp, { recursive: true }).catch(() => {});
        // A concurrent put of the same key won only if its entry is complete.
        if (await this.get(key) === null) throw err;
      }
    },
  };
}

/**
 * What makes a build reusable: the app's source, its version, its
 * dependencies, the compiler (artifact and BCH version) and the lock. A
 * dependency is its own cache key, not its file (H-27: alc.exe output is not
 * byte-deterministic: a new package id, build timestamp and zip times each
 * build), and the cache hands out the cached dependency files, so a chain
 * stays consistent. A dependency with no key (built without the cache) is
 * keyed by its file. No container name: the compiler identity pins the
 * artifact, so a recreated container on the same artifact may hit. The
 * symbol packages restored for the compile are in the key too (H-27 r2): the
 * whole lock before the app info is harvested, the declared closure after,
 * so a cold success never stands in for a closure compile. H-35: the build
 * policy (effective target and policy id) is in the key, so a build under
 * one policy never stands in for another.
 */
async function buildKey(
  compiler: string,
  app: StagedApp,
  srcDir: string,
  version: string,
  files: ReadonlyMap<string, string>,
  keys: ReadonlyMap<string, string>,
  lockDigest: string,
  restored: readonly SymbolPackage[],
  policy: BuildPolicy,
): Promise<string> {
  const deps: [string, string][] = [];
  for (const d of app.depends) {
    const k = keys.get(d);
    if (k) deps.push([d, `key:${k}`]);
    else {
      const f = files.get(d)!;
      deps.push([d, `file:${await hashFile(dirname(f), f)}`]);
    }
  }
  return await hashJson({
    folder: app.folder,
    version,
    source: await hashTree(join(srcDir, app.folder), "task"),
    deps,
    compiler,
    lock: lockDigest,
    symbols: restored.map((p) => p.sha256).sort(),
    policy: { id: policy.id, target: policy.target },
  });
}

/**
 * BCH reads the manifest of every package in the project's .alpackages with
 * one altool process each, caching the result in cache_AppInfo.json keyed by
 * the relative file name. Each build has a fresh .alpackages, so without a
 * seed every compile rereads all ~200 locked packages. The locked packages'
 * entries are harvested once per lock (from a compile whose packages passed
 * the lock check) and seeded into every later compile; a workspace-built
 * package is never harvested or seeded.
 */
const APPINFO_CACHE = "cache_AppInfo.json";
const cachedName = (key: string) => key.replace(/^\.[\\/]/, "");

async function seedAppInfo(
  pk: string,
  store: string,
  lockDigest: string,
  locked: ReadonlySet<string>,
  exclude: ReadonlySet<string>,
): Promise<void> {
  let saved: Record<string, unknown>;
  try {
    saved = JSON.parse(
      await Deno.readTextFile(join(store, "appinfo", `${lockDigest}.json`)),
    );
  } catch {
    return; // none yet, or unreadable: BCH rebuilds it
  }
  const seed = Object.fromEntries(
    Object.entries(saved).filter(([k]) =>
      locked.has(cachedName(k)) && !exclude.has(cachedName(k))
    ),
  );
  if (Object.keys(seed).length > 0) {
    await Deno.writeTextFile(join(pk, APPINFO_CACHE), JSON.stringify(seed));
  }
}

/** BCH's implicit dependencies of `application` and `platform` (Compile-AppWithBcCompilerFolder). */
const APPLICATION_APP_ID = "c1335042-3002-4257-bf8a-75c898ccb1b8";
const SYSTEM_APP_ID = "8874ed3a-0643-4247-9ced-7a7002f7135d";

/**
 * The locked packages an app may compile against (M1-40b): Application
 * (its `application`) and System (its `platform`), its declared symbol
 * dependencies and those of its workspace dependencies, then every locked
 * package's own dependencies, transitively, from the harvested app info of
 * this lock. Declared dependencies only, so an undeclared package is absent
 * and its use fails the compile as in BC. Null when the harvested info does
 * not cover the closure (the whole lock is restored, as before).
 */
async function dependencyClosure(
  store: string,
  lockDigest: string,
  packages: readonly SymbolPackage[],
  roots: readonly string[],
): Promise<SymbolPackage[] | null> {
  let saved: Record<string, unknown>;
  try {
    saved = JSON.parse(
      await Deno.readTextFile(join(store, "appinfo", `${lockDigest}.json`)),
    );
  } catch {
    return null;
  }
  const byFile = new Map(packages.map((p) => [p.file.toLowerCase(), p]));
  const info = new Map<string, { deps: string[]; application: boolean }>();
  for (const [k, v] of Object.entries(saved)) {
    const p = byFile.get(cachedName(k).toLowerCase());
    if (!p || v === null || typeof v !== "object") continue;
    const ai = v as {
      appId?: unknown;
      application?: unknown;
      dependencies?: unknown;
    };
    // Info that names another app than the lock does is not trusted: restore all.
    if (String(ai.appId).toLowerCase() !== p.app_id.toLowerCase()) return null;
    const deps = Array.isArray(ai.dependencies) ? ai.dependencies : [];
    info.set(p.app_id.toLowerCase(), {
      deps: deps.map((d: { id?: unknown; appId?: unknown }) =>
        String(d?.id ?? d?.appId).toLowerCase()
      ),
      application: typeof ai.application === "string" && ai.application !== "",
    });
  }
  const want = new Set<string>();
  const queue = [...roots];
  while (queue.length > 0) {
    const id = queue.pop()!;
    if (want.has(id)) continue;
    const i = info.get(id);
    if (!i) return null;
    want.add(id);
    queue.push(...i.deps, SYSTEM_APP_ID);
    if (i.application) queue.push(APPLICATION_APP_ID);
  }
  return packages.filter((p) => want.has(p.app_id.toLowerCase()));
}

/** Symbol roots of an app: application, platform and the declared externals of it and its workspace dependencies; null when a workspace dependency is not in the graph. */
function symbolRoots(
  app: StagedApp,
  appJson: { application?: unknown; platform?: unknown },
  graph: readonly StagedApp[],
): string[] | null {
  const roots = new Set<string>();
  if (typeof appJson.application === "string" && appJson.application !== "") {
    roots.add(APPLICATION_APP_ID);
  }
  if (typeof appJson.platform === "string" && appJson.platform !== "") {
    roots.add(SYSTEM_APP_ID);
  }
  const byFolder = new Map(graph.map((a) => [a.folder, a]));
  const seen = new Set<string>();
  const walk = (a: StagedApp): boolean => {
    if (seen.has(a.folder)) return true;
    seen.add(a.folder);
    for (const id of a.external) roots.add(id.toLowerCase());
    for (const d of a.depends) {
      const dep = byFolder.get(d);
      if (!dep || !walk(dep)) return false;
    }
    return true;
  };
  return walk(app) ? [...roots] : null;
}

/** `verified`: lower-cased names of the locked packages that hash-verified in this build. */
async function harvestAppInfo(
  pk: string,
  store: string,
  lockDigest: string,
  verified: ReadonlySet<string>,
): Promise<void> {
  let fresh: Record<string, unknown>;
  try {
    fresh = JSON.parse(await Deno.readTextFile(join(pk, APPINFO_CACHE)));
  } catch {
    return;
  }
  const path = join(store, "appinfo", `${lockDigest}.json`);
  const saved: Record<string, unknown> = await Deno.readTextFile(path).then(
    (t) => JSON.parse(t),
    () => ({}),
  );
  const add = Object.entries(fresh).filter(([k]) =>
    verified.has(cachedName(k).toLowerCase()) && !(k in saved)
  );
  if (add.length === 0) return;
  await Deno.mkdir(join(store, "appinfo"), { recursive: true });
  const tmp = `${path}.tmp-${crypto.randomUUID()}`;
  await Deno.writeTextFile(
    tmp,
    JSON.stringify({ ...saved, ...Object.fromEntries(add) }),
  );
  await Deno.rename(tmp, path);
}

export async function buildApps(
  bc: HarnessBc,
  container: string,
  o: {
    srcDir: string;
    apps: StagedApp[];
    versions: Map<string, string>;
    outDir: string;
    lock: LockedSymbols;
    prebuilt?: Map<string, string>;
    /** Cancellation: checked before every compile, so no further app is built after an abort. */
    signal?: AbortSignal;
    /** Reuse of unchanged builds (M1-40; the run's shared cache since H-27). */
    cache?: BuildCache;
    /** Cache keys of the `prebuilt` files (H-27); a prebuilt app without one is keyed by its file. */
    prebuiltKeys?: ReadonlyMap<string, string>;
    /** The whole workspace graph (workspace dependencies' declared symbols); default `apps`. */
    graph?: StagedApp[];
    /** CodeCop/UICop compile for the final-code check (M11-05); never with `cache`. */
    analysis?: AnalysisSettings;
    /** H-35: how the apps are compiled (no default: every caller states it). */
    policy: BuildPolicy;
  },
): Promise<BuiltApp[]> {
  if (o.analysis && o.cache) {
    // Analyzer warnings are not in a cached entry: an analysis compile is never reused.
    throw new Error(
      "buildApps: an analysis compile is never with a build cache",
    );
  }
  const files = new Map(o.prebuilt ?? []);
  const keys = new Map(o.prebuiltKeys ?? []);
  const out: BuiltApp[] = [];
  await Deno.mkdir(join(o.outDir, ".apps"), { recursive: true });
  const lockedIds = new Set(o.lock.packages.map((p) => p.app_id.toLowerCase()));
  // Keyed case-insensitively: .alpackages is on an NTFS volume, so a file
  // named like a locked package in another case would still overwrite it.
  const lockedByName = new Map(
    o.lock.packages.map((p) => [p.file.toLowerCase(), p]),
  );
  const lockedNames = new Set(o.lock.packages.map((p) => p.file));
  // An upgraded container (another artifact or BCH version) is a different compiler: a cache miss.
  // orch Sol r1 #3 (r4 3.4): every build has its key, with or without a cache.
  const compiler = await bc.harnessCompilerIdentity(container);
  const collision = (file: string) =>
    lockedByName.get(basename(file).toLowerCase());
  // A workspace app is the agent's (publisher, name, version, id): one that
  // is a locked package by id or file name would replace a symbol package
  // (e.g. Base Application) for its dependents. Its own build failure.
  const refuse = (
    app: StagedApp,
    version: string,
    attempted: boolean,
    message: string,
    diagnostics: CompilationError[] = [],
    compile_ms = 0,
  ): BuiltApp => ({
    folder: app.folder,
    id: app.id,
    version,
    ok: false,
    attempted,
    file: null,
    diagnostics: [...diagnostics, synthetic(message)],
    compile_ms,
  });
  const lockDigest = await hashJson({
    lock: o.lock.packages.map((p) => [p.file, p.sha256]),
  });
  for (const app of o.apps) {
    checkCancel(o.signal);
    const version = o.versions.get(app.folder) ?? app.version;
    const failed = app.depends.find((d) => !files.has(d));
    if (failed) {
      out.push({
        folder: app.folder,
        id: app.id,
        version,
        ok: false,
        attempted: false,
        file: null,
        diagnostics: [synthetic(`dependency ${failed} did not build`)],
        compile_ms: 0,
      });
      continue;
    }
    // A declared dependency outside the workspace and the lock is this app's
    // own build failure (the agent controls dependencies): never compiled,
    // so BCH cannot fill it from its cache and turn it into an environment error.
    const unlocked = app.external.find((id) => !lockedIds.has(id));
    if (unlocked) {
      out.push({
        folder: app.folder,
        id: app.id,
        version,
        ok: false,
        attempted: false,
        file: null,
        diagnostics: [
          synthetic(
            `dependency ${unlocked} is not in the symbols lock or the workspace`,
          ),
        ],
        compile_ms: 0,
      });
      continue;
    }
    const idTaken = o.lock.packages.find((p) =>
      p.app_id.toLowerCase() === app.id.toLowerCase()
    );
    if (idTaken) {
      out.push(
        refuse(
          app,
          version,
          false,
          `app id ${app.id} is the id of the locked symbol package ${idTaken.file}`,
        ),
      );
      continue;
    }
    // The symbol packages this compile restores (M1-40b), fixed before the
    // cache lookup so they are in the key (H-27 r2): the declared closure once
    // the app info is harvested, the whole lock before.
    const srcJson = await readAppJsonRaw(
      join(o.srcDir, app.folder, "app.json"),
    ) as { application?: unknown; platform?: unknown };
    const roots = symbolRoots(app, srcJson, o.graph ?? o.apps);
    const closure = roots
      ? await dependencyClosure(
        o.lock.store,
        lockDigest,
        o.lock.packages,
        roots,
      )
      : null;
    const restored = closure ?? o.lock.packages;
    // orch Sol r1 #4 (ruling r5): the effective app.json (version, Cloud
    // target) is staged first; the key is of that trusted build input, and the
    // cache is consulted with it only after.
    const dir = join(o.outDir, app.folder);
    await Deno.remove(dir, { recursive: true }).catch(() => {});
    await safeCopyTree(join(o.srcDir, app.folder), dir, {
      skip: isTaskBuildArtifact,
    });
    const appJson = await readAppJsonRaw(join(dir, "app.json")) as {
      version?: string;
      application?: unknown;
      platform?: unknown;
      [k: string]: unknown;
    };
    appJson.version = version;
    if (o.policy.target === "Cloud") appJson["target"] = "Cloud";
    await Deno.writeTextFile(
      join(dir, "app.json"),
      JSON.stringify(appJson, null, 2),
    );
    const key = await buildKey(
      compiler,
      app,
      o.outDir,
      version,
      files,
      keys,
      lockDigest,
      restored,
      o.policy,
    );
    // H-27 r2: the cache is best-effort; a failed read is a miss.
    let hit: string | null = null;
    // H-35: a hit whose package does not carry the policy's target is refused;
    // the app is rebuilt unkeyed, so that entry is never adopted either.
    let poisoned = false;
    if (o.cache) {
      try {
        hit = await o.cache.get(key);
      } catch (err) {
        console.warn(
          `[WARN] build cache read for ${app.folder} failed (built instead): ${
            err instanceof Error ? err.message : err
          }`,
        );
      }
    }
    const hitTaken = hit ? collision(hit) : undefined;
    if (hit && hitTaken) {
      out.push(
        refuse(
          app,
          version,
          false,
          `reused build ${
            basename(hit)
          } has the file name of the locked symbol package ${hitTaken.file}`,
        ),
      );
      continue;
    }
    // H-27 r3: a hit that cannot be materialized (unreadable, locked) is a
    // miss: it is copied aside and renamed into place only once complete, so
    // a failure leaves no partial file (and touches no other file), and the
    // app is compiled normally.
    const reused = hit ? join(o.outDir, ".apps", basename(hit)) : null;
    if (hit && reused) {
      const tmp = `${reused}.tmp-${crypto.randomUUID()}`;
      try {
        await Deno.copyFile(hit, tmp);
        await Deno.rename(tmp, reused);
      } catch (err) {
        await Deno.remove(tmp).catch(() => {});
        console.warn(
          `[WARN] build cache entry for ${app.folder} unreadable (built instead): ${
            err instanceof Error ? err.message : err
          }`,
        );
        hit = null;
      }
    }
    if (hit && o.policy.target === "Cloud") {
      const target = await bc.packageTarget(reused!).catch(() => null);
      if (target !== "Cloud") {
        console.warn(
          `[WARN] build cache entry for ${app.folder} has target ${target} under a Cloud key: refused, rebuilt unkeyed`,
        );
        await Deno.remove(reused!).catch(() => {});
        hit = null;
        poisoned = true;
      }
    }
    if (hit) {
      const file = reused!;
      files.set(app.folder, file);
      keys.set(app.folder, key);
      out.push({
        folder: app.folder,
        id: app.id,
        version,
        ok: true,
        attempted: false,
        file,
        diagnostics: [],
        compile_ms: 0,
        key,
      });
      continue;
    }
    const pk = join(dir, ".alpackages");
    // Only what the harness restores and seeds (the copy skips any case of it too).
    await Deno.remove(pk, { recursive: true }).catch(() => {});
    await restoreSymbols(o.lock.store, restored, pk);
    const workspaceFiles = new Set([...files.values()].map((f) => basename(f)));
    const workspaceLower = new Set(
      [...workspaceFiles].map((f) => f.toLowerCase()),
    );
    await seedAppInfo(
      pk,
      o.lock.store,
      lockDigest,
      lockedNames,
      workspaceFiles,
    );
    for (const f of files.values()) {
      // Every workspace file here passed the collision check when built.
      const taken = collision(f);
      if (taken) {
        throw new ValidationError(
          `workspace package ${f} has the file name of the locked symbol package ${taken.file}`,
          [basename(f)],
        );
      }
      await Deno.copyFile(f, join(pk, basename(f)));
    }
    const t0 = performance.now();
    const r = await bc.compileProject(container, {
      path: dir,
      appJson,
      sourceFiles: [],
      testFiles: [],
      ...(o.analysis ? { analysis: o.analysis } : {}),
    });
    const compile_ms = performance.now() - t0;
    const warned = o.analysis ? { warnings: r.warnings } : {};
    const verified = new Set<string>();
    for await (const e of Deno.readDir(pk)) {
      // Only packages are checked: BCH writes its own index
      // (cache_AppInfo.json) into .alpackages during the compile.
      if (!e.name.toLowerCase().endsWith(".app")) continue;
      // A locked package is always verified, never skipped as a workspace file.
      const sha = lockedByName.get(e.name.toLowerCase())?.sha256;
      if (sha === undefined && workspaceLower.has(e.name.toLowerCase())) {
        continue;
      }
      if (sha === undefined || await hashFile(pk, join(pk, e.name)) !== sha) {
        throw new ValidationError(
          `compile of ${app.folder} used an unlocked symbol package: ${e.name} (the symbols lock does not match the compiler cache)`,
          [e.name],
        );
      }
      verified.add(e.name.toLowerCase());
    }
    // Only the locked packages that hash-verified in this build keep their app info.
    await harvestAppInfo(pk, o.lock.store, lockDigest, verified);
    const outTaken = r.success && r.artifactPath
      ? collision(r.artifactPath)
      : undefined;
    if (r.artifactPath && outTaken) {
      out.push({
        ...refuse(
          app,
          version,
          true,
          `output ${
            basename(r.artifactPath)
          } has the file name of the locked symbol package ${outTaken.file}`,
          r.errors,
          compile_ms,
        ),
        ...warned,
      });
      continue;
    }
    let file: string | null = null;
    if (r.success && r.artifactPath) {
      file = join(o.outDir, ".apps", basename(r.artifactPath));
      await Deno.copyFile(r.artifactPath, file);
      files.set(app.folder, file);
      if (!poisoned && !o.cache) keys.set(app.folder, key);
      if (o.cache && !poisoned) {
        // H-27 r2: the cache's winning file is this app's file from here on
        // (a concurrent builder may have won the key), so every dependent is
        // built against the cached file. A failed write leaves the app unkeyed.
        try {
          await o.cache.put(key, file);
          const won = await o.cache.get(key);
          if (won === null) throw new Error("no entry after the write");
          // H-35 Sol r1 #6: the winner is target-checked like a first hit.
          if (
            o.policy.target === "Cloud" &&
            await bc.packageTarget(won) !== "Cloud"
          ) {
            throw new Error("the winning cache entry is not a Cloud package");
          }
          // H-27 r3: the winner is copied aside and replaces the fresh build
          // only once complete; on any failure the fresh build stays, unkeyed.
          const tmp = `${file}.tmp-${crypto.randomUUID()}`;
          try {
            await Deno.copyFile(won, tmp);
            await Deno.rename(tmp, file);
          } catch (err) {
            await Deno.remove(tmp).catch(() => {});
            throw err;
          }
          keys.set(app.folder, key);
        } catch (err) {
          console.warn(
            `[WARN] build cache write for ${app.folder} failed (not reused): ${
              err instanceof Error ? err.message : err
            }`,
          );
        }
      }
    }
    out.push({
      folder: app.folder,
      id: app.id,
      version,
      ok: file !== null,
      attempted: true,
      file,
      diagnostics: r.errors,
      compile_ms,
      ...warned,
      ...(file && keys.get(app.folder) === key && key ? { key } : {}),
    });
  }
  return out;
}

export interface PrepareInput {
  pristine: string;
  pristineApps: StagedApp[];
  candidateDir: string;
  candidateApps: StagedApp[];
  changed: string[];
  workDir: string;
  lock: LockedSymbols;
  signal?: AbortSignal;
  cache?: BuildCache;
  /** What the candidate build is, for a crashed-build message (default "candidate"). */
  label?: string;
  /** H-35: mandatory, trusted callers only (see VersionPlan). */
  versionPlan: VersionPlan;
  /** H-35: how every app of this prepare is compiled. */
  policy: BuildPolicy;
  /**
   * H-35 (design-r3 3.2): the judgment's production manifest. Its apps are
   * not compiled: their source must equal the manifest's, and they publish
   * the manifest's files (G and A alike, with or without a cache).
   */
  production?: ProductionManifest;
}

/** H-35 (design-r3 3.2): one judgment's production builds, published by every deployment. */
export interface ProductionManifest {
  /** sha256 of the canonical content (recorded in the verdict log). */
  digest: string;
  /** Folder -> the package, its sha256, its source tree hash and build key. */
  apps: Map<string, {
    id: string;
    file: string;
    sha256: string;
    source: string;
    key: string | null;
  }>;
}

/** The production manifest of a prepare: every app of `dir` but `exclude` (the Test app). */
export async function productionManifest(
  prep: Prepared,
  dir: string,
  exclude: readonly string[] = ["Test"],
): Promise<ProductionManifest> {
  if (!prep.buildOk) throw new Error("a production manifest needs a build");
  const folderOf = new Map(
    (await readAppGraph(dir)).map((a) => [a.id, a.folder]),
  );
  const apps: ProductionManifest["apps"] = new Map();
  for (const w of prep.wanted) {
    const folder = folderOf.get(w.id);
    if (!folder || exclude.includes(folder)) continue;
    apps.set(folder, {
      id: w.id,
      file: w.file,
      sha256: w.sha256 ?? await hashFile(dirname(w.file), w.file),
      source: await hashTree(join(dir, folder), "task"),
      key: prep.keys.get(folder) ?? null,
    });
  }
  const digest = await hashJson(
    [...apps].sort(([a], [b]) => a < b ? -1 : 1).map(([folder, e]) => ({
      folder,
      id: e.id,
      sha256: e.sha256,
      source: e.source,
      key: e.key,
    })),
  );
  return { digest, apps };
}

/**
 * H-04: a dependent's "dependency X did not build" entry (synthetic above):
 * a consequence of another app's failure, never a diagnostic of its own.
 */
export function isCascadeDiagnostic(
  d: { code: string; message: string },
): boolean {
  return d.code === "CG0001" && /^dependency .+ did not build$/.test(d.message);
}

/**
 * H-04: a failed build no compiler diagnostic explains (nothing but the
 * cascade) crashed (BC session or compile service died): infrastructure,
 * thrown as such, never the model's failure. Any genuine diagnostic, the
 * other synthetic CG0001 refusals included, keeps it a build failure.
 * H-04b: thrown inside the lane's compile boundary, so it reroutes.
 */
export function throwIfCrashed(
  built: {
    folder: string;
    ok: boolean;
    diagnostics: { code: string; message: string }[];
  }[],
  container: string,
  label: string,
): void {
  const failed = built.filter((b) => !b.ok);
  if (failed.length === 0) return;
  if (failed.some((b) => b.diagnostics.some((d) => !isCascadeDiagnostic(d)))) {
    return;
  }
  throw new ContainerError(
    `${label} build of ${
      failed.map((b) => b.folder).join(", ")
    } failed with no compiler diagnostic (crashed build)`,
    container,
    "compile",
  );
}

export interface Prepared {
  container: string;
  built: BuiltApp[];
  wanted: WantedApp[];
  candidateIds: string[];
  buildOk: boolean;
  compile_ms: number;
  per_app_compiles: number;
  /** Folder -> build cache key of every app built or reused with a cache (H-27). */
  keys: Map<string, string>;
}

export function prepareApps(lane: BcLane, o: PrepareInput): Promise<Prepared> {
  return lane.compile((container) => prepareOn(lane, container, o), o.signal);
}

/**
 * Versions of a candidate workspace's apps, shared by the test path and the
 * compile op (so a test reuses the compile's builds, M1-40). Plan `backend`:
 * candidates (the changed apps and their dependents) keep the pristine
 * version, unchanged apps get the stamped prerequisite version. Plan `judge`
 * (H-35): every app is a candidate at its pristine version.
 */
export async function appVersions(
  bc: HarnessBc,
  container: string,
  o: Pick<
    PrepareInput,
    | "pristine"
    | "pristineApps"
    | "candidateDir"
    | "candidateApps"
    | "changed"
    | "lock"
    | "versionPlan"
  >,
) {
  const graph = o.candidateApps;
  const pristineVersion = new Map(
    o.pristineApps.map((a) => [a.folder, a.version]),
  );
  // Apps the change can affect: compiled from the candidate tree. The rest is
  // the staged baseline, compiled from the pristine tree (a failure there is the
  // task's). H-35: the judge plan publishes every app as a candidate anyway.
  const affected = new Set(candidateFolders(graph, o.changed));
  const cands = o.versionPlan === "judge"
    ? new Set(graph.map((a) => a.folder))
    : affected;
  const buildId = await hashJson({
    symbols: o.lock.packages.map((p) => [p.app_id, p.version, p.sha256]),
    compiler: await bc.harnessCompilerIdentity(container),
  });
  const stamps = await appStamps(o.pristine, o.pristineApps, buildId);
  const candStamps = await appStamps(o.candidateDir, graph, buildId);
  const versions = new Map(graph.map((a) => {
    const base = pristineVersion.get(a.folder) ?? a.version;
    return [
      a.folder,
      cands.has(a.folder) ? base : prereqVersion(base, stamps.get(a.folder)!),
    ];
  }));
  return { cands, affected, stamps, candStamps, versions };
}

/** Apps of the snapshot whose tree differs from the pristine staging (or is gone). */
export async function changedApps(
  pristine: string,
  trusted: readonly StagedApp[],
  snapshot: string,
): Promise<string[]> {
  const changed: string[] = [];
  for (const a of trusted) {
    const now = join(snapshot, a.folder);
    if (
      !await exists(now) ||
      await hashTree(join(pristine, a.folder), "task") !==
        await hashTree(now, "task")
    ) changed.push(a.folder);
  }
  return changed;
}

async function prepareOn(
  lane: BcLane,
  container: string,
  o: PrepareInput,
): Promise<Prepared> {
  const graph = o.candidateApps;
  const { cands, affected, stamps, candStamps, versions } = await appVersions(
    lane.bc,
    container,
    o,
  );
  const given = o.production?.apps ?? new Map();
  for (const [folder, e] of given) {
    if (await hashTree(join(o.candidateDir, folder), "task") !== e.source) {
      throw new Error(
        `harness bug: ${folder} differs from the judgment's production manifest`,
      );
    }
  }
  const prereqs = graph.filter((a) =>
    !affected.has(a.folder) && !given.has(a.folder)
  );
  const pre = await buildApps(lane.bc, container, {
    srcDir: o.pristine,
    apps: prereqs,
    versions,
    outDir: join(o.workDir, "prereq"),
    lock: o.lock,
    graph,
    policy: o.policy,
    ...(o.signal ? { signal: o.signal } : {}),
    ...(o.cache ? { cache: o.cache } : {}),
  });
  // H-04b: a crashed prerequisite is infra (reroutes), not a task bug.
  throwIfCrashed(pre, container, "staged prerequisite");
  const failedPre = pre.find((b) => !b.ok);
  if (failedPre) {
    // The staged baseline must compile (authoring gate): a task bug, not the agent's.
    throw new ValidationError(
      `staged prerequisite ${failedPre.folder} does not compile: ${
        failedPre.diagnostics.map((d) => d.message).join("; ")
      }`,
      [failedPre.folder],
    );
  }
  const prebuilt = new Map([
    ...pre.map((b) => [b.folder, b.file!] as const),
    ...[...given].map(([f, e]) => [f, e.file] as const),
  ]);
  const preKeys = new Map([
    ...pre.filter((b) => b.key).map((b) => [b.folder, b.key!] as const),
    ...[...given].filter(([, e]) => e.key).map(([f, e]) =>
      [f, e.key!] as const
    ),
  ]);
  const candApps = graph.filter((a) =>
    affected.has(a.folder) && !given.has(a.folder)
  );
  const built = await buildApps(lane.bc, container, {
    srcDir: o.candidateDir,
    apps: candApps,
    versions,
    outDir: join(o.workDir, "candidate"),
    lock: o.lock,
    graph,
    prebuilt,
    prebuiltKeys: preKeys,
    policy: o.policy,
    ...(o.signal ? { signal: o.signal } : {}),
    ...(o.cache ? { cache: o.cache } : {}),
  });
  throwIfCrashed(built, container, o.label ?? "candidate");
  const all = [...pre, ...built];
  const buildOk = built.every((b) => b.ok);
  const fileOf = new Map([
    ...all.filter((b) => b.ok).map((b) => [b.folder, b.file!] as const),
    ...[...given].map(([f, e]) => [f, e.file] as const),
  ]);
  const idOf = new Map(graph.map((a) => [a.folder, a.id]));
  // H-35 Sol r1 #5: every package carries its digest; deploy checks each.
  const shaOf = new Map<string, string>();
  if (buildOk) {
    for (const a of graph) {
      const f = fileOf.get(a.folder)!;
      shaOf.set(
        a.folder,
        given.get(a.folder)?.sha256 ?? await hashFile(dirname(f), f),
      );
    }
  }
  const wanted: WantedApp[] = buildOk
    ? graph.map((a) => ({
      id: a.id,
      name: a.name,
      publisher: a.publisher,
      version: versions.get(a.folder)!,
      stamp: cands.has(a.folder)
        ? candStamps.get(a.folder)!
        : stamps.get(a.folder)!,
      file: fileOf.get(a.folder)!,
      role: cands.has(a.folder) ? "candidate" : "prereq",
      depends: a.depends.map((d) => idOf.get(d)!),
      sha256: shaOf.get(a.folder)!,
    }))
    : [];
  return {
    container,
    built,
    wanted,
    candidateIds: graph.filter((a) => cands.has(a.folder)).map((a) => a.id),
    buildOk,
    compile_ms: all.reduce((s, b) => s + b.compile_ms, 0),
    per_app_compiles: all.filter((b) => b.attempted).length,
    keys: new Map([
      ...all.filter((b) => b.ok && b.key).map((b) =>
        [b.folder, b.key!] as const
      ),
      ...[...given].filter(([, e]) => e.key).map(([f, e]) =>
        [f, e.key!] as const
      ),
    ]),
  };
}

export interface TestSpec {
  codeunit: number;
  procedures: string[] | null;
  target: string;
}

export interface UnexpectedProcedure {
  codeunit: number;
  procedure: string;
  target: string;
}

export interface TestMessage {
  codeunit: number;
  procedure: string;
  target: string;
  message: string;
}

/** Shared with the M4 gate (gate-core.ts). */
export function classifyTestFailure(
  error: string,
): "assertion" | "runtime_error" {
  return /\bAssert\.\w+ failed\b/i.test(error) ||
      /An error was expected inside an ASSERTERROR statement/i.test(error)
    ? "assertion"
    : "runtime_error";
}

const row = (
  s: TestSpec,
  procedure: string,
  outcome: TestRow["outcome"],
  failure: TestRow["failure"],
): TestRow => ({
  codeunit: s.codeunit,
  procedure,
  target: s.target,
  outcome,
  failure,
});

export async function runTests(
  bc: HarnessBc,
  container: string,
  specs: TestSpec[],
): Promise<{
  rows: TestRow[];
  messages: TestMessage[];
  test_ms: number;
  /** Result procedures that were not requested: never scored as passed (M1-16b). */
  unexpected: UnexpectedProcedure[];
}> {
  const unexpected: UnexpectedProcedure[] = [];
  const rows: TestRow[] = [];
  const messages: TestMessage[] = [];
  let test_ms = 0;
  for (const s of specs) {
    const t0 = performance.now();
    let r: TestResult;
    try {
      r = await bc.runHarnessTests(container, s.codeunit);
    } catch (err) {
      if (err instanceof ContainerError) throw err;
      throw new ContainerError(
        `SOAP run of ${s.codeunit} failed on ${container}: ${
          err instanceof Error ? err.message : String(err)
        }`,
        container,
        "test",
      );
    }
    test_ms += performance.now() - t0;
    // Zero results are infra for every suite, agent-authored included (M4 parity).
    if (r.totalTests === 0 || r.results.length === 0) {
      throw new ContainerError(
        `codeunit ${s.codeunit} ran zero tests after publish on ${container} (infra, GH #13)`,
        container,
        "test",
      );
    }
    // A response that reports more tests than it returned rows is incomplete: infra.
    if (s.procedures === null && r.totalTests > r.results.length) {
      rows.push(
        row(
          s,
          `(${r.totalTests - r.results.length} results missing)`,
          "not_run",
          "infra",
        ),
      );
    }
    const byName = new Map(r.results.map((x) => [x.name.toLowerCase(), x]));
    if (s.procedures !== null) {
      const asked = new Set(s.procedures.map((p) => p.toLowerCase()));
      for (const x of r.results) {
        if (!asked.has(x.name.toLowerCase())) {
          unexpected.push({
            codeunit: s.codeunit,
            procedure: x.name,
            target: s.target,
          });
        }
      }
    }
    for (const name of s.procedures ?? r.results.map((x) => x.name)) {
      const x = byName.get(name.toLowerCase());
      if (!x) rows.push(row(s, name, "not_run", "infra"));
      else if (x.passed) rows.push(row(s, name, "pass", null));
      else if (x.error === undefined) {
        rows.push(row(s, name, "not_run", "runtime_error"));
      } else {
        rows.push(row(s, name, "fail", classifyTestFailure(x.error)));
        messages.push({
          codeunit: s.codeunit,
          procedure: name,
          target: s.target,
          message: x.error.slice(0, 2000),
        });
      }
    }
  }
  return { rows, messages, test_ms, unexpected };
}

/** Any infra row makes the scorer unscored, even next to an assertion (M4 parity). */
export function scorerPassed(rows: TestRow[]): boolean | null {
  if (rows.some((r) => r.failure === "infra")) return null;
  return rows.length > 0 && rows.every((r) => r.outcome === "pass");
}

/**
 * A sync result that did not finish (removal incomplete, or neither done nor
 * a reported publish failure) is a container failure, whether the provider
 * threw or returned it.
 */
function assertSyncComplete(sync: HarnessSyncResult, container: string): void {
  if (
    sync.removeIncomplete.length > 0 || (!sync.done && sync.failed === null)
  ) {
    throw new ContainerError(
      `harness app sync on ${container} incomplete: ${
        sync.removeIncomplete.join(", ") || "no SYNC_DONE"
      }`,
      container,
      "setup",
    );
  }
}

export interface DeployContext {
  /** Fixed per-container ledger directory (results/harness/bc-ledger), shared by every caller. */
  ledgerRoot: string;
  /**
   * Trusted staging output the removal allowlist is derived from
   * (trustedHarnessAppIds): the pristine workspace and the task's oracle
   * folder. Never agent output. The owned set is exactly the trusted ids:
   * the bench candidate is never owned (a leftover one is a collision).
   */
  trustedRoots: string[];
}

export interface Deployed {
  provisioning_ms: number;
  candidate_publish_ms: number;
  candidateFailure: { id: string; message: string } | null;
  removed: number;
  published: number;
}

export async function deploy(
  bc: HarnessBc,
  container: string,
  wanted: WantedApp[],
  ctx: DeployContext,
): Promise<Deployed> {
  const t0 = performance.now();
  // H-35 (design-r3 3.3): a manifest package publishes only as recorded.
  for (const w of wanted) {
    if (
      w.sha256 !== undefined &&
      await hashFile(dirname(w.file), w.file) !== w.sha256
    ) {
      throw new Error(
        `harness bug: ${w.name} (${w.file}) no longer matches its manifest sha256`,
      );
    }
  }
  const ledger = await loadLedger(ctx.ledgerRoot, container);
  const allow = await trustedHarnessAppIds(ctx.trustedRoots, ledger);
  const plan = planAppSync(
    await bc.listHarnessApps(container),
    wanted,
    ledger,
    new Set(allow.keys()),
  );
  // Durably drop every touched id before mutating the container.
  const pending = invalidate(ledger, [
    ...plan.remove,
    ...plan.publish.map((w) => w.id),
  ]);
  await saveLedger(ctx.ledgerRoot, container, pending);
  let sync: HarnessSyncResult;
  try {
    sync = await bc.syncHarnessApps(container, {
      removeIds: plan.remove,
      publish: plan.publish.map((w) => w.file),
      allow,
      // Kept data of our own apps (bench prenuke keeps data; stamp versions
      // are not monotonic) would refuse a lower version (M1-15a).
      clean: plan.publish.filter((w) => allow.has(w.id.toLowerCase())).map((
        w,
      ) => ({ id: w.id, name: w.name })),
    });
    assertSyncComplete(sync, container);
  } catch (err) {
    // Unknown container state: forget it so the next deploy republishes everything.
    await saveLedger(ctx.ledgerRoot, container, {});
    throw err;
  }
  await saveLedger(ctx.ledgerRoot, container, applySync(pending, plan, sync));
  const total = performance.now() - t0;
  let candidate_publish_ms = 0;
  for (const p of sync.published) {
    if (plan.publish[p.index]?.role === "candidate") {
      candidate_publish_ms += p.ms;
    }
  }
  const d: Deployed = {
    provisioning_ms: Math.max(0, total - candidate_publish_ms),
    candidate_publish_ms,
    candidateFailure: null,
    removed: plan.remove.length,
    published: sync.published.length,
  };
  if (sync.failed) {
    const w = plan.publish[sync.failed.index];
    const msg = sync.failed.message;
    const modelDefect = w?.role === "candidate" &&
      !isCollisionPublishFailure(msg) &&
      classifyPublishFailure(msg) === "model";
    if (!modelDefect) {
      throw new ContainerError(
        `harness ${w?.role ?? "app"} publish failed on ${container}: ${msg}`,
        container,
        "publish",
        {
          rawOutput: sync.output.slice(-4096),
        },
      );
    }
    d.candidateFailure = { id: w!.id, message: msg };
  }
  return d;
}

export interface DeployTestResult {
  deployed: Deployed;
  rows: TestRow[];
  messages: TestMessage[];
  test_ms: number;
  /** Result procedures that were not requested (runTests): for the verdict to treat. */
  unexpected: UnexpectedProcedure[];
  /** Non-null when unpublishing the candidates failed: the caller quarantines the container. */
  cleanupError: string | null;
}

/**
 * Deploy, test, then unpublish candidates and the oracle. A failed cleanup
 * empties the container's ledger and is reported (returned, or attached to
 * a thrown error) so the caller quarantines the container; it is never
 * swallowed.
 */
export async function deployAndTest(
  bc: HarnessBc,
  container: string,
  i: {
    wanted: WantedApp[];
    tests: TestSpec[];
    cleanupIds: string[];
    ctx: DeployContext;
  },
): Promise<DeployTestResult> {
  const cleanup = async (): Promise<string | null> => {
    if (i.cleanupIds.length === 0) return null;
    try {
      const s = await bc.syncHarnessApps(container, {
        removeIds: i.cleanupIds,
        publish: [],
        allow: await trustedHarnessAppIds(
          i.ctx.trustedRoots,
          await loadLedger(i.ctx.ledgerRoot, container),
        ),
      });
      // An incomplete result is a failed cleanup (quarantine), never a removal.
      assertSyncComplete(s, container);
      await saveLedger(
        i.ctx.ledgerRoot,
        container,
        invalidate(await loadLedger(i.ctx.ledgerRoot, container), [
          ...s.removed,
          ...i.cleanupIds,
        ]),
      );
      return null;
    } catch (err) {
      // Refused before any mutation (allowlist, id shape): a harness bug,
      // loud, and the container is untouched, so nothing is quarantined.
      if (!(err instanceof ContainerError)) throw err;
      await saveLedger(i.ctx.ledgerRoot, container, {}).catch(() => {});
      return `cleanup on ${container} failed: ${
        err instanceof Error ? err.message : String(err)
      }`;
    }
  };
  let r: Omit<DeployTestResult, "cleanupError">;
  try {
    const deployed = await deploy(bc, container, i.wanted, i.ctx);
    r = deployed.candidateFailure
      ? {
        deployed,
        rows: i.tests.flatMap((s) =>
          (s.procedures ?? ["(publish)"]).map((p) =>
            row(s, p, "not_run", "runtime_error")
          )
        ),
        messages: [{
          codeunit: 0,
          procedure: "(publish)",
          target: i.tests[0]?.target ?? "candidate",
          message:
            `candidate publish/install failed: ${deployed.candidateFailure.message}`,
        }],
        test_ms: 0,
        unexpected: [],
      }
      : { deployed, ...await runTests(bc, container, i.tests) };
  } catch (err) {
    const c = await cleanup();
    if (c) throw new CleanupFailedError(err, c, container);
    throw err;
  }
  return { ...r, cleanupError: await cleanup() };
}
