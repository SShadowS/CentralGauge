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
 * @module cli/commands/workbench
 */

import { Command } from "@cliffy/command";
import * as colors from "@std/fmt/colors";
import { join } from "@std/path";

import { startServer } from "../../src/dashboard/server.ts";

export interface ServeOptions {
  port?: number;
}

export interface ResolvedServeOptions {
  scratchDir: string;
  /** Left `undefined` when not given, so `startServer` asks the OS for an
   *  ephemeral port rather than being handed a fabricated default. */
  port?: number;
}

/**
 * Resolves `workbench serve`'s options against a repo root, without ever
 * touching Cliffy — so this is unit-testable directly.
 */
export function resolveServeOptions(
  opts: ServeOptions,
  cwd: string,
): ResolvedServeOptions {
  return {
    scratchDir: join(cwd, "scratch"),
    ...(opts.port !== undefined ? { port: opts.port } : {}),
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
    .action(async (opts) => {
      const resolved = resolveServeOptions(
        opts.port !== undefined ? { port: opts.port } : {},
        Deno.cwd(),
      );
      const server = await startServer(resolved);
      console.log(
        colors.green("[OK]") +
          ` Dashboard listening at http://${server.hostname}:${server.port}`,
      );
    });

  // deno-lint-ignore no-explicit-any
  (cli as any).command("workbench", parent);
}
