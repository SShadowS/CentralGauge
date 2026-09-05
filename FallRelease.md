# Fall release: shipping the new task set

Status as of 2026-09-04. This is the operator runbook for taking the new
benchmark set from "built and reviewed" to "published and ranked". Every step
names its prerequisites, whether they are met, and the command that proves it.

Legend: **[x] done** · **[ ] not started** · **[!] blocked or decision needed**

---

## Where things stand

| Thing | State |
| --- | --- |
| Live task set in production | `b31c942bd4e8`, 110 tasks, current since 2026-05-16 |
| Local task set | 232 tasks, never benched, never ingested (298 before decision 3 retired the saturated 60, then E057/E058, M029/M037/M039 and M032) |
| Composition | 44 build-from-spec, 49 runtime-trap, 110 diagnose-single, 29 diagnose-composite |
| Taxonomy v2 pipeline (Plan A) | shipped, merged, on master |
| Taxonomy v2 site (Plan B, release 1) | shipped, merged, **deployed** at worker version `199f6cd2` |
| D1 migration `0018_taxonomy_v2.sql` | applied to production |
| `/api/v2/*` in production | live but dark: every route answers `404 no_active_revision` |
| v1 API | unchanged, verified byte-identical across the deploy |

The remaining work is a benchmark campaign and four irreversible-ish
publication steps, not code.

---

## Phase 0 — already done

- [x] **Suite built and gated.** 232 tasks after decision 3, including 29 composites that the
  panel almost never solves on the first attempt: 0 of 29 for Sonnet 5 and
  Luna, 1 of 29 for Opus 5, 3 of 29 for GPT-5.5.
- [x] **Harness replay green.** `gold-ci` reports 232 trusted, 0 stale, 0
  failing, fingerprint `0634e0ee1c1c` - every task in the set, easy tier
  included since 2026-09-05 (273 before decision 3's retirements).
  `deno run --allow-all scripts/gold-ci.ts --check`
- [x] **Object ids clean.** `deno task id-audit`
- [x] **Taxonomy generated and validated.** Schema version 2, four format
  groups, four facet families, composites deriving facets from donors.
  `deno task taxonomy-audit` prints `[OK] taxonomy valid` with counts
  44 / 49 / 110 / 29, re-run after decision 3's retirements.
- [x] **Capture path live.** The bench records the harness fingerprint,
  environment manifest, invocation snapshot, per-attempt test vectors and
  termination facts; the worker has columns for all of it.
- [x] **Worker deployed before the campaign.** This ordering matters: a run
  ingested before the deploy is permanently `pre_capture`.

---

## Phase 1 — decisions that gate the campaign

Nothing below costs money, but the campaign cannot be sized without them.

- [x] **Decision 1: the headline reading.** FROZEN 2026-09-06, before any
  campaign run, on three independent panel opinions (`.panel/decision1-*`:
  GPT-5.6 Sol, Fable 5, GPT-5.6 Terra) that converged without seeing each
  other:

  - **Headline:** full-set (232-task) **format-macro AUC@2** - the
    equal-weight mean over the four formats (spec 6.6), sort key `auc_2` as
    the site already ships. **Labelled descriptive.** The All slice fails
    both of spec 6.5's gates (`c_eff` 8.2 against a floor of 20; largest
    component 34% against a cap of 25%), so All and the composite view show
    scores, counts and the subset-influence table only: **no tiers, no
    intervals, no separation dividers this release.** Composites are not
    down-weighted post hoc; the composite programme is redesigned with
    disconnected donor families for the next cycle.
  - **Columns:** per-format rates, pooled task mean, first-try, best-of-2,
    repair lift (best-of-2 minus first-try), cost.
  - **Runs per model: three**, matching the spec's cohort (6.2). Every
    published number is the mean across the three runs. The spec's union
    ("passed at attempt 1 in any of three runs") does not travel under the
    name `pass_at_1`: if shown it is `one_shot_any_of_3`, alongside the
    strict all-of-3 figure. Run ids, settings hash and cohort digest are
    published with the numbers.
  - **The hard split** (panel-selected, attempt 1, reasoning-only) is
    published as `development-selected` only, with no ranking claim for
    the models that selected it. A holdout protocol (development panel
    selects, disjoint holdout panel is ranked) is a later release.
  - **The "top model at or below 50%" bar is retired.** A low score is a
    consequence of a good hard set, not evidence of one; the targets are
    precommitted metrics, separation on models not used to choose tasks,
    and no single donor cluster deciding the outcome.
  - Every leaderboard view carries one of three labels: `descriptive full
    suite`, `development-selected`, `holdout-selected`.

  The evidence that led here, kept for the record. The bar as originally
  set was "top model at or below 50%". Measured on the current suite:

  | Reading | n | Opus 5 | Sonnet 5 | Luna |
  | --- | --- | --- | --- | --- |
  | best-of-2, whole reasoning set | 139 | 93.5% | 84.9% | 79.9% |
  | best-of-2, panel-selected | 40 | 78% | 48% | 30% |
  | **attempt 1, panel-selected** | **59** | **39%** | **20%** | **10%** |

  Only the attempt-1 reading clears that bar, which is exactly why the bar
  was retired rather than the reading adopted.
  `docs/reasoning-suite/hardening-levers-evidence.md` holds the evidence;
  `scripts/panel-select.py` reproduces the retention.

  **Three things the numbers above do not say, and a reviewer will.**

  1. **They are not a measurement of the whole set.** All 139 are diagnose
     tasks: the 110 singles and the 29 composites. No build-from-spec or
     runtime-trap task is in them, and decision 3's retirement does not
     change that — it removes only build-from-spec tasks, so the two formats
     the 59 say nothing about still number 99. A headline drawn from the 59
     makes no claim about two fifths of the post-retirement benchmark, and it
     conflicts with the taxonomy design's own rule that the "All" score is an
     equal-weight mean over the four formats
     (`docs/superpowers/specs/2026-09-02-taxonomy-v2-design.md`, 6.x).
  2. **The 59 are not 59 independent observations.** All 29 composites
     qualify under the attempt-1 rule, and the composites plus their donors
     are one connected component in the task-donor graph. That is a
     largest-component share near 49%, against the design's own publication
     gate of 25%, under which only descriptive scores and a subset-influence
     analysis may be shown. The 29 also rest on about seven donor mechanisms,
     so the split weights a handful of AL semantics heavily.
  3. **The panel is reused twice.** The composites were gated against Opus
     and GPT-5.5 outcomes during construction, then the retained set was
     selected against panel outcomes again. Opus's 39% is a development-panel
     statistic, not an unbiased estimate on fresh tasks.

  **Before adopting any reading, resolve the `pass_at_1` definition.** The
  scoring policy in the spec sets `pass_at_1 = 1 if any cohort run passed at
  attempt 1`, with a cohort of the three most recent runs. That is a union
  over three first attempts, which will score higher than the single-run
  attempt-1 numbers used for the selection above. Selecting on one-run
  attempt 1 and publishing a union under the same name is not defensible.
  Either average across the cohort's runs, report each run, or rename the
  union.

  **Freeze the metric and the selection rule before the campaign**, not
  after. Choosing either once the campaign numbers are in is metric shopping,
  and it will read that way.

- [x] **Decision 2: launch-hardening waves 2 to 4.** CONFIRMED superseded
  by the owner 2026-09-06. `docs/reasoning-suite/launch-hardening-plan.md`
  still lists them and `PLAN.md` still says "final bench and flip only on
  the hardened set"; both are historical now. The campaign runs on the set
  as it stands after decision 3.

- [x] **Decision 3: retire the 60 tasks the frontier has saturated.** DONE
  2026-09-04 — the deletion is executed and committed; see "What the
  retirement actually did" below.
  Continuity with the published leaderboard is explicitly not a constraint
  (owner ruling, 2026-09-04), so the set is free to shrink on evidence.

  **Evidence.** On the published set `b31c942bd4e8`, sixty tasks are passed
  on every attempt by all three of `anthropic/claude-fable-5`,
  `gemini/gemini-3.1-pro-preview` and `anthropic/claude-opus-4-8`. They
  cannot separate models at the frontier, and every one of them costs a
  share of every campaign. All sixty are build-from-spec: 13 easy, 14
  medium, 33 hard. The ids are in
  `docs/reasoning-suite/retired-2026-09-04.txt`.

  **Scope of the deletion: 188 paths.** 60 task YAMLs, 60 oracles under
  `tests/al/<tier>/`, 5 companion AL files (`CG-AL-E008.MockProcessor.al`,
  `CG-AL-E032.MockTokenProvider.al`, `CG-AL-H001.ProductType.al`,
  `CG-AL-H205.Spy.al`, `CG-AL-H205.Subscriber.al`), 16 prereq directories
  under `tests/al/dependencies/`, and 47 reference directories under
  `reference/solutions/`.

  **Safety checks, run 2026-09-04, all clean.** No kept task's prereq
  depends on a retired task's prereq (0 hits across the chained
  `dependencies` arrays). No kept manifest references a retired id (0 hits).
  So nothing that stays behind breaks.

  **Resulting campaign set: 238 tasks.**

  | Format | Before | Retired | After |
  | --- | --- | --- | --- |
  | build-from-spec | 110 | 60 | 50 |
  | runtime-trap | 49 | 0 | 49 |
  | diagnose-single | 110 | 0 | 110 |
  | diagnose-composite | 29 | 0 | 29 |
  | **total** | **298** | **60** | **238** |

  **The remainder, audited 2026-09-05.** Thirteen tasks were left open by
  the retirement: twelve with no reference solution (`E001 E006 E010 E050
  E052 E054 E056 E057 E058 M034 M040 X044`) and three passed by nobody
  (`M023 M034 M040`). Five `al-test-auditor` runs, every load-bearing claim
  re-verified against the files and the local results corpus (reports in
  the session scratchpad `audit13/`). Outcome:

  | Task | Verdict | Finding, and what was done |
  | --- | --- | --- |
  | M040 | oracle FIXED | Unpassable since creation: `Test.al:44` compared an Integer literal to a BigInteger field (type-strict). All 14 attempts that ever compiled passed RoundTrip and failed only this. Fixed with a BigInteger local; two unchecked returns (lines 17, 43) asserted. Reference lifted from a stored `ExtendedDatatype = Task` submission; probe 2/2. |
  | M023 | KEEP | Oracle bug fixed 2026-08-28; reference gold-ci green. Published 0/78 predates the fix. `PROVENANCE.md` updated. |
  | M034 | KEEP, hardened | Oracle bug fixed 2026-06-13; GPT-5.5 passed 2026-08-27. Reference seeded from that run, probe 2/2. `SetAutoCalcFields` was never verified (plain `CalcFields` passed) so `expected.mustContain: [SetAutoCalcFields]` was added, and two coaching parentheticals were cut from the manifest. |
  | X044 | KEEP | Oracle discriminates (3-solution probe). Reference committed from `scratch/trap-probe/x044-correct/`; re-probed 3/3 on BC 28.4. |
  | E052 | oracle FIXED | `Contains('2025')` failed the idiomatic `Format(Date)`, which locale 1033 renders as `06/15/25`; now accepts a 2-digit year. `IsShipped` value was never checked; now asserted both ways. |
  | E006 | manifest FIXED | Asked for a page extension only while the oracle needs the fields on the Customer table. One sentence added. |
  | E010 | manifest FIXED | Named a non-existent event `OnAfterInsert` (135 local AL0280 failures, Sonnet 4.6 at 1/12). Now described behaviourally, so the name is still the model's to know. |
  | E057 | **DELETED** 2026-09-05 | Oracle never touched the three properties it existed to test; a submission with the deprecated `AllowInCustomizations = Always` scored 100, and the correct `AsReadWrite` appears zero times in the corpus. Only closings were an unverified companion-file compile gate or new harness tooling. `docs/reasoning-suite/retired-2026-09-05.txt`. |
  | E058 | **DELETED** 2026-09-05 | Oracle was one `SmokeCheck()`; all 16 valid `TestType`/`RequiredTestIsolation` combinations passed, omission included. Same closing options as E057, same ruling. |
  | E001 E054 E056 E050 | KEEP | Clean; failures are real knowledge gaps. (An auditor first called E050 broken; 56 stored `@'...'` submissions that compiled and passed settled it.) |

  **Batch sweep, 2026-09-05 (same day).** M040, E057 and E058 come from
  the 2026-05-08 "v15-v17 features" batch and shared one shape: the subject
  is a compile-time property or API with no runtime surface, and the oracle
  is a storage round-trip. So the batch's other eight survivors were swept
  by three more auditors, every claim re-verified:

  | Task | Verdict | Finding, and what was done |
  | --- | --- | --- |
  | M027 | KEEP | All 18 typed JSON getters invoked and asserted on both paths. Clean. |
  | M028 | gated | Oracle asserts only `No.`/`Name`; omitting the Summary system part *and* the pageextension scored 100 while a wrong identifier failed compile (70x AL0890). `mustContain: [DefaultSummaryPart]` - the compiler names it as the sole legal identifier. |
  | M036 | gated | Two `IsTrue` on Boolean returns; `exit(true)` passed. `mustContain: [WriteWithSecretsTo]`. |
  | M032 | **DELETED** | Sound on a virgin DB, dead in practice: the prereq seeds only `if IsEmpty` and republish/cleanup preserve data, so after the first candidate mutates the rows an empty install trigger passes 3/3 (38 of 38 recorded runs). The proposed fix was probed and is impossible: `DataTransfer` is session-gated at runtime (`decisions.md` 42), so no oracle can re-run it; only a harness-level per-attempt prereq reset could, and it does not exist. |
  | M031 | repaired + gated | Blind (integer overloads pass both tests; page, report and both compile-check procedures never referenced) and three manifest lines killed spec-followers: "each AL file must declare namespace" against a harness that concatenates into one file (65/140, AL0198), "Caption on each object" including codeunits (100/140, AL0124), "passed as a Text argument" against zero-arg oracle calls. All five edits applied; gate on the four FQN string literals whose content the manifest fixes exactly. The only v17 probe in the set. |
  | M029 | **DELETED** | Oracle never touches the candidate (all three tests hit prereq objects; a pagecustomization is unobservable via TestPage) and the manifest demanded a Caption on the pagecustomization that cannot compile (72/144, AL0246). |
  | M037 | **DELETED** | Manifest's `Category` argument is uncompilable (146x AL0761 - the platform requires `EventCategory`); the only compiling route needs an enumextension the manifest never asks for; the reference silently took it; the oracle passes an empty codeunit. |
  | M039 | **DELETED** | Both assertions check `Visible`/`Enabled` at their AL defaults. The v16 subject is `TestPart.Visible()/Enabled()`, a test-side API the candidate cannot exercise; the manifest's "demonstrate the instance methods" drove all 60 AL0127 failures. |

  Batch tally: 13 tasks, 1 clean, 5 repaired or gated (M034 M040 M028 M036
  M031), 6 deleted (E057 E058 M029 M037 M039 M032), 1 reference-only
  (M023). All three gates are satisfied by the committed references.

  gold-ci after all of it, with the easy tier now in scope: 232 trusted,
  0 stale, 0 tasks without a reference - every task in the set has a
  verified reference. The set is now **232 tasks** (44 / 49 / 110 / 29);
  the taxonomy pipeline and every audit are green on it. `task_sets.hash`
  moved again, which costs nothing until the campaign starts.

  **On `mustContain` gates.** A gate is a raw case-sensitive substring
  test, so it proves presence, not correct use. It is legitimate only where
  the compiler already validates use (a wrong identifier or overload fails
  compile) and the hole was omission. That holds for the four above; it
  would not hold for a task whose subject can be written wrongly in a way
  that compiles.

  **Still the owner's call.** (1) ~~E057 and E058~~ deleted 2026-09-05;
  ~~M027-M041 sweep~~ done, M029/M037/M039 deleted.
  (2) ~~The seven easy tasks with no reference~~ gold-ci and the seed
  script now cover `easy`; all seven seeded and replayed green.
  (3) ~~Four containers down~~ all six restarted 2026-09-05 and proven
  end-to-end (they had exited with `3221225786`, a host console-close).
  (4) ~~M032~~ deleted 2026-09-05 after the probe (`decisions.md` 42)
  showed no oracle can re-run an install-time API. Release-2 item: a
  harness-level per-attempt prereq data reset (uninstall with
  `-DoNotSaveData` + reinstall) is the precondition for ANY future
  install/upgrade task having a behavioural oracle.

  **What the retirement actually did.** 315 files removed. The taxonomy
  pipeline was re-run (build, merge, validate, graph fixture) and is
  deterministic on the new tree; `taxonomy-audit`, `id-audit`,
  `oracle-audit` and `gold-ci --check` are all green, and the unit suite is
  1426 passed / 0 failed. Four things had to move with it:

  - `expected-counts.json` build-from-spec 110 → 50, and the 60 retired ids
    were pruned from `pipeline/enriched-tags.json` (238 entries left).
  - `scripts/id-audit.ts` lost three now-stale allowlist entries — the
    `table:69001` co-install set narrowed to M001 + X058, and the duplicate
    pairs at `codeunit:80015` and `codeunit:80012` are gone with their
    members. Same-folder duplicate test-codeunit pairs went from four to
    two; cross-folder reuse from 24 ids to 2.
  - Four unit tests were pinned to retired tasks and now point at surviving
    ones (`E002` → `M001` for the two real-prereq tests, `E002` → `E010` in
    the debug parser, `E008` → `E010` in the hasher).
  - `.claude/rules/prereq-apps.md` had E002 as its worked example and a
    chained H022 → H023 prereq that no longer exists. **No CG-to-CG prereq
    chain survives anywhere in the tree**; the resolver still supports one,
    but the section is now explicitly illustrative.

  `task_sets.hash` has moved, which is expected — the campaign runs on the
  new hash.

  **One consequence a reviewer will raise.** Retiring 60 unconnected tasks
  concentrates the set on the composite component. The whole-set
  `largest_component_share` rose from **0.268 to 0.336**, against the
  design's 25% publication gate (`taxonomy-graph-fixture.json`). It was
  already over the gate and is now further over. This does not argue against
  the retirement — those 60 tasks contributed no separation — but it does
  mean the whole-set headline needs the subset-influence treatment the
  design calls for, not just the reasoning-only slice discussed in decision
  1.

  **Standing rule for the next cycle.** After each campaign, retire every
  task that every frontier model passes on every attempt. Regenerate the
  list from that campaign's results the same way this one was generated, and
  record it as `docs/reasoning-suite/retired-<date>.txt`.

- [!] **Decision 4: vocabulary gaps.** Recurring facets the enrichment wanted
  and the frozen vocabulary lacks: `ishandled-gate` (3 tasks),
  `collectible-errors` (4), `stale-record-buffer` (3), plus `rename-cascade`
  and `enum-dispatch-completeness`. Six tasks carry no analytic facet at all
  (`X094`, `X130`, `H043`, `H056`, `X003`, `X030`). `culture-sensitive` is
  defined and unused. Adding a facet is a code change in
  `site/src/lib/shared/taxonomy-schema.ts` plus the enrichment workflow, then
  a pipeline re-run. It is decoupled from the task-set hash, so it never
  forces a re-bench, but the vocabulary should be settled before the taxonomy
  is activated and consumers start filtering on it.

- [!] **Decision 5: batch mode for the campaign.** Proposed by the owner
  2026-09-06. The bench does not need answers instantly, so run each model
  through its provider's batch API instead of the synchronous endpoint:
  submit attempt 1 for every task in one batch, wait, compile and test all
  of them, then submit attempt 2 for the failures as a second batch. Slower
  by hours, roughly half the token bill - Anthropic Message Batches,
  OpenAI Batch and Gemini batch mode all price at about 50% of synchronous
  rates. On the campaign's $600 to $1,050 that is $300 to $525 saved.

  What it costs to build, from the code as it stands:

  - Today every attempt is one synchronous call inside the per-task loop
    (`src/parallel/orchestrator.ts:895-905`: `executeLLMAttempt` then
    `executeCompilation`, task by task, attempt by attempt). Batch mode
    inverts that into two phases per model: LLM phase for all tasks, then
    the compile/test phase, then the same again for the retry set. The
    `LLMAdapter` interface (`src/llm/types.ts:138`) has no batch method and
    no adapter speaks a batch endpoint (`grep batches src/llm` is empty).
  - The per-model cohort semantics survive: a batch is still one run id;
    three runs per model are three batch cycles. Capture (harness
    fingerprint, invocation snapshot, test vectors) is unaffected because
    the compile/test phase is unchanged.
  - Refusal fallbacks (`shouldRequestServerFallback`, the beta header) must
    be checked against the batch endpoint - the fallback param may not be
    accepted there, and `servedModel` must still be recorded per item.
  - Pricing: `site/catalog/pricing.yml` has no batch rate column and
    `rowCostUsd()` prices by synchronous rates, so batch runs would be
    over-reported by 2x on the site unless a batch flag and rate are added
    (`model-discovery-types.ts:34` already carries a `batch` eligibility
    bit from LiteLLM).
  - Batch turnaround is provider-bound (up to 24 h per batch on all three);
    a three-run cohort per model is then six batch cycles, so the campaign
    is measured in days rather than hours. Acceptable per the owner.

  **Panel verdict 2026-09-06, unanimous: do not build batch mode before
  this campaign.** Run the first campaign synchronously on the known path;
  land batch mode for the next cycle. The reasons converge: the capture
  path has never run end-to-end against a real bench (Phase 3), so
  combining it with a never-built orchestration path maximises the chance
  of numbers that cannot be ingested; the saving is smaller than written
  (the three-model campaign is $360-$630, so batch saves $180-$315); and
  the two-phase shape touches the orchestrator's most delicate invariant -
  attempt 2 is built on attempt 1's compiled candidate
  (`src/parallel/orchestrator.ts:919-933`), which would have to be
  persisted across a days-long phase boundary. Design requirements the
  panel recorded for the release-2 build, in severity order:

  1. Refusal fallbacks: `createMessage` sends `betas:
     [SERVER_FALLBACK_BETA]` + `fallbacks: "default"`; whether Message
     Batches accepts either is unverified, and Fable 5 is the model with
     documented HTTP-200 refusals. `servedModel` must be extracted per
     batch item or capture and billing both break.
  2. Pricing: a batch rate column in `pricing.yml` and in `rowCostUsd()`
     must ship WITH batch mode, not after - cost is a headline column and
     batch runs would otherwise show 2x.
  3. Run and cohort identity: one run id spans both phases; three runs are
     six multi-day cycles; `settings_hash` must distinguish batch from
     sync so the two never share a cohort; `started_at` ordering with
     interleaved multi-day runs needs a ruling.
  4. Coverage: expired or errored batch items must become explicit
     per-task terminal cells (`termination_kind`) or safe resubmission,
     never missing rows, or the model fails spec 6.3's coverage gate.
  5. Attempt-2 equivalence: the `generateFix` inputs (candidate, compiler
     diagnostics, assertion failures) must be reconstructed identically to
     the synchronous path or the two paths are not comparable.
  6. Idempotency: stable custom ids per item (model, run, task, attempt,
     prompt digest) so resubmission never double-counts.
  7. Truncation detection moves from streaming to a post-hoc token audit.
  8. Provider batch limits, chunk roll-up to one run id, and the
     post-batch burst onto six containers (infra-retry budgets are shaped
     for a trickle, not 232 candidates at once).
  9. OpenRouter `:batch` variants are yet another model identity.

---

## Phase 2 — pre-campaign hygiene

Run in this order. All are free and fast.

- [ ] **Static oracle audit.** `python scripts/oracle-audit.py` must exit 0.
- [ ] **Object ids.** `deno task id-audit`
- [ ] **Harness replay.** `deno run --allow-all scripts/gold-ci.ts --check`
      must stay at 232 trusted, 0 stale, 0 failing. Any edit to `tests/al/**`,
      a prereq, a reference or the harness invalidates it.
- [ ] **Taxonomy.** `deno task taxonomy-audit`
- [ ] **Catalog drift.** `deno task start sync-catalog --apply` so every model
      you are about to bench exists in the catalog with real pricing.
- [ ] **Ingest preflight.** `deno task start doctor ingest` verifies config,
      keys, connectivity and catalog state in one signed round trip.
- [ ] **Containers healthy.** All six Cronus containers up, no bench running,
      `DOCKER_CONTEXT=desktop-windows` exported.

If any of these fail, stop. A campaign run against a broken gate is money
spent on numbers you will not trust.

---

## Phase 3 — the campaign

- [x] **Choose the panel.** CHOSEN 2026-09-06, NOT YET RUN - the owner's
      instruction is explicit: these models are expensive, and nothing is
      launched until every gate above is green and the dry run is clean.

      | Model | Slug | Status 2026-09-06 |
      | --- | --- | --- |
      | Claude Opus 5 | `anthropic/claude-opus-5` | **scout, runs first.** In the catalog at $5/$25 per Mtok - half Fable's rate. Was a composite construction-gate model, so in-sample for the composite slice; disclosed. |
      | Claude Fable 5.1 | `anthropic/claude-fable-5-1` | CHOSEN 2026-09-06 over Fable 5 after the panel split. In the catalog; its pricing row is marked ASSUMED equal to Fable 5 ($10/$50, `pricing.yml:701-702`) - **confirm the list price and fix the row before `sync-catalog --apply`**, that is a gate. |
      | GPT-6 Astra | `openai/gpt-6-astra` | live on the OpenAI API (`models -p openai --live`); NOT in the catalog yet, so the bench precheck auto-seeds it and the YAML must be committed afterwards |
      | Gemini 3.8 Flash | `gemini/gemini-3.8-flash` (expected) | exists: OpenRouter lists `google/gemini-3.8-flash` (and a `:batch` variant). The DIRECT Gemini discovery call returned 400 today (`models -p gemini --live`: Failed to list models), so either fix the Gemini key/endpoint before precheck or bench it as `openrouter/google/gemini-3.8-flash` |

      Four models, one above decision 1's floor. Opus 5 was a composite
      construction-gate model (in-sample for the composite slice). Fable 5,
      not 5.1, was a saturation-rule model, so 5.1 is clean for the
      headline; disclose the lineage. GPT-6 Astra and Gemini 3.8 Flash are
      clean.

      **Order of running, owner's rule 2026-09-06: Opus 5 first, alone.**
      It costs half of Fable 5.1 and exercises everything that has never run
      on this set - the capture path, the token-cap audit, six containers
      under campaign load, ingest - before the expensive models spend. Its
      first finished run is the Phase 3 "verify capture" gate. What the
      scout does NOT do: it does not exempt Fable 5.1 from any task. The
      idea "if Opus solves it, Fable will too, so skip it" was considered
      and rejected: spec 6.3's coverage gate requires an attempt on every
      task of a slice or the model is not ranked for it, Fable has
      documented HTTP-200 refusals on tasks Opus passes (X041, X050-52),
      and the retirement data itself showed Opus 4.8 and Fable 5 pass sets
      differ. Every panel model runs the full set three times. The published selection was measured on Opus 5,
      Sonnet 5 and Luna; with this panel the retained set is re-derived and
      labelled development-selected per decision 1.

      **Panel review, 2026-09-06** (`.panel/choices-{anthropic,google,openai}.md`;
      Fable 5, Gemini 3.8 Flash, GPT-5.5 - the Google seat is itself a
      nominee and argued against its own tier, so its view is not
      self-serving). Unanimous on three points, all still open for the
      owner:

      1. **Three models is the floor, and thin for a public board.** The
         hardening plan's own finding stands: three models give the
         retention dial three notches and "we cannot express that threshold
         on 3 models" (`launch-hardening-plan.md:347-351`; Aider used 7).
         Descriptive headline: publishable. Development-selected split:
         re-derived from three models repeats the diagnosed failure. Two
         of three panelists want five models (+$240-$420 for the cohort).
      2. **Flash next to two flagships confounds family with tier.** All
         three would put Gemini's flagship in the family slot, or run both
         Flash and Pro with the tier labelled. Google's own seat expects
         Flash to fail the composites outright.
      3. **Do not route Gemini through OpenRouter for the campaign.** The
         slug is the model identity in the catalog, pricing, cohort and the
         signed release manifest; an OpenRouter run and a later direct run
         never unify, and OpenRouter normalises the provider metadata the
         capture path (spec 5.5) records. Fix direct Gemini discovery (the
         400 today) before the dry run. Same discipline for GPT-6 Astra:
         commit the auto-seeded catalog and pricing rows before publishing.

      Split, owner's call: **Fable 5 vs 5.1.** Two panelists say a first
      campaign on a rebuilt set should not open on a superseded model; the
      third says 5 is the safe choice because 5.1's pricing row is marked
      ASSUMED and must not be synced to prod unverified
      (`site/catalog/pricing.yml:701-702`). Confirming the 5.1 list price
      is minutes; then bench 5.1.
- [ ] **Dry run first.** Never submit a real run without one.
- [ ] **Run the full set, two attempts, uncapped, three times per model.**
      One invocation per model, Opus 5 first:

      ```
      deno task start bench --preset fall-2026 --llms anthropic/claude-opus-5 \
        --max-tokens 64000 --debug --debug-level verbose --debug-output "h:\Temp3" \
        --no-compiler-cache
      ```

      The preset carries the panel, five containers (Cronus281 is up and
      healthy but was left out by the owner's habit - add it back to spread
      load if wanted), `runs: 3`, `attempts: 2`, `stream`, `maxConcurrency
      20`, `taskConcurrency 12` and `maxTokens 64000`. The debug flags and
      `--no-compiler-cache` are not preset-mergeable and stay on the
      command line; `--no-compiler-cache` costs a compiler-folder rebuild at
      startup (~49 s across three containers even warm) and changes no
      score. Then Fable 5.1, GPT-6 Astra, Gemini 3.8 Flash the same way. The preset's `runs: 3` satisfies decision 1: the
      `--runs` loop (`cli/commands/bench/parallel-executor.ts:439-834`)
      builds a fresh orchestrator, writes its own results file and ingests
      per iteration, so each of the three is its own run id in the cohort.
      Never merge runs into one results file.
      **`--max-tokens 64000` is mandatory on the command line**, not merely
      in `.centralgauge.yml`: `cli/commands/bench-command.ts:106` still
      declares the Cliffy option with `default: 4000`, and a Cliffy default
      is a value, so it silently overrides the config file's 64000. That
      exact defect once produced a fake 88% baseline
      (`docs/reasoning-suite/launch-hardening-plan.md:177-206`). A preset
      `maxTokens` also escapes it (`bench-command.ts:857` checks whether the
      flag was typed), but put it on the command line anyway, and check
      the per-attempt completion-token counts on the first finished run
      against the cap before trusting anything.
- [ ] **Cost.** Anchors from the composite work: 29 composites across two
      frontier models cost $28.90; the same across Sonnet and Luna cost $9.17;
      one uncapped pass over the 110 singles was estimated at about $40 per
      frontier model. Budget roughly $50 to $80 per frontier model for the
      full 298. Decision 3 has since cut the set to 232, and the sixty
      saturated tasks it removed were the cheapest in it, so expect roughly
      a fifth off the task count and rather less than a fifth off the bill:
      budget $200 to $350 for a five-model panel per run. The chosen panel
      is THREE models, one Flash-priced, so roughly **$120 to $210 per run
      and $360 to $630 for the three-run campaign** (the earlier
      $600-$1,050 figure was written against five models).
- [ ] **Verify capture on the first finished run.** Open the results file and
      confirm the `ingest` block carries the environment manifest and the
      invocation snapshot, and that per-attempt test vectors are present. The
      end-to-end capture path has never run against a real bench.

---

## Phase 4 — ingest and flip

- [ ] **Ingest.** The bench auto-ingests unless `--no-ingest` was passed. A
      replayed run uses `centralgauge ingest <results-file>`.
- [ ] **Confirm the new task set landed.** `GET /api/v1/task-sets` should list
      the new hash alongside `b31c942bd4e8`, with the task count decision 3
      settled on.
- [ ] **Check capture stored.** `GET /api/v2/runs/<id>` will still 404 until
      activation, so verify in D1: `runs.harness_fingerprint` non-null and
      `results.test_vector_json` populated for the new runs.
- [ ] **Flip the current set.**
      `POST /api/v1/admin/catalog/task-sets {hash, created_at, task_count, set_current: true}`
      The leaderboard switches to the new set at this moment. Old scores stay
      queryable under the old hash; they do not mix.

---

## Phase 5 — activate the taxonomy (irreversible)

- [ ] **Dry run.** `deno task start sync-taxonomy` prints the task count and
      the digest it would send.
- [ ] **Apply.** `deno task start sync-taxonomy --apply --hash <64-hex>`
      Version 2 requires the explicit hash and never auto-discovers.
- [ ] **Verify.** The server's returned `digest` must equal the one the CLI
      printed. `GET /api/v2/taxonomy` then returns the four groups with counts
      summing to the task count, and `GET /api/v2/tasks?category=diagnose-composite`
      lists 29 items.
- [ ] **Verify v1 did not move.** `GET /api/v1/categories` and
      `/api/v1/taxonomy` must be byte-identical to their pre-activation bodies,
      ignoring `generated_at`. There is a test for exactly this
      (`site/tests/api/v1-frozen.test.ts`), but check production too.

**What activation costs you.** From the first `taxonomy_active` row anywhere
on the site, every schema-version-1 taxonomy write is refused with
`409 taxonomy_v1_frozen`, site-wide and permanently. There is no unfreeze path
in the code; recovery means deleting the row by hand in production D1. No
workflow and no CLI command other than `sync-taxonomy` writes v1 taxonomy, so
nothing automated breaks. What becomes impossible is populating v1 taxonomy
for any task set promoted afterwards, so `/api/v1/categories` and
`/api/v1/taxonomy` will report a stale vocabulary for the new set until v1
sunsets. That is intended, and it will be visible on the live site.

---

## Phase 6 — policy and the first release

- [ ] **Create the scoring policy** from spec section 6.2. `settings_hash` is
      the canonical profile of the campaign, readable from
      `GET /api/v1/runs/<id>`.
      `POST /api/v1/admin/catalog/scoring-policies {policy}`
- [ ] **Assign it** to the new hash: the task-sets admin POST accepts
      `scoring_policy_digest`.
- [ ] **Select the retained set.**
      `python scripts/panel-select.py <results-file>... --metric pass1 --max-solvers 2 --emit-tasks`
      The result files are positional and `--max-solvers` is what makes the
      script emit task ids; without both, it does not reproduce the retained
      set.
- [ ] **Publish the release.** `POST /api/v1/admin/releases` with the slug,
      hash, revision digest, policy digest, estimator version, panel manifest,
      retained task ids and selection reasons.
- [ ] **Verify the export bundle.** `GET /api/v2/exports` lists the files and
      the manifest sha256, which must match the release row.

**Publish the first release against a throwaway slug on a small set first.**
Release publication is not transactional: the row commits before the export
bundle is written, so a failed export leaves a release with a null manifest
and burns the slug behind `409 release_exists`. Fixing that is a release-2
item; until then, rehearse.

**Rate limit.** `/api/v1/admin/*` caps near 10 requests per minute and this
phase issues several signed admin calls in a row.

---

## Phase 7 — after the launch (release 2, not blocking)

Carried from the Plan B whole-branch review, in the order they should be
fixed:

- [ ] Release publication made transactional, and the export bundle moved out
      of the admin request into a scheduled job.
- [ ] The v1 snapshot is written but never read. Either serve v1 from it or
      amend spec 5.3 to the freeze-writes design that shipped.
- [ ] Migrate the eleven `/api/v2/*` routes onto the epoch cache. They are
      listed as exemptions in `site/tests/build/route-cache-coverage.test.ts`
      with that note.
- [ ] Spec corrections: 5.1's `AUTOINCREMENT`, 5.3's freeze-writes decision,
      5.6's actual export bundle contents.
- [ ] Statistics API and UI (spec sections 6 and 7): format-cut tabs, tier
      bands per slice, composition-sensitivity labelling. Needs its own plan.
- [ ] `?cohort=<digest>` re-selection, `open_weight` on v2 model rows, and the
      `Deprecation` and `Sunset` headers.

---

## Rollback

| Step | Reversible? | How |
| --- | --- | --- |
| Deploy | yes | redeploy the previous worker version |
| Migration 0018 | additive only | leave it; no v1 code reads the new tables |
| Ingest | yes | the run rows can be deleted; nothing else references them |
| Task-set flip | yes | flip `is_current` back to the old hash |
| Taxonomy activation | **no** | delete the `taxonomy_active` row by hand in production D1 |
| Release publication | partial | the slug is burned until the row is deleted |

---

## Loose ends unrelated to the sequence

- Two inert applied stash entries sit on the shared stash stack
  (`task11-wip-check-baseline`, `task8-wip-check-preexisting`). The safety net
  blocks dropping them from an agent session.
- `metadata.category` in task files is frozen and ignored. Do not edit it.
- The taxonomy is decoupled from the task-set hash: refreshing groups or
  facets never invalidates a benchmark and never forces a re-bench.
