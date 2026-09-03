import type { RequestHandler } from "./$types";
import { ApiError, errorResponse } from "$lib/server/errors";
import { resolveV2Context, v2Json } from "$lib/server/v2-context";
import { getAll, getFirst } from "$lib/server/db";
import { toRunV2Summary } from "$lib/server/runs-v2";
import type { RunV2Detail } from "$lib/shared/api-types";

interface RunV2DetailRow {
  id: string;
  started_at: string;
  completed_at: string | null;
  status: string;
  harness_fingerprint: string | null;
  retry_path_version: string | null;
  environment_digest: string | null;
  test_runner: "soap" | "legacy" | null;
  settings_hash: string;
  invocation_json: string | null;
  bc_artifact: string | null;
  container_image_digest: string | null;
  bcch_version: string | null;
  prompt_template_digest: string | null;
  model_slug: string;
  model_display: string;
  family_slug: string;
}

interface ResultV2Row {
  task_id: string;
  attempt: number;
  passed: number;
  score: number;
  termination_kind: string | null;
  cap_reached: number | null;
  infra_retries: number | null;
  fallback_chain_json: string | null;
  prompt_digest: string | null;
  candidate_digest: string | null;
  test_vector_json: string | null;
}

/**
 * `GET /api/v2/runs/[id]` — everything `/api/v2/runs`'s summary row carries
 * for this run, plus its settings hash, invocation record, environment
 * manifest fields and per-attempt results (including the run-time capture
 * fields from Task 8). 404 `no_run` when `id` isn't a run on the resolved
 * (task set, taxonomy revision) pair — same "scoped to one set" shape as
 * `/api/v2/tasks/[...id]`.
 */
export const GET: RequestHandler = async ({
  request,
  url,
  platform,
  params,
}) => {
  try {
    const db = platform!.env.DB;
    const ctx = await resolveV2Context(db, url);

    const run = await getFirst<RunV2DetailRow>(
      db,
      `SELECT runs.id, runs.started_at, runs.completed_at, runs.status,
              runs.harness_fingerprint, runs.retry_path_version, runs.environment_digest,
              runs.test_runner, runs.settings_hash, runs.invocation_json,
              runs.bc_artifact, runs.container_image_digest, runs.bcch_version,
              runs.prompt_template_digest,
              m.slug AS model_slug, m.display_name AS model_display,
              mf.slug AS family_slug
       FROM runs
       JOIN models m ON m.id = runs.model_id
       JOIN model_families mf ON mf.id = m.family_id
       WHERE runs.id = ? AND runs.task_set_hash = ?`,
      [params.id!, ctx.task_set_hash],
    );
    if (!run) {
      throw new ApiError(
        404,
        "no_run",
        `no run ${params.id} in this set/revision`,
      );
    }

    const resultRows = await getAll<ResultV2Row>(
      db,
      `SELECT task_id, attempt, passed, score, termination_kind, cap_reached,
              infra_retries, fallback_chain_json, prompt_digest, candidate_digest,
              test_vector_json
       FROM results
       WHERE run_id = ?
       ORDER BY task_id, attempt`,
      [run.id],
    );

    const body: RunV2Detail = {
      ...toRunV2Summary(run),
      settings_hash: run.settings_hash,
      invocation: run.invocation_json ? JSON.parse(run.invocation_json) : null,
      environment: {
        bc_artifact: run.bc_artifact ?? null,
        container_image_digest: run.container_image_digest ?? null,
        bcch_version: run.bcch_version ?? null,
        prompt_template_digest: run.prompt_template_digest ?? null,
      },
      results: resultRows.map((r) => ({
        task_id: r.task_id,
        attempt: r.attempt,
        passed: r.passed === 1,
        score: r.score,
        termination_kind: r.termination_kind ?? null,
        cap_reached:
          r.cap_reached === null || r.cap_reached === undefined
            ? null
            : r.cap_reached === 1,
        infra_retries: r.infra_retries ?? null,
        fallback_chain: r.fallback_chain_json
          ? JSON.parse(r.fallback_chain_json)
          : null,
        prompt_digest: r.prompt_digest ?? null,
        candidate_digest: r.candidate_digest ?? null,
        test_vector: r.test_vector_json ? JSON.parse(r.test_vector_json) : null,
      })),
    };

    return v2Json(request, ctx, body as unknown as Record<string, unknown>);
  } catch (err) {
    return errorResponse(err);
  }
};
