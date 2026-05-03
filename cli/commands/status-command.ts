/**
 * `centralgauge lifecycle status` — per-model lifecycle matrix + next-action
 * hints + zod-validated --json output for CI consumption.
 *
 * The command computes per-model state across BENCHED / DEBUGGED / ANALYZED
 * / PUBLISHED states and emits an 80-col-fit ANSI matrix with paste-ready
 * `centralgauge cycle` commands beneath it. The `--json` mode is consumed
 * by Plan G's weekly-cycle workflow via `jq '.hints[].command'`.
 *
 * Architecture notes (Plan H §H1 + cross-plan audit):
 *
 *   - The command uses `currentState()` from `src/lifecycle/event-log.ts`
 *     (Wave 1 / A3) per model rather than calling Plan A's
 *     `/api/v1/admin/lifecycle/state` endpoint directly. That endpoint
 *     requires `(model, task_set)` to be specified up-front and returns a
 *     CurrentStateMap-shaped JSON object — there is no "list every model"
 *     mode. Reusing `currentState` keeps the signing pattern uniform with
 *     the existing CLI helpers and avoids re-implementing
 *     `signLifecycleHeaders` here.
 *
 *   - Model discovery (when `--model` is omitted) hits the public
 *     `GET /api/v1/models` endpoint — unsigned, cached, returns slugs +
 *     family + generation. One signed `currentState` round-trip per model
 *     follows.
 *
 *   - `--task-set current` is resolved client-side via
 *     `computeTaskSetHash(cwd/tasks)` to match the `cycle` command's
 *     resolution path (same helper, identical hash). Plan H §H0.1b's
 *     parity check is enforced by construction.
 *
 *   - Admin scope is required (verifier scope is also accepted by the
 *     underlying endpoint, but the command surface fail-fasts on missing
 *     `adminKeyPath` to keep the operator UX consistent with
 *     `cluster-review`).
 *
 * @module cli/commands/status
 */
import { Command } from "@cliffy/command";
import * as colors from "@std/fmt/colors";
import { z } from "zod";
import { CentralGaugeError } from "../../src/errors.ts";
import {
  type IngestCliFlags,
  loadAdminConfig,
  readPrivateKey,
} from "../../src/ingest/config.ts";
import { resolveCurrentTaskSetHash } from "../../src/ingest/catalog/task-set-hash.ts";
import { currentState } from "../../src/lifecycle/event-log.ts";
import type {
  CurrentStateMap,
  LifecycleEvent,
} from "../../src/lifecycle/types.ts";
import { PRE_P6_TASK_SET_SENTINEL } from "../../src/lifecycle/types.ts";
import { generateHints } from "../../src/lifecycle/status-hints.ts";
import { renderMatrix } from "../../src/lifecycle/status-renderer.ts";
import {
  type ErrorRow,
  type StateRow,
  StateRowSchema,
  type StatusJsonError,
  StatusJsonErrorSchema,
  type StatusJsonOutput,
  StatusJsonOutputSchema,
  type Step,
} from "../../src/lifecycle/status-types.ts";

interface StatusFlags {
  model?: string;
  taskSet: string;
  json: boolean;
  legacy: boolean;
  url?: string;
  keyPath?: string;
  keyId?: number;
  machineId?: string;
  adminKeyPath?: string;
  adminKeyId?: number;
}

/**
 * Convert a `CurrentStateMap` (the per-model state shape returned by
 * `currentState()`) into a flat `StateRow[]` for the renderer. Pure,
 * exported for unit tests so callers can synthesise fixtures without
 * spinning up the worker.
 */
export function currentStateToRows(
  modelSlug: string,
  taskSetHash: string,
  state: CurrentStateMap,
): StateRow[] {
  const out: StateRow[] = [];
  const steps: Step[] = ["bench", "debug", "analyze", "publish", "cycle"];
  for (const step of steps) {
    const ev = state[step];
    if (!ev) continue;
    out.push(eventToRow(modelSlug, taskSetHash, step, ev));
  }
  return out;
}

function eventToRow(
  modelSlug: string,
  taskSetHash: string,
  step: Step,
  ev: LifecycleEvent,
): StateRow {
  const row: StateRow = {
    model_slug: modelSlug,
    task_set_hash: taskSetHash,
    step,
    last_ts: ev.ts,
    last_event_id: ev.id ?? 0,
    last_event_type: ev.event_type,
    last_payload_hash: ev.payload_hash ?? null,
    last_envelope_json: ev.envelope_json ?? null,
  };
  // Validate at the seam where untyped wire data crosses into the renderer.
  return StateRowSchema.parse(row);
}

/**
 * Partition rows into (current, legacy) by `task_set_hash`. The legacy
 * partition holds rows whose hash equals `PRE_P6_TASK_SET_SENTINEL` —
 * Plan B's backfill writes this for pre-P6 events whose original hash
 * was NULL. Always returns both partitions; the `--legacy` flag controls
 * only the human-readable display.
 *
 * Exported for tests.
 */
export function partitionRows(
  rows: StateRow[],
): { current: StateRow[]; legacy: StateRow[] } {
  const current: StateRow[] = [];
  const legacy: StateRow[] = [];
  for (const r of rows) {
    if (r.task_set_hash === PRE_P6_TASK_SET_SENTINEL) {
      legacy.push(r);
    } else {
      current.push(r);
    }
  }
  return { current, legacy };
}

/**
 * Defensive shape for the public `GET /api/v1/models` response. The worker
 * has historically returned `{ data: [{ slug, family, generation, ... }] }`
 * but cache misconfig, partial responses, or a future schema rename could
 * silently break the cast `body.data.map(m => m.slug)` with a cryptic
 * `TypeError: Cannot read properties of undefined`. zod-validating at the
 * seam turns the failure into a clean `invalid_models_response` error with
 * the parse issues attached for triage.
 */
const ModelsListResponseSchema = z.object({
  data: z.array(z.object({ slug: z.string() })),
});

/**
 * List all model slugs from the public `GET /api/v1/models` endpoint. No
 * auth required (the endpoint is public + cached). Returns slugs in the
 * order the worker emits them (which is `ORDER BY family_slug, slug` per
 * the worker code).
 *
 * Throws a `CentralGaugeError` with code `INVALID_MODELS_RESPONSE` (the
 * lower-cased `invalid_models_response` token appears in `.message` for
 * substring-matching by tests/operator triage) when the response body
 * doesn't match {@link ModelsListResponseSchema}.
 */
async function listAllModels(siteUrl: string): Promise<string[]> {
  const resp = await fetch(`${siteUrl}/api/v1/models`);
  if (!resp.ok) {
    throw new Error(
      `failed to list models: HTTP ${resp.status} ${resp.statusText}`,
    );
  }
  const rawBody = await resp.json();
  const parsed = ModelsListResponseSchema.safeParse(rawBody);
  if (!parsed.success) {
    throw new CentralGaugeError(
      `invalid_models_response: GET ${siteUrl}/api/v1/models returned a ` +
        `payload that does not match the expected shape ` +
        `({ data: [{ slug: string }] }). ` +
        `Issues: ${JSON.stringify(parsed.error.issues)}`,
      "INVALID_MODELS_RESPONSE",
      { url: `${siteUrl}/api/v1/models`, issues: parsed.error.issues },
    );
  }
  return parsed.data.data.map((m) => m.slug);
}

/**
 * Resolve the `current` task_set sentinel to a real hash. Uses the shared
 * `resolveCurrentTaskSetHash` helper so the `status`, `digest`, and `cycle`
 * commands always agree on what "current" means (Plan H §H0.1b parity
 * check is enforced by construction — same helper, same input).
 */
async function resolveTaskSetHash(taskSetFlag: string): Promise<string> {
  if (taskSetFlag !== "current") return taskSetFlag;
  return await resolveCurrentTaskSetHash();
}

interface FetchAllStateDeps {
  /** Override for tests; defaults to `currentState` from event-log.ts. */
  currentStateFn?: typeof currentState;
  /** Override for tests; defaults to `listAllModels`. */
  listModelsFn?: (url: string) => Promise<string[]>;
}

/** Tuple shape returned by {@link fetchAllRows} / {@link collectRowsAndErrors}. */
export interface FetchAllRowsResult {
  rows: StateRow[];
  errorRows: ErrorRow[];
}

/**
 * Iterate `models` and call `csFn` per model, capturing per-model failures
 * in `errorRows` instead of aborting. A single transient 429 / network blip
 * on model #4 of 6 used to make the operator see zero rows; now the loop
 * continues and the matrix renders the successful rows + an "## Errors"
 * section identifying which models failed.
 *
 * Pure (no config / IO of its own) — exported for unit tests so callers can
 * assert the partial-failure semantics without spinning up the worker.
 */
export async function collectRowsAndErrors(
  models: readonly string[],
  taskSetHash: string,
  csFn: (slug: string, taskSetHash: string) => Promise<CurrentStateMap>,
): Promise<FetchAllRowsResult> {
  const rows: StateRow[] = [];
  const errorRows: ErrorRow[] = [];
  for (const slug of models) {
    try {
      const state = await csFn(slug, taskSetHash);
      rows.push(...currentStateToRows(slug, taskSetHash, state));
    } catch (err) {
      errorRows.push({
        model_slug: slug,
        error_message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { rows, errorRows };
}

/**
 * Fetch state for every model (or one when --model is set) and flatten the
 * results into a single `StateRow[]` partition-friendly array, plus any
 * per-model fetch failures. Exported for unit tests; production callers go
 * through `handleStatus`.
 */
export async function fetchAllRows(
  flags: StatusFlags,
  deps: FetchAllStateDeps = {},
): Promise<FetchAllRowsResult> {
  const csFn = deps.currentStateFn ?? currentState;
  const listFn = deps.listModelsFn ?? listAllModels;

  const cliFlags: IngestCliFlags = {};
  if (flags.url !== undefined) cliFlags.url = flags.url;
  if (flags.keyPath !== undefined) cliFlags.keyPath = flags.keyPath;
  if (flags.keyId !== undefined) cliFlags.keyId = flags.keyId;
  if (flags.machineId !== undefined) cliFlags.machineId = flags.machineId;
  if (flags.adminKeyPath !== undefined) {
    cliFlags.adminKeyPath = flags.adminKeyPath;
  }
  if (flags.adminKeyId !== undefined) cliFlags.adminKeyId = flags.adminKeyId;

  const config = await loadAdminConfig(Deno.cwd(), cliFlags);
  const adminPriv = await readPrivateKey(config.adminKeyPath);
  const taskSetHash = await resolveTaskSetHash(flags.taskSet);
  const adminKeyId = config.adminKeyId;
  const url = config.url;

  const models = flags.model ? [flags.model] : await listFn(url);

  return await collectRowsAndErrors(
    models,
    taskSetHash,
    (slug, hash) =>
      csFn(slug, hash, {
        url,
        privateKey: adminPriv,
        keyId: adminKeyId,
      }),
  );
}

/**
 * Render the `## Errors` section listing per-model fetch failures + a
 * paste-ready single-model retry command per failure. Returns "" when
 * there are no errors so the caller can unconditionally append.
 *
 * Exported on `__testing__` for unit tests.
 */
function renderErrorSection(errorRows: readonly ErrorRow[]): string {
  if (errorRows.length === 0) return "";
  const lines: string[] = [];
  lines.push("");
  lines.push(colors.bold(colors.red("## Errors")));
  lines.push(
    colors.dim(
      `${errorRows.length} model${errorRows.length === 1 ? "" : "s"} ` +
        `failed to fetch state. Successful rows are rendered above; each ` +
        `failure can be retried singly with the command shown.`,
    ),
  );
  for (const e of errorRows) {
    lines.push(
      `  ${colors.red("[FAIL]")} ${e.model_slug}: ${e.error_message}`,
    );
    lines.push(
      `     ${
        colors.cyan(`centralgauge lifecycle status --model ${e.model_slug}`)
      }`,
    );
  }
  return lines.join("\n");
}

async function handleStatus(flags: StatusFlags): Promise<void> {
  const { rows, errorRows } = await fetchAllRows(flags);
  const { current, legacy } = partitionRows(rows);

  if (flags.json) {
    // --json ALWAYS includes legacy_rows + error_rows regardless of --legacy.
    // Plan G's CI consumers rely on this contract; --legacy controls only
    // the human-readable display below.
    const output: StatusJsonOutput = {
      as_of_ts: Date.now(),
      rows: current,
      legacy_rows: legacy,
      hints: generateHints(current),
      error_rows: errorRows,
    };
    // Self-validate before printing — catches drift between the renderer
    // and the schema. Output that fails to parse never reaches stdout.
    const verified = StatusJsonOutputSchema.parse(output);
    console.log(JSON.stringify(verified, null, 2));
    return;
  }

  console.log(renderMatrix(current, { color: true }));

  const hints = generateHints(current);
  if (hints.length > 0) {
    console.log("");
    console.log(colors.bold("Next actions:"));
    let n = 1;
    for (const h of hints) {
      const sevTag = h.severity === "warn"
        ? colors.yellow("[WARN]")
        : h.severity === "error"
        ? colors.red("[ERR]")
        : colors.cyan("[INFO]");
      console.log(`  ${n}. ${sevTag} ${h.text}`);
      console.log(`     ${colors.cyan(h.command)}`);
      n++;
    }
  }

  if (flags.legacy && legacy.length > 0) {
    console.log("");
    console.log(
      colors.dim(
        `Legacy rows (pre-P6 task_set_hash = "${PRE_P6_TASK_SET_SENTINEL}"):`,
      ),
    );
    console.log(renderMatrix(legacy, { color: true, dim: true }));
  }

  // Per-model partial failures land at the bottom so they don't push the
  // matrix off-screen on small terminals — operators see the data first,
  // then the errors + retry commands.
  const errSection = renderErrorSection(errorRows);
  if (errSection) console.log(errSection);
}

/** Suggested-command echo embedded in every structured `--json` error. */
const RETRY_COMMAND = "centralgauge lifecycle status [--model <slug>]";

/**
 * Writers for {@link emitActionError}. Defaulted to `console.log`/
 * `console.error` in production; tests inject in-memory collectors.
 */
interface ActionErrorWriters {
  writeStdout: (s: string) => void;
  writeStderr: (s: string) => void;
}

/**
 * Format and emit a CLI-action error per the `--json` contract:
 *
 *   --json:        STDOUT receives a {@link StatusJsonError}-shaped JSON
 *                  envelope; stderr stays silent. Consumers piping through
 *                  `jq` can detect the failure by either non-zero exit code
 *                  or the presence of `.error`.
 *   no --json:     STDERR receives the standard `[FAIL] <msg>` line; stdout
 *                  stays silent so any upstream pipe consumer sees an empty
 *                  stream rather than partial garbage.
 *
 * Returns the exit code the action should pass to `Deno.exit`. Pure (no
 * `Deno.exit` of its own) so the helper is unit-testable without process
 * teardown.
 */
function emitActionError(
  err: unknown,
  flags: { json: boolean },
  writers: ActionErrorWriters = {
    writeStdout: (s) => console.log(s),
    writeStderr: (s) => console.error(s),
  },
): number {
  const message = err instanceof Error ? err.message : String(err);
  if (flags.json) {
    const code = err instanceof CentralGaugeError ? err.code : "UNKNOWN_ERROR";
    const envelope: StatusJsonError = {
      error: message,
      code,
      command: RETRY_COMMAND,
    };
    // Self-validate so a future schema rename doesn't silently drift the
    // CI contract.
    const verified = StatusJsonErrorSchema.parse(envelope);
    writers.writeStdout(JSON.stringify(verified, null, 2));
  } else {
    writers.writeStderr(`${colors.red("[FAIL]")} ${message}`);
  }
  return 1;
}

/**
 * Test-only escape hatch. Exposes internals that should NOT be part of the
 * production API surface (e.g. `listAllModels` is a private helper but the
 * unit tests need to assert defensive parsing of the `/api/v1/models`
 * response). Production callers go through `handleStatus` / `fetchAllRows`.
 */
export const __testing__ = {
  listAllModels,
  /**
   * Re-exposed under `__testing__` so unit tests can reach the helper through
   * a single import (`__testing__.collectRowsAndErrors`) — `collectRowsAndErrors`
   * is also exported as a top-level symbol because future cycle/orchestrator
   * code may want to reuse it for batch state pulls.
   */
  collectRowsAndErrors,
  renderErrorSection,
  emitActionError,
};

export function registerStatusCommand(parent: Command): void {
  parent.command(
    "status",
    new Command()
      .description(
        "Per-model lifecycle matrix + next-action hints (--json for CI)",
      )
      .option("--model <slug:string>", "Filter to a single model slug")
      .option(
        "--task-set <hashOrCurrent:string>",
        "Task set hash or 'current' (default)",
        { default: "current" },
      )
      .option(
        "--json",
        "Emit machine-readable JSON validated against StatusJsonOutputSchema",
        { default: false },
      )
      .option(
        "--legacy",
        "Include pre-P6 sentinel rows in a separate display section " +
          "(JSON output always includes them as `legacy_rows` regardless)",
        { default: false },
      )
      .option("--url <url:string>", "Override ingest URL")
      .option("--key-path <path:string>", "Path to ingest signing key")
      .option("--key-id <id:number>", "Ingest key id")
      .option("--machine-id <id:string>", "Machine id override")
      .option("--admin-key-path <path:string>", "Path to admin signing key")
      .option("--admin-key-id <id:number>", "Admin key id")
      .example(
        "Full matrix",
        "centralgauge lifecycle status",
      )
      .example(
        "Filter to one model",
        "centralgauge lifecycle status --model anthropic/claude-opus-4-7",
      )
      .example(
        "CI-friendly output",
        "centralgauge lifecycle status --json | jq '.hints[].command'",
      )
      .example(
        "Show legacy pre-P6 rows",
        "centralgauge lifecycle status --legacy",
      )
      .action(async (flags) => {
        const typedFlags = flags as unknown as StatusFlags;
        try {
          await handleStatus(typedFlags);
        } catch (err) {
          // `--json` must always emit parseable JSON to stdout — CI
          // consumers piping through `jq` previously saw an empty pipe
          // because errors went to stderr regardless of the flag.
          const exitCode = emitActionError(err, { json: typedFlags.json });
          Deno.exit(exitCode);
        }
      }),
  );
}
