/**
 * SSE client hook. Opens an EventSource with `?routes=` for server-side
 * filtering (see src/lib/server/sse-routes.ts), exposes a REACTIVE status
 * rune (file extension `.svelte.ts` enables the `$state` compile-time
 * transform), an `on(type, handler)` listener registry, and `dispose()`
 * for deterministic teardown. Reconnects with 1s/3s/10s exponential
 * backoff after `error`; after 3 failed attempts status latches to
 * 'disconnected'.
 *
 * Use inside `$effect`:
 *
 *   $effect(() => {
 *     const sse = useEventSource(['/']);
 *     const off = sse.on('run_finalized', () => invalidate('app:leaderboard'));
 *     return () => { off(); sse.dispose(); };
 *   });
 *
 * Reactivity contract: `handle.status` is backed by `$state`, so consumers
 * that read it inside `$effect` (or `$derived`) re-run when the status
 * transitions. The previous "plain object getter" pattern compiled but
 * silently lost reactivity; consumers wouldn't see status changes
 * propagate to the UI (e.g. `<LiveStatus>`'s text would stay at
 * 'connecting' forever).
 *
 * Two effects vs one: the lifetime of the SSE handle is tied to the
 * effect, but the handler set may rotate independently if the consumer
 * unsubscribes mid-stream — `on(...)` returns an `unsubscribe` so handler
 * lifetimes can be coarser than the SSE lifetime. Don't combine.
 */

const RETRY_DELAYS_MS = [1000, 3000, 10_000];

export type EventSourceStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

export interface EventSourceHandle {
  readonly status: EventSourceStatus;
  on(type: string, handler: (ev: MessageEvent) => void): () => void;
  dispose(): void;
}

interface InternalState {
  attempt: number;
  disposed: boolean;
  source: EventSource | null;
  retryTimer: ReturnType<typeof setTimeout> | null;
  handlers: Map<string, Set<(ev: MessageEvent) => void>>;
}

export function useEventSource(routes: string[], opts: { url?: string } = {}): EventSourceHandle {
  const baseUrl = opts.url ?? '/api/v1/events/live';
  const routeParam = encodeURIComponent(routes.join(','));
  const fullUrl = `${baseUrl}?routes=${routeParam}`;

  // Reactive status — $state is a compile-time transform that requires
  // the .svelte.ts file extension. Reads via the getter below pick up
  // every transition.
  let status = $state<EventSourceStatus>('connecting');

  const state: InternalState = {
    attempt: 0,
    disposed: false,
    source: null,
    retryTimer: null,
    handlers: new Map(),
  };

  function open() {
    if (state.disposed) return;
    const es = new EventSource(fullUrl);
    state.source = es;

    es.onopen = () => {
      if (state.disposed) return;
      status = 'connected';
      state.attempt = 0;   // reset on successful open
    };

    es.onerror = () => {
      if (state.disposed) return;
      es.close();
      state.source = null;
      if (state.attempt >= RETRY_DELAYS_MS.length) {
        status = 'disconnected';
        return;
      }
      status = 'reconnecting';
      const delay = RETRY_DELAYS_MS[state.attempt];
      state.attempt += 1;
      state.retryTimer = setTimeout(open, delay);
    };

    // Re-attach all known handlers on every (re-)open so reconnection
    // doesn't lose subscriptions.
    for (const [type, set] of state.handlers) {
      for (const handler of set) {
        es.addEventListener(type, handler as EventListener);
      }
    }
  }

  function on(type: string, handler: (ev: MessageEvent) => void): () => void {
    const set = state.handlers.get(type) ?? new Set();
    set.add(handler);
    state.handlers.set(type, set);
    state.source?.addEventListener(type, handler as EventListener);
    return () => {
      set.delete(handler);
      state.source?.removeEventListener(type, handler as EventListener);
    };
  }

  function dispose() {
    state.disposed = true;
    if (state.retryTimer !== null) clearTimeout(state.retryTimer);
    state.source?.close();
    state.source = null;
    state.handlers.clear();
    status = 'disconnected';
  }

  open();

  return {
    get status() { return status; },
    on,
    dispose,
  };
}
