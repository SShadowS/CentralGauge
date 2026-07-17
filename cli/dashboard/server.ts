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
   * Return the latest container-health snapshot. Used by the bench results
   * writer to append a `# Container Health` block to the scores file.
   */
  getHealthSnapshot(): import("../../src/health/types.ts").ContainerHealthState {
    return this.stateManager.getHealthSnapshot();
  }

  /**
   * Return the underlying `ContainerHealthMonitor` so the orchestrator can
   * wire it into routing/retry/drain paths (task #7). Dashboard and
   * orchestrator MUST share one monitor or rolling-window state diverges.
   */
  getHealthMonitor(): import("../../src/health/monitor.ts").ContainerHealthMonitor {
    return this.stateManager.getHealthMonitor();
  }

  /**
   * Number of currently connected SSE clients. Test/observability hook:
   * exercises the active removal in `cancel()` (CLI9) without needing a
   * broadcast to trigger the lazy dead-client sweep.
   */
  getClientCount(): number {
    return this.clients.size;
  }

  /**
   * Start the dashboard server on an auto-selected port.
   *
   * `sharedMonitor` lets the caller (typically `parallel-executor`) inject
   * a pre-built monitor so the orchestrator and dashboard observe the same
   * rolling-window state. Omit to let the dashboard construct its own
   * (legacy behavior; used only by tests + standalone server starts).
   */
  static async start(
    config: DashboardConfig,
    sharedMonitor?:
      import("../../src/health/monitor.ts").ContainerHealthMonitor,
  ): Promise<DashboardServer> {
    const stateManager = new DashboardStateManager(config, sharedMonitor);

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

      case "/api/health-snapshot":
        return new Response(
          JSON.stringify(this.stateManager.getHealthSnapshot()),
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
   * Set up an SSE connection.
   *
   * Replay-on-connect: before adding the new client to the broadcast set,
   * we send the latest cached state (full state + latest pool snapshot) so
   * the browser doesn't sit blank waiting for the next live event.
   */
  private handleSSE(): Response {
    const clients = this.clients;
    const stateManager = this.stateManager;
    const bridge = this._bridge;
    // `cancel()` doesn't receive the controller as a parameter (only the
    // cancel reason) — captured here from `start()` so cancel() can remove
    // the right entry from `clients` (CLI9).
    let sseController: ReadableStreamDefaultController | undefined;

    const stream = new ReadableStream({
      start(controller) {
        sseController = controller;
        // Replay current state immediately so newly-connected tabs aren't blank
        const enc = new TextEncoder();
        let replayOk = true;
        const send = (event: SSEEvent) => {
          if (!replayOk) return;
          try {
            controller.enqueue(
              enc.encode(`data: ${JSON.stringify(event)}\n\n`),
            );
          } catch {
            // Stream already closed before the replay finished. Don't
            // register a controller that can never receive a live
            // broadcast (CLI9).
            replayOk = false;
          }
        };

        send({ type: "full-state", state: stateManager.getFullState() });
        send({
          type: "health-snapshot",
          state: stateManager.getHealthSnapshot(),
        });
        const latestPool = bridge.getLatestPoolSnapshot();
        if (latestPool) {
          send({ type: "pool-snapshot", snapshot: latestPool });
        }

        // Only register the controller once the replay actually landed
        // (CLI9): a controller added despite a failed enqueue would sit
        // dead in `clients` until the next broadcast's lazy sweep found it.
        if (replayOk) {
          clients.add(controller);
        }
      },
      cancel() {
        // Actively remove on disconnect (CLI9) instead of waiting for the
        // next broadcast's lazy dead-client sweep: a client that
        // disconnects between broadcasts would otherwise sit in `clients`
        // indefinitely.
        if (sseController) {
          clients.delete(sseController);
        }
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
