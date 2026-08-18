/**
 * HTTP server for the authoring dashboard.
 *
 * An author opens this in a browser, sees their scaffolded drafts
 * (`scratch/<id>/`, via `listDrafts`), and fires a "quick run" that asks
 * several models the same question (`runQuick`) to see which ones fall for
 * the trap a draft is built around.
 *
 * That question is derived server-side from the selected draft's `task.yml`,
 * through the same attempt-1 path the bench uses
 * (`src/llm/prompt-building.ts`). It is never taken from the request body:
 * spec §2b's reason is that an author must calibrate against the prompt the
 * bench actually sends, and the practical one is that a `prompt` field the
 * client never populated meant every model was asked the empty string.
 *
 * `createHandler` is the pure request router: it has no dependency on a
 * bound socket, so route behavior (including validation) is unit-testable
 * without ever calling `Deno.serve`. `startServer` is the thin listener
 * shell around it.
 *
 * Binding is a security property, not an implementation detail: this server
 * spends API money on every quick run, and in later plans will drive
 * container publishes. It binds `127.0.0.1` only — never call
 * `Deno.serve` here with any other hostname.
 *
 * `defaultModels` (surfaced at `GET /api/defaults`) pre-fills the UI's model
 * input from a `--preset` name. It is resolved OUTSIDE this module, by the
 * CLI (`cli/commands/workbench-command.ts`, via `resolvePresetModels` in
 * `./drafts.ts`), and handed in as plain data. This module must never import
 * the config loader itself: `tests/unit/dashboard/ingest-safety.test.ts`
 * polices this file's whole import graph, and every module reached from
 * here is one more thing a later change could accidentally widen into
 * something the dashboard must never reach.
 *
 * @module dashboard/server
 */

import type { DraftSummary } from "./drafts.ts";
import type { QuickRun } from "./run-manager.ts";

import { listDrafts } from "./drafts.ts";
import { runQuick } from "./run-manager.ts";
import { createModelCaller } from "./model-caller.ts";
import { loadTrapSources } from "./source-loader.ts";

export interface DashboardServer {
  port: number;
  /** The address actually bound. Exposed so the loopback-only guarantee is
   *  assertable rather than merely intended. */
  hostname: string;
  shutdown(): Promise<void>;
}

const UI_DIR = new URL("./ui/", import.meta.url);

/**
 * The complete set of static files this server will ever serve, keyed by
 * request path. Deliberately an explicit three-entry allowlist rather than
 * a generic `url.pathname` -> filesystem-path mapper: a generic static
 * handler is a path-traversal hole, and this server is not merely a file
 * server — it holds provider credentials by way of the LLM registry and, in
 * later plans, drives container publishes. Every path not listed here 404s.
 */
const STATIC_FILES: Record<string, { file: string; contentType: string }> = {
  "/": { file: "index.html", contentType: "text/html; charset=utf-8" },
  "/app.js": {
    file: "app.js",
    contentType: "text/javascript; charset=utf-8",
  },
  "/style.css": { file: "style.css", contentType: "text/css; charset=utf-8" },
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Runs before `deps.runQuick` is ever invoked, so a malformed or
 * unresolvable request never reaches it, and resolves the request to the
 * `DraftSummary` the run will actually read. Checks, all 400:
 * `models` must be a non-empty array of strings, `draftDir` must name a draft
 * `listDrafts` actually returned (not merely a well-formed string), and that
 * draft's `task.yml` must carry a description.
 *
 * The request names a `draftDir`, NOT a task id. Task 8 fix round 2
 * deliberately allows two directories to report one id — `scratch/CG-AL-X053/`
 * and `scratch/pre-migration-backup_x053/` both say `id: CG-AL-X053` on this
 * machine — and ruled that `dir` is the only guaranteed-unique field.
 * Resolving on `id` returned whichever came first in `(id, dirName)` sort
 * order, so selecting the backup ran against the other directory's sources
 * and labelled the result with the backup's name.
 *
 * There is deliberately no `prompt` field. The question is rendered
 * server-side from the draft's `task.yml` through the bench's own attempt-1
 * path — a client-supplied prompt is both how every model came to be asked
 * the empty string and a way to calibrate against a prompt the bench never
 * sends (spec §2b). The description check is the same guarantee from the
 * other side: a draft still carrying no description is an authoring state,
 * not a runnable one, and spending API money to ask N models "## Task\n\n"
 * is exactly the failure this endpoint should refuse rather than report.
 */
function validateRunRequest(
  body: unknown,
  drafts: DraftSummary[],
): { ok: true; draft: DraftSummary; models: string[] } | {
  ok: false;
  error: string;
} {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "request body must be a JSON object" };
  }
  const { draftDir, models } = body as Record<string, unknown>;

  if (
    !Array.isArray(models) || models.length === 0 ||
    !models.every((m) => typeof m === "string")
  ) {
    return { ok: false, error: "models must be a non-empty array of strings" };
  }
  if (typeof draftDir !== "string") {
    return { ok: false, error: "draftDir must be a string" };
  }
  const draft = drafts.find((d) => d.dir === draftDir);
  if (!draft) {
    return { ok: false, error: `unknown draft directory: ${draftDir}` };
  }
  // `?? ""` rather than trusting the type: `deps.listDrafts` is injectable,
  // so a partially-shaped draft should 400 with a legible reason rather than
  // 500 on a TypeError.
  if ((draft.description ?? "").trim().length === 0) {
    return {
      ok: false,
      error: `draft ${draft.id} has no description in task.yml, so there is ` +
        `nothing to ask the models`,
    };
  }

  return { ok: true, draft, models };
}

/**
 * Builds the pure request router. No socket, no side effects at call time —
 * every route reads only from the injected `deps`, which is what lets the
 * test suite exercise every status code — and, for `POST /api/run`'s
 * success path, a real matrix result — without `Deno.serve` ever binding a
 * port and without any test reaching a real model provider. Only
 * `createModelCaller` needs faking in a test; `loadTrapSources` and
 * `runQuick` are pure/local enough to use for real against a temp dir.
 *
 * `POST /api/run`'s success path reads the draft's `correct/`/`naive/` AL
 * sources off disk (`deps.loadTrapSources`), builds a model caller scoped to
 * this run (`deps.createModelCaller`), and hands both to `deps.runQuick`.
 */
export function createHandler(
  deps: {
    scratchDir: string;
    listDrafts: typeof listDrafts;
    runQuick: typeof runQuick;
    loadTrapSources: typeof loadTrapSources;
    createModelCaller: typeof createModelCaller;
    /** CLI-resolved `--preset` models (see the module doc comment), or
     *  empty when none were given. Served verbatim at `GET /api/defaults`. */
    defaultModels: string[];
  },
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);

    const staticEntry = req.method === "GET"
      ? STATIC_FILES[url.pathname]
      : undefined;
    if (staticEntry) {
      const content = await Deno.readTextFile(
        new URL(staticEntry.file, UI_DIR),
      );
      return new Response(content, {
        status: 200,
        headers: { "content-type": staticEntry.contentType },
      });
    }

    if (req.method === "GET" && url.pathname === "/api/drafts") {
      const drafts = await deps.listDrafts(deps.scratchDir);
      return jsonResponse(200, { drafts });
    }

    if (req.method === "GET" && url.pathname === "/api/defaults") {
      return jsonResponse(200, { defaultModels: deps.defaultModels });
    }

    if (req.method === "POST" && url.pathname === "/api/run") {
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return jsonResponse(400, { error: "request body must be valid JSON" });
      }

      const drafts = await deps.listDrafts(deps.scratchDir);
      const validated = validateRunRequest(body, drafts);
      if (!validated.ok) {
        return jsonResponse(400, { error: validated.error });
      }

      const draft = validated.draft;

      try {
        const { correctSources, naiveSources } = await deps.loadTrapSources(
          draft.id,
          draft.dir,
        );
        const call = deps.createModelCaller({
          taskId: draft.id,
          description: `Dashboard quick run for ${draft.id}`,
        });
        const run: QuickRun = await deps.runQuick({
          draft,
          models: validated.models,
          correctSources,
          naiveSources,
          call,
        });
        return jsonResponse(200, run);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return jsonResponse(500, { error: message });
      }
    }

    return jsonResponse(404, { error: "not found" });
  };
}

/**
 * Binds the router to a loopback-only listener.
 *
 * `port: 0` (the default via `opts.port` being undefined) asks the OS for
 * an ephemeral port. Either way, `port`/`hostname` on the returned
 * `DashboardServer` are read back from `Deno.serve`'s own `addr`, not
 * echoed from `opts` — an echo would make the loopback guarantee
 * unfalsifiable by a test.
 */
export function startServer(
  opts: { scratchDir: string; port?: number; defaultModels?: string[] },
): Promise<DashboardServer> {
  const handler = createHandler({
    scratchDir: opts.scratchDir,
    listDrafts,
    runQuick,
    loadTrapSources,
    createModelCaller,
    defaultModels: opts.defaultModels ?? [],
  });

  const server = Deno.serve(
    {
      hostname: "127.0.0.1",
      port: opts.port ?? 0,
      onListen: () => {},
    },
    handler,
  );

  const addr = server.addr;
  if (!("hostname" in addr) || !("port" in addr)) {
    throw new Error(
      `dashboard server bound to a non-network address: ${
        JSON.stringify(addr)
      }`,
    );
  }

  return Promise.resolve({
    port: addr.port,
    hostname: addr.hostname,
    shutdown: () => server.shutdown(),
  });
}
