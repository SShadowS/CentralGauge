import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { checkBenchGate } from "../../../src/dashboard/bench-gate.ts";

Deno.test("bench-gate", async (t) => {
  await t.step("allows when no marker exists", async () => {
    const dir = await Deno.makeTempDir({ prefix: "cg-gate-" });
    try {
      assertEquals(checkBenchGate(dir), { allowed: true });
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  });

  await t.step("refuses a fresh marker, naming the command", async () => {
    const dir = await Deno.makeTempDir({ prefix: "cg-gate-" });
    try {
      await Deno.writeTextFile(
        join(dir, ".bench-running.json"),
        JSON.stringify({
          pid: 1234,
          startedAt: "2026-08-19T00:00:00.000Z",
          heartbeatAt: new Date().toISOString(),
          command: "bench --llms sonnet",
        }),
      );
      const decision = checkBenchGate(dir);
      assertEquals(decision.allowed, false);
      if (decision.allowed) throw new Error("unreachable");
      assertStringIncludes(decision.reason, "bench --llms sonnet");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  });

  await t.step("allows again once the marker is stale", async () => {
    const dir = await Deno.makeTempDir({ prefix: "cg-gate-" });
    try {
      const p = join(dir, ".bench-running.json");
      await Deno.writeTextFile(p, JSON.stringify({ command: "x" }));
      const stat = await Deno.stat(p);
      const wayLater = (stat.mtime?.getTime() ?? 0) + 10 * 60_000;
      assertEquals(checkBenchGate(dir, { now: wayLater }), { allowed: true });
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  });

  await t.step("refuses a present but unreadable marker", async () => {
    const dir = await Deno.makeTempDir({ prefix: "cg-gate-" });
    try {
      await Deno.writeTextFile(join(dir, ".bench-running.json"), "{not json");
      assertEquals(checkBenchGate(dir).allowed, false);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  });
});
