# What we tried, what it cost, what not to repeat

Written 2026-08-30 at the end of the hardening programme, for whoever picks
this up next — most likely to improve the data set around **2026-10/11**.

The long narrative lives in `hardening-levers-evidence.md` (measurement log)
and `wave2-brief.md` (authoring). This file is the short version: the dead
ends, what each one cost, and the specific evidence that killed it. **Read
this before proposing anything below.**

---

## The one-paragraph state

110 diagnose tasks. Three frontier models are saturated (Opus 5 91.3%
mean-per-trial at pass@1 over five trials). The suite is NOT too easy — the
comparable statistic against Microsoft's BC-Bench agrees to within two points.
It measures something **narrower** than an agentic benchmark, and it was being
scored with a **looser metric**. The fix was the metric, not the tasks:
`pass^5` gives 51.5 points of separation and a 24-task subset where the top
model sits at exactly 50.0%. See `passk-result.md`.

---

## Dead ends — do not re-run these without new information

### 1. Authoring more "hard" tasks (2 pilots, ~2 days, both failed)
- **X178** (open-world extensibility, the X080 shape): valid task, probe
  discriminates, `oracle-audit` clean. **Solved first try by both Opus and
  gpt-5.5.**
- **X179** (SQL-counter scaling, the X169 shape): same. **Solved first try by
  both.**
- Two tasks built precisely to the recipe derived from the seven tasks that
  DO resist. Zero transfer.
- **Why:** see #3. The recipe described the oracle, not the difficulty.

### 2. The attractor screen (17 candidates, cents, zero hits)
`scripts/attractor-probe.ts` asks real models to implement a requirement from
scratch and checks whether they write the wrong form. Run over:
- **11 candidates from documented AL semantics** (non-short-circuit `and`/`or`,
  `List` reference aliasing, `FindFirst` under a non-primary key, writes inside
  a failed `[TryFunction]`, same-session lost update, `Text[N]` truncation,
  `Delete()` while iterating, `SetRange` on an uncalculated FlowField).
- **6 candidates from our own MEASURED-but-undocumented facts**
  (`decisions.md` 20, 28, 31, 34, 36, 38).

**Zero convergent attractors across all 17.** One non-convergent hit (Opus
loops per-customer `CalcSums`; gpt-5.5 reaches for a `query` object and is
right). Opus commented decisions-entry 28 **verbatim** while implementing it.

> The reasonable objection — "you only tested documented behaviour, and AL
> *code* is the scarce corpus (338 MIT repos vs 581K for C#)" — was tested and
> **did not hold**. Frontier models write the correct form for behaviour we
> needed a container to establish.

**This is the single most important negative result to re-test in two months**,
because it is cheap (cents) and because a model generation could change it.
Re-run the screen FIRST. If it still returns zero, authoring is still dead.

### 3. The "attractor" theory itself — WITHDRAWN
I found 85% modal-share convergence on the 12 hardest tasks and built an
authoring rule on it. **It failed its null.** Chance-corrected agreement
(CAPA/kappa) on those 12 is **+0.025** — essentially independent — against
+0.368 suite-wide, and they sit at the **19th percentile** of
difficulty-matched subsets.

The two statistics measure different things: modal share is over *which
assertion* fails given a failure (largely a property of how many gradeable
assertions the oracle has); kappa is over *who* fails. Only the second is
evidence of an attractor. **Do not resurrect the attractor framing without a
chance-corrected statistic.**

### 4. Selection alone
`n <= 2k` is arithmetic. At best-of-2 the strongest model failed 4 of 110, so
max n = 8. At pass@1, 7 fails, max n = 14. Both destroyed separability (four
models tied at exactly 50%). **Selection cannot create failures.** It only
became viable once combined with pass^k.

### 5. The changed-objects response contract
Built and measured (`templates/diagnose-objects.md`,
`src/tasks/object-overlay.ts` — identity-keyed overlay, 21 test steps). It
removes a real artifact: object omission is **37% of failures**, 28% of repair
attempts.

**But the end-to-end effect is +11pp pooled, McNemar p = 0.115 — not
significant** — with grok-4.3 *regressing* 11pp. The two-model result I first
reported (+22pp, p = 0.0215) did not survive adding the weak models.

Kept: `omission_rate` as a published column (`src/stats/omission.ts`).
Not adopted: the contract. **The code is there if this is revisited.**

### 6. Composition (X176)
Two solved parents plus glue. **Solved first try, 11/11.** EvoEval's COMBINE
result does not transfer to a repair benchmark — their join is two independent
algorithmic *problems*; ours handed the model the glue.

### 7. Big apps
Omission scales with size: 2.9% of attempts at 1–4 starter objects, **18.2% at
13+**. Wave 1's recycled-filler composites bought omission, not difficulty.
**Put a graded contract in a SMALL app.**

---

## Things that worked, and are now load-bearing

- **`pass^k`.** The whole result. `scripts/passk.py`. Comparable to BC-Bench
  by construction.
- **Panel selection tooling.** `scripts/panel-select.py` — sweeps retention
  thresholds, and **refuses any run containing an attempt on a round token
  cap.**
- **Failure-cause classification.** `scripts/failure-causes.py` — separates
  behavioural failures from omission, mixed and AL-knowledge.
- **Completeness detection.** `checkCompleteness` in `object-overlay.ts` +
  `scripts/completeness-scan.ts`. Found that only **1.2%** of passing attempts
  silently drop something the reference keeps — the oracles are not badly
  blind.
- **The A/B comparison harness.** `scripts/ab-compare.py` — paired McNemar,
  and it drops provider failures rather than scoring them.

---

## Traps that cost us real time — check these first when a number looks odd

1. **`bench --max-tokens` defaults to 4000** and silently overrides
   `.centralgauge.yml`. A whole strategy round was built on a 40% score that
   was truncation. **Always pass `--max-tokens 64000`.** `panel-select.py`
   now refuses capped runs mechanically.
2. **A 402 scores as `success: false`.** An exhausted OpenRouter balance
   reported grok and deepseek at 0/18 and looked exactly like capability
   failure. Every analysis script now drops zero-output cells.
3. **Staging a scratch task for a gate needs BOTH** `tasks/starter/<id>/` and
   the oracle in `tests/al/hard/`. Two gate runs were invalid and both would
   have read as "resists".
4. **`AutoIncrement` counters do not reset on `DeleteAll` and do not roll back
   with the test transaction.** Assign entry numbers explicitly in oracles
   that seed more than once.
5. **A warm-up call then a measured identical call measures nothing** — the
   NST serves repeat identical reads free. Copy `FlushDataCache()` from
   `CG-AL-X169.Test.al` (write an unrelated row, then `SelectLatestVersion`).
   Six oracles already use it. **I re-derived this instead of reading it and
   burned a pilot.**
6. **Gate A3 exists for a reason.** Probe a platform premise BEFORE spending a
   build slot. I authored first twice and paid for it twice.

---

## If you are here to make the suite harder in ~2 months

**Do this, in order:**

1. **Re-run `scripts/attractor-probe.ts`** on the 17 archived candidates
   (`scratch/attractor-*.json`) against the then-current frontier. Cents.
   If it still returns zero convergent attractors, **do not author.**
2. **Re-run `scripts/passk.py`** on the existing 110 against new models. Five
   trials, ~4h, ~$150. The suite may have re-opened without any new tasks —
   `pass^5` separation was 51.5 points and a new generation moves it.
3. Only if (1) returns hits: author against **what a model actually writes
   wrong**, in a small app, on a frozen table, and verify with an attempt-1
   *behavioural* failure on two vendors.

**Do not** start from "what would be a hard AL problem". That produced 0-for-2.

**Watch BC-Bench** (`bc-bench.md`). It is Microsoft's, actively developed, and
its `nl2al` set (112 + 66 tasks) is our format — currently LLM-judge graded,
which is its weakest link and our biggest differentiator. If they add an
executable oracle there, our positioning changes materially.

---

## Addendum 2026-08-31: the trap surface is not exhausted; my candidate generation was

The 0-for-17 screen above used candidates I INVENTED. Candidates MINED from
real code-review findings (DevOpsWorker `pr_reviews.findings_list`, 778
critical/major AL findings, corpus described in
`U:\Git\DevOpsWorker\private\internal-docs\superpowers\plans\2026-08-31-review-provenance-for-trap-mining.md`)
went **3 for 12** on the same screen, opus-5 + gpt-5.5:

- **M11 convergent**: both models put `Sleep()` backoff inside the caller's
  open posting transaction, holding record locks; gpt-5.5 added
  `[CommitBehavior(CommitBehavior::Ignore)]` on top.
- M8 (Opus only): truncated a filename with `CopyStr(Name, 1, 100)`, losing
  the extension a sibling routine derives the MIME type from.
- M9 (gpt-5.5 only): listed blobs once, never followed the continuation
  marker.
- M6 (Opus only): omitted from `Find` the parent guard that `Update` and
  `Insert` both carry.

What separates these from the invented set: they are mistakes a competent
developer actually made and shipped to review (gate A1's "wrong form a model
would plausibly write fresh"), and they are inconsistency/attention-shaped
rather than knowledge-shaped. Known-semantics traps stay dead (M2: both models
already `FieldRef.Validate`).

Two screen defects found and fixed on the way: the probe's 4000-token budget
starved reasoning models (6 of 24 cells empty; now 16000 via
`CENTRALGAUGE_PROBE_MAX_TOKENS`), and one observation per model is noise
(verdict instability measured at 1 in 3), so a hit needs >= 2 of 3 passes.

M11 is n=1 per model and has passed no gate. The pipeline to take it and its
successors through screening, building and gating is in
`mined-trap-pipeline-prompt.md`. **Re-test order is therefore revised: screen
the mined corpus first, not the archived invented candidates.**
