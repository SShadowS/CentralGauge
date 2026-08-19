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
    const o: VerifyOutcome = { state: "passed_first_try", passed: 3, total: 3 };
    assertEquals(testCounts(o), { passed: 3, total: 3 });
  });

  await t.step("queued and running are not terminal", () => {
    assertEquals(isTerminal({ state: "queued" }), false);
    assertEquals(isTerminal({ state: "running", phase: "compiling" }), false);
    assertEquals(
      isTerminal({ state: "failed_both", passed: 1, total: 3, failures: [] }),
      true,
    );
  });
});
