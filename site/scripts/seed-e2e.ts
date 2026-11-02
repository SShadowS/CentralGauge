#!/usr/bin/env tsx
/**
 * Seed the local wrangler-dev D1 binding with E2E fixture data.
 *
 * Run BEFORE `npm run preview` (or before Playwright's webServer kicks one
 * off in CI). Idempotent: drops + recreates the seeded tables before
 * inserting, so re-running doesn't accumulate duplicate rows.
 *
 * Wrangler convention: `wrangler d1 execute centralgauge --local --file=...`
 * runs against the same .wrangler/state/v3/d1 sqlite file that
 * `wrangler dev` opens. The migration suite (./migrations/*.sql) has
 * already been applied by `wrangler dev`'s startup if the file exists; we
 * additionally apply migrations explicitly to handle the cold-start case.
 */
import { execSync } from "node:child_process";
import { readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const ROOT = resolve(import.meta.dirname ?? process.cwd(), "..");

function run(cmd: string): string {
  console.log(`$ ${cmd}`);
  return (
    execSync(cmd, {
      stdio: "inherit",
      cwd: ROOT,
      encoding: "utf8" as const,
    }) ?? ""
  );
}

function tryRun(cmd: string): boolean {
  console.log(`$ ${cmd}`);
  try {
    execSync(cmd, { stdio: "inherit", cwd: ROOT, encoding: "utf8" as const });
    return true;
  } catch {
    return false;
  }
}

// 1. Apply migrations. Wrangler's `d1 execute --file` doesn't track
//    applied state, so re-running on an existing DB fails with "table
//    already exists". We tolerate that — the seed (step 2) is what
//    matters, and the migrations are idempotent at the schema level.
const migrations = readdirSync(join(ROOT, "migrations"))
  .filter((f) => f.endsWith(".sql"))
  .sort();
for (const m of migrations) {
  const ok = tryRun(
    `npx wrangler d1 execute centralgauge --local --file=migrations/${m}`,
  );
  if (!ok) {
    console.log(`  (migration ${m} likely already applied — continuing)`);
  }
}

// 2. Build the seed SQL inline. We mirror seedSmokeData() from
//    tests/utils/seed.ts but write SQL directly because the JS function
//    requires `cloudflare:test` env.DB which only works inside vitest.
//
// DELETE order matters: D1 enforces FKs at write time, so children must
// be deleted before parents. Reverse-topological of the INSERT order:
//   model_families ← models ← cost_snapshots/runs/shortcomings
//   task_sets ← tasks/runs
//   settings_profiles ← runs
//   machine_keys ← runs
//   runs ← results ← shortcoming_occurrences
const SEED_SQL = `
DELETE FROM setup_cells;
DELETE FROM setup_runs;
DELETE FROM setups;
DELETE FROM hx_tasks;
DELETE FROM setup_task_sets;
DELETE FROM shortcoming_occurrences;
DELETE FROM shortcomings;
DELETE FROM results;
DELETE FROM runs;
DELETE FROM tasks;
DELETE FROM cost_snapshots;
DELETE FROM settings_profiles;
DELETE FROM task_sets;
DELETE FROM models;
DELETE FROM model_families;
DELETE FROM machine_keys;

INSERT INTO model_families(id,slug,vendor,display_name) VALUES
  (1,'claude','anthropic','Claude'),
  (2,'gpt','openai','GPT');

INSERT INTO models(id,family_id,slug,api_model_id,display_name,generation) VALUES
  (1,1,'sonnet-4-7','claude-sonnet-4-7','Sonnet 4.7',47),
  (2,1,'haiku-3-5','claude-haiku-3-5','Haiku 3.5',35),
  (3,2,'gpt-5','gpt-5','GPT-5',5);

INSERT INTO task_sets(hash,created_at,task_count,is_current) VALUES ('ts','2026-01-01T00:00:00Z',5,1);
INSERT INTO settings_profiles(hash,temperature,max_attempts) VALUES ('s',0.0,2);

INSERT INTO cost_snapshots(pricing_version,model_id,input_per_mtoken,output_per_mtoken,effective_from) VALUES
  ('v1',1,3,15,'2026-01-01'),
  ('v1',2,1,5,'2026-01-01'),
  ('v1',3,5,20,'2026-01-01');

INSERT INTO machine_keys(id,machine_id,public_key,scope,created_at) VALUES (1,'rig',x'00','ingest','2026-01-01T00:00:00Z');

INSERT INTO tasks(task_set_hash,task_id,content_hash,difficulty,manifest_json) VALUES
  ('ts','CG-AL-E001','h1','easy','{}'),
  ('ts','CG-AL-E002','h2','easy','{}'),
  ('ts','CG-AL-M001','h3','medium','{}'),
  ('ts','CG-AL-H001','h4','hard','{}'),
  ('ts','CG-AL-H002','h5','hard','{}');

INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,completed_at,status,tier,pricing_version,ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload) VALUES
  ('run-0000','ts',1,'s','rig','2026-04-27T12:00:00Z','2026-04-27T13:00:00Z','completed','verified','v1','sig','2026-04-27T12:00:00Z',1,x'00'),
  ('run-0001','ts',2,'s','rig','2026-04-27T11:59:00Z','2026-04-27T12:59:00Z','completed','claimed','v1','sig','2026-04-27T11:59:00Z',1,x'00'),
  ('run-0002','ts',3,'s','rig','2026-04-27T11:58:00Z','2026-04-27T12:58:00Z','completed','claimed','v1','sig','2026-04-27T11:58:00Z',1,x'00'),
  ('run-0003','ts',1,'s','rig','2026-04-27T11:57:00Z','2026-04-27T12:57:00Z','completed','verified','v1','sig','2026-04-27T11:57:00Z',1,x'00'),
  ('run-0004','ts',2,'s','rig','2026-04-27T11:56:00Z','2026-04-27T12:56:00Z','completed','claimed','v1','sig','2026-04-27T11:56:00Z',1,x'00');

-- Seeded results so leaderboard scores aren't all NULL.
-- transcript_r2_key uses the curated transcripts/<run>/<task>/<n>.txt
-- naming scheme; seeded blobs are uploaded to R2 below (see TRANSCRIPT_KEYS).
INSERT INTO results(id,run_id,task_id,attempt,passed,score,compile_success,tests_total,tests_passed,failure_reasons_json,compile_errors_json,transcript_r2_key) VALUES
  (1,'run-0000','CG-AL-E001',1,1,1.0,1,3,3,NULL,'[]','transcripts/run-0000/CG-AL-E001/1.txt'),
  (2,'run-0000','CG-AL-E002',1,1,1.0,1,3,3,NULL,'[]','transcripts/run-0000/CG-AL-E002/1.txt'),
  (3,'run-0000','CG-AL-M001',1,0,0.5,1,4,2,'["half passing"]','[]','transcripts/run-0000/CG-AL-M001/1.txt'),
  (4,'run-0001','CG-AL-E001',1,1,1.0,1,3,3,NULL,'[]','transcripts/run-0001/CG-AL-E001/1.txt'),
  (5,'run-0001','CG-AL-E002',1,0,0.0,1,3,0,'["wrong assert"]','[{"message":"expected 5 got 3"}]','transcripts/run-0001/CG-AL-E002/1.txt'),
  (6,'run-0002','CG-AL-E001',1,0,0.0,0,0,0,'["AL0132 syntax error"]','[{"code":"AL0132","message":"AL0132 expected end of statement at line 12"}]','transcripts/run-0002/CG-AL-E001/1.txt');

INSERT INTO shortcomings(id,model_id,al_concept,concept,description,correct_pattern,incorrect_pattern_r2_key,first_seen,last_seen) VALUES
  (1,1,'interfaces','interfaces','Adds IDs to interfaces','No ID on interfaces','shortcomings/x.al.zst','2026-01-01T00:00:00Z','2026-04-01T00:00:00Z'),
  (2,2,'records','records','Misses InitValue defaults','Use InitValue','shortcomings/y.al.zst','2026-01-15T00:00:00Z','2026-04-10T00:00:00Z');

INSERT INTO shortcoming_occurrences(shortcoming_id,result_id,task_id,error_code) VALUES
  (1,3,'CG-AL-M001','AL0132'),
  (2,5,'CG-AL-E002','AL0500');

-- Setups section; mirrors seedSetups() in tests/utils/seed-setups.ts.
INSERT INTO setup_task_sets(hash,display_name,task_count,is_current,created_at,promoted_at) VALUES
  ('hx-cur','HX current',2,1,'2026-10-01T00:00:00Z','2026-10-02T00:00:00Z'),
  ('hx-old','HX old',1,0,'2026-09-01T00:00:00Z',NULL);
INSERT INTO hx_tasks(task_set_hash,task_id,description_sha) VALUES
  ('hx-cur','HX-002','sha-cur-2'),('hx-cur','HX-001','sha-cur-1'),('hx-old','HX-001','sha-old-1');
INSERT INTO setups(id,description,agent_tool,base_model,visibility,needs_key,roles_json,flow,ingredients_json,created_at) VALUES
  ('cc-plain','cc-plain description','claude-code','m-1','public',0,'[{"role":"main","model":"m-1","effort":null}]','plain flow','{"instructions":null,"rules":[],"settings":null,"skills":[],"mcp":[],"hooks":[]}','2026-10-01T00:00:00Z'),
  ('pi-default','pi-default description','pi','m-1','public',0,'[{"role":"main","model":"m-1","effort":null}]',NULL,'{"instructions":null,"rules":[],"settings":null,"skills":[],"mcp":[],"hooks":[]}','2026-10-01T00:00:00Z'),
  ('cc-secret','cc-secret description','claude-code','m-1','private',0,'[{"role":"main","model":"m-1","effort":null}]','SECRET-FLOW','{"instructions":{"name":"CLAUDE.md","content":"SECRET-BODY"},"rules":[{"name":"style.md","content":"SECRET-RULE"}],"settings":{"name":"settings.json","content":"SECRET-SETTINGS"},"skills":["skill-a","skill-b"],"mcp":["mcp-x"],"hooks":["hook-y"]}','2026-10-01T00:00:00Z'),
  ('codex-old','codex-old description','codex','m-1','public',0,'[{"role":"main","model":"m-1","effort":null}]',NULL,'{"instructions":null,"rules":[],"settings":null,"skills":[],"mcp":[],"hooks":[]}','2026-10-01T00:00:00Z');
INSERT INTO setup_runs(id,setup_id,task_set_hash,tool_version,published_at,score,cost_per_solved_usd,price_note,excluded_cells) VALUES
  ('r-cc-1','cc-plain','hx-cur','2.1.300','2026-10-05T00:00:00Z',0.5,0.4,NULL,0),
  ('r-cc-2','cc-plain','hx-cur','2.1.314','2026-10-10T00:00:00Z',0.75,0.3,NULL,0),
  ('r-pi-1','pi-default','hx-cur','0.9.0','2026-10-06T00:00:00Z',0.25,NULL,'no price data',0),
  ('r-sec-1','cc-secret','hx-cur','2.1.314','2026-10-07T00:00:00Z',0.9,0.2,NULL,0),
  ('r-old-1','codex-old','hx-old','1.0.0','2026-09-10T00:00:00Z',0.6,0.5,NULL,0);
INSERT INTO setup_cells(run_id,task_id,repeat,outcome,cost_usd,duration_ms) VALUES
  ('r-cc-2','HX-001',1,'pass',0.1,1000),
  ('r-cc-2','HX-001',2,'pass',0.1,1000),
  ('r-cc-2','HX-002',1,'pass',0.1,1000),
  ('r-cc-2','HX-002',2,'fail',0.1,1000),
  ('r-cc-1','HX-001',1,'fail',0.1,1000),
  ('r-cc-1','HX-002',1,'fail',0.1,1000),
  ('r-pi-1','HX-001',1,'env_blocked',0.1,1000),
  ('r-pi-1','HX-002',1,'fail',0.1,1000),
  ('r-sec-1','HX-001',1,'pass',0.1,1000),
  ('r-old-1','HX-001',1,'pass',0.1,1000);
`;

const seedFile = join(tmpdir(), "cg-seed.sql");
writeFileSync(seedFile, SEED_SQL);
run(
  `npx wrangler d1 execute centralgauge --local --file=${seedFile.replace(
    /\\/g,
    "/",
  )}`,
);

// 3. Seed R2 transcript blobs. Keys must match transcript_r2_key values
//    inserted above; the page at /runs/[id]/transcripts/[taskId]/[attempt]
//    fetches /api/v1/transcripts/<key> which reads from the BLOBS bucket.
//    Without these blobs the API returns 404 and the page surfaces it.
const TRANSCRIPT_KEYS = [
  "transcripts/run-0000/CG-AL-E001/1.txt",
  "transcripts/run-0000/CG-AL-E002/1.txt",
  "transcripts/run-0000/CG-AL-M001/1.txt",
  "transcripts/run-0001/CG-AL-E001/1.txt",
  "transcripts/run-0001/CG-AL-E002/1.txt",
  "transcripts/run-0002/CG-AL-E001/1.txt",
];
const fixtureFile = join(ROOT, "scripts", "fixtures", "sample-transcript.txt");
for (const key of TRANSCRIPT_KEYS) {
  run(
    `npx wrangler r2 object put centralgauge-blobs/${key} --local --file=${fixtureFile.replace(
      /\\/g,
      "/",
    )} --content-type=text/plain`,
  );
}

console.log("\n[OK] E2E seed applied to local D1 + R2.");
