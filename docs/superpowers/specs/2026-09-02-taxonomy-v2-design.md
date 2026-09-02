# Taxonomy v2: format groups, mechanism facets, donor-aware inference

Date: 2026-09-02. Status: design, approved in discussion, awaiting implementation plan.

## 1. Summary

The site's task taxonomy is rebuilt on two orthogonal dimensions. The
single-valued **group** becomes the task's evaluation format (build from spec,
runtime trap, single-defect diagnose, composite diagnose), derived mechanically
from fields the task files already carry. **Facets** become three explicit
families (mechanism, surface, environment); a composite's facets are the union
of its donors' facets, with the donor list stored so provenance is
reconstructable. The leaderboard cuts its tabs and tier bands on format,
computes bands for the metric the table is sorted by, and replaces task-index
resampling with resampling over *independent units* (a task, or the donors a
composite is built from), so shared defects widen intervals instead of
inflating confidence. Every score is shown with its standard error and every
tab with its task and unit counts. The taxonomy stays outside the task-set
hash; no task file is edited.

## 2. Why now, measured

- Coverage stops at CG-AL-X146: 57 reasoning tasks, including all 29 gated
  composites, have no group and no facets.
- The nine groups classify the objects a solution touches. 77 X-series tasks
  and all 29 composites sit in `business-logic`; a composite spans five to
  eight mechanisms.
- Format is the dominant score signal: composites score 0, 0, 3 and 10 percent
  at attempt 1 across the four frontier models against 80 to 93 percent on the
  singles (`hardening-levers-evidence.md`, panel section). What predicts a
  composite's resistance is which donor mechanisms it carries, not object
  types (0 of 59 composites without a high-survival donor ever gated, 29 of 59
  with one).
- `tiers.ts` resamples task indices (line 80). Twenty-nine composites resting
  on seven donors are not exchangeable, so bands on a composite slice overclaim.
- The task files' `metadata.category` is inside the hashed content. Fixing it
  there would move `task_sets.hash` and orphan every run.
- Precedents: BC-Bench, Terminal-Bench and LiveBench group by kind of work or
  domain, never by solution object type; Aider polyglot and BigCodeBench-Hard
  select by measured solve rate; Anthropic's "Adding Error Bars to Evals"
  prescribes clustered errors and reporting the cluster count next to the
  question count when questions share a source.

## 3. Non-goals

- Changing any file under `tasks/` or `tests/al/`. `metadata.category` is
  frozen and documented as a historical authoring label.
- The launch-bar metric policy and the published selection rule (donor cap,
  "solved by at most k of n"). Section 6 makes the leaderboard correct under
  any headline choice; the choice itself is a separate decision.
- Retagging the legacy E/M/H tasks' surface facets by hand. They keep their
  current tags through the pruning rule in 4.2.

## 4. Taxonomy

### 4.1 Group = format

One group per task, derived by the first matching rule over the task manifest:

| order | rule (manifest fields) | slug | display name |
| --- | --- | --- | --- |
| 1 | `metadata.donors` non-empty | `diagnose-composite` | Composite diagnose |
| 2 | `prompt_template` starts with `diagnose` | `diagnose-single` | Single-defect diagnose |
| 3 | `metadata.cohort` = `ado-trap-2026` | `runtime-trap` | Runtime trap |
| 4 | otherwise | `build-from-spec` | Build from spec |

Definitions carried in the catalog:

- `build-from-spec`: write new AL objects from a behavioural specification.
- `runtime-trap`: implement a compact requirement whose natural solution
  meets a Business Central runtime semantic.
- `diagnose-single`: repair a complete application with one planted defect,
  given a symptom.
- `diagnose-composite`: repair one application assembled from several donor
  applications with every defect live and no per-module symptom.

No regex over slugs, no per-task override table. The validator (4.5) fails if
a rule's precondition is inconsistent with the file layout (a `diagnose`
template without `tasks/starter/<id>/`, a `donors` list naming a task that is
not in the set).

### 4.2 Facet families

Every tag carries a `family`. Three families:

**mechanism** - the runtime semantic or invariant the task turns on. Controlled
vocabulary, seeded from the measured survivors and the twelve reasoning-suite
authoring categories. Initial list (slugs), each with a one-line description in
the catalog:

`tryfunction-write-rollback`, `commit-scope`, `error-flow`,
`filter-key-semantics`, `filter-group-state`, `temporary-record`,
`xrec-trigger-state`, `event-binding`, `event-order`, `validation-trigger`,
`largest-remainder-allocation`, `reversal-conservation`, `boundary-operator`,
`decimal-precision`, `culture-format-roundtrip`, `serialization-encoding`,
`company-scope`, `permission-check`, `flowfield-sift`, `sql-cost-scaling`,
`single-instance-state`, `recordref-reflection`, `upgrade-datatransfer`,
`spec-induction`.

Mechanism facets for the 110 single-defect tasks and the 64 trap tasks are
assigned by the enrichment workflow against this vocabulary and then reviewed
by hand once, because they are the analytic core. New vocabulary is admitted
only through the workflow's `vocabGaps` output plus a human decision; the
validator rejects unknown slugs.

**surface** - AL objects and APIs touched. Seeded from the current 75 tags with
a deterministic prune: drop any tag present on more than 30 percent of tasks
or on fewer than two tasks (this removes `calculations`, `table`, `keys`,
`collections` and the singletons), then canonicalize aliases
(`tryfunction`/`try-function`, `numeric-precision`/`decimal-precision`). Tags
that name a mechanism rather than a surface (`transaction`, `rounding`,
`locking`, `xrec`, `try-function`) move to the mechanism family under their new
slugs.

**environment** - `bc-v15`, `bc-v16`, `bc-v17`, `multi-company`,
`culture-sensitive`, `test-permissions`. The existing `v15`/`v16`/`v17` tags
are renamed into this family.

Administrative facts (cohort, difficulty, defect-site count, gated status,
authoring model) are structured metadata, not facets. The tags `diagnose`,
`composite`, `multi-defect`, `minimal-symptom` and `defect-sites-N` are
retired from the facet namespace; the group and `donors` carry that
information.

### 4.3 Composite derivation

For a composite C with donors D1..Dn:

- `mechanism(C)`, `surface(C)`, `environment(C)` = union over donors, in that
  family, deduplicated.
- The donor list is stored with C (catalog and D1). Facet provenance is not
  stored per facet; it is reconstructed as `facet ∈ facets(Di)` for each donor
  when needed (task page, analysis).
- Derived facets are materialized into the catalog by the pipeline, never
  computed by the site.
- A donor's facet change regenerates every composite that carries it (the
  pipeline recomputes all composites on every run, so this is automatic).
- Outcome-derived properties (survival rate, resistance) are never facets.

### 4.4 Catalog file, schema version 2

`site/catalog/task-categories.yml`:

```yaml
schema_version: 2
groups:
  - slug: diagnose-composite
    name: Composite diagnose
    description: Repair one application assembled from several donor applications ...
families:
  - slug: mechanism
    name: Mechanism
  - slug: surface
    name: AL surface
  - slug: environment
    name: Environment
tags:
  - slug: tryfunction-write-rollback
    family: mechanism
    name: TryFunction write rollback
    description: Writes inside a failed TryFunction are rolled back ...
  - slug: page
    family: surface
    name: Page
tasks:
  CG-AL-X076:
    group: diagnose-single
    tags: [tryfunction-write-rollback, codeunit, table, bc-v17]
  CG-AL-X283:
    group: diagnose-composite
    donors: [CG-AL-X076, CG-AL-X079, CG-AL-X087, CG-AL-X116, CG-AL-X127, CG-AL-X147, CG-AL-X152, CG-AL-X157]
    # materialized union of the eight donors' facets, all families, deduplicated
    tags: [tryfunction-write-rollback, largest-remainder-allocation, boundary-operator,
           culture-format-roundtrip, company-scope, codeunit, table, bc-v17]
```

Decomposition for implementation: plan A covers sections 4 and 8.1 (pipeline,
catalog, validator, hand review); plan B covers sections 5 to 7 and 8.2 to 8.6
(site). Plan A has no dependency on plan B and ships first.

The `groups:` constraint list on tags (v1) is removed; families replace it.

### 4.5 Pipeline (`.claude/skills/refresh-task-taxonomy/pipeline/`)

- `build-taxonomy.ts`: rewritten. Groups by the 4.1 rules. Surface facets by
  the 4.2 prune and alias table. Reads `metadata.donors` for composites.
  Emits a draft catalog with mechanism facets empty for tasks that have none
  yet.
- `enrich-task-tags.workflow.js`: vocabulary replaced by the mechanism list;
  runs only over tasks lacking mechanism facets (or all, with a flag); output
  merged by `merge-taxonomy.ts`, which also computes composite unions.
- `validate-taxonomy.ts` (new): every task under `tasks/**/*.yml` has exactly
  one group; every tag slug exists and has a family; every donor resolves to a
  task in the set; every composite's tags equal the union of its donors' tags;
  no retired slug appears. Exit 1 on any failure. Wired into
  `deno task id-audit`'s CI job so a new batch cannot land untagged.
- Rerunning the pipeline on unchanged inputs reproduces the file byte for
  byte (deterministic ordering, no timestamps).

## 5. Storage and API

### 5.1 D1 migration `0016_taxonomy_v2.sql`

```sql
ALTER TABLE tags ADD COLUMN family TEXT;          -- mechanism | surface | environment
ALTER TABLE tags ADD COLUMN description TEXT;

CREATE TABLE task_donors (
  task_set_hash TEXT NOT NULL,
  task_id       TEXT NOT NULL,
  donor_task_id TEXT NOT NULL,
  ordinal       INTEGER NOT NULL,
  PRIMARY KEY (task_set_hash, task_id, donor_task_id),
  FOREIGN KEY (task_set_hash, task_id) REFERENCES tasks(task_set_hash, task_id)
);
CREATE INDEX idx_task_donors_task ON task_donors(task_set_hash, task_id);

CREATE TABLE taxonomy_meta (
  task_set_hash  TEXT PRIMARY KEY REFERENCES task_sets(hash),
  schema_version INTEGER NOT NULL,
  digest         TEXT NOT NULL,      -- sha256 of the canonical applied payload
  applied_at     TEXT NOT NULL
);
```

Additive only. `tasks.category_id` keeps pointing at `task_categories`, whose
rows become the four format groups.

### 5.2 Admin endpoint `/api/v1/admin/catalog/task-taxonomy`

- Accepts `version: 1` (unchanged behaviour) and `version: 2`.
- Version 2 payload: `{ version: 2, hash, groups[], families[], tags[{slug,
  family, name, description}], tasks: { id: { group, tags[], donors?[] } } }`.
  `hash` is required for version 2; the implicit-current fallback is refused
  with `400 hash_required`.
- Validation before any write: payload task ids equal the set of task ids for
  that hash (no missing, no extra); every task has exactly one known group;
  every tag references a known family; every donor exists in the same hash;
  for every composite, `tags` equals the union of donor tags.
- Writer (`taxonomy.ts`): phases in order, each a single `db.batch()` where the
  50-statement cap allows and chunked otherwise: upsert groups; upsert tags
  with family and description; set `tasks.category_id` for every task in the
  payload; delete and reinsert `task_tags` for the hash; delete and reinsert
  `task_donors` for the hash; prune orphan groups; upsert `taxonomy_meta`
  last. `taxonomy_meta` is only written on full success, so a partial write is
  detectable (`digest` absent or stale) and the next apply is idempotent.
- The `sync-taxonomy` CLI emits version 2 when the catalog says
  `schema_version: 2`, always passes the resolved hash explicitly, and prints
  the digest it expects the server to record.

### 5.3 Public API

- `/api/v1/taxonomy`: adds `families[]`; each tag gains `family` and
  `description`. Groups are the four formats. Response shape versioned by the
  cache version bump.
- `/api/v1/tasks` items and `/api/v1/tasks/<id>`: add `donors: string[]`
  (empty for non-composites) and `tags` grouped as `facets: { mechanism[],
  surface[], environment[] }` alongside the flat `tags` for one release.
- `/api/v1/tasks?tag=` unchanged (AND semantics). The existing `?category=`
  parameter keeps its name and accepts the four format slugs; the old nine
  slugs are accepted as aliases that resolve to the surface or mechanism facet
  they became, for one release, then removed.
- `/api/v1/categories` returns the four formats with task counts.

### 5.4 Caching

- `CACHE_VERSION` bumps `v9` to `v10`.
- The taxonomy digest from `taxonomy_meta` joins the cache keys of
  `/api/v1/taxonomy`, `/api/v1/categories`, `/api/v1/tasks`, the leaderboard,
  and `getTierMap`. A reassignment that keeps a slug and task count therefore
  never serves a stale band.

## 6. Leaderboard statistics

### 6.1 Tabs and slices

Tabs: All, Build from spec, Runtime trap, Single-defect diagnose, Composite
diagnose. A tab is a slice of tasks by group. Facets are a secondary filter on
the tasks page and on the per-model analysis, never top-level tabs.

### 6.2 Metric-aware score matrices

`buildAucMatrix` becomes `buildScoreMatrix(hash, metric, slice)` with
`metric ∈ {auc_2, pass_at_1, pass_at_n}`. Per (model, task) the score is:
`pass_at_1` = 1 if attempt 1 passed; `pass_at_n` = 1 if any attempt passed;
`auc_2` = 0, 0.5 or 1 as today. When a model has several runs on the hash the
per-task score is the mean over runs, matching the leaderboard's aggregation.
Tier bands are computed for the metric the table is sorted by; the table
renders dividers under every sort, since the bands now describe that column.

### 6.3 Independent-unit resampling

Replaces task-index resampling in `tiers.ts` for every slice.

- For task t in the slice: `units(t) = {t}` if t has no donors, else
  `units(t) = donors(t)`. `U` = union of all `units(t)`. A donor is a unit
  whether or not it is itself in the slice.
- Iteration: draw `|U|` units with replacement (seeded RNG as today); `m(u)` =
  multiplicity. Task weight `w(t)` = mean of `m(u)` over `units(t)`.
- Weighted mean for model A: `Σ w(t)·a_t / Σ w(t)`. Paired difference A−B:
  `Σ w(t)·(a_t − b_t) / Σ w(t)`. An iteration with `Σ w = 0` is redrawn.
- Distinguishable when the (1−α) interval of the paired difference over
  iterations excludes 0; tiers assembled exactly as today.
- Standard error of a model's score on the slice = standard deviation of its
  weighted mean over iterations.
- Property: on a slice with no composites, `units(t) = {t}` and the procedure
  is the current paired task bootstrap; the unit test asserts identical
  output on identical seeds.
- Display on every tab: `n tasks · m independent units`, where `m = |U|`.
  Bands are computed whenever `m ≥ 10`; below that the tab shows scores with
  standard errors and the note "too few independent units for tier bands".
- Justification recorded on the methodology page: shared donors make
  composite outcomes dependent; resampling the shared defects rather than the
  tasks is the clustered-error treatment the eval-statistics literature
  prescribes, extended to multi-membership by averaging unit multiplicities.

### 6.4 The All tab

Headline score on All = equal-weight mean of the four format means (each
format's weighted mean per iteration, averaged), so 110 singles cannot drown
29 composites. The pooled mean over all tasks is kept as a column named
"pooled". Standard errors and bands for the All headline use the same
iterations.

### 6.5 Consistency and difficulty columns

- `pass^k` (first try) is shown for a model on a slice when it has at least
  three runs on the hash: fraction of tasks passed at attempt 1 in every run.
  Hidden otherwise. Matches BC-Bench's convention.
- Task difficulty on the tasks page is displayed as "solved first try by k of n
  panel models", computed from results at request time. It is a measurement,
  versioned by the panel it came from, and never stored as a facet.

### 6.6 Methodology page

`/methodology` (static route) states: the four formats and how they are
derived; the three facet families; the composite union rule; the resampling
rule in one sentence with the unit definition; what a tier band means; the
metric definitions; the pass^k rule; and a link to the taxonomy digest and
task-set hash in force.

## 7. UI

- `CategoryTabs.svelte` renders the four formats from `/api/v1/categories`;
  copy updated; each tab header shows `n tasks · m units` and the band note.
- `TaxonomyFilter.svelte` renders facets grouped by family with counts.
- Task page shows group, facets by family, and for composites the donor list
  with each donor's mechanism facets (provenance view).
- Leaderboard cells show `score (± se)`; pooled column on All; pass^k column
  when available.
- Filter URLs: old group slugs redirect to the equivalent facet filter for one
  release; a deprecation note names the mapping.

## 8. Migration and ship order

1. Pipeline rewrite and catalog v2 generated offline; validator green on
   every task under `tasks/`; hand review of mechanism facets for the 174
   single-defect and trap tasks; commit catalog and pipeline together
   (GLM's reversion trap: the old `GROUP_RULES` must not survive).
2. `0016_taxonomy_v2.sql` applied to prod D1 before any worker deploy
   (repository rule: migrations before deploy).
3. Worker deployed dual-stack: version 1 payloads still accepted, empty v2
   tables tolerated, old response shapes served until a v2 taxonomy is
   applied for the current hash.
4. Only after the re-bench ingest and the task-set flip: `sync-catalog
   --apply`, then `sync-taxonomy --apply --hash <64-hex>` (dry run first,
   prune list inspected), then verification: coverage equals the task count,
   `taxonomy_meta.digest` equals the CLI's expected digest, the benchmark hash
   is unchanged, old runs and scores unchanged.
5. UI switch (tabs, families, methodology page) and the cache version bump
   ship as a second worker deploy after step 4 has verified, so the site never
   renders format tabs against an unapplied v2 taxonomy.
6. Aliases and dual response shapes removed after one release.

## 9. Testing

- Unit (`site/`, vitest on the built bundle): weighted resampling equals the
  current bootstrap on donor-free input with the same seed; a synthetic slice
  of ten composites sharing one donor yields an interval at least as wide as
  the same ten as independent tasks and no band at `m < 10`; score matrices
  for the three metrics; endpoint validation rejects partial coverage, unknown
  family, unresolved donor, and a composite whose tags are not the donor
  union; digest written only on full success; cache keys change with digest.
- Pipeline (Deno tests): group rules on one fixture per format; prune rule;
  alias canonicalization; composite union; determinism (two runs, identical
  bytes); validator failure cases.
- e2e (Playwright): tabs render the four formats; a composite task page shows
  donors; old group URL redirects.
- Operational: `sync-taxonomy` dry run against staging D1 before prod.

## 10. Success measures

- Coverage 100 percent of tasks in the current set, zero unknown slugs, every
  composite's donors resolved.
- The format axis explains the attempt-1 score variance the old axis cannot
  (between-group share of variance reported for both).
- Facet-derived composite resistance reproduces the measured cross-tab
  (0 of 59 without a high-survival donor, 29 of 59 with one) without any
  outcome-derived label in the taxonomy.
- On the composite tab, bands under unit resampling are never tighter than
  under task resampling; the methodology page and per-tab counts are live.
- Rerunning the pipeline is deterministic; the CI validator catches an
  untagged new task.

## 11. Precedents consulted

Format or domain grouping: BC-Bench (bug-fix, test-generation; functional
area and patch size), Terminal-Bench 2.0 (16 categories, three tiers),
LiveBench (category means averaged into the headline), HELM (scenarios by
metric). Selection by measured solve rate: Aider polyglot (225 of 697 solved
by at most 3 of 7 models), BigCodeBench-Hard (solve rate under 50 percent).
Statistics: Miller 2024 "Adding Error Bars to Evals" (clustered standard
errors up to three times naive, report cluster count with question count,
paired differences, bootstrap justified for complicated sampling schemes);
BC-Bench (five runs, BCa bootstrap intervals, pass^5, paired sign-flip
permutation tests); Chatbot Arena (bootstrap intervals, overlap means
indistinguishable). Continuous task validation: Terminal-Bench 2.1; ours is
gold-ci.
