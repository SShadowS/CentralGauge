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

## Addendum 2026-08-31 (later the same day): the mined screen's first gated task FAILED

The addendum above reports the mined corpus screening at **3 for 12** where the
invented set went 0 for 17, and revises the re-test order to "screen the mined
corpus first". Batch 0 of that pipeline has now run end to end, and the hit
rate it should be judged on is not the screen's.

**Screen: 2 convergent from 11 new mined candidates (18%, consistent with the
3-of-12 prior). Gate: 0 of 1 built. Promoted: 0.**

`CG-AL-X180` (a one-time secret discarded by a failure that runs before it is
durably stored) was the strongest candidate the screen has ever produced -
**both** `claude-opus-5` and `gpt-5.5` wrote the wrong form in **3 of 3** passes,
where M11 was 1 of 1. It passed B1, B2 on three containers, B4, an out-of-family
B6a audit (3 HIGH holes found and closed), and B7 (LethAL 90.9%, only
provably-equivalent survivors). Then **both models solved it on attempt 1 in 3
of 3 bench trials, at 100/100.**

**The lesson, and it is the one that matters for whoever picks this up:
"a model writes this bug when composing from a requirement" and "a model fails
to fix this bug when shown the whole app and the symptom" are different
capabilities, and the first does not predict the second.** `attractor-probe.ts`
measures the first. The bench gate scores the second. The mined corpus fixed
the *candidate supply* problem the 0-for-17 screen exposed - these really are
mistakes competent developers ship - without touching the *format mismatch*
between the screen and the gate.

This is the third time the suite has produced a valid, well-gated, unhard task
(X178, X179, now X180), and the first time it happened with an empirical
per-model screen rather than a derived recipe standing behind it. Screening in
the authorship format is therefore not the fix for authoring; it is a cheaper
way to reach the same wall.

Before the next batch, change the screen to measure the gate's own question:
plant the defect, show the app, state the symptom, and keep only candidates
both models fail to REPAIR. Full counts, costs and reasoning in
`hardening-levers-evidence.md`, section "Mined-trap pipeline, batch 0".

The second convergent hit of the batch (B0-7, a running total recomputed per
row) was never built: gate A2 rejects it as the mechanism already promoted in
`CG-AL-X084-calctotals-rebuild-quadratic`.

## Addendum 2026-08-31 (third): authoring is NOT dead - the format was wrong

The two addenda above end at "screening in the authorship format is a cheaper
way to reach the same wall". The wall has now been gone round, and the headline
of this file needs reading in that light.

**Three tasks now exist that both `claude-opus-5` and `gpt-5.5` fail on attempt
1, behaviourally, in 3 of 3 trials: CG-AL-X185, CG-AL-X187, CG-AL-X194.**

They are not new AL. Each is four ALREADY-GATED single-defect donors copied
verbatim into one application with all four defects live at once, and every one
of those donor defects is solved first-try in isolation. What makes them resist
is not what is in the app but what is withheld from the prompt:

- no count of what is wrong,
- no module named, and none exonerated,
- no mechanism word, and no per-defect symptom.

The suite's existing composites (X096-X100, X141-X145) do the opposite - X096
tells the model that three of four modules "are working correctly today and must
not be changed" and that the fourth has exactly two problems - and every one of
them is solved single-shot. Same shape, same size, opposite result. **The
difficulty was never in the code; it was in how much the prompt gave away.**

Three practical consequences:

1. **Dead end #1 above ("authoring more hard tasks") is narrower than written.**
   Authoring NEW hard AL is still unproductive. ASSEMBLING gated donors and
   withholding the symptom is not. Yield is ~15% per composite, measured over 18.
2. **Dead end #5 ("the changed-objects response contract") should be reopened
   for large apps.** It was shelved at +11pp, p=0.115 - a null driven by pooling
   weak models. On these 10-15 object composites it removed object omission
   entirely (0 of 6 attempt-1 behavioural failures lost attempt 2 to it), which
   is what discredited X175's attempt 2. Use `diagnose-objects.md` above ~8
   objects.
3. **Do not select donors for hardness, and do not select them for subtlety.**
   Both were tested. X183 carries two of the suite's hardest donors and was
   solved; a whole batch of eight built from <= 4-line "quiet" defects yielded
   1 of 8, no better than chance against the baseline rate. The sharpest datum
   in the programme: X114, whose defect is `>= 360` where the contract says
   `> 360`, is solved 30/30 alone by every model in every trial, and missed by
   both frontier models in every cell once three unrelated defects compete with
   it.

Full counts, cost model and the assembler's one real gotcha are in
`hardening-levers-evidence.md`, section "Multi-defect composites with a withheld
symptom".

## Addendum 2026-09-02: the composite lever is six donors, not the site count

Batch 6 (ten 8-site composites, donor pool stripped of earlier donor sets)
gated 1 of 10 where the 09-01 batch gated 6 of 10, with the models measured
unchanged on a control. Over every composite screened, 0 of 70 without one of
X076, X074, X140, X170, X075 or X114 gated; 22 of 38 with one did, at every
site count. The 4 -> 8 site curve was the chance of drawing one of them. Seed
composites with `composite-plan.py --require`, build at five sites, and treat
the gated composites as six knowledge gaps in many wrappers. Evidence in
`hardening-levers-evidence.md`, "The dose-response was a confound".

Batch 7, run the same day on that rule at five sites, gated 6 of 10 at $3.77
per task - every resisting cell on a seeded donor. `scripts/composite-survival.py`
refreshes the table; run it before planning.
