# CLI Ingestion + Prod Deploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the Deno CLI to the signed ingest API and ship a production Cloudflare Worker that accepts new benchmark runs with full blob archival.

**Architecture:** Single-env production. Shared canonical-JSON module. Interactive catalog-driven reference-data registration (pricing only from provider APIs or manual entry — never defaults). Blobs uploaded R2-first, then D1 batch insert. Local results JSON is the master artifact; ingest is a pure replay-able function.

**Tech Stack:** Deno 1.44 + TypeScript 5 (CLI), SvelteKit 2 + @sveltejs/adapter-cloudflare 7 + vitest-pool-workers 0.14 (Worker), @noble/ed25519 v3, Cloudflare D1 / KV / R2 / DO.

**Spec:** `docs/superpowers/specs/2026-04-20-cli-ingestion-design.md`

---

## File Structure

### Created

| Path | Responsibility |
|---|---|
| `shared/canonical.ts` | Canonical JSON, single source of truth, imported from both runtimes |
| `tests/fixtures/canonical-parity/input.json` | Golden parity fixture (input) |
| `tests/fixtures/canonical-parity/expected.txt` | Golden parity fixture (expected canonical output) |
| `tests/unit/canonical_parity_test.ts` | Deno-side parity assertion |
| `site/src/lib/shared/canonical-parity.test.ts` | Worker-side parity assertion |
| `site/migrations/0003_cost_source.sql` | Add `source` + `fetched_at` to `cost_snapshots` |
| `site/src/routes/api/v1/runs/precheck/+server.ts` | POST precheck endpoint |
| `site/src/routes/api/v1/admin/catalog/models/+server.ts` | Admin upsert for models |
| `site/src/routes/api/v1/admin/catalog/pricing/+server.ts` | Admin upsert for cost_snapshots |
| `site/src/routes/api/v1/admin/catalog/task-sets/+server.ts` | Admin upsert for task_sets |
| `site/src/lib/server/blob-auth.ts` | Header-based Ed25519 auth for blob PUTs |
| `site/catalog/models.yml` | Checked-in model catalog |
| `site/catalog/pricing.yml` | Checked-in pricing catalog |
| `site/catalog/model-families.yml` | Checked-in model-family catalog |
| `src/ingest/types.ts` | CLI-side ingest types |
| `src/ingest/canonical.ts` | Re-export of shared/canonical.ts |
| `src/ingest/sign.ts` | Ed25519 sign helper |
| `src/ingest/envelope.ts` | Build SignedRunPayload from benchmark JSON |
| `src/ingest/catalog/read.ts` | Parse site/catalog/*.yml |
| `src/ingest/catalog/write.ts` | Append to site/catalog/*.yml (preserves comments) |
| `src/ingest/catalog/task-set-hash.ts` | Deterministic hash of tasks/**/*.yml |
| `src/ingest/pricing-sources/types.ts` | Adapter interface + `PricingRates` |
| `src/ingest/pricing-sources/openrouter.ts` | OpenRouter pricing adapter |
| `src/ingest/pricing-sources/anthropic.ts` | Anthropic pricing adapter |
| `src/ingest/pricing-sources/openai.ts` | OpenAI pricing adapter |
| `src/ingest/pricing-sources/gemini.ts` | Gemini pricing adapter |
| `src/ingest/pricing-sources/index.ts` | Family-based dispatch |
| `src/ingest/register.ts` | Interactive catalog+D1 registration |
| `src/ingest/blobs.ts` | R2 blob upload with header-signed auth |
| `src/ingest/client.ts` | HTTP POST with retry |
| `src/ingest/config.ts` | Resolve URL, keypath, keyId, machineId |
| `src/ingest/mod.ts` | Barrel export; `ingestRun()` entry point |
| `cli/commands/ingest-command.ts` | `centralgauge ingest <path>` |
| `cli/commands/sync-catalog-command.ts` | `centralgauge sync-catalog` |
| `tests/unit/ingest/*` | Unit tests mirroring `src/ingest/` |
| `site/test/integration/blobs-put-signed.test.ts` | Auth tests for blob PUT |
| `site/test/integration/runs-precheck.test.ts` | Precheck tests |
| `site/test/integration/catalog-admin.test.ts` | Catalog admin endpoints |

### Modified

| Path | Change |
|---|---|
| `site/src/lib/shared/canonical.ts` | Replaced with `export { canonicalJSON } from '../../../../shared/canonical'` |
| `site/src/routes/api/v1/blobs/[sha256]/+server.ts` | Add header-based Ed25519 auth |
| `cli/commands/bench-command.ts` | Call `ingestRun(...)` after writing results JSON |
| `cli/commands/mod.ts` | Register new `ingest` and `sync-catalog` commands |
| `site/wrangler.toml` | Add production env block (already present; verify) |
| `.centralgauge.yml` | Production defaults for URL, key path |

---

## Phase 0: Foundation (canonical + schema)

### Task 0.1: Move canonical.ts to repo root

**Files:**
- Create: `shared/canonical.ts`
- Modify: `site/src/lib/shared/canonical.ts` → becomes a re-export stub

- [ ] **Step 1: Create the shared file**

Write `shared/canonical.ts`:

```ts
/**
 * Canonical JSON: stable serialization for cryptographic signing.
 * - Keys sorted alphabetically at every depth
 * - No whitespace
 * - Rejects NaN, Infinity, undefined
 * - Detects and rejects circular references
 *
 * Imported from both the Deno CLI (src/ingest/canonical.ts re-export)
 * and the Cloudflare Worker (site/src/lib/shared/canonical.ts re-export).
 */
export function canonicalJSON(value: unknown): string {
  return serialize(value, new WeakSet());
}

function serialize(v: unknown, seen: WeakSet<object>): string {
  if (v === null) return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) {
      throw new Error('canonicalJSON: non-finite number is not serializable');
    }
    return JSON.stringify(v);
  }
  if (typeof v === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) {
    if (seen.has(v)) throw new Error('canonicalJSON: cycle detected');
    seen.add(v);
    return '[' + v.map((x) => serialize(x, seen)).join(',') + ']';
  }
  if (typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    if (seen.has(obj)) throw new Error('canonicalJSON: cycle detected');
    seen.add(obj);
    const keys = Object.keys(obj).sort();
    const parts: string[] = [];
    for (const k of keys) {
      const val = obj[k];
      if (val === undefined) {
        throw new Error(`canonicalJSON: undefined value at key "${k}"`);
      }
      parts.push(JSON.stringify(k) + ':' + serialize(val, seen));
    }
    return '{' + parts.join(',') + '}';
  }
  throw new Error(`canonicalJSON: unsupported type ${typeof v}`);
}
```

- [ ] **Step 2: Replace worker-side file with re-export**

Edit `site/src/lib/shared/canonical.ts` to contain only:

```ts
export { canonicalJSON } from '../../../../shared/canonical';
```

- [ ] **Step 3: Verify worker build still works**

```bash
cd site && npm run check
```
Expected: 0 errors.

- [ ] **Step 4: Verify worker tests still pass**

```bash
cd site && npm run test:main
```
Expected: all existing tests pass (no canonical tests exist yet).

- [ ] **Step 5: Commit**

```bash
git add shared/canonical.ts site/src/lib/shared/canonical.ts
git commit -m "refactor(canonical): hoist to shared/ for CLI+Worker import"
```

---

### Task 0.2: Golden parity fixture + two-runtime tests

**Files:**
- Create: `tests/fixtures/canonical-parity/input.json`
- Create: `tests/fixtures/canonical-parity/expected.txt`
- Create: `tests/unit/canonical_parity_test.ts`
- Create: `site/src/lib/shared/canonical-parity.test.ts`

- [ ] **Step 1: Create the fixture input**

Write `tests/fixtures/canonical-parity/input.json`:

```json
{
  "zebra": 1,
  "alpha": {"nested_z": 2, "nested_a": [1, null, "s"]},
  "unicode": "héllo → 世界",
  "negatives": -0,
  "emptyArr": [],
  "emptyObj": {}
}
```

- [ ] **Step 2: Compute the expected canonical output**

Run:
```bash
deno eval 'import("./shared/canonical.ts").then(m => Deno.readTextFile("./tests/fixtures/canonical-parity/input.json").then(s => Deno.writeTextFile("./tests/fixtures/canonical-parity/expected.txt", m.canonicalJSON(JSON.parse(s)))))'
```

Verify the file was written:
```bash
cat tests/fixtures/canonical-parity/expected.txt
```
Expected: single line, no trailing newline, begins with `{"alpha":`.

- [ ] **Step 3: Write Deno-side parity test**

Write `tests/unit/canonical_parity_test.ts`:

```ts
import { assertEquals } from "@std/assert";
import { canonicalJSON } from "../../shared/canonical.ts";

Deno.test("canonical JSON matches golden fixture (Deno)", async () => {
  const input = JSON.parse(
    await Deno.readTextFile("tests/fixtures/canonical-parity/input.json"),
  );
  const expected = await Deno.readTextFile(
    "tests/fixtures/canonical-parity/expected.txt",
  );
  assertEquals(canonicalJSON(input), expected);
});
```

- [ ] **Step 4: Run the Deno test**

```bash
deno task test:unit -- canonical_parity
```
Expected: 1 passed.

- [ ] **Step 5: Write Vitest-side parity test**

Write `site/src/lib/shared/canonical-parity.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { canonicalJSON } from './canonical';

describe('canonical JSON parity (Vitest)', () => {
  it('matches golden fixture', () => {
    const input = JSON.parse(
      readFileSync('../tests/fixtures/canonical-parity/input.json', 'utf8'),
    );
    const expected = readFileSync(
      '../tests/fixtures/canonical-parity/expected.txt',
      'utf8',
    );
    expect(canonicalJSON(input)).toBe(expected);
  });
});
```

- [ ] **Step 6: Run the Vitest test**

```bash
cd site && npm run test:main -- canonical-parity
```
Expected: 1 passed.

- [ ] **Step 7: Commit**

```bash
git add tests/fixtures/canonical-parity/ tests/unit/canonical_parity_test.ts site/src/lib/shared/canonical-parity.test.ts
git commit -m "test(canonical): add byte-parity golden fixture shared by both runtimes"
```

---

### Task 0.3: Migration 0003 — cost_snapshots source + fetched_at

**Files:**
- Create: `site/migrations/0003_cost_source.sql`

- [ ] **Step 1: Write the migration**

Write `site/migrations/0003_cost_source.sql`:

```sql
-- 0003_cost_source.sql
-- Add provenance to cost_snapshots so we can always audit where rates came from.
-- Values: 'anthropic-api', 'openai-api', 'gemini-api', 'openrouter-api', 'manual', 'unknown' (legacy).

ALTER TABLE cost_snapshots ADD COLUMN source TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE cost_snapshots ADD COLUMN fetched_at TEXT;
```

- [ ] **Step 2: Apply to preview D1**

```bash
cd site && npx wrangler d1 execute centralgauge-db --env preview --remote --file=migrations/0003_cost_source.sql
```
Expected: 2 ALTERs succeed.

- [ ] **Step 3: Mark migration applied in d1_migrations**

```bash
cd site && npx wrangler d1 execute centralgauge-db --env preview --remote --command="INSERT INTO d1_migrations(name) VALUES ('0003_cost_source.sql')"
```

Expected: 1 row inserted.

- [ ] **Step 4: Commit**

```bash
git add site/migrations/0003_cost_source.sql
git commit -m "feat(db): add source + fetched_at columns to cost_snapshots"
```

---

## Phase 1: Server — blob auth + precheck + catalog admin

### Task 1.1: Header-signed blob auth helper

**Files:**
- Create: `site/src/lib/server/blob-auth.ts`
- Test: `site/test/integration/blobs-put-signed.test.ts`

- [ ] **Step 1: Write the failing test**

Write `site/test/integration/blobs-put-signed.test.ts`:

```ts
import { env, SELF } from 'cloudflare:test';
import { describe, expect, it, beforeAll } from 'vitest';
import * as ed from '@noble/ed25519';
import { canonicalJSON } from '$lib/shared/canonical';

describe('PUT /api/v1/blobs/:sha256 — signed auth', () => {
  let privKey: Uint8Array;
  let pubKey: Uint8Array;
  let keyId: number;

  beforeAll(async () => {
    privKey = ed.utils.randomPrivateKey();
    pubKey = await ed.getPublicKeyAsync(privKey);
    const insertKey = await env.DB.prepare(
      `INSERT INTO machine_keys(machine_id, public_key, scope, created_at)
       VALUES (?, ?, 'ingest', ?) RETURNING id`
    ).bind('test-ingest', pubKey, new Date().toISOString()).first<{ id: number }>();
    keyId = insertKey!.id;
  });

  it('rejects unsigned PUT with 401', async () => {
    const body = new TextEncoder().encode('hello');
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', body)))
      .map((b) => b.toString(16).padStart(2, '0')).join('');
    const resp = await SELF.fetch(`https://x/api/v1/blobs/${hash}`, {
      method: 'PUT',
      body,
    });
    expect(resp.status).toBe(401);
  });

  it('accepts signed PUT and stores blob', async () => {
    const body = new TextEncoder().encode('hello signed');
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', body)))
      .map((b) => b.toString(16).padStart(2, '0')).join('');
    const signedAt = new Date().toISOString();
    const canonical = canonicalJSON({
      method: 'PUT',
      path: `/api/v1/blobs/${hash}`,
      body_sha256: hash,
      signed_at: signedAt,
    });
    const sig = await ed.signAsync(new TextEncoder().encode(canonical), privKey);
    const sigB64 = btoa(String.fromCharCode(...sig));
    const resp = await SELF.fetch(`https://x/api/v1/blobs/${hash}`, {
      method: 'PUT',
      headers: {
        'X-CG-Signature': sigB64,
        'X-CG-Key-Id': String(keyId),
        'X-CG-Signed-At': signedAt,
      },
      body,
    });
    expect(resp.status).toBe(201);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd site && npm run test:main -- blobs-put-signed
```
Expected: FAIL — first test expects 401, currently returns 201 (no auth).

- [ ] **Step 3: Write the helper**

Write `site/src/lib/server/blob-auth.ts`:

```ts
import { canonicalJSON } from '$lib/shared/canonical';
import { verify } from '$lib/shared/ed25519';
import { b64ToBytes } from '$lib/shared/base64';
import { ApiError } from './errors';
import type { Scope } from '$lib/shared/types';

const SKEW_LIMIT_MS = 5 * 60 * 1000;

export interface VerifiedBlobAuth {
  key_id: number;
  machine_id: string;
}

/**
 * Verify a header-signed blob upload.
 *
 * Signed bytes = canonicalJSON({
 *   method: "PUT",
 *   path: "/api/v1/blobs/<sha256>",
 *   body_sha256: "<sha256>",
 *   signed_at: "<iso>"
 * })
 */
export async function verifyBlobAuth(
  db: D1Database,
  headers: Headers,
  method: string,
  path: string,
  bodySha256: string,
  requiredScope: Scope,
): Promise<VerifiedBlobAuth> {
  const sigB64 = headers.get('X-CG-Signature');
  const keyIdStr = headers.get('X-CG-Key-Id');
  const signedAt = headers.get('X-CG-Signed-At');
  if (!sigB64 || !keyIdStr || !signedAt) {
    throw new ApiError(401, 'missing_signature', 'X-CG-Signature, X-CG-Key-Id, X-CG-Signed-At headers required');
  }
  const keyId = parseInt(keyIdStr, 10);
  if (!Number.isFinite(keyId) || keyId < 1) {
    throw new ApiError(401, 'bad_key_id', 'X-CG-Key-Id must be a positive integer');
  }

  const skew = Math.abs(Date.now() - Date.parse(signedAt));
  if (!Number.isFinite(skew) || skew > SKEW_LIMIT_MS) {
    throw new ApiError(401, 'clock_skew', `signed_at skew exceeds ${SKEW_LIMIT_MS}ms`);
  }

  const keyRow = await db.prepare(
    `SELECT id, machine_id, public_key, scope, revoked_at FROM machine_keys WHERE id = ?`,
  ).bind(keyId).first<{ id: number; machine_id: string; public_key: ArrayBuffer; scope: Scope; revoked_at: string | null }>();
  if (!keyRow) throw new ApiError(401, 'unknown_key', `key_id ${keyId} not found`);
  if (keyRow.revoked_at) throw new ApiError(401, 'revoked_key', 'key revoked');
  if (keyRow.scope !== requiredScope && keyRow.scope !== 'admin') {
    throw new ApiError(403, 'insufficient_scope', `need ${requiredScope}, have ${keyRow.scope}`);
  }

  const canonical = canonicalJSON({ method, path, body_sha256: bodySha256, signed_at: signedAt });
  const msg = new TextEncoder().encode(canonical);
  const sig = b64ToBytes(sigB64);
  const ok = await verify(sig, msg, new Uint8Array(keyRow.public_key));
  if (!ok) throw new ApiError(401, 'bad_signature', 'Ed25519 verify failed');

  await db.prepare(`UPDATE machine_keys SET last_used_at = ? WHERE id = ?`)
    .bind(new Date().toISOString(), keyId).run();

  return { key_id: keyId, machine_id: keyRow.machine_id };
}
```

- [ ] **Step 4: Wire into the blob endpoint**

Edit `site/src/routes/api/v1/blobs/[sha256]/+server.ts`:

Replace the existing `PUT` handler body with:

```ts
export const PUT: RequestHandler = async ({ params, request, platform, url }) => {
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

    await verifyBlobAuth(platform.env.DB, request.headers, 'PUT', url.pathname, key, 'ingest');

    const r2Key = blobKey(key);
    const existing = await platform.env.BLOBS.head(r2Key);
    if (existing) return jsonResponse({ sha256: key, status: 'exists' }, 200);

    await platform.env.BLOBS.put(r2Key, body);
    return jsonResponse({ sha256: key, status: 'created' }, 201);
  } catch (err) {
    return errorResponse(err);
  }
};
```

Add import at top of file:
```ts
import { verifyBlobAuth } from '$lib/server/blob-auth';
```

- [ ] **Step 5: Run the test**

```bash
cd site && npm run test:main -- blobs-put-signed
```
Expected: both tests pass.

- [ ] **Step 6: Commit**

```bash
git add site/src/lib/server/blob-auth.ts site/src/routes/api/v1/blobs/ site/test/integration/blobs-put-signed.test.ts
git commit -m "feat(api): require Ed25519-signed auth on PUT /api/v1/blobs/:sha256"
```

---

### Task 1.2: POST /api/v1/runs/precheck

**Files:**
- Create: `site/src/routes/api/v1/runs/precheck/+server.ts`
- Test: `site/test/integration/runs-precheck.test.ts`

- [ ] **Step 1: Write the failing test**

Write `site/test/integration/runs-precheck.test.ts`:

```ts
import { env, SELF } from 'cloudflare:test';
import { describe, expect, it, beforeAll } from 'vitest';
import * as ed from '@noble/ed25519';
import { canonicalJSON } from '$lib/shared/canonical';

describe('POST /api/v1/runs/precheck', () => {
  let privKey: Uint8Array;
  let keyId: number;

  beforeAll(async () => {
    privKey = ed.utils.randomPrivateKey();
    const pubKey = await ed.getPublicKeyAsync(privKey);
    const row = await env.DB.prepare(
      `INSERT INTO machine_keys(machine_id, public_key, scope, created_at)
       VALUES (?, ?, 'ingest', ?) RETURNING id`,
    ).bind('test-precheck', pubKey, new Date().toISOString()).first<{ id: number }>();
    keyId = row!.id;
  });

  it('returns missing_blobs for unknown hashes', async () => {
    const payload = {
      task_set_hash: 'abc',
      model: { slug: 'x/y', api_model_id: 'y', family_slug: 'x' },
      settings: { temperature: 0.1 },
      machine_id: 'm',
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      pricing_version: 'v',
      results: [
        {
          task_id: 't1', attempt: 1, passed: true, score: 1,
          compile_success: true, compile_errors: [], tests_total: 1, tests_passed: 1,
          tokens_in: 1, tokens_out: 1, tokens_cache_read: 0, tokens_cache_write: 0,
          durations_ms: {}, failure_reasons: [],
          transcript_sha256: 'f'.repeat(64),
          code_sha256: 'e'.repeat(64),
        },
      ],
      reproduction_bundle_sha256: 'd'.repeat(64),
    };
    const canonical = canonicalJSON(payload);
    const sig = await ed.signAsync(new TextEncoder().encode(canonical), privKey);
    const body = {
      version: 1,
      run_id: 'pre-' + crypto.randomUUID(),
      signature: {
        alg: 'Ed25519',
        key_id: keyId,
        signed_at: new Date().toISOString(),
        value: btoa(String.fromCharCode(...sig)),
      },
      payload,
    };
    const resp = await SELF.fetch('https://x/api/v1/runs/precheck', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(resp.status).toBe(200);
    const json = await resp.json() as { missing_blobs: string[] };
    expect(json.missing_blobs).toContain('f'.repeat(64));
    expect(json.missing_blobs).toContain('e'.repeat(64));
    expect(json.missing_blobs).toContain('d'.repeat(64));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd site && npm run test:main -- runs-precheck
```
Expected: FAIL — 404, route doesn't exist.

- [ ] **Step 3: Write the handler**

Write `site/src/routes/api/v1/runs/precheck/+server.ts`:

```ts
import type { RequestHandler } from './$types';
import { verifySignedRequest } from '$lib/server/signature';
import { payloadBlobHashes, findMissingBlobs } from '$lib/server/ingest';
import { ApiError, errorResponse, jsonResponse } from '$lib/server/errors';
import type { SignedRunPayload } from '$lib/shared/types';

export const POST: RequestHandler = async ({ request, platform }) => {
  if (!platform) return errorResponse(new ApiError(500, 'no_platform', 'platform env missing'));
  const db = platform.env.DB;
  const blobs = platform.env.BLOBS;

  try {
    const signed = await request.json() as SignedRunPayload;
    if (signed.version !== 1) throw new ApiError(400, 'bad_version', 'only version 1 supported');
    if (!signed.run_id) throw new ApiError(400, 'missing_run_id', 'run_id required');

    await verifySignedRequest(
      db,
      signed as unknown as { signature: { alg: 'Ed25519'; key_id: number; signed_at: string; value: string }; payload: Record<string, unknown> },
      'ingest',
    );

    const missing = await findMissingBlobs(blobs, payloadBlobHashes(signed.payload));
    return jsonResponse({ missing_blobs: missing }, 200);
  } catch (err) {
    return errorResponse(err);
  }
};
```

- [ ] **Step 4: Run the test**

```bash
cd site && npm run test:main -- runs-precheck
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add site/src/routes/api/v1/runs/precheck/ site/test/integration/runs-precheck.test.ts
git commit -m "feat(api): add POST /api/v1/runs/precheck for missing-blob discovery"
```

---

### Task 1.3: Admin catalog endpoints (models, pricing, task-sets)

**Files:**
- Create: `site/src/routes/api/v1/admin/catalog/models/+server.ts`
- Create: `site/src/routes/api/v1/admin/catalog/pricing/+server.ts`
- Create: `site/src/routes/api/v1/admin/catalog/task-sets/+server.ts`
- Test: `site/test/integration/catalog-admin.test.ts`

- [ ] **Step 1: Write the failing test for all three endpoints**

Write `site/test/integration/catalog-admin.test.ts`:

```ts
import { env, SELF } from 'cloudflare:test';
import { describe, expect, it, beforeAll } from 'vitest';
import * as ed from '@noble/ed25519';
import { canonicalJSON } from '$lib/shared/canonical';

async function signedPost(path: string, payload: unknown, priv: Uint8Array, keyId: number) {
  const canonical = canonicalJSON(payload as Record<string, unknown>);
  const sig = await ed.signAsync(new TextEncoder().encode(canonical), priv);
  const body = {
    version: 1,
    signature: {
      alg: 'Ed25519',
      key_id: keyId,
      signed_at: new Date().toISOString(),
      value: btoa(String.fromCharCode(...sig)),
    },
    payload,
  };
  return SELF.fetch(`https://x${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('admin catalog endpoints', () => {
  let priv: Uint8Array;
  let keyId: number;

  beforeAll(async () => {
    priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);
    const row = await env.DB.prepare(
      `INSERT INTO machine_keys(machine_id, public_key, scope, created_at)
       VALUES (?, ?, 'admin', ?) RETURNING id`,
    ).bind('admin-test', pub, new Date().toISOString()).first<{ id: number }>();
    keyId = row!.id;

    // ensure family
    await env.DB.prepare(
      `INSERT OR IGNORE INTO model_families(slug, vendor, display_name) VALUES (?, ?, ?)`,
    ).bind('claude', 'Anthropic', 'Claude').run();
  });

  it('upserts a model', async () => {
    const resp = await signedPost('/api/v1/admin/catalog/models', {
      slug: 'anthropic/claude-opus-test',
      api_model_id: 'claude-opus-test-2026',
      family: 'claude',
      display_name: 'Claude Opus (Test)',
      generation: 99,
    }, priv, keyId);
    expect(resp.status).toBe(200);
    const row = await env.DB.prepare(
      `SELECT display_name FROM models WHERE slug = ?`,
    ).bind('anthropic/claude-opus-test').first<{ display_name: string }>();
    expect(row?.display_name).toBe('Claude Opus (Test)');
  });

  it('upserts a task_set', async () => {
    const resp = await signedPost('/api/v1/admin/catalog/task-sets', {
      hash: 'h'.repeat(64),
      created_at: new Date().toISOString(),
      task_count: 42,
    }, priv, keyId);
    expect(resp.status).toBe(200);
  });

  it('upserts a pricing row', async () => {
    const resp = await signedPost('/api/v1/admin/catalog/pricing', {
      pricing_version: 'test-2026-04-20',
      model_slug: 'anthropic/claude-opus-test',
      input_per_mtoken: 15,
      output_per_mtoken: 75,
      cache_read_per_mtoken: 1.5,
      cache_write_per_mtoken: 18.75,
      effective_from: '2026-04-20T00:00:00Z',
      source: 'anthropic-api',
      fetched_at: '2026-04-20T10:00:00Z',
    }, priv, keyId);
    expect(resp.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd site && npm run test:main -- catalog-admin
```
Expected: FAIL — 404s on all three endpoints.

- [ ] **Step 3: Write the models endpoint**

Write `site/src/routes/api/v1/admin/catalog/models/+server.ts`:

```ts
import type { RequestHandler } from './$types';
import { verifySignedRequest } from '$lib/server/signature';
import { ApiError, errorResponse, jsonResponse } from '$lib/server/errors';

interface ModelUpsert {
  slug: string;
  api_model_id: string;
  family: string;
  display_name: string;
  generation?: number | null;
  released_at?: string | null;
  deprecated_at?: string | null;
}

export const POST: RequestHandler = async ({ request, platform }) => {
  if (!platform) return errorResponse(new ApiError(500, 'no_platform', 'platform env missing'));
  const db = platform.env.DB;
  try {
    const body = await request.json() as { signature: any; payload: ModelUpsert };
    await verifySignedRequest(db, body, 'admin');
    const p = body.payload;
    if (!p.slug || !p.api_model_id || !p.family || !p.display_name) {
      throw new ApiError(400, 'missing_field', 'slug, api_model_id, family, display_name required');
    }
    const fam = await db.prepare(`SELECT id FROM model_families WHERE slug = ?`).bind(p.family).first<{ id: number }>();
    if (!fam) throw new ApiError(400, 'unknown_family', `model family '${p.family}' not in catalog`);
    await db.prepare(
      `INSERT INTO models(family_id, slug, api_model_id, display_name, generation, released_at, deprecated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(slug, api_model_id) DO UPDATE SET
         display_name = excluded.display_name,
         generation = excluded.generation,
         released_at = excluded.released_at,
         deprecated_at = excluded.deprecated_at`,
    ).bind(
      fam.id, p.slug, p.api_model_id, p.display_name,
      p.generation ?? null, p.released_at ?? null, p.deprecated_at ?? null,
    ).run();
    return jsonResponse({ ok: true }, 200);
  } catch (err) {
    return errorResponse(err);
  }
};
```

- [ ] **Step 4: Write the task-sets endpoint**

Write `site/src/routes/api/v1/admin/catalog/task-sets/+server.ts`:

```ts
import type { RequestHandler } from './$types';
import { verifySignedRequest } from '$lib/server/signature';
import { ApiError, errorResponse, jsonResponse } from '$lib/server/errors';

interface TaskSetUpsert {
  hash: string;
  created_at: string;
  task_count: number;
}

export const POST: RequestHandler = async ({ request, platform }) => {
  if (!platform) return errorResponse(new ApiError(500, 'no_platform', 'platform env missing'));
  const db = platform.env.DB;
  try {
    const body = await request.json() as { signature: any; payload: TaskSetUpsert };
    await verifySignedRequest(db, body, 'admin');
    const p = body.payload;
    if (!p.hash || !p.created_at || p.task_count == null) {
      throw new ApiError(400, 'missing_field', 'hash, created_at, task_count required');
    }
    await db.prepare(
      `INSERT OR IGNORE INTO task_sets(hash, created_at, task_count, is_current) VALUES (?, ?, ?, 0)`,
    ).bind(p.hash, p.created_at, p.task_count).run();
    return jsonResponse({ ok: true }, 200);
  } catch (err) {
    return errorResponse(err);
  }
};
```

- [ ] **Step 5: Write the pricing endpoint**

Write `site/src/routes/api/v1/admin/catalog/pricing/+server.ts`:

```ts
import type { RequestHandler } from './$types';
import { verifySignedRequest } from '$lib/server/signature';
import { ApiError, errorResponse, jsonResponse } from '$lib/server/errors';

interface PricingUpsert {
  pricing_version: string;
  model_slug: string;
  input_per_mtoken: number;
  output_per_mtoken: number;
  cache_read_per_mtoken?: number;
  cache_write_per_mtoken?: number;
  effective_from: string;
  effective_until?: string;
  source: string;
  fetched_at?: string;
}

export const POST: RequestHandler = async ({ request, platform }) => {
  if (!platform) return errorResponse(new ApiError(500, 'no_platform', 'platform env missing'));
  const db = platform.env.DB;
  try {
    const body = await request.json() as { signature: any; payload: PricingUpsert };
    await verifySignedRequest(db, body, 'admin');
    const p = body.payload;
    const m = await db.prepare(`SELECT id FROM models WHERE slug = ?`).bind(p.model_slug).first<{ id: number }>();
    if (!m) throw new ApiError(400, 'unknown_model', `model_slug '${p.model_slug}' not in catalog`);
    if (!p.source) throw new ApiError(400, 'missing_source', 'source is required (anthropic-api, openai-api, gemini-api, openrouter-api, manual)');
    await db.prepare(
      `INSERT OR IGNORE INTO cost_snapshots(
         pricing_version, model_id, input_per_mtoken, output_per_mtoken,
         cache_read_per_mtoken, cache_write_per_mtoken, effective_from, effective_until,
         source, fetched_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      p.pricing_version, m.id, p.input_per_mtoken, p.output_per_mtoken,
      p.cache_read_per_mtoken ?? 0, p.cache_write_per_mtoken ?? 0,
      p.effective_from, p.effective_until ?? null,
      p.source, p.fetched_at ?? null,
    ).run();
    return jsonResponse({ ok: true }, 200);
  } catch (err) {
    return errorResponse(err);
  }
};
```

- [ ] **Step 6: Run tests**

```bash
cd site && npm run test:main -- catalog-admin
```
Expected: all 3 tests pass.

- [ ] **Step 7: Commit**

```bash
git add site/src/routes/api/v1/admin/catalog/ site/test/integration/catalog-admin.test.ts
git commit -m "feat(api): admin catalog endpoints for models, pricing, task-sets"
```

---

## Phase 2: CLI pure core (canonical, sign, envelope, task-set hash)

### Task 2.1: src/ingest/types.ts + canonical re-export

**Files:**
- Create: `src/ingest/types.ts`
- Create: `src/ingest/canonical.ts`

- [ ] **Step 1: Write types.ts**

```ts
// src/ingest/types.ts
export type Source = 'anthropic-api' | 'openai-api' | 'gemini-api' | 'openrouter-api' | 'manual';

export interface PricingRates {
  input_per_mtoken: number;
  output_per_mtoken: number;
  cache_read_per_mtoken: number;
  cache_write_per_mtoken: number;
  source: Source;
  fetched_at: string;
}

export interface CatalogModelEntry {
  slug: string;
  api_model_id: string;
  family: string;
  display_name: string;
  generation?: number | null;
  released_at?: string | null;
  deprecated_at?: string | null;
}

export interface CatalogPricingEntry extends PricingRates {
  pricing_version: string;
  model_slug: string;
  effective_from: string;
  effective_until?: string | null;
}

export interface CatalogFamilyEntry {
  slug: string;
  vendor: string;
  display_name: string;
}

export interface IngestConfig {
  url: string;           // e.g. https://centralgauge.sshadows.workers.dev
  keyPath: string;       // ~/.centralgauge/keys/production-ingest.ed25519
  keyId: number;         // machine_keys.id
  machineId: string;     // matches machine_keys.machine_id
  adminKeyPath?: string; // for sync-catalog
  adminKeyId?: number;
}

export type IngestOutcome =
  | { kind: 'success'; runId: string; bytesUploaded: number }
  | { kind: 'retryable-failure'; attempts: number; lastError: Error; replayCommand: string }
  | { kind: 'fatal-failure'; code: string; message: string };
```

- [ ] **Step 2: Write canonical re-export**

```ts
// src/ingest/canonical.ts
export { canonicalJSON } from "../../shared/canonical.ts";
```

- [ ] **Step 3: Commit**

```bash
git add src/ingest/types.ts src/ingest/canonical.ts
git commit -m "feat(ingest): add types + canonical re-export"
```

---

### Task 2.2: src/ingest/sign.ts + tests

**Files:**
- Create: `src/ingest/sign.ts`
- Test: `tests/unit/ingest/sign_test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/unit/ingest/sign_test.ts
import { assertEquals } from "@std/assert";
import * as ed from "npm:@noble/ed25519@3.1.0";
import { signPayload } from "../../../src/ingest/sign.ts";

Deno.test("signPayload produces verifiable Ed25519 signature over canonical JSON", async () => {
  const priv = ed.utils.randomPrivateKey();
  const pub = await ed.getPublicKeyAsync(priv);
  const payload = { b: 2, a: 1 };
  const sig = await signPayload(payload, priv, 42);
  assertEquals(sig.alg, "Ed25519");
  assertEquals(sig.key_id, 42);
  // Verify
  const canonical = '{"a":1,"b":2}';
  const msg = new TextEncoder().encode(canonical);
  const raw = Uint8Array.from(atob(sig.value), (c) => c.charCodeAt(0));
  const ok = await ed.verifyAsync(raw, msg, pub);
  assertEquals(ok, true);
});
```

- [ ] **Step 2: Run to confirm it fails**

```bash
deno task test:unit -- sign_test
```
Expected: FAIL — module missing.

- [ ] **Step 3: Write sign.ts**

```ts
// src/ingest/sign.ts
import * as ed from "npm:@noble/ed25519@3.1.0";
import { canonicalJSON } from "./canonical.ts";
import { encodeBase64 } from "jsr:@std/encoding@^1.0.5/base64";

export interface Signature {
  alg: "Ed25519";
  key_id: number;
  signed_at: string;
  value: string;
}

export async function signPayload(
  payload: Record<string, unknown>,
  privateKey: Uint8Array,
  keyId: number,
  now: Date = new Date(),
): Promise<Signature> {
  const canonical = canonicalJSON(payload);
  const bytes = new TextEncoder().encode(canonical);
  const sig = await ed.signAsync(bytes, privateKey);
  return {
    alg: "Ed25519",
    key_id: keyId,
    signed_at: now.toISOString(),
    value: encodeBase64(sig),
  };
}

export async function signBlobUpload(
  path: string,
  bodySha256: string,
  privateKey: Uint8Array,
  keyId: number,
  now: Date = new Date(),
): Promise<{ signature: string; key_id: number; signed_at: string }> {
  const signedAt = now.toISOString();
  const canonical = canonicalJSON({
    method: "PUT",
    path,
    body_sha256: bodySha256,
    signed_at: signedAt,
  });
  const sig = await ed.signAsync(new TextEncoder().encode(canonical), privateKey);
  return { signature: encodeBase64(sig), key_id: keyId, signed_at: signedAt };
}
```

- [ ] **Step 4: Run test**

```bash
deno task test:unit -- sign_test
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ingest/sign.ts tests/unit/ingest/sign_test.ts
git commit -m "feat(ingest): Ed25519 sign helper for payloads + blob uploads"
```

---

### Task 2.3: src/ingest/catalog/task-set-hash.ts + tests

**Files:**
- Create: `src/ingest/catalog/task-set-hash.ts`
- Test: `tests/unit/ingest/task_set_hash_test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/unit/ingest/task_set_hash_test.ts
import { assertEquals, assertNotEquals } from "@std/assert";
import { computeTaskSetHash } from "../../../src/ingest/catalog/task-set-hash.ts";

Deno.test("task-set hash is deterministic and order-independent", async () => {
  const tmp = await Deno.makeTempDir();
  await Deno.writeTextFile(`${tmp}/b-task.yml`, "id: B\nbody: banana");
  await Deno.writeTextFile(`${tmp}/a-task.yml`, "id: A\nbody: apple");
  const h1 = await computeTaskSetHash(tmp);
  // Touch files in different order; re-hash must match
  const h2 = await computeTaskSetHash(tmp);
  assertEquals(h1, h2);
  // Different content → different hash
  await Deno.writeTextFile(`${tmp}/a-task.yml`, "id: A\nbody: apricot");
  const h3 = await computeTaskSetHash(tmp);
  assertNotEquals(h1, h3);
});
```

- [ ] **Step 2: Run to confirm it fails**

```bash
deno task test:unit -- task_set_hash
```
Expected: FAIL — module missing.

- [ ] **Step 3: Write the module**

```ts
// src/ingest/catalog/task-set-hash.ts
import { walk } from "jsr:@std/fs@^1.0.0/walk";
import { encodeHex } from "jsr:@std/encoding@^1.0.5/hex";

/**
 * Compute a deterministic content hash over all *.yml files under `tasksDir`.
 * Walks files, sorts by relative path, hashes "<relpath>\0<content>\0" per
 * file, then SHA-256 of the concatenation.
 */
export async function computeTaskSetHash(tasksDir: string): Promise<string> {
  const entries: Array<{ rel: string; bytes: Uint8Array }> = [];
  for await (const e of walk(tasksDir, { exts: [".yml"], includeDirs: false })) {
    const rel = e.path.slice(tasksDir.length + 1).replaceAll("\\", "/");
    entries.push({ rel, bytes: await Deno.readFile(e.path) });
  }
  entries.sort((a, b) => a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0);
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  for (const { rel, bytes } of entries) {
    chunks.push(enc.encode(rel));
    chunks.push(new Uint8Array([0]));
    chunks.push(bytes);
    chunks.push(new Uint8Array([0]));
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const concat = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { concat.set(c, o); o += c.length; }
  const digest = await crypto.subtle.digest("SHA-256", concat);
  return encodeHex(new Uint8Array(digest));
}
```

- [ ] **Step 4: Run test**

```bash
deno task test:unit -- task_set_hash
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ingest/catalog/task-set-hash.ts tests/unit/ingest/task_set_hash_test.ts
git commit -m "feat(ingest): deterministic task-set hashing over tasks/**/*.yml"
```

---

### Task 2.4: src/ingest/envelope.ts + tests

**Files:**
- Create: `src/ingest/envelope.ts`
- Test: `tests/unit/ingest/envelope_test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/unit/ingest/envelope_test.ts
import { assertEquals } from "@std/assert";
import { buildPayload } from "../../../src/ingest/envelope.ts";

Deno.test("buildPayload maps benchmark result to SignedRunPayload.payload", () => {
  const payload = buildPayload({
    runId: "run-123",
    taskSetHash: "a".repeat(64),
    model: { slug: "x/y", api_model_id: "y-2026", family_slug: "x" },
    settings: { temperature: 0.1, max_attempts: 2 },
    machineId: "m1",
    startedAt: "2026-04-20T10:00:00Z",
    completedAt: "2026-04-20T18:00:00Z",
    pricingVersion: "pv-2026-04-20",
    centralgaugeSha: "abc1234",
    reproductionBundleSha256: "d".repeat(64),
    results: [
      {
        task_id: "t1", attempt: 1, passed: true, score: 1.0,
        compile_success: true, compile_errors: [], tests_total: 3, tests_passed: 3,
        tokens_in: 100, tokens_out: 50, tokens_cache_read: 0, tokens_cache_write: 0,
        durations_ms: { llm: 1000 }, failure_reasons: [],
        transcript_sha256: "f".repeat(64), code_sha256: "e".repeat(64),
      },
    ],
  });
  assertEquals(payload.task_set_hash, "a".repeat(64));
  assertEquals(payload.model.slug, "x/y");
  assertEquals(payload.pricing_version, "pv-2026-04-20");
  assertEquals(payload.results.length, 1);
  assertEquals(payload.results[0].task_id, "t1");
  assertEquals(payload.reproduction_bundle_sha256, "d".repeat(64));
});
```

- [ ] **Step 2: Run to confirm it fails**

```bash
deno task test:unit -- envelope_test
```
Expected: FAIL.

- [ ] **Step 3: Write envelope.ts**

```ts
// src/ingest/envelope.ts
import type { ResultInput } from "../../site/src/lib/shared/types.ts";

export interface BuildPayloadInput {
  runId: string;
  taskSetHash: string;
  model: { slug: string; api_model_id: string; family_slug: string };
  settings: Record<string, unknown>;
  machineId: string;
  startedAt: string;
  completedAt: string;
  pricingVersion: string;
  centralgaugeSha?: string;
  reproductionBundleSha256?: string;
  results: ResultInput[];
}

export function buildPayload(input: BuildPayloadInput): Record<string, unknown> {
  const p: Record<string, unknown> = {
    task_set_hash: input.taskSetHash,
    model: input.model,
    settings: input.settings,
    machine_id: input.machineId,
    started_at: input.startedAt,
    completed_at: input.completedAt,
    pricing_version: input.pricingVersion,
    results: input.results,
  };
  if (input.centralgaugeSha) p.centralgauge_sha = input.centralgaugeSha;
  if (input.reproductionBundleSha256) p.reproduction_bundle_sha256 = input.reproductionBundleSha256;
  return p;
}
```

- [ ] **Step 4: Run test**

```bash
deno task test:unit -- envelope_test
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ingest/envelope.ts tests/unit/ingest/envelope_test.ts
git commit -m "feat(ingest): payload builder"
```

---

## Phase 3: CLI catalog I/O

### Task 3.1: catalog/read.ts + tests

**Files:**
- Create: `src/ingest/catalog/read.ts`
- Test: `tests/unit/ingest/catalog_read_test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/unit/ingest/catalog_read_test.ts
import { assertEquals } from "@std/assert";
import { readCatalog } from "../../../src/ingest/catalog/read.ts";

Deno.test("readCatalog parses models, pricing, families", async () => {
  const tmp = await Deno.makeTempDir();
  await Deno.writeTextFile(`${tmp}/models.yml`, `
- slug: a/b
  api_model_id: b-2026
  family: a
  display_name: B
`);
  await Deno.writeTextFile(`${tmp}/pricing.yml`, `
- pricing_version: pv-1
  model_slug: a/b
  input_per_mtoken: 1
  output_per_mtoken: 2
  cache_read_per_mtoken: 0
  cache_write_per_mtoken: 0
  effective_from: 2026-04-20T00:00:00Z
  source: manual
`);
  await Deno.writeTextFile(`${tmp}/model-families.yml`, `
- slug: a
  vendor: A Inc
  display_name: Alpha
`);
  const cat = await readCatalog(tmp);
  assertEquals(cat.models.length, 1);
  assertEquals(cat.models[0].slug, "a/b");
  assertEquals(cat.pricing.length, 1);
  assertEquals(cat.pricing[0].pricing_version, "pv-1");
  assertEquals(cat.families.length, 1);
});
```

- [ ] **Step 2: Run to confirm it fails**

```bash
deno task test:unit -- catalog_read
```
Expected: FAIL.

- [ ] **Step 3: Write read.ts**

```ts
// src/ingest/catalog/read.ts
import { parse } from "jsr:@std/yaml@^1.1.0";
import type { CatalogModelEntry, CatalogPricingEntry, CatalogFamilyEntry } from "../types.ts";

export interface Catalog {
  models: CatalogModelEntry[];
  pricing: CatalogPricingEntry[];
  families: CatalogFamilyEntry[];
}

async function readYaml<T>(path: string): Promise<T[]> {
  try {
    const text = await Deno.readTextFile(path);
    const parsed = parse(text);
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return [];
    throw e;
  }
}

export async function readCatalog(catalogDir: string): Promise<Catalog> {
  const [models, pricing, families] = await Promise.all([
    readYaml<CatalogModelEntry>(`${catalogDir}/models.yml`),
    readYaml<CatalogPricingEntry>(`${catalogDir}/pricing.yml`),
    readYaml<CatalogFamilyEntry>(`${catalogDir}/model-families.yml`),
  ]);
  return { models, pricing, families };
}

export function findModel(cat: Catalog, slug: string, apiModelId: string): CatalogModelEntry | null {
  return cat.models.find((m) => m.slug === slug && m.api_model_id === apiModelId) ?? null;
}

export function findPricing(cat: Catalog, pricingVersion: string, modelSlug: string): CatalogPricingEntry | null {
  return cat.pricing.find((p) => p.pricing_version === pricingVersion && p.model_slug === modelSlug) ?? null;
}
```

- [ ] **Step 4: Run test**

```bash
deno task test:unit -- catalog_read
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ingest/catalog/read.ts tests/unit/ingest/catalog_read_test.ts
git commit -m "feat(ingest): catalog YAML reader"
```

---

### Task 3.2: catalog/write.ts + tests

**Files:**
- Create: `src/ingest/catalog/write.ts`
- Test: `tests/unit/ingest/catalog_write_test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/unit/ingest/catalog_write_test.ts
import { assertEquals, assertStringIncludes } from "@std/assert";
import { appendModel, appendPricing } from "../../../src/ingest/catalog/write.ts";

Deno.test("appendModel adds an entry, preserving leading comments", async () => {
  const tmp = await Deno.makeTempDir();
  const path = `${tmp}/models.yml`;
  await Deno.writeTextFile(path, `# Model catalog — checked in\n- slug: x/y\n  api_model_id: y-1\n  family: x\n  display_name: Y\n`);
  await appendModel(path, {
    slug: "x/z",
    api_model_id: "z-1",
    family: "x",
    display_name: "Z",
  });
  const text = await Deno.readTextFile(path);
  assertStringIncludes(text, "# Model catalog — checked in");
  assertStringIncludes(text, "slug: x/z");
  assertStringIncludes(text, "display_name: Z");
});

Deno.test("appendPricing writes source field", async () => {
  const tmp = await Deno.makeTempDir();
  const path = `${tmp}/pricing.yml`;
  await Deno.writeTextFile(path, "[]\n");
  await appendPricing(path, {
    pricing_version: "pv-1",
    model_slug: "x/y",
    input_per_mtoken: 1,
    output_per_mtoken: 2,
    cache_read_per_mtoken: 0,
    cache_write_per_mtoken: 0,
    effective_from: "2026-04-20T00:00:00Z",
    source: "manual",
    fetched_at: "2026-04-20T10:00:00Z",
  });
  const text = await Deno.readTextFile(path);
  assertStringIncludes(text, "source: manual");
});
```

- [ ] **Step 2: Run to confirm it fails**

```bash
deno task test:unit -- catalog_write
```
Expected: FAIL.

- [ ] **Step 3: Write write.ts**

```ts
// src/ingest/catalog/write.ts
import { stringify } from "jsr:@std/yaml@^1.1.0";
import type { CatalogModelEntry, CatalogPricingEntry } from "../types.ts";

async function append(path: string, entry: unknown): Promise<void> {
  let existing = "";
  try {
    existing = await Deno.readTextFile(path);
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }
  if (existing.trim() === "" || existing.trim() === "[]") {
    existing = existing.trim() === "[]" ? "" : existing;
  }
  const snippet = stringify([entry]).replace(/^/, "");
  const sep = existing.length && !existing.endsWith("\n") ? "\n" : "";
  await Deno.writeTextFile(path, existing + sep + snippet);
}

export async function appendModel(path: string, m: CatalogModelEntry): Promise<void> {
  await append(path, m);
}

export async function appendPricing(path: string, p: CatalogPricingEntry): Promise<void> {
  await append(path, p);
}
```

- [ ] **Step 4: Run test**

```bash
deno task test:unit -- catalog_write
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ingest/catalog/write.ts tests/unit/ingest/catalog_write_test.ts
git commit -m "feat(ingest): catalog YAML appenders"
```

---

## Phase 4: CLI pricing sources

### Task 4.1: Pricing-sources interface + OpenRouter adapter

**Files:**
- Create: `src/ingest/pricing-sources/types.ts`
- Create: `src/ingest/pricing-sources/openrouter.ts`
- Test: `tests/unit/ingest/pricing_sources_openrouter_test.ts`

- [ ] **Step 1: Write the interface**

```ts
// src/ingest/pricing-sources/types.ts
import type { PricingRates } from "../types.ts";

export interface PricingSource {
  /** Return rates if this adapter has them; null if it doesn't. */
  fetchPricing(slug: string, apiModelId: string): Promise<PricingRates | null>;
}
```

- [ ] **Step 2: Write failing test**

```ts
// tests/unit/ingest/pricing_sources_openrouter_test.ts
import { assertEquals } from "@std/assert";
import { OpenRouterSource } from "../../../src/ingest/pricing-sources/openrouter.ts";

Deno.test("OpenRouter adapter parses pricing for a known model", async () => {
  const fakeResp = JSON.stringify({
    data: [
      {
        id: "anthropic/claude-opus-4-7",
        pricing: {
          prompt: "0.000015",
          completion: "0.000075",
          input_cache_read: "0.0000015",
          input_cache_write: "0.00001875",
        },
      },
    ],
  });
  const fetchFn = async () => new Response(fakeResp, { status: 200 });
  const src = new OpenRouterSource(fetchFn);
  const rates = await src.fetchPricing("anthropic/claude-opus-4-7", "claude-opus-4-7");
  assertEquals(rates?.input_per_mtoken, 15);
  assertEquals(rates?.output_per_mtoken, 75);
  assertEquals(rates?.cache_read_per_mtoken, 1.5);
  assertEquals(rates?.cache_write_per_mtoken, 18.75);
  assertEquals(rates?.source, "openrouter-api");
});

Deno.test("OpenRouter adapter returns null for unknown model", async () => {
  const fetchFn = async () => new Response(JSON.stringify({ data: [] }), { status: 200 });
  const src = new OpenRouterSource(fetchFn);
  const rates = await src.fetchPricing("unknown/model", "unknown");
  assertEquals(rates, null);
});
```

- [ ] **Step 3: Run to confirm it fails**

```bash
deno task test:unit -- pricing_sources_openrouter
```
Expected: FAIL.

- [ ] **Step 4: Write the OpenRouter adapter**

```ts
// src/ingest/pricing-sources/openrouter.ts
import type { PricingRates } from "../types.ts";
import type { PricingSource } from "./types.ts";

type FetchFn = typeof fetch;

interface OrModel {
  id: string;
  pricing: {
    prompt: string;
    completion: string;
    input_cache_read?: string;
    input_cache_write?: string;
  };
}

export class OpenRouterSource implements PricingSource {
  private fetchFn: FetchFn;
  constructor(fetchFn: FetchFn = fetch) {
    this.fetchFn = fetchFn;
  }

  async fetchPricing(slug: string, _apiModelId: string): Promise<PricingRates | null> {
    const resp = await this.fetchFn("https://openrouter.ai/api/v1/models");
    if (!resp.ok) return null;
    const json = await resp.json() as { data: OrModel[] };
    const hit = json.data.find((m) => m.id === slug);
    if (!hit) return null;
    // OpenRouter prices are per token; we want per-million-tokens.
    return {
      input_per_mtoken: Number(hit.pricing.prompt) * 1_000_000,
      output_per_mtoken: Number(hit.pricing.completion) * 1_000_000,
      cache_read_per_mtoken: Number(hit.pricing.input_cache_read ?? "0") * 1_000_000,
      cache_write_per_mtoken: Number(hit.pricing.input_cache_write ?? "0") * 1_000_000,
      source: "openrouter-api",
      fetched_at: new Date().toISOString(),
    };
  }
}
```

- [ ] **Step 5: Run test**

```bash
deno task test:unit -- pricing_sources_openrouter
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/ingest/pricing-sources/types.ts src/ingest/pricing-sources/openrouter.ts tests/unit/ingest/pricing_sources_openrouter_test.ts
git commit -m "feat(ingest): OpenRouter pricing adapter"
```

---

### Task 4.2: Anthropic, OpenAI, Gemini adapter stubs + dispatcher

**Files:**
- Create: `src/ingest/pricing-sources/anthropic.ts`
- Create: `src/ingest/pricing-sources/openai.ts`
- Create: `src/ingest/pricing-sources/gemini.ts`
- Create: `src/ingest/pricing-sources/index.ts`
- Test: `tests/unit/ingest/pricing_sources_dispatch_test.ts`

- [ ] **Step 1: Write stubs (return null if adapter can't fetch)**

Each stub returns null for now; real endpoints can be added incrementally. The dispatcher falls through to OpenRouter and then to manual entry anyway.

Write `src/ingest/pricing-sources/anthropic.ts`:

```ts
import type { PricingRates } from "../types.ts";
import type { PricingSource } from "./types.ts";

export class AnthropicSource implements PricingSource {
  async fetchPricing(_slug: string, _apiModelId: string): Promise<PricingRates | null> {
    // Anthropic has no public pricing JSON endpoint at time of writing.
    // Implement once the endpoint exists; until then we defer to OpenRouter + manual.
    return null;
  }
}
```

Write `src/ingest/pricing-sources/openai.ts`:

```ts
import type { PricingRates } from "../types.ts";
import type { PricingSource } from "./types.ts";

export class OpenAISource implements PricingSource {
  async fetchPricing(_slug: string, _apiModelId: string): Promise<PricingRates | null> {
    return null;
  }
}
```

Write `src/ingest/pricing-sources/gemini.ts`:

```ts
import type { PricingRates } from "../types.ts";
import type { PricingSource } from "./types.ts";

export class GeminiSource implements PricingSource {
  async fetchPricing(_slug: string, _apiModelId: string): Promise<PricingRates | null> {
    return null;
  }
}
```

- [ ] **Step 2: Write dispatcher test**

```ts
// tests/unit/ingest/pricing_sources_dispatch_test.ts
import { assertEquals } from "@std/assert";
import { fetchPricingFromSources } from "../../../src/ingest/pricing-sources/index.ts";
import type { PricingSource } from "../../../src/ingest/pricing-sources/types.ts";

Deno.test("dispatch returns first non-null adapter result", async () => {
  const noHit: PricingSource = { fetchPricing: async () => null };
  const hit: PricingSource = {
    fetchPricing: async () => ({
      input_per_mtoken: 1, output_per_mtoken: 2,
      cache_read_per_mtoken: 0, cache_write_per_mtoken: 0,
      source: "openrouter-api", fetched_at: "2026-04-20T00:00:00Z",
    }),
  };
  const rates = await fetchPricingFromSources([noHit, hit], "x/y", "y");
  assertEquals(rates?.source, "openrouter-api");
});

Deno.test("dispatch returns null when all adapters miss", async () => {
  const noHit: PricingSource = { fetchPricing: async () => null };
  const rates = await fetchPricingFromSources([noHit, noHit], "x/y", "y");
  assertEquals(rates, null);
});
```

- [ ] **Step 3: Write index.ts (dispatcher)**

```ts
// src/ingest/pricing-sources/index.ts
import type { PricingRates } from "../types.ts";
import type { PricingSource } from "./types.ts";
import { AnthropicSource } from "./anthropic.ts";
import { OpenAISource } from "./openai.ts";
import { GeminiSource } from "./gemini.ts";
import { OpenRouterSource } from "./openrouter.ts";

export function sourcesForFamily(family: string): PricingSource[] {
  const or = new OpenRouterSource();
  switch (family) {
    case "claude":  return [new AnthropicSource(), or];
    case "gpt":     return [new OpenAISource(), or];
    case "gemini":  return [new GeminiSource(), or];
    default:        return [or];
  }
}

export async function fetchPricingFromSources(
  sources: PricingSource[],
  slug: string,
  apiModelId: string,
): Promise<PricingRates | null> {
  for (const s of sources) {
    const r = await s.fetchPricing(slug, apiModelId);
    if (r) return r;
  }
  return null;
}
```

- [ ] **Step 4: Run tests**

```bash
deno task test:unit -- pricing_sources_dispatch
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ingest/pricing-sources/
git commit -m "feat(ingest): pricing-source stubs + family dispatcher"
```

---

## Phase 5: CLI register + client + blobs + config

### Task 5.1: src/ingest/config.ts

**Files:**
- Create: `src/ingest/config.ts`
- Create: `.centralgauge.yml` entry for ingest (document; don't commit secrets)

- [ ] **Step 1: Write config.ts**

```ts
// src/ingest/config.ts
import { parse } from "jsr:@std/yaml@^1.1.0";
import type { IngestConfig } from "./types.ts";

const ENV_PREFIX = "CENTRALGAUGE_";

interface CliFlags {
  url?: string;
  keyPath?: string;
  keyId?: number;
  machineId?: string;
  adminKeyPath?: string;
  adminKeyId?: number;
}

export async function loadIngestConfig(cwd: string, flags: CliFlags): Promise<IngestConfig> {
  const fileConf = await loadYaml(`${cwd}/.centralgauge.yml`) ?? await loadYaml(`${homeDir()}/.centralgauge.yml`) ?? {};
  const ingest = (fileConf as Record<string, unknown>).ingest as Record<string, unknown> | undefined ?? {};
  const url = flags.url ?? Deno.env.get(`${ENV_PREFIX}INGEST_URL`) ?? ingest.url as string | undefined;
  const keyPath = flags.keyPath ?? Deno.env.get(`${ENV_PREFIX}INGEST_KEY_PATH`) ?? ingest.key_path as string | undefined;
  const keyIdRaw = flags.keyId ?? Deno.env.get(`${ENV_PREFIX}INGEST_KEY_ID`) ?? ingest.key_id;
  const machineId = flags.machineId ?? Deno.env.get(`${ENV_PREFIX}INGEST_MACHINE_ID`) ?? ingest.machine_id as string | undefined;
  const adminKeyPath = flags.adminKeyPath ?? ingest.admin_key_path as string | undefined;
  const adminKeyIdRaw = flags.adminKeyId ?? ingest.admin_key_id;
  if (!url) throw new Error("ingest.url missing (flag --url, env CENTRALGAUGE_INGEST_URL, or .centralgauge.yml ingest.url)");
  if (!keyPath) throw new Error("ingest.keyPath missing");
  if (keyIdRaw == null) throw new Error("ingest.keyId missing");
  if (!machineId) throw new Error("ingest.machineId missing");
  const keyId = typeof keyIdRaw === "number" ? keyIdRaw : parseInt(String(keyIdRaw), 10);
  const adminKeyId = adminKeyIdRaw == null ? undefined : typeof adminKeyIdRaw === "number" ? adminKeyIdRaw : parseInt(String(adminKeyIdRaw), 10);
  return { url: url.replace(/\/+$/, ""), keyPath: expandHome(keyPath), keyId, machineId, adminKeyPath: adminKeyPath ? expandHome(adminKeyPath) : undefined, adminKeyId };
}

async function loadYaml(path: string): Promise<unknown | null> {
  try {
    return parse(await Deno.readTextFile(path));
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return null;
    throw e;
  }
}

function homeDir(): string {
  return Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE") ?? ".";
}

function expandHome(p: string): string {
  if (!p.startsWith("~")) return p;
  return homeDir() + p.slice(1);
}

export async function readPrivateKey(path: string): Promise<Uint8Array> {
  const bytes = await Deno.readFile(expandHome(path));
  if (bytes.length !== 32) {
    throw new Error(`private key must be 32 raw bytes (got ${bytes.length}) at ${path}`);
  }
  return bytes;
}
```

- [ ] **Step 2: Quick smoke via deno check**

```bash
deno check src/ingest/config.ts
```
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/ingest/config.ts
git commit -m "feat(ingest): resolve URL/key/machine-id from flags + env + .centralgauge.yml"
```

---

### Task 5.2: src/ingest/client.ts with retry

**Files:**
- Create: `src/ingest/client.ts`
- Test: `tests/unit/ingest/client_test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/unit/ingest/client_test.ts
import { assertEquals, assertStringIncludes } from "@std/assert";
import { postWithRetry } from "../../../src/ingest/client.ts";

Deno.test("postWithRetry returns success on first try", async () => {
  let calls = 0;
  const fakeFetch: typeof fetch = async () => {
    calls++;
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  const resp = await postWithRetry("https://x/y", { a: 1 }, { fetchFn: fakeFetch, maxAttempts: 3 });
  assertEquals(resp.status, 200);
  assertEquals(calls, 1);
});

Deno.test("postWithRetry retries on 5xx", async () => {
  let calls = 0;
  const fakeFetch: typeof fetch = async () => {
    calls++;
    if (calls < 3) return new Response("oops", { status: 503 });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  const resp = await postWithRetry("https://x/y", { a: 1 }, { fetchFn: fakeFetch, maxAttempts: 5, backoffBaseMs: 1 });
  assertEquals(resp.status, 200);
  assertEquals(calls, 3);
});

Deno.test("postWithRetry does NOT retry on 4xx", async () => {
  let calls = 0;
  const fakeFetch: typeof fetch = async () => {
    calls++;
    return new Response(JSON.stringify({ code: "bad_signature" }), { status: 400 });
  };
  const resp = await postWithRetry("https://x/y", { a: 1 }, { fetchFn: fakeFetch, maxAttempts: 5, backoffBaseMs: 1 });
  assertEquals(resp.status, 400);
  assertEquals(calls, 1);
  const body = await resp.json() as { code: string };
  assertStringIncludes(body.code, "bad_signature");
});
```

- [ ] **Step 2: Run to confirm it fails**

```bash
deno task test:unit -- client_test
```
Expected: FAIL.

- [ ] **Step 3: Write client.ts**

```ts
// src/ingest/client.ts
export interface RetryOptions {
  fetchFn?: typeof fetch;
  maxAttempts?: number;
  backoffBaseMs?: number;
  onAttempt?: (attempt: number, lastError?: Error) => void;
}

export async function postWithRetry(
  url: string,
  body: unknown,
  opts: RetryOptions = {},
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  const fetchFn = opts.fetchFn ?? fetch;
  const max = opts.maxAttempts ?? 3;
  const base = opts.backoffBaseMs ?? 1000;
  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= max; attempt++) {
    opts.onAttempt?.(attempt, lastError);
    try {
      const resp = await fetchFn(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...extraHeaders },
        body: JSON.stringify(body),
      });
      // Don't retry 4xx
      if (resp.status >= 400 && resp.status < 500) return resp;
      // Retry on 5xx
      if (resp.status >= 500 && attempt < max) {
        lastError = new Error(`server returned ${resp.status}`);
        await sleep(base * Math.pow(4, attempt - 1));
        continue;
      }
      return resp;
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      if (attempt >= max) throw lastError;
      await sleep(base * Math.pow(4, attempt - 1));
    }
  }
  throw lastError ?? new Error("postWithRetry: exhausted attempts");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
```

- [ ] **Step 4: Run tests**

```bash
deno task test:unit -- client_test
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ingest/client.ts tests/unit/ingest/client_test.ts
git commit -m "feat(ingest): HTTP POST client with exponential backoff on 5xx/network"
```

---

### Task 5.3: src/ingest/blobs.ts (R2 uploader)

**Files:**
- Create: `src/ingest/blobs.ts`

- [ ] **Step 1: Write blobs.ts**

```ts
// src/ingest/blobs.ts
import { signBlobUpload } from "./sign.ts";
import { postWithRetry } from "./client.ts";

export interface BlobUploadResult {
  uploaded: number;
  skipped: number;
}

export async function uploadBlob(
  baseUrl: string,
  sha256: string,
  body: Uint8Array,
  privateKey: Uint8Array,
  keyId: number,
): Promise<void> {
  const path = `/api/v1/blobs/${sha256}`;
  const { signature, signed_at } = await signBlobUpload(path, sha256, privateKey, keyId);
  const fetchFn: typeof fetch = async (input, init) => {
    const req = new Request(input as RequestInfo, init);
    const headers = new Headers(req.headers);
    headers.set("X-CG-Signature", signature);
    headers.set("X-CG-Key-Id", String(keyId));
    headers.set("X-CG-Signed-At", signed_at);
    headers.set("content-type", "application/octet-stream");
    return fetch(req.url, {
      method: "PUT",
      headers,
      body,
    });
  };
  const resp = await postWithRetry(`${baseUrl}${path}`, null, {
    fetchFn,
    maxAttempts: 3,
    backoffBaseMs: 1000,
  });
  if (resp.status !== 200 && resp.status !== 201) {
    throw new Error(`blob upload failed: ${resp.status} ${await resp.text()}`);
  }
}

export async function uploadMissing(
  baseUrl: string,
  missing: Array<{ sha256: string; body: Uint8Array }>,
  privateKey: Uint8Array,
  keyId: number,
): Promise<BlobUploadResult> {
  let uploaded = 0;
  for (const { sha256, body } of missing) {
    await uploadBlob(baseUrl, sha256, body, privateKey, keyId);
    uploaded++;
  }
  return { uploaded, skipped: 0 };
}
```

Note: `postWithRetry` is reused for its retry shell but we override `fetch` to do PUT with the right headers. This is a pragmatic reuse; if the retry semantics diverge later, split into a `putWithRetry`.

- [ ] **Step 2: Commit**

```bash
git add src/ingest/blobs.ts
git commit -m "feat(ingest): R2 blob uploader with header-signed auth"
```

---

### Task 5.4: src/ingest/register.ts (interactive)

**Files:**
- Create: `src/ingest/register.ts`

- [ ] **Step 1: Write register.ts**

```ts
// src/ingest/register.ts
import { Confirm, Input, Number as NumPrompt } from "https://deno.land/x/cliffy@v0.25.7/prompt/mod.ts";
import { appendModel, appendPricing } from "./catalog/write.ts";
import type { Catalog } from "./catalog/read.ts";
import type { CatalogModelEntry, CatalogPricingEntry, PricingRates } from "./types.ts";
import { sourcesForFamily, fetchPricingFromSources } from "./pricing-sources/index.ts";
import { signPayload } from "./sign.ts";
import { postWithRetry } from "./client.ts";
import type { IngestConfig } from "./types.ts";

export interface RegisterDeps {
  catalogDir: string;        // site/catalog
  config: IngestConfig;      // with adminKeyPath + adminKeyId populated
  adminPrivateKey: Uint8Array;
  interactive: boolean;      // if false, never prompt; auto-accept API results
}

export async function ensureModel(
  cat: Catalog,
  slug: string,
  apiModelId: string,
  deps: RegisterDeps,
): Promise<CatalogModelEntry> {
  const existing = cat.models.find((m) => m.slug === slug && m.api_model_id === apiModelId);
  if (existing) return existing;

  const family = inferFamily(slug);
  const inferred: CatalogModelEntry = {
    slug,
    api_model_id: apiModelId,
    family,
    display_name: inferDisplayName(slug),
  };

  if (deps.interactive) {
    console.log(`[WARN] Model '${slug}' not in catalog.`);
    console.log(`       Inferred: family=${inferred.family}, display_name='${inferred.display_name}'`);
    const ok = await Confirm.prompt({ message: "Write to catalog + D1?", default: true });
    if (!ok) throw new Error(`aborted: model '${slug}' not registered`);
  }

  await appendModel(`${deps.catalogDir}/models.yml`, inferred);
  await postAdmin(deps, "/api/v1/admin/catalog/models", inferred);
  cat.models.push(inferred);
  return inferred;
}

export async function ensurePricing(
  cat: Catalog,
  pricingVersion: string,
  modelSlug: string,
  apiModelId: string,
  family: string,
  deps: RegisterDeps,
): Promise<CatalogPricingEntry> {
  const existing = cat.pricing.find((p) => p.pricing_version === pricingVersion && p.model_slug === modelSlug);
  if (existing) return existing;

  let rates: PricingRates | null = await fetchPricingFromSources(sourcesForFamily(family), modelSlug, apiModelId);

  if (!rates) {
    if (!deps.interactive) {
      throw new Error(`pricing for '${modelSlug}' not available from any API source; run interactively to enter manually`);
    }
    console.log(`[WARN] No API source has pricing for '${modelSlug}'. Enter manually (per-million-tokens USD):`);
    rates = {
      input_per_mtoken: await NumPrompt.prompt({ message: "input_per_mtoken" }),
      output_per_mtoken: await NumPrompt.prompt({ message: "output_per_mtoken" }),
      cache_read_per_mtoken: await NumPrompt.prompt({ message: "cache_read_per_mtoken (0 if N/A)", default: 0 }),
      cache_write_per_mtoken: await NumPrompt.prompt({ message: "cache_write_per_mtoken (0 if N/A)", default: 0 }),
      source: "manual",
      fetched_at: new Date().toISOString(),
    };
  } else if (deps.interactive) {
    console.log(`[INFO] Fetched pricing from ${rates.source}:`);
    console.log(`       input=${rates.input_per_mtoken}/Mt output=${rates.output_per_mtoken}/Mt`);
    const ok = await Confirm.prompt({ message: "Accept and write?", default: true });
    if (!ok) throw new Error(`aborted: pricing for '${modelSlug}' not accepted`);
  }

  const entry: CatalogPricingEntry = {
    pricing_version: pricingVersion,
    model_slug: modelSlug,
    effective_from: new Date().toISOString(),
    ...rates,
  };
  await appendPricing(`${deps.catalogDir}/pricing.yml`, entry);
  await postAdmin(deps, "/api/v1/admin/catalog/pricing", entry);
  cat.pricing.push(entry);
  return entry;
}

export async function ensureTaskSet(
  cat: Catalog,
  hash: string,
  taskCount: number,
  deps: RegisterDeps,
): Promise<void> {
  await postAdmin(deps, "/api/v1/admin/catalog/task-sets", {
    hash,
    created_at: new Date().toISOString(),
    task_count: taskCount,
  });
}

async function postAdmin(deps: RegisterDeps, path: string, payload: Record<string, unknown>): Promise<void> {
  if (!deps.config.adminKeyId) throw new Error("admin key not configured; needed for catalog writes");
  const sig = await signPayload(payload, deps.adminPrivateKey, deps.config.adminKeyId);
  const body = { version: 1, signature: sig, payload };
  const resp = await postWithRetry(`${deps.config.url}${path}`, body, { maxAttempts: 3 });
  if (resp.status !== 200) {
    throw new Error(`admin ${path} failed: ${resp.status} ${await resp.text()}`);
  }
}

function inferFamily(slug: string): string {
  const prefix = slug.split("/")[0];
  if (prefix === "anthropic") return "claude";
  if (prefix === "openai") return "gpt";
  if (prefix === "google" || prefix === "gemini") return "gemini";
  return prefix;
}

function inferDisplayName(slug: string): string {
  const name = slug.split("/").pop() ?? slug;
  return name.split(/[-_]/).map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(" ");
}
```

- [ ] **Step 2: Quick check**

```bash
deno check src/ingest/register.ts
```
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/ingest/register.ts
git commit -m "feat(ingest): interactive register for models, pricing, task-sets"
```

---

### Task 5.5: src/ingest/mod.ts — public ingestRun()

**Files:**
- Create: `src/ingest/mod.ts`

- [ ] **Step 1: Write mod.ts**

```ts
// src/ingest/mod.ts
import { sha256Hex } from "jsr:@std/crypto@^1.0.0/crypto";
import { readCatalog } from "./catalog/read.ts";
import { computeTaskSetHash } from "./catalog/task-set-hash.ts";
import { loadIngestConfig, readPrivateKey } from "./config.ts";
import { ensureModel, ensurePricing, ensureTaskSet } from "./register.ts";
import { buildPayload } from "./envelope.ts";
import { signPayload } from "./sign.ts";
import { uploadMissing } from "./blobs.ts";
import { postWithRetry } from "./client.ts";
import { canonicalJSON } from "./canonical.ts";
import type { IngestOutcome } from "./types.ts";

export interface IngestOptions {
  cwd: string;
  catalogDir: string;       // site/catalog
  tasksDir: string;         // tasks/
  interactive: boolean;
  noIngest?: boolean;
  flags: {
    url?: string;
    keyPath?: string;
    keyId?: number;
    machineId?: string;
    adminKeyPath?: string;
    adminKeyId?: number;
  };
}

export interface BenchResults {
  runId: string;
  model: { slug: string; api_model_id: string; family_slug: string };
  settings: Record<string, unknown>;
  startedAt: string;
  completedAt: string;
  pricingVersion: string;
  centralgaugeSha?: string;
  results: Array<{
    task_id: string;
    attempt: 1 | 2;
    passed: boolean; score: number;
    compile_success: boolean; compile_errors: unknown[];
    tests_total: number; tests_passed: number;
    tokens_in: number; tokens_out: number;
    tokens_cache_read: number; tokens_cache_write: number;
    durations_ms: { llm?: number; compile?: number; test?: number };
    failure_reasons: string[];
    transcript_bytes?: Uint8Array;   // required for v1
    code_bytes?: Uint8Array;         // required for v1
  }>;
  reproduction_bundle_bytes?: Uint8Array;  // required for v1
}

export async function ingestRun(br: BenchResults, opts: IngestOptions): Promise<IngestOutcome> {
  if (opts.noIngest) return { kind: "success", runId: br.runId, bytesUploaded: 0 };

  const config = await loadIngestConfig(opts.cwd, opts.flags);
  const privKey = await readPrivateKey(config.keyPath);

  const cat = await readCatalog(opts.catalogDir);

  // Compute blob hashes
  const blobTable = new Map<string, Uint8Array>(); // sha256 -> bytes
  const results = await Promise.all(br.results.map(async (r) => {
    const transcript_sha256 = r.transcript_bytes ? await hashHex(r.transcript_bytes) : undefined;
    const code_sha256 = r.code_bytes ? await hashHex(r.code_bytes) : undefined;
    if (transcript_sha256 && r.transcript_bytes) blobTable.set(transcript_sha256, r.transcript_bytes);
    if (code_sha256 && r.code_bytes) blobTable.set(code_sha256, r.code_bytes);
    return {
      task_id: r.task_id, attempt: r.attempt, passed: r.passed, score: r.score,
      compile_success: r.compile_success, compile_errors: r.compile_errors,
      tests_total: r.tests_total, tests_passed: r.tests_passed,
      tokens_in: r.tokens_in, tokens_out: r.tokens_out,
      tokens_cache_read: r.tokens_cache_read, tokens_cache_write: r.tokens_cache_write,
      durations_ms: r.durations_ms, failure_reasons: r.failure_reasons,
      transcript_sha256, code_sha256,
    };
  }));

  let reproductionBundleSha: string | undefined;
  if (br.reproduction_bundle_bytes) {
    reproductionBundleSha = await hashHex(br.reproduction_bundle_bytes);
    blobTable.set(reproductionBundleSha, br.reproduction_bundle_bytes);
  }

  // Register reference data
  if (config.adminKeyId && config.adminKeyPath) {
    const adminPriv = await readPrivateKey(config.adminKeyPath);
    const deps = {
      catalogDir: opts.catalogDir,
      config,
      adminPrivateKey: adminPriv,
      interactive: opts.interactive,
    };
    await ensureModel(cat, br.model.slug, br.model.api_model_id, deps);
    await ensurePricing(cat, br.pricingVersion, br.model.slug, br.model.api_model_id, br.model.family_slug, deps);
    const tsHash = await computeTaskSetHash(opts.tasksDir);
    await ensureTaskSet(cat, tsHash, countTasksSync(opts.tasksDir), deps);
    br.pricingVersion = br.pricingVersion; // unchanged (kept for clarity)
  }

  const taskSetHash = await computeTaskSetHash(opts.tasksDir);
  const payload = buildPayload({
    runId: br.runId,
    taskSetHash,
    model: br.model,
    settings: br.settings,
    machineId: config.machineId,
    startedAt: br.startedAt,
    completedAt: br.completedAt,
    pricingVersion: br.pricingVersion,
    centralgaugeSha: br.centralgaugeSha,
    reproductionBundleSha256: reproductionBundleSha,
    results,
  });

  // Precheck → missing blobs
  const precheckBody = buildSigned(br.runId, payload, privKey, config.keyId);
  const preResp = await postWithRetry(`${config.url}/api/v1/runs/precheck`, await precheckBody, {});
  if (!preResp.ok) return fatalFrom(preResp);
  const pre = await preResp.json() as { missing_blobs: string[] };

  // Upload missing
  const toUpload = pre.missing_blobs
    .map((h) => ({ sha256: h, body: blobTable.get(h)! }))
    .filter((x) => x.body);
  let bytesUploaded = 0;
  await uploadMissing(config.url, toUpload, privKey, config.keyId);
  bytesUploaded = toUpload.reduce((n, b) => n + b.body.length, 0);

  // Final signed POST (re-sign fresh for clock-skew)
  const finalBody = await buildSigned(br.runId, payload, privKey, config.keyId);
  const runResp = await postWithRetry(`${config.url}/api/v1/runs`, finalBody, {});
  if (runResp.status === 202 || runResp.status === 200) {
    return { kind: "success", runId: br.runId, bytesUploaded };
  }
  if (runResp.status >= 500) {
    const err = new Error(`server returned ${runResp.status}`);
    return {
      kind: "retryable-failure",
      attempts: 3,
      lastError: err,
      replayCommand: `centralgauge ingest <path>`,
    };
  }
  return fatalFrom(runResp);
}

async function buildSigned(runId: string, payload: Record<string, unknown>, privKey: Uint8Array, keyId: number) {
  const sig = await signPayload(payload, privKey, keyId);
  return { version: 1, run_id: runId, signature: sig, payload };
}

async function hashHex(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function countTasksSync(dir: string): number {
  let n = 0;
  for (const e of Deno.readDirSync(dir)) {
    if (e.isFile && e.name.endsWith(".yml")) n++;
    else if (e.isDirectory) n += countTasksSync(`${dir}/${e.name}`);
  }
  return n;
}

async function fatalFrom(resp: Response): Promise<IngestOutcome> {
  const body = await resp.json().catch(() => ({})) as { code?: string; message?: string };
  return {
    kind: "fatal-failure",
    code: body.code ?? `http_${resp.status}`,
    message: body.message ?? resp.statusText,
  };
}

// Re-exports for CLI commands
export { canonicalJSON } from "./canonical.ts";
export { computeTaskSetHash } from "./catalog/task-set-hash.ts";
export { loadIngestConfig, readPrivateKey } from "./config.ts";
export * from "./types.ts";
```

- [ ] **Step 2: Check build**

```bash
deno check src/ingest/mod.ts
```
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/ingest/mod.ts
git commit -m "feat(ingest): public ingestRun() entry point with precheck + blob + run"
```

---

## Phase 6: CLI commands + bench wiring

### Task 6.1: `centralgauge ingest <path>` command

**Files:**
- Create: `cli/commands/ingest-command.ts`
- Modify: `cli/commands/mod.ts`

- [ ] **Step 1: Write ingest-command.ts**

```ts
// cli/commands/ingest-command.ts
import { Command } from "jsr:@cliffy/command@1.0.1";
import { ingestRun, type BenchResults } from "../../src/ingest/mod.ts";

export const ingestCommand = new Command()
  .name("ingest")
  .description("Replay a saved benchmark results file to the scoreboard API")
  .arguments("<path:string>")
  .option("--url <url:string>", "Override ingest URL")
  .option("--key-path <path:string>", "Override ingest key path")
  .option("--key-id <id:number>", "Override ingest key id")
  .option("--machine-id <id:string>", "Override machine id")
  .option("--admin-key-path <path:string>", "Admin key path for catalog writes")
  .option("--admin-key-id <id:number>", "Admin key id")
  .option("--dry-run", "Parse + validate only, do not POST", { default: false })
  .option("-y, --yes", "Non-interactive; auto-accept API-fetched pricing", { default: false })
  .action(async (opts, path) => {
    const raw = await Deno.readTextFile(path);
    const parsed = JSON.parse(raw) as BenchResults;
    if (opts.dryRun) {
      console.log("[DRY] Parsed run:", parsed.runId, "model:", parsed.model.slug);
      return;
    }
    const cwd = Deno.cwd();
    const outcome = await ingestRun(parsed, {
      cwd,
      catalogDir: `${cwd}/site/catalog`,
      tasksDir: `${cwd}/tasks`,
      interactive: !opts.yes,
      flags: opts,
    });
    if (outcome.kind === "retryable-failure") {
      console.warn(`[WARN] Ingest failed transiently: ${outcome.lastError.message}`);
      console.warn(`       Replay: ${outcome.replayCommand}`);
      Deno.exit(0);
    }
    if (outcome.kind === "fatal-failure") {
      console.error(`[FAIL] ${outcome.code}: ${outcome.message}`);
      Deno.exit(1);
    }
    console.log(`[OK] ingested run ${outcome.runId} (${outcome.bytesUploaded} bytes in blobs)`);
  });
```

- [ ] **Step 2: Register in mod.ts**

Edit `cli/commands/mod.ts` to import + add `.command("ingest", ingestCommand)` alongside existing commands.

- [ ] **Step 3: Check build**

```bash
deno check cli/commands/ingest-command.ts
```

- [ ] **Step 4: Commit**

```bash
git add cli/commands/ingest-command.ts cli/commands/mod.ts
git commit -m "feat(cli): centralgauge ingest <path> command"
```

---

### Task 6.2: `centralgauge sync-catalog` command

**Files:**
- Create: `cli/commands/sync-catalog-command.ts`
- Modify: `cli/commands/mod.ts`

- [ ] **Step 1: Write sync-catalog-command.ts**

```ts
// cli/commands/sync-catalog-command.ts
import { Command } from "jsr:@cliffy/command@1.0.1";
import { readCatalog } from "../../src/ingest/catalog/read.ts";
import { loadIngestConfig, readPrivateKey } from "../../src/ingest/config.ts";
import { signPayload } from "../../src/ingest/sign.ts";
import { postWithRetry } from "../../src/ingest/client.ts";

export const syncCatalogCommand = new Command()
  .name("sync-catalog")
  .description("Reconcile site/catalog/*.yml with the production D1 catalog tables")
  .option("--dry-run", "Show planned operations, do not write", { default: true })
  .option("--apply", "Actually write", { default: false })
  .action(async (opts) => {
    const cwd = Deno.cwd();
    const config = await loadIngestConfig(cwd, {});
    if (!config.adminKeyId || !config.adminKeyPath) {
      throw new Error("admin_key_id + admin_key_path required in .centralgauge.yml for sync");
    }
    const adminPriv = await readPrivateKey(config.adminKeyPath);
    const cat = await readCatalog(`${cwd}/site/catalog`);
    console.log(`[INFO] ${cat.models.length} models, ${cat.pricing.length} pricing rows, ${cat.families.length} families`);
    const apply = opts.apply && !opts.dryRun;
    if (!apply) {
      console.log("[DRY] use --apply to write");
      return;
    }
    for (const m of cat.models) {
      const sig = await signPayload(m as unknown as Record<string, unknown>, adminPriv, config.adminKeyId);
      const resp = await postWithRetry(`${config.url}/api/v1/admin/catalog/models`, { version: 1, signature: sig, payload: m });
      console.log(`[${resp.status}] model ${m.slug}`);
    }
    for (const p of cat.pricing) {
      const sig = await signPayload(p as unknown as Record<string, unknown>, adminPriv, config.adminKeyId);
      const resp = await postWithRetry(`${config.url}/api/v1/admin/catalog/pricing`, { version: 1, signature: sig, payload: p });
      console.log(`[${resp.status}] pricing ${p.pricing_version} / ${p.model_slug}`);
    }
  });
```

- [ ] **Step 2: Register in mod.ts**

Add `.command("sync-catalog", syncCatalogCommand)`.

- [ ] **Step 3: Commit**

```bash
git add cli/commands/sync-catalog-command.ts cli/commands/mod.ts
git commit -m "feat(cli): sync-catalog command for catalog → D1 reconciliation"
```

---

### Task 6.3: Wire bench-command.ts to ingest

**Files:**
- Modify: `cli/commands/bench-command.ts`

- [ ] **Step 1: Add --no-ingest and --yes flags**

Locate the flag definitions block (near the top of `cli/commands/bench-command.ts`, after `--output`) and add:

```ts
.option("--no-ingest", "Skip ingestion to the scoreboard API", { default: false })
.option("-y, --yes", "Non-interactive; auto-accept API-fetched pricing", { default: false })
```

- [ ] **Step 2: Call ingestRun after results are written**

Locate the point where `bench-command.ts` writes the results JSON to disk (search for `writeTextFile` or similar inside the action). Immediately after the write, add:

```ts
import { ingestRun, type BenchResults } from "../../src/ingest/mod.ts";

// ... inside the action, after writing resultsPath:
if (!opts.noIngest) {
  const cwd = Deno.cwd();
  // Assemble BenchResults from the in-memory run state (the same data that
  // was serialized to resultsPath). This mapping depends on bench's internal
  // structures; adapt field-by-field.
  const br: BenchResults = assembleBenchResults(runState);
  const outcome = await ingestRun(br, {
    cwd,
    catalogDir: `${cwd}/site/catalog`,
    tasksDir: `${cwd}/tasks`,
    interactive: !opts.yes,
    flags: {},
  });
  if (outcome.kind === "retryable-failure") {
    console.warn(`[WARN] Ingest failed transiently.`);
    console.warn(`       Replay: centralgauge ingest ${resultsPath}`);
  } else if (outcome.kind === "fatal-failure") {
    console.error(`[FAIL] Ingest rejected: ${outcome.code} ${outcome.message}`);
    throw new Error("ingest rejected");
  } else {
    console.log(`[OK] Ingested run ${outcome.runId}`);
  }
}
```

Implement `assembleBenchResults(runState)` as a small helper at the bottom of the file that reads from whatever in-memory structures bench uses and produces the `BenchResults` shape defined in `src/ingest/mod.ts`. The transcript + code + reproduction-bundle `Uint8Array`s come from files already written under `results/`; either read them back in or restructure bench to keep them in memory.

- [ ] **Step 3: Smoke via `deno check`**

```bash
deno check cli/commands/bench-command.ts
```
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add cli/commands/bench-command.ts
git commit -m "feat(bench): inline ingest after results write; --no-ingest to opt out"
```

---

## Phase 7: Preview smoke

### Task 7.1: Extend scripts/smoke-ingest.ts for blobs + precheck

**Files:**
- Modify: `scripts/smoke-ingest.ts`

- [ ] **Step 1: Extend script**

Add a new CLI subcommand `full` that:
1. Generates a random transcript + code body.
2. PUTs both to `/api/v1/blobs/:sha256` with header-signed auth.
3. POSTs to `/api/v1/runs/precheck`, expects `missing_blobs: []`.
4. POSTs to `/api/v1/runs`, expects 202 or 400 `unknown_task_set` (acceptable for smoke).

Keep the existing minimal smoke path as a `simple` subcommand.

(Full code omitted for brevity; mirror the existing structure and add blob PUTs using `signBlobUpload` from `src/ingest/sign.ts`. ~100 LoC.)

- [ ] **Step 2: Run against preview**

```bash
deno run -A scripts/smoke-ingest.ts full \
  --url https://centralgauge-preview.sshadows.workers.dev \
  --key ~/.centralgauge/keys/preview-ingest.ed25519 \
  --key-id 1 --machine-id preview-ingest
```
Expected: `[OK] precheck returned empty missing_blobs after uploads`.

- [ ] **Step 3: Commit**

```bash
git add scripts/smoke-ingest.ts
git commit -m "test(scripts): extend smoke-ingest to cover blobs + precheck"
```

---

### Task 7.2: End-to-end preview bench (1 model × 1 task)

- [ ] **Step 1: Seed the preview admin key**

Generate an admin key locally (if not already), then:

```bash
deno run -A scripts/seed-admin-key.ts \
  --env preview --scope admin \
  --pub ~/.centralgauge/keys/preview-admin.ed25519.pub \
  --machine-id preview-admin
```
Expected: row inserted; note the returned key_id.

- [ ] **Step 2: Configure `.centralgauge.yml`** (not committed; add to `.gitignore` if not already)

```yaml
ingest:
  url: https://centralgauge-preview.sshadows.workers.dev
  key_path: ~/.centralgauge/keys/preview-ingest.ed25519
  key_id: 1
  machine_id: preview-ingest
  admin_key_path: ~/.centralgauge/keys/preview-admin.ed25519
  admin_key_id: 2
```

- [ ] **Step 3: Seed model-families via D1 directly (one-time)**

```bash
cd site && npx wrangler d1 execute centralgauge-db --env preview --remote --command="
INSERT OR IGNORE INTO model_families(slug, vendor, display_name) VALUES
  ('claude', 'Anthropic', 'Claude'),
  ('gpt', 'OpenAI', 'GPT'),
  ('gemini', 'Google', 'Gemini');
"
```

- [ ] **Step 4: Run a single-task bench**

```bash
deno task start bench \
  --llms anthropic/claude-opus-4-7 \
  --tasks "tasks/easy/CG-AL-E001.yml" \
  --containers Cronus28
```
Expected: interactive prompts for model (accept), pricing (accept API-fetched or manually enter), task_set (silent). Final line: `[OK] Ingested run <id>`.

- [ ] **Step 5: Verify in D1 and R2**

```bash
cd site && npx wrangler d1 execute centralgauge-db --env preview --remote --command="SELECT id, model_id, status FROM runs ORDER BY started_at DESC LIMIT 3"
cd site && npx wrangler d1 execute centralgauge-db --env preview --remote --command="SELECT source, fetched_at, input_per_mtoken FROM cost_snapshots"
```
Expected: new `runs` row, `cost_snapshots.source` populated.

- [ ] **Step 6: No commit** (this is a smoke test step)

---

## Phase 8: Production deploy

### Task 8.1: Generate + seed production ingest key

- [ ] **Step 1: Generate prod ingest key**

```bash
deno run -A scripts/generate-machine-key.ts \
  --out ~/.centralgauge/keys/production-ingest.ed25519
```
Expected: private key file + `.pub` file created. Confirm `.ed25519` is gitignored via `ls -la ~/.centralgauge/keys/` then check `.gitignore`.

- [ ] **Step 2: Generate prod admin key**

```bash
deno run -A scripts/generate-machine-key.ts \
  --out ~/.centralgauge/keys/production-admin.ed25519
```

- [ ] **Step 3: Apply migrations to production D1**

```bash
cd site && npx wrangler d1 execute centralgauge-db --env production --remote --file=migrations/0001_core.sql
cd site && npx wrangler d1 execute centralgauge-db --env production --remote --file=migrations/0002_fts.sql
cd site && npx wrangler d1 execute centralgauge-db --env production --remote --command="INSERT INTO d1_migrations(name) VALUES ('0001_core.sql'), ('0002_fts.sql')"
cd site && npx wrangler d1 execute centralgauge-db --env production --remote --file=migrations/0003_cost_source.sql
cd site && npx wrangler d1 execute centralgauge-db --env production --remote --command="INSERT INTO d1_migrations(name) VALUES ('0003_cost_source.sql')"
```
Expected: all succeed.

- [ ] **Step 4: Seed prod model-families**

```bash
cd site && npx wrangler d1 execute centralgauge-db --env production --remote --command="
INSERT OR IGNORE INTO model_families(slug, vendor, display_name) VALUES
  ('claude', 'Anthropic', 'Claude'),
  ('gpt', 'OpenAI', 'GPT'),
  ('gemini', 'Google', 'Gemini');
"
```

- [ ] **Step 5: Seed prod ingest + admin keys**

```bash
deno run -A scripts/seed-admin-key.ts \
  --env production --scope ingest \
  --pub ~/.centralgauge/keys/production-ingest.ed25519.pub \
  --machine-id production-ingest

deno run -A scripts/seed-admin-key.ts \
  --env production --scope admin \
  --pub ~/.centralgauge/keys/production-admin.ed25519.pub \
  --machine-id production-admin
```
Note the returned key_ids.

- [ ] **Step 6: No commit**

---

### Task 8.2: Production deploy

- [ ] **Step 1: Verify wrangler.toml production env**

Open `site/wrangler.toml`, confirm `[env.production]` block has:
- `name = "centralgauge"` (or similar)
- D1 binding with correct `database_id`
- KV binding with correct `id`
- R2 bucket binding
- DO binding with `new_sqlite_classes = ["LeaderboardBroadcaster"]`

- [ ] **Step 2: Deploy**

```bash
cd site && npx wrangler deploy --env production
```
Expected: deploy succeeds, prints the URL (`https://centralgauge.sshadows.workers.dev`).

- [ ] **Step 3: Run full smoke**

```bash
deno run -A scripts/smoke-ingest.ts full \
  --url https://centralgauge.sshadows.workers.dev \
  --key ~/.centralgauge/keys/production-ingest.ed25519 \
  --key-id <id-from-seed> \
  --machine-id production-ingest
```
Expected: `[OK]`.

- [ ] **Step 4: Commit deploy config if any changes**

```bash
git add site/wrangler.toml
git commit -m "chore(deploy): verify production wrangler.toml for first deploy"
```

---

## Phase 9: First runs + cutover

### Task 9.1: Seed `site/catalog/*.yml` with the first 6 models

- [ ] **Step 1: Decide on the 6 models**

Example: `anthropic/claude-opus-4-7`, `anthropic/claude-opus-4-6`, `openai/gpt-5`, `openai/gpt-4o`, `google/gemini-2.5-pro`, `google/gemini-2.0-flash`.

- [ ] **Step 2: Write initial catalog files**

Write `site/catalog/model-families.yml`:

```yaml
- slug: claude
  vendor: Anthropic
  display_name: Claude
- slug: gpt
  vendor: OpenAI
  display_name: GPT
- slug: gemini
  vendor: Google
  display_name: Gemini
```

Write `site/catalog/models.yml` with entries for all 6 (slug, api_model_id, family, display_name, generation, released_at).

Write `site/catalog/pricing.yml` with entries for all 6 at a shared `pricing_version: "initial-2026-04-20"`. For each entry, fetch rates via OpenRouter (or check provider docs manually) and set `source: "openrouter-api"` or `"manual"` accordingly. Each entry must include `fetched_at`.

- [ ] **Step 3: Run sync-catalog against production**

```bash
deno task start sync-catalog --apply
```
Expected: 3 family upserts (already seeded, idempotent), 6 model upserts, 6 pricing upserts.

- [ ] **Step 4: Commit**

```bash
git add site/catalog/
git commit -m "feat(catalog): seed initial 6 models + pricing"
```

---

### Task 9.2: First production bench (1 task, 1 model)

- [ ] **Step 1: Switch `.centralgauge.yml` to production**

```yaml
ingest:
  url: https://centralgauge.sshadows.workers.dev
  key_path: ~/.centralgauge/keys/production-ingest.ed25519
  key_id: <prod-ingest-id>
  machine_id: production-ingest
  admin_key_path: ~/.centralgauge/keys/production-admin.ed25519
  admin_key_id: <prod-admin-id>
```

- [ ] **Step 2: Run**

```bash
deno task start bench \
  --llms anthropic/claude-opus-4-7 \
  --tasks "tasks/easy/CG-AL-E001.yml" \
  --containers Cronus28
```
Expected: `[OK] Ingested run <id>`.

- [ ] **Step 3: Verify via scoreboard UI**

Open `https://centralgauge.sshadows.workers.dev` and click into the new run. Confirm transcript + generated code are accessible (blobs accessible via `GET /api/v1/blobs/:sha256`).

- [ ] **Step 4: No commit**

---

### Task 9.3: Scale up to all 6 models

- [ ] **Step 1: Full 6-model bench**

```bash
deno task start bench \
  --llms anthropic/claude-opus-4-7,anthropic/claude-opus-4-6,openai/gpt-5,openai/gpt-4o,google/gemini-2.5-pro,google/gemini-2.0-flash \
  --tasks "tasks/**/*.yml" \
  --containers Cronus28,Cronus281,Cronus282,Cronus283 \
  --runs 1
```
Expected: full run completes; `[OK] Ingested run <id>` per model.

- [ ] **Step 2: Verify leaderboard reflects 6 models**

Visit the scoreboard. All 6 should appear with scores + tokens + costs.

---

### Task 9.4: Cutover `ai.sshadows.dk`

**Trigger:** all 6 models have at least one complete run AND the leaderboard + transcripts have been eyeballed.

- [ ] **Step 1: Bind custom domain in Cloudflare dashboard**

Via Cloudflare dashboard → Workers & Pages → centralgauge worker → Settings → Domains → Add `ai.sshadows.dk`.

- [ ] **Step 2: Verify SSL + routing**

```bash
curl -I https://ai.sshadows.dk/
```
Expected: 200, SvelteKit HTML.

- [ ] **Step 3: Update `.centralgauge.yml` URL**

Change `ingest.url` to `https://ai.sshadows.dk`.

- [ ] **Step 4: Retire legacy site**

Whatever was serving `ai.sshadows.dk` previously — archive / deprovision.

- [ ] **Step 5: Commit final config**

```bash
git add .centralgauge.yml   # only if not gitignored
git commit -m "chore(deploy): ai.sshadows.dk cutover complete"
```

---

## Self-Review

**Spec coverage:** Every spec section has at least one task:
- Canonical shared file + parity test → Tasks 0.1, 0.2
- Migration 0003 → Task 0.3
- Blob auth → Task 1.1
- Precheck endpoint → Task 1.2
- Admin catalog endpoints → Task 1.3
- CLI library (types, canonical, sign, task-set-hash, envelope, catalog I/O, pricing sources, register, client, blobs, config, mod) → Tasks 2.1–5.5
- CLI commands (ingest, sync-catalog, bench wiring) → Tasks 6.1–6.3
- Preview validation → Tasks 7.1–7.2
- Production deploy → Tasks 8.1–8.2
- First runs + cutover → Tasks 9.1–9.4

**Placeholder scan:** One acknowledged gap — Task 6.3 step 2 references `assembleBenchResults(runState)` which must be authored inline by reading the current `bench-command.ts` state layout. This is deliberate: the mapping is mechanical but depends on the current structure of `runState` in bench. Implementer will inspect + write it.

**Type consistency:** `BenchResults`, `IngestOutcome`, `CatalogModelEntry`, `CatalogPricingEntry`, `IngestConfig` are all defined in `src/ingest/types.ts` (Task 2.1) and used consistently in later tasks.

**Known risks / open items for implementer attention:**
1. The Anthropic / OpenAI / Gemini pricing adapters are stubs that return null (Task 4.2). If a live endpoint is discovered, the adapter gets a real implementation; otherwise manual entry handles those providers.
2. Task 6.3's bench-wiring must read transcript + code bytes back from `results/` or thread them through in-memory. This may require a small refactor of bench's internal result shape.
3. Production seed keys (Task 8.1) are manual steps that the user runs. Implementer should confirm the user has the keys locally before proceeding to Phase 9.
