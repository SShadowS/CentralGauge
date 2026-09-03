# Taxonomy v2: format groups, mechanism facets, donor-aware inference

Date: 2026-09-02. Status: design, revision 2 after a two-model review
(GPT-5.6 Sol, GLM 5.3; raw reviews in `.panel/taxonomy-spec-review-*.md`).
Awaiting owner review, then implementation plans.

## 1. Summary

The site's task taxonomy is rebuilt on two orthogonal dimensions. The
single-valued **group** becomes the task's evaluation format (build from spec,
runtime trap, single-defect diagnose, composite diagnose), derived mechanically
from fields the task files already carry. **Facets** become explicit families
(mechanism, invariant, surface, environment); a composite's derived facets are
the union of its donors' facets, with the donor list stored so provenance is
reconstructable. Taxonomy data is stored as immutable revisions with a single
active pointer per task set, served through a versioned v2 API while v1 keeps
its meaning until a dated sunset. The leaderboard cuts tabs on format, computes
bands for the solve metric the table is sorted by, states its estimand, and
replaces task-index resampling with resampling over the connected components
of the task-donor graph, so shared defects widen intervals or, when the
components are too few, suppress bands honestly. Every score carries its
standard error; every slice shows task, donor and component counts, and a
model appears on a slice only when it was evaluated on all of it. The taxonomy
stays outside the task-set hash; no task file is edited. The work ships in
three releases so a defect in one layer cannot move public rankings unnoticed.

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
- `tiers.ts` resamples task indices (line 80). The 29 gated composites form
  ONE connected component of the donor-sharing graph (51 distinct donors;
  X076 in 16 composites, X140 in 13, X157 in 11). Bands computed over them as
  29 independent tasks overclaim.
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
- A request-time "solved by k of n panel models" difficulty display: it needs
  a versioned panel manifest that does not exist; deferred.
- A hierarchical multiple-membership model of composite outcomes. It is the
  right offline research tool and the wrong production estimator; section 6.9
  names it as the validation instrument.

## 4. Taxonomy

### 4.1 Group = format

One group per task, derived by the first matching rule over the manifest:

| order | rule (manifest fields) | slug | display name |
| --- | --- | --- | --- |
| 1 | `metadata.donors` non-empty | `diagnose-composite` | Composite diagnose |
| 2 | `prompt_template` in {`diagnose.md`, `diagnose-objects.md`, `diagnose-contract.md`} | `diagnose-single` | Single-defect diagnose |
| 3 | `metadata.cohort` = `ado-trap-2026` | `runtime-trap` | Runtime trap |
| 4 | `prompt_template` = `code-gen.md` | `build-from-spec` | Build from spec |

Any other `prompt_template` value fails validation rather than defaulting.
Repository census on 2026-09-02: 29 manifests carry donors, 139 use a
diagnose template, 50 carry the trap cohort (one of them a diagnose task,
which rule order handles), 159 use `code-gen.md`; no manifest falls outside
the rules. The promoted trap set is 49 tasks.

Definitions carried in the catalog:

- `build-from-spec`: write new AL objects from a behavioural specification.
- `runtime-trap`: implement a compact requirement whose natural solution meets
  a Business Central runtime semantic.
- `diagnose-single`: repair a complete application with one planted defect,
  given a symptom.
- `diagnose-composite`: repair one application assembled from several donor
  applications with every defect live and no per-module symptom.

### 4.2 Facet families

Every tag carries a `family`. Four families:

**mechanism** - a Business Central runtime or language semantic. Initial
vocabulary: `tryfunction-write-rollback`, `commit-scope`, `error-flow`,
`filter-key-semantics`, `filter-group-state`, `temporary-record`,
`xrec-trigger-state`, `event-binding` (subscriber lifetime and instance
scope), `event-order`, `validation-trigger`, `decimal-precision`,
`culture-format-roundtrip`, `serialization-encoding`, `company-scope`,
`permission-check`, `flowfield-sift`, `sql-cost-scaling`,
`single-instance-state`, `recordref-reflection`, `upgrade-datatransfer`,
`record-locking-concurrency`.

**invariant** - a domain contract the oracle grades independent of mechanism:
`largest-remainder-allocation`, `reversal-conservation`, `exact-total`,
`inclusive-boundary`, `idempotent-rebuild`, `company-isolation`,
`roundtrip-fidelity`, `bounded-sql-cost`.

**surface** - AL objects and APIs touched. A reviewed vocabulary seeded from
the current tags with an explicit alias and deprecation table (for example
`try-function` becomes the mechanism `tryfunction-write-rollback`;
`numeric-precision` and `decimal-precision` merge). No prevalence-based
pruning: frequency is a UI ordering concern, not a validity criterion. Common
surfaces such as `codeunit` and `table` stay in the vocabulary and are hidden
from default filter suggestions by count.

**environment** - `multi-company`, `culture-sensitive`, `test-permissions`,
plus a structured `min_bc_version` field (the current `v15`/`v16`/`v17` tags
express a requirement, not the execution version; they become that field).

Retired from the facet namespace: `diagnose`, `composite`, `multi-defect`,
`minimal-symptom`, `defect-sites-N`, and generic labels (`calculations`).
Administrative facts (cohort, difficulty, defect-site count, gated status,
authoring model) are structured metadata, not facets. Reasoning shapes such
as spec induction are not facets in this revision.

Mechanism and invariant facets for the 110 single-defect and 49 trap tasks
are assigned by the enrichment workflow against the vocabulary and then
reviewed by hand once. The vocabulary grows only through the workflow's
`vocabGaps` output plus a human decision; a vocabulary-gap audit against every
current tag precedes freezing the list.

### 4.3 Composite derivation

For a composite C with donors D1..Dn (each Di a `diagnose-single` task in the
same set; nesting is not supported):

- `derived(C)` = union over donors of their mechanism, invariant and surface
  facets, deduplicated; `min_bc_version(C)` = max over donors.
- `local(C)` = facets assigned to the composite itself (assembly glue, an
  environment condition the donors did not carry). Usually empty.
- `facets(C)` = `derived(C)` ∪ `local(C)`. The catalog stores both parts.
- The donor list is stored with C in order. Facet provenance is reconstructed
  as `facet ∈ facets(Di)` when needed.
- Derived facets are materialized by the pipeline, never computed by the
  site. A donor's facet change regenerates every composite on the next run.
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
  - slug: invariant
    name: Invariant
  - slug: surface
    name: AL surface
  - slug: environment
    name: Environment
tags:
  - slug: tryfunction-write-rollback
    family: mechanism
    name: TryFunction write rollback
    description: Writes inside a failed TryFunction are rolled back ...
  - slug: table
    family: surface
    name: Table
    hidden_by_default: true
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

The v1 `groups:` constraint list on tags is removed. The example above is
generated by the pipeline; a test asserts that every example in this document
round-trips through the validator.

### 4.5 Pipeline (`.claude/skills/refresh-task-taxonomy/pipeline/`)

- `build-taxonomy.ts`: rewritten. Groups by 4.1. Surface facets through the
  alias table. Reads `metadata.donors`. Emits a draft with mechanism and
  invariant facets empty for tasks that have none yet. The v1 `GROUP_RULES`
  and `GROUP_OVERRIDE` are deleted in the same commit.
- `enrich-task-tags.workflow.js`: vocabulary replaced by the mechanism and
  invariant lists; runs over tasks lacking those facets (or all, with a flag).
- `merge-taxonomy.ts`: merges enrichment, computes composite derivations.
- `validate-taxonomy.ts` (new), exit 1 on any failure: every task under
  `tasks/**/*.yml` has exactly one group; `donors` non-empty iff group is
  `diagnose-composite`; donors distinct, not self, each a `diagnose-single`
  task in the set; every facet slug exists with a family; `derived_facets`
  equals the donor union exactly; no retired or duplicate slug; every group,
  family and tag has name and description; unknown `prompt_template` or a
  cohort that conflicts with the template fails. Wired into CI next to
  `id-audit` so a new batch cannot land untagged.
- Rerunning the pipeline on unchanged inputs reproduces the file byte for
  byte.
- `sync-taxonomy` refuses a catalog whose `schema_version` it does not
  implement. The v2-capable CLI ships in the same commit as the v2 catalog.

## 5. Storage and API

### 5.1 D1 migration `0016_taxonomy_revisions.sql`

Additive. v1 tables (`task_categories`, `tags`, `task_tags`,
`tasks.category_id`) are untouched and keep serving v1.

```sql
CREATE TABLE taxonomy_revisions (
  id             INTEGER PRIMARY KEY,
  task_set_hash  TEXT NOT NULL REFERENCES task_sets(hash),
  schema_version INTEGER NOT NULL,
  digest         TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  active         INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0,1)),
  UNIQUE (task_set_hash, digest)
);
CREATE UNIQUE INDEX idx_taxonomy_active ON taxonomy_revisions(task_set_hash) WHERE active = 1;

CREATE TABLE taxonomy_groups   (revision_id INTEGER NOT NULL REFERENCES taxonomy_revisions(id) ON DELETE CASCADE, slug TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL, PRIMARY KEY (revision_id, slug));
CREATE TABLE taxonomy_families (revision_id INTEGER NOT NULL REFERENCES taxonomy_revisions(id) ON DELETE CASCADE, slug TEXT NOT NULL, name TEXT NOT NULL, PRIMARY KEY (revision_id, slug));
CREATE TABLE taxonomy_tags     (revision_id INTEGER NOT NULL REFERENCES taxonomy_revisions(id) ON DELETE CASCADE, slug TEXT NOT NULL, family TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL, hidden_by_default INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (revision_id, slug), FOREIGN KEY (revision_id, family) REFERENCES taxonomy_families(revision_id, slug));
CREATE TABLE taxonomy_task_groups (revision_id INTEGER NOT NULL REFERENCES taxonomy_revisions(id) ON DELETE CASCADE, task_set_hash TEXT NOT NULL, task_id TEXT NOT NULL, group_slug TEXT NOT NULL, min_bc_version INTEGER, PRIMARY KEY (revision_id, task_id), FOREIGN KEY (task_set_hash, task_id) REFERENCES tasks(task_set_hash, task_id), FOREIGN KEY (revision_id, group_slug) REFERENCES taxonomy_groups(revision_id, slug));
CREATE TABLE taxonomy_task_tags   (revision_id INTEGER NOT NULL REFERENCES taxonomy_revisions(id) ON DELETE CASCADE, task_id TEXT NOT NULL, tag_slug TEXT NOT NULL, origin TEXT NOT NULL CHECK (origin IN ('direct','derived','local')), PRIMARY KEY (revision_id, task_id, tag_slug), FOREIGN KEY (revision_id, tag_slug) REFERENCES taxonomy_tags(revision_id, slug));
CREATE TABLE taxonomy_task_donors (revision_id INTEGER NOT NULL REFERENCES taxonomy_revisions(id) ON DELETE CASCADE, task_set_hash TEXT NOT NULL, task_id TEXT NOT NULL, donor_task_id TEXT NOT NULL, ordinal INTEGER NOT NULL CHECK (ordinal >= 0), PRIMARY KEY (revision_id, task_id, donor_task_id), UNIQUE (revision_id, task_id, ordinal), FOREIGN KEY (task_set_hash, task_id) REFERENCES tasks(task_set_hash, task_id), FOREIGN KEY (task_set_hash, donor_task_id) REFERENCES tasks(task_set_hash, task_id));
CREATE INDEX idx_taxonomy_task_tags_tag ON taxonomy_task_tags(revision_id, tag_slug);
```

Vocabulary is versioned per revision, so a later revision cannot change what
an earlier hash's taxonomy meant. Activation is one statement on one row, so
readers never observe a half-written revision. Foreign keys are defence in
depth: donor and task validity is enforced by the endpoint validation in 5.2,
and the migration's staging run confirms D1 enforces the constraints before
they are relied on.

### 5.2 Admin endpoint `/api/v1/admin/catalog/task-taxonomy`

- `version: 1` payloads keep their behaviour, except: once any v2 revision is
  active for a hash, a v1 apply for that hash is refused with
  `409 taxonomy_version_regression`.
- `version: 2` payload: `{ version: 2, hash, groups[], families[], tags[],
  tasks: { id: { group, facets[] | derived_facets[] + local_facets[],
  donors?[], min_bc_version? } } }`. `hash` is required; the implicit-current
  fallback is refused with `400 hash_required`.
- Validation before any write: payload task ids equal the task ids of that
  hash; every task has exactly one known group; every facet references a
  known tag whose family exists; donors present iff group is
  `diagnose-composite`, distinct, not self, each resolving to a task whose
  group in this payload is `diagnose-single`; `derived_facets` equals the
  donor union; ordinals 0..n-1; no duplicate slugs; names and descriptions
  present.
- Digest: SHA-256 of canonical JSON `{schema_version, task_set_hash,
  groups, families, tags, tasks}` with object keys sorted, vocab sorted by
  slug, tasks by id, facet arrays sorted, donors in ordinal order, no
  undefined values. The CLI computes the same digest; a golden vector is
  tested in both runtimes.
- Writer: inserts a new revision row with `active = 0`, then all vocabulary
  and assignment rows in batches (all keyed by the new revision id, invisible
  to readers), then re-validates counts in D1 (tasks assigned = task count of
  the hash, tags referenced ⊆ tags inserted), then flips `active` in a single
  statement (`UPDATE ... SET active = CASE WHEN id = ? THEN 1 ELSE 0 END WHERE
  task_set_hash = ?`). A crash before the flip leaves an inactive, garbage-
  collectable revision and the previous active one untouched. Re-applying an
  identical payload is a no-op by `(task_set_hash, digest)`.
- `sync-taxonomy --apply` requires `--hash` or resolves the current hash from
  the task-sets endpoint's `is_current` entry (never from the latest run), and
  prints hash, task count and digest for confirmation before posting.

### 5.3 Public API: v2 alongside v1

New endpoints; v1 endpoints keep their current meaning and data until sunset.

- `/api/v2/taxonomy`: active revision for the set: groups, families, tags
  (with family, description, hidden_by_default, task_count), revision digest.
- `/api/v2/categories`: the format groups with task counts.
- `/api/v2/tasks` and `/api/v2/tasks/<id>`: `group`, `facets` grouped by
  family with `origin`, `donors[]`, `min_bc_version`. `?category=` accepts
  format slugs; `?tag=` accepts tag slugs with AND semantics and returns
  `400 unknown_tag` for a slug not in the active revision (v1 stays silent).
- `/api/v2/leaderboard`: section 6.8 wire format.
- v1 (`/api/v1/categories`, `/api/v1/taxonomy`, `/api/v1/tasks`,
  `/api/v1/leaderboard`): unchanged semantics, served from the v1 tables,
  which are frozen for a hash once a v2 revision is active. `Deprecation` and
  `Sunset` headers with a date at least 90 days after v2 activation. No
  aliases from old group slugs to facets: they are not equivalent sets. The
  v1 assignment is retained as `legacy_group` on v2 task items for the
  sunset window.

### 5.4 Caching

- `CACHE_VERSION` bumps `v9` to `v10` in the server deploy of release 1
  (before any v2 revision is activated), not with the UI.
- The active revision digest and the estimator version (6.9) join the cache
  keys of every v2 endpoint and of the tier map. Activating a revision
  therefore changes every key at once; v1 keys are unaffected.

## 6. Leaderboard statistics

### 6.1 Estimand

Intervals and bands describe sensitivity to which independent benchmark
components were included, conditional on the recorded runs and the
best-across-runs aggregation. They do not include model-run stochasticity;
that is reported separately as pass^k where trials exist (6.7). The
methodology page states this in these words.

### 6.2 Per-task score and slices

Per (model, task) the score is best across the model's runs on the hash, as
today (`tier-data.ts`, `leaderboard.ts` P1/P2 expressions): `pass_at_1` = 1 if
any run passed at attempt 1; `pass_at_n` = 1 if any run passed at any attempt;
`auc_2` = 0, 0.5 or 1. `buildScoreMatrix(hash, metric, slice)` replaces
`buildAucMatrix`. Tabs: All plus the four formats; a tab is a slice by group.

### 6.3 Coverage gate

A model is scored on a slice only if it has at least one recorded attempt on
every task of the slice. Otherwise its row shows "not evaluated on this
slice" with the attempted count, is excluded from bands, and is not ranked.
This replaces the current behaviour of scoring unattempted tasks as 0.

### 6.4 Independent components

Build the task-donor graph for the slice: tasks are nodes; two tasks are
connected when one is a donor of the other or they share a donor; a donor is
a node even when it is outside the slice. The resampling units are the
connected components restricted to tasks in the slice. A single task with no
donor edges is its own component. Every slice shows `n tasks · d distinct
donors · c components`.

Repository state on 2026-09-02 (computed from `composite-provenance.json`
over the 298 committed tasks): the 29 gated composites and their 51 donor
singles form one 80-task component; every other task is its own component.
So the composite slice has 1 component, the single-defect slice 110 (its
donor edges lead outside the slice), the reasoning-only view 60, and the All
slice 219. A donor single and the composites built from it share a defect
and are correctly resampled together on any slice that contains both.

### 6.5 Component bootstrap

- Iteration: draw `c` components with replacement (seeded RNG); a task's
  weight is its component's multiplicity. Weighted mean for model A over the
  slice: `Σ w(t)·a_t / Σ w(t)`; paired difference A−B: `Σ w(t)·(a_t − b_t) /
  Σ w(t)`. The same draws feed every model and every pair.
- Standard error of a model's score = standard deviation of its weighted mean
  over iterations. Shown as `score (± se)`.
- Bands are computed only when `c ≥ 20`; below that the slice shows scores
  with standard errors, the counts, and "too few independent components for
  tier bands". Twenty is provisional and is confirmed or moved by the
  simulation in 6.9 before bands are enabled anywhere.
- Property: a slice with no donor edges reduces to the current paired task
  bootstrap; a test asserts identical output on identical seeds.
- Leave-one-donor-out sensitivity on slices containing composites: for each
  donor present in at least three composites, the model scores with those
  composites removed. Shown as a descriptive table, labelled "not a
  confidence interval".
- Monte Carlo policy: 2000 draws, percentile intervals, labelled approximate;
  seed = hash, metric, slice, revision digest, estimator version. Percentile
  index convention pinned to `ceil((B + 1) · q) − 1` on the sorted draws and
  covered by a unit test.
- One draw per iteration over the whole graph of the current task set; every
  slice, the format-macro headline and the pooled column read that same
  draw, so cross-format correlation through shared donors is preserved.

Consequence today: the composite tab shows scores, standard errors from a
one-component resample (which equal zero and are shown as "n/a, single
component"), counts, and the leave-one-donor-out table, and no bands. That is
the honest state of the evidence, and it changes only when composites are
built from disjoint donor sets.

### 6.6 Tiers and the All tab

- Tier assembly stays anchor-based as in `tiers.ts`. The copy changes to
  "not separated from this tier's top model at 95 percent (approximate, no
  adjustment for multiple comparisons)". Pairwise intervals are available
  through the compare endpoint.
- Bands and dividers render only for `auc_2`, `pass_at_1`, `pass_at_n`. Sorts
  by cost, latency or average score show no dividers.
- All-tab headline: "format-macro score", the equal-weight mean of the four
  format means computed within each joint replicate over the whole graph
  (never four separate bootstraps, since single-defect donors also sit inside
  composites). The pooled task mean is kept as a column. A format with no
  scored model on the slice is excluded from the macro with a note.

### 6.7 pass^k

Shown for a model on a slice when it has at least three complete runs on the
hash: `k = 3` fixed; the three most recent complete runs by started time; a
task counts when attempt 1 passed in all three; the chosen run ids are
exposed in the response. Hidden otherwise.

### 6.8 Leaderboard v2 wire format

```ts
summary: { format: "all" | GroupSlug; metric: "auc_2" | "pass_at_1" | "pass_at_n";
           task_count: number; donor_count: number; component_count: number;
           inference: "bands" | "too_few_components"; estimator_version: string;
           revision_digest: string }
rows: [{ slug, coverage: "full" | "partial", attempted: number,
         headline_score: number | null, pooled_score: number | null,
         standard_error: number | null, tier: number | null,
         pass_k: number | null, pass_k_runs: string[] | null }]
sensitivity: [{ donor: string, composites: number, scores: Record<slug, number> }] | null
```

### 6.9 Validation before enabling bands

Before any band is served under the new estimator: materialize the actual
graph (components, sizes, donor degrees); simulate outcomes under a
donor-plus-task random-effects model fitted offline to the recorded runs;
measure interval coverage and false tier-split rate for task-index resampling
and component resampling; choose the `c` threshold from that; publish the
fixture graph and expected results in the repository. Estimator version
`ev1` is assigned to the validated configuration and joins cache keys.

### 6.10 Methodology page

`/methodology`: the four formats and their rules; the facet families; the
composite derivation; the estimand sentence; the component rule in one
sentence ("tasks connected by a shared donor are resampled together"); what a
band means and its limits; metric definitions; the coverage gate; pass^k;
revision digest and task-set hash in force.

## 7. UI

- `CategoryTabs.svelte` renders the format groups from `/api/v2/categories`;
  each tab header shows `n tasks · d donors · c components` and the inference
  state.
- `TaxonomyFilter.svelte` renders facets grouped by family with counts,
  hidden-by-default tags behind "more".
- Task page: group, facets by family with origin, donors with each donor's
  mechanism and invariant facets, `legacy_group` during the sunset window.
- Leaderboard: `score (± se)`, greyed "not evaluated on this slice" rows,
  pooled column on All, pass^k column with a run-id tooltip, sensitivity
  table on slices with composites.

## 8. Releases and ship order

**Release 1: taxonomy.** Sections 4, 5, 7 minus statistics. Bands on slices
that contain composites are suppressed outright (`inference:
too_few_components`, computed from the graph), bands elsewhere keep the
current task bootstrap. Order:

1. Pipeline rewrite, validator, v2 catalog, v2-capable CLI in one commit;
   hand review of mechanism and invariant facets; validator green in CI.
2. Migration 0016 applied to prod D1.
3. Server deploy: revision-aware readers, v2 endpoints (404
   `no_active_revision` until activation), coverage gate, cache version v10,
   digest in keys, v1 untouched.
4. After the re-bench ingest and the task-set flip: `sync-catalog --apply`,
   then `sync-taxonomy --apply --hash <64-hex>` (dry run first): stages an
   inactive revision, verifies, activates. Verify: assigned equals task count,
   digest matches, benchmark hash unchanged, v1 responses unchanged.
5. UI deploy switching to v2 endpoints behind a flag, methodology page,
   deprecation headers on v1 with the sunset date.

**Release 2: descriptive donor awareness.** Counts, sensitivity table,
standard errors from component resampling on slices with `c ≥ 20`, format-
macro headline, wire format 6.8.

**Release 3: inferential redesign.** Bands under the validated estimator
(6.9), tier copy, pass^k. Only after the simulation study is in the
repository.

v1 removal after the sunset date, once v2 traffic is observed.

## 9. Testing

- Pipeline (Deno): one fixture per format; alias table; composite derivation
  incl. `min_bc_version` max; validator failure cases (unknown template,
  donors on a non-composite, composite donor, self-donor, missing
  description, derived mismatch); determinism (two runs, identical bytes);
  every catalog example in this spec round-trips.
- Server (`site/`, vitest on the built bundle): endpoint validation rejects
  each listed defect; staging then activation is atomic under a simulated
  failure before the flip; identical payload is a no-op; v1 apply after v2
  activation returns 409; digest golden vector; cache keys change with digest
  and estimator version; coverage gate excludes a partial model; graph
  components computed correctly on a fixture with shared donors; component
  bootstrap equals task bootstrap on a donor-free slice; `c < 20` suppresses
  bands; unknown tag on v2 returns 400.
- e2e (Playwright): format tabs render with counts; composite task page shows
  donors and provenance; v1 endpoints unchanged after activation.
- Operational: dry run against staging D1; v1 response snapshots diffed
  before and after activation.

## 10. Success measures

- Coverage 100 percent of tasks in the current set, zero unknown slugs, every
  composite's donors resolved, validator green in CI.
- The format axis explains the attempt-1 score variance the old axis cannot
  (between-group share of variance reported for both).
- Facet-derived composite resistance reproduces the measured cross-tab
  (0 of 59 without a high-survival donor, 29 of 59 with one) without any
  outcome-derived label.
- Under the simulation in 6.9, component resampling achieves nominal
  coverage where task resampling does not, and no band is ever shown on a
  slice with fewer independent components than the validated threshold.
- No v1 response changes at activation (snapshot diff empty).
- Rerunning the pipeline is deterministic; a new untagged task fails CI.

## 11. Precedents consulted

Format or domain grouping: BC-Bench (bug-fix, test-generation; functional
area and patch size), Terminal-Bench 2.0 (16 categories, three tiers),
LiveBench (category means averaged into the headline), HELM (scenarios by
metric). Selection by measured solve rate: Aider polyglot (225 of 697 solved
by at most 3 of 7 models), BigCodeBench-Hard (solve rate under 50 percent).
Statistics: Miller 2024 (clustered standard errors up to three times naive,
report cluster count with question count, paired differences, bootstrap
justified for complicated sampling schemes); BC-Bench (five runs, BCa
bootstrap intervals, pass^5, paired sign-flip permutation tests); Chatbot
Arena (bootstrap intervals, overlap means indistinguishable). Continuous task
validation: Terminal-Bench 2.1; ours is gold-ci.

## 12. Review record

Revision 2 incorporates, from the two-model review: the multiplicity-average
bootstrap withdrawn as invalid (identical donor sets gave zero variance;
shared dominant donors were down-weighted), replaced by component resampling
with a validated threshold and honest suppression; estimand stated;
best-across-runs kept instead of a silent switch to mean-over-runs; coverage
gate for models missing a slice; bands restricted to solve metrics; pass^k
at fixed k with named runs; format-macro from joint replicates; revisioned
storage with single-statement activation instead of digest-last on live
rows; per-revision vocabulary; donor foreign keys and ordinal constraints;
families stored; v1 writes refused after v2; full validation list; canonical
digest; v2 API instead of redefining v1; no false aliases; dated sunset;
`?tag=` unknown-slug behaviour; cache bump moved to the server deploy;
locking mechanism added; invariants split from mechanisms; spec-induction
dropped; prevalence pruning replaced by a reviewed vocabulary; version tags
as a min-version field with max derivation; local composite facets; trap
count corrected; three-release split; simulation study before any band.
