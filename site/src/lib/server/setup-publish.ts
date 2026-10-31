import { appendAuditStmt } from "$lib/server/audit";
import { forceBumpDataEpochStmt } from "$lib/server/data-epoch";
import { ApiError, jsonResponse } from "$lib/server/errors";
import {
  deleteSubmissionKeyStmts,
  getSubmission,
} from "$lib/server/setup-submissions";
import { validatePublishPayload } from "$lib/shared/setup-publish";

// D1 allows 100 bound parameters per statement.
const CELL_CHUNK = 15; // 6 params each
const TASK_CHUNK = 30; // 3 params each

function chunks<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

export async function promoteSetupTaskSet(
  db: D1Database,
  actor: string,
  args: unknown,
): Promise<Response> {
  const hash = (args as { hash?: unknown } | null)?.hash;
  if (typeof hash !== "string" || !/^[0-9a-f]{64}$/.test(hash)) {
    throw new ApiError(400, "invalid_hash", "hash must be 64 hex characters");
  }
  if (
    !(await db.prepare("SELECT 1 AS x FROM setup_task_sets WHERE hash = ?")
      .bind(hash).first())
  ) {
    throw new ApiError(404, "not_found", "setup task set not found");
  }
  const now = new Date().toISOString();
  await db.batch([
    db.prepare("UPDATE setup_task_sets SET is_current = 0 WHERE is_current = 1"),
    db.prepare(
      "UPDATE setup_task_sets SET is_current = 1, promoted_at = ? WHERE hash = ?",
    ).bind(now, hash),
    appendAuditStmt(db, {
      event: "setup_task_set.promoted",
      taskSetHash: hash,
      details: { actor },
    }),
    forceBumpDataEpochStmt(db),
  ]);
  return jsonResponse({ hash, promoted_at: now }, 200, {
    "Cache-Control": "no-store",
  });
}

export async function publishSetupRun(
  db: D1Database,
  actor: string,
  args: unknown,
): Promise<Response> {
  const v = validatePublishPayload(args);
  if (!v.ok) {
    throw new ApiError(400, "invalid_publish", "payload is invalid", v.errors);
  }
  const { setup, submission_id, task_set, run } = v.value;

  if (
    await db.prepare("SELECT 1 AS x FROM setup_runs WHERE id = ?").bind(run.id)
      .first()
  ) {
    throw new ApiError(409, "already_published", "this run is already published");
  }

  let description = setup.description ?? "";
  let visibility = setup.visibility ?? "public";
  let rolesJson = JSON.stringify(setup.roles);
  let flow: string | null = null;
  let needsKey = 0;
  if (submission_id !== null) {
    const sub = await getSubmission(db, submission_id);
    if (!sub) throw new ApiError(404, "not_found", "submission not found");
    if (sub.status !== "approved") {
      throw new ApiError(
        409,
        "submission_not_approved",
        "submission is not approved",
      );
    }
    description = sub.description;
    visibility = sub.visibility;
    rolesJson = sub.roles_json;
    flow = sub.flow;
    // "The submission ever supplied a key": the key is deleted when a run finishes.
    needsKey = sub.key_ciphertext !== null || sub.key_deleted_at !== null
      ? 1
      : 0;
  } else if (
    await db.prepare("SELECT 1 AS x FROM setup_submissions WHERE setup_id = ?")
      .bind(setup.id).first()
  ) {
    throw new ApiError(
      409,
      "submission_linked",
      "this setup came from a submission; publish with its submission_id",
    );
  }

  const now = new Date().toISOString();
  const stmts: D1PreparedStatement[] = [
    db.prepare(
      `INSERT OR IGNORE INTO setup_task_sets (hash, display_name, task_count, is_current, created_at)
       VALUES (?,?,?,0,?)`,
    ).bind(task_set.hash, task_set.display_name, task_set.tasks.length, now),
  ];
  for (const c of chunks(task_set.tasks, TASK_CHUNK)) {
    stmts.push(
      db.prepare(
        `INSERT OR IGNORE INTO hx_tasks (task_set_hash, task_id, description_sha) VALUES ${
          c.map(() => "(?,?,?)").join(",")
        }`,
      ).bind(...c.flatMap((t) => [task_set.hash, t.task_id, t.description_sha])),
    );
  }
  stmts.push(
    db.prepare(
      `INSERT INTO setups (id, description, agent_tool, base_model, visibility, needs_key,
         roles_json, flow, ingredients_json, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET description = excluded.description,
         agent_tool = excluded.agent_tool, base_model = excluded.base_model,
         visibility = excluded.visibility,
         needs_key = MAX(setups.needs_key, excluded.needs_key),
         roles_json = excluded.roles_json, flow = excluded.flow,
         ingredients_json = excluded.ingredients_json`,
    ).bind(
      setup.id,
      description,
      setup.agent_tool,
      setup.base_model,
      visibility,
      needsKey,
      rolesJson,
      flow,
      JSON.stringify(setup.ingredients),
      now,
    ),
    db.prepare(
      `INSERT INTO setup_runs (id, setup_id, task_set_hash, tool_version, published_at, score,
         cost_per_solved_usd, price_note, excluded_cells) VALUES (?,?,?,?,?,?,?,?,?)`,
    ).bind(
      run.id,
      setup.id,
      task_set.hash,
      run.tool_version,
      now,
      run.score,
      run.cost_per_solved_usd,
      run.price_note,
      run.excluded_cells,
    ),
  );
  for (const c of chunks(run.cells, CELL_CHUNK)) {
    stmts.push(
      db.prepare(
        `INSERT INTO setup_cells (run_id, task_id, repeat, outcome, cost_usd, duration_ms) VALUES ${
          c.map(() => "(?,?,?,?,?,?)").join(",")
        }`,
      ).bind(
        ...c.flatMap((x) => [
          run.id,
          x.task_id,
          x.repeat,
          x.outcome,
          x.cost_usd,
          x.duration_ms,
        ]),
      ),
    );
  }
  if (submission_id !== null) {
    stmts.push(
      db.prepare("UPDATE setup_submissions SET setup_id = ? WHERE id = ?").bind(
        setup.id,
        submission_id,
      ),
      ...deleteSubmissionKeyStmts(db, submission_id, actor, now),
    );
  }
  stmts.push(
    appendAuditStmt(db, {
      event: "setup.published",
      taskSetHash: task_set.hash,
      details: {
        actor,
        setup_id: setup.id,
        run_id: run.id,
        submission_id,
        cells: run.cells.length,
      },
    }),
    forceBumpDataEpochStmt(db),
  );
  await db.batch(stmts);
  return jsonResponse(
    { run_id: run.id, setup_id: setup.id, task_set_hash: task_set.hash },
    201,
    { "Cache-Control": "no-store" },
  );
}
