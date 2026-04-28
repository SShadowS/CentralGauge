import { env } from 'cloudflare:test';

export { resetDb } from './reset-db';

interface Concept {
  al_concept: string;
  occurrences: number;
}

interface SeedShortcomingsOpts {
  models?: string[];
  concepts?: Concept[];
}

/**
 * Seed shortcomings + occurrences across multiple models so the /api/v1/shortcomings
 * GET endpoint has data to aggregate. Inserts the model_families, models,
 * task_sets, settings_profiles, runs and results scaffolding required for FK
 * constraints, then the shortcoming + occurrence rows themselves.
 *
 * Default fixture: 2 models, 2 concepts (one shared across both models).
 */
export async function seedShortcomingsAcrossModels(opts: SeedShortcomingsOpts = {}): Promise<void> {
  const models = opts.models ?? ['claude-sonnet-4', 'gpt-4o'];
  const concepts = opts.concepts ?? [
    { al_concept: 'Missing semicolon', occurrences: 3 },
    { al_concept: 'Wrong DataItem', occurrences: 1 },
  ];

  // 1. Family + models + supporting catalog rows.
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO model_families(id,slug,vendor,display_name) VALUES (1,'claude','anthropic','Claude'),(2,'gpt','openai','GPT')`,
    ),
    env.DB.prepare(
      `INSERT INTO task_sets(hash,created_at,task_count,is_current) VALUES ('ts','2026-01-01T00:00:00Z',2,1)`,
    ),
    env.DB.prepare(
      `INSERT INTO settings_profiles(hash,temperature,max_attempts) VALUES ('s',0.0,2)`,
    ),
    env.DB.prepare(
      `INSERT INTO machine_keys(id,machine_id,public_key,scope,created_at) VALUES (1,'rig',?,'ingest','2026-01-01T00:00:00Z')`,
    ).bind(new Uint8Array([0])),
  ]);

  for (let i = 0; i < models.length; i++) {
    const slug = models[i];
    const id = i + 1;
    const familyId = i === 0 ? 1 : 2;
    await env.DB.prepare(
      `INSERT INTO models(id,family_id,slug,api_model_id,display_name,generation) VALUES (?,?,?,?,?,?)`,
    ).bind(id, familyId, slug, slug, slug, 1).run();
    await env.DB.prepare(
      `INSERT INTO cost_snapshots(pricing_version,model_id,input_per_mtoken,output_per_mtoken,effective_from) VALUES ('v1',?,1,5,'2026-01-01')`,
    ).bind(id).run();
  }

  // 2. One run per model. We'll create distinct results per occurrence below.
  for (let i = 0; i < models.length; i++) {
    const id = i + 1;
    const runId = `run_${id}`;
    await env.DB.prepare(
      `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,completed_at,status,tier,pricing_version,ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
      .bind(runId, 'ts', id, 's', 'rig', '2026-04-01T00:00:00Z', '2026-04-01T01:00:00Z', 'completed', 'claimed', 'v1', 'sig', '2026-04-01T00:00:00Z', 1, new Uint8Array([0]))
      .run();
  }

  // 3. Shortcomings + 4. Occurrences. Each occurrence requires a unique result row
  // since shortcoming_occurrences PK is (shortcoming_id, result_id).
  let scId = 1;
  let resultId = 1;
  for (let mi = 0; mi < models.length; mi++) {
    const modelId = mi + 1;
    const runId = `run_${modelId}`;
    for (const c of concepts) {
      await env.DB.prepare(
        `INSERT INTO shortcomings(id,model_id,al_concept,concept,description,correct_pattern,incorrect_pattern_r2_key,first_seen,last_seen)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      ).bind(
        scId,
        modelId,
        c.al_concept,
        c.al_concept,
        `Description for ${c.al_concept}`,
        `Correct pattern for ${c.al_concept}`,
        `shortcomings/${scId}.al.zst`,
        '2026-01-01T00:00:00Z',
        '2026-04-01T00:00:00Z',
      ).run();
      for (let oi = 0; oi < c.occurrences; oi++) {
        const taskId = `easy/a-${scId}-${oi}`;
        // Create a unique result row per occurrence.
        await env.DB.prepare(
          `INSERT INTO results(id,run_id,task_id,attempt,passed,score,compile_success,tests_total,tests_passed) VALUES (?,?,?,?,?,?,?,?,?)`,
        ).bind(resultId, runId, taskId, 1, 0, 0.0, 1, 3, 0).run();
        await env.DB.prepare(
          `INSERT INTO shortcoming_occurrences(shortcoming_id,result_id,task_id,error_code) VALUES (?,?,?,?)`,
        ).bind(scId, resultId, taskId, 'AL0000').run();
        resultId += 1;
      }
      scId += 1;
    }
  }
}

interface SeedSmokeOpts {
  runCount?: number;
}

/**
 * Bootstrap a minimal but realistic D1 fixture for the cmd-K palette index
 * tests: 2 families, 3 models, a current task_set, several tasks, plus
 * `runCount` runs (default 3, max 80) ordered by started_at desc so the
 * palette's "latest 50" trim is observable. Also seeds a couple of
 * shortcomings + occurrences for kind=shortcoming entries.
 */
export async function seedSmokeData(opts: SeedSmokeOpts = {}): Promise<void> {
  const runCount = opts.runCount ?? 3;

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO model_families(id,slug,vendor,display_name) VALUES (1,'claude','anthropic','Claude'),(2,'gpt','openai','GPT')`,
    ),
    env.DB.prepare(
      `INSERT INTO models(id,family_id,slug,api_model_id,display_name,generation) VALUES (1,1,'sonnet-4-7','claude-sonnet-4-7','Sonnet 4.7',47),(2,1,'haiku-3-5','claude-haiku-3-5','Haiku 3.5',35),(3,2,'gpt-5','gpt-5','GPT-5',5)`,
    ),
    env.DB.prepare(
      `INSERT INTO task_sets(hash,created_at,task_count,is_current) VALUES ('ts','2026-01-01T00:00:00Z',5,1)`,
    ),
    env.DB.prepare(
      `INSERT INTO settings_profiles(hash,temperature,max_attempts) VALUES ('s',0.0,2)`,
    ),
    env.DB.prepare(
      `INSERT INTO cost_snapshots(pricing_version,model_id,input_per_mtoken,output_per_mtoken,effective_from) VALUES ('v1',1,3,15,'2026-01-01'),('v1',2,1,5,'2026-01-01'),('v1',3,5,20,'2026-01-01')`,
    ),
    env.DB.prepare(
      `INSERT INTO machine_keys(id,machine_id,public_key,scope,created_at) VALUES (1,'rig',?,'ingest','2026-01-01T00:00:00Z')`,
    ).bind(new Uint8Array([0])),
    env.DB.prepare(
      `INSERT INTO tasks(task_set_hash,task_id,content_hash,difficulty,manifest_json) VALUES
        ('ts','CG-AL-E001','h1','easy','{}'),
        ('ts','CG-AL-E002','h2','easy','{}'),
        ('ts','CG-AL-M001','h3','medium','{}'),
        ('ts','CG-AL-H001','h4','hard','{}'),
        ('ts','CG-AL-H002','h5','hard','{}')`,
    ),
  ]);

  // Insert runs in descending started_at so palette ordering is observable.
  const stmts: D1PreparedStatement[] = [];
  for (let i = 0; i < runCount; i++) {
    const id = `run-${String(i).padStart(4, '0')}`;
    const modelId = (i % 3) + 1;
    // Started_at: most recent first
    const minutesAgo = i;
    const startedAt = new Date(Date.UTC(2026, 3, 27, 12, 0, 0) - minutesAgo * 60_000).toISOString();
    stmts.push(
      env.DB.prepare(
        `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,completed_at,status,tier,pricing_version,ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).bind(id, 'ts', modelId, 's', 'rig', startedAt, startedAt, 'completed', 'claimed', 'v1', 'sig', startedAt, 1, new Uint8Array([0])),
    );
  }
  if (stmts.length > 0) {
    await env.DB.batch(stmts);
  }

  // A couple of shortcomings so search-index has shortcoming-adjacent data.
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO shortcomings(id,model_id,al_concept,concept,description,correct_pattern,incorrect_pattern_r2_key,first_seen,last_seen)
       VALUES (1,1,'interfaces','interfaces','Adds IDs to interfaces','No ID on interfaces','shortcomings/x.al.zst','2026-01-01T00:00:00Z','2026-04-01T00:00:00Z')`,
    ),
  ]);
}
