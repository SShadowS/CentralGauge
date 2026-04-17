# P1 — Schema + API Skeleton Implementation Plan (Part 4: Admin, SSE, Key Bootstrap, E2E)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Parts 1–3 (Tasks 1–26) must be complete before starting Part 4.

**Scope:** Tasks 27–37 — the final admin surface, the Durable Object SSE broadcaster wired into finalize, the rate limiter, machine key bootstrap (keygen CLI + admin registration endpoint), nightly D1→R2 backup cron, and an end-to-end integration test that signs a run, ingests it, uploads blobs, finalizes, and reads back through every GET endpoint.

**Prerequisites:** Parts 1–3 complete. All routes under `site/src/routes/api/v1/` exist, migrations 0001 + 0002 applied, signature middleware functional, D1 helpers and cache helpers in place.

**Spec reference:** `docs/superpowers/specs/2026-04-17-benchmark-results-db-design.md` sections 6, 7, and 11.

**Conventions carried from Part 3:**
- Every write endpoint requires `verifySignedRequest` (Part 2) with the correct scope.
- Every admin endpoint requires `admin` scope.
- ETag + Cache-Control on all read responses (Part 3).
- Per-IP rate limits enforced by middleware added in Task 34.

---

## Task 27: `POST /api/v1/task-sets/:hash/current` (admin promotion)

Promotes a registered task set to "current" — the one the landing leaderboard reads from. Exactly one `task_sets` row can have `is_current = 1` at a time; promotion is atomic (flip old one off, new one on, in a single batch). Invalidates the leaderboard KV cache on success.

**Files:**
- Create: `site/src/routes/api/v1/task-sets/[hash]/current/+server.ts`
- Create: `site/tests/api/task-sets-promote.test.ts`

- [ ] **Step 1: Write failing test** `site/tests/api/task-sets-promote.test.ts`

```typescript
import { env, applyD1Migrations, SELF } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { generateKeyPair, signRequest } from '../test-helpers/signing';

let adminKey: { id: number; privateKey: Uint8Array };
let ingestKey: { id: number; privateKey: Uint8Array };

async function seed(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM task_sets`),
    env.DB.prepare(`DELETE FROM machine_keys`),
  ]);
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO task_sets(hash,version,locked_at,is_current) VALUES ('ts-old','v1','2025-12-01T00:00:00Z',1),('ts-new','v2','2026-04-01T00:00:00Z',0)`),
  ]);
  adminKey = await generateKeyPair(env.DB, 'admin-rig', 'admin');
  ingestKey = await generateKeyPair(env.DB, 'rig', 'ingest');
  // Prime KV so we can verify invalidation
  await env.KV.put('leaderboard:current:all::::50', '{"stale":true}');
}

beforeAll(async () => { await applyD1Migrations(env.DB, env.TEST_MIGRATIONS); });
beforeEach(async () => { await seed(); });

describe('POST /api/v1/task-sets/:hash/current', () => {
  it('promotes a task set and flips the old one off', async () => {
    const req = await signRequest(adminKey, 'POST', 'https://x/api/v1/task-sets/ts-new/current', {});
    const res = await SELF.fetch(req);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.hash).toBe('ts-new');
    expect(body.is_current).toBe(true);

    const old = await env.DB.prepare(`SELECT is_current FROM task_sets WHERE hash = 'ts-old'`).first<{ is_current: number }>();
    const neu = await env.DB.prepare(`SELECT is_current FROM task_sets WHERE hash = 'ts-new'`).first<{ is_current: number }>();
    expect(old?.is_current).toBe(0);
    expect(neu?.is_current).toBe(1);
  });

  it('invalidates leaderboard KV cache', async () => {
    const req = await signRequest(adminKey, 'POST', 'https://x/api/v1/task-sets/ts-new/current', {});
    await SELF.fetch(req);
    const cached = await env.KV.get('leaderboard:current:all::::50');
    expect(cached).toBeNull();
  });

  it('rejects non-admin scope', async () => {
    const req = await signRequest(ingestKey, 'POST', 'https://x/api/v1/task-sets/ts-new/current', {});
    const res = await SELF.fetch(req);
    expect(res.status).toBe(403);
  });

  it('returns 404 for unknown task set', async () => {
    const req = await signRequest(adminKey, 'POST', 'https://x/api/v1/task-sets/nonexistent/current', {});
    const res = await SELF.fetch(req);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Create test helper** `site/tests/test-helpers/signing.ts`

```typescript
import * as ed from '@noble/ed25519';
import { canonicalJson } from '../../src/lib/shared/canonical';
import { base64Encode } from '../../src/lib/shared/base64';
import type { D1Database } from '@cloudflare/workers-types';

export interface SignerKey {
  id: number;
  machineId: string;
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  scope: 'ingest' | 'verifier' | 'admin';
}

export async function generateKeyPair(
  db: D1Database,
  machineId: string,
  scope: 'ingest' | 'verifier' | 'admin',
): Promise<SignerKey> {
  const privateKey = ed.utils.randomPrivateKey();
  const publicKey = await ed.getPublicKeyAsync(privateKey);
  const result = await db.prepare(
    `INSERT INTO machine_keys(machine_id, public_key, scope, created_at)
     VALUES (?, ?, ?, ?) RETURNING id`
  ).bind(machineId, publicKey, scope, new Date().toISOString()).first<{ id: number }>();
  if (!result) throw new Error('Failed to insert machine_key');
  return { id: result.id, machineId, privateKey, publicKey, scope };
}

export async function signRequest(
  key: SignerKey,
  method: string,
  url: string,
  payload: Record<string, unknown>,
): Promise<Request> {
  const body = {
    signature: {
      alg: 'Ed25519' as const,
      key_id: key.id,
      signed_at: new Date().toISOString(),
      value: '',
    },
    payload,
  };
  const canonical = canonicalJson(body.payload);
  const sig = await ed.signAsync(new TextEncoder().encode(canonical), key.privateKey);
  body.signature.value = base64Encode(sig);

  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
```

- [ ] **Step 3: Run to verify failure**

Run: `cd site && npm test -- tests/api/task-sets-promote.test.ts`
Expected: FAIL — route not found.

- [ ] **Step 4: Implement `site/src/routes/api/v1/task-sets/[hash]/current/+server.ts`**

```typescript
import type { RequestHandler } from './$types';
import { verifySignedRequest } from '$lib/server/signature';
import { getFirst, runBatch } from '$lib/server/db';
import { ApiError, errorResponse, jsonResponse } from '$lib/server/errors';

export const POST: RequestHandler = async ({ request, params, platform }) => {
  const env = platform!.env;
  try {
    const { payload } = await verifySignedRequest(env.DB, request, 'admin');

    const hash = params.hash!;
    const ts = await getFirst<{ hash: string; is_current: number }>(
      env.DB,
      `SELECT hash, is_current FROM task_sets WHERE hash = ?`,
      [hash],
    );
    if (!ts) throw new ApiError(404, 'task_set_not_found', `No task set '${hash}'`);

    if (ts.is_current === 1) {
      return jsonResponse({ hash, is_current: true, changed: false });
    }

    await runBatch(env.DB, [
      { sql: `UPDATE task_sets SET is_current = 0 WHERE is_current = 1`, params: [] },
      { sql: `UPDATE task_sets SET is_current = 1 WHERE hash = ?`, params: [hash] },
      {
        sql: `INSERT INTO ingest_events(event, machine_id, ts, details_json) VALUES ('task_set_promoted', ?, ?, ?)`,
        params: [
          payload.machine_id as string ?? 'unknown',
          new Date().toISOString(),
          JSON.stringify({ hash }),
        ],
      },
    ]);

    // Invalidate leaderboard caches
    const keys = await env.KV.list({ prefix: 'leaderboard:' });
    for (const k of keys.keys) await env.KV.delete(k.name);

    return jsonResponse({ hash, is_current: true, changed: true });
  } catch (err) {
    return errorResponse(err);
  }
};
```

- [ ] **Step 5: Run tests**

Run: `cd site && npm test -- tests/api/task-sets-promote.test.ts`
Expected: 4 tests pass.

- [ ] **Step 6: Commit**

```bash
git add site/src/routes/api/v1/task-sets/ \
        site/tests/api/task-sets-promote.test.ts \
        site/tests/test-helpers/signing.ts
git commit -m "feat(site): implement POST /task-sets/:hash/current (admin promotion)"
```

---

## Task 28: `POST /api/v1/shortcomings/batch`

Called by the `analyze` command (runs offline on a machine against finalized runs). Posts a batch of upsert rows for the `shortcomings` + `shortcoming_occurrences` tables. Signed with `verifier` or `admin` scope.

**Files:**
- Create: `site/src/routes/api/v1/shortcomings/batch/+server.ts`
- Create: `site/tests/api/shortcomings-batch.test.ts`

- [ ] **Step 1: Write failing test** `site/tests/api/shortcomings-batch.test.ts`

```typescript
import { env, applyD1Migrations, SELF } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { generateKeyPair, signRequest } from '../test-helpers/signing';

let verifierKey: { id: number; privateKey: Uint8Array };

async function seed(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM shortcoming_occurrences`),
    env.DB.prepare(`DELETE FROM shortcomings`),
    env.DB.prepare(`DELETE FROM results`),
    env.DB.prepare(`DELETE FROM runs`),
    env.DB.prepare(`DELETE FROM models`),
    env.DB.prepare(`DELETE FROM model_families`),
    env.DB.prepare(`DELETE FROM task_sets`),
    env.DB.prepare(`DELETE FROM settings_profiles`),
    env.DB.prepare(`DELETE FROM cost_snapshots`),
    env.DB.prepare(`DELETE FROM machine_keys`),
  ]);
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO model_families(id,slug,vendor,display_name) VALUES (1,'claude','a','Claude')`),
    env.DB.prepare(`INSERT INTO models(id,family_id,slug,api_model_id,display_name) VALUES (1,1,'sonnet-4.7','c','Sonnet')`),
    env.DB.prepare(`INSERT INTO task_sets(hash,version,locked_at,is_current) VALUES ('ts','v1','2026-01-01T00:00:00Z',1)`),
    env.DB.prepare(`INSERT INTO settings_profiles(hash,temperature,max_attempts) VALUES ('s',0,2)`),
    env.DB.prepare(`INSERT INTO cost_snapshots(pricing_version,model_id,input_per_mtoken,output_per_mtoken,effective_from) VALUES ('v1',1,3,15,'2026-01-01')`),
  ]);
  verifierKey = await generateKeyPair(env.DB, 'v-rig', 'verifier');
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,completed_at,status,tier,pricing_version,ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload) VALUES ('r1','ts',1,'s','r','2026-04-01T00:00:00Z','2026-04-01T01:00:00Z','completed','claimed','v1','s','2026-04-01T00:00:00Z',?, X'7B7D')`).bind(verifierKey.id),
    env.DB.prepare(`INSERT INTO results(id,run_id,task_id,attempt,passed,score,compile_success) VALUES (100,'r1','easy/a',1,0,0,0)`),
  ]);
}

beforeAll(async () => { await applyD1Migrations(env.DB, env.TEST_MIGRATIONS); });
beforeEach(async () => { await seed(); });

describe('POST /api/v1/shortcomings/batch', () => {
  it('upserts shortcomings and occurrences', async () => {
    const payload = {
      model_slug: 'sonnet-4.7',
      shortcomings: [
        {
          al_concept: 'interfaces',
          concept: 'Interfaces with IDs',
          description: 'Model incorrectly adds numeric IDs to interfaces.',
          correct_pattern: 'No ID on interfaces.',
          incorrect_pattern_sha256: 'abc123',
          error_codes: ['AL0132'],
          occurrences: [{ result_id: 100, task_id: 'easy/a', error_code: 'AL0132' }],
        },
      ],
    };
    const req = await signRequest(verifierKey, 'POST', 'https://x/api/v1/shortcomings/batch', payload);
    const res = await SELF.fetch(req);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.upserted).toBe(1);
    expect(body.occurrences).toBe(1);

    const row = await env.DB.prepare(`SELECT al_concept FROM shortcomings WHERE model_id = 1`).first<{ al_concept: string }>();
    expect(row?.al_concept).toBe('interfaces');

    const occ = await env.DB.prepare(`SELECT task_id FROM shortcoming_occurrences`).first<{ task_id: string }>();
    expect(occ?.task_id).toBe('easy/a');
  });

  it('is idempotent — second call updates last_seen without duplicating', async () => {
    const payload = {
      model_slug: 'sonnet-4.7',
      shortcomings: [{
        al_concept: 'interfaces', concept: 'c', description: 'd',
        correct_pattern: 'p', incorrect_pattern_sha256: 'x', error_codes: [],
        occurrences: [{ result_id: 100, task_id: 'easy/a', error_code: null }],
      }],
    };
    const r1 = await signRequest(verifierKey, 'POST', 'https://x/api/v1/shortcomings/batch', payload);
    await SELF.fetch(r1);
    const r2 = await signRequest(verifierKey, 'POST', 'https://x/api/v1/shortcomings/batch', payload);
    await SELF.fetch(r2);
    const count = await env.DB.prepare(`SELECT COUNT(*) AS n FROM shortcomings`).first<{ n: number }>();
    expect(count?.n).toBe(1);
  });

  it('rejects non-verifier scope', async () => {
    const ingest = await generateKeyPair(env.DB, 'i', 'ingest');
    const req = await signRequest(ingest, 'POST', 'https://x/api/v1/shortcomings/batch', { model_slug: 'sonnet-4.7', shortcomings: [] });
    const res = await SELF.fetch(req);
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd site && npm test -- tests/api/shortcomings-batch.test.ts`
Expected: FAIL — route not found.

- [ ] **Step 3: Implement `site/src/routes/api/v1/shortcomings/batch/+server.ts`**

```typescript
import type { RequestHandler } from './$types';
import { verifySignedRequest } from '$lib/server/signature';
import { getFirst, runBatch } from '$lib/server/db';
import { ApiError, errorResponse, jsonResponse } from '$lib/server/errors';

interface ShortcomingInput {
  al_concept: string;
  concept: string;
  description: string;
  correct_pattern: string;
  incorrect_pattern_sha256: string;
  error_codes: string[];
  occurrences: { result_id: number; task_id: string; error_code: string | null }[];
}

interface BatchPayload {
  model_slug: string;
  shortcomings: ShortcomingInput[];
}

export const POST: RequestHandler = async ({ request, platform }) => {
  const env = platform!.env;
  try {
    const { payload } = await verifySignedRequest(env.DB, request, 'verifier');
    const batch = payload as unknown as BatchPayload;

    const model = await getFirst<{ id: number }>(
      env.DB, `SELECT id FROM models WHERE slug = ?`, [batch.model_slug],
    );
    if (!model) throw new ApiError(404, 'model_not_found', `No model '${batch.model_slug}'`);

    const now = new Date().toISOString();
    let upserted = 0;
    let occurrences = 0;

    for (const s of batch.shortcomings ?? []) {
      const incorrectKey = `shortcomings/${s.incorrect_pattern_sha256}.al.zst`;

      const existing = await getFirst<{ id: number }>(
        env.DB,
        `SELECT id FROM shortcomings WHERE model_id = ? AND al_concept = ?`,
        [model.id, s.al_concept],
      );

      let shortcomingId: number;
      if (existing) {
        await runBatch(env.DB, [{
          sql: `UPDATE shortcomings SET concept = ?, description = ?, correct_pattern = ?,
                    incorrect_pattern_r2_key = ?, error_codes_json = ?, last_seen = ?
                WHERE id = ?`,
          params: [
            s.concept, s.description, s.correct_pattern, incorrectKey,
            JSON.stringify(s.error_codes ?? []), now, existing.id,
          ],
        }]);
        shortcomingId = existing.id;
      } else {
        const inserted = await env.DB.prepare(
          `INSERT INTO shortcomings(model_id, al_concept, concept, description, correct_pattern,
                                    incorrect_pattern_r2_key, error_codes_json, first_seen, last_seen)
           VALUES (?,?,?,?,?,?,?,?,?) RETURNING id`
        ).bind(
          model.id, s.al_concept, s.concept, s.description, s.correct_pattern,
          incorrectKey, JSON.stringify(s.error_codes ?? []), now, now,
        ).first<{ id: number }>();
        if (!inserted) throw new Error('insert_failed');
        shortcomingId = inserted.id;
      }
      upserted++;

      for (const occ of s.occurrences ?? []) {
        await env.DB.prepare(
          `INSERT OR IGNORE INTO shortcoming_occurrences(shortcoming_id, result_id, task_id, error_code)
           VALUES (?,?,?,?)`
        ).bind(shortcomingId, occ.result_id, occ.task_id, occ.error_code).run();
        occurrences++;
      }
    }

    return jsonResponse({ upserted, occurrences });
  } catch (err) {
    return errorResponse(err);
  }
};
```

- [ ] **Step 4: Run tests**

Run: `cd site && npm test -- tests/api/shortcomings-batch.test.ts`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add site/src/routes/api/v1/shortcomings/ site/tests/api/shortcomings-batch.test.ts
git commit -m "feat(site): implement POST /api/v1/shortcomings/batch"
```

---

## Task 29: `POST /api/v1/verify`

A verifier machine re-ran an earlier `claimed` run with the same task set + model + settings and wants to attest "I got matching results." On success, writes to `run_verifications` and — if agreement_score crosses the promotion threshold — flips the original run's `tier` from `claimed` to `verified`, which changes how it shows on the leaderboard.

**Files:**
- Create: `site/src/routes/api/v1/verify/+server.ts`
- Create: `site/tests/api/verify.test.ts`

- [ ] **Step 1: Write failing test** `site/tests/api/verify.test.ts`

```typescript
import { env, applyD1Migrations, SELF } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { generateKeyPair, signRequest } from '../test-helpers/signing';

let verifierKey: { id: number; privateKey: Uint8Array };

async function seed(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM run_verifications`),
    env.DB.prepare(`DELETE FROM results`),
    env.DB.prepare(`DELETE FROM runs`),
    env.DB.prepare(`DELETE FROM models`),
    env.DB.prepare(`DELETE FROM model_families`),
    env.DB.prepare(`DELETE FROM task_sets`),
    env.DB.prepare(`DELETE FROM settings_profiles`),
    env.DB.prepare(`DELETE FROM cost_snapshots`),
    env.DB.prepare(`DELETE FROM machine_keys`),
  ]);
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO model_families(id,slug,vendor,display_name) VALUES (1,'claude','a','Claude')`),
    env.DB.prepare(`INSERT INTO models(id,family_id,slug,api_model_id,display_name) VALUES (1,1,'sonnet-4.7','c','Sonnet')`),
    env.DB.prepare(`INSERT INTO task_sets(hash,version,locked_at,is_current) VALUES ('ts','v1','2026-01-01T00:00:00Z',1)`),
    env.DB.prepare(`INSERT INTO settings_profiles(hash,temperature,max_attempts) VALUES ('s',0,2)`),
    env.DB.prepare(`INSERT INTO cost_snapshots(pricing_version,model_id,input_per_mtoken,output_per_mtoken,effective_from) VALUES ('v1',1,3,15,'2026-01-01')`),
  ]);
  verifierKey = await generateKeyPair(env.DB, 'v', 'verifier');
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,completed_at,status,tier,pricing_version,ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload) VALUES ('original','ts',1,'s','m1','2026-04-01T00:00:00Z','2026-04-01T01:00:00Z','completed','claimed','v1','s','2026-04-01T00:00:00Z',?, X'7B7D'),('reverified','ts',1,'s','m2','2026-04-02T00:00:00Z','2026-04-02T01:00:00Z','completed','claimed','v1','s','2026-04-02T00:00:00Z',?, X'7B7D')`).bind(verifierKey.id, verifierKey.id),
  ]);
}

beforeAll(async () => { await applyD1Migrations(env.DB, env.TEST_MIGRATIONS); });
beforeEach(async () => { await seed(); });

describe('POST /api/v1/verify', () => {
  it('records verification and promotes original when agreement >= 0.9', async () => {
    const req = await signRequest(verifierKey, 'POST', 'https://x/api/v1/verify', {
      original_run_id: 'original',
      verifier_run_id: 'reverified',
      agreement_score: 0.95,
      notes: 'all tasks match',
    });
    const res = await SELF.fetch(req);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.promoted).toBe(true);

    const orig = await env.DB.prepare(`SELECT tier FROM runs WHERE id = 'original'`).first<{ tier: string }>();
    expect(orig?.tier).toBe('verified');

    const link = await env.DB.prepare(`SELECT agreement_score FROM run_verifications`).first<{ agreement_score: number }>();
    expect(link?.agreement_score).toBeCloseTo(0.95, 5);
  });

  it('does NOT promote when agreement < 0.9', async () => {
    const req = await signRequest(verifierKey, 'POST', 'https://x/api/v1/verify', {
      original_run_id: 'original',
      verifier_run_id: 'reverified',
      agreement_score: 0.5,
    });
    const res = await SELF.fetch(req);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.promoted).toBe(false);
    const orig = await env.DB.prepare(`SELECT tier FROM runs WHERE id = 'original'`).first<{ tier: string }>();
    expect(orig?.tier).toBe('claimed');
  });

  it('rejects when original and verifier are the same run', async () => {
    const req = await signRequest(verifierKey, 'POST', 'https://x/api/v1/verify', {
      original_run_id: 'original',
      verifier_run_id: 'original',
      agreement_score: 1.0,
    });
    const res = await SELF.fetch(req);
    expect(res.status).toBe(400);
  });

  it('rejects non-verifier scope', async () => {
    const ing = await generateKeyPair(env.DB, 'i', 'ingest');
    const req = await signRequest(ing, 'POST', 'https://x/api/v1/verify', {
      original_run_id: 'original', verifier_run_id: 'reverified', agreement_score: 0.95,
    });
    const res = await SELF.fetch(req);
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd site && npm test -- tests/api/verify.test.ts`
Expected: FAIL — route not found.

- [ ] **Step 3: Implement `site/src/routes/api/v1/verify/+server.ts`**

```typescript
import type { RequestHandler } from './$types';
import { verifySignedRequest } from '$lib/server/signature';
import { getFirst, runBatch } from '$lib/server/db';
import { ApiError, errorResponse, jsonResponse } from '$lib/server/errors';

const PROMOTION_THRESHOLD = 0.9;

interface VerifyPayload {
  original_run_id: string;
  verifier_run_id: string;
  agreement_score: number;
  notes?: string;
}

export const POST: RequestHandler = async ({ request, platform }) => {
  const env = platform!.env;
  try {
    const { payload } = await verifySignedRequest(env.DB, request, 'verifier');
    const v = payload as unknown as VerifyPayload;

    if (v.original_run_id === v.verifier_run_id) {
      throw new ApiError(400, 'same_run', 'original and verifier runs must differ');
    }
    if (typeof v.agreement_score !== 'number' || v.agreement_score < 0 || v.agreement_score > 1) {
      throw new ApiError(400, 'invalid_agreement', 'agreement_score must be in [0,1]');
    }

    const orig = await getFirst<{ id: string; tier: string; task_set_hash: string; model_id: number; settings_hash: string }>(
      env.DB,
      `SELECT id, tier, task_set_hash, model_id, settings_hash FROM runs WHERE id = ?`,
      [v.original_run_id],
    );
    if (!orig) throw new ApiError(404, 'original_not_found', `No run '${v.original_run_id}'`);

    const verifier = await getFirst<{ id: string; task_set_hash: string; model_id: number; settings_hash: string }>(
      env.DB,
      `SELECT id, task_set_hash, model_id, settings_hash FROM runs WHERE id = ?`,
      [v.verifier_run_id],
    );
    if (!verifier) throw new ApiError(404, 'verifier_not_found', `No run '${v.verifier_run_id}'`);

    if (
      orig.task_set_hash !== verifier.task_set_hash ||
      orig.model_id      !== verifier.model_id ||
      orig.settings_hash !== verifier.settings_hash
    ) {
      throw new ApiError(400, 'grouping_mismatch', 'runs must share task_set_hash, model_id, settings_hash');
    }

    const promoted = v.agreement_score >= PROMOTION_THRESHOLD && orig.tier === 'claimed';
    const now = new Date().toISOString();

    const ops = [
      {
        sql: `INSERT OR REPLACE INTO run_verifications(original_run_id, verifier_run_id, verified_at, agreement_score, notes)
              VALUES (?,?,?,?,?)`,
        params: [orig.id, verifier.id, now, v.agreement_score, v.notes ?? null],
      },
    ];
    if (promoted) {
      ops.push({
        sql: `UPDATE runs SET tier = 'verified' WHERE id = ?`,
        params: [orig.id],
      });
      ops.push({
        sql: `INSERT INTO ingest_events(event, machine_id, ts, details_json) VALUES ('run_promoted', ?, ?, ?)`,
        params: ['verifier', now, JSON.stringify({ run_id: orig.id, agreement: v.agreement_score })],
      });
    }
    await runBatch(env.DB, ops);

    if (promoted) {
      const keys = await env.KV.list({ prefix: 'leaderboard:' });
      for (const k of keys.keys) await env.KV.delete(k.name);
    }

    return jsonResponse({
      original_run_id: orig.id,
      verifier_run_id: verifier.id,
      agreement_score: v.agreement_score,
      promoted,
    });
  } catch (err) {
    return errorResponse(err);
  }
};
```

- [ ] **Step 4: Run tests**

Run: `cd site && npm test -- tests/api/verify.test.ts`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add site/src/routes/api/v1/verify/ site/tests/api/verify.test.ts
git commit -m "feat(site): implement POST /api/v1/verify with auto-promotion"
```

---

## Task 30: `POST /api/v1/pricing`

Admin registers a pricing version (one `cost_snapshots` row per model) with an optional `effective_until` to close out the prior version. Historical runs continue to use their recorded `pricing_version` so cost history is never mutated retroactively.

**Files:**
- Create: `site/src/routes/api/v1/pricing/+server.ts`
- Create: `site/tests/api/pricing.test.ts`

- [ ] **Step 1: Write failing test** `site/tests/api/pricing.test.ts`

```typescript
import { env, applyD1Migrations, SELF } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { generateKeyPair, signRequest } from '../test-helpers/signing';

let adminKey: { id: number; privateKey: Uint8Array };

async function seed(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM cost_snapshots`),
    env.DB.prepare(`DELETE FROM models`),
    env.DB.prepare(`DELETE FROM model_families`),
    env.DB.prepare(`DELETE FROM machine_keys`),
  ]);
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO model_families(id,slug,vendor,display_name) VALUES (1,'claude','a','Claude')`),
    env.DB.prepare(`INSERT INTO models(id,family_id,slug,api_model_id,display_name) VALUES (1,1,'sonnet-4.6','c','Sonnet 4.6'),(2,1,'sonnet-4.7','c','Sonnet 4.7')`),
    env.DB.prepare(`INSERT INTO cost_snapshots(pricing_version,model_id,input_per_mtoken,output_per_mtoken,effective_from) VALUES ('v2026-03',1,3,15,'2026-03-01'),('v2026-03',2,3,15,'2026-03-01')`),
  ]);
  adminKey = await generateKeyPair(env.DB, 'a', 'admin');
}

beforeAll(async () => { await applyD1Migrations(env.DB, env.TEST_MIGRATIONS); });
beforeEach(async () => { await seed(); });

describe('POST /api/v1/pricing', () => {
  it('registers new pricing version and closes prior one', async () => {
    const req = await signRequest(adminKey, 'POST', 'https://x/api/v1/pricing', {
      pricing_version: 'v2026-04',
      effective_from: '2026-04-01T00:00:00Z',
      close_previous: true,
      rates: [
        { model_slug: 'sonnet-4.6', input_per_mtoken: 3, output_per_mtoken: 15 },
        { model_slug: 'sonnet-4.7', input_per_mtoken: 3, output_per_mtoken: 15, cache_read_per_mtoken: 0.3 },
      ],
    });
    const res = await SELF.fetch(req);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.inserted).toBe(2);

    const rows = await env.DB.prepare(
      `SELECT pricing_version, effective_until FROM cost_snapshots ORDER BY pricing_version`
    ).all<{ pricing_version: string; effective_until: string | null }>();
    const v3 = rows.results.filter(r => r.pricing_version === 'v2026-03');
    const v4 = rows.results.filter(r => r.pricing_version === 'v2026-04');
    expect(v3).toHaveLength(2);
    expect(v3.every(r => r.effective_until !== null)).toBe(true);
    expect(v4).toHaveLength(2);
    expect(v4.every(r => r.effective_until === null)).toBe(true);
  });

  it('rejects duplicate pricing_version for same model', async () => {
    const req = await signRequest(adminKey, 'POST', 'https://x/api/v1/pricing', {
      pricing_version: 'v2026-03',
      effective_from: '2026-03-01T00:00:00Z',
      rates: [{ model_slug: 'sonnet-4.6', input_per_mtoken: 3, output_per_mtoken: 15 }],
    });
    const res = await SELF.fetch(req);
    expect(res.status).toBe(409);
  });

  it('rejects non-admin scope', async () => {
    const v = await generateKeyPair(env.DB, 'v', 'verifier');
    const req = await signRequest(v, 'POST', 'https://x/api/v1/pricing', {
      pricing_version: 'v2026-04', effective_from: '2026-04-01T00:00:00Z', rates: [],
    });
    const res = await SELF.fetch(req);
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd site && npm test -- tests/api/pricing.test.ts`
Expected: FAIL — route not found.

- [ ] **Step 3: Implement `site/src/routes/api/v1/pricing/+server.ts`**

```typescript
import type { RequestHandler } from './$types';
import { verifySignedRequest } from '$lib/server/signature';
import { getAll, getFirst, runBatch } from '$lib/server/db';
import { ApiError, errorResponse, jsonResponse } from '$lib/server/errors';

interface PricingPayload {
  pricing_version: string;
  effective_from: string;
  close_previous?: boolean;
  rates: {
    model_slug: string;
    input_per_mtoken: number;
    output_per_mtoken: number;
    cache_read_per_mtoken?: number;
    cache_write_per_mtoken?: number;
  }[];
}

export const POST: RequestHandler = async ({ request, platform }) => {
  const env = platform!.env;
  try {
    const { payload } = await verifySignedRequest(env.DB, request, 'admin');
    const p = payload as unknown as PricingPayload;

    if (!p.pricing_version || !p.effective_from) {
      throw new ApiError(400, 'missing_fields', 'pricing_version and effective_from required');
    }

    const slugs = (p.rates ?? []).map((r) => r.model_slug);
    if (slugs.length === 0) {
      throw new ApiError(400, 'no_rates', 'rates cannot be empty');
    }
    const placeholders = slugs.map(() => '?').join(',');
    const models = await getAll<{ id: number; slug: string }>(
      env.DB, `SELECT id, slug FROM models WHERE slug IN (${placeholders})`, slugs,
    );
    const slugToId = new Map(models.map((m) => [m.slug, m.id]));
    const missing = slugs.filter((s) => !slugToId.has(s));
    if (missing.length) {
      throw new ApiError(404, 'model_not_found', `Unknown models: ${missing.join(',')}`);
    }

    // Conflict check
    for (const r of p.rates) {
      const existing = await getFirst<{ id: number }>(
        env.DB,
        `SELECT id FROM cost_snapshots WHERE pricing_version = ? AND model_id = ?`,
        [p.pricing_version, slugToId.get(r.model_slug)!],
      );
      if (existing) {
        throw new ApiError(409, 'duplicate', `pricing_version '${p.pricing_version}' already set for ${r.model_slug}`);
      }
    }

    const ops: { sql: string; params: (string | number | null)[] }[] = [];

    if (p.close_previous) {
      ops.push({
        sql: `UPDATE cost_snapshots SET effective_until = ? WHERE effective_until IS NULL AND pricing_version != ?`,
        params: [p.effective_from, p.pricing_version],
      });
    }

    for (const r of p.rates) {
      ops.push({
        sql: `INSERT INTO cost_snapshots(pricing_version, model_id, input_per_mtoken, output_per_mtoken,
                                         cache_read_per_mtoken, cache_write_per_mtoken, effective_from)
              VALUES (?,?,?,?,?,?,?)`,
        params: [
          p.pricing_version, slugToId.get(r.model_slug)!,
          r.input_per_mtoken, r.output_per_mtoken,
          r.cache_read_per_mtoken ?? 0, r.cache_write_per_mtoken ?? 0,
          p.effective_from,
        ],
      });
    }

    await runBatch(env.DB, ops);

    return jsonResponse({
      pricing_version: p.pricing_version,
      effective_from: p.effective_from,
      inserted: p.rates.length,
    });
  } catch (err) {
    return errorResponse(err);
  }
};
```

- [ ] **Step 4: Run tests**

Run: `cd site && npm test -- tests/api/pricing.test.ts`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add site/src/routes/api/v1/pricing/ site/tests/api/pricing.test.ts
git commit -m "feat(site): implement POST /api/v1/pricing (admin)"
```

---

## Task 31: Durable Object `LeaderboardBroadcaster`

One DO instance fan-outs SSE events to every connected visitor. The ingest and finalize handlers in later tasks use `broadcastEvent()` to emit `run_finalized`, `task_set_promoted`, `shortcoming_added` events.

**Files:**
- Create: `site/src/lib/server/broadcaster.ts` (client that calls into the DO)
- Create: `site/src/do/leaderboard-broadcaster.ts` (the DO class)
- Modify: `site/wrangler.toml` (add DO binding)
- Create: `site/tests/broadcaster.test.ts`

- [ ] **Step 1: Write failing test** `site/tests/broadcaster.test.ts`

```typescript
import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { broadcastEvent } from '../src/lib/server/broadcaster';

describe('LeaderboardBroadcaster', () => {
  it('accepts events via broadcastEvent (returns ok=true)', async () => {
    const ok = await broadcastEvent(env, {
      type: 'run_finalized',
      run_id: 'r1',
      model_slug: 'sonnet-4.7',
      score: 0.75,
      ts: new Date().toISOString(),
    });
    expect(ok).toBe(true);
  });

  it('returns buffered events via /recent for reconnecting clients', async () => {
    const id = env.BROADCASTER.idFromName('leaderboard');
    const stub = env.BROADCASTER.get(id);
    await stub.fetch('https://do/broadcast', {
      method: 'POST',
      body: JSON.stringify({ type: 'run_finalized', run_id: 'r-recent', ts: new Date().toISOString() }),
    });
    const res = await stub.fetch('https://do/recent?limit=10');
    const body = await res.json() as { events: Array<{ run_id?: string }> };
    expect(body.events.some((e: any) => e.run_id === 'r-recent')).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd site && npm test -- tests/broadcaster.test.ts`
Expected: FAIL — module + binding not found.

- [ ] **Step 3: Implement `site/src/do/leaderboard-broadcaster.ts`**

```typescript
import type { DurableObjectState } from '@cloudflare/workers-types';

interface BroadcastEvent {
  type: 'run_finalized' | 'task_set_promoted' | 'shortcoming_added' | 'ping';
  ts: string;
  [k: string]: unknown;
}

const MAX_BUFFERED = 100;

export class LeaderboardBroadcaster {
  private state: DurableObjectState;
  private clients: Set<WritableStreamDefaultWriter<Uint8Array>> = new Set();
  private recent: BroadcastEvent[] = [];
  private encoder = new TextEncoder();

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === '/broadcast' && req.method === 'POST') {
      const ev = await req.json() as BroadcastEvent;
      this.recent.push(ev);
      if (this.recent.length > MAX_BUFFERED) this.recent.shift();
      await this.fanout(ev);
      return new Response(JSON.stringify({ ok: true, clients: this.clients.size }), {
        headers: { 'content-type': 'application/json' },
      });
    }

    if (url.pathname === '/recent' && req.method === 'GET') {
      const limit = parseInt(url.searchParams.get('limit') ?? '20', 10);
      return new Response(
        JSON.stringify({ events: this.recent.slice(-Math.min(limit, MAX_BUFFERED)) }),
        { headers: { 'content-type': 'application/json' } },
      );
    }

    if (url.pathname === '/subscribe' && req.method === 'GET') {
      const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
      const writer = writable.getWriter();
      this.clients.add(writer);

      // Send a hello + recent buffer
      await this.writeEvent(writer, { type: 'ping', ts: new Date().toISOString() });
      for (const ev of this.recent.slice(-20)) {
        await this.writeEvent(writer, ev);
      }

      req.signal.addEventListener('abort', () => {
        this.clients.delete(writer);
        writer.close().catch(() => {});
      });

      return new Response(readable, {
        headers: {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache, no-store',
          'connection': 'keep-alive',
          'x-accel-buffering': 'no',
        },
      });
    }

    return new Response('not_found', { status: 404 });
  }

  private async fanout(ev: BroadcastEvent): Promise<void> {
    const dead: WritableStreamDefaultWriter<Uint8Array>[] = [];
    for (const w of this.clients) {
      try {
        await this.writeEvent(w, ev);
      } catch {
        dead.push(w);
      }
    }
    for (const d of dead) this.clients.delete(d);
  }

  private async writeEvent(
    w: WritableStreamDefaultWriter<Uint8Array>,
    ev: BroadcastEvent,
  ): Promise<void> {
    const msg = `event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`;
    await w.write(this.encoder.encode(msg));
  }
}
```

- [ ] **Step 4: Implement `site/src/lib/server/broadcaster.ts`**

```typescript
export interface BroadcastEvent {
  type: 'run_finalized' | 'task_set_promoted' | 'shortcoming_added';
  ts: string;
  [k: string]: unknown;
}

export async function broadcastEvent(
  env: { BROADCASTER: DurableObjectNamespace },
  ev: BroadcastEvent,
): Promise<boolean> {
  const id = env.BROADCASTER.idFromName('leaderboard');
  const stub = env.BROADCASTER.get(id);
  const res = await stub.fetch('https://do/broadcast', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(ev),
  });
  return res.ok;
}
```

- [ ] **Step 5: Update `site/wrangler.toml`**

Add the durable objects binding (and migration entry for the class) so `env.BROADCASTER` is a valid `DurableObjectNamespace`:

```toml
[[durable_objects.bindings]]
name = "BROADCASTER"
class_name = "LeaderboardBroadcaster"
script_name = "centralgauge-site"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["LeaderboardBroadcaster"]
```

Export the class from the Worker entrypoint. In `site/src/hooks.server.ts` (or create if absent):

```typescript
export { LeaderboardBroadcaster } from './do/leaderboard-broadcaster';
```

- [ ] **Step 6: Update `vitest.config.ts`**

Ensure the Durable Object is registered in the miniflare test config:

```typescript
// excerpt — add under poolOptions.workers.miniflare
durableObjects: {
  BROADCASTER: 'LeaderboardBroadcaster',
},
```

- [ ] **Step 7: Run tests**

Run: `cd site && npm test -- tests/broadcaster.test.ts`
Expected: 2 tests pass.

- [ ] **Step 8: Commit**

```bash
git add site/src/do/ site/src/lib/server/broadcaster.ts \
        site/src/hooks.server.ts site/wrangler.toml site/vitest.config.ts \
        site/tests/broadcaster.test.ts
git commit -m "feat(site): add LeaderboardBroadcaster durable object"
```

---

## Task 32: `GET /api/v1/events/live` (SSE stream)

Visitors subscribe; their connection is routed to the `LeaderboardBroadcaster` DO where the DO's `/subscribe` handler holds it open.

**Files:**
- Create: `site/src/routes/api/v1/events/live/+server.ts`
- Create: `site/tests/api/events-live.test.ts`

- [ ] **Step 1: Write failing test** `site/tests/api/events-live.test.ts`

```typescript
import { env, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

describe('GET /api/v1/events/live', () => {
  it('returns SSE stream with correct content-type', async () => {
    const controller = new AbortController();
    const res = await SELF.fetch('https://x/api/v1/events/live', { signal: controller.signal });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    expect(res.headers.get('cache-control')).toContain('no-cache');
    controller.abort();
  });

  it('streams buffered events to new subscribers', async () => {
    const id = env.BROADCASTER.idFromName('leaderboard');
    const stub = env.BROADCASTER.get(id);
    await stub.fetch('https://do/broadcast', {
      method: 'POST',
      body: JSON.stringify({ type: 'run_finalized', run_id: 'r-buffered', ts: new Date().toISOString() }),
    });

    const controller = new AbortController();
    const res = await SELF.fetch('https://x/api/v1/events/live', { signal: controller.signal });
    const reader = res.body!.getReader();
    let text = '';
    const decoder = new TextDecoder();
    const timer = setTimeout(() => controller.abort(), 1500);
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        if (text.includes('r-buffered')) break;
      }
    } catch { /* aborted */ }
    clearTimeout(timer);
    expect(text).toContain('r-buffered');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd site && npm test -- tests/api/events-live.test.ts`
Expected: FAIL — route not found.

- [ ] **Step 3: Implement `site/src/routes/api/v1/events/live/+server.ts`**

```typescript
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ request, platform }) => {
  const env = platform!.env;
  const id = env.BROADCASTER.idFromName('leaderboard');
  const stub = env.BROADCASTER.get(id);
  return stub.fetch(new Request('https://do/subscribe', { method: 'GET', signal: request.signal }));
};
```

- [ ] **Step 4: Run tests**

Run: `cd site && npm test -- tests/api/events-live.test.ts`
Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add site/src/routes/api/v1/events/ site/tests/api/events-live.test.ts
git commit -m "feat(site): implement GET /api/v1/events/live (SSE)"
```

---

## Task 33: Wire broadcaster into ingest + finalize + promote

Emits events on the DO whenever meaningful state changes so connected visitors see live updates without refresh.

**Files:**
- Modify: `site/src/routes/api/v1/runs/[id]/finalize/+server.ts` (broadcast `run_finalized`)
- Modify: `site/src/routes/api/v1/task-sets/[hash]/current/+server.ts` (broadcast `task_set_promoted`)
- Modify: `site/src/routes/api/v1/shortcomings/batch/+server.ts` (broadcast `shortcoming_added`)
- Modify: `site/tests/api/runs-finalize.test.ts` (assert broadcaster called)

- [ ] **Step 1: Extend finalize test**

Add in `site/tests/api/runs-finalize.test.ts`:

```typescript
it('broadcasts run_finalized after completion', async () => {
  // ... existing test setup producing a finalizable run_id ...
  const res = await SELF.fetch(finalizeReq);
  expect(res.status).toBe(200);

  const id = env.BROADCASTER.idFromName('leaderboard');
  const stub = env.BROADCASTER.get(id);
  const recent = await (await stub.fetch('https://do/recent?limit=5')).json() as { events: Array<any> };
  expect(recent.events.some(e => e.type === 'run_finalized' && e.run_id === finalizedRunId)).toBe(true);
});
```

(Adapt variable names to whatever the existing finalize test uses.)

- [ ] **Step 2: Run to verify failure**

Run: `cd site && npm test -- tests/api/runs-finalize.test.ts`
Expected: FAIL — broadcast assertion unmet.

- [ ] **Step 3: Modify `site/src/routes/api/v1/runs/[id]/finalize/+server.ts`**

After marking the run completed and invalidating caches, add:

```typescript
import { broadcastEvent } from '$lib/server/broadcaster';

// ... existing finalize logic ...

await broadcastEvent(env, {
  type: 'run_finalized',
  run_id: runId,
  model_slug: modelSlug,
  tier: run.tier,
  score: avgScore,
  ts: new Date().toISOString(),
});
```

Compute `avgScore` with:

```sql
SELECT AVG(score) AS avg_score FROM results WHERE run_id = ?
```

- [ ] **Step 4: Modify `site/src/routes/api/v1/task-sets/[hash]/current/+server.ts`**

After promotion, add:

```typescript
await broadcastEvent(env, {
  type: 'task_set_promoted',
  hash,
  ts: new Date().toISOString(),
});
```

- [ ] **Step 5: Modify `site/src/routes/api/v1/shortcomings/batch/+server.ts`**

After upserts, if `upserted > 0`, emit:

```typescript
await broadcastEvent(env, {
  type: 'shortcoming_added',
  model_slug: batch.model_slug,
  count: upserted,
  ts: new Date().toISOString(),
});
```

- [ ] **Step 6: Run tests**

Run: `cd site && npm test`
Expected: all existing tests still pass, plus the new broadcaster assertion.

- [ ] **Step 7: Commit**

```bash
git add site/src/routes/api/v1/
git commit -m "feat(site): broadcast SSE events on finalize, promote, shortcoming"
```

---

## Task 34: Rate limiting + request logging middleware

Enforces per-IP write limits (60 req/min) and adds structured logs every request. Read endpoints are unlimited (they're edge-cached anyway).

**Files:**
- Create: `site/src/lib/server/rate-limit.ts`
- Modify: `site/src/hooks.server.ts`
- Create: `site/tests/rate-limit.test.ts`

- [ ] **Step 1: Write failing test** `site/tests/rate-limit.test.ts`

```typescript
import { env, applyD1Migrations, SELF } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { generateKeyPair, signRequest } from './test-helpers/signing';

beforeAll(async () => { await applyD1Migrations(env.DB, env.TEST_MIGRATIONS); });

beforeEach(async () => {
  await env.DB.prepare(`DELETE FROM machine_keys`).run();
  const keys = await env.KV.list({ prefix: 'rl:' });
  for (const k of keys.keys) await env.KV.delete(k.name);
});

describe('rate limiting', () => {
  it('allows bursts under the limit', async () => {
    const key = await generateKeyPair(env.DB, 'rl-a', 'ingest');
    for (let i = 0; i < 10; i++) {
      const req = await signRequest(key, 'POST', 'https://x/api/v1/task-sets', { hash: `h-${i}`, version: 'v1', tasks: [] });
      const res = await SELF.fetch(req, { headers: { 'cf-connecting-ip': '1.2.3.4' } });
      expect(res.status).not.toBe(429);
    }
  });

  it('returns 429 once per-IP burst exceeded', async () => {
    const key = await generateKeyPair(env.DB, 'rl-b', 'ingest');
    let got429 = false;
    for (let i = 0; i < 80; i++) {
      const req = await signRequest(key, 'POST', 'https://x/api/v1/task-sets', { hash: `h-${i}`, version: 'v1', tasks: [] });
      const res = await SELF.fetch(req, { headers: { 'cf-connecting-ip': '5.6.7.8' } });
      if (res.status === 429) { got429 = true; break; }
    }
    expect(got429).toBe(true);
  });

  it('does not rate limit GET endpoints', async () => {
    for (let i = 0; i < 100; i++) {
      const res = await SELF.fetch('https://x/api/v1/leaderboard', { headers: { 'cf-connecting-ip': '9.9.9.9' } });
      expect(res.status).not.toBe(429);
    }
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd site && npm test -- tests/rate-limit.test.ts`
Expected: FAIL — rate limiting not implemented.

- [ ] **Step 3: Implement `site/src/lib/server/rate-limit.ts`**

```typescript
const LIMIT = 60;
const WINDOW_SECONDS = 60;

export async function isRateLimited(
  env: { KV: KVNamespace },
  ip: string,
): Promise<{ limited: boolean; remaining: number; retry_after: number }> {
  const now = Math.floor(Date.now() / 1000);
  const bucket = Math.floor(now / WINDOW_SECONDS);
  const key = `rl:${ip}:${bucket}`;

  const raw = await env.KV.get(key);
  const count = raw ? parseInt(raw, 10) : 0;
  const next = count + 1;

  await env.KV.put(key, String(next), { expirationTtl: WINDOW_SECONDS * 2 });

  const limited = next > LIMIT;
  return {
    limited,
    remaining: Math.max(0, LIMIT - next),
    retry_after: (bucket + 1) * WINDOW_SECONDS - now,
  };
}
```

- [ ] **Step 4: Wire into `site/src/hooks.server.ts`**

```typescript
import type { Handle } from '@sveltejs/kit';
import { isRateLimited } from '$lib/server/rate-limit';
export { LeaderboardBroadcaster } from './do/leaderboard-broadcaster';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const handle: Handle = async ({ event, resolve }) => {
  const start = Date.now();
  const isWrite = WRITE_METHODS.has(event.request.method);
  const isApi = event.url.pathname.startsWith('/api/');

  if (isWrite && isApi) {
    const ip = event.request.headers.get('cf-connecting-ip') ?? 'unknown';
    const rl = await isRateLimited(event.platform!.env, ip);
    if (rl.limited) {
      return new Response(
        JSON.stringify({ error: { code: 'rate_limited', message: 'Too many requests' } }),
        {
          status: 429,
          headers: {
            'content-type': 'application/json',
            'retry-after': String(rl.retry_after),
            'x-ratelimit-remaining': String(rl.remaining),
          },
        },
      );
    }
  }

  const res = await resolve(event);
  const durMs = Date.now() - start;
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    method: event.request.method,
    path: event.url.pathname,
    status: res.status,
    dur_ms: durMs,
    ip: event.request.headers.get('cf-connecting-ip'),
  }));
  return res;
};
```

- [ ] **Step 5: Run tests**

Run: `cd site && npm test -- tests/rate-limit.test.ts`
Expected: 3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add site/src/lib/server/rate-limit.ts site/src/hooks.server.ts site/tests/rate-limit.test.ts
git commit -m "feat(site): add per-IP rate limiting + request logs"
```

---

## Task 35: Machine key bootstrap — keygen CLI + `POST /api/v1/admin/keys`

Bootstraps machine identities: admins generate a local Ed25519 keypair, then POST the public key to `/api/v1/admin/keys` (signed with an existing admin key). A seed script inserts the very first admin key directly into D1 as the zero-knowledge root of trust.

**Files:**
- Create: `site/src/routes/api/v1/admin/keys/+server.ts`
- Create: `scripts/generate-machine-key.ts` (Deno CLI)
- Create: `scripts/seed-admin-key.ts` (one-shot D1 seed)
- Create: `site/tests/api/admin-keys.test.ts`

- [ ] **Step 1: Write failing test** `site/tests/api/admin-keys.test.ts`

```typescript
import { env, applyD1Migrations, SELF } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { generateKeyPair, signRequest } from '../test-helpers/signing';
import * as ed from '@noble/ed25519';
import { base64Encode } from '../../src/lib/shared/base64';

beforeAll(async () => { await applyD1Migrations(env.DB, env.TEST_MIGRATIONS); });

let adminKey: { id: number; privateKey: Uint8Array };
beforeEach(async () => {
  await env.DB.prepare(`DELETE FROM machine_keys`).run();
  adminKey = await generateKeyPair(env.DB, 'root', 'admin');
});

describe('POST /api/v1/admin/keys', () => {
  it('registers a new machine key', async () => {
    const newPriv = ed.utils.randomPrivateKey();
    const newPub = await ed.getPublicKeyAsync(newPriv);
    const req = await signRequest(adminKey, 'POST', 'https://x/api/v1/admin/keys', {
      machine_id: 'new-rig',
      public_key_base64: base64Encode(newPub),
      scope: 'ingest',
    });
    const res = await SELF.fetch(req);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.id).toBeGreaterThan(0);
    expect(body.machine_id).toBe('new-rig');

    const stored = await env.DB.prepare(`SELECT scope FROM machine_keys WHERE id = ?`).bind(body.id).first<{ scope: string }>();
    expect(stored?.scope).toBe('ingest');
  });

  it('rejects duplicate (machine_id, public_key)', async () => {
    const newPriv = ed.utils.randomPrivateKey();
    const newPub = await ed.getPublicKeyAsync(newPriv);
    const body = {
      machine_id: 'dup-rig',
      public_key_base64: base64Encode(newPub),
      scope: 'ingest' as const,
    };
    await SELF.fetch(await signRequest(adminKey, 'POST', 'https://x/api/v1/admin/keys', body));
    const res = await SELF.fetch(await signRequest(adminKey, 'POST', 'https://x/api/v1/admin/keys', body));
    expect(res.status).toBe(409);
  });

  it('rejects non-admin scope', async () => {
    const ingest = await generateKeyPair(env.DB, 'i', 'ingest');
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);
    const req = await signRequest(ingest, 'POST', 'https://x/api/v1/admin/keys', {
      machine_id: 'x', public_key_base64: base64Encode(pub), scope: 'ingest',
    });
    const res = await SELF.fetch(req);
    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/v1/admin/keys/:id', () => {
  it('revokes a key', async () => {
    const target = await generateKeyPair(env.DB, 'target', 'ingest');
    const req = await signRequest(adminKey, 'DELETE', `https://x/api/v1/admin/keys/${target.id}`, {
      key_id: target.id,
    });
    const res = await SELF.fetch(req);
    expect(res.status).toBe(200);
    const row = await env.DB.prepare(`SELECT revoked_at FROM machine_keys WHERE id = ?`).bind(target.id).first<{ revoked_at: string | null }>();
    expect(row?.revoked_at).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd site && npm test -- tests/api/admin-keys.test.ts`
Expected: FAIL — routes not found.

- [ ] **Step 3: Implement `site/src/routes/api/v1/admin/keys/+server.ts`**

```typescript
import type { RequestHandler } from './$types';
import { verifySignedRequest } from '$lib/server/signature';
import { getFirst } from '$lib/server/db';
import { ApiError, errorResponse, jsonResponse } from '$lib/server/errors';
import { base64Decode } from '$lib/shared/base64';

interface RegisterKeyPayload {
  machine_id: string;
  public_key_base64: string;
  scope: 'ingest' | 'verifier' | 'admin';
}

export const POST: RequestHandler = async ({ request, platform }) => {
  const env = platform!.env;
  try {
    await verifySignedRequest(env.DB, request, 'admin');
    const { payload } = await verifySignedRequest.parsed(request);
    // Note: calling verifySignedRequest again here is wasteful; assume it returns payload.
    // Simpler: rely on first call's returned value — adjust middleware to return payload.
    const p = payload as unknown as RegisterKeyPayload;

    if (!['ingest', 'verifier', 'admin'].includes(p.scope)) {
      throw new ApiError(400, 'invalid_scope', 'scope must be ingest|verifier|admin');
    }

    const pub = base64Decode(p.public_key_base64);
    if (pub.length !== 32) throw new ApiError(400, 'invalid_public_key', 'Ed25519 public keys are 32 bytes');

    const existing = await getFirst<{ id: number }>(
      env.DB,
      `SELECT id FROM machine_keys WHERE machine_id = ? AND public_key = ?`,
      [p.machine_id, pub],
    );
    if (existing) throw new ApiError(409, 'duplicate_key', 'machine_id + public_key already registered');

    const row = await env.DB.prepare(
      `INSERT INTO machine_keys(machine_id, public_key, scope, created_at) VALUES (?,?,?,?) RETURNING id`
    ).bind(p.machine_id, pub, p.scope, new Date().toISOString()).first<{ id: number }>();
    if (!row) throw new Error('insert_failed');

    return jsonResponse({ id: row.id, machine_id: p.machine_id, scope: p.scope });
  } catch (err) {
    return errorResponse(err);
  }
};
```

(The `verifySignedRequest.parsed` hack is only because the first call validates *and* returns the payload. In the actual implementation, call it once and reuse the returned `{ payload }`.)

Clean re-implementation:

```typescript
export const POST: RequestHandler = async ({ request, platform }) => {
  const env = platform!.env;
  try {
    const { payload } = await verifySignedRequest(env.DB, request, 'admin');
    const p = payload as unknown as RegisterKeyPayload;
    // ... (rest unchanged) ...
  } catch (err) { return errorResponse(err); }
};
```

- [ ] **Step 4: Implement `site/src/routes/api/v1/admin/keys/[id]/+server.ts` (DELETE)**

```typescript
import type { RequestHandler } from './$types';
import { verifySignedRequest } from '$lib/server/signature';
import { getFirst } from '$lib/server/db';
import { ApiError, errorResponse, jsonResponse } from '$lib/server/errors';

export const DELETE: RequestHandler = async ({ request, params, platform }) => {
  const env = platform!.env;
  try {
    await verifySignedRequest(env.DB, request, 'admin');
    const id = parseInt(params.id!, 10);
    if (!Number.isFinite(id) || id <= 0) throw new ApiError(400, 'invalid_id', 'id must be positive integer');

    const existing = await getFirst<{ revoked_at: string | null }>(
      env.DB, `SELECT revoked_at FROM machine_keys WHERE id = ?`, [id],
    );
    if (!existing) throw new ApiError(404, 'key_not_found', `No key ${id}`);
    if (existing.revoked_at) return jsonResponse({ id, revoked_at: existing.revoked_at, changed: false });

    const now = new Date().toISOString();
    await env.DB.prepare(`UPDATE machine_keys SET revoked_at = ? WHERE id = ?`).bind(now, id).run();
    return jsonResponse({ id, revoked_at: now, changed: true });
  } catch (err) {
    return errorResponse(err);
  }
};
```

- [ ] **Step 5: Create `scripts/generate-machine-key.ts` (Deno CLI)**

```typescript
#!/usr/bin/env -S deno run --allow-write --allow-read --allow-env
import * as ed from 'npm:@noble/ed25519@2.1.0';
import { encode as b64Encode } from 'https://deno.land/std@0.210.0/encoding/base64.ts';
import { ensureDir } from 'https://deno.land/std@0.210.0/fs/ensure_dir.ts';
import { dirname, resolve } from 'https://deno.land/std@0.210.0/path/mod.ts';

const outPath = Deno.args[0] ?? resolve(Deno.env.get('HOME')!, '.centralgauge/keys/ingest.ed25519');
await ensureDir(dirname(outPath));

const privateKey = ed.utils.randomPrivateKey();
const publicKey = await ed.getPublicKeyAsync(privateKey);

await Deno.writeFile(outPath, privateKey, { mode: 0o600 });
await Deno.writeTextFile(outPath + '.pub', b64Encode(publicKey) + '\n');

console.log(`Private key -> ${outPath}`);
console.log(`Public key (base64):  ${b64Encode(publicKey)}`);
console.log(`\nRegister with:`);
console.log(`  centralgauge admin register-key --machine-id <id> --scope ingest --public-key-file ${outPath}.pub`);
```

- [ ] **Step 6: Create `scripts/seed-admin-key.ts`**

Creates the zero-knowledge root admin key. Run exactly once per environment.

```typescript
#!/usr/bin/env -S deno run --allow-read --allow-env --allow-run
// Seeds the first admin key into D1 so further keys can be registered via the API.
// Usage: deno run scripts/seed-admin-key.ts <db-name> <machine-id> <public-key-base64>
import { decode as b64Decode } from 'https://deno.land/std@0.210.0/encoding/base64.ts';

const [dbName, machineId, pubB64] = Deno.args;
if (!dbName || !machineId || !pubB64) {
  console.error('Usage: seed-admin-key.ts <db-name> <machine-id> <public-key-base64>');
  Deno.exit(2);
}
const pub = b64Decode(pubB64);
if (pub.length !== 32) { console.error('public key must be 32 bytes'); Deno.exit(2); }
const hex = Array.from(pub).map((b) => b.toString(16).padStart(2, '0')).join('');

const sql = `INSERT INTO machine_keys(machine_id, public_key, scope, created_at)
             VALUES ('${machineId}', x'${hex}', 'admin', '${new Date().toISOString()}');`;

const cmd = new Deno.Command('npx', {
  args: ['wrangler', 'd1', 'execute', dbName, '--remote', '--command', sql],
  stdout: 'inherit',
  stderr: 'inherit',
});
const { code } = await cmd.output();
Deno.exit(code);
```

- [ ] **Step 7: Run tests**

Run: `cd site && npm test -- tests/api/admin-keys.test.ts`
Expected: 4 tests pass.

- [ ] **Step 8: Commit**

```bash
git add site/src/routes/api/v1/admin/ \
        site/tests/api/admin-keys.test.ts \
        scripts/generate-machine-key.ts scripts/seed-admin-key.ts
git commit -m "feat: admin key registration + keygen + seed scripts"
```

---

## Task 36: End-to-end integration test

Proves the full ingest→read loop: sign a fixture run, POST task-set, POST runs, PUT blobs, POST finalize, then GET through every read endpoint and confirm the payload round-trips.

**Files:**
- Create: `site/tests/e2e/full-ingest.test.ts`
- Create: `site/tests/e2e/fixtures/run.json`

- [ ] **Step 1: Create fixture `site/tests/e2e/fixtures/run.json`**

```json
{
  "task_set": {
    "version": "v-e2e",
    "tasks": [
      { "id": "easy/alpha", "category_slug": "easy", "version": 1, "yaml_r2_key": null }
    ]
  },
  "transcript_plain": "TEST TRANSCRIPT: compiled ok, 3/3 tests passed.\n",
  "code_plain": "page 50000 CustomerListTest { }\n"
}
```

- [ ] **Step 2: Write failing test** `site/tests/e2e/full-ingest.test.ts`

```typescript
import { env, applyD1Migrations, SELF } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { generateKeyPair, signRequest } from '../test-helpers/signing';
import fixture from './fixtures/run.json';
import { sha256Hex } from '../../src/lib/shared/hash';
import { base64Encode } from '../../src/lib/shared/base64';
import { canonicalJson } from '../../src/lib/shared/canonical';

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

describe('E2E: sign -> ingest -> upload -> finalize -> read', () => {
  it('round-trips a run through every endpoint', async () => {
    // 0. Clean slate
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM ingest_events`),
      env.DB.prepare(`DELETE FROM results`),
      env.DB.prepare(`DELETE FROM runs`),
      env.DB.prepare(`DELETE FROM tasks`),
      env.DB.prepare(`DELETE FROM task_categories`),
      env.DB.prepare(`DELETE FROM task_sets`),
      env.DB.prepare(`DELETE FROM settings_profiles`),
      env.DB.prepare(`DELETE FROM cost_snapshots`),
      env.DB.prepare(`DELETE FROM models`),
      env.DB.prepare(`DELETE FROM model_families`),
      env.DB.prepare(`DELETE FROM machine_keys`),
    ]);
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO model_families(id,slug,vendor,display_name) VALUES (1,'claude','anthropic','Claude')`),
      env.DB.prepare(`INSERT INTO models(id,family_id,slug,api_model_id,display_name) VALUES (1,1,'sonnet-4.7','claude-sonnet-4-7','Sonnet 4.7')`),
      env.DB.prepare(`INSERT INTO task_categories(id,slug,display_name,difficulty) VALUES (1,'easy','Easy','easy')`),
      env.DB.prepare(`INSERT INTO cost_snapshots(pricing_version,model_id,input_per_mtoken,output_per_mtoken,effective_from) VALUES ('v2026-04',1,3,15,'2026-04-01')`),
    ]);
    const admin = await generateKeyPair(env.DB, 'admin', 'admin');
    const ingest = await generateKeyPair(env.DB, 'rig', 'ingest');

    // 1. Register task set
    const taskSetHash = await sha256Hex(new TextEncoder().encode(canonicalJson(fixture.task_set)));
    const tsReq = await signRequest(admin, 'POST', 'https://x/api/v1/task-sets', {
      hash: taskSetHash,
      version: fixture.task_set.version,
      tasks: fixture.task_set.tasks,
      make_current: true,
    });
    const tsRes = await SELF.fetch(tsReq);
    expect(tsRes.status).toBe(200);

    // 2. Compute blob hashes and the run payload
    const transcriptBytes = new TextEncoder().encode(fixture.transcript_plain);
    const codeBytes = new TextEncoder().encode(fixture.code_plain);
    const transcriptHash = await sha256Hex(transcriptBytes);
    const codeHash = await sha256Hex(codeBytes);

    const startedAt = '2026-04-17T10:00:00Z';
    const completedAt = '2026-04-17T10:05:00Z';
    const runPayload = {
      task_set_hash: taskSetHash,
      model: { slug: 'sonnet-4.7', api_model_id: 'claude-sonnet-4-7', family_slug: 'claude' },
      settings: { temperature: 0, max_attempts: 2, max_tokens: 8192, prompt_version: 'v3', bc_version: 'Cronus28' },
      machine_id: 'rig',
      started_at: startedAt,
      completed_at: completedAt,
      centralgauge_sha: 'abcd123',
      pricing_version: 'v2026-04',
      reproduction_bundle_sha256: 'f'.repeat(64),
      results: [
        {
          task_id: 'easy/alpha', attempt: 1, passed: true, score: 1.0,
          compile_success: true, compile_errors: [], tests_total: 3, tests_passed: 3,
          tokens_in: 1000, tokens_out: 500, tokens_cache_read: 0, tokens_cache_write: 0,
          llm_duration_ms: 1500, compile_duration_ms: 3000, test_duration_ms: 2000,
          transcript_sha256: transcriptHash, code_sha256: codeHash,
          failure_reasons: [],
        },
      ],
    };

    // 3. POST /runs (signed)
    const runReq = await signRequest(ingest, 'POST', 'https://x/api/v1/runs', runPayload);
    const runRes = await SELF.fetch(runReq);
    expect(runRes.status).toBe(200);
    const runBody = await runRes.json() as { run_id: string; missing_blobs: string[] };
    expect(runBody.missing_blobs).toContain(transcriptHash);
    expect(runBody.missing_blobs).toContain(codeHash);

    // 4. PUT missing blobs
    for (const [hash, bytes] of [[transcriptHash, transcriptBytes], [codeHash, codeBytes]] as const) {
      const res = await SELF.fetch(`https://x/api/v1/blobs/${hash}`, {
        method: 'PUT',
        body: bytes,
        headers: { 'content-type': 'application/octet-stream' },
      });
      expect(res.status).toBe(200);
    }

    // 5. POST /runs/:id/finalize
    const finReq = await signRequest(ingest, 'POST', `https://x/api/v1/runs/${runBody.run_id}/finalize`, { run_id: runBody.run_id });
    const finRes = await SELF.fetch(finReq);
    expect(finRes.status).toBe(200);

    // 6. GET leaderboard — our run should appear
    const lbRes = await SELF.fetch('https://x/api/v1/leaderboard');
    expect(lbRes.status).toBe(200);
    const lb = await lbRes.json() as { data: Array<any> };
    const entry = lb.data.find((r: any) => r.model.slug === 'sonnet-4.7');
    expect(entry).toBeTruthy();
    expect(entry.run_count).toBe(1);
    expect(entry.avg_score).toBe(1.0);

    // 7. GET /runs/:id returns detail with results + cost
    const detail = await (await SELF.fetch(`https://x/api/v1/runs/${runBody.run_id}`)).json() as any;
    expect(detail.results).toHaveLength(1);
    const expectedCost = (1000 * 3 + 500 * 15) / 1_000_000;
    expect(detail.results[0].cost_usd).toBeCloseTo(expectedCost, 6);

    // 8. GET /runs/:id/signature — signature re-verifiable
    const sigRes = await SELF.fetch(`https://x/api/v1/runs/${runBody.run_id}/signature`);
    expect(sigRes.status).toBe(200);
    const sig = await sigRes.json() as any;
    expect(sig.signature.alg).toBe('Ed25519');

    // 9. GET /tasks/:id — includes solved-by row for our model
    const taskRes = await SELF.fetch('https://x/api/v1/tasks/easy/alpha');
    expect(taskRes.status).toBe(200);
    const task = await taskRes.json() as any;
    expect(task.solved_by).toHaveLength(1);
    expect(task.solved_by[0].model_slug).toBe('sonnet-4.7');

    // 10. GET /transcripts/:key
    const transcriptRes = await SELF.fetch(`https://x/api/v1/transcripts/${transcriptHash}.txt`);
    expect(transcriptRes.status).toBe(200);
    expect(await transcriptRes.text()).toBe(fixture.transcript_plain);

    // 11. SSE broadcaster saw a run_finalized
    const id = env.BROADCASTER.idFromName('leaderboard');
    const stub = env.BROADCASTER.get(id);
    const recent = await (await stub.fetch('https://do/recent?limit=5')).json() as { events: Array<any> };
    expect(recent.events.some(e => e.type === 'run_finalized' && e.run_id === runBody.run_id)).toBe(true);

    // 12. GET /sync/health reports rig as healthy
    const health = await (await SELF.fetch('https://x/api/v1/sync/health')).json() as any;
    expect(health.machines.some((m: any) => m.machine_id === 'rig' && m.status === 'healthy')).toBe(true);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `cd site && npm test -- tests/e2e/full-ingest.test.ts`
Expected: Likely FAIL initially — mostly on signing helper, transcript format expectations, or blob key mappings. Fix iteratively.

- [ ] **Step 4: Resolve anything broken**

Common fixups this test typically surfaces:
- `settings_profiles.hash` collision when `settings` is stringified inconsistently — ensure both client (signRequest) and server canonicalize the same way.
- `reproduction_bundle_sha256` length not 64 — either store in `reproduction_bundle_r2_key` or omit from fixture.
- `tasks/easy/alpha` not in task set — verify that `POST /task-sets` inserts tasks.

If any issue is in the original implementations from earlier tasks, fix there rather than the test.

- [ ] **Step 5: Run tests**

Run: `cd site && npm test -- tests/e2e/full-ingest.test.ts`
Expected: 1 test passes (12 assertions inside).

- [ ] **Step 6: Commit**

```bash
git add site/tests/e2e/
git commit -m "test(site): add end-to-end ingest → read integration test"
```

---

## Task 37: Nightly D1→R2 backup cron + docs

Adds a Cron Trigger that exports D1 to R2 every night. Documents the full P1 surface and updates the top-level project README.

**Files:**
- Create: `site/src/cron/nightly-backup.ts`
- Modify: `site/wrangler.toml` (add cron trigger + scheduled handler)
- Create: `site/tests/cron/nightly-backup.test.ts`
- Create: `docs/architecture/results-db.md`

- [ ] **Step 1: Write failing test** `site/tests/cron/nightly-backup.test.ts`

```typescript
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { runNightlyBackup } from '../../src/cron/nightly-backup';
import { applyD1Migrations } from 'cloudflare:test';

beforeAll(async () => { await applyD1Migrations(env.DB, env.TEST_MIGRATIONS); });

describe('nightly backup cron', () => {
  it('writes a dated R2 object under backups/', async () => {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO model_families(id,slug,vendor,display_name) VALUES (99,'test','v','T')`
    ).run();

    const date = new Date('2026-04-17T02:00:00Z');
    const key = await runNightlyBackup(env, date);
    expect(key).toBe('backups/d1-20260417.sql');

    const obj = await env.R2.get(key);
    expect(obj).not.toBeNull();
    const text = await obj!.text();
    expect(text).toContain('INSERT INTO model_families');
    expect(text).toContain("'test'");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd site && npm test -- tests/cron/nightly-backup.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `site/src/cron/nightly-backup.ts`**

```typescript
export async function runNightlyBackup(
  env: { DB: D1Database; R2: R2Bucket },
  now: Date = new Date(),
): Promise<string> {
  const tables = await env.DB.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%_fts%'`
  ).all<{ name: string }>();

  const lines: string[] = [];
  lines.push(`-- CentralGauge D1 backup ${now.toISOString()}`);

  for (const t of tables.results) {
    const rows = await env.DB.prepare(`SELECT * FROM ${t.name}`).all<Record<string, unknown>>();
    for (const r of rows.results) {
      const cols = Object.keys(r);
      const vals = cols.map((c) => sqlEscape(r[c]));
      lines.push(`INSERT INTO ${t.name}(${cols.join(',')}) VALUES(${vals.join(',')});`);
    }
  }

  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  const key = `backups/d1-${yyyy}${mm}${dd}.sql`;

  const text = lines.join('\n') + '\n';
  await env.R2.put(key, text);
  return key;
}

function sqlEscape(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  if (v instanceof ArrayBuffer || v instanceof Uint8Array) {
    const bytes = v instanceof Uint8Array ? v : new Uint8Array(v);
    const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
    return `x'${hex}'`;
  }
  return `'${String(v).replace(/'/g, "''")}'`;
}
```

- [ ] **Step 4: Wire cron trigger**

In `site/src/hooks.server.ts` add:

```typescript
import { runNightlyBackup } from './cron/nightly-backup';

export const scheduled = async (
  _controller: ScheduledController,
  env: { DB: D1Database; R2: R2Bucket },
  ctx: ExecutionContext,
): Promise<void> => {
  ctx.waitUntil(runNightlyBackup(env));
};
```

In `site/wrangler.toml`:

```toml
[triggers]
crons = ["0 2 * * *"]
```

- [ ] **Step 5: Run tests**

Run: `cd site && npm test -- tests/cron/nightly-backup.test.ts`
Expected: 1 test passes.

- [ ] **Step 6: Create `docs/architecture/results-db.md`**

```markdown
# Benchmark Results DB — Architecture

**Status:** P1 shipped. See `docs/superpowers/specs/2026-04-17-benchmark-results-db-design.md` for full design.

## What P1 delivers

- D1 schema (migrations `0001_core.sql`, `0002_fts.sql`)
- R2 layout: `transcripts/`, `code/`, `shortcomings/`, `reproductions/`, `backups/`
- KV leaderboard cache invalidated on finalize / task-set promotion
- Ed25519-signed ingest (scope hierarchy: ingest < verifier < admin)
- Full public read surface: leaderboard, families, models, tasks, runs,
  transcripts, compare, search (FTS), sync/health
- Durable Object SSE broadcaster (`/api/v1/events/live`)
- Nightly D1→R2 backup cron

## Endpoints at a glance

| Method | Path | Auth |
|---|---|---|
| POST | /api/v1/task-sets | ingest |
| POST | /api/v1/task-sets/:hash/current | admin |
| POST | /api/v1/runs | ingest |
| PUT  | /api/v1/blobs/:sha256 | (hash-validated; unsigned) |
| POST | /api/v1/runs/:id/finalize | ingest |
| POST | /api/v1/shortcomings/batch | verifier |
| POST | /api/v1/verify | verifier |
| POST | /api/v1/pricing | admin |
| POST | /api/v1/admin/keys | admin |
| DELETE | /api/v1/admin/keys/:id | admin |
| GET  | /api/v1/leaderboard | public |
| GET  | /api/v1/families | public |
| GET  | /api/v1/families/:slug | public |
| GET  | /api/v1/models | public |
| GET  | /api/v1/models/:slug | public |
| GET  | /api/v1/models/:slug/limitations | public |
| GET  | /api/v1/tasks | public |
| GET  | /api/v1/tasks/:id | public |
| GET  | /api/v1/runs | public |
| GET  | /api/v1/runs/:id | public |
| GET  | /api/v1/runs/:id/signature | public |
| GET  | /api/v1/runs/:id/reproduce.tar.gz | public |
| GET  | /api/v1/transcripts/:key | public |
| GET  | /api/v1/compare | public |
| GET  | /api/v1/search | public |
| GET  | /api/v1/sync/health | public |
| GET  | /api/v1/events/live | public (SSE) |

## Next (P2+)

- Scoreboard SvelteKit pages consuming these APIs
- `centralgauge sync` outbox worker (replaces `.pending` sidecars)
- `centralgauge migrate-results` historical import
- Shortcomings analyzer running against finalized runs
- Vectorize semantic search on failure messages (deferred)
```

- [ ] **Step 7: Commit**

```bash
git add site/src/cron/ site/src/hooks.server.ts site/wrangler.toml \
        site/tests/cron/ docs/architecture/results-db.md
git commit -m "feat(site): nightly D1->R2 backup cron + P1 architecture doc"
```

---

## End of P1 (and end of Part 4)

Every endpoint in the spec's API table is now shipped, tested, and commit-staged. The full ingest→read path has been exercised end-to-end.

**Success check for Part 4 (and all of P1):**

```bash
cd site && npm test
```

Expected: entire suite green — Parts 1–4 together produce ~60 tests across unit + integration + e2e.

Also:

```bash
cd site && npx wrangler deploy --dry-run
```

Expected: no type or binding errors.

## What's next

P1 closes. The remaining rollout phases from the spec (§9) are:

- **P2 — Bench outbox + sync:** swap `.pending` sidecars for the SQLite outbox; implement the `sync` worker; add reproduction bundle creation on the bench side; `migrate-results` for the historical import.
- **P3 — Scoreboard UI:** SvelteKit pages for landing, family trajectory, model detail, run detail, compare, search, methodology.
- **P4 — Verified tier + reproduction:** verifier workflow; comparison report; CI job that re-runs a random finalized run nightly for drift detection.
- **P5 — Live SSE UI integration + performance polish:** leaderboard reacts to events on the client.
- **P6 — Shortcomings analyzer rewrite:** reads from D1, writes back via `POST /shortcomings/batch`.
- **P7 — Vectorize semantic failure search:** optional, post-launch.

Open the next plan when ready: `docs/superpowers/plans/2026-04-17-p2-bench-outbox.md`.
