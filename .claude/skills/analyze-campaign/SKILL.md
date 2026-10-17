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
8. **Method notes**: what the profile fields and file-change flags mean (as A-01's findings).

A-01's `H:\cg-coord\analysis\P-02\findings.md` is the reference.

## 6. Report

To whoever asked (orchestrator or user): the path of findings.md, the headline in two or three
sentences, what to decide, what was skipped, and the models used (judge model and call count).
