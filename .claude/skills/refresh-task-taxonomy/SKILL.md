---
name: refresh-task-taxonomy
description: >-
  Refresh the CentralGauge task taxonomy — the 9 groups + ~72 facet tags that
  power the site's task discoverability filter and per-category model analysis.
  Use when tasks are added/changed/removed in tasks/, when the taxonomy feels
  stale or under-covers a workflow, or on a periodic cadence. The taxonomy is
  UI/analysis-only metadata, fully decoupled from the task_set hash, so
  refreshing it NEVER triggers a re-bench. Produces site/catalog/task-categories.yml
  and pushes it to prod via `sync-taxonomy --apply`.
---

# Refresh Task Taxonomy

The site categorizes benchmark tasks two ways, both filterable on `/tasks` and
used for per-category model strength analysis:

- **Groups** — 9 mutually-exclusive buckets (one per task): `data-modeling`,
  `pages-ui`, `business-logic`, `interfaces-events`, `error-transactions`,
  `integration-serialization`, `reflection-datatransfer`, `records-runtime`,
  `queries-performance`.
- **Facet tags** — ~72 cross-cutting facets (0..N per task), e.g. `recordref`,
  `flowfield`, `json`, `secrettext`, `xrec`, `v16`. A tag may span groups.

Both live ONLY in `site/catalog/task-categories.yml` and in D1 columns/joins
(`task_categories`, `tags`, `task_tags`, `tasks.category_id`). **None of this is
part of the task_set hash** (which covers `tasks/**/*.yml` + `tests/al/**`), so
editing the taxonomy and re-syncing is free — no re-bench, the leaderboard hash
is untouched. See CLAUDE.md "Task taxonomy" for the runtime contract.

## When to run this

- **A task was added.** New tasks are absent from the catalog → they show under
  no group/tags and are unfindable in the filter until re-tagged.
- **Tasks were renamed/removed.** Removed groups/tags should be pruned (the sync
  is declarative and prunes orphan groups; tags get replaced wholesale).
- **The taxonomy under-covers a real workflow** (someone can't find tests for X).
- **Periodic hygiene** — every few task-authoring rounds, refresh so coverage
  keeps pace with the suite.

This is cheap and safe to run anytime; it does not touch benchmark results.

## Bundled scripts

All in `.claude/skills/refresh-task-taxonomy/pipeline/` (run from the REPO ROOT
so their relative `tasks/` and `site/catalog/` paths resolve):

| Script | Role |
|---|---|
| `build-taxonomy.ts` | Rule-based GROUP assignment (slug/tag regexes + 5 manual overrides) + canonicalized author tags → first-pass `task-categories.yml`. Fast, deterministic, but tags are only as good as the thin author tags. |
| `enrich-task-tags.workflow.js` | **The quality step.** A Workflow that fans out ~12 agents to read every task spec and assign facets from a controlled vocabulary by CONTENT (catches facets the author never tagged), and flags vocab gaps. |
| `merge-taxonomy.ts` | Merge the workflow's content facets onto the rule-based groups → final `task-categories.yml`. Drops the ubiquitous `codeunit` noise facet; adds reviewed niche facets. |
| `classify-categories.ts` | Group-only preview + counts (sanity check the group balance). |
| `category-strength.ts` | Per-model strength-by-category from a `/api/v1/matrix` JSON (for analysis/blogging, not the sync). |

## Procedure

### 1. First-pass groups + base tags (deterministic)
```bash
deno run --allow-read --allow-write .claude/skills/refresh-task-taxonomy/pipeline/build-taxonomy.ts
```
Review the printed group counts — aim for each group ≥ ~5 tasks. If a new task
mis-grouped, add a manual override in `build-taxonomy.ts` (`GROUP_OVERRIDE`) or
adjust a `GROUP_RULES` regex, and re-run.

### 2. Content-based facet enrichment (the quality step) — Workflow
This is why the tags are good: agents read each task's actual content, not just
the author tags. Run the bundled workflow via the **Workflow tool**:

- Gather the task file paths: `ls tasks/easy/*.yml tasks/medium/*.yml tasks/hard/*.yml | jq -R . | jq -s -c .`
- Invoke `Workflow({ scriptPath: ".claude/skills/refresh-task-taxonomy/pipeline/enrich-task-tags.workflow.js", args: <that JSON array of paths> })`.
  (The script tolerates `args` arriving as a JSON string — it parses it.)
- It returns `{ taskTags: {ID: [facets]}, facetFreq, vocabGaps, ... }`.
- **Review `vocabGaps`** — facets agents wanted that aren't in the controlled
  vocab. Fold each into an existing facet, or add it to the `VOCAB` array in the
  workflow script (and re-run) if it's a genuinely new, searchable concept.

Save the workflow's `taskTags` object to
`.claude/skills/refresh-task-taxonomy/pipeline/enriched-tags.json`.

### 3. Merge → final catalog file
```bash
deno run --allow-read --allow-write .claude/skills/refresh-task-taxonomy/pipeline/merge-taxonomy.ts
```
Writes `site/catalog/task-categories.yml` (groups from step 1 + content facets
from step 2). Check the printed facet frequency + the "tasks with 0 facets" list
(2–3 generic tasks with no facet is fine; a NEW task with 0 facets usually means
it needs a manual `ADD` entry in `merge-taxonomy.ts` or a vocab gap to close).

### 4. Sanity-review the YAML
Skim `site/catalog/task-categories.yml`: every task has a sensible group; the new
tasks carry the facets a developer would search by.

### 5. Sync to prod (decoupled — no re-bench)
```bash
deno task start sync-taxonomy            # DRY-RUN: prints counts + target hash
deno task start sync-taxonomy --apply    # POSTs to /api/v1/admin/catalog/task-taxonomy
```
The sync auto-discovers the current task-set hash and is declarative: it upserts
groups+tags, repoints `tasks.category_id`, replaces `task_tags`, and **prunes
orphan groups** (old groups no longer in the file, if unreferenced). It never
writes `task_sets` or task content.

> If migration `0010_task_tags.sql` has not been applied to a target D1 yet:
> `cd site && wrangler d1 migrations apply centralgauge --remote` first.

### 6. Verify live
```bash
curl -s "https://ai.sshadows.dk/api/v1/taxonomy?_cb=$(date +%s)" | jq '{groups:(.groups|length), tags:(.tags|length)}'
curl -s "https://ai.sshadows.dk/api/v1/categories?_cb=$(date +%s)" | jq '[.data[]|{slug,task_count}]'   # all count>0, no orphans
curl -s -o /dev/null -w "%{http_code}\n" "https://ai.sshadows.dk/tasks?category=pages-ui&tag=v16"        # 200
```
Confirm the group/tag counts look right, `/api/v1/categories` shows ONLY
populated groups (no 0-count orphans), and the leaderboard hash is unchanged
(`/api/v1/leaderboard?set=current` still shows the same #1 / hash → no re-bench).

## Gotchas

- **Run scripts from the repo root**, not the skill dir — they use relative
  paths (`tasks/`, `site/catalog/`).
- **Do NOT** add categories/tags back into the task YAML `metadata:` to "fix"
  coverage — that's the hashed content and would force a re-bench. The catalog
  file is the only source of truth for the UI.
- The skill's scripts are the committed copies; the repo's `scripts/` copies are
  gitignored scratch. Edit the skill copies when tuning rules/vocab.
- `sync-taxonomy --apply` needs the admin ingest key configured (`.centralgauge.yml`)
  and the worker deployed with the `/api/v1/admin/catalog/task-taxonomy` endpoint.
