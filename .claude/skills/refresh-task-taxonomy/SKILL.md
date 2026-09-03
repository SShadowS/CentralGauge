---
name: refresh-task-taxonomy
description: >-
  Refresh the CentralGauge task taxonomy — the 4 format groups and the
  mechanism/invariant/surface/environment facet tags that power the site's
  task filter and the per-format leaderboard slices. Use when tasks are
  added/changed/removed in tasks/, when a facet is wrong or missing, or on a
  periodic cadence. The taxonomy is UI/analysis-only metadata, fully decoupled
  from the task_set hash, so refreshing it NEVER triggers a re-bench. Produces
  site/catalog/task-categories.yml (schema version 2) and pushes it to prod via
  `sync-taxonomy --apply`.
---

# Refresh Task Taxonomy

The catalog at `site/catalog/task-categories.yml` is **schema version 2**. It
carries, for every task in `tasks/**/*.yml`:

- **One group = the task's FORMAT**, derived by rule from the manifest, never
  hand-assigned: `diagnose-composite` (manifest has `metadata.donors`),
  `diagnose-single` (a diagnose prompt template), `runtime-trap`
  (`code-gen.md` under cohort `ado-trap-2026`), `build-from-spec` (everything
  else). Rule order and the compatibility matrix are spec 4.1, implemented in
  `pipeline/format-rules.ts`.
- **Facets in four families** (`pipeline/facet-definitions.ts` defines each
  one): `mechanism` (the BC runtime semantic the task turns on), `invariant`
  (the domain contract the oracle grades), `surface` (AL objects and APIs
  touched), `environment` (execution requirements). A composite carries no
  facets of its own: its `derived_facets` are the union over its donors,
  computed by the pipeline.
- **`min_bc_version`** per task, and `donors` on composites.

**`metadata.category` in a task file is FROZEN and IGNORED.** It is hashed task
content, so editing it would force a re-bench, and nothing reads it any more.
The same goes for `metadata.tags`: the build step reads them only as raw input
to the surface alias table. Never add a category or tag to a manifest to fix
the taxonomy — fix the pipeline input instead.

None of this is part of the task_set hash (which covers `tasks/**/*.yml` +
`tests/al/**`), so editing the taxonomy and re-syncing is free.

## When to run this

- **Tasks were added, renamed or removed.** New tasks are absent from the
  catalog and unfindable in the site filter until the pipeline runs.
- **A facet is wrong.** Correct it in `pipeline/enriched-tags.json`, never in
  the emitted YAML (see Gotchas).
- **Periodic hygiene** — every few authoring rounds.

Cheap and safe to run anytime; it never touches benchmark results.

## Bundled scripts

All in `.claude/skills/refresh-task-taxonomy/pipeline/`, run from the REPO
ROOT (their `tasks/` and `site/catalog/` paths are relative):

| Script | Role |
|---|---|
| `format-rules.ts` | Group derivation + the compatibility matrix. No CLI. |
| `aliases.ts` | Raw manifest tag -> surface facet table, and the slug speller (acronyms, AL type names). No CLI. |
| `facet-definitions.ts` | The hand-written one-sentence definition of every mechanism, invariant and environment facet. No CLI. |
| `build-taxonomy.ts` | **Step 1.** Manifests -> draft catalog: groups, surface facets, `min_bc_version`, donors. |
| `enrich-task-tags.workflow.js` | **Step 2, the quality step.** A Workflow that fans agents out over the manifests (plus starter and reference code for diagnose tasks) to assign mechanism/invariant/environment facets from the closed vocabulary, and reports `vocabGaps`. |
| `merge-taxonomy.ts` | **Step 3.** Folds the enrichment in, stamps tag names and definitions, derives every composite from its donors. |
| `validate-taxonomy.ts` | **Step 4** (`deno task taxonomy-audit`). Exit 1 on any violation; also wired into CI. |
| `graph-fixture.ts` | **Step 5.** Publishes the task-donor component census to `docs/reasoning-suite/taxonomy-graph-fixture.json`. |
| `category-strength.ts` | Per-model strength profile from a `/api/v1/matrix` JSON. Analysis only, not part of the refresh. |

## Procedure

### 1. Build the draft from the manifests
```bash
deno run --allow-read --allow-write .claude/skills/refresh-task-taxonomy/pipeline/build-taxonomy.ts
```
Prints the per-format counts. It exits 1 and changes nothing if any manifest
violates the compatibility matrix — fix the manifest or, if the task is a
genuine exception, add a justified entry to `overrides:` in the catalog.

### 2. Enrich the analytic facets (Workflow) — NEW TASKS ONLY
Run the bundled workflow through the **Workflow tool**, passing only the
manifests that have no mechanism/invariant facets yet. Re-running it over the
whole suite discards the reviewed facets already in
`pipeline/enriched-tags.json` and costs a full re-review.

- Collect the new manifests' paths (relative to the checkout).
- `Workflow({ scriptPath: ".claude/skills/refresh-task-taxonomy/pipeline/enrich-task-tags.workflow.js", args: { root: "<checkout>", paths: [...], batch: 10 } })`
  (`args` may also be a bare JSON array of paths; the script parses a string.)
- **Merge** its `taskTags` into `pipeline/enriched-tags.json` — do not
  overwrite the file.
- **Review `vocabGaps`.** A gap that recurs on three or more tasks goes to the
  owner as a vocabulary proposal; adding a slug means editing
  `MECHANISM_VOCAB`/`INVARIANT_VOCAB`/`ENVIRONMENT_VOCAB` in
  `site/src/lib/shared/taxonomy-schema.ts`, the workflow's `VOCAB` list and
  `pipeline/facet-definitions.ts` together. Never ad hoc.

Composites are deliberately left empty here; their facets come from donors.

### 3. Merge and derive the composites
```bash
deno run --allow-read --allow-write .claude/skills/refresh-task-taxonomy/pipeline/merge-taxonomy.ts
```

### 4. Validate
```bash
deno task taxonomy-audit
```
Expects `[OK] taxonomy valid` and the per-format counts in
`pipeline/expected-counts.json`. A count mismatch means either a task landed
(update the expected counts deliberately, in the same commit) or a manifest
regressed.

### 5. Publish the component fixture
```bash
deno run --allow-read --allow-write .claude/skills/refresh-task-taxonomy/pipeline/graph-fixture.ts
```
Writes `docs/reasoning-suite/taxonomy-graph-fixture.json`: the task-donor
graph's components and the per-slice counts the leaderboard's resampling
depends on (spec 6.4).

**A new batch must pass steps 1, 2 (new tasks only), 3 and 4 before the tasks
are promoted.** Determinism is part of the contract: running steps 1 and 3
again on unchanged inputs must reproduce the catalog byte for byte.

### 6. Sync to prod (decoupled — no re-bench)
```bash
deno task start sync-taxonomy                       # DRY-RUN: prints counts + digest
deno task start sync-taxonomy --apply --hash <64-hex>
```
A schema-version-2 catalog **requires an explicit `--hash`** on `--apply`
(there is no auto-discovery), and the server side needs the revision-aware
admin endpoint and its migration deployed first — check before pushing. Add
`--allow-non-current` only to target a hash the server does not consider
current.

### 7. Verify live
```bash
curl -s "https://ai.sshadows.dk/api/v1/taxonomy?_cb=$(date +%s)" | jq '{groups:(.groups|length), tags:(.tags|length)}'
curl -s -o /dev/null -w "%{http_code}\n" "https://ai.sshadows.dk/tasks?tag=exact-total"
```
Confirm the leaderboard's task-set hash is unchanged (`/api/v1/leaderboard?set=current`)
— a taxonomy push never moves it.

## Gotchas

- **Run the scripts from the repo root**, not the skill directory.
- **Never hand-edit facets in `site/catalog/task-categories.yml`.** The build
  step deliberately does not carry vocabulary facets over from the previous
  catalog, so a hand-added facet vanishes on the next run and a hand-removed
  one comes back. `pipeline/enriched-tags.json` is the source of truth for
  mechanism/invariant/environment facets, the manifests plus `aliases.ts` for
  surface facets. Only `overrides:` is hand-edited in the YAML.
- **Tag names and definitions are generated too**: `aliases.ts` spells the
  name, `facet-definitions.ts` writes the description, and the merge step
  re-stamps both on every run. Edit those files, not the YAML.
- **Do NOT** add categories or tags back into a task's `metadata:` to "fix"
  coverage — that is hashed content and would force a re-bench.
- The skill's `pipeline/` copies are the committed ones. `.claude/` is
  gitignored as a whole except this skill directory, so a new file here needs
  `git add -f`.
