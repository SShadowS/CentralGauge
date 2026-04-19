export type { BroadcastEvent } from '../../do/leaderboard-broadcaster';
import type { BroadcastEvent } from '../../do/leaderboard-broadcaster';

export async function broadcastEvent(
  env: { LEADERBOARD_BROADCASTER: DurableObjectNamespace },
  ev: BroadcastEvent,
): Promise<boolean> {
  const id = env.LEADERBOARD_BROADCASTER.idFromName('leaderboard');
  const stub = env.LEADERBOARD_BROADCASTER.get(id);
  const res = await stub.fetch('https://do/broadcast', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(ev),
  });
  return res.ok;
}
