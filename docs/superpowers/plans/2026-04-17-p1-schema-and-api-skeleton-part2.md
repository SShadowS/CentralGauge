# P1 — Schema + API Skeleton Implementation Plan (Part 2: Ingest)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Part 1 (Tasks 1–10) must be complete before starting Part 2.

**Scope:** Tasks 11–17. Builds the ingest pipeline: D1 helpers, API error/response formatting, Ed25519 signature middleware, and the four core write endpoints (`POST /task-sets`, `POST /runs`, `PUT /blobs/:sha256`, `POST /runs/:id/finalize`).

**Prerequisites:** Part 1 complete. `site/src/lib/shared/{canonical,hash,ed25519,base64,types}.ts` and migrations 0001 + 0002 must be in place.

**Spec reference:** `docs/superpowers/specs/2026-04-17-benchmark-results-db-design.md` sections 5–6.

---

## Task 11: D1 query helpers + transaction wrapper

**Files:**
- Create: `site/src/lib/server/db.ts`
- Create: `site/tests/db.test.ts`

- [ ] **Step 1: Write failing test** `site/tests/db.test.ts`

```typescript
import { env, applyD1Migrations } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { getFirst, getAll, runBatch, insertAndReturnId } from '../src/lib/server/db';

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

describe('db helpers', () => {
  it('getFirst returns the first row or null', async () => {
    await env.DB.prepare(`INSERT OR IGNORE INTO model_families(id,slug,vendor,display_name) VALUES (10,'xf','xvendor','XF')`).run();
    const row = await getFirst<{ slug: string }>(env.DB, `SELECT slug FROM model_families WHERE id = ?`, [10]);
    expect(row?.slug).toBe('xf');

    const none = await getFirst<{ slug: string }>(env.DB, `SELECT slug FROM model_families WHERE id = ?`, [999999]);
    expect(none).toBeNull();
  });

  it('getAll returns an array', async () => {
    const rows = await getAll<{ id: number }>(env.DB, `SELECT id FROM model_families LIMIT 5`, []);
    expect(Array.isArray(rows)).toBe(true);
  });

  it('runBatch executes statements atomically', async () => {
    await runBatch(env.DB, [
      { sql: `INSERT OR IGNORE INTO model_families(id,slug,vendor,display_name) VALUES (?,?,?,?)`, params: [20, 'b1', 'v', 'B1'] },
      { sql: `INSERT OR IGNORE INTO model_families(id,slug,vendor,display_name) VALUES (?,?,?,?)`, params: [21, 'b2', 'v', 'B2'] }
    ]);
    const count = await getFirst<{ c: number }>(env.DB, `SELECT COUNT(*) AS c FROM model_families WHERE id IN (20,21)`, []);
    expect(count?.c).toBe(2);
  });

  it('insertAndReturnId returns last inserted rowid', async () => {
    const id = await insertAndReturnId(
      env.DB,
      `INSERT INTO model_families(slug,vendor,display_name) VALUES (?,?,?)`,
      ['unique-slug-' + Date.now(), 'v', 'X']
    );
    expect(id).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd site && npm test -- tests/db.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `site/src/lib/server/db.ts`**

```typescript
export type SqlParams = (string | number | null | Uint8Array | ArrayBuffer)[];

export async function getFirst<T>(
  db: D1Database,
  sql: string,
  params: SqlParams
): Promise<T | null> {
  const stmt = db.prepare(sql).bind(...params);
  const row = await stmt.first<T>();
  return row ?? null;
}

export async function getAll<T>(
  db: D1Database,
  sql: string,
  params: SqlParams
): Promise<T[]> {
  const stmt = db.prepare(sql).bind(...params);
  const res = await stmt.all<T>();
  return res.results ?? [];
}

export interface BatchStatement {
  sql: string;
  params: SqlParams;
}

export async function runBatch(
  db: D1Database,
  statements: BatchStatement[]
): Promise<void> {
  const prepared = statements.map(s => db.prepare(s.sql).bind(...s.params));
  await db.batch(prepared);
}

export async function insertAndReturnId(
  db: D1Database,
  sql: string,
  params: SqlParams
): Promise<number> {
  const res = await db.prepare(sql).bind(...params).run();
  if (!res.meta?.last_row_id) {
    throw new Error('insertAndReturnId: no last_row_id in result meta');
  }
  return res.meta.last_row_id;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd site && npm test -- tests/db.test.ts`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add site/src/lib/server/db.ts site/tests/db.test.ts
git commit -m "feat(site): add D1 query helpers"
```

---

## Task 12: API error types + JSON response formatter

**Files:**
- Create: `site/src/lib/server/errors.ts`
- Create: `site/src/lib/server/responses.ts`
- Create: `site/tests/errors.test.ts`

- [ ] **Step 1: Write failing test** `site/tests/errors.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { ApiError, errorResponse, jsonResponse } from '../src/lib/server/errors';

describe('api errors', () => {
  it('ApiError carries code + status', () => {
    const e = new ApiError(400, 'bad_signature', 'signature verification failed');
    expect(e.status).toBe(400);
    expect(e.code).toBe('bad_signature');
    expect(e.message).toBe('signature verification failed');
  });

  it('errorResponse returns a Response with JSON body', async () => {
    const res = errorResponse(new ApiError(403, 'forbidden', 'admin scope required'));
    expect(res.status).toBe(403);
    expect(res.headers.get('Content-Type')).toMatch(/application\/json/);
    const body = await res.json<{ code: string; error: string }>();
    expect(body.code).toBe('forbidden');
    expect(body.error).toBe('admin scope required');
  });

  it('errorResponse maps unknown errors to 500', async () => {
    const res = errorResponse(new Error('boom'));
    expect(res.status).toBe(500);
    const body = await res.json<{ code: string }>();
    expect(body.code).toBe('internal_error');
  });

  it('jsonResponse sets Content-Type and status', async () => {
    const res = jsonResponse({ ok: true }, 201);
    expect(res.status).toBe(201);
    expect(res.headers.get('Content-Type')).toMatch(/application\/json/);
    const body = await res.json<{ ok: boolean }>();
    expect(body.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd site && npm test -- tests/errors.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `site/src/lib/server/errors.ts`**

```typescript
import type { ApiErrorBody } from '$lib/shared/types';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function errorResponse(err: unknown): Response {
  if (err instanceof ApiError) {
    const body: ApiErrorBody = { error: err.message, code: err.code, details: err.details };
    return new Response(JSON.stringify(body), {
      status: err.status,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const message = err instanceof Error ? err.message : 'internal error';
  const body: ApiErrorBody = { error: message, code: 'internal_error' };
  return new Response(JSON.stringify(body), {
    status: 500,
    headers: { 'Content-Type': 'application/json' }
  });
}

export function jsonResponse(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers }
  });
}
```

- [ ] **Step 4: Implement `site/src/lib/server/responses.ts`** (re-exports for convenience)

```typescript
export { jsonResponse, errorResponse, ApiError } from './errors';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd site && npm test -- tests/errors.test.ts`
Expected: 4 tests pass.

- [ ] **Step 6: Commit**

```bash
git add site/src/lib/server/errors.ts site/src/lib/server/responses.ts site/tests/errors.test.ts
git commit -m "feat(site): add API error types and JSON response helpers"
```

---

## Task 13: Signature verification middleware

**Files:**
- Create: `site/src/lib/server/signature.ts`
- Create: `site/tests/signature.test.ts`
- Create: `site/tests/fixtures/keys.ts`

- [ ] **Step 1: Write test fixture** `site/tests/fixtures/keys.ts`

```typescript
import { generateKeypair, sign } from '../../src/lib/shared/ed25519';
import { canonicalJSON } from '../../src/lib/shared/canonical';
import { bytesToB64 } from '../../src/lib/shared/base64';

export async function createSignedPayload(
  payload: Record<string, unknown>,
  keyId: number,
  signedAt: string = new Date().toISOString()
) {
  const { privateKey, publicKey } = await generateKeypair();
  const canonical = canonicalJSON(payload);
  const signature = await sign(new TextEncoder().encode(canonical), privateKey);
  return {
    publicKey,
    signedRequest: {
      version: 1,
      run_id: 'run-' + keyId + '-' + Date.now(),
      signature: {
        alg: 'Ed25519' as const,
        key_id: keyId,
        signed_at: signedAt,
        value: bytesToB64(signature)
      },
      payload
    }
  };
}
```

- [ ] **Step 2: Write failing test** `site/tests/signature.test.ts`

```typescript
import { env, applyD1Migrations } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { verifySignedRequest } from '../src/lib/server/signature';
import { createSignedPayload } from './fixtures/keys';
import { ApiError } from '../src/lib/server/errors';

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await env.DB.prepare(`DELETE FROM machine_keys`).run();
});

async function registerKey(pubKey: Uint8Array, scope: 'ingest'|'verifier'|'admin' = 'ingest'): Promise<number> {
  const res = await env.DB.prepare(
    `INSERT INTO machine_keys(machine_id, public_key, scope, created_at) VALUES (?,?,?,?)`
  ).bind('test-machine', pubKey, scope, new Date().toISOString()).run();
  return res.meta!.last_row_id!;
}

describe('verifySignedRequest', () => {
  it('accepts a valid signature', async () => {
    const { publicKey, signedRequest } = await createSignedPayload({ foo: 'bar' }, 0);
    const keyId = await registerKey(publicKey, 'ingest');
    signedRequest.signature.key_id = keyId;

    const result = await verifySignedRequest(env.DB, signedRequest, 'ingest');
    expect(result.key_id).toBe(keyId);
    expect(result.machine_id).toBe('test-machine');
  });

  it('rejects an unknown key_id', async () => {
    const { signedRequest } = await createSignedPayload({ foo: 'bar' }, 99999);
    signedRequest.signature.key_id = 99999;
    await expect(verifySignedRequest(env.DB, signedRequest, 'ingest')).rejects.toThrow(ApiError);
  });

  it('rejects a revoked key', async () => {
    const { publicKey, signedRequest } = await createSignedPayload({ foo: 'bar' }, 0);
    const keyId = await registerKey(publicKey, 'ingest');
    await env.DB.prepare(`UPDATE machine_keys SET revoked_at = ? WHERE id = ?`)
      .bind(new Date().toISOString(), keyId).run();
    signedRequest.signature.key_id = keyId;

    await expect(verifySignedRequest(env.DB, signedRequest, 'ingest')).rejects.toThrow(/revoked/);
  });

  it('rejects insufficient scope', async () => {
    const { publicKey, signedRequest } = await createSignedPayload({ foo: 'bar' }, 0);
    const keyId = await registerKey(publicKey, 'ingest');
    signedRequest.signature.key_id = keyId;

    await expect(verifySignedRequest(env.DB, signedRequest, 'admin')).rejects.toThrow(/scope/);
  });

  it('rejects a tampered payload', async () => {
    const { publicKey, signedRequest } = await createSignedPayload({ foo: 'bar' }, 0);
    const keyId = await registerKey(publicKey, 'ingest');
    signedRequest.signature.key_id = keyId;
    (signedRequest.payload as Record<string, unknown>).foo = 'tampered';

    await expect(verifySignedRequest(env.DB, signedRequest, 'ingest')).rejects.toThrow(/signature/);
  });

  it('rejects excessive clock skew (> 10 minutes)', async () => {
    const tooOld = new Date(Date.now() - 11 * 60_000).toISOString();
    const { publicKey, signedRequest } = await createSignedPayload({ foo: 'bar' }, 0, tooOld);
    const keyId = await registerKey(publicKey, 'ingest');
    signedRequest.signature.key_id = keyId;

    await expect(verifySignedRequest(env.DB, signedRequest, 'ingest')).rejects.toThrow(/skew/);
  });

  it('updates last_used_at on success', async () => {
    const { publicKey, signedRequest } = await createSignedPayload({ foo: 'bar' }, 0);
    const keyId = await registerKey(publicKey, 'ingest');
    signedRequest.signature.key_id = keyId;

    await verifySignedRequest(env.DB, signedRequest, 'ingest');
    const row = await env.DB.prepare(`SELECT last_used_at FROM machine_keys WHERE id = ?`).bind(keyId).first<{ last_used_at: string }>();
    expect(row?.last_used_at).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `cd site && npm test -- tests/signature.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `site/src/lib/server/signature.ts`**

```typescript
import { canonicalJSON } from '$lib/shared/canonical';
import { verify } from '$lib/shared/ed25519';
import { b64ToBytes } from '$lib/shared/base64';
import type { Scope } from '$lib/shared/types';
import { ApiError } from './errors';

const SKEW_LIMIT_MS = 10 * 60 * 1000;

interface SignedRequest {
  signature: { alg: 'Ed25519'; key_id: number; signed_at: string; value: string };
  payload: Record<string, unknown>;
}

export interface VerifiedKey {
  key_id: number;
  machine_id: string;
  scope: Scope;
}

/**
 * Verify a signed API request:
 *  1. key_id exists and isn't revoked
 *  2. scope is sufficient for the operation
 *  3. signed_at is within +/- SKEW_LIMIT_MS of now
 *  4. Ed25519 signature matches canonical(payload)
 *  5. Update last_used_at on success
 */
export async function verifySignedRequest(
  db: D1Database,
  req: SignedRequest,
  requiredScope: Scope
): Promise<VerifiedKey> {
  if (req.signature.alg !== 'Ed25519') {
    throw new ApiError(400, 'bad_signature', `unsupported algorithm: ${req.signature.alg}`);
  }

  const keyRow = await db.prepare(
    `SELECT id, machine_id, public_key, scope, revoked_at FROM machine_keys WHERE id = ?`
  ).bind(req.signature.key_id).first<{
    id: number; machine_id: string; public_key: ArrayBuffer; scope: Scope; revoked_at: string | null;
  }>();

  if (!keyRow) {
    throw new ApiError(401, 'unknown_key', `key_id ${req.signature.key_id} not found`);
  }
  if (keyRow.revoked_at) {
    throw new ApiError(401, 'revoked_key', 'this key has been revoked');
  }
  if (!hasScope(keyRow.scope, requiredScope)) {
    throw new ApiError(403, 'insufficient_scope', `required scope: ${requiredScope}, have: ${keyRow.scope}`);
  }

  const signedAtMs = Date.parse(req.signature.signed_at);
  if (Number.isNaN(signedAtMs)) {
    throw new ApiError(400, 'bad_signed_at', 'signed_at is not a valid ISO 8601 timestamp');
  }
  if (Math.abs(Date.now() - signedAtMs) > SKEW_LIMIT_MS) {
    throw new ApiError(400, 'clock_skew', `signed_at too far from server time (> 10 min skew)`);
  }

  const canonical = canonicalJSON(req.payload);
  const sigBytes = b64ToBytes(req.signature.value);
  const pubKey = new Uint8Array(keyRow.public_key);
  const messageBytes = new TextEncoder().encode(canonical);

  const ok = await verify(sigBytes, messageBytes, pubKey);
  if (!ok) {
    throw new ApiError(401, 'bad_signature', 'signature verification failed');
  }

  await db.prepare(`UPDATE machine_keys SET last_used_at = ? WHERE id = ?`)
    .bind(new Date().toISOString(), keyRow.id).run();

  return { key_id: keyRow.id, machine_id: keyRow.machine_id, scope: keyRow.scope };
}

function hasScope(have: Scope, want: Scope): boolean {
  // admin > verifier > ingest (admin can do everything)
  const rank = { ingest: 1, verifier: 2, admin: 3 } as const;
  return rank[have] >= rank[want];
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd site && npm test -- tests/signature.test.ts`
Expected: 7 tests pass.

- [ ] **Step 6: Commit**

```bash
git add site/src/lib/server/signature.ts site/tests/signature.test.ts site/tests/fixtures/keys.ts
git commit -m "feat(site): add Ed25519 signature verification middleware"
```

---

## Task 14: POST /api/v1/task-sets

**Files:**
- Create: `site/src/routes/api/v1/task-sets/+server.ts`
- Create: `site/tests/api/task-sets.test.ts`

- [ ] **Step 1: Write failing test** `site/tests/api/task-sets.test.ts`

```typescript
import { env, applyD1Migrations } from 'cloudflare:test';
import { SELF } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { createSignedPayload } from '../fixtures/keys';

beforeAll(async () => { await applyD1Migrations(env.DB, env.TEST_MIGRATIONS); });

beforeEach(async () => {
  await env.DB.prepare(`DELETE FROM machine_keys`).run();
  await env.DB.prepare(`DELETE FROM tasks`).run();
  await env.DB.prepare(`DELETE FROM task_sets`).run();
});

async function registerAdminKey() {
  const { publicKey } = await createSignedPayload({}, 0);
  const res = await env.DB.prepare(
    `INSERT INTO machine_keys(machine_id, public_key, scope, created_at) VALUES (?,?,?,?)`
  ).bind('admin', publicKey, 'admin', new Date().toISOString()).run();
  return { keyId: res.meta!.last_row_id!, publicKey };
}

describe('POST /api/v1/task-sets', () => {
  it('registers a new task set', async () => {
    const { publicKey } = await createSignedPayload({}, 0);
    const keyRow = await env.DB.prepare(
      `INSERT INTO machine_keys(machine_id, public_key, scope, created_at) VALUES (?,?,?,?)`
    ).bind('m', publicKey, 'ingest', new Date().toISOString()).run();
    const keyId = keyRow.meta!.last_row_id!;

    const payload = {
      hash: 'sha256:testset1',
      created_at: '2026-04-17T10:00:00Z',
      task_count: 2,
      tasks: [
        { task_id: 'easy/a', content_hash: 'cha', difficulty: 'easy', category_slug: 'page', manifest: { name: 'A' } },
        { task_id: 'easy/b', content_hash: 'chb', difficulty: 'easy', category_slug: 'page', manifest: { name: 'B' } }
      ]
    };
    const { signedRequest } = await createSignedPayload(payload, keyId);
    signedRequest.signature.key_id = keyId;

    const res = await SELF.fetch('http://x/api/v1/task-sets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(signedRequest)
    });
    expect(res.status).toBe(201);
    const body = await res.json<{ hash: string; task_count: number }>();
    expect(body.hash).toBe('sha256:testset1');
    expect(body.task_count).toBe(2);

    const rows = await env.DB.prepare(`SELECT COUNT(*) AS c FROM tasks WHERE task_set_hash = ?`).bind('sha256:testset1').first<{ c: number }>();
    expect(rows?.c).toBe(2);
  });

  it('is idempotent on repeat with same hash', async () => {
    const { publicKey } = await createSignedPayload({}, 0);
    const keyRow = await env.DB.prepare(
      `INSERT INTO machine_keys(machine_id, public_key, scope, created_at) VALUES (?,?,?,?)`
    ).bind('m', publicKey, 'ingest', new Date().toISOString()).run();
    const keyId = keyRow.meta!.last_row_id!;

    const payload = {
      hash: 'sha256:dup', created_at: '2026-04-17T10:00:00Z', task_count: 1,
      tasks: [{ task_id: 'easy/x', content_hash: 'ch', difficulty: 'easy', category_slug: 'page', manifest: {} }]
    };
    const { signedRequest } = await createSignedPayload(payload, keyId);
    signedRequest.signature.key_id = keyId;

    const r1 = await SELF.fetch('http://x/api/v1/task-sets', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(signedRequest)
    });
    expect(r1.status).toBe(201);

    // Re-post with a fresh signature (new signed_at)
    const { signedRequest: r2 } = await createSignedPayload(payload, keyId);
    r2.signature.key_id = keyId;
    const r2res = await SELF.fetch('http://x/api/v1/task-sets', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(r2)
    });
    expect(r2res.status).toBe(200); // 200 = already existed, not recreated
  });

  it('rejects unsigned requests', async () => {
    const res = await SELF.fetch('http://x/api/v1/task-sets', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hash: 'x', created_at: 'x', task_count: 0, tasks: [] })
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd site && npm test -- tests/api/task-sets.test.ts`
Expected: FAIL — route not found.

- [ ] **Step 3: Implement `site/src/routes/api/v1/task-sets/+server.ts`**

```typescript
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
    const signed = await request.json() as { payload: TaskSetPayload; signature: unknown; run_id?: string; version?: number };
    if (!signed.signature) throw new ApiError(400, 'missing_signature', 'signature block required');
    const payload = signed.payload;
    if (!payload?.hash) throw new ApiError(400, 'bad_payload', 'payload.hash required');

    await verifySignedRequest(db, signed as { signature: { alg: 'Ed25519'; key_id: number; signed_at: string; value: string }; payload: Record<string, unknown> }, 'ingest');

    // Idempotent: if task set exists, 200; else 201
    const existing = await db.prepare(`SELECT hash FROM task_sets WHERE hash = ?`).bind(payload.hash).first();
    if (existing) {
      return jsonResponse({ hash: payload.hash, task_count: payload.task_count, status: 'exists' }, 200);
    }

    const statements: D1PreparedStatement[] = [
      db.prepare(`INSERT INTO task_sets(hash, created_at, task_count) VALUES (?,?,?)`)
        .bind(payload.hash, payload.created_at, payload.task_count)
    ];

    for (const task of payload.tasks) {
      statements.push(
        db.prepare(`INSERT OR IGNORE INTO task_categories(slug, name) VALUES (?, ?)`)
          .bind(task.category_slug, task.category_slug)
      );
    }

    await db.batch(statements);

    // Resolve category_ids and insert tasks
    const taskStatements: D1PreparedStatement[] = [];
    for (const task of payload.tasks) {
      taskStatements.push(
        db.prepare(`
          INSERT INTO tasks(task_set_hash, task_id, content_hash, difficulty, category_id, manifest_json)
          VALUES (?, ?, ?, ?, (SELECT id FROM task_categories WHERE slug = ?), ?)
        `).bind(payload.hash, task.task_id, task.content_hash, task.difficulty, task.category_slug, JSON.stringify(task.manifest))
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd site && npm test -- tests/api/task-sets.test.ts`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add site/src/routes/api/v1/task-sets/+server.ts site/tests/api/task-sets.test.ts
git commit -m "feat(site): implement POST /api/v1/task-sets"
```

---

## Task 15: POST /api/v1/runs (ingest)

**Files:**
- Create: `site/src/routes/api/v1/runs/+server.ts`
- Create: `site/src/lib/server/ingest.ts`
- Create: `site/tests/api/runs-ingest.test.ts`
- Create: `site/tests/fixtures/ingest-helpers.ts`

- [ ] **Step 1: Write helper** `site/tests/fixtures/ingest-helpers.ts`

```typescript
import { env } from 'cloudflare:test';
import { createSignedPayload } from './keys';
import type { SignedRunPayload } from '../../src/lib/shared/types';

export async function seedMinimalRefData() {
  await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO model_families(id,slug,vendor,display_name) VALUES (1,'claude','anthropic','Claude')`),
    env.DB.prepare(`INSERT OR IGNORE INTO models(id,family_id,slug,api_model_id,display_name,generation) VALUES (1,1,'sonnet-4.7','claude-sonnet-4-7','Sonnet 4.7',47)`),
    env.DB.prepare(`INSERT OR IGNORE INTO task_sets(hash,created_at,task_count,is_current) VALUES ('ts-hash-1','2026-04-01T00:00:00Z',1,1)`),
    env.DB.prepare(`INSERT OR IGNORE INTO task_categories(id,slug,name) VALUES (1,'page','page')`),
    env.DB.prepare(`INSERT OR IGNORE INTO tasks(task_set_hash,task_id,content_hash,difficulty,category_id,manifest_json) VALUES ('ts-hash-1','easy/task-1','ch1','easy',1,'{}')`),
    env.DB.prepare(`INSERT OR IGNORE INTO cost_snapshots(pricing_version,model_id,input_per_mtoken,output_per_mtoken,effective_from) VALUES ('v2026-04',1,3.0,15.0,'2026-04-01T00:00:00Z')`)
  ]);
}

export async function registerIngestKey(machineId = 'test-machine') {
  const { publicKey } = await createSignedPayload({}, 0);
  const res = await env.DB.prepare(
    `INSERT INTO machine_keys(machine_id, public_key, scope, created_at) VALUES (?,?,?,?)`
  ).bind(machineId, publicKey, 'ingest', new Date().toISOString()).run();
  return { keyId: res.meta!.last_row_id!, publicKey };
}

export function makeRunPayload(overrides: Partial<SignedRunPayload['payload']> = {}): SignedRunPayload['payload'] {
  return {
    task_set_hash: 'ts-hash-1',
    model: { slug: 'sonnet-4.7', api_model_id: 'claude-sonnet-4-7', family_slug: 'claude' },
    settings: { temperature: 0, max_attempts: 2, max_tokens: 8192, prompt_version: 'v3', bc_version: 'Cronus28' },
    machine_id: 'test-machine',
    started_at: '2026-04-17T10:00:00Z',
    completed_at: '2026-04-17T10:15:00Z',
    centralgauge_sha: 'abc1234',
    pricing_version: 'v2026-04',
    reproduction_bundle_sha256: 'bundlesha',
    results: [
      {
        task_id: 'easy/task-1',
        attempt: 1,
        passed: true,
        score: 100,
        compile_success: true,
        compile_errors: [],
        tests_total: 3,
        tests_passed: 3,
        tokens_in: 1000,
        tokens_out: 500,
        tokens_cache_read: 0,
        tokens_cache_write: 0,
        durations_ms: { llm: 5000, compile: 1000, test: 500 },
        failure_reasons: [],
        transcript_sha256: 'tsha',
        code_sha256: 'csha'
      }
    ],
    ...overrides
  };
}
```

- [ ] **Step 2: Write failing test** `site/tests/api/runs-ingest.test.ts`

```typescript
import { env, applyD1Migrations, SELF } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { createSignedPayload } from '../fixtures/keys';
import { seedMinimalRefData, registerIngestKey, makeRunPayload } from '../fixtures/ingest-helpers';

beforeAll(async () => { await applyD1Migrations(env.DB, env.TEST_MIGRATIONS); });

beforeEach(async () => {
  await env.DB.prepare(`DELETE FROM results`).run();
  await env.DB.prepare(`DELETE FROM runs`).run();
  await env.DB.prepare(`DELETE FROM settings_profiles`).run();
  await env.DB.prepare(`DELETE FROM machine_keys`).run();
  await seedMinimalRefData();
});

describe('POST /api/v1/runs', () => {
  it('accepts a valid signed payload and returns missing_blobs', async () => {
    const { keyId } = await registerIngestKey();
    const payload = makeRunPayload();
    const { signedRequest } = await createSignedPayload(payload as unknown as Record<string, unknown>, keyId);
    signedRequest.signature.key_id = keyId;
    signedRequest.run_id = 'run-ingest-1';

    const res = await SELF.fetch('http://x/api/v1/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(signedRequest)
    });
    expect(res.status).toBe(202);
    const body = await res.json<{ run_id: string; missing_blobs: string[] }>();
    expect(body.run_id).toBe('run-ingest-1');
    expect(body.missing_blobs.sort()).toEqual(['bundlesha', 'csha', 'tsha']);

    const runRow = await env.DB.prepare(`SELECT status, tier FROM runs WHERE id = ?`).bind('run-ingest-1').first<{ status: string; tier: string }>();
    expect(runRow?.status).toBe('running');
    expect(runRow?.tier).toBe('claimed');
  });

  it('is idempotent on repeat', async () => {
    const { keyId } = await registerIngestKey();
    const payload = makeRunPayload();
    const { signedRequest } = await createSignedPayload(payload as unknown as Record<string, unknown>, keyId);
    signedRequest.signature.key_id = keyId;
    signedRequest.run_id = 'run-dup';

    const r1 = await SELF.fetch('http://x/api/v1/runs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(signedRequest)
    });
    expect(r1.status).toBe(202);

    const { signedRequest: r2 } = await createSignedPayload(payload as unknown as Record<string, unknown>, keyId);
    r2.signature.key_id = keyId;
    r2.run_id = 'run-dup';
    const r2res = await SELF.fetch('http://x/api/v1/runs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(r2)
    });
    expect(r2res.status).toBe(200);

    const count = await env.DB.prepare(`SELECT COUNT(*) AS c FROM runs WHERE id = ?`).bind('run-dup').first<{ c: number }>();
    expect(count?.c).toBe(1);
  });

  it('rejects unknown task_set_hash', async () => {
    const { keyId } = await registerIngestKey();
    const payload = makeRunPayload({ task_set_hash: 'unknown-hash' });
    const { signedRequest } = await createSignedPayload(payload as unknown as Record<string, unknown>, keyId);
    signedRequest.signature.key_id = keyId;

    const res = await SELF.fetch('http://x/api/v1/runs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(signedRequest)
    });
    expect(res.status).toBe(400);
    const body = await res.json<{ code: string }>();
    expect(body.code).toBe('unknown_task_set');
  });

  it('rejects invalid signatures', async () => {
    const { keyId } = await registerIngestKey();
    const payload = makeRunPayload();
    const { signedRequest } = await createSignedPayload(payload as unknown as Record<string, unknown>, keyId);
    signedRequest.signature.key_id = keyId;
    (signedRequest.payload as { machine_id: string }).machine_id = 'TAMPERED';

    const res = await SELF.fetch('http://x/api/v1/runs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(signedRequest)
    });
    expect(res.status).toBe(401);
  });

  it('logs an ingest_event on success', async () => {
    const { keyId } = await registerIngestKey();
    const payload = makeRunPayload();
    const { signedRequest } = await createSignedPayload(payload as unknown as Record<string, unknown>, keyId);
    signedRequest.signature.key_id = keyId;
    signedRequest.run_id = 'run-logged';

    await SELF.fetch('http://x/api/v1/runs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(signedRequest)
    });
    const evt = await env.DB.prepare(`SELECT event FROM ingest_events WHERE run_id = ? ORDER BY id DESC LIMIT 1`).bind('run-logged').first<{ event: string }>();
    expect(evt?.event).toBe('signature_verified');
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `cd site && npm test -- tests/api/runs-ingest.test.ts`
Expected: FAIL — route not found.

- [ ] **Step 4: Implement `site/src/lib/server/ingest.ts`** (settings hash + run id derivation helpers)

```typescript
import { canonicalJSON } from '$lib/shared/canonical';
import { sha256Hex } from '$lib/shared/hash';
import type { SettingsInput } from '$lib/shared/types';

/**
 * Canonical hash of a settings profile. Used as the primary key in settings_profiles.
 */
export async function settingsHash(settings: SettingsInput): Promise<string> {
  const canonical = canonicalJSON({
    temperature: settings.temperature ?? null,
    max_attempts: settings.max_attempts ?? null,
    max_tokens: settings.max_tokens ?? null,
    prompt_version: settings.prompt_version ?? null,
    bc_version: settings.bc_version ?? null,
    extra_json: settings.extra_json ?? null
  });
  return await sha256Hex(canonical);
}

/**
 * Collect the set of blob hashes referenced by a payload.
 */
export function payloadBlobHashes(payload: {
  reproduction_bundle_sha256?: string;
  results: Array<{ transcript_sha256?: string; code_sha256?: string }>;
}): string[] {
  const hashes = new Set<string>();
  if (payload.reproduction_bundle_sha256) hashes.add(payload.reproduction_bundle_sha256);
  for (const r of payload.results) {
    if (r.transcript_sha256) hashes.add(r.transcript_sha256);
    if (r.code_sha256) hashes.add(r.code_sha256);
  }
  return Array.from(hashes);
}

/**
 * Given a list of sha256 hashes, return the subset that is NOT already in R2.
 */
export async function findMissingBlobs(bucket: R2Bucket, hashes: string[]): Promise<string[]> {
  const missing: string[] = [];
  for (const h of hashes) {
    const obj = await bucket.head(blobKey(h));
    if (!obj) missing.push(h);
  }
  return missing;
}

export function blobKey(sha256: string): string {
  return `blobs/${sha256}`;
}
```

- [ ] **Step 5: Implement `site/src/routes/api/v1/runs/+server.ts`**

```typescript
import type { RequestHandler } from './$types';
import { verifySignedRequest } from '$lib/server/signature';
import { settingsHash, payloadBlobHashes, findMissingBlobs } from '$lib/server/ingest';
import { canonicalJSON } from '$lib/shared/canonical';
import { b64ToBytes } from '$lib/shared/base64';
import { ApiError, errorResponse, jsonResponse } from '$lib/server/errors';
import type { SignedRunPayload, IngestResponse } from '$lib/shared/types';

export const POST: RequestHandler = async ({ request, platform }) => {
  if (!platform) return errorResponse(new ApiError(500, 'no_platform', 'platform env missing'));
  const db = platform.env.DB;
  const blobs = platform.env.BLOBS;

  try {
    const signed = await request.json() as SignedRunPayload;
    if (signed.version !== 1) throw new ApiError(400, 'bad_version', 'only version 1 supported');
    if (!signed.run_id) throw new ApiError(400, 'missing_run_id', 'run_id required');

    const verified = await verifySignedRequest(db, signed, 'ingest');
    const payload = signed.payload;

    // Validate task_set_hash exists
    const taskSet = await db.prepare(`SELECT hash FROM task_sets WHERE hash = ?`)
      .bind(payload.task_set_hash).first();
    if (!taskSet) throw new ApiError(400, 'unknown_task_set', `task_set_hash ${payload.task_set_hash} not registered`);

    // Resolve model id from api_model_id + slug
    const model = await db.prepare(
      `SELECT id FROM models WHERE api_model_id = ? AND slug = ?`
    ).bind(payload.model.api_model_id, payload.model.slug).first<{ id: number }>();
    if (!model) throw new ApiError(400, 'unknown_model', `model ${payload.model.api_model_id} not registered`);

    // Validate pricing_version exists for this model
    const pricing = await db.prepare(
      `SELECT id FROM cost_snapshots WHERE pricing_version = ? AND model_id = ?`
    ).bind(payload.pricing_version, model.id).first();
    if (!pricing) throw new ApiError(400, 'unknown_pricing', `pricing_version ${payload.pricing_version} not registered for this model`);

    // Idempotency: check if run_id already exists
    const existing = await db.prepare(`SELECT id, status FROM runs WHERE id = ?`).bind(signed.run_id).first<{ id: string; status: string }>();
    const missingBlobs = await findMissingBlobs(blobs, payloadBlobHashes(payload));
    if (existing) {
      return jsonResponse({
        run_id: signed.run_id,
        missing_blobs: missingBlobs,
        accepted_at: new Date().toISOString(),
        status: 'exists'
      } satisfies IngestResponse & { status: string }, 200);
    }

    // Compute + insert settings profile
    const setHash = await settingsHash(payload.settings);
    const canonical = canonicalJSON(payload as unknown as Record<string, unknown>);
    const signedPayloadBytes = new TextEncoder().encode(canonical);

    const statements: D1PreparedStatement[] = [
      db.prepare(`
        INSERT OR IGNORE INTO settings_profiles(hash, temperature, max_attempts, max_tokens, prompt_version, bc_version, extra_json)
        VALUES (?,?,?,?,?,?,?)
      `).bind(
        setHash,
        payload.settings.temperature ?? null,
        payload.settings.max_attempts ?? null,
        payload.settings.max_tokens ?? null,
        payload.settings.prompt_version ?? null,
        payload.settings.bc_version ?? null,
        payload.settings.extra_json ?? null
      ),
      db.prepare(`
        INSERT INTO runs(
          id, task_set_hash, model_id, settings_hash, machine_id,
          started_at, completed_at, status, tier, source,
          centralgauge_sha, pricing_version, reproduction_bundle_r2_key,
          ingest_signature, ingest_signed_at, ingest_public_key_id, ingest_signed_payload
        ) VALUES (?,?,?,?,?, ?,?,?,?,?, ?,?,?, ?,?,?,?)
      `).bind(
        signed.run_id,
        payload.task_set_hash, model.id, setHash, payload.machine_id,
        payload.started_at, null, 'running', 'claimed', 'bench',
        payload.centralgauge_sha ?? null,
        payload.pricing_version,
        payload.reproduction_bundle_sha256 ? `blobs/${payload.reproduction_bundle_sha256}` : null,
        signed.signature.value,
        signed.signature.signed_at,
        verified.key_id,
        signedPayloadBytes
      )
    ];

    for (const r of payload.results) {
      statements.push(
        db.prepare(`
          INSERT INTO results(
            run_id, task_id, attempt, passed, score, compile_success, compile_errors_json,
            tests_total, tests_passed,
            tokens_in, tokens_out, tokens_cache_read, tokens_cache_write,
            llm_duration_ms, compile_duration_ms, test_duration_ms,
            failure_reasons_json, transcript_r2_key, code_r2_key
          ) VALUES (?,?,?,?,?,?,?, ?,?, ?,?,?,?, ?,?,?, ?,?,?)
        `).bind(
          signed.run_id, r.task_id, r.attempt, r.passed ? 1 : 0, r.score, r.compile_success ? 1 : 0,
          JSON.stringify(r.compile_errors),
          r.tests_total, r.tests_passed,
          r.tokens_in, r.tokens_out, r.tokens_cache_read, r.tokens_cache_write,
          r.durations_ms.llm ?? null, r.durations_ms.compile ?? null, r.durations_ms.test ?? null,
          JSON.stringify(r.failure_reasons),
          r.transcript_sha256 ? `blobs/${r.transcript_sha256}` : null,
          r.code_sha256 ? `blobs/${r.code_sha256}` : null
        )
      );
    }

    statements.push(
      db.prepare(`INSERT INTO ingest_events(run_id, event, machine_id, ts, details_json) VALUES (?,?,?,?,?)`)
        .bind(signed.run_id, 'signature_verified', payload.machine_id, new Date().toISOString(),
              JSON.stringify({ missing_blob_count: missingBlobs.length }))
    );

    await db.batch(statements);

    const resp: IngestResponse = {
      run_id: signed.run_id,
      missing_blobs: missingBlobs,
      accepted_at: new Date().toISOString()
    };
    return jsonResponse(resp, 202);
  } catch (err) {
    return errorResponse(err);
  }
};
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd site && npm test -- tests/api/runs-ingest.test.ts`
Expected: 5 tests pass.

- [ ] **Step 7: Commit**

```bash
git add site/src/routes/api/v1/runs/+server.ts site/src/lib/server/ingest.ts site/tests/api/runs-ingest.test.ts site/tests/fixtures/ingest-helpers.ts
git commit -m "feat(site): implement POST /api/v1/runs ingest with signature verify"
```

---

## Task 16: PUT /api/v1/blobs/:sha256

**Files:**
- Create: `site/src/routes/api/v1/blobs/[sha256]/+server.ts`
- Create: `site/tests/api/blobs.test.ts`

- [ ] **Step 1: Write failing test** `site/tests/api/blobs.test.ts`

```typescript
import { env, applyD1Migrations, SELF } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { sha256Hex } from '../../src/lib/shared/hash';

beforeAll(async () => { await applyD1Migrations(env.DB, env.TEST_MIGRATIONS); });

beforeEach(async () => {
  // R2 cleanup
  const list = await env.BLOBS.list();
  await Promise.all(list.objects.map(o => env.BLOBS.delete(o.key)));
});

describe('PUT /api/v1/blobs/:sha256', () => {
  it('accepts a blob whose content hashes to the key', async () => {
    const body = new TextEncoder().encode('transcript content');
    const hash = await sha256Hex(body);

    const res = await SELF.fetch(`http://x/api/v1/blobs/${hash}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body
    });
    expect(res.status).toBe(201);

    const stored = await env.BLOBS.get(`blobs/${hash}`);
    expect(stored).not.toBeNull();
  });

  it('rejects a blob whose content does not match the key', async () => {
    const body = new TextEncoder().encode('real content');
    const wrongHash = 'a'.repeat(64);

    const res = await SELF.fetch(`http://x/api/v1/blobs/${wrongHash}`, {
      method: 'PUT',
      body
    });
    expect(res.status).toBe(400);
    const err = await res.json<{ code: string }>();
    expect(err.code).toBe('hash_mismatch');
  });

  it('is idempotent on upload of same content', async () => {
    const body = new TextEncoder().encode('same content');
    const hash = await sha256Hex(body);

    const r1 = await SELF.fetch(`http://x/api/v1/blobs/${hash}`, { method: 'PUT', body });
    expect(r1.status).toBe(201);
    const r2 = await SELF.fetch(`http://x/api/v1/blobs/${hash}`, { method: 'PUT', body });
    expect(r2.status).toBe(200);
  });

  it('rejects malformed sha256 in key path', async () => {
    const res = await SELF.fetch('http://x/api/v1/blobs/not-a-hex-hash', {
      method: 'PUT', body: new Uint8Array([1,2,3])
    });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd site && npm test -- tests/api/blobs.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `site/src/routes/api/v1/blobs/[sha256]/+server.ts`**

```typescript
import type { RequestHandler } from './$types';
import { sha256Hex } from '$lib/shared/hash';
import { ApiError, errorResponse, jsonResponse } from '$lib/server/errors';

const HEX64 = /^[a-f0-9]{64}$/;

export const PUT: RequestHandler = async ({ params, request, platform }) => {
  if (!platform) return errorResponse(new ApiError(500, 'no_platform', 'platform env missing'));
  const key = params.sha256!;
  if (!HEX64.test(key)) {
    return errorResponse(new ApiError(400, 'bad_key', 'sha256 path parameter must be 64 lowercase hex chars'));
  }

  try {
    const body = new Uint8Array(await request.arrayBuffer());
    const actualHash = await sha256Hex(body);
    if (actualHash !== key) {
      throw new ApiError(400, 'hash_mismatch', `body sha256 ${actualHash} does not match key ${key}`);
    }

    const r2Key = `blobs/${key}`;
    const existing = await platform.env.BLOBS.head(r2Key);
    if (existing) {
      return jsonResponse({ sha256: key, status: 'exists' }, 200);
    }

    await platform.env.BLOBS.put(r2Key, body);
    return jsonResponse({ sha256: key, status: 'created' }, 201);
  } catch (err) {
    return errorResponse(err);
  }
};

export const GET: RequestHandler = async ({ params, platform }) => {
  if (!platform) return errorResponse(new ApiError(500, 'no_platform', 'platform env missing'));
  const key = params.sha256!;
  if (!HEX64.test(key)) {
    return errorResponse(new ApiError(400, 'bad_key', 'sha256 path parameter must be 64 lowercase hex chars'));
  }
  const obj = await platform.env.BLOBS.get(`blobs/${key}`);
  if (!obj) return errorResponse(new ApiError(404, 'not_found', 'blob not found'));
  return new Response(obj.body, { headers: { 'Content-Type': 'application/octet-stream' } });
};
```

- [ ] **Step 4: Run tests**

Run: `cd site && npm test -- tests/api/blobs.test.ts`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add site/src/routes/api/v1/blobs/ site/tests/api/blobs.test.ts
git commit -m "feat(site): implement PUT /api/v1/blobs/:sha256 with hash validation"
```

---

## Task 17: POST /api/v1/runs/:id/finalize

**Files:**
- Create: `site/src/routes/api/v1/runs/[id]/finalize/+server.ts`
- Create: `site/tests/api/runs-finalize.test.ts`

- [ ] **Step 1: Write failing test** `site/tests/api/runs-finalize.test.ts`

```typescript
import { env, applyD1Migrations, SELF } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { createSignedPayload } from '../fixtures/keys';
import { seedMinimalRefData, registerIngestKey, makeRunPayload } from '../fixtures/ingest-helpers';
import { sha256Hex } from '../../src/lib/shared/hash';

beforeAll(async () => { await applyD1Migrations(env.DB, env.TEST_MIGRATIONS); });

beforeEach(async () => {
  await env.DB.prepare(`DELETE FROM results`).run();
  await env.DB.prepare(`DELETE FROM runs`).run();
  await env.DB.prepare(`DELETE FROM settings_profiles`).run();
  await env.DB.prepare(`DELETE FROM machine_keys`).run();
  const list = await env.BLOBS.list();
  await Promise.all(list.objects.map(o => env.BLOBS.delete(o.key)));
  await seedMinimalRefData();
});

async function ingestAndUploadBlobs() {
  const { keyId } = await registerIngestKey();
  // Pre-upload the three blobs the fixture references
  const transcriptBody = new TextEncoder().encode('transcript-1');
  const codeBody = new TextEncoder().encode('code-1');
  const bundleBody = new TextEncoder().encode('bundle-1');
  const transcriptSha = await sha256Hex(transcriptBody);
  const codeSha = await sha256Hex(codeBody);
  const bundleSha = await sha256Hex(bundleBody);

  const payload = makeRunPayload({
    reproduction_bundle_sha256: bundleSha,
    results: [{
      ...makeRunPayload().results[0],
      transcript_sha256: transcriptSha,
      code_sha256: codeSha
    }]
  });
  const { signedRequest } = await createSignedPayload(payload as unknown as Record<string, unknown>, keyId);
  signedRequest.signature.key_id = keyId;
  signedRequest.run_id = 'run-finalize-1';

  await SELF.fetch('http://x/api/v1/runs', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(signedRequest)
  });

  return { runId: signedRequest.run_id, transcriptSha, codeSha, bundleSha, transcriptBody, codeBody, bundleBody };
}

describe('POST /api/v1/runs/:id/finalize', () => {
  it('rejects finalize when blobs are missing', async () => {
    const { runId } = await ingestAndUploadBlobs(); // ingested but blobs NOT uploaded

    const res = await SELF.fetch(`http://x/api/v1/runs/${runId}/finalize`, { method: 'POST' });
    expect(res.status).toBe(409);
    const err = await res.json<{ code: string; details: unknown }>();
    expect(err.code).toBe('blobs_missing');
  });

  it('marks run completed when all blobs present', async () => {
    const { runId, transcriptSha, codeSha, bundleSha, transcriptBody, codeBody, bundleBody } = await ingestAndUploadBlobs();

    for (const [sha, body] of [[transcriptSha, transcriptBody], [codeSha, codeBody], [bundleSha, bundleBody]] as const) {
      await SELF.fetch(`http://x/api/v1/blobs/${sha}`, { method: 'PUT', body });
    }

    const res = await SELF.fetch(`http://x/api/v1/runs/${runId}/finalize`, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json<{ status: string }>();
    expect(body.status).toBe('completed');

    const run = await env.DB.prepare(`SELECT status, completed_at FROM runs WHERE id = ?`).bind(runId).first<{ status: string; completed_at: string }>();
    expect(run?.status).toBe('completed');
    expect(run?.completed_at).toBeTruthy();
  });

  it('is idempotent on double-finalize', async () => {
    const { runId, transcriptSha, codeSha, bundleSha, transcriptBody, codeBody, bundleBody } = await ingestAndUploadBlobs();
    for (const [sha, body] of [[transcriptSha, transcriptBody], [codeSha, codeBody], [bundleSha, bundleBody]] as const) {
      await SELF.fetch(`http://x/api/v1/blobs/${sha}`, { method: 'PUT', body });
    }

    const r1 = await SELF.fetch(`http://x/api/v1/runs/${runId}/finalize`, { method: 'POST' });
    expect(r1.status).toBe(200);
    const r2 = await SELF.fetch(`http://x/api/v1/runs/${runId}/finalize`, { method: 'POST' });
    expect(r2.status).toBe(200);
  });

  it('returns 404 on unknown run_id', async () => {
    const res = await SELF.fetch('http://x/api/v1/runs/does-not-exist/finalize', { method: 'POST' });
    expect(res.status).toBe(404);
  });

  it('invalidates leaderboard KV cache on success', async () => {
    await env.CACHE.put('leaderboard:current', JSON.stringify({ stale: true }));
    const { runId, transcriptSha, codeSha, bundleSha, transcriptBody, codeBody, bundleBody } = await ingestAndUploadBlobs();
    for (const [sha, body] of [[transcriptSha, transcriptBody], [codeSha, codeBody], [bundleSha, bundleBody]] as const) {
      await SELF.fetch(`http://x/api/v1/blobs/${sha}`, { method: 'PUT', body });
    }
    await SELF.fetch(`http://x/api/v1/runs/${runId}/finalize`, { method: 'POST' });

    const cached = await env.CACHE.get('leaderboard:current');
    expect(cached).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd site && npm test -- tests/api/runs-finalize.test.ts`
Expected: FAIL — route not found.

- [ ] **Step 3: Implement `site/src/routes/api/v1/runs/[id]/finalize/+server.ts`**

```typescript
import type { RequestHandler } from './$types';
import { ApiError, errorResponse, jsonResponse } from '$lib/server/errors';
import type { FinalizeResponse } from '$lib/shared/types';

const LEADERBOARD_CACHE_KEYS = ['leaderboard:current', 'leaderboard:all'];

export const POST: RequestHandler = async ({ params, platform }) => {
  if (!platform) return errorResponse(new ApiError(500, 'no_platform', 'platform env missing'));
  const db = platform.env.DB;
  const blobs = platform.env.BLOBS;
  const cache = platform.env.CACHE;
  const runId = params.id!;

  try {
    const run = await db.prepare(
      `SELECT id, status, reproduction_bundle_r2_key, machine_id FROM runs WHERE id = ?`
    ).bind(runId).first<{ id: string; status: string; reproduction_bundle_r2_key: string | null; machine_id: string }>();

    if (!run) throw new ApiError(404, 'not_found', `run ${runId} not found`);

    if (run.status === 'completed') {
      return jsonResponse({ run_id: runId, status: 'completed', finalized_at: new Date().toISOString() } satisfies FinalizeResponse, 200);
    }

    // Collect all blob R2 keys referenced by this run
    const results = await db.prepare(
      `SELECT transcript_r2_key, code_r2_key FROM results WHERE run_id = ?`
    ).bind(runId).all<{ transcript_r2_key: string | null; code_r2_key: string | null }>();

    const requiredKeys = new Set<string>();
    if (run.reproduction_bundle_r2_key) requiredKeys.add(run.reproduction_bundle_r2_key);
    for (const r of results.results ?? []) {
      if (r.transcript_r2_key) requiredKeys.add(r.transcript_r2_key);
      if (r.code_r2_key) requiredKeys.add(r.code_r2_key);
    }

    const missing: string[] = [];
    for (const k of requiredKeys) {
      const exists = await blobs.head(k);
      if (!exists) missing.push(k.replace(/^blobs\//, ''));
    }

    if (missing.length > 0) {
      throw new ApiError(409, 'blobs_missing', `${missing.length} required blobs not yet uploaded`, { missing });
    }

    const now = new Date().toISOString();
    await db.batch([
      db.prepare(`UPDATE runs SET status = 'completed', completed_at = ? WHERE id = ?`).bind(now, runId),
      db.prepare(`INSERT INTO ingest_events(run_id, event, machine_id, ts, details_json) VALUES (?,?,?,?,?)`)
        .bind(runId, 'finalized', run.machine_id, now, JSON.stringify({}))
    ]);

    // Cache invalidation (non-blocking)
    await Promise.all(LEADERBOARD_CACHE_KEYS.map(k => cache.delete(k)));

    return jsonResponse({ run_id: runId, status: 'completed', finalized_at: now } satisfies FinalizeResponse, 200);
  } catch (err) {
    return errorResponse(err);
  }
};
```

- [ ] **Step 4: Run tests**

Run: `cd site && npm test -- tests/api/runs-finalize.test.ts`
Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add site/src/routes/api/v1/runs/ site/tests/api/runs-finalize.test.ts
git commit -m "feat(site): implement POST /api/v1/runs/:id/finalize"
```

---

## End of Part 2

At this point the ingest pipeline is complete end-to-end:
1. `POST /api/v1/task-sets` registers a task set
2. `POST /api/v1/runs` ingests a signed run, returns missing blobs
3. `PUT /api/v1/blobs/:sha256` uploads blobs with hash validation
4. `POST /api/v1/runs/:id/finalize` marks the run complete

**Success check for Part 2:**

Run: `cd site && npm test`
Expected: all existing tests + ~25 new tests across Tasks 11–17 pass.

Continue with **Part 3** (`2026-04-17-p1-schema-and-api-skeleton-part3.md`) for read endpoints.
