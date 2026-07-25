# Follow-ups

Known issues and deferred work, with the evidence behind each. Recorded here
rather than in an issue tracker so the reasoning travels with the code.

Each entry states what the problem is, why it was not fixed at the time, and
what would resolve it. Entries are removed when fixed, not marked done.

---

## 1. `setup.harness` fix landed; re-measurement pending

**Where:** `src/container/bc-container-provider.ts:1479` (`ensureTestHarness`)

Commit `43dcabe8` refactored the test-harness presence probes to run
**concurrently through the warm session slot**, eliminating the serial cold-spawn
overhead that was consuming ~26.5 s per bench run. The steady-state path (all
three containers already have the harness) is now expected to complete in ~4 s
instead of ~26 s.

The fix is confirmed in code. A follow-up measurement bench run (Task 6) will
verify the wall-time improvement, once the benchmark can be executed.

---

## 2. Catalog fallback in `validateModel` trusts rows with no re-verification

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
