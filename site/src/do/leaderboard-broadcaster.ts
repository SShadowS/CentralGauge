import type { DurableObjectState } from '@cloudflare/workers-types';

const MAX_BUFFERED = 100;

export interface BroadcastEvent {
  type: 'run_finalized' | 'task_set_promoted' | 'shortcoming_added' | 'ping';
  ts: string;
  [k: string]: unknown;
}

export class LeaderboardBroadcaster {
  private state: DurableObjectState;
  private clients: Set<WritableStreamDefaultWriter<Uint8Array>>;
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
      const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
      const writer = writable.getWriter();

      this.clients.add(writer);

      // Send initial ping
      await this.writeEvent(writer, { type: 'ping', ts: new Date().toISOString() });

      // Send last 20 buffered events for reconnecting clients
      const initialEvents = this.recent.slice(-20);
      for (const ev of initialEvents) {
        await this.writeEvent(writer, ev);
      }

      // Clean up on disconnect
      request.signal.addEventListener('abort', () => {
        this.clients.delete(writer);
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
    const writers = Array.from(this.clients);
    this.clients.clear();
    await Promise.all(
      writers.map((w) => w.close().catch(() => {})),
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
    for (const writer of this.clients) {
      writer.write(frame).catch(() => {
        this.clients.delete(writer);
        writer.close().catch(() => {});
      });
    }
  }
}
