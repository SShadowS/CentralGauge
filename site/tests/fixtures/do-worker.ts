// Thin test-only worker entrypoint that re-exports the DO class so miniflare
// can resolve it by name during vitest runs. Also routes /api/v1/events/live
// to the LeaderboardBroadcaster DO so SELF.fetch() works for SSE route tests.
export { LeaderboardBroadcaster } from '../../src/do/leaderboard-broadcaster';

export default {
  async fetch(
    request: Request,
    env: { LEADERBOARD_BROADCASTER: DurableObjectNamespace },
  ): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api/v1/events/live' && request.method === 'GET') {
      const id = env.LEADERBOARD_BROADCASTER.idFromName('leaderboard');
      const stub = env.LEADERBOARD_BROADCASTER.get(id);
      return stub.fetch(
        new Request('https://do/subscribe', {
          method: 'GET',
          signal: request.signal,
        }),
      );
    }
    return new Response('ok');
  },
};
