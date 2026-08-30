# BC-Bench: the other AL benchmark, and what it says about our numbers

**arXiv 2608.20851**, "BC-Bench: Evaluating Agentic Engineering in a
Domain-Specific Language for ERP", Sun & Hansen, submitted **2026-08-21**.
`github.com/microsoft/BC-Bench`, MIT, under daily development (most recent
commit 2026-08-28). **Microsoft, not Microsoft-adjacent** - the repo's git log
carries `haoransun@microsoft.com`.

As of today it is the only other AL/BC LLM benchmark in existence.

## What it is

101 tasks in `bcbench.jsonl`, SWE-bench schema adapted to AL:
`FAIL_TO_PASS` / `PASS_TO_PASS` are lists of `{codeunitID, functionName[]}`
against **real repo test codeunits**, not authored oracles. The agent gets a
BC container, the compiler and the test runner. Resolved = the patch builds
and all evaluation tests pass. Collection is SWE-bench-Live style and
continuous: a scheduled script over merged PRs in `microsoft/BCApps` labelled
`AL: Apps (W1)`.

Cost signature: **~685,000 prompt tokens and 197-284s per task** - that is
agentic repo navigation, and it is the biggest structural difference from our
format.

The repo is larger than the paper. Eight categories, including
**`nl2al.jsonl` (112 rows) and `nl2al_challenge.jsonl` (66)** - natural
language spec to a single AL artifact, which IS our format. But graded by an
**LLM judge against a checklist** of severity-tagged criteria. No leaderboard
data exists for it yet.

## The number that matters: the gap is mostly metric

Aggregating all **85 runs across 15 model/agent combinations** from their
published per-instance data, on the same 101 tasks:

| statistic | BC-Bench |
|---|---|
| pass^5, top model (all five runs succeed) | **49.5%** |
| mean per-run, best model | 69.1% |
| best single run ever recorded | 75.2% |
| **union - solved by at least one run of any model** | **91.1%** |
| never solved in any of 85 runs | 8.9% (9 tasks) |

**Their 69.1% is a mean per attempt; our 94-96% is best-of-2 per model. The
comparable statistic is their union, 91.1%, against our pass@1 of 92.7%.**
Those agree to within two points.

So the answer to "are our tasks too easy, or does our format measure something
narrower?" is: **narrower, plus a metric difference, and only thirdly a
difficulty difference.** If our tasks were simply easy relative to the domain,
their union would sit well below ours. It does not.

Four real differences remain, in descending size: agentic multi-run vs
single-shot (their per-run mean carries localisation, container and
multi-file-coordination failures we do not have); metric strictness; provenance
(real merged PRs vs planted defects); and scope (multi-file repo vs single
starter app).

**The caution against over-comfort:** they retain 9 of 101 tasks never solved
in 85 runs. We have 1 of 110 failed by all three frontier models. Their
irreducible core is measured far more strictly and is still there. **The way
to make ours comparable is more RUNS, not more tasks.**

## What this hands us for the launch bar

**They report `pass^5` alongside the mean, and their top model sits at
49.5% under it.** That is the all-k-must-pass metric, in our exact domain,
published by Microsoft. Adopting `pass^k`:

- moves our headline substantially on **unchanged tasks**,
- is **directly comparable** to the only other AL benchmark rather than a
  contrivance invented to hit a target,
- and may restore the separability that the n=14 selection destroyed - four
  models tie at 50% on pass@1 there, but they differ in *consistency*, which
  is exactly what pass^k measures.

This is the cheapest remaining route to the bar and it authors nothing.

## Where we are ahead

Searching all 913 repo file paths for `blind`, `sufficien`, `solvab`,
`ambigu`, `oracle`, `strict`, `mutat` returns **zero hits on every one**.
BC-Bench has no blind-solve gate, no over-strictness audit, no mutation
testing and no spec-sufficiency check. Their validity model is a structural
screen - which their own code calls "a preliminary filter only... still
requires manual review" - plus an LLM judge for nl2al.

Our B4 over-strictness gate, LethAL mutation round and `oracle-audit.py` are
ahead of the only other AL benchmark in existence. That belongs in a launch
claim.

## Overlap and reuse

**Content overlap is essentially none.** Theirs are real merged PRs by
functional area (item 24, customer 21, vendor 14, sales 12, finance 9); ours
are hand-authored platform-semantics traps. No counterpart to SQL-counter
contracts, extensible enums, permission semantics or ChangeCompany appears in
their datasets.

The three-way distinction for a launch claim:

> BC-Bench bug-fix measures whether an agent can navigate a real ERP
> repository and land a fix that passes the repo's own tests. BC-Bench nl2al
> measures whether a model's AL output satisfies an LLM-judged checklist.
> CentralGauge measures whether a model knows AL platform semantics well
> enough to identify and correct a planted defect, graded by execution against
> an authored oracle. Only CentralGauge pairs a specification-driven single
> artifact with an executable oracle.

Reuse: MIT both ways. Their bug-fix tasks are **not** runnable by us -
`microsoftInternal/NAV` is private. Their nl2al tasks would run under our
harness but only by accepting an LLM-judge oracle, which trades our strongest
asset for their weakest link. Their **per-instance per-run outcome matrix over
15 model/agent combinations is a ready-made external reference set**, MIT, and
is the artifact nobody else publishes.

**Contamination:** `microsoft/BCApps` is public and almost certainly inside
the 338 MIT-licensed AL repos, so their public tasks carry the same exposure
ours do. They landed a contamination probe two days ago (SWE-Bench Illusion
methodology, model gets issue text only and must name the buggy file). No
results published.

## Corrections to carry

- **The paper's headline 68.5% for Claude Code + claude-opus-4.6 does NOT
  reproduce** from the repo's own leaderboard: those five runs are
  [64.4, 66.3, 66.3, 63.4, 68.3], mean **65.7%**. The nearest published figure
  is GitHub Copilot + claude-opus-4-6 at **69.1%** over ten runs. Cite the
  repo, not the paper.
- The GPT-5.3 vs 5.2 test-generation result DOES reproduce: 45.3% vs 44.0%,
  permutation p = 0.6746 against their reported 0.672.
- 101 is the count for bug-fix AND test-generation; they share one dataset.
