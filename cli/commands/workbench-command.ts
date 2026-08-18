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
import { ConfigManager } from "../../src/config/config.ts";
import { startServer } from "../../src/dashboard/server.ts";
import { resolvePresetModels } from "../../src/dashboard/drafts.ts";

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
      const server = await startServer(resolved);
      console.log(
        colors.green("[OK]") +
          ` Dashboard listening at http://${server.hostname}:${server.port}`,
      );
    });

  // deno-lint-ignore no-explicit-any
  (cli as any).command("workbench", parent);
}
