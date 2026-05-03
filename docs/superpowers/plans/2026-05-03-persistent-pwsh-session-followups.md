# Persistent PowerShell Session — Post-Merge Follow-ups

Outstanding Important issues from the final code review of the persistent-pwsh-session implementation (commits `77054f3..70b2f4e`). All non-blocking; bench works correctly today, but each item improves long-term maintainability or robustness.

## I3 — Replace `Deno.env.set` CLI bridge with registry options

**Files:** `cli/commands/bench-command.ts:204-206`, `src/container/bc-container-provider.ts:112`, `src/container/registry.ts:21`

The `--no-persistent-pwsh` flag currently propagates to `BcContainerProvider` by mutating `CENTRALGAUGE_PWSH_PERSISTENT` in `Deno.env` from the bench action handler. This works because the registry defers factory invocation, but:

- Order-dependent — anything reading the env var at module load wins the race.
- Pollutes process env for any subprocess the bench spawns.
- Leaks across invocations in long-lived Deno processes (`cycle` chaining `bench`).

**Fix:** Extend `ContainerProviderRegistry.create()` to accept options and forward to `BcContainerProvider({ persistentPwsh })` directly. ~20 LOC + `tests/unit/container/registry.test.ts` update.

## I4 — Document `maybeRecycleSession` concurrency invariant

**Files:** `src/parallel/compile-queue.ts:425`, `src/container/bc-container-provider.ts:152`

Compile-queue calls `maybeRecycleSession` outside the `testMutex`. The "no concurrent execute on the session" guarantee depends on `processQueue` being a single consumer per container — true today by construction. If the queue is ever split (separate compile vs test queues on the same container), a recycle could land mid-execute and the session would die unnecessarily.

**Fix (cheap):** JSDoc invariant on `maybeRecycleSession` documenting the caller contract.
**Fix (stronger):** Move the recycle call inside the `releaseTest()` finally block while still holding the mutex.

Cheap fix is sufficient unless queue splitting is on the roadmap.

## S1 — Replace `as any` test pre-injection with end-to-end mock

**Files:** `tests/unit/container/bc-container-provider.test.ts:1434-1437`, `:1473-1487`

The runTests/compileProject routing tests bypass `getOrCreateSession` by setting `(session as any)._state = "idle"` and pre-injecting into `(provider as any).sessions`. Four `as any` casts in one test couple to private fields TypeScript can't protect.

**Fix:** Use the same end-to-end pattern as the pwsh-session unit tests — construct via `sessionFactory`, drive bootstrap by emitting a marker matching the stdin token, then emit the runTests script's marker. ~30 LOC change per test, zero casts.

---

## Bundling

All three touch overlapping files. A single PR addressing them is cleaner than three separate ones. Estimated effort: 2–3 hours including test updates.
