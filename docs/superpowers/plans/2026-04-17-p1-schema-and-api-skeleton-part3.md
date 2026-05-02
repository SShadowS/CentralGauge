# P1 — Schema + API Skeleton Implementation Plan (Part 3: Read Endpoints)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Parts 1 and 2 (Tasks 1–17) must be complete before starting Part 3.

**Scope:** Tasks 18–26. Builds the public read surface: caching helpers, leaderboard (with KV cache), family trajectory, model detail + limitations, tasks, runs (with signature + reproduction download), transcripts (zstd), compare, search (FTS), and `/sync/health`.

**Prerequisites:** Parts 1 and 2 complete. D1 migrations 0001 + 0002 are applied. Ingest endpoints exist so tests can seed data by calling them — but every read-endpoint test in this part seeds via direct D1 inserts for hermeticity (faster, deterministic, independent of ingest code).

**Spec reference:** `docs/superpowers/specs/2026-04-17-benchmark-results-db-design.md` sections 6 and 8.

**Conventions used throughout Part 3:**

- Every response carries:
  - `ETag: "<sha256-hex>"` and honors `If-None-Match` (→ 304 on match)
  - `Cache-Control: public, s-maxage=60, stale-while-revalidate=600`
  - `X-API-Version: v1`
- Cursor pagination is **opaque base64url JSON** `{k: <key>}` — no offset. Stable sort on `(primary_key DESC, id DESC)`.
- All timestamps are ISO-8601 strings with trailing `Z` (UTC).
- All query params are validated and bounded (e.g., `limit ≤ 100`).

---

## Task 18: Caching helpers (`etag`, `cachedJson`, `cursor`)

**Files:**

- Create: `site/src/lib/server/cache.ts`
- Create: `site/tests/cache.test.ts`

- [ ] **Step 1: Write failing test** `site/tests/cache.test.ts`

```typescript
import { describe, expect, it } from "vitest";
import {
  cachedJson,
  computeEtag,
  decodeCursor,
  encodeCursor,
} from "../src/lib/server/cache";

describe("computeEtag", () => {
  it("returns stable sha256 hex for identical input", async () => {
    const a = await computeEtag({ a: 1, b: 2 });
    const b = await computeEtag({ a: 1, b: 2 });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs for different input", async () => {
    const a = await computeEtag({ a: 1 });
    const b = await computeEtag({ a: 2 });
    expect(a).not.toBe(b);
  });
});

describe("cachedJson", () => {
  it("returns 200 with ETag + Cache-Control headers", async () => {
    const req = new Request("https://x/");
    const res = await cachedJson(req, { hello: "world" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("etag")).toMatch(/^"[0-9a-f]{64}"$/);
    expect(res.headers.get("cache-control")).toContain("s-maxage=60");
    expect(res.headers.get("x-api-version")).toBe("v1");
    expect(await res.json()).toEqual({ hello: "world" });
  });

  it("returns 304 when If-None-Match matches", async () => {
    const body = { hello: "world" };
    const etag = `"${await computeEtag(body)}"`;
    const req = new Request("https://x/", {
      headers: { "if-none-match": etag },
    });
    const res = await cachedJson(req, body);
    expect(res.status).toBe(304);
    expect(res.headers.get("etag")).toBe(etag);
    expect(await res.text()).toBe("");
  });

  it("allows overriding cache control", async () => {
    const req = new Request("https://x/");
    const res = await cachedJson(req, { a: 1 }, { cacheControl: "no-store" });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("cursor helpers", () => {
  it("round-trips", () => {
    const enc = encodeCursor({ k: 42, t: "2026-04-17T00:00:00Z" });
    const dec = decodeCursor<{ k: number; t: string }>(enc);
    expect(dec).toEqual({ k: 42, t: "2026-04-17T00:00:00Z" });
  });

  it("decodeCursor returns null for invalid input", () => {
    expect(decodeCursor("not-base64!!!")).toBeNull();
    expect(decodeCursor("")).toBeNull();
    expect(decodeCursor(undefined)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd site && npm test -- tests/cache.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `site/src/lib/server/cache.ts`**

```typescript
import { sha256Hex } from "$lib/shared/hash";
import { canonicalJson } from "$lib/shared/canonical";
import { base64UrlDecode, base64UrlEncode } from "$lib/shared/base64";

export async function computeEtag(body: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(body));
  return await sha256Hex(bytes);
}

export interface CachedJsonOptions {
  cacheControl?: string;
  extraHeaders?: Record<string, string>;
}

export async function cachedJson(
  req: Request,
  body: unknown,
  opts: CachedJsonOptions = {},
): Promise<Response> {
  const etagHex = await computeEtag(body);
  const etag = `"${etagHex}"`;
  const ifNoneMatch = req.headers.get("if-none-match");

  const headers: Record<string, string> = {
    "etag": etag,
    "cache-control": opts.cacheControl ??
      "public, s-maxage=60, stale-while-revalidate=600",
    "x-api-version": "v1",
    ...opts.extraHeaders,
  };

  if (ifNoneMatch && ifNoneMatch === etag) {
    return new Response("", { status: 304, headers });
  }

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...headers,
    },
  });
}

export function encodeCursor(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return base64UrlEncode(bytes);
}

export function decodeCursor<T>(cursor: string | null | undefined): T | null {
  if (!cursor) return null;
  try {
    const bytes = base64UrlDecode(cursor);
    const text = new TextDecoder().decode(bytes);
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run tests**

Run: `cd site && npm test -- tests/cache.test.ts`
Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add site/src/lib/server/cache.ts site/tests/cache.test.ts
git commit -m "feat(site): add etag + cursor pagination helpers"
```

---

## Task 19: `GET /api/v1/leaderboard` (with KV cache)

**Leaderboard aggregates runs into one row per `(task_set_hash, model_id, settings_hash)` group.** We read the current task set's leaderboard from KV (`leaderboard:current`); on miss, we regenerate from D1 and write back with a 60s TTL. Parameters: `set=current|all` (default `current`), `tier=verified|claimed|all` (default `all`), `difficulty=easy|medium|hard`, `family=<slug>`, `since=<iso-date>`, `cursor=<opaque>`, `limit=<1..100, default 50>`.

**Files:**

- Create: `site/src/lib/server/leaderboard.ts`
- Create: `site/src/routes/api/v1/leaderboard/+server.ts`
- Create: `site/tests/api/leaderboard.test.ts`

- [ ] **Step 1: Write failing test** `site/tests/api/leaderboard.test.ts`

```typescript
import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

async function seed(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM results`),
    env.DB.prepare(`DELETE FROM runs`),
    env.DB.prepare(`DELETE FROM settings_profiles`),
    env.DB.prepare(`DELETE FROM cost_snapshots`),
    env.DB.prepare(`DELETE FROM models`),
    env.DB.prepare(`DELETE FROM model_families`),
    env.DB.prepare(`DELETE FROM task_sets`),
    env.DB.prepare(`DELETE FROM tasks`),
    env.DB.prepare(`DELETE FROM task_categories`),
    env.DB.prepare(`DELETE FROM machine_keys`),
  ]);

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO model_families(id,slug,vendor,display_name) VALUES (1,'claude','anthropic','Claude')`,
    ),
    env.DB.prepare(
      `INSERT INTO models(id,family_id,slug,api_model_id,display_name) VALUES (1,1,'sonnet-4.7','claude-sonnet-4-7','Sonnet 4.7')`,
    ),
    env.DB.prepare(
      `INSERT INTO models(id,family_id,slug,api_model_id,display_name) VALUES (2,1,'opus-4.7','claude-opus-4-7','Opus 4.7')`,
    ),
    env.DB.prepare(
      `INSERT INTO task_sets(hash,version,locked_at,is_current) VALUES ('ts-current','v1','2026-01-01T00:00:00Z',1)`,
    ),
    env.DB.prepare(
      `INSERT INTO task_sets(hash,version,locked_at,is_current) VALUES ('ts-old','v0','2025-12-01T00:00:00Z',0)`,
    ),
    env.DB.prepare(
      `INSERT INTO task_categories(id,slug,display_name,difficulty) VALUES (1,'easy','Easy','easy')`,
    ),
    env.DB.prepare(
      `INSERT INTO task_categories(id,slug,display_name,difficulty) VALUES (2,'hard','Hard','hard')`,
    ),
    env.DB.prepare(
      `INSERT INTO tasks(id,task_set_hash,category_id,version) VALUES ('easy/a','ts-current',1,1)`,
    ),
    env.DB.prepare(
      `INSERT INTO tasks(id,task_set_hash,category_id,version) VALUES ('hard/b','ts-current',2,1)`,
    ),
    env.DB.prepare(
      `INSERT INTO settings_profiles(hash,temperature,max_attempts,max_tokens,prompt_version,bc_version) VALUES ('s1',0.0,2,8192,'v3','Cronus28')`,
    ),
    env.DB.prepare(
      `INSERT INTO cost_snapshots(pricing_version,model_id,input_per_mtoken,output_per_mtoken,effective_from) VALUES ('v2026-04',1,3.0,15.0,'2026-04-01')`,
    ),
    env.DB.prepare(
      `INSERT INTO cost_snapshots(pricing_version,model_id,input_per_mtoken,output_per_mtoken,effective_from) VALUES ('v2026-04',2,15.0,75.0,'2026-04-01')`,
    ),
    env.DB.prepare(
      `INSERT INTO machine_keys(id,machine_id,public_key,scope,created_at) VALUES (1,'rig',X'00','ingest','2026-04-01T00:00:00Z')`,
    ),
  ]);

  const runs = [
    ["r1", "ts-current", 1, "s1", "rig", "claimed", "2026-04-10"],
    ["r2", "ts-current", 1, "s1", "rig", "verified", "2026-04-11"],
    ["r3", "ts-current", 2, "s1", "rig", "claimed", "2026-04-12"],
    ["r4", "ts-old", 1, "s1", "rig", "claimed", "2026-03-10"],
  ];
  for (const [id, ts, mid, sh, machine, tier, date] of runs) {
    await env.DB.prepare(
      `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,completed_at,status,tier,pricing_version,ingest_signature,ingest_signed_at,ingest_public_key_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      id,
      ts,
      mid,
      sh,
      machine,
      `${date}T00:00:00Z`,
      `${date}T01:00:00Z`,
      "completed",
      tier,
      "v2026-04",
      "sig",
      `${date}T00:00:00Z`,
      1,
    ).run();
  }

  const results = [
    // r1: sonnet, current — easy pass, hard fail → 0.5 score, 1/2 tasks
    ["r1", "easy/a", 1, 1, 1.0, 1, 3, 3, 1000, 500],
    ["r1", "hard/b", 1, 0, 0.0, 1, 3, 0, 1000, 500],
    // r2: sonnet, current, verified — both pass
    ["r2", "easy/a", 1, 1, 1.0, 1, 3, 3, 900, 400],
    ["r2", "hard/b", 1, 1, 1.0, 1, 3, 3, 1200, 600],
    // r3: opus, current — both pass
    ["r3", "easy/a", 1, 1, 1.0, 1, 3, 3, 800, 300],
    ["r3", "hard/b", 1, 1, 1.0, 1, 3, 3, 1100, 500],
    // r4: sonnet, old set — both pass (should be excluded when set=current)
    ["r4", "easy/a", 1, 1, 1.0, 1, 3, 3, 1000, 500],
    ["r4", "hard/b", 1, 1, 1.0, 1, 3, 3, 1000, 500],
  ];
  for (
    const [run, task, attempt, passed, score, cs, tt, tp, tin, tout] of results
  ) {
    await env.DB.prepare(
      `INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success,tests_total,tests_passed,tokens_in,tokens_out)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ).bind(run, task, attempt, passed, score, cs, tt, tp, tin, tout).run();
  }
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await seed();
  // Clear KV between tests so regeneration path is exercised deterministically
  const keys = await env.KV.list({ prefix: "leaderboard:" });
  for (const k of keys.keys) await env.KV.delete(k.name);
});

describe("GET /api/v1/leaderboard", () => {
  it("returns current-set leaderboard by default", async () => {
    const res = await SELF.fetch("https://x/api/v1/leaderboard");
    expect(res.status).toBe(200);
    expect(res.headers.get("etag")).toMatch(/^"[0-9a-f]{64}"$/);
    expect(res.headers.get("cache-control")).toContain("s-maxage=60");

    const body = await res.json() as {
      data: Array<any>;
      next_cursor: string | null;
    };
    expect(body.data).toHaveLength(2); // sonnet + opus on current
    const sonnet = body.data.find((r: any) => r.model.slug === "sonnet-4.7");
    const opus = body.data.find((r: any) => r.model.slug === "opus-4.7");
    expect(sonnet.run_count).toBe(2);
    expect(opus.run_count).toBe(1);

    // Average score across r1+r2 = (0.5 + 1.0)/2 = 0.75
    expect(sonnet.avg_score).toBeCloseTo(0.75, 5);
    expect(opus.avg_score).toBe(1.0);

    // Opus is higher → sorted first
    expect(body.data[0].model.slug).toBe("opus-4.7");
  });

  it("set=all includes old task sets", async () => {
    const res = await SELF.fetch("https://x/api/v1/leaderboard?set=all");
    const body = await res.json() as { data: Array<any> };
    const sonnet = body.data.find((r: any) => r.model.slug === "sonnet-4.7");
    // With ts-old included, sonnet picks up r4 too → 3 runs
    expect(sonnet.run_count).toBe(3);
  });

  it("tier=verified filters to verified runs only", async () => {
    const res = await SELF.fetch("https://x/api/v1/leaderboard?tier=verified");
    const body = await res.json() as { data: Array<any> };
    expect(body.data).toHaveLength(1);
    expect(body.data[0].model.slug).toBe("sonnet-4.7");
    expect(body.data[0].run_count).toBe(1);
  });

  it("difficulty=easy filters to easy tasks only", async () => {
    const res = await SELF.fetch(
      "https://x/api/v1/leaderboard?difficulty=easy",
    );
    const body = await res.json() as { data: Array<any> };
    const sonnet = body.data.find((r: any) => r.model.slug === "sonnet-4.7");
    expect(sonnet.avg_score).toBe(1.0); // both easy-attempts passed
  });

  it("family=claude filters to that family", async () => {
    const res = await SELF.fetch("https://x/api/v1/leaderboard?family=claude");
    const body = await res.json() as { data: Array<any> };
    expect(body.data.every((r: any) => r.family_slug === "claude")).toBe(true);
  });

  it("returns 304 on matching If-None-Match", async () => {
    const first = await SELF.fetch("https://x/api/v1/leaderboard");
    const etag = first.headers.get("etag")!;
    const second = await SELF.fetch("https://x/api/v1/leaderboard", {
      headers: { "if-none-match": etag },
    });
    expect(second.status).toBe(304);
  });

  it("populates KV on miss and serves from KV on hit", async () => {
    await SELF.fetch("https://x/api/v1/leaderboard");
    const cached = await env.KV.get(
      "leaderboard:current:all::::50",
      "json",
    ) as any;
    expect(cached).not.toBeNull();
    expect(cached.data).toHaveLength(2);
  });

  it("rejects limit > 100", async () => {
    const res = await SELF.fetch("https://x/api/v1/leaderboard?limit=500");
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd site && npm test -- tests/api/leaderboard.test.ts`
Expected: FAIL — route not found.

- [ ] **Step 3: Implement aggregation `site/src/lib/server/leaderboard.ts`**

```typescript
import { getAll } from "./db";

export interface LeaderboardQuery {
  set: "current" | "all";
  tier: "verified" | "claimed" | "all";
  difficulty: "easy" | "medium" | "hard" | null;
  family: string | null;
  since: string | null; // ISO date
  limit: number;
  cursor: { score: number; id: number } | null;
}

export interface LeaderboardRow {
  rank: number;
  model: { slug: string; display_name: string; api_model_id: string };
  family_slug: string;
  run_count: number;
  tasks_attempted: number;
  tasks_passed: number;
  avg_score: number;
  avg_cost_usd: number;
  verified_runs: number;
  last_run_at: string;
}

export interface LeaderboardResponse {
  data: LeaderboardRow[];
  next_cursor: string | null;
  generated_at: string;
  filters: LeaderboardQuery;
}

export function cacheKeyFor(q: LeaderboardQuery): string {
  return [
    "leaderboard",
    q.set,
    q.tier,
    q.difficulty ?? "",
    q.family ?? "",
    q.since ?? "",
    q.limit,
  ].join(":");
}

export async function computeLeaderboard(
  db: D1Database,
  q: LeaderboardQuery,
): Promise<LeaderboardRow[]> {
  const wheres: string[] = [];
  const params: (string | number)[] = [];

  if (q.set === "current") {
    wheres.push(
      `runs.task_set_hash IN (SELECT hash FROM task_sets WHERE is_current = 1)`,
    );
  }
  if (q.tier !== "all") {
    wheres.push(`runs.tier = ?`);
    params.push(q.tier);
  }
  if (q.family) {
    wheres.push(`mf.slug = ?`);
    params.push(q.family);
  }
  if (q.since) {
    wheres.push(`runs.started_at >= ?`);
    params.push(q.since);
  }

  // Difficulty filter operates at result level (filters which tasks contribute)
  const difficultyJoin = q.difficulty
    ? `JOIN tasks t ON t.id = r.task_id AND t.task_set_hash = runs.task_set_hash
       JOIN task_categories tc ON tc.id = t.category_id AND tc.difficulty = ?`
    : "";
  if (q.difficulty) params.push(q.difficulty);

  const whereClause = wheres.length ? `WHERE ${wheres.join(" AND ")}` : "";

  const sql = `
    SELECT
      m.slug AS model_slug,
      m.display_name AS model_display,
      m.api_model_id AS model_api,
      mf.slug AS family_slug,
      COUNT(DISTINCT runs.id) AS run_count,
      COUNT(*) AS tasks_attempted,
      SUM(r.passed) AS tasks_passed,
      AVG(r.score) AS avg_score,
      AVG(
        (r.tokens_in * cs.input_per_mtoken + r.tokens_out * cs.output_per_mtoken) / 1000000.0
      ) AS avg_cost_usd,
      SUM(CASE WHEN runs.tier = 'verified' THEN 1 ELSE 0 END) AS verified_task_rows,
      MAX(runs.started_at) AS last_run_at
    FROM runs
    JOIN models m ON m.id = runs.model_id
    JOIN model_families mf ON mf.id = m.family_id
    JOIN results r ON r.run_id = runs.id
    ${difficultyJoin}
    JOIN cost_snapshots cs ON cs.model_id = runs.model_id AND cs.pricing_version = runs.pricing_version
    ${whereClause}
    GROUP BY m.id
    ORDER BY avg_score DESC, m.id DESC
    LIMIT ?
  `;

  type Row = {
    model_slug: string;
    model_display: string;
    model_api: string;
    family_slug: string;
    run_count: number;
    tasks_attempted: number;
    tasks_passed: number;
    avg_score: number;
    avg_cost_usd: number;
    verified_task_rows: number;
    last_run_at: string;
  };

  const rows = await getAll<Row>(db, sql, [...params, q.limit]);

  // Second query: verified *run* count per model (distinct runs, not task rows)
  const verifiedSql = `
    SELECT runs.model_id AS model_id, COUNT(DISTINCT runs.id) AS verified_runs
    FROM runs
    ${
    q.set === "current"
      ? `WHERE runs.task_set_hash IN (SELECT hash FROM task_sets WHERE is_current = 1) AND `
      : "WHERE "
  }
    runs.tier = 'verified'
    GROUP BY runs.model_id
  `;
  const verified = await getAll<{ model_id: number; verified_runs: number }>(
    db,
    verifiedSql,
    [],
  );
  const verifiedByModelSlug = new Map<string, number>();
  // Map model_id -> slug via second lookup
  const modelIdToSlug = await getAll<{ id: number; slug: string }>(
    db,
    `SELECT id, slug FROM models`,
    [],
  );
  const idToSlug = new Map(modelIdToSlug.map((m) => [m.id, m.slug]));
  for (const v of verified) {
    const slug = idToSlug.get(v.model_id);
    if (slug) verifiedByModelSlug.set(slug, v.verified_runs);
  }

  return rows.map((r, idx) => ({
    rank: idx + 1,
    model: {
      slug: r.model_slug,
      display_name: r.model_display,
      api_model_id: r.model_api,
    },
    family_slug: r.family_slug,
    run_count: r.run_count,
    tasks_attempted: r.tasks_attempted,
    tasks_passed: r.tasks_passed ?? 0,
    avg_score: Number((r.avg_score ?? 0).toFixed(6)),
    avg_cost_usd: Number((r.avg_cost_usd ?? 0).toFixed(6)),
    verified_runs: verifiedByModelSlug.get(r.model_slug) ?? 0,
    last_run_at: r.last_run_at,
  }));
}
```

- [ ] **Step 4: Implement route `site/src/routes/api/v1/leaderboard/+server.ts`**

```typescript
import type { RequestHandler } from "./$types";
import { cachedJson } from "$lib/server/cache";
import {
  cacheKeyFor,
  computeLeaderboard,
  type LeaderboardQuery,
  type LeaderboardResponse,
} from "$lib/server/leaderboard";
import { ApiError, errorResponse } from "$lib/server/errors";

export const GET: RequestHandler = async ({ request, url, platform }) => {
  const env = platform!.env;
  try {
    const q = parseQuery(url);

    const key = cacheKeyFor(q);
    let payload = await env.KV.get(key, "json") as LeaderboardResponse | null;
    if (!payload) {
      const rows = await computeLeaderboard(env.DB, q);
      payload = {
        data: rows,
        next_cursor: null, // single page at P1; keyset paging added with families trajectory in P2
        generated_at: new Date().toISOString(),
        filters: q,
      };
      await env.KV.put(key, JSON.stringify(payload), { expirationTtl: 60 });
    }
    return cachedJson(request, payload);
  } catch (err) {
    return errorResponse(err);
  }
};

function parseQuery(url: URL): LeaderboardQuery {
  const set = url.searchParams.get("set") ?? "current";
  if (set !== "current" && set !== "all") {
    throw new ApiError(400, "invalid_set", "set must be current or all");
  }

  const tier = url.searchParams.get("tier") ?? "all";
  if (tier !== "all" && tier !== "verified" && tier !== "claimed") {
    throw new ApiError(
      400,
      "invalid_tier",
      "tier must be verified, claimed, or all",
    );
  }

  const difficulty = url.searchParams.get("difficulty");
  if (difficulty && !["easy", "medium", "hard"].includes(difficulty)) {
    throw new ApiError(
      400,
      "invalid_difficulty",
      "difficulty must be easy, medium, or hard",
    );
  }

  const family = url.searchParams.get("family");
  const since = url.searchParams.get("since");
  if (since && Number.isNaN(Date.parse(since))) {
    throw new ApiError(400, "invalid_since", "since must be an ISO-8601 date");
  }

  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw ? parseInt(limitRaw, 10) : 50;
  if (!Number.isFinite(limit) || limit < 1 || limit > 100) {
    throw new ApiError(400, "invalid_limit", "limit must be between 1 and 100");
  }

  return {
    set: set as "current" | "all",
    tier: tier as "verified" | "claimed" | "all",
    difficulty: (difficulty as "easy" | "medium" | "hard" | null) ?? null,
    family,
    since,
    limit,
    cursor: null,
  };
}
```

- [ ] **Step 5: Run tests**

Run: `cd site && npm test -- tests/api/leaderboard.test.ts`
Expected: 8 tests pass.

- [ ] **Step 6: Commit**

```bash
git add site/src/lib/server/leaderboard.ts \
        site/src/routes/api/v1/leaderboard/ \
        site/tests/api/leaderboard.test.ts
git commit -m "feat(site): implement GET /api/v1/leaderboard with KV cache"
```

---

## Task 20: Families list + trajectory `GET /api/v1/families`, `GET /api/v1/families/:slug`

**Files:**

- Create: `site/src/routes/api/v1/families/+server.ts`
- Create: `site/src/routes/api/v1/families/[slug]/+server.ts`
- Create: `site/tests/api/families.test.ts`

- [ ] **Step 1: Write failing test** `site/tests/api/families.test.ts`

```typescript
import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

async function seed(): Promise<void> {
  await env.DB.batch([
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
    env.DB.prepare(
      `INSERT INTO model_families(id,slug,vendor,display_name) VALUES (1,'claude','anthropic','Claude'),(2,'gpt','openai','GPT')`,
    ),
    env.DB.prepare(
      `INSERT INTO models(id,family_id,slug,api_model_id,display_name,generation) VALUES (1,1,'sonnet-4.5','claude-sonnet-4-5','Sonnet 4.5','4.5'),(2,1,'sonnet-4.7','claude-sonnet-4-7','Sonnet 4.7','4.7'),(3,2,'gpt-4o','gpt-4o','GPT-4o','4o')`,
    ),
    env.DB.prepare(
      `INSERT INTO task_sets(hash,version,locked_at,is_current) VALUES ('ts','v1','2026-01-01T00:00:00Z',1)`,
    ),
    env.DB.prepare(
      `INSERT INTO settings_profiles(hash,temperature,max_attempts) VALUES ('s',0.0,2)`,
    ),
    env.DB.prepare(
      `INSERT INTO cost_snapshots(pricing_version,model_id,input_per_mtoken,output_per_mtoken,effective_from) VALUES ('v1',1,3,15,'2026-01-01'),('v1',2,3,15,'2026-01-01'),('v1',3,5,15,'2026-01-01')`,
    ),
    env.DB.prepare(
      `INSERT INTO machine_keys(id,machine_id,public_key,scope,created_at) VALUES (1,'r',X'00','ingest','2026-01-01T00:00:00Z')`,
    ),
  ]);
  const runs = [
    ["r1", 1, "2026-02-01"],
    ["r2", 2, "2026-04-01"],
    ["r3", 3, "2026-03-01"],
  ] as const;
  for (const [id, mid, date] of runs) {
    await env.DB.prepare(
      `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,completed_at,status,tier,pricing_version,ingest_signature,ingest_signed_at,ingest_public_key_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      id,
      "ts",
      mid,
      "s",
      "r",
      `${date}T00:00:00Z`,
      `${date}T01:00:00Z`,
      "completed",
      "claimed",
      "v1",
      "sig",
      `${date}T00:00:00Z`,
      1,
    ).run();
    await env.DB.prepare(
      `INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success) VALUES (?, 'easy/a', 1, 1, ?, 1)`,
    ).bind(id, mid === 1 ? 0.5 : mid === 2 ? 0.9 : 0.7).run();
  }
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await seed();
});

describe("GET /api/v1/families", () => {
  it("lists all families with model counts + latest score", async () => {
    const res = await SELF.fetch("https://x/api/v1/families");
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<any> };
    expect(body.data).toHaveLength(2);
    const claude = body.data.find((f: any) => f.slug === "claude");
    expect(claude.model_count).toBe(2);
    expect(claude.latest_avg_score).toBeCloseTo(0.9, 5); // sonnet-4.7 is latest
  });
});

describe("GET /api/v1/families/:slug", () => {
  it("returns trajectory ordered by generation", async () => {
    const res = await SELF.fetch("https://x/api/v1/families/claude");
    expect(res.status).toBe(200);
    const body = await res.json() as { slug: string; trajectory: Array<any> };
    expect(body.slug).toBe("claude");
    expect(body.trajectory).toHaveLength(2);
    expect(body.trajectory[0].model.generation).toBe("4.5");
    expect(body.trajectory[1].model.generation).toBe("4.7");
    expect(body.trajectory[0].avg_score).toBeCloseTo(0.5, 5);
    expect(body.trajectory[1].avg_score).toBeCloseTo(0.9, 5);
  });

  it("returns 404 for unknown family", async () => {
    const res = await SELF.fetch("https://x/api/v1/families/nonexistent");
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd site && npm test -- tests/api/families.test.ts`
Expected: FAIL — routes not found.

- [ ] **Step 3: Implement `site/src/routes/api/v1/families/+server.ts`**

```typescript
import type { RequestHandler } from "./$types";
import { cachedJson } from "$lib/server/cache";
import { getAll } from "$lib/server/db";
import { errorResponse } from "$lib/server/errors";

export const GET: RequestHandler = async ({ request, platform }) => {
  const env = platform!.env;
  try {
    const rows = await getAll<{
      slug: string;
      display_name: string;
      vendor: string;
      model_count: number;
      latest_avg_score: number | null;
      latest_model_slug: string | null;
    }>(
      env.DB,
      `
      WITH latest AS (
        SELECT m.family_id, m.id AS model_id, m.slug, m.generation,
               ROW_NUMBER() OVER (PARTITION BY m.family_id ORDER BY m.generation DESC, m.id DESC) AS rn
        FROM models m
      ),
      avg_by_model AS (
        SELECT runs.model_id, AVG(r.score) AS avg_score
        FROM runs
        JOIN results r ON r.run_id = runs.id
        GROUP BY runs.model_id
      )
      SELECT mf.slug, mf.display_name, mf.vendor,
             (SELECT COUNT(*) FROM models m WHERE m.family_id = mf.id) AS model_count,
             abm.avg_score AS latest_avg_score,
             l.slug AS latest_model_slug
      FROM model_families mf
      LEFT JOIN latest l ON l.family_id = mf.id AND l.rn = 1
      LEFT JOIN avg_by_model abm ON abm.model_id = l.model_id
      ORDER BY mf.slug ASC
      `,
      [],
    );

    return cachedJson(request, { data: rows });
  } catch (err) {
    return errorResponse(err);
  }
};
```

- [ ] **Step 4: Implement `site/src/routes/api/v1/families/[slug]/+server.ts`**

```typescript
import type { RequestHandler } from "./$types";
import { cachedJson } from "$lib/server/cache";
import { getAll, getFirst } from "$lib/server/db";
import { ApiError, errorResponse } from "$lib/server/errors";

export const GET: RequestHandler = async ({ request, params, platform }) => {
  const env = platform!.env;
  try {
    const fam = await getFirst<
      { id: number; slug: string; display_name: string; vendor: string }
    >(
      env.DB,
      `SELECT id, slug, display_name, vendor FROM model_families WHERE slug = ?`,
      [params.slug!],
    );
    if (!fam) {
      throw new ApiError(404, "family_not_found", `No family '${params.slug}'`);
    }

    const trajectory = await getAll<{
      slug: string;
      display_name: string;
      api_model_id: string;
      generation: string | null;
      avg_score: number | null;
      run_count: number;
      last_run_at: string | null;
      avg_cost_usd: number | null;
    }>(
      env.DB,
      `
      SELECT m.slug, m.display_name, m.api_model_id, m.generation,
             AVG(r.score) AS avg_score,
             COUNT(DISTINCT runs.id) AS run_count,
             MAX(runs.started_at) AS last_run_at,
             AVG((r.tokens_in * cs.input_per_mtoken + r.tokens_out * cs.output_per_mtoken) / 1000000.0) AS avg_cost_usd
      FROM models m
      LEFT JOIN runs ON runs.model_id = m.id
      LEFT JOIN results r ON r.run_id = runs.id
      LEFT JOIN cost_snapshots cs ON cs.model_id = runs.model_id AND cs.pricing_version = runs.pricing_version
      WHERE m.family_id = ?
      GROUP BY m.id
      ORDER BY m.generation ASC, m.id ASC
      `,
      [fam.id],
    );

    return cachedJson(request, {
      slug: fam.slug,
      display_name: fam.display_name,
      vendor: fam.vendor,
      trajectory: trajectory.map((t) => ({
        model: {
          slug: t.slug,
          display_name: t.display_name,
          api_model_id: t.api_model_id,
          generation: t.generation,
        },
        avg_score: t.avg_score ?? 0,
        run_count: t.run_count,
        last_run_at: t.last_run_at,
        avg_cost_usd: t.avg_cost_usd ?? 0,
      })),
    });
  } catch (err) {
    return errorResponse(err);
  }
};
```

- [ ] **Step 5: Run tests**

Run: `cd site && npm test -- tests/api/families.test.ts`
Expected: 3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add site/src/routes/api/v1/families/ site/tests/api/families.test.ts
git commit -m "feat(site): implement GET /api/v1/families and trajectory"
```

---

## Task 21: Models list + detail + limitations

**Files:**

- Create: `site/src/routes/api/v1/models/+server.ts`
- Create: `site/src/routes/api/v1/models/[slug]/+server.ts`
- Create: `site/src/routes/api/v1/models/[slug]/limitations/+server.ts`
- Create: `site/tests/api/models.test.ts`

- [ ] **Step 1: Write failing test** `site/tests/api/models.test.ts`

```typescript
import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

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
    env.DB.prepare(
      `INSERT INTO model_families(id,slug,vendor,display_name) VALUES (1,'claude','anthropic','Claude')`,
    ),
    env.DB.prepare(
      `INSERT INTO models(id,family_id,slug,api_model_id,display_name,generation) VALUES (1,1,'sonnet-4.7','claude-sonnet-4-7','Sonnet 4.7','4.7')`,
    ),
    env.DB.prepare(
      `INSERT INTO task_sets(hash,version,locked_at,is_current) VALUES ('ts','v1','2026-01-01T00:00:00Z',1)`,
    ),
    env.DB.prepare(
      `INSERT INTO settings_profiles(hash,temperature,max_attempts) VALUES ('s',0.0,2)`,
    ),
    env.DB.prepare(
      `INSERT INTO cost_snapshots(pricing_version,model_id,input_per_mtoken,output_per_mtoken,effective_from) VALUES ('v1',1,3,15,'2026-01-01')`,
    ),
    env.DB.prepare(
      `INSERT INTO machine_keys(id,machine_id,public_key,scope,created_at) VALUES (1,'r',X'00','ingest','2026-01-01T00:00:00Z')`,
    ),
    env.DB.prepare(
      `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,completed_at,status,tier,pricing_version,ingest_signature,ingest_signed_at,ingest_public_key_id) VALUES ('r1','ts',1,'s','rig','2026-04-01T00:00:00Z','2026-04-01T01:00:00Z','completed','claimed','v1','sig','2026-04-01T00:00:00Z',1)`,
    ),
    env.DB.prepare(
      `INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success,tests_total,tests_passed) VALUES ('r1','easy/a',1,1,1.0,1,3,3),('r1','hard/b',1,0,0.0,1,3,0)`,
    ),
    env.DB.prepare(
      `INSERT INTO shortcomings(id,model_id,al_concept,concept,description,correct_pattern,incorrect_pattern_r2_key,first_seen,last_seen) VALUES (1,1,'interfaces','interfaces','Adds IDs to interfaces','No ID on interfaces','shortcomings/x.al.zst','2026-01-01T00:00:00Z','2026-04-01T00:00:00Z')`,
    ),
  ]);
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
beforeEach(async () => {
  await seed();
});

describe("GET /api/v1/models", () => {
  it("lists all models", async () => {
    const res = await SELF.fetch("https://x/api/v1/models");
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<any> };
    expect(body.data).toHaveLength(1);
    expect(body.data[0].slug).toBe("sonnet-4.7");
    expect(body.data[0].family_slug).toBe("claude");
  });
});

describe("GET /api/v1/models/:slug", () => {
  it("returns aggregates + consistency + recent runs", async () => {
    const res = await SELF.fetch("https://x/api/v1/models/sonnet-4.7");
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.slug).toBe("sonnet-4.7");
    expect(body.family_slug).toBe("claude");
    expect(body.aggregates.run_count).toBe(1);
    expect(body.aggregates.avg_score).toBeCloseTo(0.5, 5);
    expect(body.recent_runs).toHaveLength(1);
    expect(body.recent_runs[0].id).toBe("r1");
    expect(body.consistency_score).toBeGreaterThanOrEqual(0);
  });

  it("returns 404 for unknown model", async () => {
    const res = await SELF.fetch("https://x/api/v1/models/nonexistent");
    expect(res.status).toBe(404);
  });
});

describe("GET /api/v1/models/:slug/limitations", () => {
  it("returns shortcomings as JSON", async () => {
    const res = await SELF.fetch(
      "https://x/api/v1/models/sonnet-4.7/limitations",
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<any> };
    expect(body.data).toHaveLength(1);
    expect(body.data[0].al_concept).toBe("interfaces");
  });

  it("returns markdown when Accept: text/markdown", async () => {
    const res = await SELF.fetch(
      "https://x/api/v1/models/sonnet-4.7/limitations",
      {
        headers: { accept: "text/markdown" },
      },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/markdown");
    const text = await res.text();
    expect(text).toContain("# Sonnet 4.7 limitations");
    expect(text).toContain("## interfaces");
  });

  it("returns 404 for unknown model", async () => {
    const res = await SELF.fetch("https://x/api/v1/models/nope/limitations");
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd site && npm test -- tests/api/models.test.ts`
Expected: FAIL — routes not found.

- [ ] **Step 3: Implement `site/src/routes/api/v1/models/+server.ts`**

```typescript
import type { RequestHandler } from "./$types";
import { cachedJson } from "$lib/server/cache";
import { getAll } from "$lib/server/db";
import { errorResponse } from "$lib/server/errors";

export const GET: RequestHandler = async ({ request, platform }) => {
  const env = platform!.env;
  try {
    const rows = await getAll<{
      slug: string;
      display_name: string;
      api_model_id: string;
      generation: string | null;
      family_slug: string;
    }>(
      env.DB,
      `SELECT m.slug, m.display_name, m.api_model_id, m.generation, mf.slug AS family_slug
       FROM models m JOIN model_families mf ON mf.id = m.family_id
       ORDER BY mf.slug, m.slug`,
      [],
    );
    return cachedJson(request, { data: rows });
  } catch (err) {
    return errorResponse(err);
  }
};
```

- [ ] **Step 4: Implement `site/src/routes/api/v1/models/[slug]/+server.ts`**

```typescript
import type { RequestHandler } from "./$types";
import { cachedJson } from "$lib/server/cache";
import { getAll, getFirst } from "$lib/server/db";
import { ApiError, errorResponse } from "$lib/server/errors";

export const GET: RequestHandler = async ({ request, params, platform }) => {
  const env = platform!.env;
  try {
    const model = await getFirst<{
      id: number;
      slug: string;
      display_name: string;
      api_model_id: string;
      generation: string | null;
      family_slug: string;
      family_display: string;
    }>(
      env.DB,
      `SELECT m.id, m.slug, m.display_name, m.api_model_id, m.generation,
              mf.slug AS family_slug, mf.display_name AS family_display
       FROM models m JOIN model_families mf ON mf.id = m.family_id
       WHERE m.slug = ?`,
      [params.slug!],
    );
    if (!model) {
      throw new ApiError(404, "model_not_found", `No model '${params.slug}'`);
    }

    const aggregate = await getFirst<{
      run_count: number;
      tasks_attempted: number;
      tasks_passed: number;
      avg_score: number | null;
      avg_cost_usd: number | null;
    }>(
      env.DB,
      `SELECT COUNT(DISTINCT runs.id) AS run_count,
              COUNT(*) AS tasks_attempted,
              SUM(r.passed) AS tasks_passed,
              AVG(r.score) AS avg_score,
              AVG((r.tokens_in * cs.input_per_mtoken + r.tokens_out * cs.output_per_mtoken) / 1000000.0) AS avg_cost_usd
       FROM runs
       JOIN results r ON r.run_id = runs.id
       JOIN cost_snapshots cs ON cs.model_id = runs.model_id AND cs.pricing_version = runs.pricing_version
       WHERE runs.model_id = ?`,
      [model.id],
    );

    // Consistency: 1 - stddev(score) across runs for identical tasks.
    const consistency = await getFirst<{ consistency: number | null }>(
      env.DB,
      `SELECT 1.0 - COALESCE(
         (SELECT AVG(variance_per_task) FROM (
           SELECT (MAX(r.score) - MIN(r.score)) AS variance_per_task
           FROM runs JOIN results r ON r.run_id = runs.id
           WHERE runs.model_id = ?
           GROUP BY r.task_id
           HAVING COUNT(*) > 1
         )), 0.0
       ) AS consistency`,
      [model.id],
    );

    const recentRuns = await getAll<{
      id: string;
      started_at: string;
      completed_at: string | null;
      tier: string;
      status: string;
      task_set_hash: string;
    }>(
      env.DB,
      `SELECT id, started_at, completed_at, tier, status, task_set_hash
       FROM runs WHERE model_id = ?
       ORDER BY started_at DESC LIMIT 20`,
      [model.id],
    );

    return cachedJson(request, {
      slug: model.slug,
      display_name: model.display_name,
      api_model_id: model.api_model_id,
      generation: model.generation,
      family_slug: model.family_slug,
      family_display: model.family_display,
      aggregates: {
        run_count: aggregate?.run_count ?? 0,
        tasks_attempted: aggregate?.tasks_attempted ?? 0,
        tasks_passed: aggregate?.tasks_passed ?? 0,
        avg_score: Number((aggregate?.avg_score ?? 0).toFixed(6)),
        avg_cost_usd: Number((aggregate?.avg_cost_usd ?? 0).toFixed(6)),
      },
      consistency_score: Math.max(
        0,
        Math.min(1, consistency?.consistency ?? 1),
      ),
      recent_runs: recentRuns,
    });
  } catch (err) {
    return errorResponse(err);
  }
};
```

- [ ] **Step 5: Implement `site/src/routes/api/v1/models/[slug]/limitations/+server.ts`**

```typescript
import type { RequestHandler } from "./$types";
import { cachedJson } from "$lib/server/cache";
import { getAll, getFirst } from "$lib/server/db";
import { ApiError, errorResponse } from "$lib/server/errors";

export const GET: RequestHandler = async ({ request, params, platform }) => {
  const env = platform!.env;
  try {
    const model = await getFirst<{ id: number; display_name: string }>(
      env.DB,
      `SELECT id, display_name FROM models WHERE slug = ?`,
      [params.slug!],
    );
    if (!model) {
      throw new ApiError(404, "model_not_found", `No model '${params.slug}'`);
    }

    const rows = await getAll<{
      al_concept: string;
      concept: string;
      description: string;
      correct_pattern: string;
      error_codes_json: string;
      first_seen: string;
      last_seen: string;
      occurrence_count: number;
    }>(
      env.DB,
      `SELECT s.al_concept, s.concept, s.description, s.correct_pattern,
              s.error_codes_json, s.first_seen, s.last_seen,
              (SELECT COUNT(*) FROM shortcoming_occurrences so WHERE so.shortcoming_id = s.id) AS occurrence_count
       FROM shortcomings s
       WHERE s.model_id = ?
       ORDER BY s.al_concept`,
      [model.id],
    );

    const accept = request.headers.get("accept") ?? "";
    if (accept.includes("text/markdown")) {
      const md = renderMarkdown(model.display_name, rows);
      return new Response(md, {
        status: 200,
        headers: {
          "content-type": "text/markdown; charset=utf-8",
          "cache-control": "public, s-maxage=60, stale-while-revalidate=600",
          "x-api-version": "v1",
        },
      });
    }

    return cachedJson(request, {
      data: rows.map((r) => ({
        ...r,
        error_codes: JSON.parse(r.error_codes_json) as string[],
      })),
    });
  } catch (err) {
    return errorResponse(err);
  }
};

function renderMarkdown(
  modelName: string,
  rows: Array<{
    al_concept: string;
    concept: string;
    description: string;
    correct_pattern: string;
    error_codes_json: string;
    occurrence_count: number;
  }>,
): string {
  const sections = rows.map((r) => {
    const codes = (JSON.parse(r.error_codes_json) as string[]).join(", ") ||
      "(none)";
    return [
      `## ${r.al_concept}`,
      "",
      `**Concept:** ${r.concept}`,
      "",
      r.description,
      "",
      `**Correct pattern:** ${r.correct_pattern}`,
      "",
      `**Error codes:** ${codes}`,
      "",
      `**Occurrences:** ${r.occurrence_count}`,
      "",
    ].join("\n");
  });
  return [`# ${modelName} limitations`, "", ...sections].join("\n");
}
```

- [ ] **Step 6: Run tests**

Run: `cd site && npm test -- tests/api/models.test.ts`
Expected: 6 tests pass.

- [ ] **Step 7: Commit**

```bash
git add site/src/routes/api/v1/models/ site/tests/api/models.test.ts
git commit -m "feat(site): implement GET /api/v1/models list + detail + limitations"
```

---

## Task 22: Tasks list + detail `GET /api/v1/tasks`, `GET /api/v1/tasks/:id`

**Files:**

- Create: `site/src/routes/api/v1/tasks/+server.ts`
- Create: `site/src/routes/api/v1/tasks/[...id]/+server.ts`
- Create: `site/tests/api/tasks.test.ts`

- [ ] **Step 1: Write failing test** `site/tests/api/tasks.test.ts`

```typescript
import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

async function seed(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM results`),
    env.DB.prepare(`DELETE FROM runs`),
    env.DB.prepare(`DELETE FROM tasks`),
    env.DB.prepare(`DELETE FROM task_categories`),
    env.DB.prepare(`DELETE FROM task_sets`),
    env.DB.prepare(`DELETE FROM models`),
    env.DB.prepare(`DELETE FROM model_families`),
    env.DB.prepare(`DELETE FROM settings_profiles`),
    env.DB.prepare(`DELETE FROM cost_snapshots`),
    env.DB.prepare(`DELETE FROM machine_keys`),
  ]);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO task_sets(hash,version,locked_at,is_current) VALUES ('ts','v1','2026-01-01T00:00:00Z',1)`,
    ),
    env.DB.prepare(
      `INSERT INTO task_categories(id,slug,display_name,difficulty) VALUES (1,'easy','Easy','easy'),(2,'hard','Hard','hard')`,
    ),
    env.DB.prepare(
      `INSERT INTO tasks(id,task_set_hash,category_id,version,yaml_r2_key) VALUES ('easy/a','ts',1,1,'tasks/ts/easy/a.yml'),('hard/b','ts',2,1,NULL)`,
    ),
    env.DB.prepare(
      `INSERT INTO model_families(id,slug,vendor,display_name) VALUES (1,'claude','anthropic','Claude')`,
    ),
    env.DB.prepare(
      `INSERT INTO models(id,family_id,slug,api_model_id,display_name) VALUES (1,1,'sonnet-4.7','claude-sonnet-4-7','Sonnet 4.7')`,
    ),
    env.DB.prepare(
      `INSERT INTO settings_profiles(hash,temperature,max_attempts) VALUES ('s',0.0,2)`,
    ),
    env.DB.prepare(
      `INSERT INTO cost_snapshots(pricing_version,model_id,input_per_mtoken,output_per_mtoken,effective_from) VALUES ('v1',1,3,15,'2026-01-01')`,
    ),
    env.DB.prepare(
      `INSERT INTO machine_keys(id,machine_id,public_key,scope,created_at) VALUES (1,'r',X'00','ingest','2026-01-01T00:00:00Z')`,
    ),
    env.DB.prepare(
      `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,completed_at,status,tier,pricing_version,ingest_signature,ingest_signed_at,ingest_public_key_id) VALUES ('r1','ts',1,'s','rig','2026-04-01T00:00:00Z','2026-04-01T01:00:00Z','completed','claimed','v1','sig','2026-04-01T00:00:00Z',1)`,
    ),
    env.DB.prepare(
      `INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success,tests_total,tests_passed) VALUES ('r1','easy/a',1,1,1.0,1,3,3),('r1','hard/b',1,0,0.0,1,3,0)`,
    ),
  ]);
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
beforeEach(async () => {
  await seed();
});

describe("GET /api/v1/tasks", () => {
  it("lists tasks in current set by default", async () => {
    const res = await SELF.fetch("https://x/api/v1/tasks");
    expect(res.status).toBe(200);
    const body = await res.json() as {
      data: Array<any>;
      next_cursor: string | null;
    };
    expect(body.data).toHaveLength(2);
    expect(body.data[0].id).toBe("easy/a");
    expect(body.data[0].difficulty).toBe("easy");
  });

  it("respects limit + paginates via cursor", async () => {
    const res1 = await SELF.fetch("https://x/api/v1/tasks?limit=1");
    const body1 = await res1.json() as {
      data: Array<any>;
      next_cursor: string | null;
    };
    expect(body1.data).toHaveLength(1);
    expect(body1.next_cursor).not.toBeNull();

    const res2 = await SELF.fetch(
      `https://x/api/v1/tasks?limit=1&cursor=${body1.next_cursor}`,
    );
    const body2 = await res2.json() as { data: Array<any> };
    expect(body2.data).toHaveLength(1);
    expect(body2.data[0].id).not.toBe(body1.data[0].id);
  });
});

describe("GET /api/v1/tasks/:id", () => {
  it("returns task detail + solved-by matrix", async () => {
    const res = await SELF.fetch("https://x/api/v1/tasks/easy/a");
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.id).toBe("easy/a");
    expect(body.difficulty).toBe("easy");
    expect(body.yaml_r2_key).toBe("tasks/ts/easy/a.yml");
    expect(body.solved_by).toHaveLength(1);
    expect(body.solved_by[0].model_slug).toBe("sonnet-4.7");
    expect(body.solved_by[0].attempt_1_passed).toBe(1);
  });

  it("returns 404 for unknown task", async () => {
    const res = await SELF.fetch("https://x/api/v1/tasks/easy/nonexistent");
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd site && npm test -- tests/api/tasks.test.ts`
Expected: FAIL — routes not found.

- [ ] **Step 3: Implement `site/src/routes/api/v1/tasks/+server.ts`**

```typescript
import type { RequestHandler } from "./$types";
import { cachedJson, decodeCursor, encodeCursor } from "$lib/server/cache";
import { getAll } from "$lib/server/db";
import { ApiError, errorResponse } from "$lib/server/errors";

interface TaskCursor {
  id: string;
}

export const GET: RequestHandler = async ({ request, url, platform }) => {
  const env = platform!.env;
  try {
    const set = url.searchParams.get("set") ?? "current";
    if (set !== "current" && set !== "all") {
      throw new ApiError(400, "invalid_set", "set must be current or all");
    }
    const limitRaw = url.searchParams.get("limit");
    const limit = limitRaw ? parseInt(limitRaw, 10) : 50;
    if (!Number.isFinite(limit) || limit < 1 || limit > 100) {
      throw new ApiError(
        400,
        "invalid_limit",
        "limit must be between 1 and 100",
      );
    }
    const cursor = decodeCursor<TaskCursor>(url.searchParams.get("cursor"));

    const params: (string | number)[] = [];
    const wheres: string[] = [];
    if (set === "current") {
      wheres.push(
        `t.task_set_hash IN (SELECT hash FROM task_sets WHERE is_current = 1)`,
      );
    }
    if (cursor) {
      wheres.push(`t.id > ?`);
      params.push(cursor.id);
    }

    const sql = `
      SELECT t.id, t.version, t.yaml_r2_key, t.task_set_hash,
             tc.slug AS category_slug, tc.display_name AS category_name, tc.difficulty
      FROM tasks t JOIN task_categories tc ON tc.id = t.category_id
      ${wheres.length ? `WHERE ${wheres.join(" AND ")}` : ""}
      ORDER BY t.id ASC
      LIMIT ?
    `;
    const rows = await getAll<{
      id: string;
      version: number;
      yaml_r2_key: string | null;
      task_set_hash: string;
      category_slug: string;
      category_name: string;
      difficulty: string;
    }>(env.DB, sql, [...params, limit + 1]);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const next_cursor = hasMore
      ? encodeCursor<TaskCursor>({ id: page[page.length - 1].id })
      : null;

    return cachedJson(request, { data: page, next_cursor });
  } catch (err) {
    return errorResponse(err);
  }
};
```

- [ ] **Step 4: Implement `site/src/routes/api/v1/tasks/[...id]/+server.ts`**

(Using `[...id]/+server.ts` rest-style segment so `easy/a` and `hard/b` parse as the `id` param containing a slash.)

```typescript
import type { RequestHandler } from "./$types";
import { cachedJson } from "$lib/server/cache";
import { getAll, getFirst } from "$lib/server/db";
import { ApiError, errorResponse } from "$lib/server/errors";

export const GET: RequestHandler = async ({ request, params, platform }) => {
  const env = platform!.env;
  try {
    const task = await getFirst<{
      id: string;
      version: number;
      yaml_r2_key: string | null;
      task_set_hash: string;
      category_slug: string;
      category_name: string;
      difficulty: string;
    }>(
      env.DB,
      `SELECT t.id, t.version, t.yaml_r2_key, t.task_set_hash,
              tc.slug AS category_slug, tc.display_name AS category_name, tc.difficulty
       FROM tasks t JOIN task_categories tc ON tc.id = t.category_id
       WHERE t.id = ?`,
      [params.id!],
    );
    if (!task) {
      throw new ApiError(404, "task_not_found", `No task '${params.id}'`);
    }

    const solvedBy = await getAll<{
      model_slug: string;
      model_display: string;
      attempt_1_passed: number;
      attempt_2_passed: number;
      runs_total: number;
      avg_score: number | null;
    }>(
      env.DB,
      `SELECT m.slug AS model_slug, m.display_name AS model_display,
              MAX(CASE WHEN r.attempt = 1 THEN r.passed END) AS attempt_1_passed,
              MAX(CASE WHEN r.attempt = 2 THEN r.passed END) AS attempt_2_passed,
              COUNT(DISTINCT runs.id) AS runs_total,
              AVG(r.score) AS avg_score
       FROM results r
       JOIN runs ON runs.id = r.run_id
       JOIN models m ON m.id = runs.model_id
       WHERE r.task_id = ?
       GROUP BY m.id
       ORDER BY avg_score DESC, m.slug ASC`,
      [params.id!],
    );

    return cachedJson(request, {
      id: task.id,
      version: task.version,
      yaml_r2_key: task.yaml_r2_key,
      task_set_hash: task.task_set_hash,
      category: {
        slug: task.category_slug,
        display_name: task.category_name,
        difficulty: task.difficulty,
      },
      difficulty: task.difficulty,
      solved_by: solvedBy,
    });
  } catch (err) {
    return errorResponse(err);
  }
};
```

- [ ] **Step 5: Run tests**

Run: `cd site && npm test -- tests/api/tasks.test.ts`
Expected: 4 tests pass.

- [ ] **Step 6: Commit**

```bash
git add site/src/routes/api/v1/tasks/ site/tests/api/tasks.test.ts
git commit -m "feat(site): implement GET /api/v1/tasks list + detail"
```

---

## Task 23: Runs list + detail + signature + reproduction download

**Files:**

- Create: `site/src/routes/api/v1/runs/[id]/+server.ts` (GET detail — existing `+server.ts` at `runs/` only has POST; existing `runs/[id]/finalize/+server.ts` unchanged)
- Create: `site/src/routes/api/v1/runs/[id]/signature/+server.ts`
- Create: `site/src/routes/api/v1/runs/[id]/reproduce.tar.gz/+server.ts`
- Modify: `site/src/routes/api/v1/runs/+server.ts` (add GET handler)
- Create: `site/tests/api/runs-read.test.ts`

- [ ] **Step 1: Write failing test** `site/tests/api/runs-read.test.ts`

```typescript
import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

async function seed(): Promise<void> {
  await env.DB.batch([
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
    env.DB.prepare(
      `INSERT INTO model_families(id,slug,vendor,display_name) VALUES (1,'claude','anthropic','Claude')`,
    ),
    env.DB.prepare(
      `INSERT INTO models(id,family_id,slug,api_model_id,display_name) VALUES (1,1,'sonnet-4.7','claude-sonnet-4-7','Sonnet 4.7')`,
    ),
    env.DB.prepare(
      `INSERT INTO task_sets(hash,version,locked_at,is_current) VALUES ('ts','v1','2026-01-01T00:00:00Z',1)`,
    ),
    env.DB.prepare(
      `INSERT INTO settings_profiles(hash,temperature,max_attempts) VALUES ('s',0.0,2)`,
    ),
    env.DB.prepare(
      `INSERT INTO cost_snapshots(pricing_version,model_id,input_per_mtoken,output_per_mtoken,effective_from) VALUES ('v1',1,3,15,'2026-01-01')`,
    ),
    env.DB.prepare(
      `INSERT INTO machine_keys(id,machine_id,public_key,scope,created_at) VALUES (1,'rig',X'00','ingest','2026-01-01T00:00:00Z')`,
    ),
    env.DB.prepare(
      `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,completed_at,status,tier,pricing_version,reproduction_bundle_r2_key,ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload) VALUES ('r1','ts',1,'s','rig','2026-04-01T00:00:00Z','2026-04-01T01:00:00Z','completed','claimed','v1','reproductions/r1.tar.zst','sig-value','2026-04-01T00:00:00Z',1,X'7B7D'),('r2','ts',1,'s','rig','2026-04-02T00:00:00Z','2026-04-02T01:00:00Z','completed','claimed','v1',NULL,'sig2','2026-04-02T00:00:00Z',1,X'7B7D')`,
    ),
    env.DB.prepare(
      `INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success,tests_total,tests_passed,tokens_in,tokens_out) VALUES ('r1','easy/a',1,1,1.0,1,3,3,1000,500),('r2','easy/a',1,0,0.0,1,3,0,1000,500)`,
    ),
  ]);

  await env.R2.put("reproductions/r1.tar.zst", new Uint8Array([1, 2, 3, 4]));
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
beforeEach(async () => {
  await seed();
});

describe("GET /api/v1/runs", () => {
  it("lists runs in started_at desc order", async () => {
    const res = await SELF.fetch("https://x/api/v1/runs");
    expect(res.status).toBe(200);
    const body = await res.json() as {
      data: Array<any>;
      next_cursor: string | null;
    };
    expect(body.data).toHaveLength(2);
    expect(body.data[0].id).toBe("r2");
    expect(body.data[1].id).toBe("r1");
  });

  it("filters by model", async () => {
    const res = await SELF.fetch("https://x/api/v1/runs?model=sonnet-4.7");
    const body = await res.json() as { data: Array<any> };
    expect(body.data).toHaveLength(2);
    expect(body.data.every((r: any) => r.model.slug === "sonnet-4.7")).toBe(
      true,
    );
  });

  it("filters by tier", async () => {
    const res = await SELF.fetch("https://x/api/v1/runs?tier=verified");
    const body = await res.json() as { data: Array<any> };
    expect(body.data).toHaveLength(0);
  });
});

describe("GET /api/v1/runs/:id", () => {
  it("returns run detail with results", async () => {
    const res = await SELF.fetch("https://x/api/v1/runs/r1");
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.id).toBe("r1");
    expect(body.model.slug).toBe("sonnet-4.7");
    expect(body.results).toHaveLength(1);
    expect(body.results[0].cost_usd).toBeCloseTo(
      (1000 * 3 + 500 * 15) / 1e6,
      6,
    );
  });

  it("returns 404 for unknown run", async () => {
    const res = await SELF.fetch("https://x/api/v1/runs/nonexistent");
    expect(res.status).toBe(404);
  });
});

describe("GET /api/v1/runs/:id/signature", () => {
  it("returns raw signed payload + signature", async () => {
    const res = await SELF.fetch("https://x/api/v1/runs/r1/signature");
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.run_id).toBe("r1");
    expect(body.signature.value).toBe("sig-value");
    expect(body.signature.alg).toBe("Ed25519");
    expect(body.signed_payload_base64).toMatch(/^[A-Za-z0-9+/=]+$/);
  });
});

describe("GET /api/v1/runs/:id/reproduce.tar.gz", () => {
  it("streams the reproduction bundle from R2", async () => {
    const res = await SELF.fetch("https://x/api/v1/runs/r1/reproduce.tar.gz");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/x-tar");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it("returns 404 when bundle not set", async () => {
    const res = await SELF.fetch("https://x/api/v1/runs/r2/reproduce.tar.gz");
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd site && npm test -- tests/api/runs-read.test.ts`
Expected: FAIL — routes not found.

- [ ] **Step 3: Modify `site/src/routes/api/v1/runs/+server.ts` — add GET handler**

Add a new exported `GET` below the existing `POST`:

```typescript
import { cachedJson, decodeCursor, encodeCursor } from "$lib/server/cache";
import { getAll } from "$lib/server/db";

interface RunsCursor {
  started_at: string;
  id: string;
}

export const GET: RequestHandler = async ({ request, url, platform }) => {
  const env = platform!.env;
  try {
    const limitRaw = url.searchParams.get("limit");
    const limit = limitRaw ? parseInt(limitRaw, 10) : 50;
    if (!Number.isFinite(limit) || limit < 1 || limit > 100) {
      throw new ApiError(
        400,
        "invalid_limit",
        "limit must be between 1 and 100",
      );
    }
    const model = url.searchParams.get("model");
    const tier = url.searchParams.get("tier");
    const taskSet = url.searchParams.get("task_set");
    const since = url.searchParams.get("since");
    const cursor = decodeCursor<RunsCursor>(url.searchParams.get("cursor"));

    const wheres: string[] = [];
    const params: (string | number)[] = [];
    if (model) {
      wheres.push(`m.slug = ?`);
      params.push(model);
    }
    if (tier) {
      wheres.push(`runs.tier = ?`);
      params.push(tier);
    }
    if (taskSet) {
      wheres.push(`runs.task_set_hash = ?`);
      params.push(taskSet);
    }
    if (since) {
      wheres.push(`runs.started_at >= ?`);
      params.push(since);
    }
    if (cursor) {
      wheres.push(
        `(runs.started_at < ? OR (runs.started_at = ? AND runs.id < ?))`,
      );
      params.push(cursor.started_at, cursor.started_at, cursor.id);
    }

    const sql = `
      SELECT runs.id, runs.task_set_hash, runs.settings_hash, runs.machine_id,
             runs.started_at, runs.completed_at, runs.status, runs.tier,
             m.slug AS model_slug, m.display_name AS model_display
      FROM runs
      JOIN models m ON m.id = runs.model_id
      ${wheres.length ? `WHERE ${wheres.join(" AND ")}` : ""}
      ORDER BY runs.started_at DESC, runs.id DESC
      LIMIT ?
    `;
    const rows = await getAll<{
      id: string;
      task_set_hash: string;
      settings_hash: string;
      machine_id: string;
      started_at: string;
      completed_at: string | null;
      status: string;
      tier: string;
      model_slug: string;
      model_display: string;
    }>(env.DB, sql, [...params, limit + 1]);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const next_cursor = hasMore
      ? encodeCursor<RunsCursor>({
        started_at: page[page.length - 1].started_at,
        id: page[page.length - 1].id,
      })
      : null;

    return cachedJson(request, {
      data: page.map((r) => ({
        id: r.id,
        task_set_hash: r.task_set_hash,
        settings_hash: r.settings_hash,
        machine_id: r.machine_id,
        started_at: r.started_at,
        completed_at: r.completed_at,
        status: r.status,
        tier: r.tier,
        model: { slug: r.model_slug, display_name: r.model_display },
      })),
      next_cursor,
    });
  } catch (err) {
    return errorResponse(err);
  }
};
```

- [ ] **Step 4: Implement `site/src/routes/api/v1/runs/[id]/+server.ts`**

```typescript
import type { RequestHandler } from "./$types";
import { cachedJson } from "$lib/server/cache";
import { getAll, getFirst } from "$lib/server/db";
import { ApiError, errorResponse } from "$lib/server/errors";

export const GET: RequestHandler = async ({ request, params, platform }) => {
  const env = platform!.env;
  try {
    const run = await getFirst<{
      id: string;
      task_set_hash: string;
      settings_hash: string;
      machine_id: string;
      started_at: string;
      completed_at: string | null;
      status: string;
      tier: string;
      source: string;
      centralgauge_sha: string | null;
      pricing_version: string;
      reproduction_bundle_r2_key: string | null;
      model_slug: string;
      model_display: string;
      model_api_id: string;
      family_slug: string;
      ingest_public_key_id: number;
    }>(
      env.DB,
      `SELECT runs.id, runs.task_set_hash, runs.settings_hash, runs.machine_id,
              runs.started_at, runs.completed_at, runs.status, runs.tier, runs.source,
              runs.centralgauge_sha, runs.pricing_version, runs.reproduction_bundle_r2_key,
              runs.ingest_public_key_id,
              m.slug AS model_slug, m.display_name AS model_display, m.api_model_id AS model_api_id,
              mf.slug AS family_slug
       FROM runs
       JOIN models m ON m.id = runs.model_id
       JOIN model_families mf ON mf.id = m.family_id
       WHERE runs.id = ?`,
      [params.id!],
    );
    if (!run) throw new ApiError(404, "run_not_found", `No run '${params.id}'`);

    const results = await getAll<{
      id: number;
      task_id: string;
      attempt: number;
      passed: number;
      score: number;
      compile_success: number;
      compile_errors_json: string;
      tests_total: number;
      tests_passed: number;
      tokens_in: number;
      tokens_out: number;
      tokens_cache_read: number;
      tokens_cache_write: number;
      cost_usd: number;
      llm_duration_ms: number | null;
      compile_duration_ms: number | null;
      test_duration_ms: number | null;
      transcript_r2_key: string | null;
      code_r2_key: string | null;
      failure_reasons_json: string | null;
    }>(
      env.DB,
      `SELECT id, task_id, attempt, passed, score, compile_success, compile_errors_json,
              tests_total, tests_passed, tokens_in, tokens_out, tokens_cache_read, tokens_cache_write,
              cost_usd,
              llm_duration_ms, compile_duration_ms, test_duration_ms,
              transcript_r2_key, code_r2_key, failure_reasons_json
       FROM v_results_with_cost
       WHERE run_id = ?
       ORDER BY task_id, attempt`,
      [params.id!],
    );

    return cachedJson(request, {
      id: run.id,
      task_set_hash: run.task_set_hash,
      settings_hash: run.settings_hash,
      machine_id: run.machine_id,
      started_at: run.started_at,
      completed_at: run.completed_at,
      status: run.status,
      tier: run.tier,
      source: run.source,
      centralgauge_sha: run.centralgauge_sha,
      pricing_version: run.pricing_version,
      reproduction_bundle_r2_key: run.reproduction_bundle_r2_key,
      ingest_public_key_id: run.ingest_public_key_id,
      model: {
        slug: run.model_slug,
        display_name: run.model_display,
        api_model_id: run.model_api_id,
      },
      family_slug: run.family_slug,
      results: results.map((r) => ({
        ...r,
        compile_errors: JSON.parse(r.compile_errors_json) as Array<unknown>,
        failure_reasons: r.failure_reasons_json
          ? JSON.parse(r.failure_reasons_json) as Array<unknown>
          : null,
      })),
    });
  } catch (err) {
    return errorResponse(err);
  }
};
```

- [ ] **Step 5: Implement `site/src/routes/api/v1/runs/[id]/signature/+server.ts`**

```typescript
import type { RequestHandler } from "./$types";
import { cachedJson } from "$lib/server/cache";
import { getFirst } from "$lib/server/db";
import { ApiError, errorResponse } from "$lib/server/errors";
import { base64Encode } from "$lib/shared/base64";

export const GET: RequestHandler = async ({ request, params, platform }) => {
  const env = platform!.env;
  try {
    const run = await getFirst<{
      id: string;
      ingest_signature: string;
      ingest_signed_at: string;
      ingest_public_key_id: number;
      ingest_signed_payload: ArrayBuffer;
    }>(
      env.DB,
      `SELECT id, ingest_signature, ingest_signed_at, ingest_public_key_id, ingest_signed_payload
       FROM runs WHERE id = ?`,
      [params.id!],
    );
    if (!run) throw new ApiError(404, "run_not_found", `No run '${params.id}'`);

    const key = await getFirst<{ machine_id: string; scope: string }>(
      env.DB,
      `SELECT machine_id, scope FROM machine_keys WHERE id = ?`,
      [run.ingest_public_key_id],
    );

    const payloadBytes = new Uint8Array(run.ingest_signed_payload);

    return cachedJson(request, {
      run_id: run.id,
      signature: {
        alg: "Ed25519",
        key_id: run.ingest_public_key_id,
        value: run.ingest_signature,
        signed_at: run.ingest_signed_at,
      },
      signer: key ? { machine_id: key.machine_id, scope: key.scope } : null,
      signed_payload_base64: base64Encode(payloadBytes),
    });
  } catch (err) {
    return errorResponse(err);
  }
};
```

- [ ] **Step 6: Implement `site/src/routes/api/v1/runs/[id]/reproduce.tar.gz/+server.ts`**

```typescript
import type { RequestHandler } from "./$types";
import { getFirst } from "$lib/server/db";
import { ApiError, errorResponse } from "$lib/server/errors";

export const GET: RequestHandler = async ({ params, platform }) => {
  const env = platform!.env;
  try {
    const run = await getFirst<{ reproduction_bundle_r2_key: string | null }>(
      env.DB,
      `SELECT reproduction_bundle_r2_key FROM runs WHERE id = ?`,
      [params.id!],
    );
    if (!run) throw new ApiError(404, "run_not_found", `No run '${params.id}'`);
    if (!run.reproduction_bundle_r2_key) {
      throw new ApiError(
        404,
        "no_bundle",
        `Run '${params.id}' has no reproduction bundle`,
      );
    }

    const obj = await env.R2.get(run.reproduction_bundle_r2_key);
    if (!obj) {
      throw new ApiError(404, "bundle_missing", `Bundle not found in R2`);
    }

    return new Response(obj.body, {
      status: 200,
      headers: {
        "content-type": "application/x-tar",
        "content-disposition": `attachment; filename="${params.id}.tar.zst"`,
        "cache-control": "public, max-age=31536000, immutable",
        "x-api-version": "v1",
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
};
```

- [ ] **Step 7: Update schema** — the `runs` table needs an `ingest_signed_payload BLOB` column.

This was added in Part 2 (`settings_profile`/`run`/`results` batch insert) but if the migration doesn't already include it, add it to `site/migrations/0001_core.sql` in the `runs` table:

```sql
ingest_signed_payload BLOB NOT NULL,
```

Also verify `site/src/lib/shared/base64.ts` exports `base64Encode` (it does from Part 1).

- [ ] **Step 8: Run tests**

Run: `cd site && npm test -- tests/api/runs-read.test.ts`
Expected: 8 tests pass.

- [ ] **Step 9: Commit**

```bash
git add site/src/routes/api/v1/runs/ \
        site/tests/api/runs-read.test.ts \
        site/migrations/0001_core.sql
git commit -m "feat(site): implement GET /runs list + detail + signature + reproduce"
```

---

## Task 24: Transcripts (zstd decompression) `GET /api/v1/transcripts/:key`

**Files:**

- Create: `site/src/routes/api/v1/transcripts/[...key]/+server.ts`
- Create: `site/tests/api/transcripts.test.ts`

- [ ] **Step 1: Install zstd decoder**

Run: `cd site && npm install fzstd`

- [ ] **Step 2: Write failing test** `site/tests/api/transcripts.test.ts`

```typescript
import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { compress } from "fzstd";

beforeEach(async () => {
  // Clear all R2 objects with the transcripts/ prefix
  const list = await env.R2.list({ prefix: "transcripts/" });
  for (const obj of list.objects) await env.R2.delete(obj.key);
});

describe("GET /api/v1/transcripts/:key", () => {
  it("decompresses zstd and returns plain text", async () => {
    const original = "Hello, this is the transcript content.\nLine 2.";
    const bytes = new TextEncoder().encode(original);
    // fzstd does not include a compressor; we'll seed a precompressed blob via Response compression fallback:
    // For test isolation, store the plaintext under a .txt key and .zst variant separately so we cover both paths.
    await env.R2.put("transcripts/abc.txt", bytes);
    const res = await SELF.fetch("https://x/api/v1/transcripts/abc.txt");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect(await res.text()).toBe(original);
  });

  it("returns 404 for unknown key", async () => {
    const res = await SELF.fetch(
      "https://x/api/v1/transcripts/nonexistent.txt.zst",
    );
    expect(res.status).toBe(404);
  });

  it("rejects keys outside the transcripts/ prefix", async () => {
    const res = await SELF.fetch(
      "https://x/api/v1/transcripts/../code/secret.txt",
    );
    expect(res.status).toBe(400);
  });
});
```

**Note:** `fzstd` ships only a decompressor, not a compressor. The test above exercises the uncompressed path (`.txt`). Part 4 Task 32 adds an end-to-end test where a real zstd blob is produced by the ingest CLI. Decompression is exercised through that path.

- [ ] **Step 3: Run to verify failure**

Run: `cd site && npm test -- tests/api/transcripts.test.ts`
Expected: FAIL — route not found.

- [ ] **Step 4: Implement `site/src/routes/api/v1/transcripts/[...key]/+server.ts`**

```typescript
import type { RequestHandler } from "./$types";
import { decompress } from "fzstd";
import { ApiError, errorResponse } from "$lib/server/errors";

export const GET: RequestHandler = async ({ params, platform }) => {
  const env = platform!.env;
  try {
    const key = params.key ?? "";
    // Normalize + scope: must not contain '..' and must start with 'transcripts/' (added here)
    if (key.includes("..") || key.startsWith("/")) {
      throw new ApiError(400, "invalid_key", "Invalid transcript key");
    }
    const objectKey = key.startsWith("transcripts/")
      ? key
      : `transcripts/${key}`;

    const obj = await env.R2.get(objectKey);
    if (!obj) {
      throw new ApiError(
        404,
        "transcript_not_found",
        `No transcript '${objectKey}'`,
      );
    }

    const compressed = objectKey.endsWith(".zst");
    const bytes = new Uint8Array(await obj.arrayBuffer());
    const plain = compressed ? decompress(bytes) : bytes;

    return new Response(plain, {
      status: 200,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "public, max-age=31536000, immutable",
        "x-api-version": "v1",
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
};
```

- [ ] **Step 5: Run tests**

Run: `cd site && npm test -- tests/api/transcripts.test.ts`
Expected: 3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add site/package.json site/package-lock.json \
        site/src/routes/api/v1/transcripts/ \
        site/tests/api/transcripts.test.ts
git commit -m "feat(site): implement GET /api/v1/transcripts/:key (zstd passthrough)"
```

---

## Task 25: Compare + Search

**Files:**

- Create: `site/src/routes/api/v1/compare/+server.ts`
- Create: `site/src/routes/api/v1/search/+server.ts`
- Create: `site/tests/api/compare.test.ts`
- Create: `site/tests/api/search.test.ts`

- [ ] **Step 1: Write failing test** `site/tests/api/compare.test.ts`

```typescript
import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

async function seed(): Promise<void> {
  await env.DB.batch([
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
    env.DB.prepare(
      `INSERT INTO model_families(id,slug,vendor,display_name) VALUES (1,'claude','a','Claude'),(2,'gpt','o','GPT')`,
    ),
    env.DB.prepare(
      `INSERT INTO models(id,family_id,slug,api_model_id,display_name) VALUES (1,1,'sonnet-4.7','c','Sonnet'),(2,2,'gpt-4o','g','GPT-4o')`,
    ),
    env.DB.prepare(
      `INSERT INTO task_sets(hash,version,locked_at,is_current) VALUES ('ts','v1','2026-01-01T00:00:00Z',1)`,
    ),
    env.DB.prepare(
      `INSERT INTO settings_profiles(hash,temperature,max_attempts) VALUES ('s',0,2)`,
    ),
    env.DB.prepare(
      `INSERT INTO cost_snapshots(pricing_version,model_id,input_per_mtoken,output_per_mtoken,effective_from) VALUES ('v1',1,3,15,'2026-01-01'),('v1',2,5,15,'2026-01-01')`,
    ),
    env.DB.prepare(
      `INSERT INTO machine_keys(id,machine_id,public_key,scope,created_at) VALUES (1,'r',X'00','ingest','2026-01-01T00:00:00Z')`,
    ),
    env.DB.prepare(
      `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,completed_at,status,tier,pricing_version,ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload) VALUES ('r1','ts',1,'s','r','2026-04-01T00:00:00Z','2026-04-01T01:00:00Z','completed','claimed','v1','s','2026-04-01T00:00:00Z',1,X'7B7D'),('r2','ts',2,'s','r','2026-04-02T00:00:00Z','2026-04-02T01:00:00Z','completed','claimed','v1','s','2026-04-02T00:00:00Z',1,X'7B7D')`,
    ),
    env.DB.prepare(
      `INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success) VALUES ('r1','easy/a',1,1,1.0,1),('r1','hard/b',1,0,0.0,1),('r2','easy/a',1,0,0.0,1),('r2','hard/b',1,1,1.0,1)`,
    ),
  ]);
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
beforeEach(async () => {
  await seed();
});

describe("GET /api/v1/compare", () => {
  it("returns side-by-side task-level comparison", async () => {
    const res = await SELF.fetch(
      "https://x/api/v1/compare?models=sonnet-4.7,gpt-4o",
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { models: Array<any>; tasks: Array<any> };
    expect(body.models).toHaveLength(2);
    const taskA = body.tasks.find((t: any) => t.task_id === "easy/a");
    expect(taskA.scores["sonnet-4.7"]).toBe(1.0);
    expect(taskA.scores["gpt-4o"]).toBe(0.0);
    expect(taskA.divergent).toBe(true);
  });

  it("rejects < 2 models", async () => {
    const res = await SELF.fetch("https://x/api/v1/compare?models=sonnet-4.7");
    expect(res.status).toBe(400);
  });

  it("rejects > 4 models", async () => {
    const res = await SELF.fetch("https://x/api/v1/compare?models=a,b,c,d,e");
    expect(res.status).toBe(400);
  });

  it("rejects unknown model", async () => {
    const res = await SELF.fetch(
      "https://x/api/v1/compare?models=sonnet-4.7,nonexistent",
    );
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Write failing test** `site/tests/api/search.test.ts`

```typescript
import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await env.DB.batch([
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
    env.DB.prepare(
      `INSERT INTO model_families(id,slug,vendor,display_name) VALUES (1,'claude','a','Claude')`,
    ),
    env.DB.prepare(
      `INSERT INTO models(id,family_id,slug,api_model_id,display_name) VALUES (1,1,'sonnet-4.7','c','Sonnet')`,
    ),
    env.DB.prepare(
      `INSERT INTO task_sets(hash,version,locked_at,is_current) VALUES ('ts','v1','2026-01-01T00:00:00Z',1)`,
    ),
    env.DB.prepare(
      `INSERT INTO settings_profiles(hash,temperature,max_attempts) VALUES ('s',0,2)`,
    ),
    env.DB.prepare(
      `INSERT INTO cost_snapshots(pricing_version,model_id,input_per_mtoken,output_per_mtoken,effective_from) VALUES ('v1',1,3,15,'2026-01-01')`,
    ),
    env.DB.prepare(
      `INSERT INTO machine_keys(id,machine_id,public_key,scope,created_at) VALUES (1,'r',X'00','ingest','2026-01-01T00:00:00Z')`,
    ),
    env.DB.prepare(
      `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,completed_at,status,tier,pricing_version,ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload) VALUES ('r1','ts',1,'s','r','2026-04-01T00:00:00Z','2026-04-01T01:00:00Z','completed','claimed','v1','s','2026-04-01T00:00:00Z',1,X'7B7D')`,
    ),
    env.DB.prepare(
      `INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success,compile_errors_json,failure_reasons_json) VALUES ('r1','easy/a',1,0,0,0,'[{"code":"AL0132","message":"identifier not found","file":"f.al","line":1,"column":1}]','["session token invalid"]')`,
    ),
  ]);
});

describe("GET /api/v1/search", () => {
  it("finds by error code", async () => {
    const res = await SELF.fetch("https://x/api/v1/search?q=AL0132");
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<any> };
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data[0].task_id).toBe("easy/a");
  });

  it("finds by failure reason phrase", async () => {
    const res = await SELF.fetch("https://x/api/v1/search?q=session+token");
    const body = await res.json() as { data: Array<any> };
    expect(body.data.length).toBeGreaterThan(0);
  });

  it("rejects empty query", async () => {
    const res = await SELF.fetch("https://x/api/v1/search?q=");
    expect(res.status).toBe(400);
  });

  it("rejects overlong query", async () => {
    const res = await SELF.fetch(
      `https://x/api/v1/search?q=${"a".repeat(300)}`,
    );
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `cd site && npm test -- tests/api/compare.test.ts tests/api/search.test.ts`
Expected: FAIL — routes not found.

- [ ] **Step 4: Implement `site/src/routes/api/v1/compare/+server.ts`**

```typescript
import type { RequestHandler } from "./$types";
import { cachedJson } from "$lib/server/cache";
import { getAll } from "$lib/server/db";
import { ApiError, errorResponse } from "$lib/server/errors";

export const GET: RequestHandler = async ({ request, url, platform }) => {
  const env = platform!.env;
  try {
    const raw = (url.searchParams.get("models") ?? "").split(",").map((s) =>
      s.trim()
    ).filter(Boolean);
    if (raw.length < 2) {
      throw new ApiError(400, "too_few_models", "At least 2 models required");
    }
    if (raw.length > 4) {
      throw new ApiError(400, "too_many_models", "At most 4 models allowed");
    }

    const placeholders = raw.map(() => "?").join(",");
    const models = await getAll<
      { id: number; slug: string; display_name: string }
    >(
      env.DB,
      `SELECT id, slug, display_name FROM models WHERE slug IN (${placeholders})`,
      raw,
    );
    if (models.length !== raw.length) {
      throw new ApiError(
        404,
        "model_not_found",
        `Unknown model(s): ${
          raw.filter((s) => !models.some((m) => m.slug === s)).join(",")
        }`,
      );
    }

    const rows = await getAll<{
      task_id: string;
      model_slug: string;
      avg_score: number;
      runs: number;
    }>(
      env.DB,
      `SELECT r.task_id, m.slug AS model_slug, AVG(r.score) AS avg_score, COUNT(DISTINCT runs.id) AS runs
       FROM results r
       JOIN runs ON runs.id = r.run_id
       JOIN models m ON m.id = runs.model_id
       WHERE m.slug IN (${placeholders})
       GROUP BY r.task_id, m.id
       ORDER BY r.task_id, m.id`,
      raw,
    );

    const byTask = new Map<string, Record<string, number>>();
    for (const r of rows) {
      if (!byTask.has(r.task_id)) byTask.set(r.task_id, {});
      byTask.get(r.task_id)![r.model_slug] = Number(r.avg_score.toFixed(6));
    }

    const tasks = Array.from(byTask.entries()).map(([task_id, scores]) => {
      const values = Object.values(scores);
      const divergent = values.length > 1 &&
        Math.max(...values) - Math.min(...values) > 0.01;
      return { task_id, scores, divergent };
    });

    return cachedJson(request, { models, tasks });
  } catch (err) {
    return errorResponse(err);
  }
};
```

- [ ] **Step 5: Implement `site/src/routes/api/v1/search/+server.ts`**

```typescript
import type { RequestHandler } from "./$types";
import { cachedJson } from "$lib/server/cache";
import { getAll } from "$lib/server/db";
import { ApiError, errorResponse } from "$lib/server/errors";

export const GET: RequestHandler = async ({ request, url, platform }) => {
  const env = platform!.env;
  try {
    const q = (url.searchParams.get("q") ?? "").trim();
    if (!q) throw new ApiError(400, "missing_query", "q is required");
    if (q.length > 200) {
      throw new ApiError(400, "query_too_long", "q must be ≤ 200 chars");
    }

    // FTS5 MATCH is sensitive to quotes; we wrap the query as a phrase when multi-word
    // to treat spaces as AND without the user needing MATCH syntax.
    const matchExpr = q.includes(" ")
      ? q.split(/\s+/).map((t) => `"${t.replace(/"/g, "")}"`).join(" ")
      : q;

    const rows = await getAll<{
      result_id: number;
      run_id: string;
      task_id: string;
      model_slug: string;
      compile_errors_text: string;
      failure_reasons_text: string;
      started_at: string;
      snippet: string;
    }>(
      env.DB,
      `SELECT r.id AS result_id, r.run_id, r.task_id,
              m.slug AS model_slug,
              fts.compile_errors_text, fts.failure_reasons_text,
              runs.started_at,
              snippet(results_fts, -1, '<mark>', '</mark>', '…', 12) AS snippet
       FROM results_fts fts
       JOIN results r ON r.id = fts.rowid
       JOIN runs ON runs.id = r.run_id
       JOIN models m ON m.id = runs.model_id
       WHERE results_fts MATCH ?
       ORDER BY runs.started_at DESC
       LIMIT 100`,
      [matchExpr],
    );

    return cachedJson(request, {
      query: q,
      data: rows,
    });
  } catch (err) {
    return errorResponse(err);
  }
};
```

- [ ] **Step 6: Run tests**

Run: `cd site && npm test -- tests/api/compare.test.ts tests/api/search.test.ts`
Expected: 8 tests pass.

- [ ] **Step 7: Commit**

```bash
git add site/src/routes/api/v1/compare/ site/src/routes/api/v1/search/ \
        site/tests/api/compare.test.ts site/tests/api/search.test.ts
git commit -m "feat(site): implement GET /api/v1/compare and /api/v1/search"
```

---

## Task 26: Sync health `GET /api/v1/sync/health`

Reports per-machine last-seen timestamp, lag from "now", and recent ingest event counts (24h). Used by the scoreboard's operator dashboard.

**Files:**

- Create: `site/src/routes/api/v1/sync/health/+server.ts`
- Create: `site/tests/api/sync-health.test.ts`

- [ ] **Step 1: Write failing test** `site/tests/api/sync-health.test.ts`

```typescript
import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM ingest_events`),
    env.DB.prepare(`DELETE FROM machine_keys`),
  ]);
  const now = new Date();
  const hr = (h: number) =>
    new Date(now.getTime() - h * 3_600_000).toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO machine_keys(id,machine_id,public_key,scope,created_at,last_used_at) VALUES (1,'rig-a',X'00','ingest','2026-01-01T00:00:00Z',?),(2,'rig-b',X'00','ingest','2026-01-01T00:00:00Z',?)`,
    ).bind(hr(1), hr(48)),
    env.DB.prepare(
      `INSERT INTO ingest_events(event,machine_id,ts,details_json) VALUES ('signature_verified','rig-a',?, '{}')`,
    ).bind(hr(1)),
    env.DB.prepare(
      `INSERT INTO ingest_events(event,machine_id,ts,details_json) VALUES ('rejected','rig-a',?, '{}')`,
    ).bind(hr(2)),
    env.DB.prepare(
      `INSERT INTO ingest_events(event,machine_id,ts,details_json) VALUES ('signature_verified','rig-b',?, '{}')`,
    ).bind(hr(48)),
  ]);
});

describe("GET /api/v1/sync/health", () => {
  it("returns per-machine lag + 24h counters", async () => {
    const res = await SELF.fetch("https://x/api/v1/sync/health");
    expect(res.status).toBe(200);
    const body = await res.json() as { machines: Array<any>; overall: any };
    expect(body.machines).toHaveLength(2);
    const a = body.machines.find((m: any) => m.machine_id === "rig-a");
    const b = body.machines.find((m: any) => m.machine_id === "rig-b");
    expect(a.lag_seconds).toBeLessThan(7200); // last used 1h ago
    expect(b.lag_seconds).toBeGreaterThan(86400); // 48h ago
    expect(a.status).toBe("healthy");
    expect(b.status).toBe("stale");
    expect(a.verified_24h).toBe(1);
    expect(a.rejected_24h).toBe(1);
    expect(b.verified_24h).toBe(0);

    expect(body.overall.total_machines).toBe(2);
    expect(body.overall.healthy).toBe(1);
    expect(body.overall.stale).toBe(1);
  });

  it("uses no-cache headers (operator-facing)", async () => {
    const res = await SELF.fetch("https://x/api/v1/sync/health");
    expect(res.headers.get("cache-control")).toContain("no-store");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd site && npm test -- tests/api/sync-health.test.ts`
Expected: FAIL — route not found.

- [ ] **Step 3: Implement `site/src/routes/api/v1/sync/health/+server.ts`**

```typescript
import type { RequestHandler } from "./$types";
import { cachedJson } from "$lib/server/cache";
import { getAll } from "$lib/server/db";
import { errorResponse } from "$lib/server/errors";

const STALE_SECONDS = 24 * 3600;

export const GET: RequestHandler = async ({ request, platform }) => {
  const env = platform!.env;
  try {
    const now = Date.now();
    const since24h = new Date(now - 24 * 3600 * 1000).toISOString();

    const rows = await getAll<{
      machine_id: string;
      last_used_at: string | null;
      revoked_at: string | null;
      verified_24h: number;
      rejected_24h: number;
    }>(
      env.DB,
      `SELECT k.machine_id,
              MAX(k.last_used_at) AS last_used_at,
              MAX(k.revoked_at) AS revoked_at,
              (SELECT COUNT(*) FROM ingest_events e
                 WHERE e.machine_id = k.machine_id
                   AND e.event = 'signature_verified'
                   AND e.ts >= ?) AS verified_24h,
              (SELECT COUNT(*) FROM ingest_events e
                 WHERE e.machine_id = k.machine_id
                   AND e.event = 'rejected'
                   AND e.ts >= ?) AS rejected_24h
       FROM machine_keys k
       GROUP BY k.machine_id`,
      [since24h, since24h],
    );

    const machines = rows.map((r) => {
      const lagMs = r.last_used_at
        ? now - Date.parse(r.last_used_at)
        : Number.POSITIVE_INFINITY;
      const lagSeconds = Number.isFinite(lagMs)
        ? Math.floor(lagMs / 1000)
        : null;
      const status = r.revoked_at
        ? "revoked"
        : !r.last_used_at
        ? "never_used"
        : lagSeconds! > STALE_SECONDS
        ? "stale"
        : "healthy";
      return {
        machine_id: r.machine_id,
        last_used_at: r.last_used_at,
        lag_seconds: lagSeconds,
        status,
        verified_24h: r.verified_24h,
        rejected_24h: r.rejected_24h,
      };
    });

    const overall = {
      total_machines: machines.length,
      healthy: machines.filter((m) => m.status === "healthy").length,
      stale: machines.filter((m) => m.status === "stale").length,
      revoked: machines.filter((m) => m.status === "revoked").length,
      never_used: machines.filter((m) => m.status === "never_used").length,
      generated_at: new Date(now).toISOString(),
    };

    return cachedJson(request, { machines, overall }, {
      cacheControl: "no-store",
    });
  } catch (err) {
    return errorResponse(err);
  }
};
```

- [ ] **Step 4: Run tests**

Run: `cd site && npm test -- tests/api/sync-health.test.ts`
Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add site/src/routes/api/v1/sync/ site/tests/api/sync-health.test.ts
git commit -m "feat(site): implement GET /api/v1/sync/health"
```

---

## End of Part 3

The full public read surface is now live end-to-end:

1. `GET /api/v1/leaderboard` — current and historical leaderboard, KV-cached
2. `GET /api/v1/families` + `GET /api/v1/families/:slug` — family trajectory
3. `GET /api/v1/models` + `GET /api/v1/models/:slug` + `/limitations` — model detail and shortcomings (JSON + markdown)
4. `GET /api/v1/tasks` + `GET /api/v1/tasks/:id` — task list + solved-by matrix
5. `GET /api/v1/runs` + `GET /api/v1/runs/:id` + `/signature` + `/reproduce.tar.gz` — run detail + independent re-verification + reproduction download
6. `GET /api/v1/transcripts/:key` — zstd passthrough
7. `GET /api/v1/compare` — side-by-side 2–4 models
8. `GET /api/v1/search` — FTS over compile errors + failure reasons
9. `GET /api/v1/sync/health` — per-machine lag dashboard

Every read response carries an ETag and Cache-Control header. Every endpoint has an integration test against miniflare.

**Success check for Part 3:**

Run: `cd site && npm test`
Expected: all Part 1 + Part 2 tests + ~40 new tests across Tasks 18–26 pass.

Continue with **Part 4** (`2026-04-17-p1-schema-and-api-skeleton-part4.md`) for admin endpoints, Durable Object SSE broadcaster, reproduction bundle indexing, machine key bootstrap, and the end-to-end integration test that ingests a signed run and verifies it reads back correctly through every endpoint.
