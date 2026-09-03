# Taxonomy v2: format groups, mechanism facets, donor-aware statistics

Date: 2026-09-03. Status: design, revision 3 after two adversarial review
rounds (GPT-5.6 Sol, GLM 5.3; raw reviews in `.panel/taxonomy-spec-review*`).
Awaiting owner review, then implementation plans.

## 1. Summary

The site's task taxonomy is rebuilt on two orthogonal dimensions. The
single-valued **group** becomes the task's evaluation format, derived
mechanically from fields the task files already carry. **Facets** become four
explicit families (mechanism, invariant, surface, environment); a composite's
derived facets are the union of its donors' facets, with the donor list stored
so provenance is reconstructable. Taxonomy data is stored as immutable
revisions with one active pointer per task set, addressable by digest, served
through a versioned v2 API while v1 is served from a frozen per-hash snapshot
until a dated sunset.

The leaderboard cuts tabs on format and states what its statistics mean: the
suite is authored and gated, not sampled, so every interval and band is a
**benchmark-composition sensitivity** measure, conditional on a defined run
cohort, and is labelled as such rather than as a population confidence
interval. Resampling runs over the connected components of the task-donor
graph, and separation is shown only where the components are numerous and
none dominates; today that excludes the composite tab and the All headline,
which show scores, counts and a subset-influence table instead. A model
appears on a slice only when it was evaluated on all of it under the cohort.
The taxonomy stays outside the task-set hash; no task file is edited. The
work ships as a dark data launch, then a coherent statistics API and UI, then
bands under a validated estimator.

## 2. Why now, measured

- Coverage stops at CG-AL-X146: 57 reasoning tasks, including all 29 gated
  composites, have no group and no facets.
- The nine groups classify the objects a solution touches. 77 X-series tasks
  and all 29 composites sit in `business-logic`; a composite spans five to
  eight mechanisms.
- Format is the dominant score signal: composites score 0, 0, 3 and 10 percent
  at attempt 1 across the four frontier models against 80 to 93 percent on the
  singles (`hardening-levers-evidence.md`, panel section). What predicts a
  composite's resistance is which donor mechanisms it carries (0 of 59
  composites without a high-survival donor ever gated, 29 of 59 with one).
- `tiers.ts` resamples task indices (line 80). The 29 gated composites and
  their 51 donor singles form one 80-task connected component of the
  task-donor graph (X076 in 16 composites, X140 in 13, X157 in 11). Bands
  computed over them as independent tasks overclaim.
- The task files' `metadata.category` is inside the hashed content. Fixing it
  there would move `task_sets.hash` and orphan every run.
- Precedents: BC-Bench, Terminal-Bench and LiveBench group by kind of work or
  domain; Aider polyglot and BigCodeBench-Hard select by measured solve rate;
  Miller 2024 ("Adding Error Bars to Evals") prescribes clustered errors and
  reporting cluster counts next to question counts; Chatbot Arena treats
  overlapping bootstrap intervals as indistinguishable.

## 3. Non-goals

- Changing any file under `tasks/` or `tests/al/`. `metadata.category` is
  frozen and documented as a historical authoring label.
- The launch-bar metric policy and the published selection rule (donor cap,
  "solved by at most k of n"). Section 6 is correct under any headline choice.
- A request-time difficulty display: it needs a versioned panel manifest that
  does not exist; deferred.
- Composites assembled from trap or composite donors: unsupported; the
  validator refuses them and the methodology page says so.
- A hierarchical multiple-membership outcome model in production. It is the
  offline validation instrument in 6.10, not the site estimator.

## 4. Taxonomy

### 4.1 Group = format

One group per task, derived by the first matching rule over the manifest, with
every field value validated against an enumerated set:

| order | rule | slug | display name |
| --- | --- | --- | --- |
| 1 | `metadata.donors` non-empty | `diagnose-composite` | Composite diagnose |
| 2 | `prompt_template` in {`diagnose.md`, `diagnose-objects.md`, `diagnose-contract.md`} | `diagnose-single` | Single-defect diagnose |
| 3 | `metadata.cohort` = `ado-trap-2026` | `runtime-trap` | Runtime trap |
| 4 | `prompt_template` = `code-gen.md` | `build-from-spec` | Build from spec |

Compatibility matrix, enforced by the validator (any other combination fails):

| group | prompt_template | cohort | donors | `tasks/starter/<id>/` |
| --- | --- | --- | --- | --- |
| diagnose-composite | diagnose-objects.md or diagnose-contract.md | reasoning-100 | 4..8 | required |
| diagnose-single | diagnose.md, diagnose-objects.md or diagnose-contract.md | reasoning-100 or ado-trap-2026 | none | required |
| runtime-trap | code-gen.md | ado-trap-2026 | none | absent |
| build-from-spec | code-gen.md | absent | none | absent |

Known cohort values: `ado-trap-2026`, `reasoning-100`. An unknown cohort or
template fails validation rather than degrading a task to build-from-spec. A
reviewed catalog override list exists for exceptions; every override names
the rule it overrides and why, and the validator reports overrides in use.

Repository census on 2026-09-02: 298 committed tasks; 29 manifests carry
donors, 139 use a diagnose template, 50 carry the trap cohort (one of them a
diagnose task, handled by rule order), 159 use `code-gen.md`; the promoted
trap set is 49 tasks. The validator asserts these per-format counts against
an expected table that is updated deliberately when a batch lands.

Definitions carried in the catalog: `build-from-spec`, write new AL objects
from a behavioural specification; `runtime-trap`, implement a compact
requirement whose natural solution meets a Business Central runtime semantic;
`diagnose-single`, repair a complete application with one planted defect,
given a symptom; `diagnose-composite`, repair one application assembled from
several donor applications with every defect live and no per-module symptom.

### 4.2 Facet families

Every tag carries a `family`, a `name` and a `description`; so does every
family and group. Four families:

**mechanism**, a Business Central runtime or language semantic:
`tryfunction-write-rollback`, `commit-scope`, `error-flow`,
`filter-key-semantics`, `filter-group-state`, `temporary-record`,
`xrec-trigger-state`, `event-binding` (subscriber lifetime and instance
scope), `event-order`, `validation-trigger`, `decimal-precision`,
`culture-format-roundtrip`, `serialization-encoding`, `company-scope`,
`permission-check`, `flowfield-sift`, `sql-cost-scaling`,
`single-instance-state`, `recordref-reflection`, `upgrade-datatransfer`,
`record-locking-concurrency`.

**invariant**, a domain contract the oracle grades independent of mechanism:
`largest-remainder-allocation`, `reversal-conservation`, `exact-total`,
`inclusive-boundary`, `idempotent-rebuild`, `company-isolation`,
`roundtrip-fidelity`, `bounded-sql-cost`.

**surface**, AL objects and APIs touched: a reviewed vocabulary seeded from
the current tags through an explicit alias table (schema in 4.4). No
prevalence-based pruning; common surfaces such as `codeunit` and `table` stay
in the vocabulary and are `hidden_by_default` in filter suggestions.

**environment**, execution requirements: `multi-company`,
`culture-sensitive`, `test-permissions`; plus the structured
`min_bc_version` field (the current `v15`/`v16`/`v17` tags express a
requirement, not the execution version, and become that field).

Retired from the facet namespace: `diagnose`, `composite`, `multi-defect`,
`minimal-symptom`, `defect-sites-N`, and generic labels (`calculations`).
Administrative facts (cohort, difficulty, defect-site count, gated status,
authoring model) are structured metadata, not facets.

Mechanism and invariant facets are assigned by the enrichment workflow
against the vocabulary for **every** format, including build-from-spec (a
code-generation task grades boundaries and exact totals as much as a
diagnose task does), then reviewed by hand once. The vocabulary grows only
through the workflow's `vocabGaps` output plus a human decision; a
vocabulary-gap audit against every current tag precedes freezing the list.

### 4.3 Composite derivation

For a composite C with donors D1..Dn, each a `diagnose-single` task in the
same set:

- `derived(C)` = union over donors of their mechanism, invariant, surface
  **and environment** facets, deduplicated. `min_bc_version(C)` = max over
  donors, and the validator requires exactly that value.
- `local(C)` = facets the composite itself introduces (assembly glue, an
  environment condition no donor carried). Must be disjoint from
  `derived(C)`; the validator refuses overlap.
- `facets(C)` = `derived(C)` ∪ `local(C)`; each stored with its origin
  (`derived` or `local`). Singles store origin `direct`.
- The donor list is stored with C in order. Facet provenance is reconstructed
  as `facet ∈ facets(Di)` when needed.
- Derived facets are materialized by the pipeline, never computed by the
  site. A donor's facet change regenerates every composite on the next run.
- Outcome-derived properties (survival, resistance) are never facets.

### 4.4 Catalog file, schema version 2

`site/catalog/task-categories.yml` conforms to a published JSON Schema
(`site/src/lib/shared/taxonomy-schema.ts`, a pure module with no runtime
dependencies, imported by the Deno pipeline and the Worker alike, so there is
one validator). Shape:

```yaml
schema_version: 2
groups:
  - slug: diagnose-composite
    name: Composite diagnose
    description: Repair one application assembled from several donor applications ...
families:
  - slug: mechanism
    name: Mechanism
    description: A Business Central runtime or language semantic the task turns on.
tags:
  - slug: tryfunction-write-rollback
    family: mechanism
    name: TryFunction write rollback
    description: Writes inside a failed TryFunction are rolled back ...
  - slug: table
    family: surface
    name: Table
    description: A table object is created or changed.
    hidden_by_default: true
aliases:                      # old slug -> new slug, family-aware, reviewed
  - from: try-function
    to: tryfunction-write-rollback
    note: mechanism, not surface
  - from: numeric-precision
    to: decimal-precision
overrides:                    # rule exceptions, each justified
  []
tasks:
  CG-AL-X076:
    group: diagnose-single
    facets: [tryfunction-write-rollback, codeunit, table]
    min_bc_version: 17
  CG-AL-X283:
    group: diagnose-composite
    donors: [CG-AL-X076, CG-AL-X079, CG-AL-X087, CG-AL-X116, CG-AL-X127, CG-AL-X147, CG-AL-X152, CG-AL-X157]
    derived_facets: [tryfunction-write-rollback, largest-remainder-allocation, inclusive-boundary, culture-format-roundtrip, company-scope, codeunit, table]
    local_facets: []
    min_bc_version: 17
```

Slugs match `^[a-z0-9]+(-[a-z0-9]+)*$`. Singles use `facets`; composites use
`derived_facets` plus `local_facets`; the validator refuses the other form.
Every example in this document is generated by the pipeline and round-trips
through the validator in a test.

### 4.5 Pipeline (`.claude/skills/refresh-task-taxonomy/pipeline/`)

- `build-taxonomy.ts`: rewritten. Groups by 4.1 and the compatibility
  matrix. Surface facets through the alias table. Reads `metadata.donors`.
  Emits a draft with mechanism and invariant facets empty where none exist
  yet. The v1 `GROUP_RULES` and `GROUP_OVERRIDE` are deleted in the same
  commit.
- `enrich-task-tags.workflow.js`: vocabulary replaced by the mechanism and
  invariant lists; runs over tasks lacking those facets (or all, with a flag).
- `merge-taxonomy.ts`: merges enrichment, computes composite derivations.
- `validate-taxonomy.ts` (new), exit 1 on any failure, using the shared
  schema module: every task under `tasks/**/*.yml` has exactly one group and
  satisfies the compatibility matrix; per-format counts match the expected
  table; donors present iff composite, 4..8, distinct, not self, each a
  `diagnose-single` task in the set; `derived_facets` equals the union
  exactly and `local_facets` is disjoint; `min_bc_version` present on every
  task and equal to the donor max on composites; every slug valid, known,
  with family, name and description; no retired or duplicate slug; alias
  targets exist; overrides justified. Wired into CI next to `id-audit`.
- Rerunning the pipeline on unchanged inputs reproduces the file byte for
  byte.
- `sync-taxonomy` refuses a catalog whose `schema_version` it does not
  implement. The v2-capable CLI ships in the same commit as the v2 catalog.

## 5. Storage and API

### 5.1 D1 migration `0016_taxonomy_revisions.sql`

Additive. v1 tables are untouched.

```sql
ALTER TABLE task_sets ADD COLUMN scoring_rule TEXT NOT NULL DEFAULT 'v1'
  CHECK (scoring_rule IN ('v1','v2'));       -- see 6.2; existing hashes stay v1

CREATE TABLE taxonomy_revisions (
  id             INTEGER PRIMARY KEY,
  task_set_hash  TEXT NOT NULL REFERENCES task_sets(hash),
  schema_version INTEGER NOT NULL,
  digest         TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  verified_at    TEXT,                       -- set only after the re-read verification in 5.2
  UNIQUE (task_set_hash, digest)
);
CREATE TABLE taxonomy_active (               -- the ONLY row readers consult
  task_set_hash TEXT PRIMARY KEY REFERENCES task_sets(hash),
  revision_id   INTEGER NOT NULL UNIQUE REFERENCES taxonomy_revisions(id),
  activated_at  TEXT NOT NULL
);
CREATE TABLE taxonomy_groups   (revision_id INTEGER NOT NULL REFERENCES taxonomy_revisions(id) ON DELETE CASCADE, slug TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL, PRIMARY KEY (revision_id, slug));
CREATE TABLE taxonomy_families (revision_id INTEGER NOT NULL REFERENCES taxonomy_revisions(id) ON DELETE CASCADE, slug TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL, PRIMARY KEY (revision_id, slug));
CREATE TABLE taxonomy_tags     (revision_id INTEGER NOT NULL REFERENCES taxonomy_revisions(id) ON DELETE CASCADE, slug TEXT NOT NULL, family TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL, hidden_by_default INTEGER NOT NULL DEFAULT 0 CHECK (hidden_by_default IN (0,1)), PRIMARY KEY (revision_id, slug), FOREIGN KEY (revision_id, family) REFERENCES taxonomy_families(revision_id, slug));
CREATE TABLE taxonomy_revision_tasks (        -- one row per task of the revision's set
  revision_id    INTEGER NOT NULL REFERENCES taxonomy_revisions(id) ON DELETE CASCADE,
  task_set_hash  TEXT NOT NULL,
  task_id        TEXT NOT NULL,
  group_slug     TEXT NOT NULL,
  min_bc_version INTEGER NOT NULL,
  PRIMARY KEY (revision_id, task_id),
  FOREIGN KEY (task_set_hash, task_id) REFERENCES tasks(task_set_hash, task_id),
  FOREIGN KEY (revision_id, group_slug) REFERENCES taxonomy_groups(revision_id, slug)
);
CREATE TABLE taxonomy_task_tags   (revision_id INTEGER NOT NULL, task_id TEXT NOT NULL, tag_slug TEXT NOT NULL, origin TEXT NOT NULL CHECK (origin IN ('direct','derived','local')), PRIMARY KEY (revision_id, task_id, tag_slug), FOREIGN KEY (revision_id, task_id) REFERENCES taxonomy_revision_tasks(revision_id, task_id) ON DELETE CASCADE, FOREIGN KEY (revision_id, tag_slug) REFERENCES taxonomy_tags(revision_id, slug));
CREATE TABLE taxonomy_task_donors (revision_id INTEGER NOT NULL, task_id TEXT NOT NULL, donor_task_id TEXT NOT NULL, ordinal INTEGER NOT NULL CHECK (ordinal >= 0), PRIMARY KEY (revision_id, task_id, donor_task_id), UNIQUE (revision_id, task_id, ordinal), FOREIGN KEY (revision_id, task_id) REFERENCES taxonomy_revision_tasks(revision_id, task_id) ON DELETE CASCADE, FOREIGN KEY (revision_id, donor_task_id) REFERENCES taxonomy_revision_tasks(revision_id, task_id));
CREATE TABLE taxonomy_v1_snapshots (          -- frozen v1 responses, one per hash
  task_set_hash TEXT PRIMARY KEY REFERENCES task_sets(hash),
  snapshot_json TEXT NOT NULL,
  taken_at      TEXT NOT NULL
);
CREATE INDEX idx_taxonomy_task_tags_tag ON taxonomy_task_tags(revision_id, tag_slug);
```

Activation is an UPSERT of one row in `taxonomy_active`, so readers never
observe a half-written revision and no multi-row flag swap exists. The
`task_set_hash` on `taxonomy_revision_tasks` is verified against
`taxonomy_revisions.task_set_hash` by the writer's re-read (5.2), since
SQLite cannot express that cross-table equality. Foreign keys are defence in
depth: the endpoint validation and the re-read are the guards, and the
migration's staging run confirms D1 enforces the constraints.

### 5.2 Admin endpoint `/api/v1/admin/catalog/task-taxonomy`

- `version: 1` payloads keep their behaviour until the first v2 activation
  anywhere on the site; after that every v1 apply is refused with
  `409 taxonomy_v1_frozen`, because the v1 vocabulary tables are global and
  a v1 write for one hash would alter another hash's frozen responses.
- `version: 2` payload: `{ version: 2, hash, groups[], families[], tags[],
  aliases[], overrides[], tasks: { id: { group, facets[] |
  derived_facets[] + local_facets[], donors?[], min_bc_version } } }`.
  `hash` is required.
- Validation: the shared schema validator (4.4, 4.5) runs on the payload in
  the Worker; in addition the payload's task ids must equal the task ids of
  that hash exactly, and every donor must resolve within the payload to a
  `diagnose-single` task.
- Normalization and digest: validation produces one normalized form (singles
  and composites both as `{group, facets: [{slug, origin}], donors[],
  min_bc_version}`, facets sorted by slug, donors by ordinal, no absent or
  null optionals, NFC strings, integers as integers). The digest is SHA-256
  of the canonical JSON `{schema_version, task_set_hash, normalized}` with
  sorted keys; both runtimes share the encoder and a golden-vector test that
  covers the two equivalent input forms, Unicode and numeric edge cases.
- Writer: insert the revision row (`verified_at` null); write vocabulary and
  assignment rows in batches keyed by the new revision id (invisible to
  readers); **re-read the complete revision from D1, re-normalize, recompute
  the digest and compare, check every row's `task_set_hash` equals the
  revision's, and check counts (tasks, tags, donors) against the payload**;
  set `verified_at`; take the v1 snapshot for the hash if none exists;
  UPSERT `taxonomy_active`. Concurrent applies serialize on the revision
  row's `(hash, digest)` uniqueness: a second writer for the same digest
  finds the row and follows the recovery path below; a different digest
  creates its own revision and the last activation wins deterministically by
  `activated_at`.
- Recovery: a revision row with a matching digest and `verified_at` null is
  a crashed stage. The writer deletes it (cascade) and restarts. A matching
  revision with `verified_at` set but not active is verified again and
  activated. A matching active revision is a no-op. A daily job deletes
  unverified revisions older than one day.
- `sync-taxonomy --apply` requires an explicit `--hash`. Dry run may suggest
  the current hash from the admin task-sets endpoint (uncached) and prints
  hash, task count and digest; the server confirms the hash is the current
  set and refuses otherwise unless `--allow-non-current` is passed.

### 5.3 Public API: v2 alongside a frozen v1

- `/api/v2/taxonomy`, `/api/v2/categories`, `/api/v2/tasks`,
  `/api/v2/tasks/<id>`, `/api/v2/leaderboard`, `/api/v2/compare`. Every v2
  response carries `task_set_hash` and `revision_digest`. Set resolution:
  `?set=current` (default) or `?set=<64-hex>`; `?revision=<digest>` selects a
  non-active verified revision of that set for reproducibility. Unknown
  `?tag=` returns `400 unknown_tag`; `?category=` accepts format slugs.
- v1 endpoints: after the first v2 activation for a hash, served from
  `taxonomy_v1_snapshots` for that hash, byte-identical to the pre-activation
  responses (the snapshot is taken by the writer from the live v1 tables
  before activation). `Deprecation` and `Sunset` headers carry one site-wide
  date fixed at the first v2 activation, at least 90 days out. No aliases
  from old group slugs to facets; the v1 assignment is exposed as
  `legacy_group` on v2 task items until sunset.
- Model rows in v2 responses carry `slug`, `display_name`, `family`, and
  `open_weight` as today.

### 5.4 Caching

- `CACHE_VERSION` bumps `v9` to `v10` in the release-1 server deploy.
- v2 cache keys include the resolved hash, the active revision digest (or
  `none` before activation), and the estimator version (6.10). v1 keys are
  unchanged.

## 6. Leaderboard statistics

### 6.1 What the numbers mean

The task set is authored and, for composites, gated on model outcomes. It is
not a sample from a population of AL tasks, so no interval here is a
population confidence interval. The site publishes two kinds of statement:

- **Scores**: observed pass rates on the defined run cohort (6.2).
- **Composition sensitivity**: how much a score, a difference or an ordering
  moves when the benchmark's independent components are resampled. Standard
  errors, intervals and separation are all of this kind, are labelled
  "composition sensitivity" on the site, and assume components are
  exchangeable conditional on the donor graph; correlation through shared
  mechanisms or authorship is out of scope and is stated as such. Run
  stochasticity is not included; it is reported separately as pass^k (6.7).

### 6.2 Run cohort and per-task score

The eligible run cohort for a model on a hash: runs with `status =
'completed'`, `source = 'bench'`, and the site's canonical settings profile
(one `settings_hash` designated per hash in configuration), the **three most
recent by `started_at`, tie-break by run id**. A model with more runs does
not get more chances. Attempts served by a refusal fallback count for the
requested model as today and are annotated; the cohort's fallback count is
returned per row.

The scoring rule is pinned per task set: migration 0016 adds
`task_sets.scoring_rule TEXT NOT NULL DEFAULT 'v1'` (`v1` = best across all
runs, today's rule; `v2` = the three-run cohort above). Sets created after
the release-2 deploy get `v2`; every existing hash keeps `v1` forever, so
old-hash views stay byte-identical and no published number changes.
`buildScoreMatrix` and the leaderboard read the rule from the set, and every
v2 response carries `scoring_rule` beside `task_set_hash`. The owner
decision reduces to confirming `v2` as the default for new sets.

Per (model, task): `pass_at_1` = 1 if any cohort run passed at attempt 1;
`pass_at_n` = 1 if any cohort run passed at any attempt; `auc_2` = 0, 0.5 or
1. `buildScoreMatrix(hash, metric, slice, cohort)` replaces `buildAucMatrix`.
Tabs: All plus the four formats; a tab is a slice by group.

### 6.3 Coverage gate

A model is scored on a slice only if its cohort holds an attempt on every
task of the slice. Otherwise its row shows "not evaluated on this slice" with
the attempted count, is excluded from sensitivity computations, and is not
ranked. On the All tab a model is ranked only if it has full coverage of
every format; the format-macro is then always over all four formats.

### 6.4 Independent components

Task-donor graph for the whole task set: tasks are nodes; a composite is
connected to each of its donors. Components are computed once per revision
by one implementation (`site/src/lib/shared/taxonomy-graph.ts`) shared by the
statistics, the API counts and the test fixtures, and the component
membership of the current set is published as a fixture in the repository.
A slice's units are the components intersected with the slice.

Census on 2026-09-02: 298 tasks; the 29 gated composites and their 51 donor
singles form one 80-task component; every other task is its own component.
Composite slice: 1 component. Single-defect slice: 110 (the donor edges lead
outside the slice). Reasoning-only view: 60. All: 219, with the largest
component holding 27 percent of the tasks.

### 6.5 Component resampling and when it is shown

- Iteration: draw `c` components with replacement (seeded RNG); a task's
  weight is its component's multiplicity; one draw per iteration over the
  whole set, read by every slice. Weighted mean for model A over a slice:
  `Σ w(t)·a_t / Σ w(t)`; paired difference: `Σ w(t)·(a_t − b_t) / Σ w(t)`.
  Iterations in which a slice receives zero weight are counted and reported
  as `omitted_iterations`; a slice with any omission publishes no sensitivity
  statistics.
- Gate for publishing sensitivity statistics on a slice (both conditions):
  effective component count `c_eff = (Σ s_i)² / Σ s_i²` over component sizes
  `s_i` in the slice at least 20, and the largest component at most 25
  percent of the slice's tasks. Both numbers are shown on every slice. Below
  the gate the slice shows scores, counts and the subset-influence table
  only. Twenty and 25 percent are provisional until 6.10 fixes them.
- Composition standard error of a score = standard deviation of the weighted
  mean over iterations. Intervals are percentile intervals with the index
  convention `ceil((B + 1) · q) − 1`; B = 4000; Monte Carlo error of the
  interval endpoints is reported.
- Property: a slice with no donor edges reduces to the current paired task
  bootstrap; a test asserts identical output on identical seeds.
- Subset influence (slices containing composites): for each donor present in
  at least three composites, the model scores with those composites removed,
  shown with baseline score, removed count, remaining count and delta,
  labelled "subset influence, not an interval".

Today: the composite tab (1 component) and the All tab (largest component 27
percent) show scores, counts and subset influence, no standard errors and no
separation. The single-defect, trap and build tabs pass the gate.

### 6.6 Separation and the All headline

- Separation ("not separated from this tier's top model under composition
  resampling at 95 percent, approximate, no adjustment for multiple
  comparisons") is computed only where 6.5's gate passes, only for `auc_2`,
  `pass_at_1` and `pass_at_n`; sorts by cost, latency or average score show
  no dividers. Tier assembly stays anchor-based; pairwise intervals are
  served by `/api/v2/compare`.
- All-tab headline: "format-macro score", the equal-weight mean of the four
  format means. It is descriptive until every format passes 6.5's gate; then
  its sensitivity is computed from the same joint replicates, and a replicate
  that omits a format is counted in `omitted_iterations` and disqualifies the
  statistic. The pooled task mean is kept as a column.

### 6.7 pass^k

`pass^3` for a model on a slice when its cohort (6.2) has exactly three
complete runs: a task counts when attempt 1 passed in all three; cells that
were infrastructure failures or fallback-served in any run are excluded and
the excluded count is returned. The response carries the run ids and the
settings hash. Hidden with fewer than three cohort runs.

### 6.8 Leaderboard v2 wire format

```ts
{
  task_set_hash: string; revision_digest: string; estimator_version: string;
  scoring_rule: "v1" | "v2";
  slice: { format: "all" | GroupSlug; metric: "auc_2" | "pass_at_1" | "pass_at_n";
           task_count: number; donor_count: number; component_count: number;
           effective_components: number; largest_component_share: number;
           omitted_iterations: number; monte_carlo_draws: number;
           inference: "separation" | "sensitivity_only" | "descriptive_only" | "not_applicable_sort";
           gate_reason: string | null };
  rows: [{
    model: { slug: string; display_name: string; family: string; open_weight: boolean };
    coverage: "full" | "partial"; attempted: number; cohort_runs: string[]; settings_hash: string;
    fallback_attempts: number;
    headline: Stat; pooled: Stat | null; macro_by_format: Record<GroupSlug, Stat> | null;
    tier: { rank: number; anchor_slug: string } | null;
    pass_k: { k: 3; value: number; excluded_cells: number; runs: string[] } | null;
  }];
  subset_influence: [{ donor: string; removed: number; remaining: number;
                       rows: [{ slug: string; baseline: number; without: number; delta: number }] }] | null;
}
type Stat = { value: number; se: number | null; ci: [number, number] | null;
              status: "score_only" | "sensitivity" };
```

### 6.9 Methodology page

`/methodology`: the four formats and their rules; the facet families; the
composite derivation; section 6.1 in these words; the run cohort; the
coverage gate; the component rule in one sentence ("tasks connected through
a shared donor are resampled together") and the publication gate; what
separation means and its limits; metric definitions; pass^k; the revision
digest, task-set hash and estimator version in force.

### 6.10 Validation before any separation is shown under the new estimator

- Materialize the graph fixture (components, sizes, degrees, leverage).
- Simulate outcomes under several data-generating processes: donor random
  effects plus task residuals; a dominant-donor process; a process with
  correlation across disconnected components through a shared mechanism; a
  selection process that keeps only composites failed by a reference model.
- Measure interval coverage and false-separation rate for task resampling
  and component resampling at several `c_eff` and dominance levels; precommit
  the acceptance criteria (coverage within 3 points of nominal, false
  separation at most 5 percent) before choosing the gate values.
- Publish the fixture and the results in the repository; assign estimator
  version `ev1` to the accepted configuration.

## 7. UI

- Leaderboard tabs from `/api/v2/categories`; each tab header shows task,
  donor and component counts, effective components, largest share and the
  inference state with its reason.
- `TaxonomyFilter.svelte` renders facets grouped by family with counts and a
  "more" disclosure for hidden-by-default tags.
- Task page: group, facets by family with origin, donors with each donor's
  mechanism and invariant facets, `legacy_group` until sunset.
- Leaderboard rows: `score (± se)` where status is `sensitivity`, plain score
  otherwise; greyed "not evaluated on this slice"; pooled and macro columns on
  All; pass^k with a run tooltip; subset-influence table on slices with
  composites.

## 8. Releases and ship order

**Release 1, dark data launch. No public ranking or v1 response changes.**
1. Pipeline rewrite, shared schema module, validator, alias table, v2
   catalog, v2-capable CLI in one commit; hand review of mechanism and
   invariant facets across all formats; validator green in CI.
2. Migration 0016 applied to prod D1; staging run confirms FK enforcement.
3. Server deploy: revision-aware readers, v2 endpoints returning `404
   no_active_revision` until activation, v1 snapshot support, `CACHE_VERSION`
   v10, digest and estimator version in v2 keys, v1 code paths untouched.
4. After the re-bench ingest and the task-set flip: `sync-catalog --apply`,
   then `sync-taxonomy --apply --hash <64-hex>` (dry run first): stage,
   verify, snapshot v1, activate. Verify: v2 coverage equals task count,
   digest matches, benchmark hash unchanged, v1 responses byte-identical to
   the pre-activation snapshot for that hash and for one older hash.

**Release 2, statistics API and UI together.** Sections 6.1 to 6.5 and 6.8
with `inference` limited to `descriptive_only` and `sensitivity_only`; the
coverage gate and run cohort (6.2, 6.3) take effect here, with their effect
on rankings reviewed by the owner before deploy; UI (7) switched to v2 behind
a flag; methodology page; deprecation headers on v1. Separation is not shown
on any slice in this release: donor-free slices keep no bands either, so
that separation appears everywhere at once under one estimator.

**Release 3, separation under the validated estimator.** After 6.10 is in
the repository: separation on slices passing the gate, pass^k, the
three-run cohort rule confirmed as the default for new task sets (existing hashes keep `v1`).

v1 removal after the sunset date, once v2 traffic is observed.

## 9. Testing

- Pipeline (Deno): one fixture per format; compatibility matrix rejections;
  alias table; composite derivation incl. environment union and
  `min_bc_version` max; disjointness of local and derived; validator failure
  cases (unknown template, unknown cohort, donors on a non-composite,
  composite or trap donor, self-donor, missing description, derived
  mismatch, bad slug, count table mismatch); determinism; every catalog
  example in this spec round-trips.
- Shared schema module: same validator and digest encoder run under Deno and
  under vitest with the golden vectors.
- Server (`site/`, vitest on the built bundle): endpoint validation rejects
  each listed defect; stage-verify-activate with a simulated crash before
  verification (revision deleted on retry) and after verification (activated
  on retry); identical payload no-op; v1 apply after first activation returns
  409; v1 responses for two hashes byte-identical before and after activation;
  cache keys change with digest and estimator version; coverage gate and
  cohort selection (most recent three, tie-break by id, settings filter);
  graph components on the published fixture; component bootstrap equals task
  bootstrap on a donor-free slice; gate suppression on `c_eff` and dominance;
  `omitted_iterations` disqualifies a statistic; `?revision=` lookup; unknown
  tag on v2 returns 400.
- e2e (Playwright): format tabs with counts and inference state; composite
  task page with donors and provenance; v1 endpoints unchanged after
  activation.
- Operational: dry run against staging D1; v1 snapshot diff empty.

## 10. Success measures

- Coverage 100 percent of tasks in the current set, zero unknown slugs, every
  composite's donors resolved, validator green in CI.
- The format axis explains the attempt-1 score variance the old axis cannot
  (between-group share of variance reported for both).
- Facet-derived composite resistance reproduces the measured cross-tab
  (0 of 59 without a high-survival donor, 29 of 59 with one) without any
  outcome-derived label.
- Under 6.10, component resampling meets the precommitted coverage and
  false-separation criteria where task resampling does not; no separation is
  ever shown on a slice failing the gate.
- v1 responses byte-identical across activation (snapshot diff empty).
- Rerunning the pipeline is deterministic; a new untagged task fails CI.

## 11. Precedents consulted

Format or domain grouping: BC-Bench, Terminal-Bench 2.0, LiveBench, HELM.
Selection by measured solve rate: Aider polyglot, BigCodeBench-Hard.
Statistics: Miller 2024 (clustered standard errors, cluster counts beside
question counts, paired differences, bootstrap for complicated sampling
schemes); BC-Bench (five runs, BCa intervals, pass^5, paired permutation
tests); Chatbot Arena (bootstrap intervals, overlap means indistinguishable).
Continuous task validation: Terminal-Bench 2.1; ours is gold-ci.

## 12. Review record

Revision 2 (from round one): multiplicity-average bootstrap withdrawn;
best-across-runs kept; coverage gate; bands limited to solve metrics;
revisioned storage; v2 API; families and invariants; locking added;
prevalence pruning dropped; three releases.

Revision 3 (from round two): component census corrected (80-task component,
219 components on All); statistics relabelled as composition sensitivity with
the authored-and-gated suite stated as the reason; publication gate on
effective component count and dominance instead of a raw count; All-tab
macro descriptive until every format passes the gate, and replicates that
omit a format disqualify a statistic; run cohort defined (completed, bench,
canonical settings, three most recent) and the best-across-all-runs change
flagged as an owner decision; coverage on All requires every format; pass^3
on the cohort with fallback and infra cells excluded; complete wire format
with per-statistic status; activation through a pointer table instead of a
multi-row flag swap; re-read verification and recomputed digest before
activation; crash recovery defined; digest over the normalized form with
golden vectors; assignment tables keyed to a per-revision task table with
donor foreign keys; v1 frozen by per-hash snapshots and a site-wide 409;
revisions addressable by digest; enrichment over all formats; environment
facets inherited; local and derived facets disjoint; compatibility matrix and
expected counts; explicit `--hash` for apply; dark release 1 with no ranking
change; separation withheld everywhere until the validated estimator lands.
