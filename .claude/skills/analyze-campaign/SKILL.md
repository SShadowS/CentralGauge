---
name: analyze-campaign
description: Post-campaign analysis of a Harness Bench campaign from its stored results - per-execution extraction, matched-pair dossiers, failure classes for every variant loss, a blind structural comparison of both-pass pairs by another model family, and findings.md. Use as /analyze-campaign <campaign-id> after a pilot, screening or confirmatory campaign, before the orchestrator accepts it.
---

# Analyze a campaign

`/analyze-campaign <campaign-id>` turns one campaign's stored results into
`H:\cg-coord\analysis\<campaign name>\findings.md` plus the data behind it. It is the
repeatable form of A-01 (P-02, decisions\2026-10-17-a-01-accepted-and-judging-ruling.md);
the runbook step is README.md "Post-campaign analysis".

## Hard rules

- Read-only on the campaign: never write under `H:\cg-coord\jobs\`. All output goes to
  `H:\cg-coord\analysis\<name>\`.
- No BC containers, no paid cells, no `harness cell` / `harness run` / `harness rejudge`.
  `harness measure` needs containers (`--containers`, final-code analyzers on a container) and
  writes measure records into the results: always skip it and say so in findings.md.
- Every number in findings.md comes from a file in the output folder. Quote execution ids and
  trace line numbers for examples; never estimate.
- State everything skipped or not shown (in findings.md "Caveats" and in your report).
- Run from a checkout of master (the script is `scripts/harness/analyze-campaign.ts`).

## 1. Locate the campaign

```bash
ls -d H:/cg-coord/jobs/*/results/harness/executions/<campaign-id>
```

Exactly one match, else stop and report. From it:

- **results root**: `H:\cg-coord\jobs\<job>\results\harness`
- **job checkout**: `H:\cg-coord\jobs\<job>` (a git checkout of the revision the campaign ran)
- **task rev**: the job checkout's HEAD at the campaign's `created_at`. A resumed campaign can
  move the checkout later (P-01: ebcfdd05 at the start, 4bd7b577 after a resume), so read
  `git -C <job> reflog --date=iso` and take the last entry before `created_at` (mind the
  reflog's local offset against the record's UTC). Use HEAD as `--rev` only if
  `git -C <job> diff --quiet <start rev> HEAD -- harness-tasks` holds (the task trees did not
  change), else use the start rev. Check that `git -C <job> status --porcelain harness-tasks`
  is empty. If either check fails, or the reflog has no entry before `created_at`, say so in
  the caveats: the starting trees, and so the diffs, may not match what the agents saw.
- **name**: the coord task id at the start of the job folder name (`^[A-Z]+-\d+`, e.g.
  `P-01-901` -> `P-01`). Output folder `H:\cg-coord\analysis\<name>`.
- **campaign record** `<results>\campaigns\<campaign-id>.json`: `experiment` (id, baseline,
  variants, tasks, repeats), `egress_override`, `calibration_waived`. If
  `H:\cg-coord\tasks\<name>\` holds a `report-*.txt` / `summary-*.txt`, read it for the
  official pass rates and intervals (quote them; do not recompute intervals).

## 2. Run the extraction

Pairs: the baseline against every variant. For the v2 2x2 (arms ending `-plain`, `-lsp`,
`-realistic`, `-realistic-lsp`) also pass `<lsp arm>:<realistic-lsp arm>`, so both
"realistic vs not" comparisons hold the LSP fixed. Order matters: the blind-review sample
(step 3) fills from the first comparison, so pass first the comparisons the question is
about. For the 2x2: `<plain>:<realistic>`, `<lsp>:<realistic-lsp>`, then `<plain>:<lsp>`,
`<plain>:<realistic-lsp>`.

```bash
deno run --allow-all scripts/harness/analyze-campaign.ts <campaign-id> \
  --results 'H:\cg-coord\jobs\<job>\results\harness' --rev <task rev> \
  --repo 'H:\cg-coord\jobs\<job>' --out 'H:\cg-coord\analysis\<name>' \
  --pair <baseline>:<variant> [--pair ...] > 'H:\cg-coord\analysis\<name>\analyze.log' 2>&1
```

It must end with `[OK] <n> executions, <n> pairs, <n> losses`. A `[WARN] trace` line means a
trace could not be read: list those executions in the caveats. Outputs: `executions.json/.csv`,
`pairs.json/.csv`, `losses.csv`, `summary.json` (`per_arm` with medians and `fail_classes`,
`per_pair`), `diffs/<execution>.patch`, `dossiers/<base>__<variant>/<task>-r<n>.md`, `.start/`.

The loss classes (first match wins, `classifyLoss`): `timeout_in_delegation` (timed out, half
or more of the wall in sub-agents), `timeout_main_loop`, `other_termination`, `no_change`,
`never_compiled`, `own_tests_break_build` (only the Test app fails to build in the verdict),
`build_broken`, `regression` (pass_to_pass), `wrong_behaviour` (fail_to_pass), `other`. Tags:
`scope_creep`, `edited_shipped_tests`, `uses_restored_shipped_edit` (a missing name in the
verdict build error is one the agent added to a shipped test file), `review_heavy`.

### Static analysis with al-sem (when a pinned binary is given)

Run this when the user or the task names an al-sem build. Pinned build: release v2.0.1 in
`H:\cg-coord\analysis\tools\al-sem-v2.0.1\` (the first supported version; the script parses the
2.0.1 output contract only, `H:\cg-coord\tasks\A-03\alsem-2.0.1-spec.md`):
- `alsem-windows-x64.exe`, sha256 `b323c73b9ae0b4fe8da8cbaf6ac059fdbb51f2e10b2ef3ec0e089ce4ee2f5637`
  (`--version` prints `al-sem 2.0.1`)
- `al-call-hierarchy-windows-x64.exe`, sha256
  `52373bafa1da945264f678d9df1bbfb2ae1f3599a09911509492243654407ea9` (no `--version`)

For a newer build, download it with `gh release download <tag> -R SShadowS/al-sem` into a new
folder. Record both hashes and say which build you used. A build whose envelope `kind` or
`schemaVersion` the script does not know fails every execution loudly (`[WARN] alsem <id>`):
extend `ALSEM_SCHEMAS` only after reading that build's contract.

Add three options to the step-2 command:
- `--alsem <alsem exe> --ach <al-call-hierarchy exe>`
- `--symbols <symbol store>`: a content-addressed `<sha256>.app` store, such as any
  `H:\cg-coord\jobs\*\results\harness\symbols` that holds every package of
  `harness-tasks/symbols.lock.json` at the rev. The script checks every hash and refuses a store
  with a missing package.
- `[--alsem-jobs 3]`
- `[--only <id or id prefix>,...]`: a smoke on a few executions.

Per tree, the script builds one synthetic app in a scratch copy under `<out>\alsem\ws\`: the
refapp's 7 apps merged (`mergedAppJson`), `.alpackages` a directory junction to the symbol store
(al-call-hierarchy reads only `<ws>\.alpackages`; without the Microsoft symbols every Base App
event subscriber shows as unused). The junction is removed with `cmd /c rmdir` before the scratch
copy is deleted; never delete a scratch workspace recursively by hand while the junction is in it,
that can follow it into the store. On each tree it runs (alsem commands with `--deterministic`):
- `alsem analyze --require-dependencies`: exit 4 (a missing dependency) fails the execution, it is
  never skipped or under-reported.
- `al-call-hierarchy --analyze` (no envelope).
- `alsem fingerprint`

Then per execution it runs `alsem diff` on the two fingerprints, and `alsem digest --diff` with
the execution's patch (paths relative to the merged app folder, which is the workspace root).
Every alsem envelope is validated strictly: `alsemVersion` (string), `schemaVersion` (supported
string), `kind`, `diagnostics` (array of objects with a severity) and `payload` (object) must all be
present with their types, plus the payload fields the runner reads (analyze `findings`; digest
`entries`, `summary`, `changedRootsDiagnostics`; diff `findings`, `summary`); nothing is defaulted.
The al-call-hierarchy output is checked for the metrics / findings fields it uses.
`alsemVersion`, `schemaVersion` and the envelope `diagnostics` are kept per tree in each row, and
`summary.json` counts the diagnostics. An error-level envelope diagnostic, an unparseable, wrong-kind
or incomplete envelope (the fingerprint included) fails the tree and the execution, never a
zero-findings row. Every cache hit re-validates: the raw analyze / ach / fingerprint files behind a
`tree.json` are re-checked and `tree.json` re-derived on each read, digest and diff files are
checked on read. Results are cached under `<out>\alsem\cache\`: the final tree per workspace hash, its digest
per patch hash (`digest-<patch>.json`), one start tree per baseline identity (`start-<task>-<id>`,
id = rev + refapp commit + tree content, recorded in `.start\<task>.done`), the diff per
(start id, final hash). Another `--rev` rebuilds the start artifacts. Entries from before this
keying (`start-<task>`, `digest.json` + `change.diff`, an empty `.done`) are never adopted: their
provenance cannot be proven, so start trees and digests are recomputed. `tree.json` carries a
`derive` version; the derived fields are rebuilt from the cached raw JSON on every read, no tool
runs. A done row also carries the sha256 of the artifacts it was computed from (start and final
`tree.json`, the digest, the diff); if one changed or is missing the execution is not done.
`alsem --version` is skipped when the binary's sha256 matches `tools.json`. A re-run (for example after a rejudge) only redoes the cheap part. Measured
on v2.0.1 (smoke, 3 jobs): per tree analyze ~32-44 s at ~5.4 GB peak, al-call-hierarchy ~11-13 s
at ~0.8 GB, fingerprint ~11-14 s at ~0.8 GB, digest ~33-45 s at ~5.4 GB, diff < 1 s: about
110 s of tool time per execution, plus ~55 s once per task for its start tree. Keep
`--alsem-jobs` x 5.5 GB under the machine's free memory.

Executions with termination `harness_crash` (H-29 ruling, 2026-10-18) keep their rows in
`executions.json/.csv` and `introduced.csv`, flagged `excluded`, but are left out of `summary.json`
(per arm, per pair). `exclusions.md` is the "Static analysis (al-sem)" exclusion paragraph with the
ids: paste it into findings.md's section.

The step resumes per execution. Each finished execution is written atomically (temp file, then
rename) to `cache\<build>\exec\<id>.json`, stamped with both full binary hashes, the task rev and
the workspace hash. A re-run, also after a kill, skips every execution whose file matches, redoes
failed ones (`[WARN] alsem <id>`), and aggregates all `exec\` files, earlier runs included. Another
al-sem or al-call-hierarchy build gets its own cache folder and reuses nothing. The log ends with
`[alsem] N/M done (K were done already, F failed, E of them on missing dependencies), ... D al-sem
diagnostics in X executions`. Outputs in `<out>\alsem\`:
- `tools.json`: the build, its hashes and the store.
- `executions.json` / `.csv`: per execution the metrics below, plus the introduced findings, the
  routine deltas, the new unused procedures, the blast radius (with `total` =
  summary.findingsByCategory), the digest touches, the versions and the diagnostics.
- `introduced.csv`: every introduced finding, with execution, arm and task.
- `summary.json`:
  - `failed` (this run's failures with the error) and `diagnostics` (count by command, severity
    and code).
  - `per_arm` (all executions) and `per_arm_passing` (verdict pass only): median per metric,
    executions above zero, introduced findings by detector.
  - `per_pair`: median of variant minus base per metric, and the count of pairs where the
    variant is higher or lower, over `all` matched pairs and over `both_pass`.

The metrics count production code only (not the Test app), unless the name says test:
- `alsem_new_findings` / `alsem_new_high_findings` / `alsem_new_test_findings`: final minus
  start, matched by the analyze finding's `fingerprint`, as a multiset; high = critical or high.
- `curated_weighted`, `changed_prod_lines`, `curated_density`, `alsem_d3_introduced`,
  `alsem_d9_introduced` (owner definition 2026-10-23): introduced findings with
  `confidence.level == "likely"` only, weighted critical 5 / high 3 / medium 1 / low and info 0,
  with `d3-missing-setloadfields` and every `d9*` detector left out (their raw introduced counts,
  any confidence, are the two `alsem_d*` columns). `changed_prod_lines` = added + removed lines of
  the execution's patch in non-Test files; `curated_density` = `curated_weighted` per 100 of them,
  null (not 0) when no production line changed. `within_task_rank` (executions.csv/json) ranks an
  execution among all executions of its task by ascending density (ties average, null unranked).
  `summary.json` carries `curated_density` (n, null_count, median, mean, zero_share) and
  `within_task_rank` (median, mean) per arm and, per side, per matched pair.

al-sem 2.0.3 (A-03b; the script now requires its output: a 2.0.2 build fails closed on the first
analyze finding without `looseFingerprint`):
- Introduced findings follow the looseFingerprint rule: per key, `max(0, after - before)`, summed
  (the key is not unique). The new ones are named by pairing start and final on `fingerprint` +
  `looseFingerprint` first, then on `looseFingerprint`; a finding that moved to another routine is
  not new. A-03's fingerprint-only count stays as `alsem_new_findings_fp`, `curated_weighted_fp`,
  `curated_density_fp` (and `introduced_fp` in executions.json). Comparable only for the same
  scope, filters and dependencies (the runner never uses `--baseline` or `--limit`).
- Test quality (`al-call-hierarchy` `test_quality`, validated strictly; every tree keeps its
  [Test] procedures): over the Test app's [Test] procedures introduced (not in start) or changed
  (a changed root of the digest) by the execution: `new_test_procs`, `test_procs_scored`,
  `test_assert_reachable_mean`, `test_zero_assert_share`, `test_asserterror_share`,
  `test_areequal_literal_share` (+ the underlying counts). Shares are null, not 0, with no scored
  procedure. The digest marks a procedure changed at hunk level, so a procedure inside a hunk's
  context lines can count as changed.
- Test coverage: the digest runs with `--tests` (the only change to the digest output is the added
  `payload.testCoverage`; the file is `digest-tests-<patch>.json`). `test_coverage_ratio`
  (covered / changed production routines, null with none changed), `test_changed_routines`,
  `test_covered_routines`, `test_uncovered_routines`. al-sem leaves test code out of the ratio.
- `summary.json` per arm / per side of a pair: `test_quality` and `test_coverage` pooled over the
  executions (shares from summed counts), `median_nullable` and, per pair, `median_diff_nullable`
  over the executions / pairs where the metric is defined.
- `complexity_delta`, `lines_delta`, `fan_in_delta`, `max_routine_complexity`,
  `routines_added`, `routines_changed`: from al-call-hierarchy's per-routine metrics, joined
  start to final by `routine_id`. A routine counts when added, removed, with complexity / length /
  parameters changed, or a changed root of the patch (`routine_id` = digest `routine.stableId`;
  never join it with analyze's `routineId`, a different id). `d_fan_in` is null when a side has no
  call graph (interface members).
- `new_unused` / `new_unused_public`: al-call-hierarchy `unused_procedure` findings in final but
  not in start; access from the metrics row at the same path and line. `new_unused` counts local,
  internal and protected; public ones (unused inside the app, maybe called by other apps) count
  apart.
- `abi_changes`, `abi_signature_changes` (kind `procedure-signature-changed`), `schema_changes`,
  `event_changes`, `permission_changes`: `alsem diff` categories, on objects outside the Test
  app's id range; the per-side counts must add up to `summary.findingsByCategory` or the
  execution fails.
- `tables_written`, `events_published`: from digest effects of the changed production routines.
- `unmapped_hunks`: hunks digest could not place in a routine (`unmatched_files`, kept per row,
  is normal for files without routines, such as an enum or a fields-only table extension).

Known al-sem gaps; state the ones that bear on a number in the caveats:
- #157: no multi-app source workspaces, hence the synthetic merged app. Internal and
  internalsVisibleTo boundaries vanish, so `access` internal is internal to the merged app.
- Check `unmapped_hunks` all the same. It should be 0; if not, it marks a new digest gap.

Open new issues there (with a repro) for any further gap, and list them in the report.

Spot-check 3 introduced findings before writing about them. Take the `introduced.csv` row, open
the final workspace file at the line (`<results>\workspaces\<hash>\<file>`), and confirm that
the starting tree (`<out>\.start\<task>`) has no finding of that detector in that routine
(`<out>\alsem\cache\start-<task>\analyze.json`).

### SQL cost per test (`--sql-cost`, opt-in)

`--sql-cost --containers <a,b> --symbols <store> --lineage <lineage> [--sql-cost-task HX-nnn ...] [--no-sql-cost-scenarios]`
re-runs the oracle on the final tree with the CG SQL Measure app (`infra/cg-sql-measure`), the
real judge on the harness lane. It takes the bench lock like `--test-rerun`. The judgment it
makes is discarded, never written. Output: `<out>\sql-cost\executions.{json,csv}` (one row per
execution x test, with `kind` oracle or scenario, an `oracle` flag, `setup`, `scenario_outcome`
and `error` columns) and `summary.json`.

- Oracle-run measurement: the summary uses the `fail_to_pass` codeunits, per task and per
  arm, median/min/max across repeats. There are no totals across tasks.
- Scale scenarios (on by default for a task with `infra/cg-sql-scale/<task>/src/`, read from
  the working tree): after a measured oracle run the scenario codeunits are the only sources of
  the Test app over the execution's final production apps, run through the test-rerun runner
  with the same measuring swap. Every method is self-contained and order does not matter. A
  `Setup...` method (`SetupOnly`: the setup alone) is the baseline, flagged `setup` and listed
  raw; every other method is setup plus one call, and its net is `method - SetupOnly` within the
  same execution. The summary has, per task, arm and method, n and median/min/max of the raw and
  of the net values, over passing scenarios only, plus the `scenario_failed` and
  `scenario_unmeasured` counts. A scenario compile error or failed row is `scenario_failed`; a
  passing row without a measurement, or a missing, failed or unmeasured `SetupOnly`, is
  `scenario_unmeasured` (no numbers). Neither changes a verdict, a pass rate or the oracle rows.
  Scenario sources are in the cache key.
- The numbers include a constant framework overhead per test (the same for every solution).
  Compare solutions of one task; do not read them as the cost of the code alone.
- Fails closed: an execution is listed under `failed`, with no numbers, when the measured verdict
  differs from the selected judgment's, a test row lacks a measurement, a row is infra or
  not_run, or an oracle codeunit did not run. `test-authoring` tasks have no oracle and are skipped.

## 3. Blind structural comparison (exploratory only)

Write this rubric to `<out>\quality\rubric.md` verbatim, before building any packet:

````markdown
# Structural-quality rubric (A-01 step 4, fixed before any packet was judged)

You get one Business Central AL ticket and two independent solutions, A and B, as unified
diffs against the same starting repository. Both solutions passed the same hidden acceptance
tests. You do not know how either was produced. Judge only what the diffs show.

Score each solution 1 to 5 on each criterion (5 is best), then give a preference.

1. **Reuse**: calls existing procedures, events, interfaces and helpers of the repository
   instead of re-implementing them. 5 = everything it needs that already existed is reused;
   1 = duplicates existing logic.
2. **Minimal change**: changes only what the ticket needs, with no unrelated edits, no
   speculative code, no needless new objects. 5 = tight; 1 = large unrelated churn.
3. **Fit with existing patterns**: naming, object structure, error handling and event
   patterns match the code around it. 5 = reads like the existing code; 1 = a foreign style.
4. **Test quality** (production code is the main subject; score tests only if the diff adds
   or changes any, else write `n/a`): tests check the ticket's behaviours with exact
   assertions on values they set up, cover edge cases the ticket names, no placeholder
   assertions. 5 = strong; 1 = weak or misleading.
5. **Correctness risk**: from reading only, how likely a latent defect is that the
   acceptance tests might miss (5 = very unlikely, 1 = likely). Name the defect if you see one.

Then: **Preference**: A, B or tie, and one or two sentences on the deciding difference.

Answer in exactly this JSON shape (no text outside it):

```json
{"A": {"reuse": 0, "minimal": 0, "fit": 0, "tests": 0, "risk": 0},
 "B": {"reuse": 0, "minimal": 0, "fit": 0, "tests": 0, "risk": 0},
 "preference": "A|B|tie",
 "reason": "..."}
```

`tests` may be the string `"n/a"`.
````

**Sample** (at most 20 pairs, seed 20261017): for each comparison in the order the pairs were
passed, one both-pass pair per task picked at random, the first comparison first; then the later
comparisons fill the remaining places, tasks not yet sampled first. State the sample in
findings.md. Build the blinded packets (ticket + diff A + diff B, A/B order random per packet):

```bash
python -I - '<out>' '<job checkout>' <task rev> <<'EOF'
import json, random, os, subprocess, sys
out, repo, rev = sys.argv[1], sys.argv[2], sys.argv[3]
pairs = [p for p in json.load(open(f'{out}/pairs.json')) if p['outcome'] == 'both_pass']
order = list(dict.fromkeys((p['base'], p['variant']) for p in json.load(open(f'{out}/pairs.json'))))
rng = random.Random(20261017)
picked = []
for i, cmp in enumerate(order):
    by = {}
    for p in pairs:
        if (p['base'], p['variant']) == cmp: by.setdefault(p['task'], []).append(p)
    group = [rng.choice(by[t]) for t in sorted(by)]
    if i > 0:
        seen = {p['task'] for p in picked}
        group = [p for p in group if p['task'] not in seen] + [p for p in group if p['task'] in seen]
    picked += group[:20 - len(picked)]
os.makedirs(f'{out}/quality/packets', exist_ok=True)
key = {}
for i, p in enumerate(picked, 1):
    q = f'Q{i:02d}'
    prompt = subprocess.run(['git', '-C', repo, 'show', f"{rev}:harness-tasks/tasks/{p['task']}/prompt.md"],
                            capture_output=True, text=True, encoding='utf-8', check=True).stdout
    sides = [('base', p['base_id']), ('variant', p['variant_id'])]
    rng.shuffle(sides)
    body = [f'# Packet {q}\n\n## Ticket\n\n{prompt}\n']
    for label, (_, eid) in zip('AB', sides):
        body.append(f"## Solution {label}\n\n```diff\n{open(f'{out}/diffs/{eid}.patch', encoding='utf-8').read()}\n```\n")
    open(f'{out}/quality/packets/{q}.md', 'w', encoding='utf-8').write('\n'.join(body))
    key[q] = {'task': p['task'], 'repeat': p['repeat'], 'base': p['base'], 'variant': p['variant'],
              'A': sides[0], 'B': sides[1]}
json.dump(key, open(f'{out}/quality/key.json', 'w'), indent=1)
print(len(picked), 'packets')
EOF
```

**Judge**: `mcp__pi__pi_models`, then a model from another family than the agents under test
(for Claude agents: the newest `gpt-*-sol`; A-01 used `gpt-6.1-sol`). One `mcp__pi__pi_ask`
per packet, five at a time, never reading `key.json` into the prompt:

> Read the rubric at `<out>/quality/rubric.md` and follow it exactly for the packet at
> `<out>/quality/packets/Qnn.md`. The starting repository the diffs apply to is at
> `<out>/.start/<task>` (read files there to check reuse and fit with existing patterns).
> Answer with only the JSON the rubric asks for.

with `output_file` `<out>/quality/answers/Qnn.txt`. A call moved to the background still
lands in its file: wait for every answer before unblinding. Then join:

```bash
python -I - '<out>' <<'EOF'
import json, re, sys, statistics as st, collections
out = sys.argv[1]
key = json.load(open(f'{out}/quality/key.json'))
res, pref = [], collections.Counter()
sc = {'base': collections.defaultdict(list), 'variant': collections.defaultdict(list)}
for q, k in sorted(key.items()):
    a = json.loads(re.search(r'\{.*\}', open(f'{out}/quality/answers/{q}.txt', encoding='utf-8').read(), re.S).group(0))
    role = {'A': k['A'][0], 'B': k['B'][0]}
    win = 'tie' if a['preference'] == 'tie' else role[a['preference']]
    pref[win] += 1
    for L in 'AB':
        for c, v in a[L].items():
            if isinstance(v, (int, float)): sc[role[L]][c].append(v)
    res.append({'packet': q, **{x: k[x] for x in ('task', 'repeat', 'base', 'variant')},
                'scores': {role['A']: a['A'], role['B']: a['B']}, 'preferred': win, 'reason': a['reason']})
json.dump(res, open(f'{out}/quality/results.json', 'w'), indent=1)
print(dict(pref)); [print(r, {c: (round(st.mean(v), 2), len(v)) for c, v in sc[r].items()}) for r in sc]
EOF
```

### Pairwise judge (judge-pairs.ts)

The scripted form of the same idea: blinded packets, A/B by seeded hash, both positions, several judge
models via pi, strict JSON verdicts, cache, kappa and an arm-guess check. Rubric and prompt are inputs
(Q-02). Start with `--dry-run` and read two packets for leaks.

```bash
deno run --allow-all scripts/harness/judge-pairs.ts --results <dir> --campaign <id> --repo <refapp repo> \
  --rev <rev> --out <dir> --config <judges.json> --prompt <judge-prompt.md> --rubric <rubric.md> \
  [--pair base:variant ...] [--task <id> ...] [--seed <s>] [--dry-run]
```

Outputs in `<out>`: `packets/`, `key/key.json` (never show the judge), `pairs.json`, `summary.json`, `pairs.csv`.

## 4. Read the data

- `summary.json`: per arm pass counts, terminations, medians (wall, cost, tokens, tool calls,
  sub-agent and review share, compile/test calls, first edit/compile, files changed),
  `fail_classes`; per comparison the both-pass / loss / win / both-fail counts and loss classes.
- `losses.csv`: every variant loss with class, tags, failed tests, verdict notes, dossier path.
- Open at least 3 dossiers per main class before writing about it, and the trace lines you
  quote (`<results>\runs\<execution>\trace.jsonl`, by line number).
- If one class dominates, test whether it explains the gap: failed-cell difference vs
  class-count difference per comparison, and pass rates per arm without the cells that carry the
  class's tag (say this filters on something the arm causes: a pointer, not an estimate).
- Sub-agent use per type: `executions.json` `profile.subagents` (type, duration).
- A finding that points at the harness (judging, scoring, environment) rather than the agent is
  a question for the owner: put it under "What to decide", never as an agent weakness.

## 5. Write findings.md

`H:\cg-coord\analysis\<name>\findings.md`, plain language, for a presentation. Shape:

1. Title line: campaign id, experiment, arms x tasks x repeats, harness version and model, rev.
2. **Summary**: 3 to 6 numbered findings, most important first, each with its numbers.
   Then **What to decide** (questions for the owner or orchestrator, if any).
3. **Caveats**: repeats and task count, the report's intervals, egress override, calibration
   waiver, cells with unknown cost, retries, unreadable traces, `harness measure` skipped (and
   why), the blind review's limits (one judge, sample size, partial blinding), anything the data
   cannot show.
4. **What the variant changes**: the per-arm medians table from `summary.json`, sub-agent use.
5. **Classification of every variant loss**: classes x comparisons table with totals, pair
   counts, the per-arm `fail_classes` table; per class 2-3 examples with execution ids, quoted
   trace lines (line number, agent, tool, t) and the verdict error.
6. **Dossiers** and **Raw data**: what is where, and the exact re-run command.
7. **Structural quality** (exploratory, never a headline metric): rubric path, sample, judge,
   preference counts and mean scores per criterion, named defects. A judge's reason speaks of
   "A" and "B": map each named defect to its arm through `quality/key.json` before writing it
   (the P-01 run got two of four wrong on the first pass).
8. **Static analysis (al-sem)**, when it ran, exploratory and never a headline metric:
   - the build and its hashes (`alsem\tools.json`);
   - the per-arm medians and counts (all executions and passing only);
   - the per-pair median differences for the comparisons in question;
   - the top introduced detectors per arm;
   - 3 spot-checked findings with file and line;
   - the al-sem issues that limit the numbers.
9. **Method notes**: what the profile fields and file-change flags mean (as A-01's findings).

A-01's `H:\cg-coord\analysis\P-02\findings.md` is the reference.

## 6. Report

To whoever asked (orchestrator or user): the path of findings.md, the headline in two or three
sentences, what to decide, what was skipped, and the models used (judge model and call count).
