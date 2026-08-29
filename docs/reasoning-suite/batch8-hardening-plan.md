# Batch 8 hardening plan: composites, higher-order defects, T4 harvest

Written 2026-08-28, after build batch 7 validated the revision-3 gates.
This is the resume point for the next build session. It operationalizes
`hardness-strategy.md` items 3 (multi-location coordinated defects), 4
(stubborn-mutant mining), and the composite program's second half, under
the gates `hardening-pipeline.md` defines and batch 7 exercised. Rulings
adopted while executing this plan go to `decisions.md` as usual.

Standing constraints carried in: no re-bench recommendation until the set
completes; B4/C1 solver legs run outside the authoring family (gpt-5.5 +
claude-opus-4.8 via pi, single-shot rendered prompt via
`scratch/render-diagnose-prompt.ts`); LethAL runs on **Cronus28 only**
(stale "LethAL Sandbox App" on Cronus281 collides at object 79197),
always with `-StopHungSessions`, and re-preps must bump the app version
past the container's remembered ExtensionDataVersion.

## W1 - Composite batch 2 (X141-X145, the last five category-3 slots)

Entry 12 ratified the assembly model and named the two levers this batch
must pull (X097 was solved in under a minute without them): **vaguer
symptom wording and bigger donor sets**. This plan adds the third, the
T3 entanglement gate, which batch 1 deliberately deferred.

**Assembly model amendment to ratify at build time: verbatim donors +
authored glue.** Pure verbatim assembly produces coupling-zero
distractors (donor modules share no tables), which is exactly the
X096-batch-1 shape T3 rejects for this batch. Each composite therefore
adds a SMALL authored integration seam - one glue codeunit and/or table
from the composite's own id block - that wires at least one distractor
module onto the live symptom's data flow (the distractor reports over,
subscribes to, or feeds the symptom module's tables). Rules:

- Glue is defect-free, minimal, and gets its own oracle tests (its
  behavior is part of the must-not-change contract).
- The entanglement is verified MECHANICALLY before probing: `alsem query
  touches` + call hierarchy over the merged starter must show the
  distractor on the symptom's data-flow path (T3's coupling verdict).
  A composite where every distractor is coupling-zero does not ship.
- Everything else follows entry 12 verbatim: symptom parts contribute
  donor STARTER code, distractors donor CORRECT code, ids/names kept,
  merged oracle in one fresh test codeunit, healthy-module framing
  convention, companion renaming.

**Symptom wording (the X097 lesson + hardness-strategy item 6).** Stay
PRECISE about behavior, VAGUE about location: report the symptom at the
merged-product level, observed 2-3 objects downstream of the defect,
with the reproduction conditional on a data shape (RIPR-style). Never
scope it to a module or procedure. The B6a auditor checks the
description issues no per-module innocence verdicts (audited out in
batch 1) and no free elimination.

**Donor sets (proposals - re-verify each donor's gate status at
assembly; 35 fresh donors X101-X140 are now available).** 1-2 live
symptoms each, 3-5 distractor modules, at least two composites past 10k
prompt tokens:

| Task | Theme | Candidate donors | Live symptom |
|---|---|---|---|
| X141 | Posting backbone | X110 rerun-duplicates, X135 lifecycle, X137 retry-skips, X101 running-balance | X137 or X110 |
| X142 | Pricing/allocation | X140 residual, X118 two-leg, X123 calcsums-perf, X126 | X140 |
| X143 | Display/reporting perf | X133 event-resolved columns, X134 portal loader, X113 existence-checks, X109 findlast-key | X133 or X134 |
| X144 | Import/validation | X131 collect flood, X138 normalization, X132 twin guard, X102 | X131 or X138 |
| X145 | Master data/eventing | X107 stamp, X121 refresh, X128 cross-company, X139 transfer branch | X139 or X107 |

Known property (entry 12): donor/composite score correlation in one
bench run is the packaging axis, not contamination. Note that X131-X140
live symptoms were just C1-solved single-shot in isolation - what these
composites measure is precisely whether packaging + entanglement +
vague wording buys back resistance. That makes batch 8 a MEASUREMENT of
the merging lever, not just five more tasks: record per-composite C1
verdicts against the donors' known standalone verdicts.

**Gate flow** = batch 7's, unchanged: min-diff (per live symptom), alsem
prior + T3 coupling check, B1, B1b (gold-ci replay), B2 on two
containers, B4 (both outside-family solvers; author-second-impl fallback
only if both fail), B6a audit groups, B7 LethAL sweep post-promote +
B6b triage, C0 provenance, C1 verdict recorded. Composites that get
solved still ship (category-3 slots, mid-tier anchors); C1 all-fail is
what earns hard tier.

Id blocks: donors keep their ids; glue + oracle per composite from
X141: 71010-71039, X142: 71040-71069, X143: 71070-71099, X144:
71100-71129 (**collision check first: 71130/71131 are committed H-task
ids**), X145: 71140-71169 (**same: 71140/71141 committed** - run
`deno task id-audit` after scaffolding and shift blocks if needed; all
blocks stay <= 74999).

## W2 - Higher-order-defect pilot (X146, one task, category-1 slot)

The SWE-smith Combine result (hardness-strategy item 3) at diagnose-task
scale: TWO validated defects in one app whose manifestations interact -
defect B masks or entangles defect A's symptom, so the natural fix of
the obvious defect makes the hidden one's symptom APPEAR, and a model
that stops at one fix fails tests it did not expect. Pilot exactly ONE
task: the gate adaptations below are unproven, and gate gaps are cheap
at n=1 (the batch-7 lesson at n=10).

Source the pair from the validated inventory: two donors whose data
flows already intersect (e.g. an accumulator-reset defect feeding an
allocation defect, or a filter-scope defect upstream of a perf defect),
re-authored into ONE fresh app (not verbatim donors - the interaction
is the design). Alternative source: a stubborn-mutant PAIR from W3.

Gate adaptations (to ratify as a decisions entry with the pilot):

- **Min-diff rule**: "single-cause" becomes "exactly two documented
  causes"; the starter-to-correct diff must decompose into two disjoint
  hunks, each independently mapped to its defect in NOTES.md.
- **Probe**: four legs instead of two - correct passes; starter fails;
  fix-A-only fails (reaching assertions); fix-B-only fails. The two
  half-fixed apps are authored alongside starter/ and correct/ and
  probed via `trap-probe --solution ... --expect fail`. This is the
  masking proof: if fix-A-only PASSES, the second defect is dead weight
  and the task collapses to single-defect.
- **B7**: sweep runs against correct/ as usual, plus one sweep against
  each half-fixed app to confirm the oracle sees each defect
  independently.
- **C1**: classify partial fixes explicitly (fixed A only / B only /
  both / neither) - the partial-fix rate is the pilot's measurement.

Description states ONE symptom (the masked compound observation), never
two bug reports. Difficulty must come from the interaction, not from
underspecification - B4/B6a police that line exactly as in batch 7.

## W3 - T4 stubborn-mutant harvest (supply line, not batch content)

Run LethAL against a REAL module with its REAL test suite
(tooling-plan.md T4). Survivors of a production-grade suite are
reality-camouflaged defects - manufactured hardness with a built-in
validity argument. This feeds batches 9-10 (and W2 pairs); it promotes
nothing itself.

1. **Operator decision RESOLVED (2026-08-28): use BOTH repos.**
   - `u:\Git\DO.Support-NewFormat\` - Continia Document Output
     (`DocumentOutput/` with Cloud/OnPrem source + Test/TestFR suites).
     Proprietary, never in training corpora: the purest camouflage
     signal. Re-authoring is mandatory for licensing regardless.
   - `u:\Git\BC.History\` - Microsoft base-app modules as per-module
     `Source/` + `Test/` pairs (e.g. BankDeposits). The strongest
     survived-good-tests bar; training exposure is irrelevant since
     only re-authored tasks ship.
   Start with ONE module per repo (pick by test-to-source ratio and a
   compile check against Cronus28 symbols) to learn LethAL's limits on
   real-scale code before widening - real modules are far bigger than
   the diagnose apps the batch-7 sweeps ran on. Two repos also give two
   independent survivor populations with different code styles, which
   the suite currently lacks.

   **Module scan (2026-08-28).** DO: DocumentOutput has Cloud (553 .al)
   + OnPrem (14) source with a 111-file Test suite - scope the first
   run to one Cloud submodule at harvest time. BC.History by test/source
   file counts: BaseApp 1600/8020 and System 409/1309 (too big first),
   APIV2 69/126 (best ratio, but API plumbing), EDocument 42/332
   (rich logic, big), VATGroupManagement 9/51 (compact logic).
   First-bite picks: **VATGroupManagement** (BC.History, small enough
   to learn LethAL's real-code limits) then **EDocument** for the real
   harvest; DO submodule chosen after inspecting Cloud/'s layout.

   **First-round results (2026-08-29, two bites attempted).** The
   harvest PIPELINE is validated end to end - id-shifted clone builds
   (incl. tableextension FIELD ids), permissionset renames (names are a
   GLOBAL namespace; plain permissionsets cap at 20 chars), shipped
   first-party app uninstall/reinstall (reversible; tableextension
   field names are table-scoped-global), the LethAL selector band
   (79150-79250) added to the clone's idRanges, publish via dev
   endpoint, LethAL run + quarantine recovery. What blocked BOTH bites
   is SUITE compatibility, not tooling:
   - VATGroupManagement: 76 of 78 tests wedge LethAL's fenced session
     as in-flight-unknown quarantines - TestPage-driving tests and
     app-side live-HTTP tests (TestFailureInSend fires the app's real
     HttpClient). Exactly the two things CG oracle rules ban.
   - SAF-T: publishes and runs clean, headless-audited, but 11 of 22
     baseline tests (every export-pipeline test) fail red on the clone
     - first-party format-registration wiring the clone does not
     reproduce - leaving 2239 of 2243 mutants no-coverage. LethAL's
     validity block correctly reports the run as degraded; no failure
     text is relayed for baseline reds, so each hypothesis costs a
     container cycle. Stopped rather than blind-debug.
   **Conclusion for the next round:** BC.History first-party clones are
   the WRONG substrate - the collision surgery is solvable but the
   in-container framework wiring is not worth reproducing. DO
   (Continia) is a genuine third-party app: own id ranges, own
   permission sets, installable beside everything with NO clone surgery
   - only the headless-suite criterion applies (grep Test/ for
   TestPage + HttpClient BEFORE spending container time; also audit
   HandlerFunctions coverage, TaskScheduler branches, and
   DownloadFromStream reachability, per the SAF-T audit template).
   Layouts kept re-runnable at scratch/t4-vatgroup/ and scratch/t4-saft/
   (local); Cronus28 fully restored (VAT Group Management, SAF-T,
   SAF-T Modification DK all reinstalled, CG T4 apps uninstalled).
2. Run on Cronus28, `-StopHungSessions`, LCR-class operators preferred;
   ABS/UOI survivors deprioritized as likely-equivalent.
3. Triage survivors (mutation-triager agent): equivalent / suite hole
   (report upstream, not our problem) / **reality-camouflaged** - the
   harvest.
4. For the top 5-10 harvested mutants: wrap as diagnose drafts, bank as
   ledger rows (`source: probe:lethal-t4-<module>`), and take them
   through the normal pipeline in later batches.
   **Copy-vs-re-author boundary**: the real module and its mutants stay
   local (scratch/, gitignored) - nothing real is committed. The
   shipped draft is RE-AUTHORED per the builder brief's invented-objects
   rule: fresh domain, our names/ids, invented dependency stand-ins, no
   original comments; what is preserved EXACTLY is the defect mechanic
   and the structural context that camouflaged it (guard placement,
   infection-to-observation distance, the masking call pattern). The
   renaming is for licensing, contamination, and compilability only -
   round 4 measured it is not a difficulty lever; the hardness rides on
   the survivor's structure, and the re-authored task still earns its
   tier through the normal gates.

## Sequencing

1. W3 step 1 (operator picks the module) can happen any time; the
   harvest run is independent of W1/W2 container work - schedule it
   when composites are not probing (or on a different day).
2. W1 composites are the session's main build: assemble serially,
   pipeline probes as in batch 7 (fan B2/B4 across containers).
3. W2 pilot last, once the composite gates are green - it reuses the
   session's solver/audit machinery.
4. Exit state: 82/100 (5 composites + 1 HOM pilot), T4 candidates
   banked, three decisions entries expected (glue amendment, HOM gate
   adaptations, T4 harvest result).

## Explicitly rejected for this batch (measured, do not revisit)

- Cosmetic obfuscation / renaming / dead filler: round-4 negative
  result; al-sem prunes dead filler mechanically and so do models.
- Vague-to-the-point-of-ambiguous specs: SWE-bench Verified treats
  underspecification as a validity defect; our B4 catches it as
  identical cross-family failure (X138, X140 in batch 7).
- Grading unforced design choices (tie directions, message wording)
  to inflate failure rates: B6a/B6b rulings in batch 7 are precedent.
