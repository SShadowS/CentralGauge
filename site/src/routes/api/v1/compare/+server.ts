import type { RequestHandler } from "./$types";
import { cachedJson } from "$lib/server/cache";
import { getAll, getFirst } from "$lib/server/db";
import { ApiError, errorResponse } from "$lib/server/errors";
import { computeDenominator } from "$lib/server/denominator";

export const GET: RequestHandler = async ({ request, url, platform }) => {
  const env = platform!.env;
  try {
    const parsed = (url.searchParams.get("models") ?? "").split(",").map((s) =>
      s.trim()
    ).filter(Boolean);
    // Dedup explicitly: request-order matters for response stability, so keep first occurrence.
    const seen = new Set<string>();
    const raw: string[] = [];
    for (const s of parsed) {
      if (!seen.has(s)) {
        seen.add(s);
        raw.push(s);
      }
    }
    if (raw.length < 2) {
      throw new ApiError(
        400,
        "too_few_models",
        "At least 2 distinct models required",
      );
    }
    if (raw.length > 4) {
      throw new ApiError(400, "too_many_models", "At most 4 models allowed");
    }

    // Resolve the current task set once at the top for denominator math and
    // CR-5: every numerator subquery must filter by this exact hash to prevent
    // cross-set bleed that would push pass_at_n > 1.0.
    const currentSet = await getFirst<{ hash: string; task_count: number }>(
      env.DB,
      `SELECT hash, task_count FROM task_sets WHERE is_current = 1 LIMIT 1`,
      [],
    );

    const taskSetHash = currentSet?.hash ?? null;

    // Pre-compute the strict denominator. When no current set exists,
    // denominator is 0 and all pass rates are null.
    const denominator = taskSetHash
      ? await computeDenominator(env.DB, {
          taskSetHash,
          precomputedTaskCount: currentSet!.task_count,
        })
      : 0;

    const placeholders = raw.map(() => "?").join(",");
    const models = await getAll<
      { id: number; slug: string; display_name: string }
    >(
      env.DB,
      `SELECT id, slug, display_name FROM models WHERE slug IN (${placeholders})`,
      raw,
    );
    if (models.length !== raw.length) {
      throw new ApiError(
        404,
        "model_not_found",
        `Unknown model(s): ${
          raw.filter((s) => !models.some((m) => m.slug === s)).join(",")
        }`,
      );
    }

    // Compute strict pass_at_n numerators per model, scoped to the current
    // task set hash (CR-5: explicit hash filter on every subquery prevents
    // cross-set bleed when a model has runs in multiple task sets).
    type PassRow = {
      model_id: number;
      tasks_passed_attempt_1: number | string | null;
      tasks_passed_attempt_2_only: number | string | null;
      tasks_attempted_distinct: number | string | null;
    };

    let passRows: PassRow[] = [];
    if (taskSetHash && models.length > 0) {
      const modelIdPlaceholders = models.map(() => "?").join(",");
      const modelIds = models.map((m) => m.id);

      // p1: distinct tasks where attempt=1 passed, scoped to current task set.
      // p2_only: distinct tasks where attempt=2 passed and no attempt=1 passed,
      //          scoped to current task set.
      // Both use explicit hash filters (CR-5) so runs from other task sets
      // cannot inflate the numerator beyond the denominator.
      passRows = await getAll<PassRow>(
        env.DB,
        `
        WITH current_hash AS (SELECT ? AS hash),
        p1 AS (
          SELECT ru1.model_id,
                 COUNT(DISTINCT r1.task_id) AS tasks_passed_attempt_1
          FROM results r1
          JOIN runs ru1 ON ru1.id = r1.run_id
          JOIN current_hash ON ru1.task_set_hash = current_hash.hash
          WHERE r1.attempt = 1 AND r1.passed = 1
            AND ru1.model_id IN (${modelIdPlaceholders})
          GROUP BY ru1.model_id
        ),
        p2_only AS (
          SELECT ru2.model_id,
                 COUNT(DISTINCT r2.task_id) AS tasks_passed_attempt_2_only
          FROM results r2
          JOIN runs ru2 ON ru2.id = r2.run_id
          JOIN current_hash ON ru2.task_set_hash = current_hash.hash
          WHERE r2.attempt = 2 AND r2.passed = 1
            AND ru2.model_id IN (${modelIdPlaceholders})
            AND NOT EXISTS (
              SELECT 1 FROM results r1b
              JOIN runs ru1b ON ru1b.id = r1b.run_id
              JOIN current_hash cs1b ON ru1b.task_set_hash = cs1b.hash
              WHERE ru1b.model_id = ru2.model_id
                AND r1b.task_id = r2.task_id
                AND r1b.attempt = 1 AND r1b.passed = 1
            )
          GROUP BY ru2.model_id
        ),
        attempted AS (
          SELECT runs.model_id,
                 COUNT(DISTINCT r.task_id) AS tasks_attempted_distinct
          FROM runs
          JOIN results r ON r.run_id = runs.id
          JOIN current_hash ON runs.task_set_hash = current_hash.hash
          WHERE runs.model_id IN (${modelIdPlaceholders})
          GROUP BY runs.model_id
        )
        SELECT m.id AS model_id,
               COALESCE(p1.tasks_passed_attempt_1, 0) AS tasks_passed_attempt_1,
               COALESCE(p2_only.tasks_passed_attempt_2_only, 0) AS tasks_passed_attempt_2_only,
               COALESCE(att.tasks_attempted_distinct, 0) AS tasks_attempted_distinct
        FROM models m
        LEFT JOIN p1 ON p1.model_id = m.id
        LEFT JOIN p2_only ON p2_only.model_id = m.id
        LEFT JOIN attempted att ON att.model_id = m.id
        WHERE m.id IN (${modelIdPlaceholders})
        `,
        [taskSetHash, ...modelIds, ...modelIds, ...modelIds, ...modelIds],
      );
    }

    // Build a lookup map from model_id to pass numerators.
    const passMap = new Map<number, PassRow>();
    for (const row of passRows) {
      passMap.set(row.model_id, row);
    }

    // Scope results to the current task set so cross-set bleed cannot occur
    // in the per-task score comparison either. Models without runs in the
    // current task set will have no rows — the byTask map will emit null for
    // their scores on each task.
    const rows = await getAll<{
      task_id: string;
      model_slug: string;
      avg_score: number | string | null;
      runs: number;
    }>(
      env.DB,
      taskSetHash
        ? `SELECT r.task_id, m.slug AS model_slug, AVG(r.score) AS avg_score, COUNT(DISTINCT runs.id) AS runs
           FROM results r
           JOIN runs ON runs.id = r.run_id
           JOIN models m ON m.id = runs.model_id
           WHERE m.slug IN (${placeholders})
             AND runs.task_set_hash = ?
           GROUP BY r.task_id, m.id
           ORDER BY r.task_id, m.id`
        : `SELECT r.task_id, m.slug AS model_slug, AVG(r.score) AS avg_score, COUNT(DISTINCT runs.id) AS runs
           FROM results r
           JOIN runs ON runs.id = r.run_id
           JOIN models m ON m.id = runs.model_id
           WHERE m.slug IN (${placeholders})
           GROUP BY r.task_id, m.id
           ORDER BY r.task_id, m.id`,
      taskSetHash ? [...raw, taskSetHash] : raw,
    );

    const byTask = new Map<string, Record<string, number | null>>();
    for (const r of rows) {
      if (!byTask.has(r.task_id)) byTask.set(r.task_id, {});
      byTask.get(r.task_id)![r.model_slug] = r.avg_score == null
        ? null
        : Number((+r.avg_score).toFixed(6));
    }

    const tasks = Array.from(byTask.entries()).map(([task_id, scores]) => {
      const values = Object.values(scores).filter((v): v is number =>
        v != null
      );
      const divergent = values.length > 1 &&
        Math.max(...values) - Math.min(...values) > 0.01;
      return { task_id, scores, divergent };
    });

    const enrichedModels = models.map((m) => {
      const pass = passMap.get(m.id);
      const hasRuns = pass !== undefined;
      const p1 = hasRuns ? Number(pass.tasks_passed_attempt_1 ?? 0) : 0;
      const p2Only = hasRuns
        ? Number(pass.tasks_passed_attempt_2_only ?? 0)
        : 0;
      const attempted = hasRuns
        ? Number(pass.tasks_attempted_distinct ?? 0)
        : 0;

      const passAtNStrict =
        hasRuns && denominator > 0 ? (p1 + p2Only) / denominator : null;
      const passAt1Strict =
        hasRuns && denominator > 0 ? p1 / denominator : null;
      const passAtNPerAttempted =
        hasRuns && attempted > 0 ? (p1 + p2Only) / attempted : null;

      return {
        id: m.id,
        slug: m.slug,
        display_name: m.display_name,
        pass_at_n:
          passAtNStrict === null
            ? null
            : Math.round(passAtNStrict * 1e6) / 1e6,
        pass_at_1:
          passAt1Strict === null
            ? null
            : Math.round(passAt1Strict * 1e6) / 1e6,
        denominator: hasRuns ? (denominator > 0 ? denominator : null) : null,
        pass_at_n_per_attempted:
          passAtNPerAttempted === null
            ? null
            : Math.round(passAtNPerAttempted * 1e6) / 1e6,
      };
    });

    return cachedJson(request, { models: enrichedModels, tasks });
  } catch (err) {
    return errorResponse(err);
  }
};
