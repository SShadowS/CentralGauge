# Fast trap-task iteration: cold vs warm measurements

Task 8 of the Phase 1 implementation plan. This is the acceptance gate: the
whole plan is justified only if this measurement shows a real delta, and the
result decides whether Phase 2's W3 (cross-process compiler-folder adoption,
with its cross-process locking and marker protocol) gets built at all.

**Revision note:** this document was corrected after spec review found one
Critical and five Important defects in the first draft's claims (arithmetic
was not among them — every figure was independently re-derived from the raw
traces and checked out). The corrections are folded in below rather than
appended, since a measurement document's entire value is its numbers being
right. The core verdict, "W3 is worth building," survives the corrections.

## Method

- Task: `tasks/hard/CG-AL-X035-poisoned-rescue.yml` (one hard trap-task).
- Models: `anthropic/claude-opus-4-8`, `anthropic/claude-sonnet-4-6`,
  `anthropic/claude-haiku-4-5-20251001` (see "Model-slug correction" below —
  the third slug differs from `run-xiterate.ps1`'s originally-shipped
  default, which is fixed in a separate commit as part of this same round).
- Containers: `Cronus282,Cronus283,Cronus284` requested (bench lane;
  `Cronus28` sanity lane skipped via `-NoSanity`).
- **`Cronus284`'s Docker container was not running during EITHER measured
  run.** Both run logs show, at setup time: `[WARN] [container:bc]
  ensureTestHarness failed for Cronus284; SOAP path disabled (error="Failed
  to compile/publish CG Test Harness on Cronus284: ... STDERR: Error
  response from daemon: container 295ee429af7c... is not running")`.
  `setup.health`'s `Test-BcContainer` check passed for Cronus284 in both
  runs regardless (`args.ok: true` in the trace), so the trace alone does
  not show this — only the run log does. Effectively **two containers were
  usable, one was a zombie**, in both runs. Concretely: compiler-folder
  creation for Cronus284 still ran and succeeded in both runs (it is
  host-side work, independent of the container being up), but no task in
  either run ever reached publish or test on Cronus284 — every
  `prepare-candidate`/`test.soap.total` span in both traces is on Cronus282
  or Cronus283 only. See "Cronus284 outage: what it does and doesn't
  contaminate" below for exactly which numbers this affects.
- Runner: `run-xiterate.ps1` with the new `-TraceFile` parameter, `--runs 1
  --attempts 2`, `--no-ingest`.
- **Cold**: `deno task start doctor purge-compiler-cache` immediately before
  the run, purging the artifact cache the compiler folder is built from.
- **Warm**: the next run, no purge, no other bench in between. Compiler
  folders and the artifact cache both survive from the cold run
  (`[container:bc] Keeping 3 compiler folder(s) for cache reuse` at the end
  of the cold run's log confirms this — no purge command ran between the
  two runs). **The gap between the two runs was 64.5 minutes** (cold
  end-epoch 1784930616 to warm start-epoch 1784934487), not "immediately
  after" as the brief's step ordering implies — this was multi-agent
  orchestration latency (status reporting between runs), not a script or
  container delay. Nothing purges the compiler-cache or the artifact cache
  on a timer, so the gap does not undermine the warm condition, but it does
  mean the earlier draft's claim that the harness was "already published...
  seconds earlier" was wrong (see the `setup.harness` reclassification
  below); the actual gap was 64.5 minutes.
- Both runs launched in the background and timed by wall-clock (`date +%s`
  before/after) and independently by the tracer's own root `bench` span in
  the emitted Chrome Trace file. **The two numbers are close but the gap
  between them is asymmetric and only partly explained** — see "Wall-clock
  vs root span" below.

**n = 1 per condition.** This is a single cold/warm pair, not a
distribution. The spec's own `timing.log` (249 recorded task attempts)
shows per-attempt totals ranging min 27.8 s, p50 40.9 s, p90 67.2 s, max
199.4 s — real per-task variance exists, and at the high end (p50-to-max =
158.5 s) it is larger than the 97 s delta measured here. A single pair
cannot separate a real startup effect from per-task variance by magnitude
alone; what makes the finding below more than a favorable draw from that
variance is a confirmed mechanism (below), not the size of the number. See
"What the noise floor can and cannot rule out."

The two runs also produced different pass outcomes on the SAME task/model
set (cold: 1/3 solved by attempt 2, Opus; warm: 0/3 solved) — a visible
instance of per-task/attempt stochasticity in LLM output, independent of
the setup-phase timing this document is about. Total cost across both runs
was $0.057.

## Cronus284 outage: what it does and doesn't contaminate

Confirmed by checking `Creating compiler folder for Cronus284...` /
`Compiler folder ready: ...CentralGauge-Cronus284` in both run logs, and by
counting `prepare-candidate`/`test.soap.total` spans in both traces:

| Measurement | Contaminated by the outage? |
|---|---|
| `setup.warmup-compiler` (3 containers, both runs) | **No.** Compiler-folder creation for Cronus284 ran and succeeded in both runs — it is host-side work (artifact resolution + `New-BcCompilerFolder`) that does not require the container to be up. **Verified: exactly 3 containers' worth of compiler-folder creation ran in both the cold and warm trace** (`Creating compiler folder for` appears 3 times in each log, once per container, immediately followed by `Compiler folder ready:` each time). The 97.21 s delta on this phase is not a container-count artifact. |
| `setup.health` (3 containers, both runs) | No — `Test-BcContainer` passed for all 3 named containers in both runs (the trace's `args.ok: true` on all `setup.health` entries, including Cronus284's, reflects that `Test-BcContainer` checks Docker-level container state that apparently still reported healthy, not application-level readiness). |
| `setup.harness` | **Yes.** Both runs pay a guaranteed-doomed compile-and-publish attempt on Cronus284 as part of this span (see reclassification below). |
| Non-setup (compile/publish/test) | **Yes, indirectly.** No task's publish or test step ever ran on Cronus284 in either run — every `prepare-candidate`/`test.soap.total` span is on Cronus282 or Cronus283. Effectively a 2-container bench, not 3, for the actual task work (though all 14 compile events per run cover all 3 containers, since compile alone doesn't need the container up). |

## `setup.harness`: reclassified, not a clean cache effect

The original draft read the harness delta (49.26 s cold -> 30.19 s warm) as
evidence for the spec's open question #2 (whether `ensureTestHarness`'s cold
spawn should move to a warm session slot). That conclusion doesn't hold up:

1. **Roughly half the warm 30.19 s is the Cronus284 failure path**, not
   warm-cache benefit. The run log shows the AL compile of the harness app
   alone takes ~4-5 s (`...successfully created in 4 seconds` warm, `5
   seconds` cold) — that's before the doomed publish attempt against a
   non-running container even starts. The trace doesn't sub-span
   `setup.harness` per container, so an exact split isn't available, but by
   elimination: Cronus282 and Cronus283 in the warm run both report
   "already published" (a presence-probe only, no compile/publish — on the
   order of the same ~5-6 s spawn cost as `setup.health`'s steady state,
   so roughly 10-12 s combined for the two live containers), leaving
   roughly **15-20 s of the warm 30.19 s attributable to Cronus284's
   presence-probe + compile + failed-publish sequence** — i.e., wasted work
   against a container that was never going to succeed, not a
   cache-warmth measurement.
2. **The 19.07 s cold->warm harness delta is not a cache effect at all.**
   Cold's log line reads `Test harness published on Cronus282` (a real,
   first-time compile+publish); warm's reads `Test harness already
   published on Cronus283` (a presence-check only). This is the ordinary
   cost of publishing an app to a container **once**, the first time that
   container is used in a session — it would be paid on any first run
   regardless of whether the compiler-artifact cache is cold or warm, and
   it does not recur on a second run against the same container state. It
   does not belong to any of the spec's four candidate constraints; it's a
   fifth, session-scoped cost (harness/app publish state) that this
   document was not designed to isolate and should not have folded into
   the cold/warm story.

**Retracting the open-question-#2 recommendation.** The earlier "30 s/run
is not noise, a persistent session would remove real cost" conclusion
rested on a number that is roughly half doomed work against a container
that was down for reasons unrelated to compiler-cache state. **This cannot
be acted on as measured.** Open question #2 needs a re-measurement with all
three containers live before any conclusion is drawn from `setup.harness`.

## Wall time

| | Cold | Warm | Delta |
|---|---|---|---|
| Wall clock (epoch) | 300 s | 203 s | **97 s** |
| Root `bench` span (trace) | 295.27 s | 177.30 s | 117.97 s |

### Wall-clock vs root span

The two delta figures (97 s wall-clock vs 117.97 s root span) don't match,
and the gap is asymmetric in a way worth being precise about rather than
hand-waving as "process startup":

- **Post-root gap is small and consistent in both runs**: the results JSON
  file's mtime is within 2-3 s of the recorded end-epoch in both cases
  (cold: results file at +0s, trace file / end-epoch at +3s; warm: +0s vs
  +2s). This part is not where the asymmetry lives.
- **Pre-root gap is where it lives, and it is asymmetric**: computing
  epoch-start-to-root-span-open (`end_epoch - root_duration - start_epoch`)
  gives **4.73 s cold vs 25.70 s warm** — an ~21 s difference in the time
  between launching `pwsh` and the tracer's root `bench` span actually
  opening (which happens essentially at the top of bench's `.action()`
  handler, before the environment banner or model discovery/pricing calls
  print — so those are inside the root span, not the source of the pre-root
  gap). This is Deno process startup / module resolution time, which this
  measurement did not instrument and cannot explain. No confirmed root
  cause is offered here — this is reported as an open, unexplained data
  point, not folded into any conclusion.
- **This does not hurt the verdict.** If anything it strengthens the
  cross-check: the pure wall-clock delta (97 s) is almost an exact match
  for `setup.warmup-compiler`'s delta alone (97.21 s) — i.e. on wall-clock,
  compiler-folder rebuild accounts for essentially 100% of the observed
  difference, not 82.4%. The lower 82.4% figure (against the root-span
  delta of 117.97 s) is the more conservative of the two honest ways to
  express this, which is why it's used as the headline number below.

## Per-phase `setup.*` breakdown

| Phase | Cold | Warm | Delta | % of root-span delta |
|---|---|---|---|---|
| `setup.health` (Cronus282) | 10.71 s | 12.07 s | -1.36 s | |
| `setup.health` (Cronus283) | 5.62 s | 5.86 s | -0.24 s | |
| `setup.health` (Cronus284) | 4.97 s | 5.73 s | -0.76 s | |
| `setup.health` (sum, 3 containers) | 21.30 s | 23.66 s | -2.36 s | -2.0% |
| `setup.prenuke` | 8.03 s | 6.89 s | 1.13 s | 1.0% |
| `setup.warmup-compiler` | 146.17 s | 48.96 s | **97.21 s** | **82.4%** |
| `setup.harness` | 49.26 s | 30.19 s | 19.07 s | 16.2% |
| **setup TOTAL** | **224.76 s** | **109.70 s** | **115.05 s** | 97.5% |
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

### Non-setup: flat wall time, unequal workload — don't call it matched

The 70.51 s vs 67.60 s non-setup figures look flat, but the two runs did
**different amounts of non-setup work** in that time, verified from the
trace's `compile`/`prepare-candidate`/`test.soap.total` span counts:

| | Cold | Warm |
|---|---|---|
| `compile` spans | 14 | 14 |
| `prepare-candidate` spans (publish+prep) | **2** | **1** |
| `test.soap.total` spans | **2** | **1** |

Compile workload was identical (14/14 — every attempt across all 3 models x
2 attempts gets compiled once per container assignment, regardless of
outcome). But cold completed a full second publish+test cycle (Opus on
Cronus283, in addition to Sonnet on Cronus282) that warm did not — because
in the warm run both Opus and Haiku failed compilation on attempt 2 and
never reached publish, while in the cold run Opus's attempt 2 compiled and
passed through to test. **The 2.91 s "flat" difference is not a matched
comparison** — cold did strictly more non-setup work in about the same
wall time. The directional read (non-setup time did not blow up between
conditions) still holds; presenting it as evidence that non-setup work is
cache-independent and constant would overstate what a 2-vs-1-cycle sample
can show.

## What's actually inside `setup.warmup-compiler`

The BCH premise (F1) is confirmed directly in the installed module:
`New-BcCompilerFolder.ps1:64-68` (bccontainerhelper 6.1.14) does an
unconditional `Remove-Item -Path $compilerFolder -Force -Recurse` followed
by `New-Item -Path $compilerFolder -ItemType Directory`, every call,
regardless of artifact-cache state.

But `setup.warmup-compiler` is not only that call. `createCompilerFolder`
(`src/container/bc-container-provider.ts:1178`) builds one combined script
per container and runs it through a single fresh `executePowerShell` spawn:
`bcchImport()` (module-load check) + `Get-BcContainerArtifactUrl` (+ a
local SHA-256 cache-key computation) + `New-BcCompilerFolder`. The spawn
and module-import overhead is not free, and it does not shrink with a warm
artifact cache — it's paid identically whether or not `New-BcCompilerFolder`
finds anything to reuse.

To estimate that overhead: `isHealthy` (`bc-container-provider.ts:2341`)
does the same shape of thing — `bcchImport()` + one lightweight BCH cmdlet
(`Test-BcContainer`) in a single fresh spawn — and its steady-state warm
cost (excluding Cronus282, which is consistently the highest of the three
and likely pays some first-probe-of-the-run cost not representative of the
other two) is **4.97-5.86 s**. Using that as a proxy for
spawn+import+artifact-URL-resolution overhead, ~3 containers x ~5 s ≈ **15 s**
of `setup.warmup-compiler`'s total is spawn/import/artifact-URL-resolution,
not `New-BcCompilerFolder` itself — and that ~15 s is paid in **both**
conditions, since it doesn't depend on artifact-cache warmth.

**Restated target: because that ~15 s is present equally in both cold and
warm, it cancels out of the delta** (146.17 - 15) - (48.96 - 15) still
equals 97.21 s — but it changes what "the warm residual" means. The warm
run's 48.96 s is not "48.96 s of unavoidable folder-rebuild cost"; it's
roughly **~15 s spawn/import/artifact-URL tax + ~32-34 s of actual
`New-BcCompilerFolder` delete-and-repopulate work**. **~32 s, not 49 s, is
W3's addressable target** — the portion a marker-validated skip of the BCH
call would actually remove. The 97.21 s cold->warm delta itself is
unaffected by this reclassification; it is still real and still the
dominant driver (see next section).

## Ranking the spec's four candidate binding constraints

The spec's "Binding-constraint hypothesis" section names exactly four
candidates, in this order: (1) per-task variance, (2) LLM latency, (3)
cold-spawn tax, (4) compiler folder rebuild. Ranked here strictly as those
four (not merged, and not substituting `setup.harness` as a fifth):

1. **Per-task variance** — real, evidenced directly: the two runs produced
   different pass outcomes (1/3 vs 0/3) on an identical task/model set, and
   the non-setup workload itself differed (2 test cycles vs 1, above). Not
   measured as a *timing* driver of the setup delta in this pair, but this
   measurement is the wrong scale to rule it out — its cost (per the spec's
   own `timing.log`) operates across many tasks/attempts, not one paired
   run.

2. **LLM latency** — directly separable from the results JSON: total LLM
   time across all 6 attempts was **16.963 s cold vs 21.493 s warm**, i.e.
   warm was *slower* by 4.5 s. Flat/noise, in the opposite direction from
   the overall delta, and not a driver of it.

3. **Cold-spawn tax** — the spec names three spawn sites per container:
   health check, artifact-URL resolution, and `ensureTestHarness`'s
   presence probe. The first draft ranked this candidate on `setup.health`
   alone (21-24 s) and concluded the spec's "~45 s across three containers"
   estimate was too high. That was the wrong scope. Correctly attributed
   across all three sites: `setup.health` (21.30 s cold / 23.66 s warm) +
   the artifact-URL-resolution share of `setup.warmup-compiler` (~15 s,
   estimated above, both conditions) + the presence-probe share of
   `setup.harness` for the two live containers (~10-12 s, estimated above,
   both conditions) totals **roughly 46-51 s per run** — squarely matching
   the spec's own "~45 s across three containers, every run" framing. This
   tax is paid at roughly the same magnitude in **both** cold and warm
   (spawn cost doesn't depend on cache state), so it is not what
   distinguishes the two runs, but it is a large, currently-unaddressed
   constant cost on every run — and once W3 removes its ~32 s target from
   candidate 4, this becomes the largest remaining per-run cost, and the
   natural next thing W6/the daemon non-goal should look at.

4. **Compiler folder rebuild** — the corrected, narrower target (previous
   section): ~131 s cold vs ~32-34 s warm for `New-BcCompilerFolder`'s own
   delete-and-repopulate work, after backing out the ~15 s/run of spawn
   overhead that actually belongs to candidate 3. This narrower slice still
   accounts for the full 97.21 s delta (the constant spawn overhead cancels
   out of a delta computation), and remains the dominant, measured driver
   of the cold->warm difference — 82.4% of the root-span delta, or
   essentially 100% of the wall-clock delta (see "Wall-clock vs root
   span").

The spec's own ordering placed compiler folder rebuild fourth (last) among
the four candidates; measured, it ranks first by a wide margin as the
cold-vs-warm driver, while candidate 3 (cold-spawn tax), once correctly
scoped, is real and roughly the spec's own estimated size — just not a
*delta* driver, because it's paid identically either way.

## What the noise floor can and cannot rule out

The first draft compared the 97.21 s `setup.warmup-compiler` delta against
the spec's p50-to-p90 attempt spread (67.2 - 40.9 = 26.3 s) and reported a
"3.7x the noise floor" ratio as evidence the delta was real, not variance.
That comparison used a favorably narrow slice of the spec's own data: the
same `timing.log` has a p50-to-max spread of 199.4 - 40.9 = **158.5 s**,
larger than the 97 s delta measured here. Against the full observed range,
a single low-probability outlier attempt could in principle produce a swing
this size — n=1 cannot rule that out by magnitude alone.

**What actually supports the finding is the confirmed mechanism, not the
size of the number relative to any noise-floor slice.**
`New-BcCompilerFolder.ps1:64-68`'s unconditional delete-and-recreate is
verified directly in the installed module source, it runs once per
container in both conditions, and its cost tracks exactly the variable the
experiment manipulated (artifact-cache warmth) in the direction and rough
proportion the mechanism predicts (full VSIX-expansion-plus-copy cold,
faster local-cache-backed refill warm). The 3.7x-the-p50→p90-spread
framing is dropped as supporting evidence; the mechanism is what the
verdict rests on.

## Does compiler-folder rebuild justify W3?

**Yes, on this measurement, sized correctly.** `setup.warmup-compiler` is
97.21 s of the 117.97 s root-span delta (82.4%; effectively 100% of the 97 s
wall-clock delta). Backing out the ~15 s/run of spawn overhead that belongs
to cold-spawn tax rather than the folder rebuild itself, **W3's actual
addressable target is roughly 32-34 s of a warm run**, not the full 48.96 s
`setup.warmup-compiler` figure — but the 97.21 s cold->warm *delta* that
motivates building it at all is unaffected by that reclassification, because
the ~15 s spawn tax is paid equally in both conditions and cancels out of
the difference. This residual survives every optimization already shipped
in this plan (Tasks 1-7) because (per the corrected finding in commit
`0dfac3c1`) `New-BcCompilerFolder` deletes and rebuilds the folder on every
call regardless of artifact-cache state — a warm artifact cache only makes
the VSIX-expansion-plus-copy refill faster, it does not skip the rebuild.
W3's proposition — skipping the BCH call entirely when a marker validates
the existing folder against the artifact URL — targets exactly that ~32 s.

**Caveat sized to the corrected mechanism, not the spec's original framing.**
The Task 6 audit (commit `0dfac3c1`) established that `--no-compiler-cache`
never caused a full network artifact re-download per container per run —
`Download-Artifacts` already gates on `Test-Path` against
`C:\bcartifacts.cache` — so the true cost being measured here is VSIX
expansion plus the symbol/compiler/DLL copy set, not a network fetch. The
observed delta is the real cost of that corrected mechanism.

**What this measurement cannot support:** a precise multi-model/multi-container
projection of W3's savings at bench scale (n=1 doesn't estimate variance);
anything about `setup.harness`/open question #2 (retracted above pending a
3-live-container re-measurement); a root cause for the pre-root wall-clock
asymmetry; and it says nothing about W3's engineering cost (the cross-process
locking and marker protocol) — only that the target it addresses is real,
mechanistically confirmed, and currently the largest measured per-run cost
component in both conditions once cold-spawn tax is correctly excluded from
it.

**Verification of the single load-bearing number**: `setup.warmup-compiler`
covered exactly 3 containers (Cronus282, Cronus283, Cronus284) in **both**
runs — confirmed by counting `Creating compiler folder for <name>` /
`Compiler folder ready:` pairs in both run logs (3 pairs each, same 3
names). The Cronus284 outage does not touch this span (see "Cronus284
outage" table above); the 97.21 s delta is not a container-count artifact.

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

Compiler-folder rebuild is the measured binding constraint on cold->warm
startup cost for this task/model/container combination, contrary to its
position as the last-listed candidate in the spec's original hypothesis
ordering. It accounts for the large majority of the root-span delta (82.4%,
essentially 100% of the wall-clock delta), remains the single largest phase
even warm (27.6% of a warm run, ~32-34 s of which is the actual addressable
`New-BcCompilerFolder` cost after correctly excluding cold-spawn tax), and
is backed by a confirmed mechanism in the installed BCH source rather than
resting on a favorable noise-floor comparison. **W3 is worth building,
targeting ~32 s per run, not ~49 s.**

Two things this measurement does NOT establish, corrected from the first
draft: `setup.harness`/open question #2 (contaminated by the Cronus284
outage — needs a 3-live-container re-measurement before any recommendation)
and cold-spawn tax's true per-run size (correctly ~46-51 s across all three
of the spec's named spawn sites, not the ~21-24 s `setup.health`-only figure
first reported) — which, once W3 ships, becomes the next-largest per-run
cost worth scoping.
