# Combined-Mode Leaderboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rank batch-mode and sync-mode models on one leaderboard (`mode=combined`), each model on the one mode it has most runs in, with a mode badge on minority rows.

**Architecture:** `modePredicate(alias, mode)` gains a combined form that still consumes exactly one `?` and still binds the plain `mode` string, so no call site changes its bind values or order. In combined mode the predicate resolves each row's mode with a correlated subquery over that model's non-excluded runs in the row's own task set. `resolveInvocationMode` returns `combined` for a mixed set instead of throwing `mode_required`. Rows gain `served_mode`; the UI adds a third mode option and a minority-mode pill.

**Tech Stack:** SvelteKit on Cloudflare Workers, D1 (SQLite), vitest with `@cloudflare/vitest-pool-workers` (main config) and jsdom (unit config).

**Spec:** `docs/superpowers/specs/2026-09-30-combined-mode-leaderboard-design.md`

## Deviation from the spec (flagged for review)

The spec binds a per-request JSON map (`resolveModeBinding` + `json_extract`). This
plan keeps the spec's decisions C1 to C7 and its "one `?`, same position" property,
but computes the served mode inline instead:

```sql
<alias>.invocation_mode = COALESCE(NULLIF(?, 'combined'),
  (SELECT CASE WHEN SUM(sm.invocation_mode = 'batch') >= SUM(sm.invocation_mode = 'sync')
               THEN 'batch' ELSE 'sync' END
     FROM runs sm
    WHERE sm.model_id = <alias>.model_id
      AND sm.task_set_hash = <alias>.task_set_hash
      AND sm.excluded_at IS NULL))
```

The bound value stays `mode` (`'combined'`), so there is no `resolveModeBinding`,
no map query, and no JS lookup. Also, `upstream-profile.ts:45` is on the ingest
path (profile claims), not ranking, so it is out of scope. The survey found five
more hand-written predicates the spec missed, all in `routes/api/v1/compare/+server.ts`.
Task 6 updates the spec to match.

## Global Constraints

- No D1 migration. Worker-only change.
- `CACHE_VERSION` goes from `"v16"` to `"v17"` (`site/src/lib/server/cache-version.ts:58`).
- Explicit `?mode=sync` and `?mode=batch` keep byte-identical SQL: `modePredicate` returns `<alias>.invocation_mode = ?` for them.
- `mode=all` stays `400 invalid_mode_for_metric`; any other unknown value stays `400 invalid_mode`.
- Served mode rule: more non-excluded runs in the task set wins; a tie goes to `batch`. Never narrowed by category, tier, since or other filters.
- Do NOT run `deno fmt` on `site/` (prettier owns it). No em dash characters in any text.
- Worker route tests run against the built bundle: run `npm run build` before `npx vitest run tests/api/...`. Tests under `tests/server/` import `src/` directly but also run in the workers pool.
- All commands run from `U:\Git\CentralGauge\site` unless stated.
- Work on branch `feat/combined-mode` (create from local `master`).

## Review Focus

1. A mode predicate written by hand (`invocation_mode = ?` in SQL text) that bypasses `modePredicate` silently scopes one query to the literal `'combined'`, matching nothing. Task 2 adds a guard test that scans the ranking sources.
2. A model whose runs are ALL excluded must not appear, and must not break the CASE (SUM over zero rows is NULL). Task 1 tests it.
3. A tie (equal batch and sync counts) must serve `batch`, including 0 sync vs 0 batch after exclusion. Task 1 tests it.
4. A `since` filter that removes all of a model's majority-mode runs must NOT flip the model to its other mode. Task 3 tests it.
5. `mode=sync` / `mode=batch` responses must not change. Task 3 compares them against the pre-change expectations in the existing tests, which stay untouched.

---

### Task 1: Combined mode in `invocation-mode.ts`

**Files:**
- Modify: `site/src/lib/server/invocation-mode.ts` (whole file, 104 lines)
- Modify: `site/src/lib/shared/api-types.ts:25-32`
- Test: `site/tests/server/invocation-mode.test.ts`

**Interfaces:**
- Produces:
  - `export type RankMode = InvocationMode | "combined"` (server module) and the same type exported from `api-types.ts`.
  - `parseModeParam(url: URL): RankMode | null`
  - `resolveInvocationMode(db: D1Database, scope: SetScope, requested: RankMode | null): Promise<RankMode>`
  - `modePredicate(alias: string, mode: RankMode): string` (NEW second parameter; one `?`)
  - `servedModeSql(alias: string): string` (scalar subquery, binds nothing)
  - `servedModes(db: D1Database, scope: SetScope): Promise<Map<number, InvocationMode>>`

- [ ] **Step 1: Write the failing tests**

Replace the `describe("parseModeParam", ...)` and `describe("resolveInvocationMode", ...)` blocks in `tests/server/invocation-mode.test.ts` and add the new blocks. Update the import at the top:

```ts
import {
  modePredicate,
  parseModeParam,
  resolveInvocationMode,
  servedModes,
} from "../../src/lib/server/invocation-mode";
```

Add a seeding helper next to `seedRuns` that seeds several models:

```ts
async function seedModelRuns(
  runs: Array<{ model: number; mode: string; excluded?: boolean }>,
): Promise<void> {
  const modelIds = [...new Set(runs.map((r) => r.model))];
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO model_families(id,slug,vendor,display_name) VALUES (1,'f','v','F')`,
    ),
    ...modelIds.map((id) =>
      env.DB.prepare(
        `INSERT INTO models(id,family_id,slug,api_model_id,display_name) VALUES (?,1,?,?,?)`,
      ).bind(id, `m${id}`, `m${id}`, `M${id}`),
    ),
    env.DB.prepare(
      `INSERT INTO task_sets(hash,created_at,task_count,is_current) VALUES ('ts','2026-01-01T00:00:00Z',1,1)`,
    ),
    env.DB.prepare(`INSERT INTO settings_profiles(hash) VALUES ('s')`),
    env.DB.prepare(
      `INSERT INTO machine_keys(id,machine_id,public_key,scope,created_at) VALUES (1,'rig',?,'ingest','2026-01-01T00:00:00Z')`,
    ).bind(new Uint8Array([0])),
    ...runs.map((r, i) =>
      env.DB.prepare(
        `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,status,tier,pricing_version,ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload,invocation_mode,excluded_at) VALUES (?,'ts',?,'s','rig','2026-01-01T00:00:00Z','completed','claimed','v','sig','2026-01-01T00:00:00Z',1,'{}',?,?)`,
      ).bind(`r${i}`, r.model, r.mode, r.excluded ? "2026-01-02T00:00:00Z" : null),
    ),
  ]);
}
```

Tests:

```ts
describe("parseModeParam", () => {
  it("accepts sync, batch, combined and absent; refuses all and junk", () => {
    expect(parseModeParam(new URL("https://x/?mode=sync"))).toBe("sync");
    expect(parseModeParam(new URL("https://x/?mode=batch"))).toBe("batch");
    expect(parseModeParam(new URL("https://x/?mode=combined"))).toBe("combined");
    expect(parseModeParam(new URL("https://x/"))).toBeNull();
    expect(() => parseModeParam(new URL("https://x/?mode=all"))).toThrowError(
      expect.objectContaining({ code: "invalid_mode_for_metric" }),
    );
    expect(() => parseModeParam(new URL("https://x/?mode=turbo"))).toThrowError(
      expect.objectContaining({ code: "invalid_mode" }),
    );
  });
});

describe("resolveInvocationMode", () => {
  it("defaults to the only mode present, sync when empty, and combined when both exist", async () => {
    expect(await resolveInvocationMode(env.DB, { kind: "current" }, null)).toBe("sync");
    await seedRuns(["batch"]);
    expect(await resolveInvocationMode(env.DB, { kind: "current" }, null)).toBe("batch");
    expect(await resolveInvocationMode(env.DB, { kind: "hash", hash: "ts" }, null)).toBe("batch");
    expect(await resolveInvocationMode(env.DB, { kind: "current" }, "sync")).toBe("sync");
    await resetDb();
    await seedRuns(["sync", "batch"]);
    expect(await resolveInvocationMode(env.DB, { kind: "current" }, null)).toBe("combined");
    expect(await resolveInvocationMode(env.DB, { kind: "current" }, "batch")).toBe("batch");
  });
});

describe("modePredicate", () => {
  it("keeps the single-mode SQL exactly and adds one-bind combined SQL", () => {
    expect(modePredicate("runs", "sync")).toBe("runs.invocation_mode = ?");
    expect(modePredicate("ru1", "batch")).toBe("ru1.invocation_mode = ?");
    const combined = modePredicate("ru2", "combined");
    expect(combined.split("?").length - 1).toBe(1);
    expect(combined).toContain("NULLIF(?, 'combined')");
    expect(combined).toContain("sm.model_id = ru2.model_id");
    expect(() => modePredicate("x; DROP", "sync")).toThrow();
    expect(() => modePredicate("sm", "combined")).toThrow();
  });

  it("combined selects each model's majority mode, tie to batch, excluded runs ignored", async () => {
    await seedModelRuns([
      { model: 1, mode: "batch" },                 // batch only
      { model: 2, mode: "sync" },                  // sync only
      { model: 3, mode: "batch" },                 // 1 batch vs 2 sync: sync
      { model: 3, mode: "sync" },
      { model: 3, mode: "sync" },
      { model: 4, mode: "batch" },                 // tie: batch
      { model: 4, mode: "sync" },
      { model: 5, mode: "batch" },                 // 2 sync excluded: batch
      { model: 5, mode: "sync", excluded: true },
      { model: 5, mode: "sync", excluded: true },
      { model: 6, mode: "sync", excluded: true },  // all excluded: no row
    ]);
    const rs = await env.DB.prepare(
      `SELECT runs.model_id AS model_id, runs.invocation_mode AS mode
         FROM runs
        WHERE ${modePredicate("runs", "combined")} AND runs.excluded_at IS NULL
        ORDER BY runs.model_id, runs.id`,
    ).bind("combined").all<{ model_id: number; mode: string }>();
    const got = (rs.results ?? []).map((r) => `${r.model_id}:${r.mode}`);
    expect(got).toEqual(["1:batch", "2:sync", "3:sync", "3:sync", "4:batch", "5:batch"]);

    const served = await servedModes(env.DB, { kind: "current" });
    expect(Object.fromEntries(served)).toEqual({
      1: "batch", 2: "sync", 3: "sync", 4: "batch", 5: "batch",
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/server/invocation-mode.test.ts`
Expected: FAIL (`servedModes` is not exported; `parseModeParam("combined")` throws `invalid_mode`).

- [ ] **Step 3: Implement**

In `src/lib/shared/api-types.ts`, directly after `export type InvocationMode = "sync" | "batch";` add:

```ts
/**
 * What a ranking query selects: one invocation mode, or `combined`, where
 * each model is ranked on the mode it has most non-excluded runs in within
 * the task set (tie to batch). See
 * docs/superpowers/specs/2026-09-30-combined-mode-leaderboard-design.md.
 * Keep in sync with `RankMode` in `$lib/server/invocation-mode`.
 */
export type RankMode = InvocationMode | "combined";
```

In `src/lib/server/invocation-mode.ts`:

1. Replace the header comment's second paragraph ("`sync` and `batch` invocations are distinct ... see `resolveInvocationMode`.") with:

```ts
 * `sync` and `batch` invocations are distinct profiles and are never pooled
 * within one model. A ranking query selects `sync`, `batch`, or `combined`
 * (each model on its own majority mode, amended D4:
 * docs/superpowers/specs/2026-09-30-combined-mode-leaderboard-design.md).
 * `mode=all` is refused outright.
```

2. After `export type InvocationMode = "sync" | "batch";` add `export type RankMode = InvocationMode | "combined";`

3. In `parseModeParam`, change the return type to `RankMode | null` and the accept line to:

```ts
  if (raw === "sync" || raw === "batch" || raw === "combined") return raw;
```

and the final throw message to `"mode must be sync, batch or combined"`. Update its doc comment bullet to list `"combined"`.

4. `resolveInvocationMode`: change `requested: InvocationMode | null` to `requested: RankMode | null`, the return type to `Promise<RankMode>`, and replace the final `throw new ApiError(...)` with `return "combined";`. Update its doc comment: "both present resolves to `combined`".

5. Replace `modePredicate` and add the two helpers:

```ts
/**
 * The served mode of the model owning the `<alias>` row, as a scalar
 * subquery: the mode with more non-excluded runs in that row's task set,
 * `batch` on a tie. Whole-set by construction (it reads `runs` directly), so
 * no caller filter can flip it. Binds nothing.
 */
export function servedModeSql(alias: string): string {
  assertSqlAlias(alias);
  if (alias === "sm") throw new Error("alias 'sm' is reserved by servedModeSql");
  return `(SELECT CASE WHEN SUM(sm.invocation_mode = 'batch') >= SUM(sm.invocation_mode = 'sync')
                    THEN 'batch' ELSE 'sync' END
             FROM runs sm
            WHERE sm.model_id = ${alias}.model_id
              AND sm.task_set_hash = ${alias}.task_set_hash
              AND sm.excluded_at IS NULL)`;
}

/**
 * The mode predicate for `<alias>`, which must expose `model_id` and
 * `task_set_hash`. Always exactly one `?`, bound to the mode string itself:
 * single modes keep the original `= ?` form; `combined` binds `'combined'`,
 * which NULLIF turns into NULL so COALESCE falls through to the row's
 * served mode.
 */
export function modePredicate(alias: string, mode: RankMode): string {
  assertSqlAlias(alias);
  if (mode !== "combined") return `${alias}.invocation_mode = ?`;
  return `${alias}.invocation_mode = COALESCE(NULLIF(?, 'combined'), ${servedModeSql(alias)})`;
}

/** Served mode per model over the scope's non-excluded runs (same rule as servedModeSql). */
export async function servedModes(
  db: D1Database,
  scope: SetScope,
): Promise<Map<number, InvocationMode>> {
  const where =
    scope.kind === "current"
      ? `task_set_hash IN (SELECT hash FROM task_sets WHERE is_current = 1)`
      : `task_set_hash = ?`;
  const stmt = db.prepare(
    `SELECT model_id,
            CASE WHEN SUM(invocation_mode = 'batch') >= SUM(invocation_mode = 'sync')
                 THEN 'batch' ELSE 'sync' END AS mode
       FROM runs
      WHERE ${where} AND excluded_at IS NULL
      GROUP BY model_id`,
  );
  const rs = await (scope.kind === "current" ? stmt : stmt.bind(scope.hash))
    .all<{ model_id: number; mode: InvocationMode }>();
  return new Map((rs.results ?? []).map((r) => [Number(r.model_id), r.mode]));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/server/invocation-mode.test.ts`
Expected: PASS. `npm run check` now fails at every one-argument `modePredicate(alias)` call site. That is expected: Task 2 fixes them.

- [ ] **Step 5: Do not commit yet**

Tasks 1 and 2 land as one commit (Task 2 Step 5), so no commit ever holds a type-broken tree. Hand the Task 1 files to Task 2 uncommitted.

---

### Task 2: Route every ranking predicate through `modePredicate(alias, mode)`

**Files:**
- Modify: `site/src/lib/server/leaderboard.ts:159, 234, 554, 601, 645-650`
- Modify: `site/src/lib/server/model-aggregates.ts:152, 252, 260, 348, 387, 660`
- Modify: `site/src/lib/server/matrix.ts:42, 171, 211, 286`
- Modify: `site/src/lib/server/tier-data.ts:11, 24, 102`
- Modify: `site/src/lib/server/models.ts:14, 49`
- Modify: `site/src/routes/api/v1/compare/+server.ts:129, 141, 159, 214, 223`
- Modify: `site/src/routes/api/v1/families/[slug]/+server.ts:134, 152, 198`
- Modify: `site/src/lib/shared/api-types.ts:43, 776, 918, 1110` (`mode: InvocationMode` to `mode: RankMode` in `LeaderboardQuery`, `FamilyDetail.filters`, `CompareFilters`, `MatrixFilters`)
- Modify: `site/src/routes/api/v1/leaderboard/+server.ts:16, 304` (`InvocationMode` to `RankMode`)
- Create: `site/src/lib/server/mode-predicate-guard.test.ts` (jsdom unit config picks up `src/**/*.test.ts`)

**Interfaces:**
- Consumes: `modePredicate(alias, mode: RankMode)`, `RankMode` from Task 1.
- Produces: every ranking query honours `combined`. Function option types `mode: RankMode` in `model-aggregates.ts`, `matrix.ts`, `tier-data.ts`, `models.ts`.

- [ ] **Step 1: Write the failing guard test**

`src/lib/server/mode-predicate-guard.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Every ranking query must build its mode predicate through
// modePredicate(alias, mode). A hand-written `invocation_mode = ?` would bind
// the literal 'combined' in combined mode and silently match nothing.
const RANKING_FILES = [
  "src/lib/server/leaderboard.ts",
  "src/lib/server/model-aggregates.ts",
  "src/lib/server/matrix.ts",
  "src/lib/server/tier-data.ts",
  "src/lib/server/models.ts",
  "src/routes/api/v1/compare/+server.ts",
  "src/routes/api/v1/families/[slug]/+server.ts",
];

describe("mode predicate guard", () => {
  it.each(RANKING_FILES)("%s has no hand-written invocation_mode predicate", (file) => {
    const src = readFileSync(file, "utf8");
    expect(src).not.toMatch(/invocation_mode\s*=\s*\?/);
  });

  it.each(RANKING_FILES)("%s passes a mode to every modePredicate call", (file) => {
    const src = readFileSync(file, "utf8");
    expect(src).not.toMatch(/modePredicate\(\s*["'`][A-Za-z_0-9]+["'`]\s*\)/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run --config vitest.unit.config.ts src/lib/server/mode-predicate-guard.test.ts`
Expected: FAIL on matrix.ts, tier-data.ts, compare, leaderboard.ts (upstream_profiles query) and the one-argument calls.

- [ ] **Step 3: Implement**

Mechanical rules, applied at each listed line:

- `modePredicate("X")` becomes `modePredicate("X", <mode in scope>)`: `q.mode` in `leaderboard.ts`, `opts.mode` in `model-aggregates.ts`, `mode` in the families route. Leave every `params.push(...)` / `bind.push(...)` of the mode value exactly as it is.
- A hand-written `AND <alias>.invocation_mode = ?` becomes `AND ${modePredicate("<alias>", <mode>)}`, keeping its bind unchanged:
  - `matrix.ts:171` and `:286`: `AND ${modePredicate("runs", opts.mode)}`
  - `matrix.ts:211` (query is `FROM runs` with unqualified columns): `AND ${modePredicate("runs", opts.mode)}`
  - `tier-data.ts:102`: `AND ${modePredicate("ru", opts.mode)}` (import `modePredicate` beside the type import at line 11)
  - `compare/+server.ts:129`: `AND ${modePredicate("ru1", mode)}`; `:141`: `AND ${modePredicate("ru2", mode)}`; `:159`, `:214`, `:223`: `AND ${modePredicate("runs", mode)}` (import `modePredicate` in the existing import from `$lib/server/invocation-mode`)
  - `leaderboard.ts:647` (`upstream_profiles`, which has `model_id` and `task_set_hash`): change `AND invocation_mode = ?` to `AND ${modePredicate("upstream_profiles", q.mode)}`. In combined mode each model reads the profile of its served mode.
- Type widening: every `mode: InvocationMode` option or parameter in the files listed above becomes `mode: RankMode`, importing `RankMode` from `./invocation-mode` (server) or `../shared/api-types` (models.ts). `ParsedLeaderboardQuery.mode` becomes `RankMode | null`.
- Update the D4 comment at `leaderboard.ts:156-158` to: "D4 (amended 2026-09-30): every ranking query selects one mode or `combined` (each model on its majority mode). `modePredicate` keeps one `?` either way, so the bind below is unchanged."

- [ ] **Step 4: Run guard, type check and the existing mode suites**

Run:
```bash
npx vitest run --config vitest.unit.config.ts src/lib/server/mode-predicate-guard.test.ts
npm run check
npm run build
npx vitest run tests/server/invocation-mode.test.ts tests/api/matrix.test.ts tests/api/compare.test.ts tests/api/families-mode.test.ts tests/api/leaderboard.test.ts
```
Expected: guard PASS; `npm run check` 0 errors; the existing suites PASS except assertions that expect `mode_required` (those are inverted in Task 4). Note which ones fail and confirm each is a `mode_required` assertion listed in Task 4.

- [ ] **Step 5: Commit Tasks 1 and 2 together**

```bash
git add src/lib/server src/lib/shared/api-types.ts src/routes/api/v1/compare/+server.ts "src/routes/api/v1/families/[slug]/+server.ts" src/routes/api/v1/leaderboard/+server.ts tests/server/invocation-mode.test.ts
git commit -m "feat(site): combined rank mode; every ranking predicate goes through modePredicate"
```

---

### Task 3: Leaderboard `served_mode`, combined behaviour tests, cache v17

**Files:**
- Modify: `site/src/lib/shared/api-types.ts` (`LeaderboardRow`, line 85 onward)
- Modify: `site/src/lib/server/leaderboard.ts` (row assembly, near where `fallback_count` is set from `fallbackByModel`)
- Modify: `site/src/lib/server/cache-version.ts:58` and its header comment
- Test: `site/tests/api/leaderboard-combined.test.ts` (new)

**Interfaces:**
- Consumes: `servedModes(db, scope)` (Task 1), combined predicates (Task 2).
- Produces: `LeaderboardRow.served_mode: InvocationMode`.

- [ ] **Step 1: Write the failing test**

`tests/api/leaderboard-combined.test.ts`. Fixture: task set `ts` with tasks `t1`, `t2` (denominator 2). Models:
- A (id 1): 1 batch run, passes t1 on attempt 1.
- C (id 2): 1 sync run, passes t1 and t2 on attempt 1.
- D (id 3): 1 batch run passing t1 only; 2 sync runs (one started `2026-01-01`, one `2026-03-01`) each passing t1 and t2. Served: sync.
- E (id 4): 1 batch run passing t1 and t2; 1 sync run passing nothing. Tie, served: batch.

```ts
import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { LeaderboardResponse } from "../../src/lib/shared/api-types";
import { resetDb } from "../utils/reset-db";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

type RunSpec = { id: string; model: number; mode: string; started: string; passes: string[] };
const RUNS: RunSpec[] = [
  { id: "a-b", model: 1, mode: "batch", started: "2026-03-01T00:00:00Z", passes: ["t1"] },
  { id: "c-s", model: 2, mode: "sync", started: "2026-03-01T00:00:00Z", passes: ["t1", "t2"] },
  { id: "d-b", model: 3, mode: "batch", started: "2026-03-01T00:00:00Z", passes: ["t1"] },
  { id: "d-s1", model: 3, mode: "sync", started: "2026-01-01T00:00:00Z", passes: ["t1", "t2"] },
  { id: "d-s2", model: 3, mode: "sync", started: "2026-03-01T00:00:00Z", passes: ["t1", "t2"] },
  { id: "e-b", model: 4, mode: "batch", started: "2026-03-01T00:00:00Z", passes: ["t1", "t2"] },
  { id: "e-s", model: 4, mode: "sync", started: "2026-03-01T00:00:00Z", passes: [] },
];

beforeEach(async () => {
  await resetDb();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO model_families(id,slug,vendor,display_name) VALUES (1,'fam','v','Fam')`),
    ...[1, 2, 3, 4].map((id) =>
      env.DB.prepare(
        `INSERT INTO models(id,family_id,slug,api_model_id,display_name) VALUES (?,1,?,?,?)`,
      ).bind(id, `m${id}`, `api-m${id}`, `M${id}`),
    ),
    env.DB.prepare(`INSERT INTO task_sets(hash,created_at,task_count,is_current) VALUES ('ts','2026-01-01T00:00:00Z',2,1)`),
    env.DB.prepare(`INSERT INTO settings_profiles(hash,temperature,max_attempts) VALUES ('s',0.0,2)`),
    ...[1, 2, 3, 4].map((id) =>
      env.DB.prepare(
        `INSERT INTO cost_snapshots(pricing_version,model_id,input_per_mtoken,output_per_mtoken,effective_from) VALUES ('v1',?,3,15,'2026-01-01')`,
      ).bind(id),
    ),
    env.DB.prepare(
      `INSERT INTO machine_keys(id,machine_id,public_key,scope,created_at) VALUES (1,'rig',?,'ingest','2026-01-01T00:00:00Z')`,
    ).bind(new Uint8Array([0])),
    env.DB.prepare(`INSERT INTO tasks(task_set_hash,task_id,content_hash,difficulty,manifest_json) VALUES ('ts','t1','h1','easy','{}')`),
    env.DB.prepare(`INSERT INTO tasks(task_set_hash,task_id,content_hash,difficulty,manifest_json) VALUES ('ts','t2','h2','easy','{}')`),
  ]);
  await env.DB.batch(
    RUNS.map((r) =>
      env.DB.prepare(
        `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,completed_at,status,tier,pricing_version,
                          ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload,invocation_mode)
         VALUES (?,'ts',?,'s','rig',?,?,'completed','claimed','v1','sig','2026-01-01T00:00:00Z',1,'{}',?)`,
      ).bind(r.id, r.model, r.started, r.started, r.mode),
    ),
  );
  await env.DB.batch(
    RUNS.flatMap((r) =>
      ["t1", "t2"].map((t) =>
        env.DB.prepare(
          `INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success) VALUES (?,?,1,?,?,1)`,
        ).bind(r.id, t, r.passes.includes(t) ? 1 : 0, r.passes.includes(t) ? 1.0 : 0.0),
      ),
    ),
  );
});

async function board(qs: string): Promise<LeaderboardResponse> {
  const res = await SELF.fetch(`https://x/api/v1/leaderboard${qs}`);
  expect(res.status).toBe(200);
  return (await res.json()) as LeaderboardResponse;
}
const bySlug = (b: LeaderboardResponse) =>
  Object.fromEntries(b.data.map((r) => [r.model.slug, r]));

describe("leaderboard combined mode", () => {
  it("defaults a mixed set to combined and ranks every model on its served mode", async () => {
    const b = await board("");
    expect(b.filters.mode).toBe("combined");
    const rows = bySlug(b);
    expect(Object.keys(rows).sort()).toEqual(["m1", "m2", "m3", "m4"]);
    expect(rows.m1.served_mode).toBe("batch");
    expect(rows.m2.served_mode).toBe("sync");
    expect(rows.m3.served_mode).toBe("sync");
    expect(rows.m4.served_mode).toBe("batch");
    // D is ranked on its sync runs only (both pass t1+t2), E on its batch run only.
    expect(rows.m3.pass_at_1).toBeCloseTo(1.0);
    expect(rows.m3.run_count).toBe(2);
    expect(rows.m4.pass_at_1).toBeCloseTo(1.0);
    expect(rows.m4.run_count).toBe(1);
    expect(rows.m1.pass_at_1).toBeCloseTo(0.5);
  });

  it("matches each model's row in the matching single-mode view", async () => {
    const combined = bySlug(await board("?mode=combined"));
    const sync = bySlug(await board("?mode=sync"));
    const batch = bySlug(await board("?mode=batch"));
    for (const slug of ["m1", "m2", "m3", "m4"]) {
      const single = combined[slug].served_mode === "sync" ? sync[slug] : batch[slug];
      expect(combined[slug].pass_at_1).toBeCloseTo(single.pass_at_1);
      expect(combined[slug].pass_at_n).toBeCloseTo(single.pass_at_n);
      expect(combined[slug].run_count).toBe(single.run_count);
    }
    expect(sync.m3.served_mode).toBe("sync");
    expect(batch.m3.served_mode).toBe("batch");
  });

  it("a since filter never flips a model's served mode", async () => {
    // Drops D's older sync run; D still has 2 sync vs 1 batch set-wide.
    const rows = bySlug(await board("?mode=combined&since=2026-02-01T00:00:00Z"));
    expect(rows.m3.served_mode).toBe("sync");
    expect(rows.m3.run_count).toBe(1);
    expect(rows.m3.pass_at_1).toBeCloseTo(1.0);
  });

  it("puts every combined row in a tier", async () => {
    const b = await board("?mode=combined&sort=auc_2:desc");
    for (const r of b.data) expect(r.tier).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run build && npx vitest run tests/api/leaderboard-combined.test.ts`
Expected: FAIL (`served_mode` undefined; everything else should already pass after Task 2, confirming the predicate).

- [ ] **Step 3: Implement**

In `api-types.ts`, inside `LeaderboardRow`, next to `fallback_count`, add:

```ts
  /**
   * The invocation mode this row's numbers come from. Equals the requested
   * mode for `mode=sync|batch`; under `mode=combined` it is the model's
   * majority mode in the task set (tie to batch).
   */
  served_mode: InvocationMode;
```

In `leaderboard.ts`, after the `upstreamByModel` block and before rows are assembled, add:

```ts
  // Combined mode (amended D4): report which mode each row was ranked on.
  const servedByModel =
    q.mode === "combined"
      ? await servedModes(
          db,
          q.set === "current" ? { kind: "current" } : { kind: "hash", hash: q.set },
        )
      : null;
```

and in the row object literal, directly after `fallback_count: fallbackByModel.get(r.model_id) ?? 0,` (line 722):

```ts
      served_mode:
        q.mode === "combined"
          ? (servedByModel!.get(r.model_id) ?? "batch")
          : q.mode,
```

Import `servedModes` from `./invocation-mode`. Then run `npm run check`: every other object literal typed `LeaderboardRow` (test factories, e2e seed helpers) now errors on the missing field. Add `served_mode: "sync"` to each; do not make the field optional.

In `cache-version.ts`, set `export const CACHE_VERSION = "v17";` and append to the header comment:

```ts
 * v17: combined invocation mode (2026-09-30). Leaderboard rows gain
 * `served_mode`, and a mixed-mode set's default response changes from
 * `400 mode_required` to the combined ranking; every v16 entry is retired.
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run build && npx vitest run tests/api/leaderboard-combined.test.ts tests/api/leaderboard.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/shared/api-types.ts src/lib/server/leaderboard.ts src/lib/server/cache-version.ts tests/api/leaderboard-combined.test.ts
git commit -m "feat(site): leaderboard rows report served_mode; cache v17"
```

---

### Task 4: Matrix, compare, model detail: `served_mode`; invert `mode_required` tests

**Files:**
- Modify: `site/src/lib/shared/api-types.ts` (`MatrixModel` line 1085, `CompareModel` line 893, `ModelDetail` line 284)
- Modify: `site/src/lib/server/matrix.ts` (model rows built after the `modelRows` query at ~160)
- Modify: `site/src/routes/api/v1/compare/+server.ts` (models mapping before `filters: { mode }` at line 281)
- Modify: `site/src/routes/api/v1/models/[...slug]/+server.ts` (response object)
- Modify tests (each inverted deliberately):
  - `tests/api/leaderboard-mode.test.ts:66-76`
  - `tests/api/compare.test.ts:285-292`
  - `tests/api/families-mode.test.ts:74-78`
  - `tests/api/matrix.test.ts:360`
  - `tests/api/model-detail-mode.test.ts:75`
  - `tests/api/models-mode.test.ts:56-60`
  - `tests/api/og-mode.test.ts:18-43`
  - `tests/lib/page-mode.test.ts:73-77` stays unchanged (it tests the retry helper with a stubbed 400).

**Interfaces:**
- Consumes: `servedModes` (Task 1).
- Produces: `MatrixModel.served_mode`, `CompareModel.served_mode`, `ModelDetail.served_mode`, all `InvocationMode`.

- [ ] **Step 1: Invert the existing assertions (these are the failing tests)**

- `leaderboard-mode.test.ts`: rename the first test to `"refuses mode=all and defaults a mixed set to combined"` and replace its last four lines with:
  ```ts
  const none = await SELF.fetch("https://x/api/v1/leaderboard");
  expect(none.status).toBe(200);
  const noneBody = (await none.json()) as LeaderboardResponse;
  expect(noneBody.filters.mode).toBe("combined");
  expect(noneBody.data[0].served_mode).toBe("batch"); // 1 sync vs 1 batch: tie to batch
  ```
  Update the fixture doc comment ("must refuse rather than silently pick one") to "resolves to combined, which serves this tied model on batch".
- `compare.test.ts:285`: rename to `"resolves mode before validating the model list: too_few_models surfaces on a mixed set"`; expect `status 400` and `body.code` `"too_few_models"`.
- `families-mode.test.ts:74`: rename to `"defaults to combined when the family's current-set runs span both modes"`; expect status 200 and `body.filters.mode === "combined"`.
- `matrix.test.ts:360`: expect status 200 and `body.filters.mode === "combined"`; each `body.models[i].served_mode` is `"sync"` or `"batch"`.
- `model-detail-mode.test.ts:75`: expect status 200, `thirdBody.served_mode` defined.
- `models-mode.test.ts:56`: rename to `"defaults to combined when the current set is mixed-mode and mode is unspecified"`; expect status 200.
- `og-mode.test.ts`: rename the describe to `"og/* routes render on a mixed-mode set"`, the case to `"%s returns an image, not a 400"`; expect status 200 and `content-type` starting `image/png`. Update the file's header comment accordingly.

Read each test body before editing it, to keep its fixture and any other assertions.

- [ ] **Step 2: Run to verify they fail**

Run: `npm run build && npx vitest run tests/api/leaderboard-mode.test.ts tests/api/compare.test.ts tests/api/families-mode.test.ts tests/api/matrix.test.ts tests/api/model-detail-mode.test.ts tests/api/models-mode.test.ts tests/api/og-mode.test.ts`
Expected: the leaderboard, compare, families, models and og inversions already PASS (Tasks 1 to 3 made mixed sets resolve to combined and gave leaderboard rows `served_mode`). The matrix and model-detail `served_mode` assertions FAIL until Step 3. If anything else fails, stop and investigate before Step 3.

- [ ] **Step 3: Implement**

Add to each of `MatrixModel`, `CompareModel`, `ModelDetail` in `api-types.ts`:

```ts
  /** Mode this model's numbers come from; under `mode=combined`, its majority mode in the set. */
  served_mode: InvocationMode;
```

Populate, using one `servedModes` call per request only when the mode is `combined`, otherwise the literal mode:

- `matrix.ts`: when mapping `modelRows` to `MatrixModel`, set `served_mode`. The matrix also accepts `set=all`, where one model can have a different served mode per task set, so there is no single value to report. Rule: for `set=all` under `combined`, report `"batch"` unless the current set's map says otherwise (a display label only; the SQL still scopes each row by its own set). Code:
  ```ts
  const served =
    opts.mode === "combined"
      ? await servedModes(
          db,
          opts.set === "current" || opts.set === "all"
            ? { kind: "current" }
            : { kind: "hash", hash: opts.set },
        )
      : null;
  // in the mapping:
  served_mode: opts.mode === "combined" ? (served!.get(m.model_id) ?? "batch") : opts.mode,
  ```
- `compare/+server.ts`: `const served = mode === "combined" ? await servedModes(env.DB, { kind: "current" }) : null;` and in each `CompareModel`: `served_mode: mode === "combined" ? (served!.get(m.id) ?? "batch") : mode`.
- `models/[...slug]/+server.ts`: same pattern with the model's id and `{ kind: "current" }`.

- [ ] **Step 4: Run to verify they pass**

Run the Step 2 command again, then the whole main suite:
`npm run build && npm run test:main`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add src tests
git commit -m "feat(site): served_mode on matrix, compare and model detail; mixed sets default to combined"
```

---

### Task 5: UI: mode filter, notice, minority pill

**Files:**
- Modify: `site/src/lib/shared/leaderboard-derive.ts` (add `minorityMode`)
- Modify: `site/src/lib/components/domain/ModeFilter.svelte`
- Modify: `site/src/routes/+page.server.ts:106-121`
- Modify: `site/src/routes/+page.svelte:126-141`
- Modify: `site/src/lib/components/domain/LeaderboardTable.svelte:141-154, 298-307`
- Modify: `site/src/lib/components/domain/TaskResultsMatrix.svelte:28-30`
- Modify: `site/src/lib/components/domain/CompareTable.svelte:37-39`
- Modify: `site/src/routes/models/[...slug]/+page.svelte:210-214`
- Test: `site/src/lib/shared/leaderboard-derive.test.ts` (create if absent, else extend), `site/src/lib/components/domain/LeaderboardTable.test.svelte.ts`

**Interfaces:**
- Consumes: `served_mode` on rows (Tasks 3, 4), `RankMode`.
- Produces: `minorityMode(modes: InvocationMode[]): InvocationMode | null`.

- [ ] **Step 1: Write the failing tests**

`leaderboard-derive.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { minorityMode } from "./leaderboard-derive";

describe("minorityMode", () => {
  it("returns the less common mode, sync on a tie, null when uniform", () => {
    expect(minorityMode(["batch", "batch", "sync"])).toBe("sync");
    expect(minorityMode(["sync", "sync", "batch"])).toBe("batch");
    expect(minorityMode(["batch", "sync"])).toBe("sync");
    expect(minorityMode(["batch", "batch"])).toBeNull();
    expect(minorityMode([])).toBeNull();
  });
});
```

In `LeaderboardTable.test.svelte.ts`, add a case (reuse the file's existing row factory; add `served_mode` to it with default `"batch"`):

```ts
it("shows a mode pill only on minority-mode rows", () => {
  const rows = [row({ slug: "a", served_mode: "batch" }), row({ slug: "b", served_mode: "batch" }), row({ slug: "c", served_mode: "sync" })];
  const { container } = render(LeaderboardTable, { props: { rows, sort: "auc_2:desc" } });
  const pills = container.querySelectorAll('[data-test="mode-pill"]');
  expect(pills.length).toBe(1);
  expect(pills[0].textContent?.trim()).toBe("sync");
});
```

Match the factory's real name and argument shape when adding this; read the file first.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run --config vitest.unit.config.ts src/lib/shared/leaderboard-derive.test.ts src/lib/components/domain/LeaderboardTable.test.svelte.ts`
Expected: FAIL (`minorityMode` not exported; no pill).

- [ ] **Step 3: Implement**

`leaderboard-derive.ts`:

```ts
import type { InvocationMode } from './api-types';

/**
 * The served mode to badge in a combined ranking: the less common one among
 * the rows shown, `sync` on a tie, `null` when every row shares one mode.
 */
export function minorityMode(modes: InvocationMode[]): InvocationMode | null {
  const sync = modes.filter((m) => m === 'sync').length;
  const batch = modes.length - sync;
  if (sync === 0 || batch === 0) return null;
  return sync <= batch ? 'sync' : 'batch';
}
```

(Place the import with the file's existing imports; keep the file's quote style.)

`LeaderboardTable.svelte`: import `minorityMode`; add `const badgeMode = $derived(minorityMode(rows.map((r) => r.served_mode)));`; after the provisional-marker `{/if}` (line 154) add:

```svelte
            {#if badgeMode && row.served_mode === badgeMode}
              <span
                class="mode-pill"
                data-test="mode-pill"
                aria-label="Ranked on {row.served_mode} runs"
                title={row.served_mode === 'sync'
                  ? 'Ranked on sync runs: continuation, empty retries and refusal fallback were available.'
                  : 'Ranked on batch runs: no continuation, empty retries or refusal fallback.'}
              >{row.served_mode}</span>
            {/if}
```

and in `<style>` beside `.provisional-marker`:

```css
  .mode-pill { margin-left: var(--space-2); padding: 0 var(--space-2); border: 1px solid var(--border); border-radius: var(--radius-pill); color: var(--text-muted); font-size: var(--text-xs); white-space: nowrap; }
```

`ModeFilter.svelte`: type `mode` as `RankMode | null`; add prop `combinedHref: string`; render three links in this order: `combined` (label "combined"), `sync` (label "sync only"), `batch` (label "batch only"), each with the existing `class:active` / `aria-current` pattern.

`+page.server.ts`: add `combined: withMode(url.pathname, url.searchParams, "combined")` to `modeLinks`, and return `mode: payload.filters.mode ?? mode` so the served mode (including `combined`) reaches the page. `withMode`'s `mode` parameter and `pageMode`'s return in `src/lib/server/page-mode.ts` widen to `RankMode | null` (`pageMode` also accepts `"combined"`).

`+page.svelte`: pass `combinedHref={data.modeLinks.combined}`; show `ModeFilter` when `data.modeSplit || data.mode === 'combined' || page.url.searchParams.has('mode')`; add, after the existing `{#if data.modeSplit}` notice block:

```svelte
    {#if data.mode === 'combined'}
      <p class="mode-notice">
        Each model is ranked on the run mode it has most runs in. Models marked sync were run without batch.
        <a href={data.modeLinks.sync}>Sync only</a> · <a href={data.modeLinks.batch}>Batch only</a>
      </p>
    {/if}
```

`TaskResultsMatrix.svelte` (line 29) and `CompareTable.svelte` (line 38): compute `badgeMode` with `minorityMode` over `matrix.models` / `models`, and after the model name add the same `mode-pill` span (without the long tooltip branch: `title="Ranked on {m.served_mode} runs"`), plus the `.mode-pill` CSS rule.

`models/[...slug]/+page.svelte` Overview paragraph (line 212): after the sentence ending "…an average score of {formatScore(m.aggregates.avg_score)}." append ` Ranked on {m.served_mode} runs.`

- [ ] **Step 4: Run to verify they pass, then check**

Run:
```bash
npx vitest run --config vitest.unit.config.ts
npm run check
npm run build && npm run test:main
```
Expected: all PASS, `npm run check` 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src tests
git commit -m "feat(site): combined mode filter, notice and minority mode pill"
```

---

### Task 6: Docs and comment sweep

**Files:**
- Modify: `docs/batch-mode.md` (the section describing site ranking by mode)
- Modify: `.claude/rules/invocation-profile.md` (first bullet)
- Modify: `docs/superpowers/specs/2026-09-06-batch-mode-design.md` (under the D4 row, line 56)
- Modify: `site/src/lib/server/page-mode.ts:1-12` header comment
- Modify: `docs/superpowers/specs/2026-09-30-combined-mode-leaderboard-design.md` (record the implementation deviation)

- [ ] **Step 1: Edit**

- `invocation-profile.md`: replace "`mode=all` is `400 invalid_mode_for_metric`; a set with both modes and no `mode` is `400 mode_required`; the default is the set's only mode." with "`mode=all` is `400 invalid_mode_for_metric`; `mode=combined` ranks each model on its majority mode in the set (tie to batch, whole-set, excluded runs not counted); a mixed set with no `mode` defaults to `combined`, a single-mode set to its only mode (amended D4, `docs/superpowers/specs/2026-09-30-combined-mode-leaderboard-design.md`)." Also replace "never pooled with sync on the site" with "never pooled with sync within one model; ranked beside sync models only under `mode=combined`". Also remove the sentence about `/api/v2/models` and og routes refusing with `mode_required`.
- `batch-mode design spec`: add a line directly after the D4 table row: `> D4 amended 2026-09-30: a mixed set defaults to mode=combined (see 2026-09-30-combined-mode-leaderboard-design.md).`
- `docs/batch-mode.md`: find the paragraph on site ranking (search "mode_required" or "never ranked together") and state the combined default and the badge.
- `page-mode.ts` header: replace the sentence that begins "fall back to `sync`" (it runs to "...rather than surfacing a 400 to the visitor.") with: "The API now resolves a mixed set to `combined` itself, so the sync retry below only fires against an older worker that still refuses with `mode_required`."
- Combined-mode spec: add a section "Implementation note" stating the inline `servedModeSql` predicate replaced `resolveModeBinding` + JSON map, that `upstream-profile.ts:45` is ingest-side and untouched, and that five compare-route predicates were added to the list.

- [ ] **Step 2: Verify no stale claims**

Run (repo root): `git grep -n "mode_required" -- docs .claude/rules site/src`
Expected: remaining hits describe the old behaviour as history, the page-mode retry, or tests of the retry helper. No doc claims a mixed set returns 400.

- [ ] **Step 3: Commit**

```bash
git add docs .claude/rules/invocation-profile.md site/src/lib/server/page-mode.ts
git commit -m "docs: combined mode amends batch-mode D4"
```

---

### Task 7: Verify, review, deploy, confirm in production

**Files:** none changed unless review finds issues.

- [ ] **Step 1: Full site verification**

Run:
```bash
npm run check
npm run build
npm run test:main
npm run test:build
```
Expected: all PASS.

- [ ] **Step 2: Review**

Dispatch the `worker-pitfall-reviewer` agent on the branch diff (`git diff master...feat/combined-mode -- site`). Fix any finding in a new commit, then re-run Step 1.

- [ ] **Step 3: Merge and deploy (requires the owner's explicit go)**

Ask the owner before deploying. Then from repo root: `git checkout master && git merge --no-ff feat/combined-mode`, and `cd site && npm run deploy`. No migration applies; the deploy-order hook will ask, answer from this plan.

- [ ] **Step 4: Production check**

Run:
```bash
curl -s "https://ai.sshadows.dk/api/v1/leaderboard" | jq '{mode: .filters.mode, n: (.data|length), sync: [.data[] | select(.served_mode=="sync") | .model.slug]}'
curl -s "https://ai.sshadows.dk/api/v1/leaderboard?mode=batch" | jq '.data|length'
```
Expected: `mode` `"combined"`, `n` 13, `sync` `["openai/gpt-6.1-sol"]`; the batch-only view still returns 12.
