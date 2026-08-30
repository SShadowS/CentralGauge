Read all four files. Here's the adversarial review.

## 1. pass^k: legitimate or metric-shopping?

Both, and the defence only half-works. pass^k is a real, published, defensible strictness convention, and the mechanism argument (drop scales inversely with capability) is genuine evidence it measures consistency, not noise. So the *metric* is legitimate.

But the *process* was metric-shopping: the bar was fixed at ≤50%, and you searched the metric space until something met it — and even pass^5 on the full suite **doesn't** meet it (Opus 87.3%). You only reach 50% by stacking pass^5 with a subset selected to hit exactly 50.0%. The BC-Bench precedent covers the metric, not the stacking. The defence would be sound if you'd said "we adopt pass^5 because Microsoft does, and here's what the number is." It becomes unsound the moment the metric choice is coupled to a target the metric must hit — which is what the n=24 selection does. Also note: BC-Bench's pass^5 is over *agentic multi-run* attempts with container/localisation noise; your single-artifact format has structurally lower per-trial variance, so "their top model sits at 49.5% under pass^5" is not evidence your pass^5 numbers are comparable in meaning, only in formula.

Verdict: pass^5 as headline on the full 110 — I agree, ship it. pass^5 as the route to the 50% bar — that's the subset doing the work, and the subset is the problem.

## 2. The n=24 subset overfits badly

I agree with your implicit worry, strongly. This is the weakest thing in the whole package:

- **Selected on the same 5 trials it's scored on.** With Opus at ~87% pass^5, the 24 tasks are drawn mostly from the ~13% Opus-failure tail, which is exactly where trial-to-trial binomial noise lives. Tasks that Opus failed in 1-of-5 trials by chance get selected; on a fresh 5 trials, expect meaningful regression toward easier — the "50.0%" will not replicate. With 12/24 as the top score, the standard error alone is ~±10pp.
- **"Exactly 50.0%"** is a tell, not a result. It advertises the selection procedure. Any reader who notices (and BC-Bench's authors will) can reconstruct that the subset was optimised against the constraint.
- **Honest version:** split the five trials — select the subset on trials 1–3, report its pass^5 (or pass^3) on trials 4–5; or select on these five trials and run five *fresh* trials before publishing the subset number. That's ~$150 and 4h per LESSONS.md. There is no excuse not to do it.
- **Publishable at all?** Yes, but only labelled as what it is: "a post-hoc hard subset selected on these trials; out-of-sample performance TBD." Publishing "top model at 50.0%" as a headline frontier view without out-of-sample validation is not defensible.

Also: with 9 tasks solved by nobody, 9/24 of the subset carries zero ranking information for *any* model — the frontier view is really ranking on ~15 tasks.

## 3. The 8.7% vs 8.9% corroboration is weak

Mostly coincidence-shaped. Objections:

- **Non-comparable exposure.** 85 runs across 15 model/agent combos is ~17× the sampling of 5 trials × 6 models (30 exposures, and really 6 independent models). Your "never solved" set will shrink as trials accumulate; theirs has been stress-tested far harder. The document itself admits this ("their irreducible core is measured far more strictly"). So the sizes matching is partly an artifact of *your* smaller sample inflating your core to meet their genuinely hard one.
- **No task-level correspondence.** The tasks are disjoint in content by your own analysis ("content overlap is essentially none"). Two benchmarks having ~9% unsolved tails is one scalar coinciding, and small-percentage tails on ~100-task benchmarks land in the 5–15% range for many reasons (a few over-strict oracles, a few genuinely hard tasks, a few broken ones). Note X133 and X173 — sitting *in* your core — are flagged as having minimal validity evidence. If either is over-strict, your core is 7/103 = 6.8% and the "matching" number evaporates. The corroboration claim is gated on Phase 0.2 and shouldn't be written until it clears.
- Legitimate weaker claim: "our union/pass@1 agrees with their union within 2 points" — that one I *do* buy as evidence the suite isn't trivially easy relative to the domain.

Verdict: demote from "strongest external evidence" to "suggestive convergence"; drop the two-decimal-place 8.7-vs-8.9 framing.

## 4. The screen mismatch is real, but "stop authoring" is still right-ish

You've spotted the correct flaw: the attractor screen tests **generation** ("does a model write the buggy form from scratch") while the benchmark tests **repair** ("given the buggy form, can the model diagnose it"). These are different failure modes. A model can reliably write correct code yet fail to *localise* a planted defect in someone else's code, especially with a misleading symptom description. Zero convergent generation-attractors does not entail zero repair-resistant defects. So the screen, as evidence, is weaker than LESSONS.md treats it.

However — the two pilots (X178, X179) *were* repair-format and both fell first try, and they were built to the recipe derived from tasks that resist. That's direct, format-matched negative evidence, n=2. Combined: the *specific authoring strategy tried* is dead, but "authoring is dead" is overclaimed. What was never tried: authoring against repair-specific difficulty (localisation under misleading symptoms, defects whose fix interacts with the oracle's hidden assertions) rather than semantic-trap difficulty. The 9-task irreducible core exists — someone authored those — so the recipe extraction failed, not authoring per se.

Verdict: partially agree. Don't fund wave 2 now; but rewrite the rationale, and add a repair-format screen to the two-month re-test list.

## 5. BATTLEPLAN issues

Mostly solid — the Phase 2 defect table is excellent and defect #1 (k not pinned) is correctly identified as load-bearing. Real problems:

- **"No D1 migration needed" is probably true but under-verified.** Phase 3 itself hedges ("re-confirm before deploying"), and Phase 2's fix requires the query to return `(n_runs, c_runs)` per (model, task) — if that ends up materialised or cached anywhere, the no-migration claim breaks. Also `runs.status` filtering (defect #4) with *no* status filter anywhere: check whether any of the five trials had partial/aborted runs *before* ingesting, because after ingest a short run silently deflates k-eligibility or contaminates pass^k.
- **Ingest defensibility: mixed.** Idempotency on run_id only means replaying a *re-exported* file (fresh ids) **does** double-count — the plan says "replaying the same file is a no-op," which is true but narrower than safe. There's no constraint preventing six or seven runs of the same (model, task_set, settings), and defect #1's fix gates on `n_runs >= k` — but which 5 of 6 trials count if an extra sneaks in? Pin trial membership explicitly (a trial-group tag), don't rely on counting.
- **Ordering error:** Phase 0.2 (X133/X173 B4 audit) gates the launch *numbers*, yet Phase 1 ingest and Phase 3 site work proceed in parallel. If X133 or X173 fails B4, the n=24 subset, the 8.7% core, and the Phase 5 claim all change after production ingest. Run 0.2 to completion before anything user-facing.
- **Missing entirely:** the out-of-sample validation of the n=24 subset (point 2). The plan ships the subset as-is. That's the unsafe part.
- The best-vs-worst aggregation inversion warning is correct and I agree with porting the tier matrix rather than dropping it.

## 6. The launch claim vs. the kappa

**Wrong statistic for that claim, and it points the wrong way for a different claim you're also making.** "Separates models" is a claim about *score dispersion and rank stability* — the 51.5-point pass^5 spread with monotone ordering supports it directly; cite that. Inter-model kappa (+0.368 vs +0.558) measures whether models fail the *same tasks*. Lower kappa means less shared difficulty structure — which can mean richer discrimination, but can equally mean *more per-task noise or idiosyncratic grading artifacts*. High-noise benchmarks also have low kappa. Worse: low agreement sits in tension with the corroboration story in point 3 ("our difficulty is real and shared"). You can't simultaneously lean on inter-benchmark convergence of difficulty and intra-benchmark divergence as virtues without explaining the reconciliation. Drop the kappa from the launch claim; keep the spread and the distinct-scores monotonicity.

---

**Single strongest objection:** the n=24 frontier subset is selected on the same five trials it is scored with, its headline "50.0%" is an optimisation target rather than a measurement, and the plan contains no out-of-sample validation before publishing it. Everything else is fixable in copy; this is a replication failure waiting to happen in public, against a Microsoft-adjacent audience equipped to notice.

**Would I ship?** The full-110 pass^5 headline, the Phase 2 metric fixes, and the tier-matrix port: yes. The n=24 subset and the "50.0%" framing: **no** — not until (a) X133/X173 clear B4 and (b) the subset survives five fresh trials it was not selected on. That's ~$150 and a few hours against the credibility of the entire launch. Hold the launch claim's corroboration sentence pending (a) as well.