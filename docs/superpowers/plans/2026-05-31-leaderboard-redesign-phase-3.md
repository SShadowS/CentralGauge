# Leaderboard Redesign — Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Source open-weight/proprietary status as a per-family attribute, surface it on the leaderboard, and use it for two features: a **"Best open-weight" recommendation tile** and an **Open / Proprietary filter**.

**Architecture:** Open-weight is a property of the model **family** (e.g. DeepSeek/Qwen/Kimi/Llama/Mistral/Gemma = open; Claude/GPT/Gemini/Grok = proprietary). Add an `open_weight` column to the `model_families` table (additive migration), set it in the `model-families.yml` catalog source of truth, carry it through the families admin upsert + `sync-catalog`, then JOIN it onto each leaderboard row (the query already joins `model_families`). The frontend reads a new `open_weight` field on `LeaderboardRow` to render the tile and to drive an `openness` filter param. The DB migration and prod catalog sync are **flagged manual operator steps** — this plan produces the code, migration file, catalog data, and tests, but does NOT run wrangler against prod.

**Tech Stack:** SvelteKit (Svelte 5 runes), TypeScript, D1 (SQLite migration), Vitest (`vitest.config.ts` Worker pool for D1/endpoint tests, `vitest.unit.config.ts` for pure/component tests). Deno CLI side for `sync-catalog` (outside `site/`).

---

## Background the engineer needs

- Run `npm` commands from `site/`. Do NOT run `deno fmt` on `site/` files. The Deno CLI side (`cli/`, `src/`) is formatted with `deno fmt` — scope it to changed files only.
- **Two test runners** (same as Phase 2): Worker-pool tests (D1/endpoint) via `npx vitest run <file>`; pure/component via `npx vitest run --config vitest.unit.config.ts <file>`. CI mirror: `npm run test:main` + `npm run build`.
- **Confirmed schema/locations:**
  - `model_families` table: `id, slug, vendor, display_name` (`site/migrations/0001_core.sql`). Migrations are numbered; the next is **`0011`** (0010 is the latest).
  - Families admin upsert: `site/src/routes/api/v1/admin/catalog/families/+server.ts` — `INSERT INTO model_families(slug, vendor, display_name) ...` around line 44. It almost certainly validates the request body with a Zod schema — find and extend it.
  - Leaderboard query: `site/src/lib/server/leaderboard.ts` — `JOIN model_families mf ON mf.id = m.family_id` (line ~414), selects `mf.slug AS family_slug` (line ~374), maps the row at line ~554. `LeaderboardRow` is in `site/src/lib/shared/api-types.ts` (has `family_slug` top-level).
  - Query parse: `site/src/routes/api/v1/leaderboard/+server.ts` `parseQuery` (parses `tier`/`difficulty`/`family`/`since`/`category`/`sort`). `LeaderboardQuery` type is in `api-types.ts`.
  - Catalog source: `site/catalog/model-families.yml` (list of `{ slug, vendor, display_name }`).
  - Recommendation tiles: `site/src/lib/shared/recommendation-tiles.ts` (`pickRecommendations` → `{ overall, value, fastest }`); rendered by `site/src/lib/components/domain/RecommendationTiles.svelte`.
  - Category tabs / filters live around the page `.results` block and `FilterRail` in `site/src/routes/+page.svelte`.
- **`sync-catalog`** (Deno CLI) reads `model-families.yml` and POSTs to the families admin endpoint. It lives outside `site/` (search `cli/` + `src/` for the families payload builder). It must send `open_weight`.

## Open-weight classification (apply in Task 1)

Set `open_weight: true` for families whose weights are publicly downloadable; `false` otherwise. Guidance for the families currently in `model-families.yml` (read the full file and classify every family):

| Open (`true`) | Proprietary (`false`) |
|---|---|
| deepseek, qwen* , kimi/moonshot, llama/meta, mistral, gemma | claude, gpt, gemini, grok |

If a family's openness is genuinely ambiguous, default to `false` (proprietary) and note it — a wrong "open" claim is worse than a conservative "proprietary".

## File Structure

| File | Create/Modify | Responsibility |
|---|---|---|
| `site/migrations/0011_family_open_weight.sql` | Create | `ALTER TABLE model_families ADD COLUMN open_weight INTEGER` (nullable; 1=open, 0=proprietary, NULL=unknown). |
| `site/catalog/model-families.yml` | Modify | Add `open_weight: true/false` to every family. |
| `site/src/routes/api/v1/admin/catalog/families/+server.ts` | Modify | Accept + upsert `open_weight` (extend Zod schema + INSERT…ON CONFLICT). |
| (Deno CLI) sync-catalog families payload builder | Modify | Include `open_weight` in the POST body. |
| `site/src/lib/server/leaderboard.ts` | Modify | Select `mf.open_weight`; map to `row.open_weight` (boolean\|null); add the `openness` WHERE clause. |
| `site/src/lib/shared/api-types.ts` | Modify | `LeaderboardRow.open_weight?: boolean \| null`; `LeaderboardQuery.openness`. |
| `site/src/routes/api/v1/leaderboard/+server.ts` | Modify | Parse `openness` (`open`\|`proprietary`\|null). |
| `site/src/lib/shared/recommendation-tiles.ts` | Modify | Add `open` pick (highest auc_2 among `open_weight === true`). |
| `site/src/lib/components/domain/RecommendationTiles.svelte` | Modify | Render the "Best open-weight" tile. |
| `site/src/lib/components/domain/OpennessFilter.svelte` | Create | 3-way segmented control (All / Open / Proprietary), radiogroup pattern. |
| `site/src/routes/+page.svelte` | Modify | Render `OpennessFilter` in the FilterRail; wire to `pushFilter({ openness })`; add `openness` to `FILTER_KEYS`. |

---

### Task 1: Migration + catalog data

**Files:**
- Create: `site/migrations/0011_family_open_weight.sql`
- Modify: `site/catalog/model-families.yml`

- [ ] **Step 1: Create the migration** (additive, nullable — mirror the style of `0009_model_metadata.sql`):
```sql
-- 0011_family_open_weight.sql — Mark model families as open-weight or proprietary.
-- open_weight: 1 = weights publicly downloadable, 0 = proprietary, NULL = unknown.
-- Additive only: no existing column touched, no constraint added. Backfilled by
-- sync-catalog --apply from model-families.yml; the families admin endpoint
-- writes it via INSERT … ON CONFLICT DO UPDATE.
ALTER TABLE model_families ADD COLUMN open_weight INTEGER;
```

- [ ] **Step 2: Read the full `site/catalog/model-families.yml`** and add `open_weight: true` or `open_weight: false` to EVERY family entry, using the classification table above. For any genuinely ambiguous family default to `false` and add a `# ` comment noting the uncertainty.

- [ ] **Step 3: Verify the YAML still parses.** Run `cd site && npx tsx -e "import fs from 'fs'; import { parse } from 'yaml'; const d = parse(fs.readFileSync('catalog/model-families.yml','utf8')); console.log(d.length, 'families;', d.filter(f=>f.open_weight===true).length, 'open;', d.filter(f=>f.open_weight===false).length, 'proprietary'); const missing = d.filter(f=>typeof f.open_weight!=='boolean'); if(missing.length) throw new Error('missing open_weight: '+missing.map(m=>m.slug).join(','));"` — confirm every family has a boolean `open_weight` (the script throws if any is missing). If the repo lacks a `yaml` dep for tsx, use the same YAML loader the catalog code uses (grep `parse.*yaml` in `site/` or the CLI).

- [ ] **Step 4: Commit:**
```bash
git add site/migrations/0011_family_open_weight.sql site/catalog/model-families.yml
git commit -m "feat(catalog): open_weight column + per-family open/proprietary classification"
```

---

### Task 2: Families admin upsert + sync-catalog carry `open_weight`

**Files:**
- Modify: `site/src/routes/api/v1/admin/catalog/families/+server.ts`
- Modify: (Deno CLI) the sync-catalog families payload builder
- Test: the families endpoint test (find with `grep -rln "admin/catalog/families\|families/+server" site/tests`)

- [ ] **Step 1: Read `families/+server.ts`.** Find the request-body validation (Zod schema) and the `INSERT INTO model_families(...)` statement. Note whether it's `INSERT ... ON CONFLICT(slug) DO UPDATE` (upsert) or plain insert.

- [ ] **Step 2: Write/extend a failing test** asserting that POSTing a family with `open_weight: true` persists and reads back as open-weight. Mirror the existing families-endpoint test's request shape + auth/seed. If no endpoint test exists, add a focused one using the Worker-pool harness (same pattern as `tests/server/tier-data.test.ts` / the leaderboard endpoint test).

- [ ] **Step 3: Extend the schema + upsert.**
  - Add `open_weight: z.boolean().nullable().optional()` (match the file's Zod import style) to the family item schema.
  - Add `open_weight` to the INSERT column list and the `ON CONFLICT DO UPDATE SET` list. Bind `item.open_weight === undefined ? null : item.open_weight ? 1 : 0` (store as INTEGER 0/1/NULL).

- [ ] **Step 4: Update the Deno CLI sync-catalog families payload.** `grep -rln "model-families\|families" cli src | grep -i sync` (or search for where `model-families.yml` is read and POSTed). Add `open_weight: fam.open_weight ?? null` to the per-family payload object. Run `deno check` + `deno fmt` on the changed CLI file ONLY.

- [ ] **Step 5: Verify.** `cd site && npx vitest run <families endpoint test>` — green. `cd site && npx svelte-check --tsconfig ./tsconfig.json --threshold error` — no new errors. For the CLI change: `deno check <changed file>`.

- [ ] **Step 6: Commit:**
```bash
git add site/src/routes/api/v1/admin/catalog/families/+server.ts <families test> <cli sync file>
git commit -m "feat(catalog): families upsert + sync-catalog carry open_weight"
```

---

### Task 3: Surface `open_weight` on the leaderboard row

**Files:**
- Modify: `site/src/lib/shared/api-types.ts`
- Modify: `site/src/lib/server/leaderboard.ts`
- Test: the leaderboard endpoint/query test (find with `grep -rln "computeLeaderboard\|api/v1/leaderboard" site/tests`)

- [ ] **Step 1: Add the type.** In `api-types.ts`, add to `LeaderboardRow` (top-level, beside `family_slug`):
```ts
  /** Whether the model's family is open-weight (weights downloadable). null when
   * the family's openness is unknown. Sourced from model_families.open_weight. */
  open_weight?: boolean | null;
```

- [ ] **Step 2: Write a failing test** asserting a seeded open-weight family surfaces `open_weight: true` on its leaderboard row (and a proprietary one `false`). Use the leaderboard query/endpoint test harness; seed two families with `open_weight` 1 and 0.

- [ ] **Step 3: Select + map.** In `leaderboard.ts`:
  - Add `mf.open_weight AS open_weight` to the SELECT (near `mf.slug AS family_slug`).
  - In the row type for the query result, add `open_weight: number | null`.
  - In the row mapper (~line 554), map: `open_weight: r.open_weight === null || r.open_weight === undefined ? null : r.open_weight === 1`.

- [ ] **Step 4: Verify** the test passes; typecheck clean; `npm run build` ok.

- [ ] **Step 5: Commit:**
```bash
git add site/src/lib/shared/api-types.ts site/src/lib/server/leaderboard.ts <leaderboard test>
git commit -m "feat(leaderboard): surface family open_weight on each row"
```

---

### Task 4: `openness` filter (query layer)

**Files:**
- Modify: `site/src/lib/shared/api-types.ts` (`LeaderboardQuery`)
- Modify: `site/src/routes/api/v1/leaderboard/+server.ts` (`parseQuery`)
- Modify: `site/src/lib/server/leaderboard.ts` (WHERE clause)
- Test: leaderboard endpoint/query test

- [ ] **Step 1: Add `openness` to `LeaderboardQuery`** in api-types.ts: `openness: 'open' | 'proprietary' | null;`

- [ ] **Step 2: Parse it** in `+server.ts` `parseQuery`:
```ts
const opennessRaw = url.searchParams.get('openness');
const openness = opennessRaw === 'open' || opennessRaw === 'proprietary' ? opennessRaw : null;
```
Return `openness` in the query object. (Invalid values fall through to null — no 400, matching the lenient parse style of `sort`.)

- [ ] **Step 3: Write a failing test** asserting `?openness=open` returns only open-weight models and `?openness=proprietary` only proprietary ones. Seed both kinds.

- [ ] **Step 4: Add the WHERE clause** in `leaderboard.ts` `computeLeaderboard`. Where the other filters add to the `wheres` array (family/since/tier/difficulty), add:
```ts
if (q.openness === 'open') { wheres.push('mf.open_weight = 1'); }
else if (q.openness === 'proprietary') { wheres.push('mf.open_weight = 0'); }
```
(No bind param needed — the literals are safe; or use a bound `?` with value 1/0 to match the file's style. Match whatever the surrounding filters do. NULL open_weight rows are excluded from both filters, which is correct — unknown openness shouldn't claim either bucket.)

- [ ] **Step 5: Verify** the test passes; the subquery interpolation slots (the file warns correlated subqueries must mirror outer WHERE — check whether `mf.open_weight` needs mirroring in the p1/p2 subqueries; it likely does NOT because those subqueries filter by model, not family, but VERIFY by reading the query and running the existing leaderboard tests). `npm run build && npm run test:main` green.

- [ ] **Step 6: Commit:**
```bash
git add site/src/lib/shared/api-types.ts site/src/routes/api/v1/leaderboard/+server.ts site/src/lib/server/leaderboard.ts <test>
git commit -m "feat(leaderboard): openness (open/proprietary) filter"
```

---

### Task 5: "Best open-weight" tile

**Files:**
- Modify: `site/src/lib/shared/recommendation-tiles.ts` (+ its test)
- Modify: `site/src/lib/components/domain/RecommendationTiles.svelte` (+ its test)

- [ ] **Step 1: Write failing tests** for `pickRecommendations` — add an `open` field to the result that is the highest-auc_2 row with `open_weight === true`, null when none. Add a case to `recommendation-tiles.test.ts`:
```ts
it('open = highest auc_2 among open-weight models only', () => {
  const rows = [
    row({ model: { slug: 'opus', display_name: 'Opus', api_model_id: 'o', settings_suffix: '' }, auc_2: 0.85, open_weight: false }),
    row({ model: { slug: 'ds', display_name: 'DeepSeek', api_model_id: 'd', settings_suffix: '' }, auc_2: 0.71, open_weight: true }),
    row({ model: { slug: 'qw', display_name: 'Qwen', api_model_id: 'q', settings_suffix: '' }, auc_2: 0.68, open_weight: true }),
  ];
  expect(pickRecommendations(rows).open?.model.slug).toBe('ds');
});
it('open is null when no model is open-weight', () => {
  const rows = [row({ open_weight: false }), row({ open_weight: null })];
  expect(pickRecommendations(rows).open).toBeNull();
});
```
(Add `open_weight` to the test fixture's `row()` factory default, e.g. `open_weight: null`.)

- [ ] **Step 2: Run, confirm FAIL.**

- [ ] **Step 3: Implement.** In `recommendation-tiles.ts`:
  - Add `open: TilePick | null` to the `Recommendations` interface.
  - Compute: `const openEligible = rows.filter((r) => r.open_weight === true); const openRow = openEligible.sort((a,b) => auc(b) - auc(a))[0]; const open = openRow ? { model: openRow.model, row: openRow } : null;`
  - Return `open` in the result.

- [ ] **Step 4: Render the tile.** In `RecommendationTiles.svelte`, add a 4th tile after Fastest:
```svelte
  <div class="tile">
    <p class="k"><span aria-hidden="true">🔓</span> Best open-weight</p>
    {#if rec.open}
      <p class="v"><ModelLink slug={rec.open.model.slug} display_name={rec.open.model.display_name} api_model_id={rec.open.model.api_model_id} family_slug={rec.open.row.family_slug} /><SettingsBadge suffix={rec.open.model.settings_suffix} /></p>
      <p class="sub">{auc2Display(rec.open.row).toFixed(1)} AUC{#if rec.open.row.tier} · Tier {rec.open.row.tier}{/if}</p>
    {:else}<p class="v">—</p>{/if}
  </div>
```
Update the `.tiles` grid to 4 columns: `grid-template-columns: repeat(4, 1fr);` and confirm the existing `@media (max-width: 768px)` 1-col rule still applies; add a `@media (max-width: 1100px) { .tiles { grid-template-columns: repeat(2, 1fr); } }` so 4 tiles wrap to 2 before collapsing to 1.

- [ ] **Step 5: Update the RecommendationTiles component test** to assert the open tile heading renders (add `open_weight: true` to one fixture row and assert `/best open-weight/i` plus the model name).

- [ ] **Step 6: Run all the above tests (unit config), confirm green. Typecheck clean.**

- [ ] **Step 7: Commit:**
```bash
git add site/src/lib/shared/recommendation-tiles.ts site/src/lib/shared/recommendation-tiles.test.ts site/src/lib/components/domain/RecommendationTiles.svelte site/src/lib/components/domain/RecommendationTiles.test.ts
git commit -m "feat(leaderboard): Best open-weight recommendation tile"
```

---

### Task 6: Open / Proprietary filter UI

**Files:**
- Create: `site/src/lib/components/domain/OpennessFilter.svelte` (+ test)
- Modify: `site/src/routes/+page.svelte`

- [ ] **Step 1: Write the failing test** for `OpennessFilter` (3-way radiogroup: All / Open / Proprietary; emits `null | 'open' | 'proprietary'`), mirroring `CategoryTabs.test.ts`:
```ts
// site/src/lib/components/domain/OpennessFilter.test.ts
import { render, fireEvent } from '@testing-library/svelte';
import { describe, it, expect, vi } from 'vitest';
import OpennessFilter from './OpennessFilter.svelte';

describe('OpennessFilter', () => {
  it('marks All active when value is null and emits a choice on click', async () => {
    const onselect = vi.fn();
    const { getByRole } = render(OpennessFilter, { props: { value: null, onselect } });
    expect(getByRole('radio', { name: /all/i }).getAttribute('aria-checked')).toBe('true');
    await fireEvent.click(getByRole('radio', { name: /open/i }));
    expect(onselect).toHaveBeenCalledWith('open');
  });
  it('emits null when All is clicked', async () => {
    const onselect = vi.fn();
    const { getByRole } = render(OpennessFilter, { props: { value: 'open', onselect } });
    await fireEvent.click(getByRole('radio', { name: /^all$/i }));
    expect(onselect).toHaveBeenCalledWith(null);
  });
});
```

- [ ] **Step 2: Run, confirm FAIL.**

- [ ] **Step 3: Create `OpennessFilter.svelte`** mirroring `SortPresets.svelte`/`CategoryTabs.svelte` (radiogroup, roving tabindex, arrow keys). Options: `[{ v: null, label: 'All' }, { v: 'open', label: 'Open' }, { v: 'proprietary', label: 'Proprietary' }]`. Props `{ value: 'open'|'proprietary'|null, onselect: (v)=>void }`. `aria-label="Model availability"`. Use the same `.tab`/active styles as CategoryTabs (or import a shared style approach consistent with the codebase). Verify tokens exist.

- [ ] **Step 4: Run the test, confirm PASS (2 tests).**

- [ ] **Step 5: Wire into `+page.svelte`:**
  - Import `OpennessFilter`.
  - Add `'openness'` to the `FILTER_KEYS` set (so the chip renders + clears).
  - Render it in the `<FilterRail>` below `<SetPicker>`:
```svelte
<OpennessFilter value={data.filters.openness ?? null} onselect={(v) => pushFilter({ openness: v })} />
```
  Confirm `data.filters.openness` exists on the load data (it comes from `payload.filters` which is the parsed `LeaderboardQuery` — Task 4 added `openness`). If the load `filters` type doesn't include it yet, ensure the server returns it (it will, since `parseQuery` returns it in the query echoed as `filters`).

- [ ] **Step 6: Extend `page-compose.test.ts`** — add an assertion that the openness filter renders (a third radiogroup, or assert the "Open"/"Proprietary" labels). Update the `toBe(2)` radiogroup-count assertion from Phase 2 to `toBe(3)` (SortPresets + CategoryTabs + OpennessFilter) — but only if OpennessFilter renders unconditionally; if it's guarded, keep the assertion consistent with the guard.

- [ ] **Step 7: Full check:** unit-config page test green; `svelte-check` clean; `npm run build && npm run test:main` green.

- [ ] **Step 8: Commit:**
```bash
git add site/src/lib/components/domain/OpennessFilter.svelte site/src/lib/components/domain/OpennessFilter.test.ts site/src/routes/+page.svelte site/src/routes/page-compose.test.ts
git commit -m "feat(leaderboard): open/proprietary filter control"
```

---

### Task 7: Verification + PR + operator handoff

**Files:** none (verification + docs)

- [ ] **Step 1: Build + preview:** `cd site && npm run build && npm run preview`.

- [ ] **Step 2: Verify against the spec:**
  - "Best open-weight" tile renders as the 4th tile (shows the top open model + tier). Falls back to "—" when no open model (note: with a real prod DB that has open families, it should populate).
  - Open/Proprietary filter: selecting "Open" adds `?openness=open`, filters the table to open-weight models, shows a removable chip; "Proprietary" filters the other way; "All" clears it.
  - Tiles + tabs + sort presets all still work together; 4 tiles wrap to 2 then 1 on narrow screens.
  - Keyboard: all three radiogroups (category, sort, openness) reachable + arrow-navigable.

- [ ] **Step 3: Document the operator steps** (do NOT run these — they touch prod). Append a short "Phase 3 deploy" note to the PR body listing the manual steps:
  1. Apply the migration to prod D1: `wrangler d1 migrations apply <db> --remote` (needs `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN`). If `d1_migrations` is out of sync, see the CLAUDE.md backfill note.
  2. Push the families catalog: `centralgauge sync-catalog --apply` (writes `open_weight` to prod `model_families`). Rate-limit: ~10 req/min on admin endpoints.
  3. Bump the leaderboard cache version if the response shape changed (the `_cv` note in CLAUDE.md) so cached responses don't serve pre-`open_weight` payloads.
  4. Deploy the site: `cd site && npm run deploy`.

- [ ] **Step 4: Open the PR:**
```bash
git push -u origin leaderboard-redesign-phase-3
gh pr create --base master --head leaderboard-redesign-phase-3 \
  --title "Leaderboard redesign — Phase 3 (open-weight tile + open/proprietary filter)" \
  --body "Implements Phase 3 of the redesign spec. Adds an open_weight column to model_families (migration 0011 + per-family classification in model-families.yml), carries it through the families upsert + sync-catalog, surfaces it on each leaderboard row, and uses it for a Best open-weight tile + an Open/Proprietary filter. Includes the manual prod operator steps (D1 migration, sync-catalog, cache bump, deploy) in the checklist below. Phases 4-5 (row-expand, value-map scatter) follow."
```

---

## Self-Review

**Spec coverage (Phase 3 scope):**
- Open-weight/license sourcing → Task 1 (migration + catalog), Task 2 (sync). ✓
- Surface on row → Task 3. ✓
- Best open-weight tile → Task 5. ✓
- Open/proprietary filter → Task 4 (query) + Task 6 (UI). ✓

**Placeholder scan:** no TBD/TODO. The two cross-repo unknowns (the families Zod schema shape in Task 2; the Deno-side sync-catalog payload builder location) are handled with explicit `grep`/find steps because their exact form can't be quoted without reading them — each step says what to add and how to verify.

**Type consistency:** `open_weight?: boolean | null` on `LeaderboardRow` (Task 3) is consumed by `pickRecommendations` (Task 5, `r.open_weight === true`) and produced by the row mapper (Task 3). `LeaderboardQuery.openness` (Task 4) is parsed in `+server.ts` (Task 4) and read as `data.filters.openness` in `+page.svelte` (Task 6). `Recommendations.open` (Task 5) is rendered in `RecommendationTiles.svelte` (Task 5).

**Known risks:**
- **Prod migration is manual** (Task 7). Until applied + synced, `open_weight` is NULL in prod → the tile shows "—" and `?openness=open` returns nothing. That is graceful (no error), but the feature is dark until the operator runs the steps. Flagged in the PR body.
- **Correlated-subquery mirroring** (Task 4 Step 5): the leaderboard query warns that outer WHERE clauses must be mirrored in p1/p2 correlated subqueries. The `openness` filter is on `model_families` (a family-level JOIN), not on tasks/results, so it likely does NOT need mirroring — but Task 4 Step 5 explicitly verifies this by reading the query and running the existing leaderboard tests before committing.
- **`tasks_*` denominator interaction:** `openness` filters which MODELS appear, not which tasks count, so it does not change denominators (unlike category/difficulty). No denominator logic change needed.

**Out of scope (later phases):** row-expand researcher detail (P4), value-map scatter (P5).
