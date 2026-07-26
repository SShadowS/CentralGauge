# Follow-ups

Known issues and deferred work, with the evidence behind each. Recorded here
rather than in an issue tracker so the reasoning travels with the code.

Each entry states what the problem is, why it was not fixed at the time, and
what would resolve it. Entries are removed when fixed, not marked done.

---

## 1. Catalog fallback in `validateModel` trusts rows with no re-verification

**Where:** `src/llm/model-discovery.ts:338` (`ModelDiscoveryService.validateModel`),
`src/llm/model-catalog.ts` (`ModelCatalog`)

Commit `b1e3dbe5` made `validateModel` fall back to an exact
`site/catalog/models.yml` slug match when a provider's live discovery list
omits a model (fixing `models --check` and bench's `validateModels()`
disagreeing on `anthropic/claude-haiku-4-5`, which Anthropic's `/v1/models`
never lists even though the completion endpoint accepts it). The fallback
has no TTL and no re-verification against the live API: once a slug is in
the catalog, `ModelCatalog.isKnown()` trusts it indefinitely.

If a provider deprecates a cataloged model after it was seeded, bench's
pre-flight validation would still pass on the catalog match, and the
rejection would only surface later, mid-run, at the real `generateCode`
call, after task spend has already happened.

Left unfixed for now because the risk is bounded: catalog rows require
verified pricing at seed time (`sync-catalog --apply` / the bench auto-seed
aborts with `SEED_NO_PRICING` otherwise), so a catalog hit is not a typo or
a guess, and discovery-based validation already carries an equivalent
staleness window today (`ModelDiscoveryService`'s 24h discovery cache).

Would be resolved by either: adding a TTL to catalog-fallback hits, keyed
off a per-row timestamp, so a slug not refreshed within some age
re-validates instead of being trusted forever; or re-checking any
catalog-sourced hit against the live provider API once per bench run
(not once per model variant) so a genuinely stale catalog entry fails
pre-flight instead of failing mid-run.

---

## 2. GUID compiler-folder sweep's age guard measures the wrong mtime

**Where:** `src/container/bc-container-provider.ts:2693`
(`GUID_FOLDER_MIN_AGE_MS`, used by `clearCompilerFolders`)

The sweep that removes orphaned `--no-compiler-cache` GUID folders skips any
GUID folder younger than 30 minutes, so it doesn't delete out from under a
`trap-probe`/`bench` process still compiling into one. The age check stats
the top-level GUID folder itself. On NTFS, writing into a nested
subdirectory only updates the *immediate parent's* mtime, not every
ancestor's — and a compile writes into `<guid>/output/<name>_<uuid>`, so the
top-level folder's own mtime stops changing once that structure exists.
Verified directly on this machine:

```
root mtime after initial create:  2026-07-25T12:39:41.399Z
root mtime after nested write:    2026-07-25T12:39:41.399Z   <- unchanged
output/ mtime after nested write: 2026-07-25T12:39:42.909Z
```

So the 30-minute window actually measures time since the folder's last
*direct* child was added, not time since the build was last active. A
multi-hour overlap between `trap-probe` and `bench` — exactly the scenario
this guard exists for — can outlast the window while the build is still
running.

Left unfixed for now because the guard is still strictly safer than the
unconditional delete it replaced, this sweep only runs on the diagnostic
`--no-compiler-cache` path, and a conservative skip in the worst case costs
a stale orphan the next sweep collects — never a live folder.

Would be resolved by stating the folder's age from the max mtime across its
immediate children (or by statting `output/` directly) instead of the
top-level folder alone.

---

## 3. `centralgauge task probe` leaves its last-probed candidate published

**Where:** `src/workbench/probe.ts` (`probeDraft`), `scripts/trap-probe.ts`

`probeDraft` runs `trap-probe` twice per draft — once against `correct/`
(`--expect pass`), once against `naive/` (`--expect fail`). Each run
publishes its solution as the candidate app via
`BcContainerProvider.prepareCandidateApp`, which cleans up any STALE prior
candidate before publishing the new one. Nothing unpublishes the candidate
after the *final* call, though — there is no equivalent of the bench's
`endOfRunNuke` in this path. Confirmed directly during the task workbench
Phase 1 Task 6 container smoke test: after probing `CG-AL-X053` on
Cronus28, `BcContainerProvider.cleanupStaleCandidates("Cronus28")` found
and removed one stale candidate (`CG-AL-X053 Smoke Solution v1.0.0.0`,
the `naive/` solution probed last).

CLAUDE.md documents that all candidates share one fixed app id, so a
stale published candidate can block a subsequent ad-hoc publish with a
"same App ID and Version" conflict. The bench's startup prenuke
(`endOfRunNuke`, `cli/commands/bench/container-setup.ts`) clears this
automatically before the next bench run, so a later bench self-heals. But
`run-xiterate.ps1`'s sanity lane runs `trap-probe` directly, ad hoc,
between bench runs — exactly the kind of standalone publish that can hit
the stale candidate before any bench-level cleanup gets a chance to run.

Left unfixed for now because it was found by the Task 6 end-to-end smoke
after the rest of the workbench branch was already fully verified; it
self-heals on the next bench's prenuke; and fixing it means touching
`probe.ts`/`trap-probe.ts` and another implement-and-review cycle the
branch does not need for this.

Would be resolved by having `probeDraft` (or `trap-probe.ts`) unpublish
the candidate after the final probe call, or by routing both probe calls
through the same prepare-and-cleanup-at-both-ends path the bench itself
uses.

---

## 4. SOAP test harness unavailable to a standalone `task probe` run

**Where:** `scripts/trap-probe.ts`, `mcp/al-tools-server.ts`
(`handleAlVerify` → `runTests`), `BcContainerProvider.ensureTestHarness()`

A standalone `task probe` (or hand-run `trap-probe.ts`) invocation never
goes through the bench's startup path that calls `ensureTestHarness()` to
compile+publish the SOAP test-harness app (`CG Test Harness` / codeunit
`CGTestRunner`) once per container. If that harness is not already
installed on the target container from a prior bench run, every test run
inside the probe silently falls back to the slower legacy client-session
test path (`.claude/rules/soap-test-harness.md` documents the SOAP path
as ~38x faster). Confirmed directly during the Task 6 smoke test: both
probe calls against Cronus28 logged `SOAP harness path failed; falling
back to client-session path (error="harness SOAP fault: Service
"Codeunit/CGTestRunner" was not found!")`, and completed correctly via
the fallback but paid the slower path (the two-solution probe took ~260s
total).

Correctness is unaffected — the fallback is automatic and silent — so
this is a performance gap only, and needlessly slows `task probe` runs
whenever a container has not recently run a full bench.

Left unfixed for now for the same reason as #3: correct behavior
already, just slower; fixing it means either having `task probe` call
`ensureTestHarness()` itself or documenting the prerequisite, another
change + review cycle the branch does not need right now.

Would be resolved by having `probeDraft`/`trap-probe.ts` call
`ensureTestHarness()` before running probes (mirroring what the bench
does at startup), or by documenting in `task probe`'s help/output that
the target container should have had at least one full bench run against
it first.
