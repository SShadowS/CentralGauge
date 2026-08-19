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
import type { VerifyQueueEvent, VerifyQueueVerifyFn } from "./verify-queue.ts";

import { listDrafts } from "./drafts.ts";
import { runQuick, writeRunArtifact } from "./run-manager.ts";
import { createModelCaller } from "./model-caller.ts";
import { loadPrereqSources } from "./prereq-sources.ts";
import { loadTrapSources } from "./source-loader.ts";
import { promoteAsNaive, PromoteRefusal } from "./promote-naive.ts";
import { VerifyQueue } from "./verify-queue.ts";
import { checkBenchGate } from "./bench-gate.ts";

export interface DashboardServer {
  port: number;
  /** The address actually bound. Exposed so the loopback-only guarantee is
   *  assertable rather than merely intended. */
  hostname: string;
  shutdown(): Promise<void>;
}

const UI_DIR = new URL("./ui/", import.meta.url);

/**
 * `POST /api/verify` and `GET /api/verify-events`'s refusal when
 * `deps.verifyQueue` is `undefined` — no `verify` adapter was supplied to
 * `startServer`. Deliberately worded like `checkBenchGate`'s own refusal
 * reason (same "still works" reassurance), and deliberately NOT reusing
 * `errored` or any `VerifyOutcome` state: those describe what happened to a
 * JOB, and no job exists here — nothing was ever enqueued.
 */
const ESCALATION_NOT_CONFIGURED =
  "escalation is not configured on this server: no verify adapter was " +
  "supplied to startServer. Ask N models still works.";

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

/**
 * Hostnames a browser may legitimately have used to reach a loopback-bound
 * server. Any other value in `Host` means the request arrived through a name
 * that resolves here but is not ours — DNS rebinding.
 */
const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/** Strips the `:port` suffix from a `Host`/`Origin` authority. */
function hostnameOf(authority: string): string {
  if (authority.startsWith("[")) {
    const end = authority.indexOf("]");
    return end === -1 ? authority : authority.slice(0, end + 1);
  }
  const colon = authority.lastIndexOf(":");
  return colon === -1 ? authority : authority.slice(0, colon);
}

/**
 * Rejects a request that a browser sent from somewhere other than this
 * server's own loopback origin. Two headers, both only checked when present:
 *
 * - `Host`: an attacker who points `evil.example` at 127.0.0.1 gets the
 *   victim's browser to send same-origin requests here, and the loopback
 *   binding does nothing about it. Browsers always send `Host`, so a value
 *   that is not loopback is proof of rebinding.
 * - `Origin`: browsers attach it to every cross-origin POST, form
 *   submissions included. That is what closes the CSRF hole the loopback
 *   binding leaves open: `req.json()` parses a body whatever its
 *   content-type, so a plain `<form enctype="text/plain">` on a page the
 *   author visits is a simple request that would otherwise trigger a real
 *   model fan-out. The attacker cannot read the answer; the spend happens
 *   anyway.
 *
 * Absent headers pass. Non-browser callers (curl, the test suite) send
 * neither, and they are not the threat this defends against — the attacker
 * here is a page in the author's own browser, which cannot omit them.
 */
function isSameOriginRequest(
  req: Request,
  expectedPort: number | undefined,
): boolean {
  const host = req.headers.get("host");
  if (host !== null && !LOOPBACK_HOSTNAMES.has(hostnameOf(host))) {
    return false;
  }

  const origin = req.headers.get("origin");
  if (origin !== null) {
    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      return false;
    }
    if (!LOOPBACK_HOSTNAMES.has(url.hostname)) return false;
    // The hostname alone is not this server's origin: another local dev
    // server on 127.0.0.1:3000 is a different origin and its pages must not
    // be able to spend money here. `URL#port` is "" for a scheme's default
    // port, so fill that in before comparing.
    if (expectedPort !== undefined) {
      const originPort = url.port ||
        (url.protocol === "https:" ? "443" : "80");
      if (originPort !== String(expectedPort)) return false;
    }
  }

  return true;
}

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
 * Runs before `deps.promoteAsNaive` is ever invoked — `promoteAsNaive` itself
 * deletes `naive/`'s existing `*.al` files once it decides to write, so a
 * malformed request must never reach it. Checks, all 400: `draftDir` must
 * name a draft `listDrafts` actually returned (resolved by `d.dir`, same
 * reasoning as `validateRunRequest` — `dir` is the only guaranteed-unique
 * field), `code` must be a non-empty string, `model` must be a non-empty
 * string, and `attempt` must be a finite number. The last two exist so a
 * malformed body 400s here rather than throwing a `TypeError` out of
 * `promoteAsNaive` and surfacing as an opaque 500.
 */
function validatePromoteRequest(
  body: unknown,
  drafts: DraftSummary[],
): {
  ok: true;
  draft: DraftSummary;
  code: string;
  model: string;
  attempt: number;
} | {
  ok: false;
  error: string;
} {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "request body must be a JSON object" };
  }
  const { draftDir, code, model, attempt } = body as Record<string, unknown>;

  if (typeof draftDir !== "string") {
    return { ok: false, error: "draftDir must be a string" };
  }
  const draft = drafts.find((d) => d.dir === draftDir);
  if (!draft) {
    return { ok: false, error: `unknown draft directory: ${draftDir}` };
  }
  if (typeof code !== "string" || code.trim().length === 0) {
    return { ok: false, error: "code must be a non-empty string" };
  }
  if (typeof model !== "string" || model.trim().length === 0) {
    return { ok: false, error: "model must be a non-empty string" };
  }
  if (typeof attempt !== "number" || !Number.isFinite(attempt)) {
    return { ok: false, error: "attempt must be a number" };
  }

  return { ok: true, draft, code, model, attempt };
}

/**
 * Runs before `deps.verifyQueue.enqueue` is ever invoked, so a malformed or
 * unresolvable request never reaches the queue. Checks, all 400: `draftDir`
 * must name a draft `listDrafts` actually returned (resolved by `d.dir`,
 * same reasoning as `validateRunRequest` and `validatePromoteRequest` above
 * — `dir` is the only guaranteed-unique field), and `responses` must be a
 * non-empty array of `{model, code}` pairs, both non-empty strings.
 * `containerName`, when present, must be a string — forwarded to every job
 * in the batch.
 */
function validateVerifyRequest(
  body: unknown,
  drafts: DraftSummary[],
): {
  ok: true;
  draft: DraftSummary;
  responses: Array<{ model: string; code: string }>;
  containerName?: string;
} | {
  ok: false;
  error: string;
} {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "request body must be a JSON object" };
  }
  const { draftDir, responses, containerName } = body as Record<
    string,
    unknown
  >;

  if (typeof draftDir !== "string") {
    return { ok: false, error: "draftDir must be a string" };
  }
  const draft = drafts.find((d) => d.dir === draftDir);
  if (!draft) {
    return { ok: false, error: `unknown draft directory: ${draftDir}` };
  }
  if (!Array.isArray(responses) || responses.length === 0) {
    return {
      ok: false,
      error: "responses must be a non-empty array of {model, code}",
    };
  }
  const parsed: Array<{ model: string; code: string }> = [];
  for (const entry of responses) {
    if (typeof entry !== "object" || entry === null) {
      return { ok: false, error: "each response must be an object" };
    }
    const { model, code } = entry as Record<string, unknown>;
    if (typeof model !== "string" || model.trim().length === 0) {
      return {
        ok: false,
        error: "each response's model must be a non-empty string",
      };
    }
    if (typeof code !== "string" || code.trim().length === 0) {
      return {
        ok: false,
        error: "each response's code must be a non-empty string",
      };
    }
    parsed.push({ model, code });
  }
  if (containerName !== undefined && typeof containerName !== "string") {
    return { ok: false, error: "containerName must be a string" };
  }

  return {
    ok: true,
    draft,
    responses: parsed,
    ...(typeof containerName === "string" ? { containerName } : {}),
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
 * sources off disk (`deps.loadTrapSources`), loads its `prereq/` sources off
 * disk (`deps.loadPrereqSources`), builds a model caller scoped to this run
 * (`deps.createModelCaller`), hands all three to `deps.runQuick`, and
 * persists the result through `deps.writeRunArtifact`, answering with the
 * run plus either `artifactPath` or `artifactError`.
 */
/**
 * Everything `createHandler` needs, named so callers and tests can type
 * a fixture instead of casting one.
 *
 * It was an inline anonymous type on the parameter, which forced every
 * test fixture through `as unknown as Parameters<typeof createHandler>[0]`.
 * That cast silences the compiler about the WHOLE object, so a fixture
 * missing a dep type-checks cleanly and fails at runtime instead. It cost
 * three separate debugging rounds in one session: `verifyQueue` and
 * `checkBenchGate` are both absent from the shared base fixture, and
 * nothing said so until a route reached for one.
 */
export interface DashboardHandlerDeps {
  scratchDir: string;
  /**
   * Root a draft's `prereq/` chained dependencies resolve against
   * (`loadPrereqSources`'s `dependenciesRoot`), ABSOLUTE.
   *
   * Handed in rather than read here, exactly like `scratchDir`, and for
   * the same two reasons. This module must never import the config
   * loader — `tests/unit/dashboard/ingest-safety.test.ts` polices its
   * whole import graph. And it was previously the relative literal
   * `"tests/al/dependencies"`, resolved against `Deno.cwd()`: started
   * from anywhere but the repo root, every chained dependency silently
   * failed to resolve, which is indistinguishable from the legitimate
   * base-app case, and every one of their fields vanished from the index
   * with no signal. `cli/commands/workbench-command.ts` absolutises it
   * against the repo root.
   */
  dependenciesRoot: string;
  listDrafts: typeof listDrafts;
  runQuick: typeof runQuick;
  writeRunArtifact: typeof writeRunArtifact;
  loadTrapSources: typeof loadTrapSources;
  loadPrereqSources: typeof loadPrereqSources;
  createModelCaller: typeof createModelCaller;
  promoteAsNaive: typeof promoteAsNaive;
  /** CLI-resolved `--preset` models (see the module doc comment), or
   *  empty when none were given. Served verbatim at `GET /api/defaults`. */
  defaultModels: string[];
  /**
   * The serial escalation-verify queue (`./verify-queue.ts`, Task 6).
   * Narrowed to the three methods this router actually calls — a fake in
   * a test needs no `drain()`/`shutdown()` to stand in for it.
   * `startServer` wires this to a real `VerifyQueue` whose `verify`
   * function is the real container-touching adapter, built in
   * `cli/commands/workbench-command.ts` — never imported here (see the
   * module doc comment on why this file stays clear of `handleAlVerify`).
   *
   * `undefined` means escalation is NOT configured for this server
   * instance (no `verify` adapter was supplied to `startServer`) — a
   * legitimate mode, not an error: "Ask N models" must keep working with
   * containers down or unconfigured. Both verify routes refuse up front
   * in that case (`ESCALATION_NOT_CONFIGURED`), before touching anything
   * that would need a queue. There used to be a fallback queue here whose
   * `verify` unconditionally reported `errored` — that fabricated the
   * exact false signal Task 4 spent two rounds removing from
   * `mapResult`: a missing adapter would read as "the container died"
   * (real infra outcome) rather than "escalation isn't configured"
   * (config state), sending an author to chase an outage that never
   * happened.
   */
  verifyQueue: Pick<VerifyQueue, "enqueue" | "on" | "snapshot"> | undefined;
  /**
   * Synchronous bench-liveness check for `POST /api/verify` itself,
   * distinct from the queue's OWN per-job gate (re-checked at dispatch
   * time, per `VerifyQueue`'s doc comment). A job at the back of a long
   * queue might not dispatch for a while, so relying on the queue's
   * internal check alone would silently accept work now and refuse it
   * arbitrarily far in the future. This lets the route refuse
   * IMMEDIATELY, with the gate's reason, before the queue is ever
   * touched. Typed exactly like the real `checkBenchGate` so
   * `startServer` can pass it straight through.
   */
  checkBenchGate: typeof checkBenchGate;
  /**
   * The port this server is actually bound to, for the `Origin` check.
   * A THUNK, not a number, because `Deno.serve` needs the handler before
   * it can report an address — `startServer` fills the value in once the
   * listener exists. Returning `undefined` (before the listener is up, or
   * in a router test with no socket at all) falls back to the
   * hostname-only check rather than refusing everything.
   */
  boundPort?: () => number | undefined;
}

export function createHandler(
  deps: DashboardHandlerDeps,
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);

    // Before anything else, including the static files: a request that
    // reached us through a rebound DNS name, or from another origin, is
    // refused whatever it asked for.
    if (!isSameOriginRequest(req, deps.boundPort?.())) {
      return jsonResponse(403, {
        error: "refused: request did not come from this server's own origin",
      });
    }

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

    // Whether "Compile & test" can run right now, answerable WITHOUT
    // touching a container so the UI can poll it.
    //
    // Deliberately narrower than a full preflight. It reports the two
    // states that are free to check and that change under an author's feet:
    // escalation not configured on this server, and a benchmark holding the
    // lock. It does NOT probe container reachability or harness presence,
    // because each costs a container round-trip and polling one every few
    // seconds from a dashboard would be both wasteful and, on a container
    // a bench is using, actively unhelpful. Those two are checked by the
    // real preflight at click time and reported as infrastructure outcomes
    // with the container's own transcript.
    //
    // So a `ready: true` here means "nothing known is blocking you", never
    // "this will succeed".
    if (req.method === "GET" && url.pathname === "/api/escalation-readiness") {
      if (!deps.verifyQueue) {
        return jsonResponse(200, {
          ready: false,
          reason: ESCALATION_NOT_CONFIGURED,
        });
      }
      const decision = deps.checkBenchGate();
      return jsonResponse(
        200,
        decision.allowed
          ? { ready: true }
          : { ready: false, reason: decision.reason },
      );
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
        const {
          sources: prereqSources,
          hasError: prereqSourcesIncomplete,
        } = await deps.loadPrereqSources(
          draft.dir,
          deps.dependenciesRoot,
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
          prereqSources,
          prereqSourcesIncomplete,
          call,
        });

        // Persist the run under `<draftDir>/.runs/` and tell the author
        // where. Best-effort by design: the matrix is what the run is FOR,
        // and losing it because a directory could not be created would be
        // worse than losing the file. The failure is reported rather than
        // swallowed — see spec §7 for why the artifact's shape and location
        // are the two structural barriers against a stray ingest replay.
        let artifact: { artifactPath: string } | { artifactError: string };
        try {
          artifact = {
            artifactPath: await deps.writeRunArtifact(draft.dir, run),
          };
        } catch (error) {
          artifact = {
            artifactError: error instanceof Error
              ? error.message
              : String(error),
          };
        }

        return jsonResponse(200, { ...run, ...artifact });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return jsonResponse(500, { error: message });
      }
    }

    // Promotes one model's response into the selected draft's `naive/` — a
    // real mistake in place of an invented one (`./promote-naive.ts`'s module
    // doc). Validated exactly like `/api/run`, above: an unknown `draftDir`
    // or empty `code` 400s before `deps.promoteAsNaive` ever touches disk. A
    // `PromoteRefusal` (a filename collision, the reserved `<taskId>.`
    // prefix, or nothing extractable) becomes a 400 carrying its message
    // verbatim — the author needs to read WHY, not a generic failure. Any
    // other error is a 500.
    if (req.method === "POST" && url.pathname === "/api/promote-naive") {
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return jsonResponse(400, { error: "request body must be valid JSON" });
      }

      const drafts = await deps.listDrafts(deps.scratchDir);
      const validated = validatePromoteRequest(body, drafts);
      if (!validated.ok) {
        return jsonResponse(400, { error: validated.error });
      }

      const { draft, code, model, attempt } = validated;

      try {
        const result = await deps.promoteAsNaive({
          draftDir: draft.dir,
          taskId: draft.id,
          code,
          model,
          attempt,
          timestamp: new Date().toISOString(),
        });
        return jsonResponse(200, result);
      } catch (error) {
        if (error instanceof PromoteRefusal) {
          return jsonResponse(400, { error: error.message });
        }
        const message = error instanceof Error ? error.message : String(error);
        return jsonResponse(500, { error: message });
      }
    }

    // Enqueues one escalation-verify job per requested response against the
    // selected draft's oracle (`VerifyQueue`, Task 6), and returns each
    // job's id so the caller can correlate it with the outcomes that arrive
    // on `GET /api/verify-events`. Validated exactly like `/api/run` and
    // `/api/promote-naive`, above: an unknown `draftDir` or a malformed
    // `responses` entry 400s before the queue is ever touched.
    //
    // The bench-liveness gate is checked HERE too, synchronously, in
    // addition to the queue's own per-job re-check. The queue's check runs
    // at DISPATCH time, which for a job at the back of a longer queue could
    // be arbitrarily far in the future — a request that arrives while a
    // bench is ALREADY live should 409 immediately, carrying the gate's
    // reason verbatim, rather than silently accepting work the queue will
    // only refuse one job at a time, later.
    if (req.method === "POST" && url.pathname === "/api/verify") {
      // Checked FIRST, before the body is even parsed: escalation being
      // unconfigured is a legitimate server mode (spec: "Ask N models"
      // works with containers down), not a failure, so it must never reach
      // the queue or produce a job at all — see `ESCALATION_NOT_CONFIGURED`.
      if (!deps.verifyQueue) {
        return jsonResponse(501, { error: ESCALATION_NOT_CONFIGURED });
      }
      // Re-bound to a local so the guard above narrows it for the rest of
      // this block — TS drops narrowing on a property access across an
      // intervening function/await, and there are several below.
      const verifyQueue = deps.verifyQueue;

      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return jsonResponse(400, { error: "request body must be valid JSON" });
      }

      const drafts = await deps.listDrafts(deps.scratchDir);
      const validated = validateVerifyRequest(body, drafts);
      if (!validated.ok) {
        return jsonResponse(400, { error: validated.error });
      }

      const decision = deps.checkBenchGate();
      if (!decision.allowed) {
        return jsonResponse(409, { error: decision.reason });
      }

      const { draft, responses, containerName } = validated;
      const jobs = responses.map(({ model, code }) => ({
        model,
        id: verifyQueue.enqueue({
          draftDir: draft.dir,
          taskId: draft.id,
          model,
          code,
          ...(containerName !== undefined ? { containerName } : {}),
        }),
      }));

      return jsonResponse(200, { jobs });
    }

    // Server-sent events for the escalation queue: every outcome transition
    // for every job this queue has ever accepted, as it happens.
    //
    // Precedent is `cli/dashboard/server.ts`'s SSE handler — replay current
    // state to a newly connected client before subscribing it to live
    // updates, so a browser that connects mid-run does not sit blank, or
    // worse, miss the job that is executing RIGHT NOW: `snapshot()` returns
    // every job regardless of state, so the replay below covers `queued`,
    // `running`, AND terminal jobs alike — there is deliberately no filter.
    // The controller is only subscribed for live updates once the replay
    // actually landed (same reasoning as that precedent's CLI9 fix): one
    // registered after a failed replay would sit dead, subscribed to an
    // event source it can never forward to a closed stream. `cancel()`
    // actively unsubscribes on disconnect rather than waiting for the
    // queue's next emit to discover a broken pipe.
    //
    // Unlike that precedent, this response carries NO
    // `access-control-allow-origin` header: this dashboard binds loopback
    // only and enforces `isSameOriginRequest` globally, above, and a CORS
    // header here would needlessly widen who can read it.
    if (req.method === "GET" && url.pathname === "/api/verify-events") {
      // Same refusal as `POST /api/verify`, and the same reason it must be
      // checked here too rather than assumed from that route alone: a
      // client can open this stream directly, with no prior `/api/verify`
      // call in this process.
      if (!deps.verifyQueue) {
        return jsonResponse(501, { error: ESCALATION_NOT_CONFIGURED });
      }
      const verifyQueue = deps.verifyQueue;

      const encoder = new TextEncoder();
      let unsubscribe: (() => void) | undefined;

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          let replayOk = true;
          const send = (event: VerifyQueueEvent) => {
            if (!replayOk) return;
            try {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
              );
            } catch {
              replayOk = false;
            }
          };

          for (const view of verifyQueue.snapshot()) {
            send({ id: view.id, job: view.job, outcome: view.outcome });
          }

          if (replayOk) {
            unsubscribe = verifyQueue.on(send);
          }
        },
        cancel() {
          unsubscribe?.();
        },
      });

      return new Response(stream, {
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          "connection": "keep-alive",
        },
      });
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
  opts: {
    scratchDir: string;
    /** Absolute root for chained prereq dependencies — see
     *  `createHandler`'s dep of the same name. */
    dependenciesRoot: string;
    port?: number;
    defaultModels?: string[];
    /**
     * Maps one escalation job to its `VerifyOutcome`. Production wires this
     * to `verifyResponse` (`./verify-run.ts`) backed by the real
     * `handleAlVerify` (`mcp/al-tools-server.ts`) and a real `ModelCaller` —
     * that adapter is built in `cli/commands/workbench-command.ts`, NOT
     * here: this module must never import `handleAlVerify` directly, same
     * reason it must never import the config loader (module doc comment;
     * `tests/unit/dashboard/ingest-safety.test.ts` polices it).
     *
     * Left `undefined` — every test that does not exercise escalation, plus
     * any caller that omits it — means escalation is NOT configured for
     * this server instance: `startServer` builds no `VerifyQueue` at all,
     * and both verify routes refuse up front with
     * `ESCALATION_NOT_CONFIGURED` rather than accepting a job. This used to
     * fall back to a stub `verify` that reported every job `errored` —
     * fabricating the exact false signal Task 4 spent two rounds removing
     * from `mapResult`: a missing adapter would read as "the container
     * died" (a real infra outcome) rather than "escalation isn't
     * configured" (a config state), sending an author to chase an outage
     * that never happened. "Ask N models" is a legitimate mode with
     * containers down or unconfigured, so this must never be required.
     */
    verify?: VerifyQueueVerifyFn;
  },
): Promise<DashboardServer> {
  // Filled in below, once `Deno.serve` can tell us what it bound. Read
  // lazily by the handler's `Origin` check — see `boundPort` on
  // `createHandler`'s deps for why that is a thunk. A one-field holder
  // rather than a bare `let`: the closure reads it before the assignment
  // happens, which deno_lint's `prefer-const` cannot see, so a `let` here
  // gets reported as never reassigned.
  const listener: { port: number | undefined } = { port: undefined };

  const verifyQueue = opts.verify
    ? new VerifyQueue({ gate: () => checkBenchGate(), verify: opts.verify })
    : undefined;

  const handler = createHandler({
    scratchDir: opts.scratchDir,
    dependenciesRoot: opts.dependenciesRoot,
    listDrafts,
    runQuick,
    writeRunArtifact,
    loadTrapSources,
    loadPrereqSources,
    createModelCaller,
    promoteAsNaive,
    defaultModels: opts.defaultModels ?? [],
    boundPort: () => listener.port,
    verifyQueue,
    checkBenchGate,
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
  listener.port = addr.port;

  return Promise.resolve({
    port: addr.port,
    hostname: addr.hostname,
    // The queue is shut down FIRST, before the listener. `Deno.serve`'s
    // `shutdown()` only stops accepting connections — it does not touch the
    // queue's `pump` chain, so every job still `queued` would go on to
    // dispatch, stage a temp directory and publish to a real container
    // AFTER the caller had been told the server was down. `VerifyQueue`
    // maintains that invariant carefully and had no production caller.
    //
    // Deliberately does NOT wait for an in-flight job: `shutdown()` leaves
    // a running job alone by design (there is no cancellation seam), so
    // awaiting `drain()` here would block the caller for the length of a
    // real container publish. The latch means nothing NEW starts.
    shutdown: async () => {
      verifyQueue?.shutdown("dashboard server is shutting down");
      await server.shutdown();
    },
  });
}
