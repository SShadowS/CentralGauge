import { assertEquals } from "@std/assert";
import type { VerifyOutcome } from "../../../src/dashboard/verify-types.ts";
import { isTerminal, testCounts } from "../../../src/dashboard/verify-types.ts";

Deno.test("verify-types", async (t) => {
  await t.step("a publish defect reports no test counts", () => {
    const o: VerifyOutcome = {
      state: "publish_defect",
      message: "candidate installed but ran zero tests",
    };
    assertEquals(testCounts(o), undefined);
  });

  await t.step("a passed-first-try outcome reports its counts", () => {
    const o: VerifyOutcome = { state: "passed_first_try", passed: 2, total: 3 };
    const counts = testCounts(o);
    assertEquals(counts?.passed, 2);
    assertEquals(counts?.total, 3);
  });

  await t.step("isTerminal classifies all states correctly", () => {
    // Non-terminal states
    assertEquals(isTerminal({ state: "queued" }), false);
    assertEquals(isTerminal({ state: "running", phase: "compiling" }), false);

    // Terminal states
    assertEquals(
      isTerminal({ state: "passed_first_try", passed: 3, total: 3 }),
      true,
    );
    assertEquals(
      isTerminal({
        state: "passed_second_try",
        passed: 3,
        total: 3,
        fixPrompt: "fix this",
      }),
      true,
    );
    assertEquals(
      isTerminal({ state: "failed_both", passed: 1, total: 3, failures: [] }),
      true,
    );
    assertEquals(
      isTerminal({ state: "didnt_compile", compileErrors: [] }),
      true,
    );
    assertEquals(
      isTerminal({
        state: "publish_defect",
        message: "candidate installed but ran zero tests",
      }),
      true,
    );
    assertEquals(
      isTerminal({ state: "refused", reason: "bench is live" }),
      true,
    );
    assertEquals(
      isTerminal({ state: "errored", message: "unexpected error" }),
      true,
    );
  });
});
