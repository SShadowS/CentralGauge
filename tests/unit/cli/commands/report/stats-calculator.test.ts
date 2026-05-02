import { assertAlmostEquals, assertEquals } from "@std/assert";
import {
  costPerPass,
  majorityAtN,
  passHatKForTask,
  percentile,
  stddev,
  tokensPerPass,
  wilsonInterval,
} from "../../../../../cli/commands/report/stats-calculator.ts";

Deno.test("passHatKForTask", async (t) => {
  await t.step("all runs pass → 1.0 for any k ≤ n", () => {
    assertEquals(passHatKForTask(5, 5, 1), 1);
    assertEquals(passHatKForTask(5, 5, 3), 1);
    assertEquals(passHatKForTask(5, 5, 5), 1);
  });

  await t.step("0 runs pass → 0 for any k ≥ 1", () => {
    assertEquals(passHatKForTask(5, 0, 1), 0);
    assertEquals(passHatKForTask(5, 0, 3), 0);
  });

  await t.step("c < k → 0 (cannot pick k all-passes from c < k)", () => {
    assertEquals(passHatKForTask(5, 2, 3), 0);
  });

  await t.step("k > n → 0 (under-sampled)", () => {
    assertEquals(passHatKForTask(3, 3, 4), 0);
  });

  await t.step("3 of 5 pass, k=2 → C(3,2)/C(5,2) = 3/10 = 0.3", () => {
    assertAlmostEquals(passHatKForTask(5, 3, 2), 0.3, 1e-9);
  });

  await t.step("4 of 5 pass, k=3 → C(4,3)/C(5,3) = 4/10 = 0.4", () => {
    assertAlmostEquals(passHatKForTask(5, 4, 3), 0.4, 1e-9);
  });
});

Deno.test("wilsonInterval (95% by default)", async (t) => {
  await t.step("n=0 → [0, 1] (no information)", () => {
    const ci = wilsonInterval(0, 0);
    assertEquals(ci.lower, 0);
    assertEquals(ci.upper, 1);
  });

  await t.step("0 of 10 → lower=0, upper bounded", () => {
    const ci = wilsonInterval(0, 10);
    assertEquals(ci.lower, 0);
    assertAlmostEquals(ci.upper, 0.2775, 1e-3);
  });

  await t.step("10 of 10 → upper=1, lower bounded", () => {
    const ci = wilsonInterval(10, 10);
    assertEquals(ci.upper, 1);
    assertAlmostEquals(ci.lower, 0.7225, 1e-3);
  });

  await t.step("5 of 10 → centered ~0.5 with reasonable width", () => {
    const ci = wilsonInterval(5, 10);
    assertAlmostEquals(ci.lower, 0.2366, 1e-3);
    assertAlmostEquals(ci.upper, 0.7634, 1e-3);
  });

  await t.step("custom z (90% CI = 1.645)", () => {
    const ci = wilsonInterval(5, 10, 1.645);
    assertAlmostEquals(ci.lower, 0.2693, 1e-3);
    assertAlmostEquals(ci.upper, 0.7307, 1e-3);
  });
});

Deno.test("percentile (linear interpolation)", async (t) => {
  await t.step("empty array → 0", () => {
    assertEquals(percentile([], 0.5), 0);
  });

  await t.step("single value → that value", () => {
    assertEquals(percentile([42], 0.5), 42);
    assertEquals(percentile([42], 0.95), 42);
  });

  await t.step("median of [1,2,3,4,5] = 3", () => {
    assertEquals(percentile([1, 2, 3, 4, 5], 0.5), 3);
  });

  await t.step("p95 of [1..100] ≈ 95.05", () => {
    const arr = Array.from({ length: 100 }, (_, i) => i + 1);
    assertAlmostEquals(percentile(arr, 0.95), 95.05, 1e-9);
  });

  await t.step("unsorted input is sorted internally", () => {
    assertEquals(percentile([5, 1, 3, 2, 4], 0.5), 3);
  });
});

Deno.test("stddev (sample, Bessel's correction)", async (t) => {
  await t.step("empty → 0", () => {
    assertEquals(stddev([]), 0);
  });

  await t.step("single value → 0", () => {
    assertEquals(stddev([5]), 0);
  });

  await t.step("[2,4,4,4,5,5,7,9] → 2.138...", () => {
    assertAlmostEquals(stddev([2, 4, 4, 4, 5, 5, 7, 9]), 2.13809, 1e-4);
  });

  await t.step("constant values → 0", () => {
    assertEquals(stddev([3, 3, 3, 3]), 0);
  });
});

Deno.test("costPerPass", async (t) => {
  await t.step("0 passed → null", () => {
    assertEquals(costPerPass(5.0, 0), null);
  });

  await t.step("$10 / 4 passes = $2.50", () => {
    assertEquals(costPerPass(10, 4), 2.5);
  });

  await t.step("0 cost → 0", () => {
    assertEquals(costPerPass(0, 5), 0);
  });
});

Deno.test("tokensPerPass", async (t) => {
  await t.step("0 passed → null", () => {
    assertEquals(tokensPerPass(1000, 0), null);
  });

  await t.step("1000 / 4 = 250", () => {
    assertEquals(tokensPerPass(1000, 4), 250);
  });
});

Deno.test("majorityAtN", async (t) => {
  await t.step("3 of 5 pass → majority", () => {
    assertEquals(majorityAtN(5, 3), true);
  });

  await t.step("2 of 5 pass → not majority", () => {
    assertEquals(majorityAtN(5, 2), false);
  });

  await t.step("2 of 4 pass → tie counts as not majority (strict >50%)", () => {
    assertEquals(majorityAtN(4, 2), false);
  });

  await t.step("3 of 4 pass → majority", () => {
    assertEquals(majorityAtN(4, 3), true);
  });

  await t.step("0 runs → false", () => {
    assertEquals(majorityAtN(0, 0), false);
  });
});
