/**
 * Real Harness Bench environment for the CLI. Order: refused and
 * unallocated containers, the bench lock, temp and sandbox sweeps (M0-03 b),
 * containers with a health monitor, lane, backend on the container-facing
 * address (M0-05), egress state (fail closed), then recovery of interrupted
 * executions.
 */

import * as colors from "@std/fmt/colors";
import { join } from "@std/path";
import type { BcContainerProvider } from "../../src/container/bc-container-provider.ts";
import type { HarnessBc, HealthView } from "../../src/harness/bc-lane.ts";
import type { PlanEnv } from "../../src/harness/campaign.ts";
import type { HarnessEnv } from "../../src/harness/execution.ts";
import type { DockerCli } from "../../src/harness/sandbox.ts";
import { ConfigManager } from "../../src/config/config.ts";
import { ConfigurationError, ValidationError } from "../../src/errors.ts";
import { allocatedContainer } from "../../src/harness/allocation.ts";
import {
  Backend,
  defaultBackendOps,
  resolveBackendHost,
} from "../../src/harness/backend.ts";
import { BcLane } from "../../src/harness/bc-lane.ts";
import { recoverInterrupted } from "../../src/harness/execution.ts";
import { sweepWorkspaceTemp } from "../../src/harness/fsutil.ts";
import {
  loadSymbolsLock,
  SYMBOLS_LOCK_PATH,
} from "../../src/harness/identity.ts";
import { loadPricingBook } from "../../src/harness/pricing.ts";
import { RecordStore } from "../../src/harness/records.ts";
import {
  bounded,
  realDocker,
  sweepOwnedSandboxes,
} from "../../src/harness/sandbox.ts";
import { loadTask } from "../../src/harness/task.ts";
import { ContainerHealthMonitor } from "../../src/health/monitor.ts";
import {
  acquireBenchLock,
  DEFAULT_BENCH_LOCK_DIR,
} from "../../src/utils/bench-lock.ts";
import { setupContainers } from "./bench/container-setup.ts";

/** Cronus28 hosts a foreign app on codeunit 80013; Cronus284 is untouched pending the owner. */
export const REFUSED_CONTAINERS = ["Cronus28", "Cronus284"];
export const EGRESS_MARKER = "egress-verified.json";

/** Host egress verification; M1-33 supplies the real one. Returns problems; empty means verified. */
export type EgressVerifier = () => Promise<string[]>;

export interface EnvOptions {
  repoRoot: string;
  /** Records root of this command (results/harness, or .../cells, .../fixtures). */
  resultsDir: string;
  containers: string[];
  backendHost?: string | undefined;
  backendPort: number;
  secretsSource: string;
  symbolStore: string;
  privateRoot: string;
  credentialLedger: string | null;
  command: string;
  supervised: boolean;
}

export interface EnvDeps {
  /** The allocated spelling of a container, or a throw (coord allocation.json, fail closed). */
  allocated(name: string): Promise<string>;
  acquireLock: (dir: string, o: { command: string }) => () => Promise<void>;
  docker: () => DockerCli;
  setup(
    names: string[],
  ): Promise<{ bc: HarnessBc; names: string[]; dispose(): Promise<void> }>;
  resolveHost(): Promise<string>;
  owner(): string;
  health(names: string[]): HealthView;
  verifyEgress: EgressVerifier;
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
  // Replaced by M1-33 with verifyEgressState(await collectEgressState()).
  verifyEgress: () =>
    Promise.resolve(["egress verification is not implemented yet (M1-33)"]),
};

export interface OpenEnv {
  env: HarnessEnv;
  close(): Promise<void>;
}

/** Enforcement counts only when the marker says authorized AND the host verifies now; a failing marker stops. */
export async function resolveEgress(
  sharedResults: string,
  verify: EgressVerifier,
): Promise<boolean> {
  let marker: { state?: string } | null = null;
  try {
    marker = JSON.parse(
      await Deno.readTextFile(join(sharedResults, EGRESS_MARKER)),
    );
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) throw err;
  }
  if (marker === null) return false;
  const problems = await verify();
  if (problems.length > 0) {
    throw new ConfigurationError(
      `egress marker present but verification failed, refusing to run: ${
        problems.join("; ")
      }`,
    );
  }
  return marker.state === "authorized";
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
  return {
    repoRoot: o.repoRoot,
    harnessRoot: join(o.repoRoot, "harness"),
    resultsRoot: o.resultsDir,
    store: new RecordStore(o.resultsDir),
    docker: deps.docker(),
    symbols,
    egressEnforced: await resolveEgress(
      join(o.repoRoot, "results", "harness"),
      deps.verifyEgress,
    ),
  };
}

export async function openHarnessEnv(
  o: EnvOptions,
  deps: EnvDeps = REAL_DEPS,
): Promise<OpenEnv> {
  const refused = o.containers.filter((c) =>
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
  const containers: string[] = [];
  for (const c of o.containers) containers.push(await deps.allocated(c));
  const symbols = await loadSymbolsLock(o.repoRoot);
  if (!symbols) {
    throw new ValidationError(
      "no symbols lock: run `centralgauge harness symbols lock --from <dir> --store <dir>`",
      [SYMBOLS_LOCK_PATH],
    );
  }
  const sharedResults = join(o.repoRoot, "results", "harness");
  const release = deps.acquireLock(
    join(o.repoRoot, DEFAULT_BENCH_LOCK_DIR),
    { command: o.command },
  );
  const closers: (() => Promise<void>)[] = [release];
  const closeAll = async () => {
    for (const c of closers) await c().catch(() => {});
  };
  try {
    const store = new RecordStore(o.resultsDir);
    await Deno.mkdir(join(o.privateRoot, "work"), { recursive: true });
    await store.sweepTemp();
    await sweepWorkspaceTemp(o.resultsDir, o.privateRoot);
    const docker = deps.docker();
    const owner = deps.owner();
    const swept = await sweepOwnedSandboxes(docker, owner);
    if (swept.length > 0) {
      console.log(
        `${
          colors.yellow("[WARN]")
        } removed ${swept.length} leftover sandbox(es): ${swept.join(", ")}`,
      );
    }
    const ready = await deps.setup(containers);
    closers.unshift(ready.dispose);
    const lane = new BcLane(ready.bc, ready.names, {
      health: deps.health(ready.names),
    });
    const host = o.backendHost ?? await deps.resolveHost();
    const backend = new Backend({
      approvedRoots: [join(o.privateRoot, "work")],
      workRoot: join(o.privateRoot, "backend"),
      ops: defaultBackendOps(lane),
      allowedHosts: [host],
    });
    const server = backend.serve(host, o.backendPort);
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
      harnessRoot: join(o.repoRoot, "harness"),
      resultsRoot: o.resultsDir,
      privateRoot: o.privateRoot,
      store,
      lane,
      backend,
      backendUrl: server.url,
      docker,
      owner,
      symbols,
      symbolStore: o.symbolStore,
      secretsSource: o.secretsSource,
      // Owned ids come from each grant's and judgment's trusted roots (M1-16).
      deploy: { ledgerRoot: join(sharedResults, "bc-ledger") },
      pricing: (at) => loadPricingBook(join(o.repoRoot, "site", "catalog"), at),
      supervised: o.supervised,
      egressEnforced: await resolveEgress(sharedResults, deps.verifyEgress),
      credentialLedger: o.credentialLedger,
      lane_id: Deno.env.get("CG_LANE") ?? "unknown-lane",
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
    return { env, close: closeAll };
  } catch (err) {
    await closeAll();
    throw err;
  }
}
