// Thin test-only worker entrypoint that re-exports the DO class so miniflare
// can resolve it by name during vitest runs.
export { LeaderboardBroadcaster } from '../../src/do/leaderboard-broadcaster';

export default {
  fetch() {
    return new Response('ok');
  },
};
