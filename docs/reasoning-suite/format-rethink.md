# Rethinking the bar or the format (operator ruling 2026-08-29)

The ≤50% launch bar cannot be met by building more tasks of the kinds we
know how to build. This document holds the measurements that killed the
build-more path, the ones that constrain the alternatives, and the
options that survive them.

## What the measurements say

**1. Opus 5 is saturated on this suite, on every metric we have.**
Uncapped (`--max-tokens 64000`, largest attempt 19,887 tokens, so no
truncation anywhere):

| metric | Opus 5 |
|---|---|
| pass@1 | 102 / 110 = **92.7%** |
| best-of-2 | 106 / 110 = **96.4%** |

Moving the bar from best-of-2 to pass@1 buys 3.7 points. It does not
approach 50. **The bar is not the problem.**

**2. No category holds signal either.** Per-category, Opus 5:

| category | n | pass@1 | pass@2 | fail |
|---|---|---|---|---|
| business-logic | 41 | 39 | 1 | 1 |
| performance-diagnosis | 24 | 19 | 3 | 2 |
| error-transactions | 12 | 12 | 0 | 0 |
| interfaces-events | 10 | 10 | 0 | 0 |
| records-runtime | 9 | 9 | 0 | 0 |
| integration-serialization | 7 | 7 | 0 | 0 |
| rounding-allocation | 6 | 5 | 0 | 1 |
| data-modeling | 1 | 1 | 0 | 0 |

Five of eight categories are 100% first-try. The best category
(performance-diagnosis, 79% pass@1) is exactly the family whose oracles
grade something the model cannot verify by reading its own code. A
per-category floor is not a viable bar shape either.

**3. Only four tasks in 110 resist, and they share one property.**
X074, X140, X169, X173. Not a shared category - a shared oracle
property: **the graded contract is not checkable by inspection.** SQL
statement counts (X169, X173), a deterministic multi-partition cent
sweep (X140), a count contract on an unsaved record whose wrong answer
is merely a large number (X074). Every defect a competent reader can
settle statically - absent branch, wrong field sourced, missing
ChangeCompany, independent rounding, stale cache, permission predicate,
interface stub - Opus 5 fixes, nearly always first try.

**4. A second, exploitable reflex.** Three of the four resisters failed
attempt 2 by editing the ORACLE'S schema (deleting a field the test
references) rather than fixing behaviour. Given a failing measured
contract, the model reaches for the data model before the algorithm.

**5. Wave 1's yield, in that light.** Ten tasks purpose-built to resist
produced two. The eight that fell were built on levers (plain read
restructuring, allocation invariants, composite packaging) that this
re-baseline now shows never worked - their apparent resistance in the
2026-08-29 baseline was token truncation.

## What that rules out

- **Changing the metric.** 92.7% pass@1. Dead.
- **A per-category bar.** Best category 79% pass@1. Dead.
- **Building more of the same.** ~50 resistant needed, 4 in hand, best
  measured yield 20% and that on levers now known false. Dead.

## What survives, and what each costs

### A. Keep the suite, change what it is FOR
The suite is not a frontier-difficulty instrument; it may still be a
good comparative one. The launch claim becomes "ranks AL capability
across models" rather than "frontier models solve half of it". Cost:
zero build. Requires the multi-model spread to be real - the Sonnet 5 /
gpt-5.6-luna uncapped run measures exactly that, and if their scores
land near Opus's the suite does not discriminate either and this option
dies too.

### B. Change the PROMPT contract, not the tasks
Every task currently hands the model: the full source, a symptom
description, AND an explicit fix instruction. Real debugging supplies
the first two at most, often only the first plus a spec. A prompt
variant that states the CONTRACT the app must satisfy but NOT the
symptom forces the model to locate the discrepancy itself. This is a
template change plus a per-task description split (contract sentence
vs symptom sentence), not a rebuild - the oracles, references and
starters all stay. **Untested. It is the cheapest experiment with real
upside, and it should be run on ~15 already-solved tasks before
anything else is decided.**

### C. Lean the whole suite on the one property that works
Every new task grades an unverifiable-by-inspection contract - counter
budgets, swept invariants over many partitions - with the graded
contract sitting on frozen/donor tables so the schema-break reflex
hard-fails. This is what wave 2 would be under the "keep building"
path. Honest cost: at wave-1's 20% yield, ~100+ further builds, and the
yield estimate itself is optimistic because it came from a wave whose
other levers were fake.

### D. Change the FORMAT to an agentic one
`bench --agents` and the Docker sandbox already exist. A model that must
operate the container - compile, read failures, iterate - is a
materially harder and more realistic task, and it is the direction the
whole field's benchmarks have moved. Largest lift; makes the 110 tasks
a fixture library rather than the product.

## Recommended order

1. Finish the multi-model uncapped baseline (running) - it decides
   whether option A exists at all.
2. Run the option-B experiment on ~15 solved tasks. It is cheap
   (~$2, one bench run), reuses everything, and a large drop would
   change the whole picture without a single new task.
3. Only then choose between C (grind) and D (re-platform), with the
   B result in hand.
