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
  // Drain the body before returning. Required by workerd's RPC/storage
  // bookkeeping: an undrained Response held across the RPC boundary keeps
  // the DO storage stack frame open, which breaks vitest-pool-workers'
  // isolated-storage assertion on test teardown and (in production)
  // delays GC of the underlying connection.
  await res.arrayBuffer();
  return res.ok;
}
