---
name: composite-batch
description: Build a batch of multi-defect composite diagnose tasks that frontier models fail on attempt 1 - assemble N already-gated donor tasks verbatim into one app with all N defects live, withhold the symptom, screen with one bench trial, confirm survivors at three. Use when the suite needs harder tasks and single-defect authoring has saturated.
---

# Composite batch

Produces diagnose tasks that BOTH `anthropic/claude-opus-5` and
`openai/gpt-5.5` fail on attempt 1, behaviourally, in at least 2 of 3 trials.
22 such tasks were built this way for $176 total, about **$8 per gated task**:
X185/X187/X194/X211/X214/X218/X234 (4 sites), X239/X244/X245/X248/X249 (5),
X254/X257/X263/X264 (6), X270/X271/X272/X274/X276/X278 (8).

**Read `docs/reasoning-suite/hardening-levers-evidence.md`, the sections from
"Multi-defect composites with a withheld symptom" onward, for the measurements
behind every claim here.**

## The idea in one paragraph

Nothing new is authored. Take N single-defect tasks that are ALREADY gated and
that every model solves first-try in isolation, copy their starters and
references verbatim into one application so all N defects are live at once,
merge their oracles into one codeunit, and write a description that states each
module's contract but says nothing about what is wrong or where. Difficulty
comes from attention dilution across defect sites, not from any defect being
subtle. The sharpest datum: X114's defect is `>= 360` where the contract says
`> 360`. It is solved 30/30 standing alone by every model in every trial, and
missed by both frontier models in every cell once other defects compete.

## The dose-response, and where to build

| defect sites | screened | candidates | rate | confirmed | $/gated task |
| --- | --- | --- | --- | --- | --- |
| 4 | 58 | 10 | 17% | 7 of 9 | $14.6 |
| 5 | 15 | 5 | 33% | 5 of 5 | **$6.2** |
| 6 | 15 | 5 | 33% | 4 of 5 | $8.2 |
| 8 | 10 | 6 | **60%** | 6 of 6 | $8.2 |

It is a STEP at 4 to 5, not a ramp: five and six behave identically, then eight
jumps again. Build at 5 sites for cost, 8 for hit rate. 10+ is untested and the
curve has not saturated.

Two things that do NOT predict a hit, both tested and dead: **donor hardness**
(X183 carried two of the suite's hardest donors and both models solved it,
while X185's donors are all 30/30-easy and it resists) and **defect quietness**
(a whole batch built from 4-line-or-smaller boundary/format edits returned
1 of 8, no better than baseline).

## Prerequisites

- `prompt_template: diagnose-objects.md` on every composite. NOT optional above
  ~8 objects: object omission runs 18.2% of attempts at 13+ starter objects and
  killed X175's attempt 2. Under the overlay it measured ZERO across 130+
  screen cells. It is already wired per-task (`usesObjectOverlay` reads the
  manifest); the contract was shelved as not significant on a pool that
  included weak models, and that null does not apply here.
- A donor inventory TSV with columns `id, slug, category, tags, tmpl, nobj,
  companions, sessioninfo, testperm, tcid`. Regenerate by scanning
  `tasks/hard/*.yml` plus `tasks/starter/<id>/` if it is lost.
- No bench running, and `DOCKER_CONTEXT=desktop-windows` on every
  container-touching command (decisions.md entry 40 - without it you get a
  misleading "Failed to create compiler folder").

## Procedure

1. **Plan.** `python scripts/composite-plan.py --sites 8 --count 10 --start
   <NNN> --inventory <tsv> --out scratch/composite-plan/spec.json --prev
   <earlier spec files>`. The donor exclusions are baked in and are measured,
   not taste: SQL-counter oracles (budgets calibrated in a 3-object app, and
   `SessionInformation` counters are session-global, so other modules seeding
   data blow the budget), `TestPermissions = Restrictive` (codeunit-level, and
   a merged oracle is ONE codeunit), companion files (need renaming into the
   composite namespace, which the assembler does not do).
2. **Scaffold, serially** (id allocation races):
   `deno task start task new --slug <symptom-slug> --id CG-AL-X<NNN> --diagnose`.
   Read each `.meta.json` back for its real `testCodeunitId`.
3. **Assemble.** `python scripts/composite-assemble.py <spec.json>`. Donors are
   copied verbatim; their `CG X<NNN>` name prefixes and disjoint id blocks make
   collisions impossible. Then set both `app.json` ids
   (`a1b2c3d4-a<NNN>-0000-0000-00000000000{1,2}`) and fill in `task.yml`:
   `prompt_template: diagnose-objects.md`, the three metrics,
   `cohort: reasoning-100`, `origin: composite-assembled`, the `donors:` list,
   and a `defect-sites-N` tag.
4. **Write descriptions** to
   [references/description-brief.md](references/description-brief.md), verbatim.
   This is the lever; everything else is mechanical. Parallel subagents work
   well at ~6 composites each. Lint the results for banned words, for a count
   of defects, and for every module being named.
5. **Probe** every composite (`deno task start task probe`, free container
   time). Correct must pass all tests; starter must fail several while REACHING
   assertions. **Apply descriptions BEFORE probing** - `task promote` refuses a
   `task.yml` newer than its cached probe verdict, and that ordering mistake
   cost two re-probe rounds.
6. **Stage** starters into `tasks/starter/<id>/` and oracles into
   `tests/al/hard/<id>.Test.al`. Run `deno task id-audit` and
   `python scripts/oracle-audit.py`.
7. **Screen with ONE trial**: all composites in one bench invocation, both
   models, `--attempts 2 --max-tokens 64000 --no-ingest --no-dashboard`. Across
   98 composites, no task that both models solved in trial 1 ever resisted
   later, so three trials on solved tasks is wasted money.
8. **Classify on ATTEMPT 1 ONLY.** `python scripts/composite-verdict.py
   <results.json ...>`. A candidate needs BOTH models failing attempt 1
   behaviourally. The console matrix labels the FINAL attempt, so reading it
   instead of attempt 1 will mislead you - that nearly cost a valid task.
   Cross-check with `python scripts/failure-causes.py` that omission is at zero.
9. **Confirm candidates at 3 trials.** PASS = both models fail attempt 1
   behaviourally in at least 2 of 3.
10. **Promote** passers (`deno task start task promote <id> --difficulty hard`),
    copy `correct/` minus the oracle into `reference/solutions/<id>/`, and
    **unstage every non-passer** - leaving them staged pollutes the task set.

## Gotchas that each cost real time

- A donor oracle may reference its OWN codeunit by name to bind a manual
  subscriber; the merge renames the codeunit and it stops compiling (AL0185,
  X067 inside X183). The assembler rewrites these - do not remove that.
- `task promote` refuses if the oracle already exists at the destination. If it
  was staged for the gate, diff the staged copy against the draft and remove it
  first.
- A gpt-5.5 compile cell is usually a real model error - it invented a
  non-existent `CompareStr` on X277 - not an assembly artifact. Check the
  diagnostic before blaming the merge.
- LethAL bumps its instrumented app's version and that survives unpublish, so a
  re-sweep needs a version above the previous one.

## Not this skill's job

Single-defect authoring, mining, and premise probes. This skill CONSUMES gated
single-defect tasks; something else has to produce them. The donor pool is
finite (67 usable at time of writing), so heavy reuse across composites is
normal and expected - decisions.md:155 anticipates the donor/composite score
correlation.
