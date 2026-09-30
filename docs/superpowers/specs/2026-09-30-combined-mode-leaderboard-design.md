# Combined-mode leaderboard (amends batch-mode D4)

Date: 2026-09-30. Status: design approved in conversation, awaiting spec review.

## Problem

The batch-mode spec (`2026-09-06-batch-mode-design.md`, decision D4) makes every
ranking query select exactly one invocation mode. That was safe while a task set
held one mode. On 2026-09-29 GPT-6.1 Sol had to run in sync mode (OpenAI's Batch
API rejects `gpt-6.1-sol`) while every other model in the current set had batch
runs. The set became mixed-mode, the leaderboard page fell back to `sync`, and the
default view showed a single model. The twelve batch models were only reachable
through `?mode=batch`.

The owner wants one leaderboard that ranks the batch models and the sync-only model
together.

## Decisions

| ID | Decision |
| -- | -------- |
| C1 | A new ranking mode, `combined`, ranks every model in the set. Each model contributes the runs of ONE mode only; modes are never pooled within a model. |
| C2 | A model's served mode is the mode with more non-excluded runs in the task set. A tie goes to `batch`. |
| C3 | The served mode is computed over the whole task set, never narrowed by category, tier, since or any other filter, so a filter can never flip a model's mode. |
| C4 | A sync-served model is a normal tier member: one joint paired-bootstrap matrix, no separate bands. |
| C5 | A mixed-mode set with no `?mode=` resolves to `combined`. It no longer refuses with `mode_required`. |
| C6 | Explicit `?mode=sync` and `?mode=batch` keep today's SQL and results exactly. `mode=all` stays refused. |
| C7 | A row whose served mode is the minority among the rows shown carries a mode badge. |

The D4 rationale still holds: batch drops continuation, empty retries and refusal
fallback, and uses a different retry ladder. A sync-served model therefore had
rescues the batch models did not. The badge (C7) and the page notice make that
visible; they do not correct for it.

## API

- `InvocationMode` stays `"sync" | "batch"` (what a run is). A new type
  `RankMode = InvocationMode | "combined"` is what a ranking query selects.
- `parseModeParam` accepts `combined`. `all` still throws
  `400 invalid_mode_for_metric`; any other value throws `400 invalid_mode`.
- `resolveInvocationMode(db, scope, requested)` returns `RankMode`: the requested
  mode when given; `sync` for a set with no counted runs; the only mode when one is
  present; `combined` when both are present (C5).
- New `resolveModeBinding(db, scope, mode)` returns the string every mode predicate
  binds. For `sync`/`batch` it is the literal mode. For `combined` it is a JSON
  object mapping `model_id` to served mode, built by one query:

  ```sql
  SELECT json_group_object(model_id, mode) AS map FROM (
    SELECT model_id,
           CASE WHEN SUM(invocation_mode = 'batch') >= SUM(invocation_mode = 'sync')
                THEN 'batch' ELSE 'sync' END AS mode
      FROM runs
     WHERE task_set_hash = ?          -- or IN (SELECT hash FROM task_sets WHERE is_current = 1)
       AND excluded_at IS NULL
     GROUP BY model_id)
  ```

- Every ranked row gains `served_mode: "sync" | "batch"`. It comes from the map in
  combined mode and equals the requested mode otherwise. The envelope's existing
  `filters.mode` field reports `combined`.
- `CACHE_VERSION` bumps from `v16` to `v17` (rows gain `served_mode`). Every cache
  key that carries a mode today carries `combined` for this mode.

## Queries

- `modePredicate(alias, mode)`:
  - `sync`/`batch`: `<alias>.invocation_mode = ?` (unchanged).
  - `combined`: `<alias>.invocation_mode = json_extract(?, '$."' || <alias>.model_id || '"')`.

  Both forms contain exactly one `?` in the same position. Call sites bind the
  value from `resolveModeBinding` where they bind `mode` today, so no positional
  bind order changes anywhere (including the documented order in
  `model-aggregates.ts:438-441` and the families route).
- Hand-written predicates move onto `modePredicate`:
  `matrix.ts:171`, `matrix.ts:211`, `matrix.ts:286`, `tier-data.ts:102`, and the
  alias-less `upstream_profiles` query at `leaderboard.ts:647` (it gains an alias).
- `upstream-profile.ts:45` binds `model_id = ?` alongside the mode. In combined
  mode it binds that model's served mode, looked up in JS from the parsed map.
- The existing 12 `modePredicate(...)` call sites in `leaderboard.ts`,
  `model-aggregates.ts` and `families/[slug]/+server.ts` change only their bound
  value.
- Tiers (`tier-data.ts`) build the per-(model, task) matrix with the combined
  predicate. Each model's cells come from its served mode; the bootstrap runs over
  one joint matrix (C4). The tier cache key carries `combined`.
- Upstream profiles: one profile per (model, set, mode) already exists; combined
  mode reads the profile of the served mode. No schema change.
- No D1 migration. The change is worker-only.

## UI

- `ModeFilter` gains a third option. Order: `Combined` (the default on a mixed
  set), `Sync only`, `Batch only`. It renders when the set is mixed or `?mode=` is
  present, as today. `modeLinks` gains `combined`.
- In combined mode the `mode-notice` text becomes: "Each model is ranked on the run
  mode it has most runs in. Models marked sync were run without batch." with links
  "Sync only" and "Batch only". The existing sync-fallback notice stays for the
  `modeSplit` path.
- `LeaderboardTable.svelte` renders a small pill (`sync` or `batch`) next to the
  model name when the row's `served_mode` is the minority among the rows shown
  (C7), beside the existing `⤵N` and `n=` markers. Tooltip for `sync`: "Ranked on
  sync runs: continuation, empty retries and refusal fallback were available."
- Matrix and compare rows show the same pill. Model detail shows the served mode in
  its runs header. Page loaders keep passing `?mode=` through and default to
  combined through the API. `page-mode.ts` keeps its sync retry for an older
  worker; with this worker it never fires.
- `/runs` and run pages are unchanged (they already show each run's mode).

## Edge cases

- A set with zero counted runs resolves to `sync`, so the map is never needed empty.
- A model absent from the map makes `json_extract` return NULL, which matches no
  row, so the model is absent. That is correct: it has no counted runs.
- `runs exclude` / `runs include` already force-bump the data epoch, so the map
  and every cache refresh at once. Excluding runs can change a model's served mode;
  that is intended (C2 counts non-excluded runs).
- `mode=all` stays refused.

## Testing (TDD)

Extend the existing suites; write each failing test first.

- `tests/server/invocation-mode.test.ts`: `parseModeParam("combined")`; mixed set
  resolves to `combined`; map rule (majority wins, tie to batch, excluded runs not
  counted); predicate text for each mode.
- `tests/api/leaderboard-mode.test.ts`, fixture: two batch-only models, one
  sync-only model, one model with 1 batch + 2 sync runs. Combined view shows all
  four; `served_mode` is correct per row; each row's metrics equal that model's
  row in the matching single-mode response; a category or since filter does not
  change any `served_mode`; explicit `sync`/`batch` responses equal today's.
- Tier test: the sync-served model is present in the joint tier map.
- Combined cases added to `matrix`, `compare`, `families-mode`, `models-mode`,
  `model-detail-mode`, `og-mode` and `pages-mode` tests.
- Existing `mode_required` assertions that are inverted to expect `combined`
  (each changed deliberately, none dropped):
  - `tests/api/compare.test.ts:285-292` (keep the "mode resolves before model-list
    validation" intent: assert `too_few_models` now surfaces)
  - `tests/api/families-mode.test.ts:74-78`
  - `tests/api/leaderboard-mode.test.ts:75`
  - `tests/api/matrix.test.ts:360`
  - `tests/api/model-detail-mode.test.ts:75`
  - `tests/api/models-mode.test.ts:56-60`
  - `tests/api/og-mode.test.ts:18-43` (now a 200 image, not a visible 400)
  - `tests/server/invocation-mode.test.ts:73`
  - `tests/lib/page-mode.test.ts:73-77` stays: it tests the retry helper against a
    stubbed 400 and remains valid for an older worker.
- Before deploy: `cd site && npm run build`, `npm run test:main`,
  `npm run test:build`, then the `worker-pitfall-reviewer` agent.

## Rollout

1. Implement and test on a branch; merge to master.
2. `cd site && npm run deploy` (no migration; the deploy-order hook still asks).
3. Verify: `/api/v1/leaderboard` with no `mode` returns 13 rows on the current
   set, GPT-6.1 Sol with `served_mode: "sync"`, the other twelve `batch`.

## Docs

- `docs/batch-mode.md`: D4 amendment and the combined default.
- `.claude/rules/invocation-profile.md`: replace "a set with both modes and no
  `mode` is `400 mode_required`" with the combined default.
- `2026-09-06-batch-mode-design.md`: a "D4 amended by
  2026-09-30-combined-mode-leaderboard-design.md" note under the D4 row.
- `site/src/lib/server/invocation-mode.ts` and `page-mode.ts` header comments.

## Out of scope

- Correcting scores for the extra sync rescues (the badge only discloses them).
- Pooling both modes within one model.
- Any change to how runs are ingested, priced or excluded.
