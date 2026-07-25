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
