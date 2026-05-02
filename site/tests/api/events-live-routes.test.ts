import { env, runInDurableObject } from "cloudflare:test";
import { afterAll, describe, expect, it } from "vitest";
import { broadcastEvent } from "../../src/lib/server/broadcaster";
import type {
  BroadcastEvent,
  LeaderboardBroadcaster,
} from "../../src/do/leaderboard-broadcaster";

// -------------------------------------------------------------------------
// miniflare/workerd buffers SSE response bodies, so stub.fetch() on
// /subscribe hangs indefinitely (see tests/api/events-live.test.ts for
// the full caveat). To exercise route filtering end-to-end without
// hitting that wall, we use a test-only DO endpoint `/test-match` which
// runs the SAME parseRoutesParam + matchesClient pipeline as /subscribe
// but returns the matched-buffer set as JSON.
// -------------------------------------------------------------------------

describe("LeaderboardBroadcaster route filtering", () => {
  afterAll(async () => {
    const id = env.LEADERBOARD_BROADCASTER.idFromName("leaderboard");
    const stub = env.LEADERBOARD_BROADCASTER.get(id);
    await stub.fetch("https://do/reset", {
      method: "POST",
      headers: { "x-test-only": "1" },
    });
  });

  async function matchedFor(
    routesParam?: string,
  ): Promise<Array<{ run_id?: string }>> {
    const id = env.LEADERBOARD_BROADCASTER.idFromName("leaderboard");
    const stub = env.LEADERBOARD_BROADCASTER.get(id);
    const url = routesParam
      ? `https://do/test-match?routes=${encodeURIComponent(routesParam)}`
      : "https://do/test-match";
    const res = await stub.fetch(url, {
      method: "GET",
      headers: { "x-test-only": "1" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { events: Array<{ run_id?: string }> };
    return body.events;
  }

  it("default subscriber (no routes param) receives all events", async () => {
    await broadcastEvent(env, {
      type: "run_finalized",
      ts: new Date().toISOString(),
      run_id: "r-default-1",
      model_slug: "sonnet-4-7",
      family_slug: "claude",
    });
    const events = await matchedFor();
    expect(events.some((e) => e.run_id === "r-default-1")).toBe(true);
  });

  it("subscriber listing / receives a run_finalized event", async () => {
    await broadcastEvent(env, {
      type: "run_finalized",
      ts: new Date().toISOString(),
      run_id: "r-lb-1",
      model_slug: "sonnet-4-7",
      family_slug: "claude",
    });
    const events = await matchedFor("/");
    expect(events.some((e) => e.run_id === "r-lb-1")).toBe(true);
  });

  it("subscriber listing /models/gpt-5 does NOT receive run_finalized for sonnet-4-7", async () => {
    await broadcastEvent(env, {
      type: "run_finalized",
      ts: new Date().toISOString(),
      run_id: "r-fil-1",
      model_slug: "sonnet-4-7",
      family_slug: "claude",
    });
    const events = await matchedFor("/models/gpt-5");
    // The event should NOT appear (filtered out at the DO).
    expect(events.some((e) => e.run_id === "r-fil-1")).toBe(false);
  });

  it("subscriber listing /models/sonnet-4-7 receives the matching run_finalized", async () => {
    await broadcastEvent(env, {
      type: "run_finalized",
      ts: new Date().toISOString(),
      run_id: "r-match-1",
      model_slug: "sonnet-4-7",
      family_slug: "claude",
    });
    const events = await matchedFor("/models/sonnet-4-7");
    expect(events.some((e) => e.run_id === "r-match-1")).toBe(true);
  });

  it("forbids /test-match without x-test-only header", async () => {
    const id = env.LEADERBOARD_BROADCASTER.idFromName("leaderboard");
    const stub = env.LEADERBOARD_BROADCASTER.get(id);
    const res = await stub.fetch("https://do/test-match");
    expect(res.status).toBe(403);
  });

  it("recent buffer is written to state.storage and survives in-memory wipe", async () => {
    // `cloudflare:test`'s `env.X.get(id)` always returns a stub backed by the
    // SAME singleton DO instance for a given id within a test run — there is
    // no per-`get()` isolation, so the original two-stub pattern was a no-op
    // (it asserted only that the *in-memory* `recent` survived within a
    // single instance lifecycle, which is trivially true).
    //
    // miniflare/vitest-pool-workers does NOT simulate hibernation; we cannot
    // force the constructor to re-run. Instead, we exercise the persistence
    // path directly via `runInDurableObject`:
    //   1. Broadcast → assert `state.storage.get('recent')` contains the event.
    //   2. Wipe `instance.recent = []` (simulates the in-memory drop that
    //      hibernation would cause) → assert storage is still intact.
    //   3. Trust by static inspection that the constructor's
    //      `state.storage.get(RECENT_STORAGE_KEY)` restore will repopulate
    //      `recent` on the next cold start.
    const id = env.LEADERBOARD_BROADCASTER.idFromName("leaderboard");
    const stub = env.LEADERBOARD_BROADCASTER.get(id);

    await broadcastEvent(env, {
      type: "run_finalized",
      ts: new Date().toISOString(),
      run_id: "r-persist-1",
      model_slug: "sonnet-4-7",
      family_slug: "claude",
    });

    // (1) Storage write happened.
    await runInDurableObject<LeaderboardBroadcaster, void>(
      stub,
      async (_instance, state) => {
        const stored = await state.storage.get<BroadcastEvent[]>("recent");
        expect(stored).toBeDefined();
        const ids = (stored ?? []).map((e) =>
          (e as { run_id?: string }).run_id
        );
        expect(ids).toContain("r-persist-1");
      },
    );

    // (2) Wipe in-memory `recent` (hibernation analogue) — storage stays.
    await runInDurableObject<LeaderboardBroadcaster, void>(
      stub,
      async (instance, state) => {
        (instance as unknown as { recent: BroadcastEvent[] }).recent = [];
        const stored = await state.storage.get<BroadcastEvent[]>("recent");
        const ids = (stored ?? []).map((e) =>
          (e as { run_id?: string }).run_id
        );
        expect(ids).toContain("r-persist-1");
      },
    );
  });
});
