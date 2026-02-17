/**
 * Dashboard HTTP server with SSE push
 * @module cli/dashboard/server
 */

import type { DashboardConfig, SSEEvent } from "./types.ts";
import { DashboardStateManager } from "./state.ts";
import { DashboardEventBridge } from "./bridge.ts";
import { generateDashboardPage } from "./page.ts";

/**
 * Live dashboard HTTP server.
 * Serves the dashboard page, REST API for state, and SSE stream for live updates.
 */
export class DashboardServer {
  private server: Deno.HttpServer;
  private clients = new Set<ReadableStreamDefaultController>();
  private stateManager: DashboardStateManager;
  private _bridge: DashboardEventBridge;
  private _url: string;
  private pageHtml: string;

  private constructor(
    server: Deno.HttpServer,
    stateManager: DashboardStateManager,
    bridge: DashboardEventBridge,
    url: string,
  ) {
    this.server = server;
    this.stateManager = stateManager;
    this._bridge = bridge;
    this._url = url;
    this.pageHtml = generateDashboardPage();
  }

  /** The URL where the dashboard is available */
  get url(): string {
    return this._url;
  }

  /** The event bridge to connect to the orchestrator */
  get bridge(): DashboardEventBridge {
    return this._bridge;
  }

  /**
   * Start the dashboard server on an auto-selected port.
   */
  static async start(config: DashboardConfig): Promise<DashboardServer> {
    const stateManager = new DashboardStateManager(config);

    // Initialize cells for run 1
    stateManager.initializeCells(config.taskIds, config.models, 1);

    // Holder for the server instance (needed for closures that reference it)
    const holder: { server?: DashboardServer } = {};

    const broadcast = (event: SSEEvent) => {
      holder.server?.broadcastSSE(event);
    };

    const bridge = new DashboardEventBridge(stateManager, broadcast);

    // Start HTTP server on port 0 (OS auto-assigns)
    const server = Deno.serve(
      { port: 0, hostname: "127.0.0.1", onListen: () => {} },
      (req) => holder.server!.handleRequest(req),
    );

    // Get the actual port from the server's addr
    const addr = server.addr as Deno.NetAddr;
    const url = `http://localhost:${addr.port}`;

    const dashboardServer = new DashboardServer(
      server,
      stateManager,
      bridge,
      url,
    );
    holder.server = dashboardServer;

    // Small delay to ensure server is ready
    await new Promise((resolve) => setTimeout(resolve, 50));

    return dashboardServer;
  }

  /**
   * Stop the dashboard server
   */
  async stop(): Promise<void> {
    // Close all SSE connections
    for (const controller of this.clients) {
      try {
        controller.close();
      } catch {
        // Already closed
      }
    }
    this.clients.clear();

    await this.server.shutdown();
  }

  /**
   * Broadcast an SSE event to all connected clients
   */
  private broadcastSSE(event: SSEEvent): void {
    const data = `data: ${JSON.stringify(event)}\n\n`;
    const deadClients: ReadableStreamDefaultController[] = [];

    for (const controller of this.clients) {
      try {
        controller.enqueue(new TextEncoder().encode(data));
      } catch {
        deadClients.push(controller);
      }
    }

    // Clean up dead connections
    for (const dead of deadClients) {
      this.clients.delete(dead);
    }
  }

  /**
   * Handle incoming HTTP requests
   */
  private handleRequest(req: Request): Response {
    const url = new URL(req.url);

    switch (url.pathname) {
      case "/":
        return new Response(this.pageHtml, {
          headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-cache",
          },
        });

      case "/api/state":
        return new Response(
          JSON.stringify(this.stateManager.getFullState()),
          {
            headers: {
              "content-type": "application/json",
              "cache-control": "no-cache",
            },
          },
        );

      case "/events":
        return this.handleSSE();

      case "/health":
        return new Response("ok", {
          headers: { "content-type": "text/plain" },
        });

      default:
        return new Response("Not Found", { status: 404 });
    }
  }

  /**
   * Set up an SSE connection
   */
  private handleSSE(): Response {
    const clients = this.clients;

    const stream = new ReadableStream({
      start(controller) {
        clients.add(controller);
      },
      cancel() {
        // Client disconnected - cleaned up on next broadcast
      },
    });

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        "connection": "keep-alive",
        "access-control-allow-origin": "*",
      },
    });
  }
}
