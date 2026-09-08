/**
 * `ContainerRuntime`: the container setup, health-monitoring, recovery, and
 * compile-queue lifecycle extracted from the sync executor
 * (`cli/commands/bench/parallel-executor.ts`) so batch mode's compile/test
 * phase (spec section 7) can stand up the same infrastructure without an
 * orchestrator in the loop.
 *
 * Scope: an EXPLICIT, pre-existing container list (`setupContainers`), the
 * same topology the sync executor uses for `--containers a,b[,c...]` and the
 * only topology batch mode ever uses. The sync executor's single-container
 * auto-detect/auto-create path (`setupContainer`, which may CREATE an
 * ephemeral container and tracks `wasExisting`) has no equivalent here: it
 * stays on its existing code path in `parallel-executor.ts` (see that file's
 * module doc for why).
 *
 * `start()` builds, in order: the containers (`setupContainers`), a
 * `ContainerHealthMonitor` seeded with the configured names, a
 * `CompileQueuePool` wired to that monitor, an OPTIONAL
 * `ContainerRecoveryProber` (only when `recoveryProbeIntervalMs > 0`), and
 * subscribes `attachOutcomeRecorder` to this runtime's OWN event bus
 * (`emit`/`on`) so monitor state accumulates from whatever calls
 * `runtime.emit(...)`: batch's `runCompileWorkItem` deps, or a sync caller
 * that chooses to route compile events through the runtime instead of its
 * own listener array.
 *
 * Deliberately NOT done here: alert-driven drain + rebalance (the
 * `healthMonitor.on("alert_raised", ...)` -> `pool.rebalanceFromContainer`
 * subscription documented in `.claude/rules/alert-drain-rebalance.md`).
 * That wiring stays where the sync orchestrator already owns it
 * (`src/parallel/orchestrator.ts`); a caller that wants it for its own
 * `ContainerRuntime`-backed queue must wire it itself. The pool's own
 * proactive dispatch-gate exclusion of alerted containers (`enqueue()`)
 * still applies unconditionally; only the ACTIVE draining of already-queued
 * pending work off a newly-alerted container is out of scope.
 *
 * @module src/parallel/container-runtime
 */

import type { ContainerProvider } from "../container/interface.ts";
import { ContainerHealthMonitor } from "../health/monitor.ts";
import { ContainerRecoveryProber } from "../health/recovery-prober.ts";
import { attachOutcomeRecorder } from "../health/outcome-recorder.ts";
import { CompileQueuePool } from "./compile-queue-pool.ts";
import type { ParallelExecutionEvent } from "./types.ts";
import {
  type ContainerAppConfig,
  endOfRunNuke,
  setupContainers,
} from "../../cli/commands/bench/container-setup.ts";
import { inspectContainer } from "../container/docker-inspect.ts";
import { Logger } from "../logger/mod.ts";

const log = Logger.create("container-runtime");

/**
 * The environment a batch/sync run executed against (spec 4.2's
 * `ContainerEnvironmentSet`). Declared independently here rather than
 * imported from `src/batch/state.ts` (`src/parallel/` is the lower layer;
 * batch imports from it, not the other way around), but is structurally
 * identical to that module's Zod-inferred type, so a value returned from
 * `environmentSet()` assigns straight into `BatchRunState.frozen.environment`
 * with no conversion.
 */
export interface ContainerEnvironmentSet {
  /** A mode, not a version (mirrors `EnvironmentManifest.test_runner`). */
  testRunner: "soap" | "legacy";
  /** Sorted by name. */
  containers: Array<
    { name: string; bcArtifact: string | null; imageDigest: string | null }
  >;
}

export interface ContainerRuntimeOptions {
  /** Pre-existing container names; `setupContainers` requires each be healthy. */
  containers: string[];
  containerProviderName?: string;
  containerConfig: ContainerAppConfig;
  noCompilerCache?: boolean;
  noReuseCompilerFolders?: boolean;
  /**
   * `> 0` opts into a `ContainerRecoveryProber` at this cadence (ms). `0` or
   * absent disables it: no prober is built, matching the pool's own
   * `canRecover` default of "never park" becoming "recovery never confirms."
   */
  recoveryProbeIntervalMs?: number;
  queue: { maxQueueSize: number; timeout: number; compileConcurrency: number };
}

type EventListener = (event: ParallelExecutionEvent) => void;

/** Defaults mirrored from `ParallelBenchmarkOrchestrator.runParallel`'s own prober construction. */
const RECOVERY_PROBE_TIMEOUT_MS = 30_000;
const RECOVERY_SUCCESSES_REQUIRED = 2;
const RECOVERY_MAX_PER_CONTAINER = 2;
const RECOVERY_MAX_RESTART_ATTEMPTS = 1;
const RECOVERY_BACKOFF_BASE_MS = 1000;

/**
 * Container setup + health monitor + compile queue + optional recovery
 * prober, as one resource with a start/stop lifecycle. See the module doc
 * for exactly what this does and does not own.
 */
export class ContainerRuntime {
  private readonly listeners: EventListener[] = [];
  private prober: ContainerRecoveryProber | undefined;
  private outcomeRecorderUnsubscribe: (() => void) | undefined;
  private stopped = false;

  private constructor(
    readonly provider: ContainerProvider,
    readonly containerNames: string[],
    readonly monitor: ContainerHealthMonitor,
    readonly queue: CompileQueuePool,
  ) {}

  static async start(opts: ContainerRuntimeOptions): Promise<ContainerRuntime> {
    const setupOpts: {
      noCompilerCache?: true;
      noReuseCompilerFolders?: true;
    } = {};
    if (opts.noCompilerCache) setupOpts.noCompilerCache = true;
    if (opts.noReuseCompilerFolders) setupOpts.noReuseCompilerFolders = true;

    const { containerProvider, containerNames } = await setupContainers(
      opts.containers,
      opts.containerProviderName,
      opts.containerConfig,
      setupOpts,
    );

    const monitor = new ContainerHealthMonitor({
      windowSize: 20,
      expectedContainers: containerNames.length,
      expectedContainerNames: containerNames,
    });

    const recoveryEnabled = (opts.recoveryProbeIntervalMs ?? 0) > 0;
    const queue = new CompileQueuePool(containerProvider, containerNames, {
      ...opts.queue,
      healthMonitor: monitor,
      canRecover: (alert) => recoveryEnabled && alert.kind !== "global_outage",
    });

    const runtime = new ContainerRuntime(
      containerProvider,
      containerNames,
      monitor,
      queue,
    );

    runtime.outcomeRecorderUnsubscribe = attachOutcomeRecorder(
      runtime.on.bind(runtime),
      monitor,
    );

    if (recoveryEnabled) {
      // disposeContainerSlot / restartContainer live on BcContainerProvider,
      // not the ContainerProvider interface, so feature-detect (mirrors
      // orchestrator.ts's own prober construction exactly).
      const hasDispose = "disposeContainerSlot" in containerProvider &&
        typeof (containerProvider as { disposeContainerSlot?: unknown })
            .disposeContainerSlot === "function";
      const hasRestart = "restartContainer" in containerProvider &&
        typeof (containerProvider as { restartContainer?: unknown })
            .restartContainer === "function";

      runtime.prober = new ContainerRecoveryProber(
        {
          monitor,
          pool: queue,
          isHealthy: (name, o) => containerProvider.isHealthy(name, o),
          now: () => Date.now(),
          ...(hasDispose
            ? {
              disposeSession: (name: string) =>
                (containerProvider as {
                  disposeContainerSlot: (n: string) => Promise<void>;
                }).disposeContainerSlot(name),
            }
            : {}),
          ...(hasRestart
            ? {
              restartContainer: (
                name: string,
                o?: { signal?: AbortSignal },
              ) =>
                (containerProvider as {
                  restartContainer: (
                    n: string,
                    opts?: { signal?: AbortSignal },
                  ) => Promise<boolean>;
                }).restartContainer(name, o),
            }
            : {}),
        },
        {
          probeIntervalMs: opts.recoveryProbeIntervalMs!,
          probeTimeoutMs: RECOVERY_PROBE_TIMEOUT_MS,
          successesRequired: RECOVERY_SUCCESSES_REQUIRED,
          maxRecoveriesPerContainer: RECOVERY_MAX_PER_CONTAINER,
          autoRestart: false,
          maxRestartAttempts: RECOVERY_MAX_RESTART_ATTEMPTS,
          backoffBaseMs: RECOVERY_BACKOFF_BASE_MS,
        },
      );
      runtime.prober.start();
    }

    return runtime;
  }

  /**
   * The environment this runtime's containers are executing against (spec
   * 4.2/4.6), sorted by name. Best-effort per container: an inspect failure
   * (container stopped mid-run, docker unavailable) yields `null` for both
   * facts on that container rather than throwing, matching
   * `buildEnvironmentManifest`'s contract in `src/ingest/capture.ts`.
   */
  async environmentSet(
    inspect: typeof inspectContainer = inspectContainer,
  ): Promise<ContainerEnvironmentSet> {
    const sorted = [...this.containerNames].sort();
    const containers = await Promise.all(sorted.map(async (name) => {
      let bcArtifact: string | null = null;
      let imageDigest: string | null = null;
      try {
        const i = await inspect(name);
        imageDigest = i?.imageDigest ?? null;
        // Strip a SAS/query string so the fact doesn't churn on every
        // artifact fetch (same reasoning as capture.ts's manifest).
        bcArtifact = i?.artifactUrl ? i.artifactUrl.replace(/\?.*$/, "") : null;
      } catch {
        // best-effort; see doc comment above.
      }
      return { name, bcArtifact, imageDigest };
    }));
    return {
      testRunner: Deno.env.get("CENTRALGAUGE_SOAP_TEST_RUNNER") === "0"
        ? "legacy"
        : "soap",
      containers,
    };
  }

  /** Broadcast to every subscriber; a throwing listener is logged, not propagated. */
  emit(event: ParallelExecutionEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        log.error("Error in event listener", { error: String(error) });
      }
    }
  }

  /** Subscribe to this runtime's event bus; returns an unsubscribe handle. */
  on(listener: EventListener): () => void {
    this.listeners.push(listener);
    return () => {
      const idx = this.listeners.indexOf(listener);
      if (idx !== -1) this.listeners.splice(idx, 1);
    };
  }

  /**
   * Tear down every resource this runtime started, in the order the sync
   * executor's finally block runs them: prober stop, outcome-recorder
   * unsubscribe, queue drain (parked entries never recover once the run
   * ends), the end-of-run app sweep, then compiler-folder cleanup. Every
   * step is best-effort (mirrors `endOfRunNuke`/`cleanupCompilerFolders`'s
   * own internal try/catch); idempotent, a second call is a no-op.
   */
  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;

    if (this.prober) {
      await this.prober.stop();
    }
    if (this.outcomeRecorderUnsubscribe) {
      this.outcomeRecorderUnsubscribe();
      this.outcomeRecorderUnsubscribe = undefined;
    }
    this.queue.cancelParked("container runtime stopped");

    await endOfRunNuke(this.provider, this.containerNames);
    if (this.provider.cleanupCompilerFolders) {
      try {
        await this.provider.cleanupCompilerFolders();
      } catch (e) {
        log.warn(
          `cleanupCompilerFolders threw (best-effort): ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
    }
  }
}
