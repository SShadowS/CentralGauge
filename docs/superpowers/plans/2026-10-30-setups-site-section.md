# Setups Site Section Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a public Setups section to the site: ranking with value map, setup detail, compare two setups, archive of earlier HX task sets, and HX task pages showing only the human summary.

**Architecture:** New D1 tables hold published setup results (written later by plan 3; this plan seeds them in tests). A server module `site/src/lib/server/setups.ts` reads them; epoch-cached `/api/v1/setups*` and `/api/v1/hx-tasks/*` endpoints serve them; SvelteKit pages under `/setups` and `/hx-tasks` render them. Pure logic (ranking, task grid, repeat spread, ingredient diff) lives in `site/src/lib/shared/setups.ts`. The existing value map is generalised to take plain points.

**Tech Stack:** SvelteKit (Svelte 5 runes), Cloudflare Workers + D1, vitest (`@cloudflare/vitest-pool-workers` and jsdom configs), Playwright. Deno for the summary audit.

**Spec:** `docs/superpowers/specs/2026-10-30-setups-leaderboard-design.md` (part 1 of its build order).

## Global Constraints

- Agent tools, exactly: `claude-code`, `codex`, `pi`, `opencode`, `cursor`, `antigravity`.
- Only the **current** setup task set is ranked; earlier sets stay browsable (archive). The owner promotes a set (`is_current`).
- Score = the harness report's per-arm pass rate, stored as published (0..1). The site never recomputes it.
- Price per solved task may be null: show "price not available" plus the stored reason; leave the setup off the value map.
- Private setups: hidden from table and chart by default, shown with a toggle. They expose tool, models and roles, and the names of skills and MCP servers, never file contents (and, Claude's call, not the flow text).
- HX task pages show only the human summary, never the prompt or code, and say the full tasks are public on GitHub.
- Each setup's detail page shows its agent tool's known cost issue (text in Task 2).
- The Models section is unchanged.
- No `deno fmt` on `site/` files (prettier owns them). No em dashes in UI copy.
- No prod deploy, D1 migration apply or ingest; those stay with the owner (migration before deploy).
- Work on a branch from master, e.g. `feat/setups-leaderboard`.

## Review Focus

- No current setup task set (fresh DB): ranking page and API return an empty state with 200, not a 500. (Task 4, Task 6)
- Private setup contents never leave the server: ranking with the toggle, detail, compare and HX task results. (Task 3)
- A setup with null price is ranked, shows "price not available", and the value map counts it as omitted. (Task 5, Task 6)
- Compare with fewer or more than 2 ids, an unknown id, or a duplicate id: empty state or 400/404, never 500. (Task 8)
- A task whose cells are all `env_blocked`/`infra` shows as blocked in the grid, not 0%; a repeat with no counted cells is left out of the spread. (Task 2)

---

### Task 1: Migration 0024 for setups

**Files:**
- Create: `site/migrations/0024_setups.sql`
- Modify: `site/tests/utils/reset-db.ts` (add the new tables, children first), `site/tests/migrations.test.ts:16-34` (expected table list)

**Interfaces:**
- Produces tables (later tasks and plan 3 rely on these exact names):

```sql
CREATE TABLE setup_task_sets (
  hash TEXT PRIMARY KEY, display_name TEXT NOT NULL, task_count INTEGER NOT NULL,
  is_current INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, promoted_at TEXT);
CREATE UNIQUE INDEX idx_setup_task_sets_current ON setup_task_sets(is_current) WHERE is_current = 1;

CREATE TABLE hx_tasks (
  task_set_hash TEXT NOT NULL REFERENCES setup_task_sets(hash),
  task_id TEXT NOT NULL, description_sha TEXT NOT NULL,
  PRIMARY KEY (task_set_hash, task_id));

CREATE TABLE setups (
  id TEXT PRIMARY KEY, description TEXT NOT NULL,
  agent_tool TEXT NOT NULL CHECK (agent_tool IN ('claude-code','codex','pi','opencode','cursor','antigravity')),
  base_model TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','private')),
  needs_key INTEGER NOT NULL DEFAULT 0,
  roles_json TEXT NOT NULL DEFAULT '[]', flow TEXT,
  ingredients_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);

CREATE TABLE setup_runs (
  id TEXT PRIMARY KEY,
  setup_id TEXT NOT NULL REFERENCES setups(id) ON DELETE CASCADE,
  task_set_hash TEXT NOT NULL REFERENCES setup_task_sets(hash),
  tool_version TEXT NOT NULL, published_at TEXT NOT NULL,
  score REAL NOT NULL CHECK (score >= 0 AND score <= 1),
  cost_per_solved_usd REAL, price_note TEXT,
  excluded_cells INTEGER NOT NULL DEFAULT 0);
CREATE INDEX idx_setup_runs_set ON setup_runs(task_set_hash, setup_id, published_at);

CREATE TABLE setup_cells (
  run_id TEXT NOT NULL REFERENCES setup_runs(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL, repeat INTEGER NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('pass','fail','env_blocked','infra')),
  cost_usd REAL, duration_ms INTEGER,
  PRIMARY KEY (run_id, task_id, repeat));
```

`roles_json` is `Role[]`, `ingredients_json` is `Ingredients` (Task 2).

- [ ] **Step 1:** Add the five tables to the expected list in `tests/migrations.test.ts`.
- [ ] **Step 2:** Run `cd site && npm run build && npx vitest run tests/migrations.test.ts`. Expected: FAIL (tables missing).
- [ ] **Step 3:** Write the migration above; add `setup_cells, setup_runs, hx_tasks, setups, setup_task_sets` (that order) to `resetDb()`.
- [ ] **Step 4:** Re-run the test. Expected: PASS.
- [ ] **Step 5:** Commit `feat(site): setups tables (migration 0024)`.

### Task 2: Shared setup types and pure logic

**Files:**
- Create: `site/src/lib/shared/setups.ts`, `site/src/lib/shared/setups.test.ts`

**Interfaces:**
- Produces:

```ts
export const AGENT_TOOLS = ['claude-code','codex','pi','opencode','cursor','antigravity'] as const;
export type AgentTool = typeof AGENT_TOOLS[number];
export type CellOutcome = 'pass' | 'fail' | 'env_blocked' | 'infra';
export interface Role { role: string; model: string; effort: string | null; }
export interface NamedFile { name: string; content: string | null; } // content null = withheld
export interface Ingredients {
  instructions: NamedFile | null; rules: NamedFile[]; settings: NamedFile | null;
  skills: string[]; mcp: string[]; hooks: string[];
}
export interface Cell { task_id: string; repeat: number; outcome: CellOutcome; cost_usd: number | null; duration_ms: number | null; }
export interface SetupRow {
  rank: number | null; id: string; description: string; agent_tool: AgentTool; base_model: string;
  visibility: 'public' | 'private'; score: number; cost_per_solved_usd: number | null;
  price_note: string | null; tool_version: string; needs_key: boolean;
}
export const KNOWN_ISSUES: Record<AgentTool, string>;
export function rankRows(rows: Omit<SetupRow, 'rank'>[]): SetupRow[];
export function taskGrid(cells: Cell[]): Map<string, { passRate: number | null; blocked: boolean }>;
export function repeatSpread(cells: Cell[]): { min: number; max: number } | null;
export function diffIngredients(a: Ingredients, b: Ingredients): { field: keyof Ingredients; a: string[]; b: string[]; differs: boolean }[];
export function withholdContents(i: Ingredients): Ingredients;
```

- `KNOWN_ISSUES`: copy the six "Known-issue lines" verbatim from the spec's Cost table "Known issue" column, as plain sentences.
- `rankRows` (Claude's call): sort by score desc, then id asc. Public rows get competition ranks (1, 1, 3); private rows get `rank: null`.
- `taskGrid`: per task, `passRate` = passes / (pass + fail) cells; if a task has no pass/fail cells, `passRate: null, blocked: true`.
- `repeatSpread`: per repeat, passes / (pass + fail); repeats with no counted cells are skipped; null when none remain.
- `diffIngredients`: compares by names (instructions/settings as `[name]`, rules by name, lists as sorted names).
- `withholdContents`: every `NamedFile.content` becomes null.

- [ ] **Step 1: Write the failing tests** in `setups.test.ts`:
  - `rankRows` on scores `[0.8 pub, 0.8 pub, 0.7 pub, 0.9 priv]` gives ranks `[1, 1, 3]` for the public rows and `null` for the private one, private sorted first by score.
  - `taskGrid` with HX-001 cells `pass, fail` gives `{passRate: 0.5, blocked: false}`; HX-002 cells `env_blocked, infra` give `{passRate: null, blocked: true}`.
  - `repeatSpread` with repeat 1 `pass,pass`, repeat 2 `pass,fail`, repeat 3 `env_blocked` gives `{min: 0.5, max: 1}`; all-blocked input gives `null`.
  - `diffIngredients` marks `skills` differing for `['a']` vs `['a','b']` and `mcp` not differing for `['x']` vs `['x']`.
  - `withholdContents` leaves names and nulls every content.
  - `KNOWN_ISSUES` has a non-empty entry for each of `AGENT_TOOLS`.
- [ ] **Step 2:** Run `cd site && npx vitest run --config vitest.unit.config.ts src/lib/shared/setups.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3:** Implement `site/src/lib/shared/setups.ts`.
- [ ] **Step 4:** Re-run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(site): setup types, ranking, grid and spread logic`.

### Task 3: Server query module

**Files:**
- Create: `site/src/lib/server/setups.ts`, `site/tests/server/setups.test.ts`, `site/tests/utils/seed-setups.ts`

**Interfaces:**
- Consumes: Task 2 types, `rankRows`, `withholdContents`, `KNOWN_ISSUES`.
- Produces:

```ts
export interface SetupTaskSet { hash: string; display_name: string; task_count: number; is_current: boolean; promoted_at: string | null; tasks: string[]; }
export interface SetupRunSummary { run_id: string; task_set_hash: string; task_set_name: string; is_current: boolean; tool_version: string; published_at: string; score: number; cost_per_solved_usd: number | null; price_note: string | null; excluded_cells: number; }
export interface SetupDetail {
  setup: { id: string; description: string; agent_tool: AgentTool; base_model: string; visibility: 'public'|'private'; needs_key: boolean; roles: Role[]; flow: string | null; ingredients: Ingredients };
  known_issue: string;
  runs: SetupRunSummary[];               // newest first, all sets and tool versions
  latest: { run_id: string; task_set_hash: string; cells: Cell[] } | null; // newest run on the current set
}
export async function listSetupTaskSets(db: D1Database): Promise<SetupTaskSet[]>;
export async function computeSetupRanking(db: D1Database, setHash: string, includePrivate: boolean): Promise<SetupRow[]>;
export async function getSetupDetail(db: D1Database, id: string): Promise<SetupDetail | null>;
export async function getHxTaskResults(db: D1Database, setHash: string, taskId: string): Promise<{ description_sha: string; results: { setup_id: string; description: string; agent_tool: AgentTool; passRate: number | null; blocked: boolean }[] } | null>;
```

- `computeSetupRanking` uses each setup's newest run (max `published_at`, then max `id`) on `setHash`.
- Private setups: `getSetupDetail` applies `withholdContents` and sets `flow: null`; `getHxTaskResults` includes public setups only.
- `seed-setups.ts` exports `seedSetups(db: D1Database): Promise<void>`: one current set `hx-cur` (HX-001, HX-002) and one old set `hx-old`; setups `cc-plain` (public, two runs on `hx-cur` with tool versions 2.1.300 and 2.1.314, the second newer), `pi-default` (public, null cost, `price_note` set), `cc-secret` (private, instructions content `SECRET-BODY`), `codex-old` (only on `hx-old`); cells covering pass, fail and env_blocked.

- [ ] **Step 1: Write the failing tests** (`beforeAll` applies migrations, `beforeEach` runs `resetDb()` and `seedSetups`):
  - ranking for `hx-cur`, `includePrivate=false`: ids `cc-plain, pi-default` only; `cc-plain` row has `tool_version: '2.1.314'`.
  - ranking with `includePrivate=true` contains `cc-secret` with `rank: null`.
  - ranking for `hx-cur` never contains `codex-old`; ranking for `hx-old` does.
  - `getSetupDetail('cc-secret')`: `JSON.stringify(result)` does not contain `SECRET-BODY`; `setup.flow` is null; skills names are present.
  - `getSetupDetail('cc-plain').runs` has 2 entries, newest first; `known_issue === KNOWN_ISSUES['claude-code']`.
  - `getSetupDetail('nope')` is null.
  - `getHxTaskResults('hx-cur','HX-001')` omits `cc-secret`; unknown task gives null.
  - `listSetupTaskSets` returns both sets, `hx-cur` with `is_current: true` and `tasks: ['HX-001','HX-002']`.
- [ ] **Step 2:** Run `cd site && npx vitest run tests/server/setups.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `site/src/lib/server/setups.ts`.
- [ ] **Step 4:** Re-run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(site): setups query module`.

### Task 4: API endpoints

**Files:**
- Create: `site/src/routes/api/v1/setups/+server.ts`, `site/src/routes/api/v1/setups/[id]/+server.ts`, `site/src/routes/api/v1/setup-task-sets/+server.ts`, `site/src/routes/api/v1/hx-tasks/[id]/+server.ts`, `site/tests/api/setups.test.ts`
- Modify: `site/src/lib/shared/api-types.ts` (response types below)

**Interfaces:**
- Consumes: Task 3 functions; `epochCachedJson` (`src/lib/server/shared-cache.ts:170`), cache name `cg-setups`, one namespace per endpoint; `cachedJson` for the response, as other routes do.
- Produces:
  - `GET /api/v1/setups?set=<hash>&private=1` → `SetupsResponse { task_set: SetupTaskSet | null; rows: SetupRow[] }`. No `set` = current set; no current set → `{task_set: null, rows: []}` with 200. Unknown `set` → 404. `private` accepts only `1`/absent.
  - `GET /api/v1/setups/[id]` → `SetupDetail`, 404 when null.
  - `GET /api/v1/setup-task-sets` → `{ sets: SetupTaskSet[] }`.
  - `GET /api/v1/hx-tasks/[id]?set=<hash>` → `HxTaskResponse { id; summary: string | null; task_set: SetupTaskSet; results: [...] }` (summary filled by Task 9; return `null` until then). 404 when the task is not in the set.

- [ ] **Step 1: Write the failing tests** via `SELF.fetch`, reusing `seedSetups`: each status code above; `rows` ids for default and `private=1`; an empty DB (no `seedSetups`) gives 200 with `task_set: null`; the private detail body has no `SECRET-BODY`.
- [ ] **Step 2:** Run `cd site && npm run build && npx vitest run tests/api/setups.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the four routes.
- [ ] **Step 4:** Re-run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(site): setups API`.

### Task 5: Generalise the value map

**Files:**
- Modify: `site/src/lib/shared/value-map.ts`, `site/src/lib/shared/value-map.test.ts`, `site/src/lib/components/domain/ValueMap.svelte`, `site/src/routes/+page.svelte:182`

**Interfaces:**
- Produces:

```ts
export interface ValueInput { slug: string; display_name: string; cost: number | null; y: number /* 0..100 */; provisional: boolean; }
export function computeValueMapFrom(items: ValueInput[], dims: ValueMapDims): ValueMapModel;
export function leaderboardValueInputs(rows: LeaderboardRow[]): ValueInput[];
export function computeValueMap(rows: LeaderboardRow[], dims: ValueMapDims): ValueMapModel; // = computeValueMapFrom(leaderboardValueInputs(rows), dims)
```

  `ValuePoint.auc` is renamed `y`. `ValueMap.svelte` props become `{ points: ValueInput[]; noun?: string /* 'model' */; yLabel?: string /* 'Solve AUC@2' */; width?; height? }`. Its labels use `noun` and `yLabel` (for example "1 setup with no cost data omitted"). The Models page passes `leaderboardValueInputs(data.leaderboard.data)` and renders exactly as before.

- [ ] **Step 1:** Add a test that `computeValueMapFrom` with one null-cost item and two priced items gives `omittedCount: 1` and a frontier through the priced ones. Keep the existing `computeValueMap` tests unchanged.
- [ ] **Step 2:** Run `cd site && npx vitest run --config vitest.unit.config.ts src/lib/shared/value-map.test.ts`. Expected: the new test FAILs.
- [ ] **Step 3:** Refactor as specified; costs `<= 0` or null count as omitted, as today.
- [ ] **Step 4:** Re-run that test plus any `ValueMap` component tests (`npx vitest run --config vitest.unit.config.ts ValueMap`). Expected: PASS.
- [ ] **Step 5:** Commit `refactor(site): value map takes plain points`.

### Task 6: Setups ranking page, archive and nav

**Files:**
- Create: `site/src/routes/setups/+page.server.ts`, `site/src/routes/setups/+page.svelte`, `site/src/routes/setups/archive/+page.server.ts`, `site/src/routes/setups/archive/+page.svelte`, `site/src/lib/components/domain/SetupsTable.svelte`, `site/src/lib/components/domain/SetupsTable.test.svelte.ts`
- Modify: `site/src/lib/components/layout/Nav.svelte:49-57` (add "Setups" after the Models entries), `site/scripts/build-sitemap.ts` (add `/setups`, `/setups/archive`)

**Interfaces:**
- Consumes: `GET /api/v1/setups`, `GET /api/v1/setup-task-sets`, `ValueMap` (Task 5).
- `/setups` loader reads `?set=` and `?private=1` and passes them through. The page shows:
  - a title naming the task set, and a "not current" banner linking to the current set when `task_set.is_current` is false;
  - a table and value-map toggle;
  - a "Show private setups" toggle that sets `?private=1`;
  - a links row to each HX task in the set (`/hx-tasks/<id>?set=<hash>`).
- `SetupsTable` props: `{ rows: SetupRow[]; selected: string[]; onselect(ids: string[]): void }`. Columns: checkbox, Rank ("private" for a null rank), Description (links to `/setups/<id>`), Agent, Score (`formatMetric(score,'rate')`), Price per solved task (`formatMetric(cost,'usd')`, or "price not available" with `price_note` as `title`).
- With exactly two boxes ticked, a "Compare" link goes to `/setups/compare?ids=<a>,<b>`; a third tick replaces the oldest selection.
- Value map: `points = rows.map(r => ({slug: r.id, display_name: r.description, cost: r.cost_per_solved_usd, y: r.score*100, provisional: false}))`, `noun="setup"`, `yLabel="Score"`.
- `/setups/archive` lists every set (name, task count, promoted date, current marker) linking to `/setups?set=<hash>`.
- Empty state when `task_set` is null: "No setups have been ranked yet."

- [ ] **Step 1: Write failing component tests** for `SetupsTable`: a null-rank row renders "private"; a null-cost row renders "price not available" with the note as title; ticking two rows calls `onselect` with both ids; ticking a third keeps the last two.
- [ ] **Step 2:** Run `cd site && npx vitest run --config vitest.unit.config.ts SetupsTable`. Expected: FAIL.
- [ ] **Step 3:** Implement the component, pages, nav entry and sitemap entries.
- [ ] **Step 4:** Re-run. Expected: PASS. Then `cd site && npm run check`. Expected: 0 errors.
- [ ] **Step 5:** Commit `feat(site): setups ranking page and archive`.

### Task 7: Setup detail page

**Files:**
- Create: `site/src/routes/setups/[id]/+page.server.ts`, `site/src/routes/setups/[id]/+page.svelte`, `site/src/lib/components/domain/SetupTaskGrid.svelte`, `site/src/lib/components/domain/SetupTaskGrid.test.svelte.ts`

**Interfaces:**
- Consumes: `GET /api/v1/setups/[id]` (404 → SvelteKit `error(404)`), `taskGrid`, `repeatSpread`, `formatMetric`, `MarkdownRenderer` (already used by `TaskDetailPanel.svelte`).
- Produces: `SetupTaskGrid` props `{ rows: { label: string; cells: Cell[] }[]; tasks: string[]; set: string }`. One row per entry, one column per task linking to `/hx-tasks/<task>?set=<set>`. Cell colour by `passRate` (all pass, some, none), and a distinct "blocked" style with the text "blocked" for `blocked: true`. Each cell carries a text label, not colour only. Task 8 reuses it with two rows.
- Page sections, in order:
  1. Header with description, agent tool, base model, tool version, visibility and a "needs a submitter key" label.
  2. Agents and roles table.
  3. Flow (hidden when null).
  4. Instructions and rules: rendered with `MarkdownRenderer` when the content is present, names only when withheld.
  5. Skills, MCP servers, hooks and plugins, settings.
  6. Results for the latest run on the current set: score, price (or "price not available" plus note), excluded cells, a spread line ("worst repeat X, best repeat Y"), and the grid.
  7. Known cost issue for this tool.
  8. History table of `runs`: set, tool version, published, score, price.

- [ ] **Step 1: Write failing component tests** for `SetupTaskGrid`: a blocked cell renders the text "blocked"; a 0.5 cell renders "50%"; each column header links to `/hx-tasks/HX-001?set=hx-cur`.
- [ ] **Step 2:** Run `cd site && npx vitest run --config vitest.unit.config.ts SetupTaskGrid`. Expected: FAIL.
- [ ] **Step 3:** Implement the component and page.
- [ ] **Step 4:** Re-run, then `npm run check`. Expected: PASS, 0 errors.
- [ ] **Step 5:** Commit `feat(site): setup detail page`.

### Task 8: Compare page

**Files:**
- Create: `site/src/routes/setups/compare/+page.server.ts`, `site/src/routes/setups/compare/+page.svelte`, `site/tests/api/setups-compare-page.test.ts`

**Interfaces:**
- Consumes: `GET /api/v1/setups/[id]` for each id, `diffIngredients`, `SetupTaskGrid`, `repeatSpread`.
- Loader: parse `?ids=a,b`. Fewer than 2 distinct ids → empty state ("Pick two setups on the ranking page"). More than 2 → `error(400)`. Any id 404 → `error(404)`.
- Page sections:
  1. Header numbers side by side: score, price, tool version.
  2. Ingredient diff: roles and models plus `diffIngredients`; rows where `differs` is true are highlighted.
  3. `SetupTaskGrid` with both setups' latest cells. When their latest runs are on different sets, show a notice instead of the grid.
  4. Spread: for each setup, a bar from `min` to `max` with a dot at the score, on one shared 0..1 axis (inline SVG; each bar has a text label).

- [ ] **Step 1: Write failing tests** via `SELF.fetch('https://x/setups/compare?ids=...')` with `seedSetups`: `cc-plain,pi-default` gives 200 and the body contains both descriptions; `cc-plain` alone gives 200 with the empty-state text; `cc-plain,cc-plain` gives the empty state; three ids give 400; `cc-plain,nope` gives 404; `cc-plain,cc-secret` gives 200 and the body has no `SECRET-BODY`.
- [ ] **Step 2:** Run `cd site && npm run build && npx vitest run tests/api/setups-compare-page.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the page.
- [ ] **Step 4:** Rebuild and re-run, then `npm run check`. Expected: PASS, 0 errors.
- [ ] **Step 5:** Commit `feat(site): compare two setups`.

### Task 9: HX task pages and their summaries

**Files:**
- Create: `site/catalog/hx-task-summaries.md` (header comment only; the owner writes the entries), `site/src/lib/server/hx-task-summaries.ts`, `site/src/routes/hx-tasks/[id]/+page.server.ts`, `site/src/routes/hx-tasks/[id]/+page.svelte`
- Modify: `site/src/routes/api/v1/hx-tasks/[id]/+server.ts` (fill `summary`), `site/tests/api/setups.test.ts`, `scripts/audit-task-summaries.ts` and its test (cover HX)

**Interfaces:**
- Consumes: `parseTaskSummaries` (`$lib/shared/task-summaries`), `getHxTaskResults`.
- Produces: `export function hxTaskSummary(id: string, descriptionSha: string): string | null` in `hx-task-summaries.ts`. It bundles `../../../catalog/hx-task-summaries.md?raw` like `task-summaries.ts`, and returns the body only when the entry's sha equals `descriptionSha` from `hx_tasks`. The file format is the same as `task-summaries.md`; the HX `description_sha` is sha256 of `harness-tasks/tasks/<id>/prompt.md`.
- The page shows the task id, the summary (or "No summary yet."), the fixed sentence "The full task is public in the CentralGauge GitHub repository.", and a results table of public setups on this task (setup link, agent, pass rate or "blocked"). It never shows the prompt.
- Audit: `deno task summary-audit` also checks `site/catalog/hx-task-summaries.md` against `harness-tasks/tasks/*/prompt.md`, with the same rules (sha match, 600-character cap, no duplicates). It does not apply the baseline file: an HX task without a summary is allowed, so the page shows "No summary yet." `--print-sha HX-001` works for HX ids.

- [ ] **Step 1: Write failing tests:**
  - API: seed `hx_tasks` with the sha of a test summary body's entry; the response has `summary` equal to the body. A mismatched sha gives `summary: null`.
  - Audit: an HX entry with a wrong sha is reported, and the CLI exits 1.
- [ ] **Step 2:** Run `cd site && npm run build && npx vitest run tests/api/setups.test.ts`, and `deno task test:unit` filtered to the audit test file (`deno test --allow-all tests/unit/scripts/audit-task-summaries.test.ts` if that is where the existing audit test lives; check first). Expected: FAIL.
- [ ] **Step 3:** Implement the module, the page and the audit extension.
- [ ] **Step 4:** Re-run both. Expected: PASS. Run `deno task summary-audit`. Expected: exit 0.
- [ ] **Step 5:** Commit `feat(site): HX task pages with human summaries`.

### Task 10: End-to-end check

**Files:**
- Modify: `site/scripts/seed-e2e.ts` (insert the Task 3 seed data as SQL)
- Create: `site/tests/e2e/setups.spec.ts`

- [ ] **Step 1:** Write the spec:
  - `/setups` shows `cc-plain` and `pi-default` and not `cc-secret`; the toggle shows `cc-secret` marked "private".
  - Ticking two rows and following Compare lands on `/setups/compare?ids=...`.
  - The detail page of `cc-plain` shows "Known cost issues" and two history rows.
  - `/hx-tasks/HX-001` shows "No summary yet." and no prompt text.
  - `/setups/archive` lists both sets.
  - Run the existing axe check (`a11y.spec.ts` pattern) on `/setups` and `/setups/cc-plain`.
- [ ] **Step 2:** Run `cd site && npm run test:e2e:ci -- setups`. Expected: PASS (the pages already exist; fix any real failure at its root).
- [ ] **Step 3:** Run the full site suite: `cd site && npm test`. Expected: all green.
- [ ] **Step 4:** Commit `test(site): setups end-to-end`.

## Not in this plan

- The submission form and admin review page (plan 2).
- Writing `setups`, `setup_runs`, `setup_cells` and `hx_tasks` from harness runs, and promoting a setup task set (plan 3).
- Prod migration, deploy, and the human summaries for HX tasks (owner).
