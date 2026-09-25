/**
 * The harness BC lane (spec 1a section 5, D12 as amended). Host-side
 * compiles are admitted per container (Semaphore) and move on infra
 * errors; publish + test hold one container (Mutex) and reroute through
 * withInfraRetry; alerted containers are never selected.
 */

import { basename, join } from "@std/path";
import type { z } from "zod";
import type {
  ALProject,
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
import type { StagedApp } from "./staging.ts";
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
import { safeCopyTree } from "./fsutil.ts";
import { hashFile, hashJson, isTaskBuildArtifact } from "./hash.ts";
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
    },
  ): Promise<HarnessSyncResult>;
  runHarnessTests(container: string, codeunit: number): Promise<TestResult>;
}

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
    const slot = this.slots.get(container);
    if (!slot) throw new Error(`unknown container ${container}`);
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
  ): Promise<Held<T>> {
    checkCancel(signal);
    let container = "";
    let queue_ms = 0;
    const { result, retries } = await withInfraRetry<T>(
      async ({ excludeContainers, onRouted }) => {
        checkCancel(signal);
        const eligible = this.healthy().filter((c) =>
          !excludeContainers.includes(c)
        );
        if (eligible.length === 0) {
          throw new NoEligibleContainersError(
            excludeContainers,
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
        maxRetries: this.opts.maxInfraRetries ??
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
  },
): Promise<BuiltApp[]> {
  const files = new Map(o.prebuilt ?? []);
  const out: BuiltApp[] = [];
  await Deno.mkdir(join(o.outDir, ".apps"), { recursive: true });
  const lockedIds = new Set(o.lock.packages.map((p) => p.app_id.toLowerCase()));
  const lockedByName = new Map(o.lock.packages.map((p) => [p.file, p.sha256]));
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
    const dir = join(o.outDir, app.folder);
    await Deno.remove(dir, { recursive: true }).catch(() => {});
    await safeCopyTree(join(o.srcDir, app.folder), dir, {
      skip: isTaskBuildArtifact,
    });
    const appJson = JSON.parse(await Deno.readTextFile(join(dir, "app.json")));
    appJson.version = version;
    await Deno.writeTextFile(
      join(dir, "app.json"),
      JSON.stringify(appJson, null, 2),
    );
    const pk = join(dir, ".alpackages");
    await restoreSymbols(o.lock.store, o.lock.packages, pk);
    const workspaceFiles = new Set<string>();
    for (const f of files.values()) {
      await Deno.copyFile(f, join(pk, basename(f)));
      workspaceFiles.add(basename(f));
    }
    const t0 = performance.now();
    const r = await bc.compileProject(container, {
      path: dir,
      appJson,
      sourceFiles: [],
      testFiles: [],
    });
    const compile_ms = performance.now() - t0;
    for await (const e of Deno.readDir(pk)) {
      // Only packages are checked: BCH writes its own index
      // (cache_AppInfo.json) into .alpackages during the compile.
      if (!e.name.toLowerCase().endsWith(".app")) continue;
      if (workspaceFiles.has(e.name)) continue;
      const sha = lockedByName.get(e.name);
      if (sha === undefined || await hashFile(pk, join(pk, e.name)) !== sha) {
        throw new ValidationError(
          `compile of ${app.folder} used an unlocked symbol package: ${e.name} (the symbols lock does not match the compiler cache)`,
          [e.name],
        );
      }
    }
    let file: string | null = null;
    if (r.success && r.artifactPath) {
      file = join(o.outDir, ".apps", basename(r.artifactPath));
      await Deno.copyFile(r.artifactPath, file);
      files.set(app.folder, file);
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
}

export interface Prepared {
  container: string;
  built: BuiltApp[];
  wanted: WantedApp[];
  candidateIds: string[];
  buildOk: boolean;
  compile_ms: number;
  per_app_compiles: number;
}

export function prepareApps(lane: BcLane, o: PrepareInput): Promise<Prepared> {
  return lane.compile((container) => prepareOn(lane, container, o), o.signal);
}

async function prepareOn(
  lane: BcLane,
  container: string,
  o: PrepareInput,
): Promise<Prepared> {
  const graph = o.candidateApps;
  const pristineVersion = new Map(
    o.pristineApps.map((a) => [a.folder, a.version]),
  );
  const cands = new Set(candidateFolders(graph, o.changed));
  const buildId = await hashJson({
    symbols: o.lock.packages.map((p) => [p.app_id, p.version, p.sha256]),
    compiler: await lane.bc.harnessCompilerIdentity(container),
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
  const prereqs = graph.filter((a) => !cands.has(a.folder));
  const pre = await buildApps(lane.bc, container, {
    srcDir: o.pristine,
    apps: prereqs,
    versions,
    outDir: join(o.workDir, "prereq"),
    lock: o.lock,
    ...(o.signal ? { signal: o.signal } : {}),
  });
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
  const prebuilt = new Map(pre.map((b) => [b.folder, b.file!] as const));
  const candApps = graph.filter((a) => cands.has(a.folder));
  const built = await buildApps(lane.bc, container, {
    srcDir: o.candidateDir,
    apps: candApps,
    versions,
    outDir: join(o.workDir, "candidate"),
    lock: o.lock,
    prebuilt,
    ...(o.signal ? { signal: o.signal } : {}),
  });
  const all = [...pre, ...built];
  const buildOk = built.every((b) => b.ok);
  const fileOf = new Map(
    all.filter((b) => b.ok).map((b) => [b.folder, b.file!] as const),
  );
  const idOf = new Map(graph.map((a) => [a.folder, a.id]));
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
    }))
    : [];
  return {
    container,
    built,
    wanted,
    candidateIds: candApps.map((a) => a.id),
    buildOk,
    compile_ms: all.reduce((s, b) => s + b.compile_ms, 0),
    per_app_compiles: all.filter((b) => b.attempted).length,
  };
}

export interface TestSpec {
  codeunit: number;
  procedures: string[] | null;
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
): Promise<{ rows: TestRow[]; messages: TestMessage[]; test_ms: number }> {
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
  return { rows, messages, test_ms };
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
      }
      : { deployed, ...await runTests(bc, container, i.tests) };
  } catch (err) {
    const c = await cleanup();
    if (c) throw new CleanupFailedError(err, c, container);
    throw err;
  }
  return { ...r, cleanupError: await cleanup() };
}
