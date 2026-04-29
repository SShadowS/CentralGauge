import type { RequestHandler } from './$types';
import { verifySignedRequest } from '$lib/server/signature';
import { ApiError, errorResponse, jsonResponse } from '$lib/server/errors';

interface TaskSetPayload {
  hash: string;
  created_at: string;
  task_count: number;
  tasks: Array<{
    task_id: string;
    content_hash: string;
    difficulty: 'easy' | 'medium' | 'hard';
    category_slug: string;
    manifest: unknown;
  }>;
}

export const POST: RequestHandler = async ({ request, platform }) => {
  if (!platform) return errorResponse(new ApiError(500, 'no_platform', 'Cloudflare platform not available'));
  const db = platform.env.DB;

  try {
    const signed = (await request.json()) as {
      payload: TaskSetPayload;
      signature: { alg: 'Ed25519'; key_id: number; signed_at: string; value: string };
      run_id?: string;
      version?: number;
    };
    if (!signed.signature) throw new ApiError(400, 'missing_signature', 'signature block required');
    const payload = signed.payload;
    if (!payload?.hash) throw new ApiError(400, 'bad_payload', 'payload.hash required');

    await verifySignedRequest(
      db,
      signed as unknown as { signature: { alg: 'Ed25519'; key_id: number; signed_at: string; value: string }; payload: Record<string, unknown> },
      'ingest'
    );

    // Idempotent on (task_set_hash + tasks-populated). Three states:
    //   1. task_set + tasks fully present → 200 status:'exists', skip
    //   2. task_set present but tasks missing/incomplete → 200 status:'backfilled', insert tasks only
    //   3. task_set absent → 201 status:'created', insert task_set + tasks
    const existing = await db
      .prepare(`SELECT hash FROM task_sets WHERE hash = ?`)
      .bind(payload.hash)
      .first();
    const taskCountRow = await db
      .prepare(`SELECT COUNT(*) AS c FROM tasks WHERE task_set_hash = ?`)
      .bind(payload.hash)
      .first<{ c: number }>();
    const existingTaskRows = taskCountRow?.c ?? 0;
    if (existing && existingTaskRows >= payload.task_count) {
      return jsonResponse(
        { hash: payload.hash, task_count: payload.task_count, status: 'exists' },
        200,
      );
    }

    const setupStatements: ReturnType<typeof db.prepare>[] = [];
    if (!existing) {
      setupStatements.push(
        db
          .prepare(`INSERT INTO task_sets(hash, created_at, task_count) VALUES (?,?,?)`)
          .bind(payload.hash, payload.created_at, payload.task_count),
      );
    }

    for (const task of payload.tasks) {
      setupStatements.push(
        db
          .prepare(`INSERT OR IGNORE INTO task_categories(slug, name) VALUES (?, ?)`)
          .bind(task.category_slug, task.category_slug),
      );
    }

    if (setupStatements.length > 0) await db.batch(setupStatements);

    // Insert tasks with INSERT OR IGNORE so partial backfills are safe to
    // retry (tasks table has PRIMARY KEY (task_set_hash, task_id) per schema).
    const taskStatements: ReturnType<typeof db.prepare>[] = [];
    for (const task of payload.tasks) {
      taskStatements.push(
        db
          .prepare(
            `INSERT OR IGNORE INTO tasks(task_set_hash, task_id, content_hash, difficulty, category_id, manifest_json)
             VALUES (?, ?, ?, ?, (SELECT id FROM task_categories WHERE slug = ?), ?)`,
          )
          .bind(
            payload.hash,
            task.task_id,
            task.content_hash,
            task.difficulty,
            task.category_slug,
            JSON.stringify(task.manifest),
          ),
      );
    }
    if (taskStatements.length > 0) {
      // D1 batch limit is ~50 statements/batch; chunk for safety on 64+ tasks.
      const CHUNK = 40;
      for (let i = 0; i < taskStatements.length; i += CHUNK) {
        await db.batch(taskStatements.slice(i, i + CHUNK));
      }
    }

    const status = existing ? 'backfilled' : 'created';
    const httpStatus = existing ? 200 : 201;
    return jsonResponse(
      { hash: payload.hash, task_count: payload.task_count, status },
      httpStatus,
    );
  } catch (err) {
    return errorResponse(err);
  }
};
