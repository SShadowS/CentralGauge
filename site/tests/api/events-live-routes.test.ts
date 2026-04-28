import { env } from 'cloudflare:test';
import { afterAll, describe, it, expect } from 'vitest';
import { broadcastEvent } from '../../src/lib/server/broadcaster';

// -------------------------------------------------------------------------
// miniflare/workerd buffers SSE response bodies, so stub.fetch() on
// /subscribe hangs indefinitely (see tests/api/events-live.test.ts for
// the full caveat). To exercise route filtering end-to-end without
// hitting that wall, we use a test-only DO endpoint `/test-match` which
// runs the SAME parseRoutesParam + matchesClient pipeline as /subscribe
// but returns the matched-buffer set as JSON.
// -------------------------------------------------------------------------

describe('LeaderboardBroadcaster route filtering', () => {
  afterAll(async () => {
    const id = env.LEADERBOARD_BROADCASTER.idFromName('leaderboard');
    const stub = env.LEADERBOARD_BROADCASTER.get(id);
    await stub.fetch('https://do/reset', { method: 'POST', headers: { 'x-test-only': '1' } });
  });

  async function matchedFor(routesParam?: string): Promise<Array<{ run_id?: string }>> {
    const id = env.LEADERBOARD_BROADCASTER.idFromName('leaderboard');
    const stub = env.LEADERBOARD_BROADCASTER.get(id);
    const url = routesParam
      ? `https://do/test-match?routes=${encodeURIComponent(routesParam)}`
      : 'https://do/test-match';
    const res = await stub.fetch(url, { method: 'GET', headers: { 'x-test-only': '1' } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { events: Array<{ run_id?: string }> };
    return body.events;
  }

  it('default subscriber (no routes param) receives all events', async () => {
    await broadcastEvent(env, {
      type: 'run_finalized',
      ts: new Date().toISOString(),
      run_id: 'r-default-1',
      model_slug: 'sonnet-4-7',
      family_slug: 'claude',
    });
    const events = await matchedFor();
    expect(events.some((e) => e.run_id === 'r-default-1')).toBe(true);
  });

  it('subscriber listing /leaderboard receives a run_finalized event', async () => {
    await broadcastEvent(env, {
      type: 'run_finalized',
      ts: new Date().toISOString(),
      run_id: 'r-lb-1',
      model_slug: 'sonnet-4-7',
      family_slug: 'claude',
    });
    const events = await matchedFor('/leaderboard');
    expect(events.some((e) => e.run_id === 'r-lb-1')).toBe(true);
  });

  it('subscriber listing /models/gpt-5 does NOT receive run_finalized for sonnet-4-7', async () => {
    await broadcastEvent(env, {
      type: 'run_finalized',
      ts: new Date().toISOString(),
      run_id: 'r-fil-1',
      model_slug: 'sonnet-4-7',
      family_slug: 'claude',
    });
    const events = await matchedFor('/models/gpt-5');
    // The event should NOT appear (filtered out at the DO).
    expect(events.some((e) => e.run_id === 'r-fil-1')).toBe(false);
  });

  it('subscriber listing /models/sonnet-4-7 receives the matching run_finalized', async () => {
    await broadcastEvent(env, {
      type: 'run_finalized',
      ts: new Date().toISOString(),
      run_id: 'r-match-1',
      model_slug: 'sonnet-4-7',
      family_slug: 'claude',
    });
    const events = await matchedFor('/models/sonnet-4-7');
    expect(events.some((e) => e.run_id === 'r-match-1')).toBe(true);
  });

  it('forbids /test-match without x-test-only header', async () => {
    const id = env.LEADERBOARD_BROADCASTER.idFromName('leaderboard');
    const stub = env.LEADERBOARD_BROADCASTER.get(id);
    const res = await stub.fetch('https://do/test-match');
    expect(res.status).toBe(403);
  });
});
