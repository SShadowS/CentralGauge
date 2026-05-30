/**
 * Unit tests for buildAucMatrix (Task 11).
 *
 * AUC@2 per-(model, task) scoring semantics (best across runs per task):
 *   1.0  any run passed on attempt 1
 *   0.5  no attempt-1 pass, but some run passed on attempt 2
 *   0.0  never passed within 2 attempts (unattempted task → absent row → 0)
 * Task ordering fixed (task_id ASC); unattempted tasks score 0 so all
 * score vectors share length and alignment.
 *
 * Uses the same miniflare D1 harness as leaderboard.test.ts:
 *   applyD1Migrations, env.DB, seedScaffold, insertRun, insertResult, insertTasks
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applyD1Migrations, env } from 'cloudflare:test';
import { buildAucMatrix } from '../../src/lib/server/tier-data';
import { resetDb } from '../utils/reset-db';

// ---------------------------------------------------------------------------
// Seed helpers (mirror leaderboard.test.ts pattern)
// ---------------------------------------------------------------------------

/** Seed scaffold rows: family, model M (id=1), task_set 'aaaa' (current), settings, machine_key. */
async function seedScaffold(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO model_families(id,slug,vendor,display_name) VALUES (1,'test-fam','TestVendor','Test Family')`,
    ),
    env.DB.prepare(
      `INSERT INTO models(id,family_id,slug,api_model_id,display_name,generation)
       VALUES (1,1,'M','m','Model M',1)`,
    ),
    env.DB.prepare(
      `INSERT INTO task_sets(hash,created_at,task_count,is_current) VALUES ('aaaa','2026-01-01T00:00:00Z',2,1)`,
    ),
    env.DB.prepare(
      `INSERT INTO task_categories(id,slug,name) VALUES (1,'easy','Easy')`,
    ),
    env.DB.prepare(
      `INSERT INTO settings_profiles(hash,temperature,max_attempts) VALUES ('s',0.0,2)`,
    ),
    env.DB.prepare(
      `INSERT INTO cost_snapshots(pricing_version,model_id,input_per_mtoken,output_per_mtoken,effective_from)
       VALUES ('v1',1,1.0,2.0,'2026-01-01')`,
    ),
    env.DB.prepare(
      `INSERT INTO machine_keys(id,machine_id,public_key,scope,created_at) VALUES (1,'rig',?,'ingest','2026-01-01T00:00:00Z')`,
    ).bind(new Uint8Array([0])),
  ]);
}

/** Insert a run row for model 1 in task_set 'aaaa'. */
async function insertRun(runId: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,completed_at,status,tier,pricing_version,ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(
      runId,
      'aaaa',
      1,
      's',
      'rig',
      '2026-04-01T00:00:00Z',
      '2026-04-01T01:00:00Z',
      'completed',
      'claimed',
      'v1',
      'sig',
      '2026-04-01T00:00:00Z',
      1,
      new Uint8Array([0]),
    )
    .run();
}

/** Insert a result row. */
async function insertResult(
  runId: string,
  taskId: string,
  attempt: 1 | 2,
  passed: 0 | 1,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success,tests_total,tests_passed,tokens_in,tokens_out)
     VALUES (?,?,?,?,?,1,1,?,100,50)`,
  )
    .bind(runId, taskId, attempt, passed, passed, passed)
    .run();
}

/** Insert task rows into the 'aaaa' task_set. */
async function insertTasks(taskIds: string[]): Promise<void> {
  for (const taskId of taskIds) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO tasks(task_set_hash,task_id,content_hash,difficulty,category_id,manifest_json)
       VALUES ('aaaa',?,?,?,1,'{}')`,
    )
      .bind(taskId, `hash-${taskId}`, 'easy')
      .run();
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildAucMatrix', () => {
  beforeAll(async () => {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  });

  beforeEach(async () => {
    await resetDb();
    await seedScaffold();
  });

  it('maps attempt-1 pass→1.0, attempt-2-only pass→0.5, unsolved→0 (best across runs)', async () => {
    // Two tasks: t1 passed on attempt 1 (→1.0), t2 failed attempt 1 but passed attempt 2 (→0.5).
    await insertTasks(['t1', 't2']);
    await insertRun('r1');
    await insertResult('r1', 't1', 1, 1); // attempt 1 pass → 1.0
    await insertResult('r1', 't2', 1, 0); // attempt 1 fail
    await insertResult('r1', 't2', 2, 1); // attempt 2 pass → 0.5

    const matrix = await buildAucMatrix(env.DB, { taskSetHash: 'aaaa', metric: 'auc_2' });

    const m = matrix.find((x) => x.slug === 'M');
    expect(m, 'Model M should appear in the matrix').toBeDefined();
    // Scores are aligned by task_id ASC: t1=1.0, t2=0.5
    // Sort to make the assertion order-independent
    expect([...m!.scores].sort((a, b) => a - b)).toEqual([0.5, 1]);
  });

  it('unattempted task scores 0 and is included in the vector', async () => {
    // Three tasks: t1 passed attempt 1, t2 unattempted, t3 passed attempt 1.
    await insertTasks(['t1', 't2', 't3']);
    await insertRun('r1');
    await insertResult('r1', 't1', 1, 1);
    await insertResult('r1', 't3', 1, 1);
    // t2 never attempted → should appear as 0

    const matrix = await buildAucMatrix(env.DB, { taskSetHash: 'aaaa', metric: 'auc_2' });

    const m = matrix.find((x) => x.slug === 'M');
    expect(m).toBeDefined();
    expect(m!.scores).toHaveLength(3);
    // sorted: [0, 1, 1]
    expect([...m!.scores].sort((a, b) => a - b)).toEqual([0, 1, 1]);
  });

  it('best across runs: attempt-1 pass in any run scores 1.0', async () => {
    // Two runs; t1 fails attempt 1 in run r1 but passes attempt 1 in run r2.
    // Best across runs → 1.0.
    await insertTasks(['t1']);
    await insertRun('r1');
    await insertResult('r1', 't1', 1, 0); // fail in r1

    // Insert a second run for the same model.
    await env.DB.prepare(
      `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,completed_at,status,tier,pricing_version,ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload)
       VALUES ('r2','aaaa',1,'s','rig','2026-04-02T00:00:00Z','2026-04-02T01:00:00Z','completed','claimed','v1','sig','2026-04-02T00:00:00Z',1,?)`,
    )
      .bind(new Uint8Array([0]))
      .run();
    await insertResult('r2', 't1', 1, 1); // pass in r2

    const matrix = await buildAucMatrix(env.DB, { taskSetHash: 'aaaa', metric: 'auc_2' });
    const m = matrix.find((x) => x.slug === 'M')!;
    expect(m.scores).toEqual([1]);
  });

  it('returns empty array when no runs exist for the task set', async () => {
    await insertTasks(['t1']);
    // No runs inserted
    const matrix = await buildAucMatrix(env.DB, { taskSetHash: 'aaaa', metric: 'auc_2' });
    expect(matrix).toEqual([]);
  });

  it('task ordering is fixed by task_id ASC', async () => {
    // Insert tasks out of alphabetical order to verify ASC alignment.
    // t-b passed attempt 1, t-a failed attempt 1 passed attempt 2.
    // task_id ASC: t-a (idx 0), t-b (idx 1) → scores should be [0.5, 1.0]
    await insertTasks(['t-b', 't-a']);
    await insertRun('r1');
    await insertResult('r1', 't-a', 1, 0);
    await insertResult('r1', 't-a', 2, 1);
    await insertResult('r1', 't-b', 1, 1);

    const matrix = await buildAucMatrix(env.DB, { taskSetHash: 'aaaa', metric: 'auc_2' });
    const m = matrix.find((x) => x.slug === 'M')!;
    // t-a is index 0 (ASC), t-b is index 1
    expect(m.scores[0]).toBe(0.5); // t-a → attempt-2 only
    expect(m.scores[1]).toBe(1);   // t-b → attempt-1 pass
  });

  it('restricts the matrix to a category when opts.category is set', async () => {
    // Seed a second category: 'tables' (id=2). The existing seedScaffold already
    // inserts category id=1 slug='easy'. We add 'tables' here.
    await env.DB.prepare(
      `INSERT INTO task_categories(id,slug,name) VALUES (2,'tables','Tables')`,
    ).run();

    // Insert tasks: ta1,ta2 belong to category 'easy' (id=1);
    //               tb1 belongs to category 'tables' (id=2).
    await insertTasks(['ta1', 'ta2']); // category_id=1 ('easy')
    await env.DB.prepare(
      `INSERT OR IGNORE INTO tasks(task_set_hash,task_id,content_hash,difficulty,category_id,manifest_json)
       VALUES ('aaaa','tb1','hash-tb1','easy',2,'{}')`,
    ).run();

    // One run: model M passes ta1 (attempt 1) and tb1 (attempt 1); ta2 unattempted.
    await insertRun('r1');
    await insertResult('r1', 'ta1', 1, 1); // 'easy' task → 1.0
    await insertResult('r1', 'tb1', 1, 1); // 'tables' task → 1.0

    // Without category filter: all 3 tasks in vector.
    const matrixAll = await buildAucMatrix(env.DB, { taskSetHash: 'aaaa', metric: 'auc_2' });
    const mAll = matrixAll.find((x) => x.slug === 'M')!;
    expect(mAll.scores).toHaveLength(3);

    // With category='easy': only ta1, ta2 in universe (length 2).
    const matrixEasy = await buildAucMatrix(env.DB, {
      taskSetHash: 'aaaa',
      metric: 'auc_2',
      category: 'easy',
    });
    const mEasy = matrixEasy.find((x) => x.slug === 'M')!;
    expect(mEasy, 'Model M should appear in the easy-category matrix').toBeDefined();
    // Only 2 tasks in 'easy': ta1 and ta2 (task_id ASC)
    expect(mEasy.scores).toHaveLength(2);
    // ta1 passed attempt 1 → 1.0; ta2 unattempted → 0.0; tb1 excluded entirely
    expect(mEasy.scores).toEqual([1, 0]);

    // With category='tables': only tb1 in universe (length 1).
    const matrixTables = await buildAucMatrix(env.DB, {
      taskSetHash: 'aaaa',
      metric: 'auc_2',
      category: 'tables',
    });
    const mTables = matrixTables.find((x) => x.slug === 'M')!;
    expect(mTables, 'Model M should appear in the tables-category matrix').toBeDefined();
    expect(mTables.scores).toHaveLength(1);
    expect(mTables.scores).toEqual([1]);
  });
});
