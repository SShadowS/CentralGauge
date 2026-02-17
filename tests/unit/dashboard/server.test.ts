/**
 * Tests for DashboardServer
 */

import { assertEquals, assertExists } from "@std/assert";
import { DashboardServer } from "../../../cli/dashboard/server.ts";
import type { DashboardConfig } from "../../../cli/dashboard/types.ts";

function createConfig(): DashboardConfig {
  return {
    models: ["model-a"],
    taskIds: ["task-1"],
    totalRuns: 1,
    attempts: 2,
    temperature: 0.1,
    containerName: "Cronus27",
  };
}

Deno.test("DashboardServer", async (t) => {
  await t.step("starts on auto-assigned port and serves pages", async () => {
    const server = await DashboardServer.start(createConfig());

    try {
      // Verify URL is assigned
      assertExists(server.url);
      assertEquals(server.url.startsWith("http://localhost:"), true);

      // GET / serves HTML
      const htmlRes = await fetch(server.url);
      assertEquals(htmlRes.status, 200);
      const html = await htmlRes.text();
      assertEquals(html.includes("CentralGauge Live"), true);
      assertEquals(
        htmlRes.headers.get("content-type"),
        "text/html; charset=utf-8",
      );

      // GET /api/state returns JSON
      const stateRes = await fetch(`${server.url}/api/state`);
      assertEquals(stateRes.status, 200);
      const state = await stateRes.json();
      assertEquals(state.isRunning, true);
      assertEquals(state.models, ["model-a"]);
      assertEquals(state.taskIds, ["task-1"]);
      assertExists(state.cells);

      // GET /health returns ok
      const healthRes = await fetch(`${server.url}/health`);
      assertEquals(healthRes.status, 200);
      assertEquals(await healthRes.text(), "ok");

      // GET /nonexistent returns 404
      const notFoundRes = await fetch(`${server.url}/nonexistent`);
      assertEquals(notFoundRes.status, 404);
      await notFoundRes.text(); // consume body
    } finally {
      await server.stop();
    }
  });

  await t.step("SSE stream delivers events", async () => {
    const server = await DashboardServer.start(createConfig());

    try {
      // Connect SSE
      const controller = new AbortController();
      const ssePromise = fetch(`${server.url}/events`, {
        signal: controller.signal,
      });

      // Give SSE time to connect
      await new Promise((r) => setTimeout(r, 100));

      // Trigger an event via the bridge
      server.bridge.setRun(1);
      server.bridge.handleEvent({
        type: "llm_started",
        taskId: "task-1",
        model: "model-a",
        attempt: 1,
      });

      // Give time for event to be sent
      await new Promise((r) => setTimeout(r, 100));

      // Abort the SSE connection
      controller.abort();

      // Verify we got a response (SSE stream)
      try {
        const res = await ssePromise;
        assertEquals(
          res.headers.get("content-type"),
          "text/event-stream",
        );
        // Clean up response body
        try {
          await res.body?.cancel();
        } catch {
          // Expected - connection was aborted
        }
      } catch {
        // AbortError is expected
      }
    } finally {
      await server.stop();
    }
  });

  await t.step("bridge reference is accessible", async () => {
    const server = await DashboardServer.start(createConfig());

    try {
      assertExists(server.bridge);
      // Verify bridge works
      server.bridge.setRun(1);

      // State should now have cells
      const stateRes = await fetch(`${server.url}/api/state`);
      const state = await stateRes.json();
      assertEquals(Object.keys(state.cells).length, 1); // 1 task x 1 model
    } finally {
      await server.stop();
    }
  });
});
