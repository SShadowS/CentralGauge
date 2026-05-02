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
} from "../src/lifecycle/status-types.ts";
import { PRE_P6_TASK_SET_SENTINEL } from "../src/lifecycle/types.ts";

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

interface CycleOutcome {
  model_slug: string;
  exit_code: number;
  duration_ms: number;
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
  return JSON.parse(new TextDecoder().decode(stdout)) as StatusJsonOutput;
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
      {
        ran_at: new Date().toISOString(),
        total: results.length,
        succeeded: results.filter((r) => r.exit_code === 0).length,
        failed: results.filter((r) => r.exit_code !== 0).length,
        results,
      },
      null,
      2,
    ),
  );

  const anyFailed = results.some((r) => r.exit_code !== 0);
  Deno.exit(anyFailed ? 1 : 0);
}
