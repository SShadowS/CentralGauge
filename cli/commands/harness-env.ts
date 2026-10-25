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
import { BcContainerProvider } from "../../src/container/bc-container-provider.ts";
import type { HarnessBc, HealthView } from "../../src/harness/bc-lane.ts";
import type { PlanEnv } from "../../src/harness/campaign.ts";
import type { HarnessEnv, SecretAccount } from "../../src/harness/execution.ts";
import type { DockerCli } from "../../src/harness/sandbox.ts";
import type { EgressRuntime } from "../../src/harness/egress.ts";
import { ConfigManager } from "../../src/config/config.ts";
import {
  ConfigurationError,
  ContainerError,
  ValidationError,
} from "../../src/errors.ts";
import {
  allocatedContainer,
  allocatedContainers,
  DEFAULT_COORD_ROOT,
} from "../../src/harness/allocation.ts";
import {
  coordLeaseBlock,
  laneBlocked,
  poolBlocked,
} from "../../src/harness/coord-lease.ts";
import { JudgePool, type PoolBounds } from "../../src/harness/pool.ts";
import { ContainerProviderRegistry } from "../../src/container/registry.ts";
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
  type LockedSymbols,
} from "../../src/harness/bc-lane.ts";
import type { OnPremIndex } from "../../src/harness/onprem-symbols.ts";
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
  admitOnPrem,
  ensurePin,
  type EnvPin,
  holdNamespace,
  pinPath,
  recoverFences,
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
  bcEgressAdmission,
  type BcEgressRecord,
  checkEnvironments,
  createBaseline,
  type EnvCheck,
  type InstanceManifest,
  instanceManifestPath,
  renderEnvCheck,
} from "../../src/harness/environment.ts";
import {
  fsDiff,
  type FsDiffEntry,
  fsLineRestored,
  goldenReset,
  type ResetMechanism,
  toleratingCache,
  UNCONFIGURED_RESET,
} from "../../src/harness/reset.ts";
import {
  claimRecord,
  evidenceProblem,
  findRecords,
  type FoundRecord,
  recordFile,
  releaseOwned,
  removeUnchanged,
  rewriteOwned,
} from "../../src/harness/quarantine.ts";
import { dockerContextEnv } from "../../src/container/docker-context.ts";
import {
  containerId,
  inspectContainer,
} from "../../src/container/docker-inspect.ts";
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
  secretAccounts: SecretAccount[];
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
  /**
   * H-41 (Q1, section 6): `auto` judging: the judges are a pool that changes
   * while the run goes on. "containers" (rejudge --containers auto): the
   * lane itself, `containers` empty; "judges" (run --judge-containers auto):
   * the judge lane, `judgeContainers` empty. Needs a lineage.
   */
  auto?: "containers" | "judges";
  /** H-41 (Q5): --pool-wait-min, how long an empty pool may hold queued judging. */
  poolWaitMin?: number;
  /** H-41 (7): --coord-lease pairs: coord leases this run holds (container -> token). */
  coordLeases?: ReadonlyMap<string, string>;
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
  /**
   * H-35 run 004 #2: a HarnessBc for harnessCompilerIdentity only (docker
   * inspect): no cleanup, publish or compiler warmup, unlike setup.
   */
  inspect(): HarnessBc;
  /** H-35 run 004 #3: where persisted quarantine records live (coord root). */
  quarantineDir(): string;
  /** H-41 (7): the coord root whose coord.json and leases admission reads (fail closed). */
  coordRoot(): string;
  /** H-41 (6): every container allocated to the campaign now (allocatedContainers). */
  allocatedAll(): Promise<string[]>;
  /** H-41 (5, 6): Docker reports the container running (read-only). */
  running(name: string): Promise<boolean>;
  /** H-41 test seam: the `auto` pool's bounds (default POOL_BOUNDS). */
  poolBounds?: Partial<PoolBounds>;
  /** H-35 run 004 Sol r1 H5: the container's immutable Docker id (read-only); throws when unreadable. */
  containerId(name: string): Promise<string>;
  resolveHost(): Promise<string>;
  owner(): string;
  health(names: string[]): HealthView;
  verifyEgress: EgressVerifier;
  /** H-35 run 004 #4: the judging reset mechanism for a lineage (default: goldenReset). */
  resetFor?: ResetFor;
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
  /** H-38 test seam for the OnPrem index admission (default: admitOnPrem). */
  admitOnPrem?: (lock: LockedSymbols) => Promise<OnPremIndex>;
}

export const REAL_DEPS: EnvDeps = {
  allocated: (name) => allocatedContainer(name),
  acquireLock: (dir, o) => acquireBenchLock(dir, o),
  docker: () => realDocker(),
  async setup(names) {
    // H-41 (6): an `auto` pool's empty start: the provider its joins set up
    // (setupContainers caches it per type in the registry).
    if (names.length === 0) {
      const bc = ContainerProviderRegistry.create(
        "bccontainer",
      ) as BcContainerProvider;
      return { bc, names: [], dispose: () => bc.dispose() };
    }
    const cfg = await ConfigManager.loadConfig();
    const r = await setupContainers(names, "bccontainer", cfg.container ?? {});
    const bc = r.containerProvider as BcContainerProvider;
    return { bc, names: r.containerNames, dispose: () => bc.dispose() };
  },
  // No session is opened: harnessCompilerIdentity is a docker inspect.
  inspect: () => new BcContainerProvider(),
  quarantineDir: () =>
    join(
      Deno.env.get("CG_COORD_ROOT") || DEFAULT_COORD_ROOT,
      "harness-quarantine",
    ),
  coordRoot: () => Deno.env.get("CG_COORD_ROOT") || DEFAULT_COORD_ROOT,
  allocatedAll: () => allocatedContainers(),
  running: async (name) => (await inspectContainer(name))?.running === true,
  containerId,
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

export type ResetFor = (
  lineagePath: string,
  lineage: Lineage,
) => ResetMechanism;
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

const msg = (err: unknown) => err instanceof Error ? err.message : String(err);

/** H-35 run 004 Sol r2 N3: how long close waits for in-flight lane operations. */
export const LANE_DRAIN_MS = 10 * 60_000;

/**
 * H-35 run 004 Sol r1 H4/H5: the records refusing a container, found by its
 * current Docker id and by its name. An unreadable id refuses (id null).
 */
async function containerHolds(
  deps: EnvDeps,
  qDir: string,
  name: string,
): Promise<{ id: string | null; found: FoundRecord[]; why: string[] }> {
  let id: string;
  try {
    id = await deps.containerId(name);
  } catch (err) {
    return { id: null, found: [], why: [`container id unknown: ${msg(err)}`] };
  }
  const found = await findRecords(qDir, { name, id });
  return { id, found, why: found.map((f) => f.why) };
}

/**
 * H-35 run 004 Sol r1 H6: the recorded L4 paths a recovery capture does not
 * show remediated. An added file must be absent; any other entry must be
 * its before line (fsLineRestored: an F line's head to the recorded width,
 * H-40). Keys as fsDiff reads them (case-insensitive), no
 * exclusions.
 */
function unremediated(
  recorded: readonly FsDiffEntry[],
  capture: readonly string[],
  roots: readonly string[],
): string[] {
  const now = new Map(
    fsDiff(capture, [], [], roots).diff.map((d) => [
      d.path.toLowerCase(),
      d.before,
    ]),
  );
  return [
    ...new Set(
      recorded.filter((e) => {
        const cur = now.get(e.path.toLowerCase());
        // addendum 8b Q6: an F line field by field, its head to the
        // recorded width (a digest v3 record holds 2 bytes)
        return e.before === null
          ? cur !== undefined
          : !cur || !fsLineRestored(e.before, cur);
      }).map((e) => e.path),
    ),
  ];
}

/** The F line's content sha256, or null for any other line. */
const fileSha = (line: string | null) =>
  line?.startsWith("F|") ? line.split("|")[1] ?? null : null;

/**
 * Addendum 6 (orch r005c HIGH): a recorded difference the recovery capture
 * still shows as a tolerated platform-cache entry: the path is in the
 * capture now, that current line passes the lineage's caches against the
 * recorded before line, and a file still has its recorded sha256.
 */
function cacheStillTolerated(
  e: FsDiffEntry,
  capture: readonly string[],
  m: ResetMechanism,
): boolean {
  const cur = new Map(
    fsDiff(capture, [], [], m.fsRoots ?? []).diff.map((d) => [
      d.path.toLowerCase(),
      d,
    ]),
  ).get(e.path.toLowerCase());
  const now = cur?.before;
  if (!cur || !now || !e.after) return false;
  // the CURRENT path spelling, as fsDiff would judge it (self-check 2)
  const by = toleratingCache(m.fsCaches ?? [], {
    path: cur.path,
    before: e.before,
    after: now,
  });
  if (!by) return false;
  // a new-file cache keeps the recorded content; an in_place cache
  // (addendum 7) may keep changing, judged by path, size and attributes, an
  // in_place_cab cache (addendum 8b) by path, attributes and its CAB head
  return by.inPlace === true || by.inPlaceCab === true || now[0] !== "F" ||
    fileSha(now) === fileSha(e.after);
}

/**
 * H-35 run 004 Sol r2 N5: the recorded paths this capture cannot show
 * absent or restored: outside every root (case-insensitive, at a separator)
 * or below a reparse point (an `L|` line, not traversed) in the capture.
 */
function unobservable(
  recorded: readonly FsDiffEntry[],
  capture: readonly string[],
  roots: readonly string[],
): string[] {
  const norm = (p: string) =>
    p.replaceAll("/", "\\").replace(/\\+$/, "").toLowerCase();
  const under = (p: string, dir: string) => p.startsWith(`${dir}\\`);
  const links = capture.flatMap((l) => {
    const m = /^L\|\d+\|\d+\|([^|]+)\|[^|]*$/.exec(l.trimEnd());
    return m ? [norm(m[1]!)] : [];
  });
  const rs = roots.map(norm);
  return [
    ...new Set(
      recorded.map((e) => e.path).filter((raw) => {
        const p = norm(raw);
        // orch r004 N5 residual: a named stream (`<entry>:<stream>`; a ':'
        // past the drive is always a stream) is judged by its owning entry,
        // so a stream on a reparse point itself is unobservable too
        // run 005 self-check: only in the last component, so a drive colon
        // (C: or \\?\C:) is never read as a stream separator
        const colon = p.indexOf(":", Math.max(p.lastIndexOf("\\") + 1, 2));
        const owner = colon < 0 ? p : p.slice(0, colon);
        return !rs.some((r) => owner === r || under(owner, r)) ||
          links.some((l) => (colon >= 0 && owner === l) || under(owner, l));
      }),
    ),
  ];
}

const RECREATE =
  "no trustworthy filesystem evidence: the container must be recreated (lane-ops)";

/**
 * `harness env check` (H-35 S3.4): each container's lineage, env_fp and
 * baseline, and whether they share one admissible env_fp. Read-only (H-35
 * run 004 #2): docker inspect and files only, never setupContainers.
 */
export async function envCheck(
  o: LineageCommandOptions,
  deps: EnvDeps = REAL_DEPS,
  resetFor: ResetFor = goldenResetFor(o.repoRoot),
): Promise<EnvCheck> {
  const x = await lineageContext(o, deps, resetFor);
  const check = await checkEnvironments(
    deps.inspect(),
    x.mechanism,
    x.names,
    x.inputs,
  );
  // H-35 run 004 #3, Sol r1 H4/H5: any record (by id or name) or an
  // unreadable id fails its container's row.
  const qDir = deps.quarantineDir();
  const rows: typeof check.rows = [];
  for (const r of check.rows) {
    const h = await containerHolds(deps, qDir, r.container);
    if (h.why.length === 0) {
      rows.push(r);
      continue;
    }
    const why = h.id === null
      ? h.why.join("; ")
      : `${h.why.join("; ")}: run harness recover`;
    rows.push({ ...r, why: r.why ? `${why}; ${r.why}` : why });
  }
  return {
    ...check,
    rows,
    admissible: check.admissible && rows.every((r) => !r.why),
  };
}

/**
 * `harness baseline create` (H-35 S3.4; lane-ops, under a container lease):
 * reset each container to the lineage and write its instance manifest. The
 * reset is the lineage's script; the compiler identity is a docker inspect
 * (H-35 run 004 #2: no setupContainers prenuke or warmup either).
 */
export async function baselineCreate(
  o: LineageCommandOptions,
  deps: EnvDeps = REAL_DEPS,
  resetFor: ResetFor = goldenResetFor(o.repoRoot),
): Promise<InstanceManifest[]> {
  const x = await lineageContext(o, deps, resetFor);
  const bc = deps.inspect();
  const out: InstanceManifest[] = [];
  for (const c of x.names) {
    out.push(await createBaseline(bc, x.mechanism, c, x.inputs));
  }
  return out;
}

/**
 * `harness recover <container>` (H-35 run 004 #3): the only way out of a
 * persisted quarantine or a leftover in-use record. Under the harness lock:
 * the lineage's reset (and a new instance manifest), its post-reset
 * inventory check, one fsDigest capture without errors that shows every
 * recorded L4 difference undone (Sol r1 H6); only then are the records
 * removed. Any failure keeps them and leaves no manifest.
 *
 * H-35 run 004 Sol r2 N2: recover claims `<id>.recover.json` (exclusive
 * against environments and other recovers), refuses another owner's live
 * claim unless `abandon` names its token, refuses records of another
 * physical container (same name, other id), and deletes a record only if
 * unchanged since read. Sol r2 N4/N5: without trustworthy filesystem
 * evidence, or with a recorded path this capture cannot observe, it refuses.
 */
export async function recoverContainer(
  o: LineageCommandOptions & { abandon?: string | null },
  deps: EnvDeps = REAL_DEPS,
  resetFor: ResetFor = goldenResetFor(o.repoRoot),
): Promise<InstanceManifest> {
  if (o.containers.length !== 1) {
    throw new ConfigurationError("harness recover takes one container");
  }
  const release = deps.acquireLock(join(o.repoRoot, DEFAULT_BENCH_LOCK_DIR), {
    command: "harness recover",
  });
  try {
    const x = await lineageContext(o, deps, resetFor);
    const c = x.names[0]!;
    // H-35 run 004 Sol r1 H5: the records by the current id and by name;
    // no readable id, no recovery (fail closed)
    const qDir = deps.quarantineDir();
    const id = await deps.containerId(c);
    const token = crypto.randomUUID();
    const claim = () =>
      claimRecord(qDir, {
        state: "in_use",
        container: c,
        id,
        token,
        by: `${deps.owner()} harness recover`,
        pid: Deno.pid,
        host: deps.owner(),
      }, { recover: true });
    // H-35 run 004 Sol r2 N2: one recover per physical container
    let abandon = o.abandon ?? null;
    if (!await claim()) {
      const other = (await findRecords(qDir, { name: c, id })).find((f) =>
        f.file === recordFile(qDir, id, true)
      );
      if (!other?.record || !o.abandon || other.record.token !== o.abandon) {
        throw new ConfigurationError(
          `recover ${c}: another recover claims it (${
            other?.why ?? recordFile(qDir, id, true)
          }); if that run is gone, pass --abandon <its token>`,
        );
      }
      if ((await removeUnchanged([other])).length > 0 || !await claim()) {
        throw new ConfigurationError(
          `recover ${c}: the abandoned recover claim changed meanwhile; nothing done`,
        );
      }
      abandon = null; // spent on that claim
    }
    try {
      return await recoverClaimed({ ...o, abandon }, deps, x, c, id, token);
    } finally {
      await releaseOwned(qDir, id, token, { recover: true }).catch((err) =>
        console.error(
          `${colors.yellow("[WARN]")} recover claim ${
            recordFile(qDir, id, true)
          } not removed (it refuses ${c}): ${msg(err)}`,
        )
      );
    }
  } finally {
    await release();
  }
}

async function recoverClaimed(
  o: LineageCommandOptions & { abandon?: string | null },
  deps: EnvDeps,
  x: Awaited<ReturnType<typeof lineageContext>>,
  c: string,
  id: string,
  token: string,
): Promise<InstanceManifest> {
  const qDir = deps.quarantineDir();
  const found = (await findRecords(qDir, { name: c, id })).filter((f) =>
    f.record?.token !== token
  );
  // H-35 run 004 Sol r2 N2: only this physical container's records
  for (const f of found) {
    if (f.record && f.record.id !== id) {
      throw new ConfigurationError(
        `recover ${c}: record of another physical container ${f.record.id} (${f.file}): recover that container (if it no longer exists, an operator removes the record)`,
      );
    }
  }
  // a live claim (an environment, or an abandoned recover) needs --abandon <its token>
  for (const f of found) {
    const r = f.record;
    if (r?.state === "in_use" && r.token !== o.abandon) {
      throw new ConfigurationError(
        `recover ${c}: ${f.why}: a live environment may hold it; if it is gone, pass --abandon ${r.token}`,
      );
    }
  }
  if (o.abandon && !found.some((f) => f.record?.token === o.abandon)) {
    throw new ConfigurationError(
      `recover ${c}: --abandon ${o.abandon} names no record of this container`,
    );
  }
  // H-35 run 004 Sol r2 N4: evidence before any reset
  for (const f of found) {
    const p = evidenceProblem(f.record);
    if (p) {
      throw new ConfigurationError(
        `recover ${c}: ${RECREATE} (${f.file}: ${p})`,
      );
    }
  }
  const m = x.mechanism;
  if (!m.verifyClean || !m.fsDigest) {
    throw new ConfigurationError(
      `lineage ${x.lineage.id} has no inventory check or fs section: a recovery cannot be verified`,
    );
  }
  const manifest = instanceManifestPath(x.inputs.resultsRoot, c);
  const dropManifest = () =>
    Deno.remove(manifest).catch((err) => {
      if (!(err instanceof Deno.errors.NotFound)) throw err;
    });
  // The old manifest predates the quarantine: none until every step passed.
  await dropManifest();
  const made = await createBaseline(deps.inspect(), m, c, x.inputs);
  try {
    const v = await m.verifyClean(c);
    if (!v.ok) {
      throw new ContainerError(
        `recover ${c}: post-reset inventory check failed: ${
          v.error ?? v.diff.slice(0, 5).join("; ")
        }`,
        c,
        "health",
      );
    }
    let lines: string[];
    try {
      lines = await m.fsDigest(c);
    } catch (err) {
      lines = [`E|(fsDigest)|${err instanceof Error ? err.message : err}`];
    }
    // As right after a deployment's reset: the capture alone must be clean.
    const errors = fsDiff(lines, [], m.fsExclude ?? [], m.fsRoots ?? [])
      .errors.filter((e) => e.startsWith("before: "));
    if (errors.length > 0) {
      throw new ContainerError(
        `recover ${c}: fsDigest capture not clean: ${
          errors.slice(0, 5).join("; ")
        }`,
        c,
        "health",
      );
    }
    const recordedAll = found.flatMap((f) => f.record?.fs_diff ?? []);
    // H-35 run 004 Sol r2 N5: absence counts only where this capture looks;
    // every recorded entry, cache-shaped or not (orch r005c HIGH)
    const blind = unobservable(recordedAll, lines, m.fsRoots ?? []);
    if (blind.length > 0) {
      throw new ContainerError(
        `recover ${c}: ${RECREATE}: recorded path ${
          blind.join(", ")
        } not observable by this capture (outside its roots or below a reparse point)`,
        c,
        "health",
      );
    }
    // addendum 6 (orch r005c HIGH): a recorded entry is not contamination
    // only when the CURRENT capture shows that path, its line still passes
    // the recovery lineage's platform caches (fsDiff's own rules) against the
    // recorded before, and a file still has the recorded content (sha256);
    // everything else must be undone
    const recorded = recordedAll.filter(
      (e) => !cacheStillTolerated(e, lines, m),
    );
    // H-35 run 004 Sol r1 H6: a well-formed capture is not removal; every
    // recorded L4 difference must be undone in it
    const left = unremediated(recorded, lines, m.fsRoots ?? []);
    if (left.length > 0) {
      throw new ContainerError(
        `recover ${c}: contamination not remediated: ${
          left.join(", ")
        }; recreate the container or remove them`,
        c,
        "health",
      );
    }
  } catch (err) {
    await dropManifest();
    throw err;
  }
  // H-35 run 004 Sol r2 N2: only what was verified, unchanged since read
  const changed = await removeUnchanged(found);
  if (changed.length > 0) {
    await dropManifest();
    throw new ConfigurationError(
      `recover ${c}: record(s) changed during recovery, kept: ${
        changed.join(", ")
      }; run harness recover again`,
    );
  }
  return made;
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
  // H-35 S3 L2b (Sol S3 r3): the lineage's NST egress, statically checked as
  // admission checks it, so a dry run (and a dry resume) sees the override.
  let bcEgress: BcEgressRecord | null = null;
  if (o.lineage) {
    const l = await loadLineage(o.lineage);
    const a = bcEgressAdmission(l.egress?.mode, o.bcEgressOverride);
    if (a.refusal) throw new ConfigurationError(a.refusal);
    bcEgress = a.record;
  }
  return {
    ...(bcEgress ? { bcEgress } : {}),
    repoRoot: o.repoRoot,
    harnessRoot: join(o.repoRoot, "harness"),
    resultsRoot: o.resultsDir,
    store: new RecordStore(o.resultsDir),
    docker: deps.docker(),
    symbols,
    egressEnforced: mode === "enforced",
    egressPlaced: mode !== "off",
    proxyIsolation: await markerProxyIsolation(sharedResults),
    secretAccounts: o.secretAccounts,
  };
}

export async function openHarnessEnv(
  o: EnvOptions,
  deps: EnvDeps = REAL_DEPS,
): Promise<OpenEnv> {
  // H-35 S3.2: an unproven lineage stops the start, before anything opens.
  const lineage = o.lineage ? await loadLineage(o.lineage) : null;
  // run 004 #4: a test seam; the mechanism's live checks (NST config, fs)
  // reach a container, so tests inject one
  const reset = lineage
    ? (deps.resetFor ?? goldenResetFor(o.repoRoot))(o.lineage!, lineage)
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
  // H-41 (Q1, section 10): `auto` judging needs a lineage (every admission
  // compares env_fp); rejudge's pool is its only list, run's its judges.
  if (o.auto && !lineage) {
    throw new ConfigurationError(
      "`auto` judging containers need --lineage (each joining container is admitted by its env_fp)",
    );
  }
  if (o.containers.length === 0 && o.auto !== "containers") {
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
  // H-41 (7, Q7, F8): a fixed member another holder coord-leases refuses the
  // start (fail closed); only an exact --coord-lease pair is this run's.
  const coordRoot = deps.coordRoot();
  const own = o.coordLeases ?? new Map<string, string>();
  const leased = [...containers, ...judgeNames].flatMap((c) => {
    const why = coordLeaseBlock(coordRoot, own, c);
    return why ? [why] : [];
  });
  if (leased.length > 0) {
    throw new ConfigurationError(
      `container(s) not this run's to use (pass --coord-lease <container>=<token> for a lease it holds): ${
        leased.join("; ")
      }`,
    );
  }
  const symbols = await loadSymbolsLock(o.repoRoot);
  if (!symbols) {
    throw new ValidationError(
      "no symbols lock: run `centralgauge harness symbols lock --from <dir> --store <dir>`",
      [SYMBOLS_LOCK_PATH],
    );
  }
  // H-38 (design 6, Q4): the lock's OnPrem index, before any lock, sweep,
  // cell, deferred judge, rejudge or recovery; an OnPremIndexError refuses.
  const onPrem = await (deps.admitOnPrem ?? admitOnPrem)({
    store: o.symbolStore,
    packages: symbols,
  });
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
  // H-35 run 004 Sol r2 N3: closer failures so far (the in-use release reads them)
  const closeFailures: string[] = [];
  const closeAll = async () => {
    for (const c of closers) {
      await c().catch((err) => void closeFailures.push(msg(err)));
    }
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
    const qDir = deps.quarantineDir();
    const by = `${deps.owner()} ${o.command}`;
    // H-35 run 004 Sol r2 N1: this environment's claim token
    const token = crypto.randomUUID();
    const mine = { token, by, pid: Deno.pid, host: deps.owner() };
    const ids = new Map<string, { name: string; id: string }>();
    const claimed: { name: string; id: string }[] = [];
    // Sol r1 H4: dirty unless proven clean. Sol r2 N3: the claims go only
    // after a fully clean teardown (every closer succeeded, both lanes
    // drained) and never once setup threw; a quarantined container keeps
    // its record (a failed quarantine write leaves the in-use claim).
    const lanes: BcLane[] = [];
    let setupFailed = false;
    // H-41 (6, 9): records the judging pool keeps (a failed or unresolved
    // join, a release it could not prove): never released here.
    const kept = new Map<string, string>();
    closers.unshift(async () => {
      const q = new Set(
        lanes.flatMap((l) => [...l.quarantined.keys()]).map((c) =>
          c.toLowerCase()
        ),
      );
      const all = setupFailed
        ? "setup failed after it may have changed the container"
        : closeFailures.length > 0
        ? `teardown failed: ${closeFailures.join("; ")}`
        : null;
      for (const w of claimed) {
        if (q.has(w.name.toLowerCase())) continue;
        const keep = all ?? kept.get(w.name.toLowerCase());
        if (keep) {
          console.error(
            `${colors.yellow("[WARN]")} in-use record of ${w.name} kept (${
              recordFile(qDir, w.id)
            }, token ${token}): ${keep}; it refuses the container`,
          );
          continue;
        }
        try {
          await releaseOwned(qDir, w.id, token);
        } catch (err) {
          console.error(
            `${
              colors.yellow("[WARN]")
            } in-use record of ${w.name} not removed (it refuses the container): ${
              msg(err)
            }`,
          );
        }
      }
    });
    // H-35 run 004 #3, Sol r1 H4/H5, Sol r2 N1: claim each container by an
    // atomic create-new of its id's record, then refuse it if any other
    // record (by id or name: a quarantine, another environment's or a
    // recover's claim) exists. An unreadable id refuses too. Nothing has
    // touched a container yet, so a refusal releases this run's claims.
    // H-41 (6): claimContainer, also each pool join's claim (in `claimed`
    // from the claim on).
    const claimContainer = async (
      c: string,
    ): Promise<{ id: string | null; won: boolean; why: string[] }> => {
      let id: string;
      try {
        id = await deps.containerId(c);
      } catch (err) {
        return {
          id: null,
          won: false,
          why: [`${c} (container id unknown: ${msg(err)})`],
        };
      }
      ids.set(c.toLowerCase(), { name: c, id });
      let won: boolean;
      try {
        won = await claimRecord(qDir, {
          state: "in_use",
          container: c,
          id,
          ...mine,
        });
      } catch (err) {
        throw new ConfigurationError(
          `cannot write the in-use record of ${c} in ${qDir}: ${
            msg(err)
          }; the environment does not start`,
        );
      }
      if (won) claimed.push({ name: c, id });
      const others = (await findRecords(qDir, { name: c, id })).filter((f) =>
        f.record?.token !== token
      );
      const why = others.map((f) => `${c} (${f.why})`);
      if (!won && others.length === 0) {
        why.push(
          `${c} (in-use record ${
            recordFile(qDir, id)
          } exists but is no record)`,
        );
      }
      return { id, won, why };
    };
    /** H-41 (6): release a pool member's record and drop its claimed entry. */
    const releaseClaim = async (id: string) => {
      await releaseOwned(qDir, id, token);
      const k = claimed.findIndex((w) => w.id === id);
      if (k >= 0) claimed.splice(k, 1);
    };
    const held: string[] = [];
    for (const c of [...containers, ...judgeNames]) {
      held.push(...(await claimContainer(c)).why);
    }
    if (held.length > 0) {
      throw new ConfigurationError(
        `quarantined container(s), run harness recover first or leave them out: ${
          held.join("; ")
        }`,
      );
    }
    // A quarantine (either lane) rewrites this environment's record with
    // every reason and L4 diff so far (Sol r1 H6: recover checks the diff);
    // Sol r2 N1: never another owner's record.
    const qs = new Map<
      string,
      { reasons: string[]; diff: FsDiffEntry[]; captured: boolean }
    >();
    const persist = async (
      container: string,
      reason: string,
      fsDiff: FsDiffEntry[] | null,
    ) => {
      const lc = container.toLowerCase();
      const q = qs.get(lc) ?? { reasons: [], diff: [], captured: true };
      q.reasons.push(reason);
      q.diff.push(...fsDiff ?? []);
      // Sol r2 N4: every quarantine of it backed by a clean after-capture
      q.captured &&= fsDiff !== null;
      qs.set(lc, q);
      const id = ids.get(lc)?.id ?? await deps.containerId(container);
      const r = await rewriteOwned(qDir, {
        state: "quarantined",
        container,
        id,
        ...mine,
        reason: q.reasons.join("; "),
        fs_diff: q.diff,
        fs_captured: q.captured,
      });
      if (r === "foreign") {
        throw new Error(
          `record ${
            recordFile(qDir, id)
          } is no longer this environment's (token ${token}): not overwritten`,
        );
      }
      if (r === "created") {
        console.error(
          `${
            colors.yellow("[WARN]")
          } in-use record of ${container} was gone; quarantine written as a new record`,
        );
      }
    };
    let ready: Awaited<ReturnType<EnvDeps["setup"]>>;
    try {
      ready = await deps.setup([...containers, ...judgeNames]);
    } catch (err) {
      setupFailed = true;
      throw err;
    }
    closers.unshift(ready.dispose);
    const health = deps.health(ready.names);
    const lockDigest = lineage
      ? await lockDigestOf({ store: o.symbolStore, packages: symbols })
      : null;
    const envInputs = lineage && lockDigest
      ? {
        resultsRoot: sharedResults,
        lineageId: lineage.id,
        lockDigest,
        ...(o.bcEgressOverride ? { bcEgressOverride: o.bcEgressOverride } : {}),
      }
      : null;
    // H-41 (6): the `auto` judging pool, inert until bindCampaign.
    const pool = o.auto && lineage && envInputs
      ? new JudgePool({
        bc: ready.bc,
        bounds: {
          ...deps.poolBounds,
          ...(o.poolWaitMin !== undefined
            ? { waitMs: o.poolWaitMin * 60_000 }
            : {}),
        },
        lane: { health, persist },
        deps: {
          allocated: () => deps.allocatedAll(),
          excluded: (c) =>
            REFUSED_CONTAINERS.some((r) => r.toLowerCase() === c.toLowerCase())
              ? "refused by the harness (Cronus28, Cronus284)"
              : containers.some((a) => a.toLowerCase() === c.toLowerCase())
              ? "an agent container of this run"
              : null,
          // R1-M1: unreadable coord state throws: refused, reconciled unanswered.
          blocked: poolBlocked({ coordRoot, own, drainDir: o.resultsDir }),
          running: (c) => deps.running(c),
          foreign: async (c) => {
            const h = await containerHolds(deps, qDir, c);
            if (h.id === null) return h.why.join("; ");
            const why = h.found.filter((f) => f.record?.token !== token)
              .map((f) => f.why);
            return why.length > 0 ? why.join("; ") : null;
          },
          admissible: async (c) => {
            const ch = await checkEnvironments(
              deps.inspect(),
              reset,
              [c],
              envInputs,
            );
            const row = ch.rows[0];
            return ch.admissible && row
              ? { env_fp: row.env_fp }
              : { why: ch.refusal ?? row?.why ?? "not admissible" };
          },
          pinned: async (campaign) => {
            const path = pinPath(o.resultsDir, campaign);
            let pin: EnvPin;
            try {
              pin = JSON.parse(await Deno.readTextFile(path));
            } catch (err) {
              if (err instanceof Deno.errors.NotFound) return null;
              throw new ConfigurationError(
                `campaign pin ${path} unreadable: ${msg(err)}`,
              );
            }
            if (pin.lineage_id !== lineage.id) {
              throw new ConfigurationError(
                `campaign ${campaign} is pinned to lineage ${pin.lineage_id} (${path}); this environment's is ${lineage.id}: refused (a lineage change needs a new campaign)`,
              );
            }
            return pin.env_fp;
          },
          ensurePin: (campaign, fp) => ensurePin(env, campaign, fp),
          claim: async (c) => {
            const r = await claimContainer(c);
            if (r.id !== null && r.why.length === 0) return { id: r.id };
            // Nothing touched the container: a refused claim goes at once.
            if (r.won && r.id !== null) await releaseClaim(r.id);
            return { why: r.why.join("; ") };
          },
          release: (_c, id) => releaseClaim(id),
          keep: (c, why) => void kept.set(c.toLowerCase(), why),
          containerId: (c) => deps.containerId(c),
          join: async (c) => {
            const r = await deps.setup([c]);
            const slot = r.bc as {
              disposeContainerSlot?: (name: string) => Promise<void>;
            };
            return {
              bc: r.bc,
              dispose: () =>
                slot.disposeContainerSlot?.(c) ?? Promise.resolve(),
            };
          },
          register: (c) => health.register?.(c),
        },
      })
      : undefined;
    // H-41 (7): a fixed lane blocks on a coord lease, never on a drain marker.
    const fixed = (names: string[]) =>
      new BcLane(ready.bc, names, {
        health,
        persist,
        blocked: laneBlocked({ coordRoot, own }),
      });
    // setup keeps the order: the agents' names first, then the judges'.
    const lane = o.auto === "containers" && pool
      ? pool.lane
      : fixed(ready.names.slice(0, containers.length));
    const judgeLane = o.auto === "judges" && pool
      ? pool.lane
      : judgeNames.length > 0
      ? fixed(ready.names.slice(containers.length))
      : undefined;
    lanes.push(lane, ...(judgeLane ? [judgeLane] : []));
    // H-35 run 004 Sol r2 N3: no lane operation in flight before dispose and
    // the claims' release; one still running at the bound keeps the claims.
    closers.unshift(async () => {
      for (const l of lanes) {
        await bounded(l.drain(), LANE_DRAIN_MS, "BC lane drain");
      }
    });
    // H-35 S3.4 (ruling (c)): with a lineage, every container must be an
    // admitted instance of it, all of one env_fp, before any lease.
    let bcEgress: BcEgressRecord | null = null;
    // H-41 (sections 4, 10): the start members' env_fp, the campaign pin's.
    let pinContext: HarnessEnv["pinContext"];
    let startFp: string | null = null;
    if (lineage && lockDigest && envInputs) {
      pinContext = {
        lineage_id: lineage.id,
        lock_digest: lockDigest,
        command: o.command,
      };
    }
    // H-41 (Q8): a zero-member `auto` start: no row to check, the NST egress
    // admission alone; each joining container is checked by the pool.
    if (envInputs && ready.names.length === 0) {
      const a = bcEgressAdmission(reset.bcEgress, o.bcEgressOverride);
      if (a.refusal) throw new ConfigurationError(a.refusal);
      bcEgress = a.record;
    } else if (envInputs) {
      const check = await checkEnvironments(
        ready.bc,
        reset,
        ready.names,
        envInputs,
      );
      bcEgress = check.bc_egress;
      startFp = check.rows[0]?.env_fp ?? null;
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
      onPrem,
      secretAccounts: o.secretAccounts,
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
      ...(pinContext ? { pinContext } : {}),
      ...(pool ? { judgePooled: pool } : {}),
      // H-41 (10): an explicit list pins the start members' env_fp; `auto`
      // binds the pool, whose first admission creates the pin.
      bindCampaign: (id) => pool ? pool.bind(id) : ensurePin(env, id, startFp),
    };
    // H-41 (9): the pool closes first (no join after it; in-flight work bounded).
    if (pool) closers.unshift(() => pool.close());
    // H-41 (3.3): committed fences first; recovery then judges only what is owed.
    await recoverFences(env);
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
