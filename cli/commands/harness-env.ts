/**
 * Real Harness Bench environment for the CLI. Order: refused and
 * unallocated containers, the bench lock, temp and sandbox sweeps (M0-03 b),
 * egress state (fail closed; M1-33), containers with a health monitor, lane,
 * backend on the container-facing address (M0-05; the sandbox gateway when
 * sandboxes are placed on the internal network), then recovery of
 * interrupted executions.
 */

import * as colors from "@std/fmt/colors";
import { join, resolve } from "@std/path";
import type { BcContainerProvider } from "../../src/container/bc-container-provider.ts";
import type { HarnessBc, HealthView } from "../../src/harness/bc-lane.ts";
import type { PlanEnv } from "../../src/harness/campaign.ts";
import type { HarnessEnv } from "../../src/harness/execution.ts";
import type { DockerCli } from "../../src/harness/sandbox.ts";
import type { EgressRuntime } from "../../src/harness/egress.ts";
import { ConfigManager } from "../../src/config/config.ts";
import { ConfigurationError, ValidationError } from "../../src/errors.ts";
import { allocatedContainer } from "../../src/harness/allocation.ts";
import {
  Backend,
  defaultBackendOps,
  resolveBackendHost,
} from "../../src/harness/backend.ts";
import {
  BcLane,
  buildCacheDir,
  buildCacheReport,
  dirBuildCache,
  lockDigestOf,
} from "../../src/harness/bc-lane.ts";
import {
  placedConcurrencyProblem,
  placedConcurrencyRefusal,
  type PlacedGate,
} from "../../src/harness/campaign.ts";
import type { HarnessConfig } from "../../src/harness/config.ts";
import {
  authorizedMarkerProblems,
  BACKEND_PORT,
  collectEgressState,
  MARKER_FILE,
  MARKER_STATES,
  realEgressCollector,
  realEgressRuntime,
  SANDBOX_NETWORK,
  verifyEgressState,
} from "../../src/harness/egress.ts";
import {
  holdNamespace,
  recoverInterrupted,
  refuseLegacyState,
} from "../../src/harness/execution.ts";
import { sweepWorkspaceTemp } from "../../src/harness/fsutil.ts";
import {
  harnessCommitOf,
  loadSymbolsLock,
  SYMBOLS_LOCK_PATH,
} from "../../src/harness/identity.ts";
import { loadPricingBook } from "../../src/harness/pricing.ts";
import { RecordStore } from "../../src/harness/records.ts";
import {
  bounded,
  namespaceOwner,
  realDocker,
  sweepOwnedSandboxes,
} from "../../src/harness/sandbox.ts";
import { type Lineage, loadLineage } from "../../src/harness/lineage.ts";
import {
  type BcEgressRecord,
  checkEnvironments,
  createBaseline,
  type EnvCheck,
  type InstanceManifest,
  renderEnvCheck,
} from "../../src/harness/environment.ts";
import {
  goldenReset,
  type ResetMechanism,
  UNCONFIGURED_RESET,
} from "../../src/harness/reset.ts";
import { dockerContextEnv } from "../../src/container/docker-context.ts";
import { loadTask } from "../../src/harness/task.ts";
import { ContainerHealthMonitor } from "../../src/health/monitor.ts";
import {
  acquireBenchLock,
  BenchLockHeldError,
  DEFAULT_BENCH_LOCK_DIR,
} from "../../src/utils/bench-lock.ts";
import { setupContainers } from "./bench/container-setup.ts";

/** Cronus28 hosts a foreign app on codeunit 80013; Cronus284 is untouched pending the owner. */
export const REFUSED_CONTAINERS = ["Cronus28", "Cronus284"];
export const EGRESS_MARKER = MARKER_FILE;

/** Host egress verification (M1-33) against the marker at markerPath. Returns problems; empty means verified. */
export type EgressVerifier = (markerPath: string) => Promise<string[]>;
/** off: nat network, no proxy; placed: internal network, plus proxy and preflight for normal (not stub) cells; enforced: placed and authorized. */
export type EgressMode = "off" | "placed" | "enforced";

export interface EnvOptions {
  repoRoot: string;
  /** Records root of this command (results/harness, or .../cells, .../fixtures). */
  resultsDir: string;
  containers: string[];
  /** H-09: the judges' containers (their own lane), disjoint from `containers`. */
  judgeContainers?: string[];
  backendHost?: string | undefined;
  backendPort: number;
  secretsSource: string;
  symbolStore: string;
  privateRoot: string;
  credentialLedger: string | null;
  command: string;
  supervised: boolean;
  /** H-35 S3.2: the reset lineage file (absolute); none = judging refuses. */
  lineage?: string | null;
  /** H-35 S3 L2b: `--unverified-bc-egress-ok <reason>` (an unenforced lineage needs it). */
  bcEgressOverride?: string | null;
  /** The qualification probe (backend-probe --enforced): a candidate marker places it. */
  probe?: boolean;
  /** Campaign blocks at once (harness run); above 1 the marker is rechecked under the lock (M1-33c). */
  concurrency?: number;
  /** The experiment's arm configs (harness run); above concurrency 1 the placed gate needs them (absent is refused). */
  configs?: readonly HarnessConfig[];
}

export interface EnvDeps {
  /** The allocated spelling of a container, or a throw (coord allocation.json, fail closed). */
  allocated(name: string): Promise<string>;
  /** The release; `lost` checks this acquisition's own token (M10-08c run 002, required for the private root). */
  acquireLock: (
    dir: string,
    o: { command: string },
  ) => (() => Promise<void>) & { lost?: () => boolean };
  docker: () => DockerCli;
  setup(
    names: string[],
  ): Promise<{ bc: HarnessBc; names: string[]; dispose(): Promise<void> }>;
  resolveHost(): Promise<string>;
  owner(): string;
  health(names: string[]): HealthView;
  verifyEgress: EgressVerifier;
  /** The run-time egress seam for placed sandboxes (default: the real one). */
  egressRuntime?: (
    o: {
      repoRoot: string;
      markerPath: string;
      acceptCandidate?: boolean;
      concurrency?: number;
      proxyIsolation?: unknown;
    },
  ) => Promise<EgressRuntime>;
  /** Test seam for the backend bind (default: backend.serve). */
  serveBackend?: (
    backend: Backend,
    host: string,
    port: number,
  ) => { url: string; shutdown(): Promise<void> };
}

export const REAL_DEPS: EnvDeps = {
  allocated: (name) => allocatedContainer(name),
  acquireLock: (dir, o) => acquireBenchLock(dir, o),
  docker: () => realDocker(),
  async setup(names) {
    const cfg = await ConfigManager.loadConfig();
    const r = await setupContainers(names, "bccontainer", cfg.container ?? {});
    const bc = r.containerProvider as BcContainerProvider;
    return { bc, names: r.containerNames, dispose: () => bc.dispose() };
  },
  resolveHost: resolveBackendHost,
  owner: () => Deno.hostname(),
  health: (names) =>
    new ContainerHealthMonitor({
      windowSize: 20,
      expectedContainerNames: names,
    }),
  verifyEgress: async (markerPath) =>
    verifyEgressState(
      await collectEgressState(realEgressCollector(markerPath)),
    ),
  egressRuntime: realEgressRuntime,
};

export interface OpenEnv {
  env: HarnessEnv;
  close(): Promise<void>;
}

/** What `harness env check` and `harness baseline create` read. */
export interface LineageCommandOptions {
  repoRoot: string;
  containers: string[];
  /** The lineage file (absolute). */
  lineage: string;
  symbolStore: string;
  /** H-35 S3 L2b: `--unverified-bc-egress-ok <reason>` (env check). */
  bcEgressOverride?: string | null;
}

type ResetFor = (lineagePath: string, lineage: Lineage) => ResetMechanism;
const goldenResetFor = (repoRoot: string): ResetFor => (lineagePath, lineage) =>
  goldenReset({
    repoRoot,
    lineagePath,
    lineage,
    dockerEnv: dockerContextEnv(),
  });

/** Allocated containers, the lineage, its mechanism and the lock digest. */
async function lineageContext(
  o: LineageCommandOptions,
  deps: EnvDeps,
  resetFor: ResetFor,
) {
  const lineage = await loadLineage(o.lineage);
  const names: string[] = [];
  for (const c of o.containers) names.push(await deps.allocated(c));
  const symbols = await loadSymbolsLock(o.repoRoot);
  if (!symbols) throw new ValidationError("no symbols lock", ["symbols"]);
  return {
    lineage,
    names,
    mechanism: resetFor(o.lineage, lineage),
    inputs: {
      resultsRoot: join(o.repoRoot, "results", "harness"),
      lineageId: lineage.id,
      lockDigest: await lockDigestOf({
        store: o.symbolStore,
        packages: symbols,
      }),
      ...(o.bcEgressOverride ? { bcEgressOverride: o.bcEgressOverride } : {}),
    },
  };
}

/**
 * `harness env check` (H-35 S3.4): each container's lineage, env_fp and
 * baseline, and whether they share one admissible env_fp. Read-only.
 */
export async function envCheck(
  o: LineageCommandOptions,
  deps: EnvDeps = REAL_DEPS,
  resetFor: ResetFor = goldenResetFor(o.repoRoot),
): Promise<EnvCheck> {
  const x = await lineageContext(o, deps, resetFor);
  const ready = await deps.setup(x.names);
  try {
    return await checkEnvironments(
      ready.bc,
      x.mechanism,
      ready.names,
      x.inputs,
    );
  } finally {
    await ready.dispose();
  }
}

/**
 * `harness baseline create` (H-35 S3.4; lane-ops, under a container lease):
 * reset each container to the lineage and write its instance manifest.
 */
export async function baselineCreate(
  o: LineageCommandOptions,
  deps: EnvDeps = REAL_DEPS,
  resetFor: ResetFor = goldenResetFor(o.repoRoot),
): Promise<InstanceManifest[]> {
  const x = await lineageContext(o, deps, resetFor);
  const ready = await deps.setup(x.names);
  try {
    const out: InstanceManifest[] = [];
    for (const c of ready.names) {
      out.push(await createBaseline(ready.bc, x.mechanism, c, x.inputs));
    }
    return out;
  } finally {
    await ready.dispose();
  }
}

/**
 * The egress mode from the marker and a verification now: no marker is off;
 * any marker whose verification fails stops the command; qualified places
 * sandboxes on the internal network; authorized also enforces.
 */
export async function egressMode(
  sharedResults: string,
  verify: EgressVerifier,
  o: { probe?: boolean; repoRoot?: string } = {},
): Promise<EgressMode> {
  const path = join(sharedResults, EGRESS_MARKER);
  let text: string;
  try {
    text = await Deno.readTextFile(path);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return "off";
    throw new ConfigurationError(
      `cannot read the egress marker ${path}: ${(err as Error).message}`,
    );
  }
  let marker: Record<string, unknown> & { state?: unknown };
  try {
    marker = JSON.parse(text);
  } catch (err) {
    throw new ConfigurationError(
      `egress marker ${path} is not JSON, refusing to run: ${
        (err as Error).message
      }`,
    );
  }
  if (!(MARKER_STATES as readonly unknown[]).includes(marker?.state)) {
    throw new ConfigurationError(
      `egress marker ${path} has an unknown state ${
        JSON.stringify(marker?.state)
      }, refusing to run`,
    );
  }
  const problems = await verify(path);
  if (problems.length > 0) {
    throw new ConfigurationError(
      `egress marker present but verification failed, refusing to run: ${
        problems.join("; ")
      }`,
    );
  }
  if (marker.state === "authorized") {
    // Review item 3: the marker's evidence is rechecked on every read.
    const bad = await authorizedMarkerProblems(
      o.repoRoot ?? resolve(sharedResults, "..", ".."),
      marker,
    );
    if (bad.length > 0) {
      throw new ConfigurationError(
        `egress marker ${path} is not authorized, refusing to run: ${
          bad.join("; ")
        }`,
      );
    }
    return "enforced";
  }
  if (marker.state === "qualified") return "placed";
  // Review item 1: a candidate places only the credentialless qualification probe.
  return marker.state === "candidate" && o.probe ? "placed" : "off";
}

/**
 * Whether the marker would place campaign cells (qualified or authorized),
 * read without verification: a marker present but unreadable counts as
 * placing (fail closed). No marker places nothing.
 */
export async function markerPlaces(sharedResults: string): Promise<boolean> {
  let text: string;
  try {
    text = await Deno.readTextFile(join(sharedResults, EGRESS_MARKER));
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return false;
    return true;
  }
  try {
    const state = JSON.parse(text)?.state;
    return state !== "candidate";
  } catch {
    return true;
  }
}

/**
 * Whether the marker says authorized, read without verification (the up-front
 * concurrency gate; enforcement itself is verified when the environment opens).
 * Unreadable or absent is not authorized (fail closed).
 */
export async function markerAuthorized(
  sharedResults: string,
): Promise<boolean> {
  try {
    return JSON.parse(
      await Deno.readTextFile(join(sharedResults, EGRESS_MARKER)),
    )?.state === "authorized";
  } catch {
    return false;
  }
}

/**
 * The marker's proxy_isolation, read without verification (M1-33e); undefined
 * when there is no marker, it is unreadable or it has no such field.
 */
export async function markerProxyIsolation(
  sharedResults: string,
): Promise<unknown> {
  try {
    return JSON.parse(
      await Deno.readTextFile(join(sharedResults, EGRESS_MARKER)),
    )?.proxy_isolation;
  } catch {
    return undefined;
  }
}

/** Enforcement counts only when the marker says authorized AND the host verifies now; a failing marker stops. */
export async function resolveEgress(
  sharedResults: string,
  verify: EgressVerifier,
): Promise<boolean> {
  return (await egressMode(sharedResults, verify)) === "enforced";
}

/** Where the backend binds: the sandbox gateway (fixed port) when placed, else the nat gateway. */
export async function backendAddress(
  mode: EgressMode,
  o: { backendHost?: string | undefined; backendPort: number },
  resolveHost: () => Promise<string>,
): Promise<{ host: string; port: number }> {
  if (mode === "off") {
    return { host: o.backendHost ?? await resolveHost(), port: o.backendPort };
  }
  if (
    (o.backendHost !== undefined &&
      o.backendHost !== SANDBOX_NETWORK.gateway) ||
    o.backendPort !== BACKEND_PORT
  ) {
    throw new ConfigurationError(
      `egress is ${mode}: the backend binds ${SANDBOX_NETWORK.gateway}:${BACKEND_PORT} only (got ${
        o.backendHost ?? "(default)"
      }:${o.backendPort})`,
    );
  }
  return { host: SANDBOX_NETWORK.gateway, port: BACKEND_PORT };
}

/**
 * What `harness run --dry-run` needs: records, images, the symbols lock and
 * the egress state (a failing marker still stops). No lock, no container.
 */
export async function openPlanEnv(
  o: EnvOptions,
  deps: EnvDeps = REAL_DEPS,
): Promise<PlanEnv> {
  const symbols = await loadSymbolsLock(o.repoRoot);
  if (!symbols) {
    throw new ValidationError(
      "no symbols lock: run `centralgauge harness symbols lock --from <dir> --store <dir>`",
      [SYMBOLS_LOCK_PATH],
    );
  }
  // The marker is verified exactly as the real environment verifies it (a
  // failing one throws), and the gate inputs are read after that, so a dry
  // run's concurrency gate sees what a real run's would.
  const sharedResults = join(o.repoRoot, "results", "harness");
  const mode = await egressMode(sharedResults, deps.verifyEgress);
  return {
    repoRoot: o.repoRoot,
    harnessRoot: join(o.repoRoot, "harness"),
    resultsRoot: o.resultsDir,
    store: new RecordStore(o.resultsDir),
    docker: deps.docker(),
    symbols,
    egressEnforced: mode === "enforced",
    egressPlaced: mode !== "off",
    proxyIsolation: await markerProxyIsolation(sharedResults),
  };
}

export async function openHarnessEnv(
  o: EnvOptions,
  deps: EnvDeps = REAL_DEPS,
): Promise<OpenEnv> {
  // H-35 S3.2: an unproven lineage stops the start, before anything opens.
  const lineage = o.lineage ? await loadLineage(o.lineage) : null;
  const reset = lineage
    ? goldenReset({
      repoRoot: o.repoRoot,
      lineagePath: o.lineage!,
      lineage,
      dockerEnv: dockerContextEnv(),
    })
    : UNCONFIGURED_RESET;
  const judges = o.judgeContainers ?? [];
  const refused = [...o.containers, ...judges].filter((c) =>
    REFUSED_CONTAINERS.some((r) => r.toLowerCase() === c.toLowerCase())
  );
  if (refused.length > 0) {
    throw new ConfigurationError(
      `harness refuses container(s) ${
        refused.join(", ")
      } (Cronus28: codeunit 80013 collision; Cronus284: owner pending)`,
    );
  }
  if (o.containers.length === 0) {
    throw new ConfigurationError(
      "pass --containers (BC containers the harness may use)",
    );
  }
  // H-09: a judge never takes an agent's container (its own lane, own reroutes).
  const shared = judges.filter((j) =>
    o.containers.some((c) => c.toLowerCase() === j.toLowerCase())
  );
  if (shared.length > 0) {
    throw new ConfigurationError(
      `--judge-containers must be disjoint from --containers: ${
        shared.join(", ")
      } in both`,
    );
  }
  const containers: string[] = [];
  for (const c of o.containers) containers.push(await deps.allocated(c));
  const judgeNames: string[] = [];
  for (const c of judges) judgeNames.push(await deps.allocated(c));
  const symbols = await loadSymbolsLock(o.repoRoot);
  if (!symbols) {
    throw new ValidationError(
      "no symbols lock: run `centralgauge harness symbols lock --from <dir> --store <dir>`",
      [SYMBOLS_LOCK_PATH],
    );
  }
  const sharedResults = join(o.repoRoot, "results", "harness");
  let release: () => Promise<void>;
  try {
    release = deps.acquireLock(
      join(o.repoRoot, DEFAULT_BENCH_LOCK_DIR),
      { command: o.command },
    );
  } catch (err) {
    // M10-08c run 002 item 7: a second environment in this checkout meets this lock first.
    if (err instanceof BenchLockHeldError) {
      err.message +=
        `; a harness environment or bench already runs in this checkout: wait for it, or run another environment from its own worktree with its own --private-dir (this one: ${o.privateRoot})`;
    }
    throw err;
  }
  const closers: (() => Promise<void>)[] = [release];
  const closeAll = async () => {
    for (const c of closers) await c().catch(() => {});
  };
  let closing: Promise<void> | null = null;
  try {
    // M10-08c: the sweeps below and in recoverInterrupted are crash recovery
    // of this private root only (its temp, intents, secrets and sandboxes):
    // its exclusive lock first, before any of them, then its own owner label.
    let namespaceLost: () => boolean;
    try {
      const held = deps.acquireLock(o.privateRoot, {
        command: `${o.command} (private root)`,
      });
      closers.push(held);
      // M10-08c run 002 item 1: the token this acquisition took, never a later holder's.
      if (!held.lost) {
        throw new ConfigurationError(
          `the lock on private root ${o.privateRoot} carries no ownership check`,
        );
      }
      namespaceLost = held.lost;
    } catch (err) {
      if (err instanceof BenchLockHeldError) {
        err.message +=
          `; another harness environment uses --private-dir ${o.privateRoot}: wait for it or pass another --private-dir`;
      }
      throw err;
    }
    /** Right before every sweep and removal: the lock is still ours, or stop. */
    const hold = () =>
      holdNamespace(
        { privateRoot: o.privateRoot, namespaceLost },
        "nothing swept",
      );
    hold();
    // Review 546e8337 P2-a, run 003 item 1: any older harness's state refuses
    // the start before ANY sweep; nothing legacy is ever removed here.
    const docker = deps.docker();
    await refuseLegacyState(docker, deps.owner(), o.privateRoot);
    // M1-33e: the marker's proxy_isolation, fixed here under the lock for
    // the life of the environment (a later change refuses the next cell).
    const proxyIsolation = await markerProxyIsolation(sharedResults);
    // M1-33c review (TOCTOU): the marker may have become placing since
    // harness run's up-front check; recheck under the lock, before any write.
    // The same full gate as harness run's up-front check and runCampaign,
    // arms included; configs absent at concurrency > 1 is refused.
    const concurrency = o.concurrency ?? 1;
    const gate = (g: PlacedGate) =>
      placedConcurrencyProblem(g, concurrency, o.configs) ??
        (g.placed && concurrency > 1 && !o.configs
          ? "arm images unknown (no experiment configs passed to the environment)"
          : null);
    if (concurrency > 1 && await markerPlaces(sharedResults)) {
      const problem = gate({
        placed: true,
        enforced: await markerAuthorized(sharedResults),
        proxyIsolation,
      });
      if (problem) {
        throw placedConcurrencyRefusal(proxyIsolation, concurrency, problem);
      }
    }
    // The effective mode (marker plus host verification) is fixed here, under
    // the lock and before any sweep, and gates concurrency again (M1-33c r2).
    const mode = await egressMode(sharedResults, deps.verifyEgress, {
      repoRoot: o.repoRoot,
      ...(o.probe ? { probe: true } : {}),
    });
    const modeProblem = gate({
      placed: mode !== "off",
      enforced: mode === "enforced",
      proxyIsolation,
    });
    if (modeProblem) {
      throw placedConcurrencyRefusal(proxyIsolation, concurrency, modeProblem);
    }
    const store = new RecordStore(o.resultsDir);
    await Deno.mkdir(join(o.privateRoot, "work"), { recursive: true });
    hold();
    await store.sweepTemp();
    hold(); // run 003 item 2: again between the two temp sweeps
    await sweepWorkspaceTemp(o.resultsDir, o.privateRoot);
    const owner = namespaceOwner(deps.owner(), o.privateRoot);
    hold();
    const swept = await sweepOwnedSandboxes(
      docker,
      owner,
      undefined,
      undefined,
      hold,
    );
    if (swept.length > 0) {
      console.log(
        `${
          colors.yellow("[WARN]")
        } removed ${swept.length} leftover sandbox(es): ${swept.join(", ")}`,
      );
    }
    const ready = await deps.setup([...containers, ...judgeNames]);
    closers.unshift(ready.dispose);
    const health = deps.health(ready.names);
    // setup keeps the order: the agents' names first, then the judges'.
    const lane = new BcLane(ready.bc, ready.names.slice(0, containers.length), {
      health,
    });
    const judgeLane = judgeNames.length > 0
      ? new BcLane(ready.bc, ready.names.slice(containers.length), { health })
      : undefined;
    // H-35 S3.4 (ruling (c)): with a lineage, every container must be an
    // admitted instance of it, all of one env_fp, before any lease.
    let bcEgress: BcEgressRecord | null = null;
    if (lineage) {
      const check = await checkEnvironments(ready.bc, reset, ready.names, {
        resultsRoot: sharedResults,
        lineageId: lineage.id,
        lockDigest: await lockDigestOf({
          store: o.symbolStore,
          packages: symbols,
        }),
        ...(o.bcEgressOverride ? { bcEgressOverride: o.bcEgressOverride } : {}),
      });
      bcEgress = check.bc_egress;
      const block = renderEnvCheck(check);
      if (!check.admissible) {
        throw new ConfigurationError(
          `judging environment not admissible (run harness baseline create, or fix the containers):\n${block}`,
        );
      }
      console.log(block);
    }
    const { host, port } = await backendAddress(mode, o, deps.resolveHost);
    const egress = mode === "off"
      ? undefined
      : await (deps.egressRuntime ?? realEgressRuntime)({
        repoRoot: o.repoRoot,
        markerPath: join(sharedResults, EGRESS_MARKER),
        ...(o.probe ? { acceptCandidate: true } : {}),
        // verify() gates concurrency > 1 on the marker's proxy_isolation (M1-33d review).
        concurrency: o.concurrency ?? 1,
        proxyIsolation,
      });
    // The runtime owns the environment's one shared proxy (M1-33d): it goes with the env.
    if (egress) closers.unshift(() => egress.shutdown());
    // H-27 build caches, one per consumer and never crossed (H-35 design-r4
    // 3.1): the agent backend's and the judge's (shared by the run's cells).
    const openCache = (consumer: "agent" | "judge") => {
      const dir = buildCacheDir(o.privateRoot, consumer);
      closers.push(async () => {
        const r = await buildCacheReport(dir);
        console.log(
          `${
            colors.dim("[cache]")
          } ${consumer} build cache ${dir}: ${r.entries} builds, ${
            (r.bytes / 1e6).toFixed(1)
          } MB`,
        );
      });
      return dirBuildCache(dir);
    };
    const agentCache = openCache("agent");
    const buildCache = openCache("judge");
    const backend = new Backend({
      approvedRoots: [join(o.privateRoot, "work")],
      workRoot: join(o.privateRoot, "backend"),
      ops: defaultBackendOps(lane),
      allowedHosts: [host],
      buildCache: agentCache,
    });
    // H-16: a request revoke gave up on still uses this private root: the
    // locks are released only after it has drained (closers run front first).
    closers.unshift(() => backend.idle());
    const server = (deps.serveBackend ?? ((b, h, p) => b.serve(h, p)))(
      backend,
      host,
      port,
    );
    closers.unshift(async () => {
      try {
        await bounded(server.shutdown(), 10_000, "backend server shutdown");
      } catch (err) {
        console.error(
          `${colors.yellow("[WARN]")} ${
            err instanceof Error ? err.message : err
          }; abandoning the server`,
        );
      }
    });
    const env: HarnessEnv = {
      repoRoot: o.repoRoot,
      // H-35 provenance (orch Sol r1 #6): the commit every judgment records.
      harnessCommit: await harnessCommitOf(o.repoRoot),
      harnessRoot: join(o.repoRoot, "harness"),
      resultsRoot: o.resultsDir,
      privateRoot: o.privateRoot,
      store,
      lane,
      ...(judgeLane ? { judgeLane } : {}),
      backend,
      backendUrl: server.url,
      buildCache,
      docker,
      owner,
      symbols,
      symbolStore: o.symbolStore,
      secretsSource: o.secretsSource,
      // Owned ids come from each grant's and judgment's trusted roots (M1-16).
      // H-35 S3: every judge deployment resets to the lineage (--lineage);
      // without one, judging refuses.
      deploy: {
        ledgerRoot: join(sharedResults, "bc-ledger"),
        reset,
        ...(bcEgress ? { bcEgress } : {}),
      },
      pricing: (at) => loadPricingBook(join(o.repoRoot, "site", "catalog"), at),
      supervised: o.supervised,
      egressEnforced: mode === "enforced",
      ...(egress ? { egress, proxyIsolation } : {}),
      credentialLedger: o.credentialLedger,
      // No placeholder: an unset lane is refused at the credential reservation (M1-28b).
      lane_id: Deno.env.get("CG_LANE")?.trim() ?? "",
      namespaceLost,
    };
    const recovered = await recoverInterrupted(env, loadTask);
    for (const e of recovered) {
      console.log(
        `${
          colors.yellow("[WARN]")
        } recovered interrupted execution ${e.id} (${e.termination}, cost ${
          e.telemetry.cost_usd ?? "unknown"
        })`,
      );
    }
    // A second close is a no-op (M1-33e).
    return { env, close: () => closing ??= closeAll() };
  } catch (err) {
    await closeAll();
    throw err;
  }
}
