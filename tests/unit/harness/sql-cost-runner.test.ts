/** Q-06: the measuring bc wrapper and the lane swap (no containers). */
import { assertEquals, assertRejects } from "@std/assert";
import type { BcLane, HarnessBc } from "../../../src/harness/bc-lane.ts";
import type { SqlCostCall } from "../../../scripts/harness/sql-cost.ts";
import {
  measuringBc,
  withBc,
} from "../../../scripts/harness/sql-cost-runner.ts";

function fakeBc(
  withMeasurements = true,
): HarnessBc & { opts: ({ measure?: boolean } | undefined)[] } {
  const opts: ({ measure?: boolean } | undefined)[] = [];
  return {
    opts,
    harnessCompilerIdentity: () => Promise.resolve("id"),
    runHarnessTests: (
      _c: string,
      codeunit: number,
      o?: { measure?: boolean },
    ) => {
      opts.push(o);
      return Promise.resolve({
        success: true,
        totalTests: 1,
        passedTests: 1,
        failedTests: 0,
        duration: 1,
        output: "",
        results: [{ name: "TestA", passed: true, duration: 1 }],
        ...(withMeasurements
          ? {
            measurements: [{
              codeunit,
              procedure: "TestA",
              statements: codeunit,
              ms: 1,
              success: true,
            }],
          }
          : {}),
      });
    },
  } as unknown as HarnessBc & {
    opts: ({ measure?: boolean } | undefined)[];
  };
}

Deno.test("measuringBc: asks for measurement, records the last run per codeunit", async () => {
  const bc = fakeBc();
  const sink = new Map<number, SqlCostCall>();
  const m = measuringBc(bc, sink);
  await m.runHarnessTests("C1", 85001);
  await m.runHarnessTests("C2", 85001);
  await m.runHarnessTests("C2", 85002);
  assertEquals(bc.opts, [{ measure: true }, { measure: true }, {
    measure: true,
  }]);
  assertEquals([...sink.keys()], [85001, 85002]);
  assertEquals(sink.get(85001)!.container, "C2");
  assertEquals(sink.get(85001)!.rows, [{
    procedure: "TestA",
    outcome: "pass",
  }]);
  // other methods delegate
  assertEquals(await m.harnessCompilerIdentity("C1"), "id");
});

Deno.test("measuringBc: a result without measurements throws", async () => {
  const m = measuringBc(fakeBc(false), new Map());
  await assertRejects(
    () => m.runHarnessTests("C1", 85001),
    Error,
    "measurements",
  );
});

Deno.test("withBc: swaps the lane's bc and restores it, also on a throw", async () => {
  const a = fakeBc();
  const b = fakeBc();
  const lane = { bc: a } as unknown as BcLane;
  await withBc(lane, b, () => {
    assertEquals(lane.bc, b);
    return Promise.resolve();
  });
  assertEquals(lane.bc, a);
  await assertRejects(() =>
    withBc(lane, b, () => Promise.reject(new Error("x")))
  );
  assertEquals(lane.bc, a);
});
