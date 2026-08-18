/**
 * HTTP server for the authoring dashboard.
 *
 * An author opens this in a browser, sees their scaffolded drafts
 * (`scratch/<id>/`, via `listDrafts`), and fires a "quick run" that asks
 * several models the same question (`runQuick`) to see which ones fall for
 * the trap a draft is built around.
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

const UI_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>CentralGauge Dashboard</title>
</head>
<body>
<h1>CentralGauge Authoring Dashboard</h1>
<p>Draft list and quick-run UI land in a later task.</p>
</body>
</html>
`;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Runs before `deps.runQuick` is ever invoked, so a malformed or
 * unresolvable request never reaches it. Two checks, both 400:
 * `models` must be a non-empty array of strings, and `draftId` must name a
 * draft `listDrafts` actually returned — not merely a well-formed string.
 */
function validateRunRequest(
  body: unknown,
  drafts: DraftSummary[],
): { ok: true; draftId: string; models: string[]; prompt: string } | {
  ok: false;
  error: string;
} {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "request body must be a JSON object" };
  }
  const { draftId, models, prompt } = body as Record<string, unknown>;

  if (
    !Array.isArray(models) || models.length === 0 ||
    !models.every((m) => typeof m === "string")
  ) {
    return { ok: false, error: "models must be a non-empty array of strings" };
  }
  if (typeof draftId !== "string") {
    return { ok: false, error: "draftId must be a string" };
  }
  if (!drafts.some((d) => d.id === draftId)) {
    return { ok: false, error: `unknown draft: ${draftId}` };
  }

  return {
    ok: true,
    draftId,
    models,
    prompt: typeof prompt === "string" ? prompt : "",
  };
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
  },
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);

    if (req.method === "GET" && url.pathname === "/") {
      return new Response(UI_HTML, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    if (req.method === "GET" && url.pathname === "/api/drafts") {
      const drafts = await deps.listDrafts(deps.scratchDir);
      return jsonResponse(200, { drafts });
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

      const draft = drafts.find((d) => d.id === validated.draftId);
      if (!draft) {
        // Unreachable: validateRunRequest already confirmed a match against
        // this same `drafts` array. Guards the non-null use below.
        return jsonResponse(400, { error: "unknown draft" });
      }

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
          prompt: validated.prompt,
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
  opts: { scratchDir: string; port?: number },
): Promise<DashboardServer> {
  const handler = createHandler({
    scratchDir: opts.scratchDir,
    listDrafts,
    runQuick,
    loadTrapSources,
    createModelCaller,
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
