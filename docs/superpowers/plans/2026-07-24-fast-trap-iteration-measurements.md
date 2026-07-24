# Fast trap-task iteration: cold vs warm measurements

Task 8 of the Phase 1 implementation plan. This is the acceptance gate: the
whole plan is justified only if this measurement shows a real delta, and the
result decides whether Phase 2's W3 (cross-process compiler-folder adoption,
with its cross-process locking and marker protocol) gets built at all.

## Method

- Task: `tasks/hard/CG-AL-X035-poisoned-rescue.yml` (one hard trap-task).
- Models: `anthropic/claude-opus-4-8`, `anthropic/claude-sonnet-4-6`,
  `anthropic/claude-haiku-4-5-20251001` (see "Model-slug correction" below —
  the third slug differs from `run-xiterate.ps1`'s shipped default).
- Containers: `Cronus282,Cronus283,Cronus284` (bench lane; `Cronus28` sanity
  lane skipped via `-NoSanity`).
- Runner: `run-xiterate.ps1` with the new `-TraceFile` parameter, `--runs 1
  --attempts 2`, `--no-ingest`.
- **Cold**: `deno task start doctor purge-compiler-cache` immediately before
  the run, purging the artifact cache the compiler folder is built from.
- **Warm**: the very next run, no purge, no other bench in between. Compiler
  folders and the artifact cache both survive from the cold run
  (`[container:bc] Keeping 3 compiler folder(s) for cache reuse` at the end
  of the cold run's log confirms this).
- Both runs launched in the background and timed by wall-clock (`date +%s`
  before/after) and independently by the tracer's own root `bench` span in
  the emitted Chrome Trace file. The two numbers are close but not identical
  (see "Wall time" below) because the epoch measurement also includes
  `pwsh`/`deno` process startup outside the traced span; the root `bench`
  span is the primary, apples-to-apples number used for all percentages
  below.

**n = 1 per condition.** This is a single cold/warm pair, not a distribution.
The spec's own `timing.log` (249 recorded task attempts) shows per-attempt
totals ranging p50 40.9 s to max 199.4 s — real per-task variance exists at
roughly the same scale as some of the deltas measured here. A single pair
cannot separate a real startup effect from per-task variance unless the
delta is large relative to that range. Where it matters below, each finding
is labeled with whether it clears that bar.

The two runs also produced different pass outcomes on the SAME task/model
set (cold: 1/3 solved by attempt 2, Opus; warm: 0/3 solved) — a visible
instance of per-task/attempt stochasticity in LLM output, independent of the
setup-phase timing this document is about. Total cost across both runs was
$0.057.

## Wall time

| | Cold | Warm | Delta |
|---|---|---|---|
| Wall clock (epoch) | 300 s | 203 s | 97 s |
| Root `bench` span (trace) | 295.27 s | 177.30 s | **117.97 s** |

## Per-phase `setup.*` breakdown

| Phase | Cold | Warm | Delta | % of total delta |
|---|---|---|---|---|
| `setup.health` (Cronus282) | 10.71 s | 12.07 s | -1.36 s | |
| `setup.health` (Cronus283) | 5.62 s | 5.86 s | -0.24 s | |
| `setup.health` (Cronus284) | 4.97 s | 5.73 s | -0.76 s | |
| `setup.health` (sum, 3 containers) | 21.30 s | 23.66 s | -2.36 s | -2.0% |
| `setup.prenuke` | 8.03 s | 6.89 s | 1.14 s | 1.0% |
| `setup.warmup-compiler` | 146.17 s | 48.96 s | **97.21 s** | **82.4%** |
| `setup.harness` | 49.26 s | 30.19 s | 19.07 s | 16.2% |
| **setup TOTAL** | **224.76 s** | **109.70 s** | **115.06 s** | 97.5% |
| Non-setup (LLM + compile + test + rest) | 70.51 s | 67.60 s | 2.91 s | 2.5% |
| **Root `bench` span TOTAL** | **295.27 s** | **177.30 s** | **117.97 s** | 100% |

Setup as a share of total run: **76.1% cold, 61.9% warm**. `setup.warmup-compiler`
alone is 49.5% of the cold run and still **27.6% of the warm run**.

`setup.warmup-compiler` and `setup.harness` are each a single aggregate span
covering all three containers (not per-container — only `setup.health`
carries an `args.container` tag in the trace), and the spans run
sequentially (`setup.warmup-compiler` starts at ts≈30.1s and ends at
ts≈176.3s, exactly where `setup.harness` starts), so the sums above are not
double-counting overlapping work.

Non-setup work (LLM latency + compile + test, self-reported by bench as
"Runtime: LLM/Compile/Test") is flat between conditions (70.51 s vs 67.60 s,
a 2.9 s difference against a p50-to-p90 attempt range of 40.9-67.2 s in the
spec's historical data) — consistent with the non-setup phases genuinely not
depending on compiler-cache state, as expected.

## Ranking the four candidate binding constraints

The spec's "Binding-constraint hypothesis" section lists four candidates in
this order: (1) per-task variance, (2) LLM latency, (3) cold-spawn tax, (4)
compiler folder rebuild — with compiler folder rebuild ranked **fourth**,
i.e. last, in that list. Measured against real numbers, compiler folder
rebuild ranks **first** — by a wide margin — in both conditions:

1. **Compiler folder rebuild (`setup.warmup-compiler`)** — accounts for
   82.4% of the entire cold→warm delta (97.21 s of 117.97 s) on its own.
   This is far outside the range that per-task variance alone could explain
   (compare: the spec's own attempt-level p50→p90 spread is 26.3 s; this
   single-phase delta is 3.7x that). **This is the dominant, measured
   driver of the delta.**

2. **`setup.harness`** — a secondary but real contributor: 19.07 s (16.2% of
   the delta), shrinking from 49.26 s cold to 30.19 s warm. Notably, this
   phase is NOT eliminated by warmth — it still costs 30.19 s (17% of the
   warm run) even when the harness app was already published from the cold
   run seconds earlier. This bears directly on the spec's **open question
   #2** ("whether `ensureTestHarness`'s per-container cold spawn should move
   to the warm session slot"): the answer, on this evidence, is that a
   persistent-session daemon would remove real, non-trivial cost beyond
   what compiler-folder caching alone captures — 30 s/run is not noise.

3. **Cold-spawn tax (`setup.health`)** — flat to slightly *negative*
   (-2.36 s, i.e. warm was marginally slower): 21.30 s cold vs 23.66 s warm,
   across 3 containers. This matches the hypothesis's own framing exactly —
   "roughly 45 s across three containers, every run, even when everything
   is already warm" — as a **constant floor paid unconditionally**, not as
   a driver of the cold/warm delta. (The absolute total, ~21-24 s, is lower
   than the spec's rough ~45 s estimate, but the "doesn't shrink when warm"
   shape is confirmed.) A -2.36 s difference is well within n=1 noise and
   should be read as "flat," not as warm being worse.

4. **Per-task variance / LLM latency** — real (the two runs produced
   different pass/fail outcomes on an identical task/model set), but it did
   NOT show up as a timing driver of the setup-vs-total delta measured here:
   non-setup work was flat (70.51 s vs 67.60 s, a 2.9 s difference). This
   measurement cannot rule out per-task variance as a real cost at scale
   (it operates at the scale of whole attempts across many tasks and
   models, not one paired run), but it can say that in this pair it was not
   what separated cold from warm.

## Does compiler-folder rebuild justify W3?

**Yes, on this measurement.** `setup.warmup-compiler` is 97.21 s of the
117.97 s cold→warm delta (82.4%) — a single-phase effect large enough to
clear the n=1 noise floor by a wide margin (3.7x the historical attempt-level
p50→p90 spread). It is also still costing 48.96 s / 27.6% of a fully warm
run, because (per the corrected finding in commit `0dfac3c1`) `New-BcCompilerFolder`
deletes and rebuilds the folder on every call regardless of artifact-cache
state — a warm artifact cache only makes the VSIX-expansion-plus-copy refill
faster, it does not skip the rebuild. W3's proposition — skipping the BCH
call entirely when a marker validates the existing folder against the
artifact URL — targets exactly this residual 49 s, which today survives
every optimization already shipped in this plan (Tasks 1-7).

**Caveat sized to the corrected mechanism, not the spec's original framing.**
The Task 6 audit (commit `0dfac3c1`) established that `--no-compiler-cache`
never caused a full network artifact re-download per container per run —
`Download-Artifacts` already gates on `Test-Path` against
`C:\bcartifacts.cache` — so the true cost being measured here is VSIX
expansion plus the symbol/compiler/DLL copy set, not a network fetch. The
observed 97 s delta is the real cost of that corrected mechanism, and it is
large. If anything, the corrected framing makes the case for W3 *stronger*
than the spec's original hypothesis, not weaker: the cost is real, it is
concentrated in exactly one call site, and it is not a network-variance
artifact that would wash out with better caching elsewhere.

**What this measurement cannot support:** a precise multi-model/multi-container
projection of W3's savings at bench scale (n=1 doesn't estimate variance),
and it says nothing about W3's engineering cost (the cross-process locking
and marker protocol) — only that the target it addresses is real and
currently the largest measured component of setup, in both conditions.

## Model-slug correction (out-of-scope finding, recorded for follow-up)

`run-xiterate.ps1`'s default `-Models` value included the bare alias
`anthropic/claude-haiku-4-5`. The first cold-run launch attempt failed in
~5 s (before touching any container) with `ModelValidationError`. Root
cause: `models --check` (the CLAUDE.md-documented preflight) validates by
making a raw generation call to the provider API, which accepts the bare
alias leniently; bench's own `validateModels()` in
`cli/commands/bench/parallel-executor.ts` instead checks the slug against a
live Anthropic model-*discovery* list (`/v1/models`-equivalent), which
returns 11 dated model IDs and does **not** include the bare alias — only
`claude-haiku-4-5-20251001`. `site/catalog/models.yml` carries both slugs as
separate catalog entries (`anthropic/claude-haiku-4-5-20251001` and
`anthropic/claude-haiku-4-5`), which is what let `--check` pass in the first
place. Opus and Sonnet slugs were unaffected — only the Haiku alias hit
this gap.

This is a real, pre-existing inconsistency between the documented preflight
(`models --check`) and bench's actual startup validation, and it means the
documented preflight is not sufficient on its own to guarantee a bench run
will start. **It is not fixed here** — it's recorded as a follow-up: either
`validateModels()` should accept catalog-listed aliases (not just
discovery-list hits), or `models --check` should be tightened to match
bench's stricter gate, or the catalog should stop carrying undated aliases
as separate entries from their dated pins. Both measurement runs above used
`anthropic/claude-haiku-4-5-20251001` via an explicit `-Models` override
(not by editing `run-xiterate.ps1`'s default) to keep the cold and warm
conditions using an identical, working model set. `run-xiterate.ps1`'s
shipped default is fixed separately (see the `fix(bench):` commit) since it
failed for anyone running the wrapper without an override — that part of
the finding is in scope for this plan, the underlying `--check`/
`validateModels()` divergence is not.

## Verdict

Compiler-folder rebuild is the measured binding constraint on cold→warm
startup cost for this task/model/container combination, contrary to its
position as the last-listed (least-emphasized) candidate in the spec's
original hypothesis ordering. It accounts for the large majority of the
delta (82.4%), remains the single largest phase even warm (27.6% of a warm
run), and is large enough relative to known per-task variance (3.7x the
historical p50→p90 attempt spread) that a real effect, not noise, is the
better explanation. **W3 is worth building.** The harness cold-spawn cost
(`setup.harness`, still 30 s warm) is a secondary but real target worth
scoping alongside it or in a follow-up, per the spec's open question #2.
