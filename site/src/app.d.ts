declare global {
  namespace App {
    interface Locals {}
    interface PageData {}
    interface PageState {}
    interface Platform {
      env: {
        DB: D1Database;
        BLOBS: R2Bucket;
        CACHE: KVNamespace;
        LEADERBOARD_BROADCASTER: DurableObjectNamespace;
      TEST_MIGRATIONS?: unknown;
      };
      context: { waitUntil(promise: Promise<unknown>): void };
      caches: CacheStorage & { default: Cache };
    }
  }
}
export {};
