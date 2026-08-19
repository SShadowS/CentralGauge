/**
 * `centralgauge workbench <subcommand>` — authoring dashboard CLI surface.
 *
 * `workbench serve` starts the local authoring dashboard (`src/dashboard/
 * server.ts`'s `startServer`): an author opens it in a browser, sees their
 * scaffolded drafts under `scratch/`, and fires a "quick run" that asks
 * several models the same question to see which ones fall for the trap a
 * draft is built around.
 *
 * Option resolution is a pure function (`resolveServeOptions`) so it is
 * testable without driving Cliffy, mirroring how `task-command.ts` separates
 * `runTaskNew` from its Cliffy wiring.
 *
 * `--preset` resolves against `.centralgauge.yml`'s `benchmarkPresets` via
 * `resolvePresetModels` (`src/dashboard/drafts.ts`) — resolved HERE, in the
 * CLI, not inside `src/dashboard/server.ts`. That module is deliberately
 * kept clear of the config loader: `tests/unit/dashboard/ingest-safety.test.ts`
 * polices its whole import graph, and every dependency added there is one
 * more thing a later change could accidentally widen into something the
 * dashboard must never reach. The CLI root already legitimately reaches
 * everything, so resolution belongs here.
 *
 * @module cli/commands/workbench
 */

import { Command } from "@cliffy/command";
import * as colors from "@std/fmt/colors";
import { join } from "@std/path";

import type { CentralGaugeConfig } from "../../src/config/config.ts";
import type { VerifyQueueVerifyFn } from "../../src/dashboard/verify-queue.ts";

import { ConfigManager } from "../../src/config/config.ts";
import { checkBenchGate } from "../../src/dashboard/bench-gate.ts";
import { startServer } from "../../src/dashboard/server.ts";
import { resolvePresetModels } from "../../src/dashboard/drafts.ts";
import { verifyResponse } from "../../src/dashboard/verify-run.ts";
import { createModelCaller } from "../../src/dashboard/model-caller.ts";
import {
  clearPrereqCaches,
  prepareContainerForVerification,
  handleAlVerify,
} from "../../mcp/al-tools-server.ts";

export interface ServeOptions {
  port?: number;
  preset?: string;
}

export interface ResolvedServeOptions {
  scratchDir: string;
  /**
   * Absolute root the dashboard resolves a draft's chained prereq
   * dependencies against. Absolutised HERE, against the same `cwd` as
   * `scratchDir`, rather than left as the relative literal the server used
   * to hold: resolved against `Deno.cwd()` at request time, starting the
   * dashboard from anywhere but the repo root made every chained
   * dependency fail to resolve, which is indistinguishable from the
   * legitimate base-app case, so their fields silently vanished from the
   * prereq index and a model referencing one was told it made the field up.
   */
  dependenciesRoot: string;
  /** Left `undefined` when not given, so `startServer` asks the OS for an
   *  ephemeral port rather than being handed a fabricated default. */
  port?: number;
  /** Models resolved from `--preset` via `resolvePresetModels`, or empty
   *  when no preset was given, the name is unknown, or it defines none.
   *  Never throws on an unknown name — the caller decides whether to warn. */
  defaultModels: string[];
}

/**
 * Resolves `workbench serve`'s options against a repo root and a loaded
 * config, without ever touching Cliffy — so this is unit-testable directly.
 * `config` defaults to `{}` so callers that don't care about presets (and
 * the pre-existing scratchDir/port tests) can omit it entirely.
 */
export function resolveServeOptions(
  opts: ServeOptions,
  cwd: string,
  config: Pick<CentralGaugeConfig, "benchmarkPresets"> = {},
): ResolvedServeOptions {
  return {
    scratchDir: join(cwd, "scratch"),
    dependenciesRoot: join(cwd, "tests", "al", "dependencies"),
    ...(opts.port !== undefined ? { port: opts.port } : {}),
    defaultModels: opts.preset !== undefined
      ? resolvePresetModels(config, opts.preset)
      : [],
  };
}

/**
 * Builds the real, container-touching `VerifyQueueVerifyFn` the dashboard's
 * escalation queue (`src/dashboard/verify-queue.ts`, Task 6) dispatches
 * against. Assembled HERE, not inside `src/dashboard/server.ts`: that module
 * must never import `handleAlVerify` (`mcp/al-tools-server.ts`) or reach a
 * real `ModelCaller` builder for the same reason it must never import the
 * config loader — `tests/unit/dashboard/ingest-safety.test.ts` polices its
 * whole import graph, and this is the one place in the codebase allowed to
 * widen it. `startServer` accepts the finished function as `opts.verify` and
 * wires it into a `VerifyQueue` it owns.
 *
 * A fresh `ModelCaller` is built PER JOB, scoped to that job's own
 * `taskId` — jobs in one long-lived queue can target different drafts
 * (different tasks) over the dashboard's lifetime, so a single caller built
 * once at startup would carry the wrong `taskId` into `generateCode`'s
 * context for every job after the first.
 *
 * `clearPrereqCaches()` runs per job for the same "this process is
 * long-lived" reason — see that function's own doc.
 */
export function createEscalationVerify(
  opts: {
    /**
     * Empties `mcp/al-tools-server.ts`'s prereq caches. Injectable ONLY so
     * the per-job call can be asserted without a container; production
     * always uses the default.
     */
    clearCaches?: () => void;
    /**
     * Container credentials from `.centralgauge.yml`. Without these the
     * provider falls back to `admin`/`admin` and every dev-endpoint publish
     * fails with `Status Code Unauthorized`, which is exactly how the first
     * real-hardware run of this path failed.
     */
    credentials?: { username: string; password: string };
    /** Container to prepare when a job does not name one. */
    defaultContainerName?: string;
    /**
     * Runs the bench's own container preflight (credentials + test
     * harness). Injectable ONLY so it can be asserted without a container.
     */
    prepareContainer?: (
      containerName: string,
      credentials?: { username: string; password: string },
    ) => Promise<void>;
  } = {},
): VerifyQueueVerifyFn {
  const clearCaches = opts.clearCaches ?? clearPrereqCaches;
  const prepare = opts.prepareContainer ?? prepareContainerForVerification;
  // One preflight per container for the life of the server, not per job:
  // `ensureTestHarness` probes before publishing, but a probe per job is a
  // container round-trip an author waits for on every click.
  const prepared = new Map<string, Promise<void>>();
  return async (job) => {
    // Once per job, before anything is staged. `prereqCache` (compiled
    // artifacts) and `publishedPrereqCache` (the publish promise) are
    // module-level and live for the whole `workbench serve` session, so
    // without this an author who edits `scratch/<id>/prereq/` between two
    // clicks is silently verified against the prereq from the first click.
    // The queue is serial, so nothing within a job shares them anyway.
    clearCaches();

    // The bench does this at startup; escalation never did, so it published
    // as `admin`/`admin` and got a 401. A failure here propagates to the
    // queue's catch and becomes an `errored` outcome, which is an
    // INFRASTRUCTURE state - it must never read as a test result.
    const container = job.containerName ?? opts.defaultContainerName;
    if (container !== undefined) {
      const existing = prepared.get(container);
      const pending = existing ?? prepare(container, opts.credentials);
      if (existing === undefined) prepared.set(container, pending);
      try {
        await pending;
      } catch (error) {
        // Do not cache a failed preflight: an author who fixes the
        // container should not have to restart the dashboard.
        prepared.delete(container);
        throw error;
      }
    }

    return verifyResponse({
      draftDir: job.draftDir,
      taskId: job.taskId,
      code: job.code,
      ...(job.containerName !== undefined
        ? { containerName: job.containerName }
        : {}),
      verify: handleAlVerify,
      call: createModelCaller({
        taskId: job.taskId,
        description: `Dashboard escalation fix attempt for ${job.taskId}`,
      }),
      model: job.model,
      // Re-checks bench liveness between the two publishes this job makes.
      // `VerifyQueue` already gates at dispatch, but that check is minutes
      // and one model call old by the time the fix attempt publishes; the
      // same `checkBenchGate` the queue and `POST /api/verify` use is the
      // right one, so a bench that starts mid-job is refused by all three.
      gate: () => checkBenchGate(),
    });
  };
}

export function registerWorkbenchCommand(cli: Command): void {
  const parent = new Command().description(
    "Local authoring dashboard for draft trap-tasks (scratch/).",
  );

  parent
    .command("serve", "Start the authoring dashboard")
    .option(
      "--port <port:number>",
      "Port to listen on (default: an OS-assigned ephemeral port)",
    )
    .option(
      "--preset <name:string>",
      "Pre-fill the model input from a benchmarkPresets entry in " +
        ".centralgauge.yml (unknown or absent leaves it empty — never an error)",
    )
    .action(async (opts) => {
      const config = await ConfigManager.loadConfig();
      const resolved = resolveServeOptions(
        {
          ...(opts.port !== undefined ? { port: opts.port } : {}),
          ...(opts.preset !== undefined ? { preset: opts.preset } : {}),
        },
        Deno.cwd(),
        config,
      );
      if (opts.preset !== undefined && resolved.defaultModels.length === 0) {
        console.warn(
          colors.yellow("[WARN]") +
            ` preset "${opts.preset}" has no models (unknown preset, or ` +
            `it defines none) — starting with an empty model input`,
        );
      }
      const server = await startServer({
        ...resolved,
        verify: createEscalationVerify({
          // Without these the provider falls back to `admin`/`admin` and
          // every dev-endpoint publish returns `Status Code Unauthorized`.
          // The bench reads the same block during container setup.
          ...(config.container?.credentials?.username !== undefined &&
              config.container?.credentials?.password !== undefined
            ? {
              credentials: {
                username: config.container.credentials.username,
                password: config.container.credentials.password,
              },
            }
            : {}),
          ...(config.container?.name !== undefined
            ? { defaultContainerName: config.container.name }
            : {}),
        }),
      });
      console.log(
        colors.green("[OK]") +
          ` Dashboard listening at http://${server.hostname}:${server.port}`,
      );
    });

  // deno-lint-ignore no-explicit-any
  (cli as any).command("workbench", parent);
}
