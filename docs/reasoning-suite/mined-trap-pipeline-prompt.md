# Session prompt: mined-trap pipeline (screen -> build -> gate -> promote)

Paste everything below the line into a fresh session in `U:\Git\CentralGauge`.
Fill in the two `___` fields first.

---

You are running the mined-trap pipeline for CentralGauge, a public AL benchmark.
The goal is new diagnose-format tasks that BOTH `anthropic/claude-opus-5` and
`openai/gpt-5.5` fail on attempt 1, behaviourally. Each such task raises k, the
count of tasks the strongest model fails, which is the only quantity the launch
bar depends on (max publishable n <= 2k; k is 7 today at pass@1).

Spend cap: $___ total. Screening costs about $1 per candidate (3 passes x 2
models); each build + gate is about $3-5 plus container time. Stop and report
when the cap is reached. Never ingest. Container time is free but serial.
Batch size: ___ candidates per batch (25 is a good default).

## Read first, in this order

1. `docs/reasoning-suite/LESSONS.md` - every dead end and every trap that cost
   time. Its "authoring is dead" verdict is superseded by the addendum at the
   bottom: hand-INVENTED candidates went 0 for 17, but candidates MINED from
   real code-review findings went 3 for 12 with one convergent hit. Read it for
   the traps, not the verdict.
2. `U:\Git\DevOpsWorker\private\internal-docs\superpowers\plans\2026-08-31-review-provenance-for-trap-mining.md`
   - the corpus, what was measured on it, and the 1-in-3 verdict-instability
   caveat that dictates the 3-pass rule below.
3. `.claude/skills/build-batch/SKILL.md` and
   `docs/reasoning-suite/hardening-pipeline.md` - the gate order. Gate A3
   (premise-probe BEFORE a build slot) is the one that was skipped twice and
   cost two pilots.
4. `scratch/attractor-mined.json` and `h:/Temp3/attractor-rerun.log` - the 12
   already-screened mined candidates and the responses that made M11 a hit.
   Do not re-screen these, and do not re-screen
   `docs/reasoning-suite/attractor-*.json` (the invented set is dead).

## Stage 0 - verify the screen before trusting it

Run `deno run --allow-all scripts/attractor-probe.ts scratch/attractor-rerun.json
openai/gpt-5.5` once and confirm every `--- <model>` line reports output token
count and finish reason, and that no cell is empty. If the diagnostics are
missing, add them to `scripts/attractor-probe.ts` first. A starved cell (the
4000-token default did this to 6 of 24 cells) reads as "the model wrote
nothing" and silently corrupts the hit rate. `CENTRALGAUGE_PROBE_MAX_TOKENS`
defaults to 16000; keep it.

## Stage 1 - pull a batch from the corpus

Source: Postgres `pipeline` via `mcp__postgres__query` (read-only).
Structured findings live in `pr_reviews.findings_list` (JSONB array of
`{severity, title, body, file, line, location}`). 778 critical/major findings on
`.al` files exist. Pull in stable pseudo-random order so batches never overlap:

```sql
SELECT md5(f->>'title') AS fid, f->>'severity' AS severity, f->>'file' AS file,
       f->>'title' AS title, regexp_replace(f->>'body','\s+',' ','g') AS body
FROM pr_reviews p, LATERAL jsonb_array_elements(p.findings_list) f
WHERE p.findings_list IS NOT NULL
  AND COALESCE(p.is_test,false) = false
  AND f->>'severity' IN ('critical','major')
  AND lower(f->>'file') LIKE '%.al'
  AND lower(f->>'file') NOT LIKE '%test%'
  AND length(f->>'body') BETWEEN 500 AND 1600
ORDER BY md5(f->>'title')
OFFSET <batch_index * batch_size> LIMIT <batch_size>;
```

Skip any title already present in `scratch/attractor-mined.json` or in the
resume state file (Stage 6).

## Stage 2 - transform each finding into a trap-blind requirement

This is the craft step and it decides the hit rate. Dispatch it to a subagent
per batch, or do it inline; either way apply ALL of these:

1. One finding -> one requirement, under 120 words, plain business need:
   "Write an AL procedure/codeunit that ...". Present tense. No preamble.
2. **Include the structural context that made the real mistake plausible**:
   caller shape (loops, `var` parameters), sibling procedures, transaction
   boundaries ("called in a loop by a posting routine that commits once at the
   end"), reused globals, downstream consumers ("a sibling routine derives the
   MIME type from the returned name"). This is exactly what made M11 and M8
   hits and its absence is why M3 missed.
3. **Make the trap's path the natural path.** If the finding is about the unit
   of API X, the requirement must force the use of API X. M3 asked for a
   ten-second wait and both models reached for `Sleep`, so the
   `LockTimeoutDuration` trap was never even exercised.
4. Never name the mechanism, warn, or hint at the fix. Never reuse the words of
   the finding's title. (CLAUDE.md: tasks describe WHAT, never HOW.)
5. Strip every Continia identifier: object names, file paths, product names,
   PR and work-item ids. Use generic `CG P ...` names.
6. **Skip** findings that are test-only, description-vs-code mismatches,
   cherry-pick or branch hygiene, "please confirm" uncertainties, duplication,
   or nitpicks. **Keep** runtime-semantics and structural-inconsistency ones
   (a guard present in siblings but not here; a `var` record reset in a callee;
   a unit hidden by a variable name; a blank value that degenerates a filter).
   Known-semantics traps are dead (M2: both models already use
   `FieldRef.Validate`); attention and inconsistency traps are alive.
7. Record `expectedWrongForm` as one line, for the judge.

Write the batch to `scratch/mined-screen/batch-<n>.json` in the
`[{name, requirement, expectedWrongForm}]` shape `attractor-probe.ts` reads.

## Stage 3 - screen, three passes, judge, classify

Run `scripts/attractor-probe.ts` on the batch against
`anthropic/claude-opus-5 openai/gpt-5.5`, **three separate passes**, each to
its own log. Verdict instability on this reviewer is 1 in 3, so one pass is
noise-shaped.

Judge each cell (a subagent may do it; you must personally read every
candidate that reaches "convergent"): does the code contain the wrong form?
Values: `wrong`, `correct`, `trap_not_reached` (the trap's path never appeared).

Per candidate, per model, count `wrong` across the 3 passes:
- **convergent** - both models >= 2/3 wrong. Goes to Stage 4.
- **single-vendor** - exactly one model >= 2/3 wrong. Log it; do NOT build.
  A task one frontier model fails and the other passes does not move the bar.
- **trap_not_reached** in >= 2/3 for either model - rewrite the requirement
  once per rule 3 and re-screen; if still not reached, drop.
- otherwise **miss**.

## Stage 4 - build convergent hits only, serially

Per hit, in this order (any oracle/starter edit re-enters at B1):

- **A3 premise-probe** if the mechanism rests on a platform claim not already
  in `docs/reasoning-suite/decisions.md` (units, lock behaviour, transaction
  semantics, cache behaviour). Use the `premise-probe` skill. Bank the fact.
- **A4 scaffold**: `deno task start task new --slug <symptom-slug> --id
  CG-AL-X<NNN> --diagnose`. Slugs are symptom-flavoured, never
  mechanism-flavoured. Object ids continue in blocks of 10 from the newest
  `tasks/hard/` YAML, at or below 74999; X178 (71600-71604) and X179
  (71610-71613) are taken in scratch.
- **Builder subagent** gets: the requirement, `expectedWrongForm`, the
  anonymised wrong output from the screen as the seed for `starter/`, and
  `.claude/skills/build-batch/references/builder-brief.md`. Constraints:
  starter CONTAINS the wrong form; `correct/` fixes it; the oracle grades the
  CONSEQUENCE the finding names (lock held, extension lost, loop truncated),
  not the code shape; small app, at most 5 objects (omission runs 2.9% of
  attempts at 1-4 starter objects vs 18.2% at 13+); graded contract on tables
  the fix has no reason to reshape; `starter/app.json` must exist (the probe
  refuses without it); explicit entry numbers in oracle seeding, never
  AutoIncrement across repeated seeds; for any SQL-counter contract copy
  `FlushDataCache()` from `tests/al/hard/CG-AL-X169.Test.al`, do not re-derive
  it. The builder also writes `correct-alt/`, a materially different correct
  implementation, for B4.
- **B1** `deno task start task probe CG-AL-X<NNN> --quiet` - correct passes,
  starter fails REACHING the assertions. Then `scripts/gold-ci.ts --replay`.
- **B2** re-probe twice more, at least once on another container; identical
  verdicts and assertion counts.
- **B4** both `correct/` and `correct-alt/` must pass the oracle. Any model
  that passes the oracle at the Stage 5 gate (gpt-5.5 on attempt 2, for
  instance) is a genuine independent no-tools solution and counts as further
  B4 evidence; the author-written alternative is the floor for tasks nobody
  solves. C0 family rule: this session and its builders are Anthropic, so no
  Anthropic model may serve as a B4 checker or B6 auditor.
- **B6a** run the `al-test-auditor` instructions through `pi_ask` on
  `gpt-5.5` (not the in-session agent, same family rule). Apply HIGH/MED.
  This is the ONLY step that may use `pi_ask`: an auditor is meant to read the
  oracle and the task. **Never use `pi_ask` as a solver, screener or gate.**
  Its delegate can read the repo, including `tests/al/hard/`, and no setting
  makes it single-shot; `require_evidence` pushes it to read. Every step that
  measures a model (screen, B4 solves, gate) goes through the adapters
  (`attractor-probe.ts`, `bench`), which are single-shot and tool-free, the
  same condition the benchmark scores under.
- **B7** LethAL sweep on Cronus28 ONLY; triage survivors with
  `mutation-triager`; `unreached` survivors get a kill test.
- Run `python scripts/oracle-audit.py` after every oracle edit.

## Stage 5 - bench gate

Stage BOTH halves or the run is invalid and reads as "resists": copy
`scratch/<id>/starter/*.al` to `tasks/starter/<id>/` and the oracle plus any
`<id>.*.al` companions to `tests/al/hard/`. Then, one bench at a time:

```
CENTRALGAUGE_BENCH_PRECHECK=0 deno task start bench \
  --llms anthropic/claude-opus-5,openai/gpt-5.5 --tasks scratch/<id>/task.yml \
  --containers Cronus28,Cronus281,Cronus282,Cronus283,Cronus284,Cronus285 \
  --max-tokens 64000 --attempts 2 --no-ingest --no-dashboard --quiet
```

Three trials. `python scripts/failure-causes.py <results files>`. **PASS =
both models fail attempt 1 with cause `behavioural` in at least 2 of 3
trials.** `omission`, `mixed`, `al_knowledge` and any 402/zero-output cell do
not count. Always pass `--max-tokens 64000`: the CLI default of 4000 silently
overrides config and produced a whole strategy round built on truncation.
On FAIL, unstage both halves.

## Stage 6 - promote, record, resume

- `deno task start task promote CG-AL-X<NNN> --difficulty hard`, then
  `deno task id-audit`, `python scripts/oracle-audit.py`, and
  `deno run --allow-all scripts/gold-ci.ts --check` must all be clean.
- `task.yml` gets `authoring.model` (this session's model) and
  `origin: mined-review`. **The finding-to-task mapping (titles, PR ids,
  Continia names) goes ONLY to
  `U:\Git\DevOpsWorker\private\internal-docs\mined-task-map.md`, never into
  this public repo, its ledger, or its commit messages.**
- Resume state: `scratch/mined-screen/state.jsonl`, one line per finding
  (`fid`, batch, status, requirement, per-model wrong counts, task id if
  built). Read it on start; skip done rows. Commit after every promotion.

## Hard rules

- Never ship or paraphrase-closely Continia production code; rebuild the
  MECHANISM as fresh AL.
- Never run `deno task test:unit` while a bench is live. One bench at a time.
- Keep task difficulty high; never weaken an oracle to make a model pass.
- gemini-3.1-pro-preview is excluded from every panel.
- Do not touch `tasks/**` or `tests/al/**` except through staging/promotion.

## Calibration: what a hit looks like

M11 requirement: "Write an AL procedure SaveFile that uploads a file to blob
storage and retries up to three times with an increasing backoff when the
upload fails with an authentication error. It is called in a loop by a posting
routine that modifies a log record per file and commits once at the end."
Both models wrote `Sleep(BackoffMs)` inside the caller's open transaction;
gpt-5.5 added `[CommitBehavior(CommitBehavior::Ignore)]`, which guarantees the
lock stays held. Convergent. The transactional context sentence is the trap.

M8 requirement mentioned only that "a sibling routine derives the MIME type
from" the returned name. Opus wrote `exit(CopyStr(SafeFileName, 1, 100))`,
dropping `.pdf`; gpt-5.5 split base and extension. Single-vendor.

M3 asked to "wait up to ten seconds" for a lock. Neither model used
`Database.LockTimeoutDuration`, so the milliseconds trap was never reached.
Requirement failure, not model success.

## Report after every batch

screened / transform-skipped / trap_not_reached / miss / single-vendor /
convergent / built / gate PASS-FAIL with `failure-causes` output / promoted /
spend so far. Append the batch summary to
`docs/reasoning-suite/hardening-levers-evidence.md` under a dated
"Mined-trap pipeline" section, and update the hit-rate line in `LESSONS.md`.
Then continue to the next batch until the cap or the corpus is exhausted.
