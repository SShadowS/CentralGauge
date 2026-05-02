/**
 * Weekly cycle orchestrator — invoked by `.github/workflows/weekly-cycle.yml`.
 *
 * Plan G / G2. Runs once per Monday 06:00 UTC:
 *
 *   1. `centralgauge lifecycle status --json` — pulls the per-model state
 *      matrix.
 *   2. {@link selectStaleModels} — picks models whose most-recent
 *      `analysis.completed` under the current task_set is older than 7
 *      days, OR whose `analyze` slot is empty entirely. Legacy
 *      (PRE_P6_TASK_SET_SENTINEL) rows are skipped — those are pre-P6
 *      historical events that no longer drive a cycle.
 *   3. `centralgauge cycle --llms <slug> --analyzer-model
 *      anthropic/claude-opus-4-6 --yes` per stale model. Vendor-prefixed
 *      analyzer per Plan B (never bare `claude-opus-4-6`).
 *   4. Per-model exit codes captured; `weekly-cycle-result.json` written
 *      for the digest step.
 *   5. Exit 0 iff every cycle succeeded; otherwise exit 1 so the workflow
 *      step ends `failure` and the sticky issue stays open.
 *
 * Failure isolation: one model's failure does NOT abort the loop. The
 * orchestrator captures the exit code and proceeds to the next model.
 * The plan-level rationale: a partial week is better than no week.
 *
 * @module scripts/weekly-cycle
 */
import * as colors from "@std/fmt/colors";
import {
  type ErrorRow,
  type StateRow,
  type StatusJsonOutput,
  StatusJsonOutputSchema,
} from "../src/lifecycle/status-types.ts";
import { PRE_P6_TASK_SET_SENTINEL } from "../src/lifecycle/types.ts";
import { CentralGaugeError } from "../src/errors.ts";

export interface SelectArgs {
  /** Wall-clock for staleness comparison; injectable for tests. */
  now: number;
  /** Threshold in ms; older `analyze.last_ts` rows count as stale. */
  staleAfterMs: number;
}

/**
 * Distil the (model, task_set, step) flat row list into a per-model view
 * keyed by step. The status command returns one row per (model, task_set,
 * step) triple; this groups them by model_slug for the staleness check.
 */
function indexByModel(
  rows: readonly StateRow[],
): Map<string, Map<string, StateRow>> {
  const out = new Map<string, Map<string, StateRow>>();
  for (const r of rows) {
    if (r.task_set_hash === PRE_P6_TASK_SET_SENTINEL) continue;
    const slot = out.get(r.model_slug) ?? new Map<string, StateRow>();
    slot.set(r.step, r);
    out.set(r.model_slug, slot);
  }
  return out;
}

/**
 * Select models that need a cycle this week. A model is stale when:
 *
 *   - No `analyze` row exists for the current task_set (cycle pushes it
 *     through), OR
 *   - The `analyze` row's `last_ts` is older than `staleAfterMs`.
 *
 * Models that only appear in `error_rows` (status fetch failed) are
 * also returned as stale — the cycle attempt will either surface its own
 * failure event or recover. Excluding them would mean a transient 429 on
 * status hides a model from the weekly cycle entirely.
 *
 * Returns a sorted unique list of `model_slug`s for deterministic CI
 * output.
 */
export function selectStaleModels(
  status: StatusJsonOutput,
  args: SelectArgs,
): string[] {
  const indexed = indexByModel(status.rows);
  const stale = new Set<string>();

  // Models whose status was fetched OK — apply the staleness check.
  for (const [slug, steps] of indexed) {
    const analyze = steps.get("analyze");
    if (!analyze) {
      // Never analysed under the current task set → stale.
      stale.add(slug);
      continue;
    }
    if ((args.now - analyze.last_ts) > args.staleAfterMs) {
      stale.add(slug);
    }
  }

  // Models whose status fetch failed → assume stale, let the cycle
  // surface the underlying problem.
  for (const e of status.error_rows ?? []) {
    stale.add(e.model_slug);
  }

  // Also catch models that appear only as `error_rows` shape but aren't
  // already in `stale` from the rows-level pass. The above loop handles
  // both cases; this is just a defensive comment for future readers.
  const _unused: ErrorRow[] = status.error_rows ?? [];
  void _unused;

  return [...stale].sort();
}

export interface CycleOutcome {
  model_slug: string;
  exit_code: number;
  duration_ms: number;
}

/**
 * Compute the workflow exit code from the per-model outcomes. Pure helper
 * extracted from the `import.meta.main` block so the failure-escalation
 * branch can be exercised without spinning up subprocesses.
 *
 * Returns 0 iff every cycle exited 0; otherwise 1 so the workflow's
 * "Run weekly cycle orchestrator" step reports `failure` and the sticky
 * digest issue stays open per Plan G's escalation contract.
 */
export function computeExitCode(results: readonly CycleOutcome[]): number {
  return results.some((r) => r.exit_code !== 0) ? 1 : 0;
}

/**
 * Summarise the per-model outcomes into the JSON shape the digest step
 * reads. Pure helper; unit-tested.
 */
export function summariseResults(
  results: readonly CycleOutcome[],
  ranAt: string,
): {
  ran_at: string;
  total: number;
  succeeded: number;
  failed: number;
  results: CycleOutcome[];
} {
  return {
    ran_at: ranAt,
    total: results.length,
    succeeded: results.filter((r) => r.exit_code === 0).length,
    failed: results.filter((r) => r.exit_code !== 0).length,
    results: [...results],
  };
}

async function runCycle(modelSlug: string): Promise<CycleOutcome> {
  const start = Date.now();
  const cmd = new Deno.Command("deno", {
    args: [
      "task",
      "start",
      "cycle",
      "--llms",
      modelSlug,
      "--analyzer-model",
      "anthropic/claude-opus-4-6",
      "--yes",
    ],
    stdout: "inherit",
    stderr: "inherit",
  });
  const { code } = await cmd.output();
  return {
    model_slug: modelSlug,
    exit_code: code,
    duration_ms: Date.now() - start,
  };
}

/**
 * Parse + validate the raw stdout from `lifecycle status --json` against
 * {@link StatusJsonOutputSchema} (Plan H's wire contract).
 *
 * Pure function — no I/O — so the failure path can be unit-tested without
 * subprocess plumbing. A future schema rename in `lifecycle status --json`
 * (e.g. `rows` → `state_rows`) would otherwise silently feed `undefined`
 * into {@link selectStaleModels} → every model skipped → "all clear"
 * digest with a real backlog hidden underneath. The zod parse short-circuits
 * that failure mode at the orchestrator boundary.
 *
 * @throws {CentralGaugeError} code `INVALID_STATUS_OUTPUT` with `zodIssues`
 *   (or `parseError`) on `context` for triage.
 */
export function parseStatusJson(raw: string): StatusJsonOutput {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (parseError) {
    throw new CentralGaugeError(
      "lifecycle status --json output is not valid JSON",
      "INVALID_STATUS_OUTPUT",
      {
        parseError: parseError instanceof Error
          ? parseError.message
          : String(parseError),
        rawSample: raw.slice(0, 500),
      },
    );
  }
  const result = StatusJsonOutputSchema.safeParse(json);
  if (!result.success) {
    throw new CentralGaugeError(
      "lifecycle status --json payload failed schema validation",
      "INVALID_STATUS_OUTPUT",
      {
        zodIssues: result.error.issues,
      },
    );
  }
  return result.data;
}

async function readStatusJson(): Promise<StatusJsonOutput> {
  const cmd = new Deno.Command("deno", {
    args: ["task", "start", "lifecycle", "status", "--json"],
    stdout: "piped",
    stderr: "inherit",
  });
  const { code, stdout } = await cmd.output();
  if (code !== 0) {
    throw new Error(`lifecycle status --json exited with code ${code}`);
  }
  return parseStatusJson(new TextDecoder().decode(stdout));
}

if (import.meta.main) {
  const status = await readStatusJson();
  const stale = selectStaleModels(status, {
    now: Date.now(),
    staleAfterMs: 7 * 86_400_000,
  });

  console.log(colors.cyan(`[weekly-cycle] ${stale.length} stale model(s):`));
  for (const m of stale) console.log(`  - ${m}`);

  const results: CycleOutcome[] = [];
  for (const slug of stale) {
    console.log(colors.cyan(`[weekly-cycle] cycling ${slug}...`));
    try {
      const r = await runCycle(slug);
      results.push(r);
      if (r.exit_code === 0) {
        console.log(
          colors.green(
            `[OK] ${slug} (${(r.duration_ms / 1000).toFixed(0)}s)`,
          ),
        );
      } else {
        console.log(
          colors.red(`[FAIL] ${slug} exit ${r.exit_code}`),
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(colors.red(`[FAIL] ${slug} ${msg}`));
      results.push({ model_slug: slug, exit_code: 99, duration_ms: 0 });
    }
  }

  await Deno.writeTextFile(
    "weekly-cycle-result.json",
    JSON.stringify(
      summariseResults(results, new Date().toISOString()),
      null,
      2,
    ),
  );

  Deno.exit(computeExitCode(results));
}
