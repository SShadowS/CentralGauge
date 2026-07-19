/**
 * Tests for `cli/commands/ingest-command.ts` (CLI6).
 *
 * The user-facing `handleIngest` calls `Deno.exit()` directly, which isn't
 * directly testable (same pattern as `bench-command.ts`'s
 * `decideIngestRunFailure` and `cycle-command.ts`'s `parseStep`). Instead
 * we test the underlying pure `decideRawIngestExitCode` helper, which
 * `handleIngest` now calls AFTER the raw-bench-results replay loop
 * finishes (previously: a fatal rejection aborted the loop immediately via
 * an inline `Deno.exit(1)`, and a 100%-transient replay had no non-zero
 * exit path at all).
 *
 * @module tests/unit/cli/commands/ingest-command
 */

import { assertEquals } from "@std/assert";
import { decideRawIngestExitCode } from "../../../../cli/commands/ingest-command.ts";

Deno.test("decideRawIngestExitCode", async (t) => {
  await t.step(
    "CLI6: two variants both transient-fail -> exit non-zero",
    () => {
      const code = decideRawIngestExitCode({
        attempted: 2,
        okCount: 0,
        transient: 2,
        infraSkipped: 0,
        fatalFailure: false,
      });
      assertEquals(code, 1);
    },
  );

  await t.step(
    "CLI6: a fatal rejection on variant 1 still exits non-zero even though variant 2 succeeded",
    () => {
      // "variant 2 still attempted" is a loop-behavior guarantee (the
      // inline Deno.exit(1) was removed from the fatal-failure branch);
      // this asserts the resulting summary correctly forces a non-zero exit.
      const code = decideRawIngestExitCode({
        attempted: 2,
        okCount: 1,
        transient: 0,
        infraSkipped: 0,
        fatalFailure: true,
      });
      assertEquals(code, 1);
    },
  );

  await t.step("all variants ingest successfully -> exit 0", () => {
    const code = decideRawIngestExitCode({
      attempted: 2,
      okCount: 2,
      transient: 0,
      infraSkipped: 0,
      fatalFailure: false,
    });
    assertEquals(code, 0);
  });

  await t.step(
    "a partial transient failure with at least one success -> exit 0 (matches decideIngestRunFailure semantics)",
    () => {
      const code = decideRawIngestExitCode({
        attempted: 2,
        okCount: 1,
        transient: 1,
        infraSkipped: 0,
        fatalFailure: false,
      });
      assertEquals(code, 0);
    },
  );

  await t.step(
    "any infra-invalidated variant forces a non-zero exit even when others succeeded",
    () => {
      const code = decideRawIngestExitCode({
        attempted: 2,
        okCount: 2,
        transient: 0,
        infraSkipped: 1,
        fatalFailure: false,
      });
      assertEquals(code, 1);
    },
  );

  await t.step("zero variants attempted (all skipped) -> exit 0", () => {
    const code = decideRawIngestExitCode({
      attempted: 0,
      okCount: 0,
      transient: 0,
      infraSkipped: 0,
      fatalFailure: false,
    });
    assertEquals(code, 0);
  });
});
