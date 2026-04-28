import type { DurableObjectState } from '@cloudflare/workers-types';
import { eventToRoutes, routePatternMatches } from '../lib/server/sse-routes';

const MAX_BUFFERED = 100;

export interface BroadcastEvent {
  type: 'run_finalized' | 'task_set_promoted' | 'shortcoming_added' | 'ping';
  ts: string;
  [k: string]: unknown;
}

interface ClientEntry {
  writer: WritableStreamDefaultWriter<Uint8Array>;
  routes: string[];   // parsed from ?routes= comma list, default ['*']
}

export class LeaderboardBroadcaster {
  private state: DurableObjectState;
  private clients: Set<ClientEntry>;
  private recent: BroadcastEvent[];
  private encoder: TextEncoder;

  constructor(state: DurableObjectState) {
    this.state = state;
    this.clients = new Set();
    this.recent = [];
    this.encoder = new TextEncoder();
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/broadcast' && request.method === 'POST') {
      let ev: BroadcastEvent;
      try {
        ev = (await request.json()) as BroadcastEvent;
      } catch {
        return new Response('Bad JSON', { status: 400 });
      }

      // Append to buffer and evict oldest when over limit
      this.recent.push(ev);
      if (this.recent.length > MAX_BUFFERED) {
        this.recent = this.recent.slice(-MAX_BUFFERED);
      }

      // Fire-and-forget fanout: Response returns before clients receive the event.
      // Delivery is best-effort; dead clients are pruned on their next write failure.
      this.fanout(ev);

      return Response.json({ ok: true, clients: this.clients.size });
    }

    if (path === '/recent' && request.method === 'GET') {
      const limitParam = url.searchParams.get('limit');
      const limit = Math.min(limitParam ? parseInt(limitParam, 10) || 20 : 20, MAX_BUFFERED);
      const events = this.recent.slice(-limit);
      return Response.json({ events });
    }

    if (path === '/subscribe' && request.method === 'GET') {
      const routesParam = url.searchParams.get('routes');
      const routes = parseRoutesParam(routesParam);

      const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
      const writer = writable.getWriter();
      const entry: ClientEntry = { writer, routes };
      this.clients.add(entry);

      // Initial ping always flows (route "*" matches every subscriber).
      await this.writeEvent(writer, { type: 'ping', ts: new Date().toISOString() });

      // Send up to 20 buffered events that match this client's routes.
      // Walk backwards through the full buffer so a route that only
      // appears 30+ events back still gets its replay (otherwise a
      // subscriber to /models/no-such-slug receives ZERO events even
      // when the buffer holds 50 events for OTHER routes).
      const initialEvents: BroadcastEvent[] = [];
      for (let i = this.recent.length - 1; i >= 0 && initialEvents.length < 20; i--) {
        const ev = this.recent[i];
        if (matchesClient(ev, entry)) initialEvents.unshift(ev);
      }
      for (const ev of initialEvents) {
        await this.writeEvent(writer, ev);
      }

      // Clean up on disconnect
      request.signal.addEventListener('abort', () => {
        this.clients.delete(entry);
        writer.close().catch(() => {});
      });

      return new Response(readable, {
        headers: {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache, no-store',
          'x-accel-buffering': 'no',
        },
      });
    }

    // TEST-ONLY: gated dry-run for /subscribe filtering. Returns the list of
    // buffered events that a fresh subscriber with the given `?routes=` would
    // receive, WITHOUT actually opening a streaming SSE connection. Avoids
    // miniflare's response-buffering hang on infinite TransformStream bodies
    // while still exercising parseRoutesParam + matchesClient end-to-end.
    if (path === '/test-match' && request.method === 'GET') {
      if (request.headers.get('x-test-only') !== '1') {
        return new Response('Forbidden', { status: 403 });
      }
      const routesParam = url.searchParams.get('routes');
      const routes = parseRoutesParam(routesParam);
      const entry: ClientEntry = { writer: null as unknown as WritableStreamDefaultWriter<Uint8Array>, routes };
      const matched: BroadcastEvent[] = [];
      for (let i = this.recent.length - 1; i >= 0 && matched.length < 20; i--) {
        const ev = this.recent[i];
        if (matchesClient(ev, entry)) matched.unshift(ev);
      }
      return Response.json({ events: matched });
    }

    // TEST-ONLY: gated reset endpoint. Closes all open SSE writers and clears
    // the buffer so vitest can shut down workerd cleanly on Windows. Gated
    // behind the `x-test-only: 1` header so it can never be invoked in
    // production via the public route surface.
    if (path === '/reset' && request.method === 'POST') {
      if (request.headers.get('x-test-only') !== '1') {
        return new Response('Forbidden', { status: 403 });
      }
      await this.closeAllClients();
      this.recent = [];
      return Response.json({ ok: true });
    }

    return new Response('Not Found', { status: 404 });
  }

  // TEST-ONLY helper: invoked by /reset to drain in-memory state so the DO
  // doesn't keep workerd processes alive past test exit on Windows.
  private async closeAllClients(): Promise<void> {
    const entries = Array.from(this.clients);
    this.clients.clear();
    await Promise.all(
      entries.map((e) => e.writer.close().catch(() => {})),
    );
  }

  private formatFrame(ev: BroadcastEvent): Uint8Array {
    return this.encoder.encode(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`);
  }

  private async writeEvent(
    writer: WritableStreamDefaultWriter<Uint8Array>,
    ev: BroadcastEvent,
  ): Promise<void> {
    try {
      await writer.write(this.formatFrame(ev));
    } catch {
      // Writer is closed/errored — will be cleaned up in fanout
    }
  }

  private fanout(ev: BroadcastEvent): void {
    const frame = this.formatFrame(ev);
    for (const entry of this.clients) {
      if (!matchesClient(ev, entry)) continue;
      entry.writer.write(frame).catch(() => {
        this.clients.delete(entry);
        entry.writer.close().catch(() => {});
      });
    }
  }
}

function parseRoutesParam(raw: string | null): string[] {
  if (!raw) return ['*'];
  const parts = raw.split(',').map((s) => decodeURIComponent(s).trim()).filter(Boolean);
  return parts.length > 0 ? parts : ['*'];
}

function matchesClient(ev: BroadcastEvent, entry: ClientEntry): boolean {
  // Heartbeats and reset events always flow.
  if (ev.type === 'ping') return true;
  return routePatternMatches(eventToRoutes(ev), entry.routes);
}
