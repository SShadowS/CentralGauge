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

    // Idempotent: if task set exists, return 200; else insert and return 201
    const existing = await db.prepare(`SELECT hash FROM task_sets WHERE hash = ?`).bind(payload.hash).first();
    if (existing) {
      return jsonResponse({ hash: payload.hash, task_count: payload.task_count, status: 'exists' }, 200);
    }

    const statements: ReturnType<typeof db.prepare>[] = [
      db
        .prepare(`INSERT INTO task_sets(hash, created_at, task_count) VALUES (?,?,?)`)
        .bind(payload.hash, payload.created_at, payload.task_count)
    ];

    for (const task of payload.tasks) {
      statements.push(
        db
          .prepare(`INSERT OR IGNORE INTO task_categories(slug, name) VALUES (?, ?)`)
          .bind(task.category_slug, task.category_slug)
      );
    }

    await db.batch(statements);

    // Resolve category_ids and insert tasks
    const taskStatements: ReturnType<typeof db.prepare>[] = [];
    for (const task of payload.tasks) {
      taskStatements.push(
        db
          .prepare(
            `INSERT INTO tasks(task_set_hash, task_id, content_hash, difficulty, category_id, manifest_json)
             VALUES (?, ?, ?, ?, (SELECT id FROM task_categories WHERE slug = ?), ?)`
          )
          .bind(
            payload.hash,
            task.task_id,
            task.content_hash,
            task.difficulty,
            task.category_slug,
            JSON.stringify(task.manifest)
          )
      );
    }
    if (taskStatements.length > 0) {
      await db.batch(taskStatements);
    }

    return jsonResponse({ hash: payload.hash, task_count: payload.task_count, status: 'created' }, 201);
  } catch (err) {
    return errorResponse(err);
  }
};
