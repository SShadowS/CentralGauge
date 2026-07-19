/**
 * Tests for McpServerManager per-run lifecycle (findings M5, M7).
 *
 * M5: every start() gets a fresh free port and a fresh server process —
 * start() on a manager with a live process replaces it (a reused server may
 * carry a different workspace map). M7: stop() reaps the child (await exit,
 * SIGKILL fallback) instead of leaving zombies.
 *
 * Uses a stub /health server so no BC container or real MCP tooling is
 * involved.
 */

import {
  assert,
  assertEquals,
  assertExists,
  assertNotEquals,
} from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import { McpServerManager } from "../../../src/agents/mcp-manager.ts";

const STUB_SCRIPT = join(
  dirname(fromFileUrl(import.meta.url)),
  "..",
  "..",
  "utils",
  "mcp-stub-server.ts",
);

function createManager(): McpServerManager {
  return new McpServerManager({
    serverScriptPath: STUB_SCRIPT,
    readyTimeoutMs: 20000,
  });
}

async function healthAlive(port: number): Promise<boolean> {
  try {
    const resp = await fetch(`http://127.0.0.1:${port}/health`);
    await resp.body?.cancel();
    return resp.ok;
  } catch {
    return false;
  }
}

Deno.test("McpServerManager per-run lifecycle", async (t) => {
  await t.step("allocateFreePort returns ports in valid range", () => {
    const a = McpServerManager.allocateFreePort();
    const b = McpServerManager.allocateFreePort();
    assert(a > 0 && a < 65536);
    assert(b > 0 && b < 65536);
  });

  await t.step(
    "two managers started concurrently get distinct ports",
    async () => {
      const m1 = createManager();
      const m2 = createManager();
      try {
        const [h1, h2] = await Promise.all([m1.start(), m2.start()]);
        assertNotEquals(h1.port, h2.port);
        assertEquals(m1.isRunning(), true);
        assertEquals(m2.isRunning(), true);
        assertEquals(await healthAlive(h1.port), true);
        assertEquals(await healthAlive(h2.port), true);
      } finally {
        await m1.stop();
        await m2.stop();
      }
    },
  );

  await t.step(
    "start() issues per-run auth token, run nonce, and verdict dir",
    async () => {
      const m = createManager();
      try {
        const h1 = await m.start();
        assertExists(h1.authToken);
        assertExists(h1.runNonce);
        const stat = await Deno.stat(h1.verdictDir);
        assert(stat.isDirectory);

        const h2 = await m.start(); // replacement run gets fresh identity
        assertNotEquals(h1.authToken, h2.authToken);
        assertNotEquals(h1.runNonce, h2.runNonce);
        assertNotEquals(h1.verdictDir, h2.verdictDir);
      } finally {
        await m.stop();
      }
    },
  );

  await t.step(
    "second start() replaces the previous server process",
    async () => {
      const m = createManager();
      try {
        const h1 = await m.start();
        const pid1 = m.pid;
        const h2 = await m.start();
        const pid2 = m.pid;
        assertExists(pid1);
        assertExists(pid2);
        assertNotEquals(pid1, pid2);
        assertNotEquals(h1.port, h2.port);
        // Old server must be gone — silent reuse was the M5 bug.
        assertEquals(await healthAlive(h1.port), false);
        assertEquals(await healthAlive(h2.port), true);
      } finally {
        await m.stop();
      }
    },
  );

  await t.step("stop() reaps the child and clears state", async () => {
    const m = createManager();
    const h = await m.start();
    await m.stop();
    assertEquals(m.isRunning(), false);
    assertEquals(m.port, null);
    assertEquals(await healthAlive(h.port), false);
    // Verdict dir is owned by the manager and removed on stop
    let dirExists = true;
    try {
      await Deno.stat(h.verdictDir);
    } catch {
      dirExists = false;
    }
    assertEquals(dirExists, false);
  });

  await t.step("stop() is safe to call when not running", async () => {
    const m = createManager();
    await m.stop();
    assertEquals(m.isRunning(), false);
  });
});
