import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { broadcastEvent } from '../src/lib/server/broadcaster';

describe('LeaderboardBroadcaster', () => {
  it('accepts events via broadcastEvent (returns true)', async () => {
    const ok = await broadcastEvent(env, {
      type: 'run_finalized',
      run_id: 'r1',
      model_slug: 'sonnet-4.7',
      score: 0.75,
      ts: new Date().toISOString(),
    });
    expect(ok).toBe(true);
  });

  it('exports BroadcastEvent with expected type literals', async () => {
    // Smoke: broadcastEvent compiles with all three known event types
    await broadcastEvent(env, { type: 'run_finalized', ts: '2026-04-19T00:00:00Z' });
    await broadcastEvent(env, { type: 'task_set_promoted', ts: '2026-04-19T00:00:00Z' });
    await broadcastEvent(env, { type: 'shortcoming_added', ts: '2026-04-19T00:00:00Z' });
  });

  it('returns buffered events via /recent for reconnecting clients', async () => {
    const id = env.LEADERBOARD_BROADCASTER.idFromName('leaderboard');
    const stub = env.LEADERBOARD_BROADCASTER.get(id);
    await stub.fetch('https://do/broadcast', {
      method: 'POST',
      body: JSON.stringify({
        type: 'run_finalized',
        run_id: 'r-recent',
        ts: new Date().toISOString(),
      }),
    });
    const res = await stub.fetch('https://do/recent?limit=10');
    const body = (await res.json()) as { events: Array<{ run_id?: string }> };
    expect(body.events.some((e) => e.run_id === 'r-recent')).toBe(true);
  });
});
