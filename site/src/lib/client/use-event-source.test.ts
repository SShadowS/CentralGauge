import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useEventSource } from './use-event-source.svelte';

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  readyState = 0;
  listeners = new Map<string, Array<(ev: MessageEvent) => void>>();
  onerror: ((ev: Event) => void) | null = null;
  onopen: ((ev: Event) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, handler: (ev: MessageEvent) => void) {
    const list = this.listeners.get(type) ?? [];
    list.push(handler);
    this.listeners.set(type, list);
  }

  removeEventListener(type: string, handler: (ev: MessageEvent) => void) {
    const list = this.listeners.get(type) ?? [];
    this.listeners.set(type, list.filter((h) => h !== handler));
  }

  dispatch(type: string, data: unknown) {
    const list = this.listeners.get(type) ?? [];
    const ev = new MessageEvent(type, { data: JSON.stringify(data) });
    for (const h of list) h(ev);
  }

  close() { this.readyState = 2; }

  static reset() { FakeEventSource.instances = []; }
}

beforeEach(() => {
  FakeEventSource.reset();
  // @ts-expect-error - jsdom global stub
  global.EventSource = FakeEventSource;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useEventSource', () => {
  it('opens an EventSource with route query param', () => {
    const h = useEventSource(['/leaderboard']);
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0].url).toContain('routes=');
    expect(FakeEventSource.instances[0].url).toContain(encodeURIComponent('/leaderboard'));
    h.dispose();
  });

  it('encodes multiple routes as a comma list', () => {
    const h = useEventSource(['/runs', '/runs/r-1']);
    const url = FakeEventSource.instances[0].url;
    expect(decodeURIComponent(url)).toContain('/runs,/runs/r-1');
    h.dispose();
  });

  it('on(type, handler) receives dispatched events', () => {
    const h = useEventSource(['/leaderboard']);
    const handler = vi.fn();
    h.on('run_finalized', handler);
    FakeEventSource.instances[0].dispatch('run_finalized', { run_id: 'r-1', ts: 'now' });
    expect(handler).toHaveBeenCalledTimes(1);
    h.dispose();
  });

  it('status transitions connecting → connected on open', () => {
    const h = useEventSource(['/leaderboard']);
    expect(h.status).toBe('connecting');
    FakeEventSource.instances[0].onopen?.(new Event('open'));
    expect(h.status).toBe('connected');
    h.dispose();
  });

  it('reconnects with exponential backoff on error', () => {
    const h = useEventSource(['/leaderboard']);
    expect(FakeEventSource.instances).toHaveLength(1);
    FakeEventSource.instances[0].onerror?.(new Event('error'));
    expect(h.status).toBe('reconnecting');
    vi.advanceTimersByTime(1000);
    expect(FakeEventSource.instances).toHaveLength(2);  // 1 s retry
    FakeEventSource.instances[1].onerror?.(new Event('error'));
    vi.advanceTimersByTime(3000);
    expect(FakeEventSource.instances).toHaveLength(3);  // 3 s retry
    FakeEventSource.instances[2].onerror?.(new Event('error'));
    vi.advanceTimersByTime(10_000);
    expect(FakeEventSource.instances).toHaveLength(4);  // 10 s retry
    FakeEventSource.instances[3].onerror?.(new Event('error'));
    expect(h.status).toBe('disconnected');
    vi.advanceTimersByTime(60_000);
    expect(FakeEventSource.instances).toHaveLength(4);  // no further retry after 3 attempts
    h.dispose();
  });

  it('dispose closes the active EventSource and prevents future reconnects', () => {
    const h = useEventSource(['/leaderboard']);
    const es = FakeEventSource.instances[0];
    h.dispose();
    expect(es.readyState).toBe(2);
    es.onerror?.(new Event('error'));
    vi.advanceTimersByTime(10_000);
    expect(FakeEventSource.instances).toHaveLength(1);  // no reconnect after dispose
  });
});
