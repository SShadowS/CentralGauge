---
name: premise-probe
description: Measure a BC platform-semantics premise on a real container BEFORE spending a task build slot on it. Use whenever a candidate task, volotest, or design hinges on a platform behavior claim (Variant probes, cache behavior, event persistence, permission semantics, collection sharing, key ordering) that has not already been measured in docs/reasoning-suite/decisions.md.
---

# Premise probe

Decisions.md entry 13 rules that platform-semantics premises MUST be
probed before a build slot is spent: two of build-batch-4's ten slots
burned full build+probe cycles on stale volotest claims that a 2-minute
probe would have killed.

## Before probing

1. Check `docs/reasoning-suite/decisions.md` - the fact may already be
   measured (entries 8, 10, 11, 13 carry the current catalog: SQL
   counters, TestPermissions, NST cache nuances, Variant exactness,
   List sharing/Clear-rebind, key-order FindFirst, same-session lost
   update, write-inside-try scoping, non-short-circuit booleans).
2. State the premise as a falsifiable claim ("IsCode payloads also
   answer IsText true") and decide what output settles it.

## Procedure

1. Create `scratch/probe-<slug>/correct/` with:
   - `app.json` from [templates/probe-app.json](templates/probe-app.json),
     with a UNIQUE id (pattern `a1b2c3d4-0fNN-0000-0000-0000000000NN`,
     bump NN past existing scratch/probe-*/ dirs) and a matching name.
   - A test codeunit from
     [templates/ProbeSkeleton.Test.al](templates/ProbeSkeleton.Test.al):
     pick an unused id in 80090-80099 (check other probe dirs), and
     report measurements via `Error('RESULTS-%1', ...)` - the probe
     HARNESS reads results from failure text, so every probe test ends
     in Error, never a passing assert.
   - Any tables the probe needs (id 70090-70099 band, same uniqueness
     check).
2. Run it (Cronus28 default; no bench may be live):

   ```bash
   deno run -A scratch/premise-probe-runner.ts \
     --solution scratch/probe-<slug>/correct \
     --testFile scratch/probe-<slug>/correct/<File>.Test.al \
     --codeunit <id>
   ```

3. Read the `RESULTS-` lines from the failure output. They ARE the
   measurement.
4. Record the fact in `docs/reasoning-suite/decisions.md` (append-only,
   next entry number): claim, measured answer, probe path, date,
   container/BC version, and the consequence for task design. Keep the
   probe dir re-runnable - never delete it.
5. If the premise died, reject the candidate in
   `docs/reasoning-suite/ledger.md` with the measured reason.

## Design notes

- One probe = one claim family. Matrix-style tests (loop the cases,
  concatenate into one RESULTS string) beat one-test-per-case.
- Timing/counter premises follow decisions entry 8's recipe: seed, one
  warm-up call, snapshot `SessionInformation.SqlStatementsExecuted` /
  `.SqlRowsRead` (BigInteger locals - AreEqual is type-strict), act,
  report deltas.
- Permission premises need `TestPermissions = Restrictive` plus
  `Library - Lower Permissions.PushPermissionSetWithoutDefaults(...)`
  as the first statement (decisions entry 11) - bare Restrictive
  grants nothing.
- Cache premises: repeat IDENTICAL reads are served free; distinct-key
  Gets and per-row filtered FindSets are not; `SelectLatestVersion()`
  flushes; a write to a DIFFERENT row does not invalidate (entries 8
  and 11).
