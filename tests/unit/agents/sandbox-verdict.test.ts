/**
 * Tests for the trusted verdict channel (finding M1 — CRITICAL).
 *
 * Sandbox agent-bench success was previously scored from model-controlled
 * prose. The trusted channel: the MCP server appends a verdict record to
 * verdicts.jsonl in a host temp dir OUTSIDE any container mount, and the
 * executor scores success EXCLUSIVELY from those records.
 *
 * Authoritative success requires ALL of:
 *   tool === "al_verify_task"  (al_verify takes a model-chosen testFile and
 *                               is forgeable via a staged fake test — it is
 *                               diagnostic only)
 *   taskId === expected task
 *   nonce === per-run nonce
 *   success === true
 *   requiresTests → totalTests > 0
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
  appendVerdict,
  evaluateVerdicts,
  readVerdicts,
  VERDICT_FILE,
  type VerifyVerdict,
} from "../../../src/agents/verdict.ts";

const NONCE = "run-nonce-1234";
const TASK = "CG-AL-E007";

function verdict(overrides: Partial<VerifyVerdict> = {}): VerifyVerdict {
  return {
    nonce: NONCE,
    tool: "al_verify_task",
    taskId: TASK,
    success: true,
    compileSuccess: true,
    totalTests: 5,
    passed: 5,
    failed: 0,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

const expectation = { taskId: TASK, nonce: NONCE, requiresTests: true };

Deno.test("evaluateVerdicts (M1)", async (t) => {
  await t.step("(a) passing al_verify_task verdict → success", () => {
    const result = evaluateVerdicts([verdict()], expectation);
    assertEquals(result.success, true);
  });

  await t.step("(b) empty verdict list → FALSE regardless of prose", () => {
    // Prose like "All tests passed" is not an input here by construction —
    // only verdict records can grant success.
    const result = evaluateVerdicts([], expectation);
    assertEquals(result.success, false);
    assertEquals(result.reason, "no verified tool result");
  });

  await t.step("(c) verdict for a DIFFERENT taskId → FALSE", () => {
    const result = evaluateVerdicts(
      [verdict({ taskId: "CG-AL-E001" })],
      expectation,
    );
    assertEquals(result.success, false);
    assertEquals(result.reason, "no verified tool result");
  });

  await t.step(
    "(d) success:true with totalTests:0 + requiresTests → FALSE",
    () => {
      const result = evaluateVerdicts(
        [verdict({ totalTests: 0, passed: 0, failed: 0 })],
        expectation,
      );
      assertEquals(result.success, false);
    },
  );

  await t.step("(e) verdict success:false → FALSE", () => {
    const result = evaluateVerdicts(
      [verdict({ success: false, passed: 3, failed: 2 })],
      expectation,
    );
    assertEquals(result.success, false);
  });

  await t.step(
    "(f) passing verdict with tool al_verify (not al_verify_task) → FALSE",
    () => {
      const result = evaluateVerdicts(
        [verdict({ tool: "al_verify" })],
        expectation,
      );
      assertEquals(result.success, false);
      assertEquals(result.reason, "no verified tool result");
    },
  );

  await t.step("nonce mismatch (stale run) → FALSE", () => {
    const result = evaluateVerdicts(
      [verdict({ nonce: "other-run" })],
      expectation,
    );
    assertEquals(result.success, false);
  });

  await t.step("compile-only task: passing verdict without tests → ok", () => {
    const result = evaluateVerdicts(
      [verdict({ totalTests: 0, passed: 0, failed: 0 })],
      { taskId: TASK, nonce: NONCE, requiresTests: false },
    );
    assertEquals(result.success, true);
  });

  await t.step("uses the last passing verdict for reporting", () => {
    const result = evaluateVerdicts(
      [
        verdict({ success: false, passed: 2, failed: 3 }),
        verdict({ passed: 5, failed: 0 }),
      ],
      expectation,
    );
    assertEquals(result.success, true);
    assertEquals(result.authoritative?.passed, 5);
  });
});

Deno.test("readVerdicts / appendVerdict (M1)", async (t) => {
  await t.step("round-trips verdicts through verdicts.jsonl", async () => {
    const dir = await Deno.makeTempDir({ prefix: "cg-verdict-test-" });
    try {
      await appendVerdict(dir, verdict());
      await appendVerdict(dir, verdict({ success: false }));
      const verdicts = await readVerdicts(dir);
      assertEquals(verdicts.length, 2);
      assertEquals(verdicts[0]?.success, true);
      assertEquals(verdicts[1]?.success, false);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  });

  await t.step("missing file → empty list (scores as failure)", async () => {
    const dir = await Deno.makeTempDir({ prefix: "cg-verdict-test-" });
    try {
      assertEquals(await readVerdicts(dir), []);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  });

  await t.step("skips malformed lines instead of throwing", async () => {
    const dir = await Deno.makeTempDir({ prefix: "cg-verdict-test-" });
    try {
      await Deno.writeTextFile(
        join(dir, VERDICT_FILE),
        "not json\n" + JSON.stringify(verdict()) + "\n",
      );
      const verdicts = await readVerdicts(dir);
      assertEquals(verdicts.length, 1);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  });
});
