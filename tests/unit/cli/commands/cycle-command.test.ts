/**
 * Unit tests for `cli/commands/cycle-command.ts`.
 *
 * The user-facing `parseStepOrExit` calls `Deno.exit(2)` on bad input;
 * that's not directly testable. Instead we test the underlying pure
 * `parseStep` helper which returns `CycleStep | null` — the same
 * test-friendly factoring used elsewhere in the CLI.
 *
 * @module tests/unit/cli/commands/cycle-command
 */
import { assertEquals } from "@std/assert";
import { parseStep } from "../../../../cli/commands/cycle-command.ts";

Deno.test("parseStep returns the step for valid names", () => {
  assertEquals(parseStep("bench"), "bench");
  assertEquals(parseStep("debug-capture"), "debug-capture");
  assertEquals(parseStep("analyze"), "analyze");
  assertEquals(parseStep("publish"), "publish");
});

Deno.test("parseStep returns null for unknown names (no throw)", () => {
  // I3 regression. Pre-fix `parseStep` threw a raw `Error` on a typo —
  // operators saw a stack trace instead of the colored `[ERROR]` line +
  // exit code 2 used elsewhere in the CLI. The pure helper now returns
  // null; the user-facing wrapper logs in red and exits.
  assertEquals(parseStep("benhc"), null); // typo
  assertEquals(parseStep("debug"), null); // wrong canonical (must be debug-capture)
  assertEquals(parseStep(""), null);
  assertEquals(parseStep("BENCH"), null); // case-sensitive
});
