import { assertEquals } from "@std/assert";
import {
  alsemFindings,
  changedProdLines,
  curatedCounts,
  curatedDensity,
  densityStats,
  withinTaskRanks,
} from "../../../scripts/harness/analyze-campaign.ts";

const f = (
  detector: string,
  severity: string,
  confidence: string,
  count: number,
  app = "Core",
) => ({
  detector,
  severity,
  confidence,
  object: "A",
  routine: "R",
  file: `${app}/src/A.al`,
  line: 1,
  app,
  fingerprint: `${detector}-${severity}-${confidence}-${app}`,
  looseFingerprint: `loose-${detector}-${app}`,
  count,
});

Deno.test("alsemFindings keeps confidence.level", () => {
  const [x, y] = alsemFindings({
    findings: [
      {
        detector: "d1",
        severity: "high",
        confidence: { level: "likely" },
        fingerprint: "a",
        looseFingerprint: "la",
        primaryLocation: { file: "ws:Core/src/A.al" },
      },
      {
        detector: "d1",
        severity: "high",
        fingerprint: "b",
        looseFingerprint: "lb",
      },
    ],
  });
  assertEquals(x!.confidence, "likely");
  assertEquals(y!.confidence, "");
});

Deno.test("curatedCounts: weights 5/3/1/0, likely only, d3 and d9 left out, Test app left out", () => {
  const c = curatedCounts([
    f("d1-db-op-in-loop", "critical", "likely", 2), // 10
    f("d11-modify-without-get", "high", "likely", 1), // 3
    f("d11-modify-without-get", "medium", "likely", 4), // 4
    f("d12-dead-integration-event", "low", "likely", 9), // 0
    f("d12-dead-integration-event", "info", "likely", 9), // 0
    f("d1-db-op-in-loop", "critical", "possible", 7), // excluded: possible
    f("d3-missing-setloadfields", "medium", "likely", 3), // raw d3 only
    f("d3-missing-setloadfields", "medium", "possible", 2), // raw d3 only
    f("d9-transaction-span-summary", "high", "likely", 5), // raw d9 only
    f("d9-other-future-id", "high", "possible", 1), // d9 by prefix
    f("d34-commit-in-loop", "critical", "likely", 6, "Test"), // Test app
  ]);
  assertEquals(c, { weighted: 17, d3: 5, d9: 6 });
});

Deno.test("changedProdLines: added + removed in non-Test files, headers and no-newline marker not counted", () => {
  const patch = [
    "--- start/Core/src/A.al",
    "+++ final/Core/src/A.al",
    "@@ -1,2 +1,3 @@",
    " keep",
    "-old",
    "+new1",
    "+new2",
    "\\ No newline at end of file",
    "--- /dev/null",
    "+++ final/Rental/src/B.al",
    "@@ -0,0 +1,2 @@",
    "+x",
    "+--- looks like a header but is content",
    "--- start/Test/src/T.al",
    "+++ final/Test/src/T.al",
    "@@ -1 +1,2 @@",
    "-t",
    "+t1",
    "+t2",
    "--- start/Core/src/Gone.al",
    "+++ /dev/null",
    "@@ -1,2 +0,0 @@",
    "-a",
    "---b",
    "",
  ].join("\n");
  // Core/A: 1 removed + 2 added; Rental/B: 2 added; Gone: 2 removed
  assertEquals(changedProdLines(patch), 7);
  assertEquals(changedProdLines(""), 0);
});

Deno.test("curatedDensity: per 100 changed lines, null on 0 lines", () => {
  assertEquals(curatedDensity(3, 50), 6);
  assertEquals(curatedDensity(0, 50), 0);
  assertEquals(curatedDensity(4, 0), null);
});

Deno.test("densityStats: median, mean, share of zeros over non-null; nulls counted apart", () => {
  assertEquals(densityStats([0, 0, 4, 8, null]), {
    n: 4,
    null_count: 1,
    median: 2,
    mean: 3,
    zero_share: 0.5,
  });
  assertEquals(densityStats([null]), {
    n: 0,
    null_count: 1,
    median: null,
    mean: null,
    zero_share: null,
  });
});

Deno.test("withinTaskRanks: ascending per task, ties share the average rank, null unranked", () => {
  const r = withinTaskRanks([
    { id: "a", task: "T1", density: 5 },
    { id: "b", task: "T1", density: 1 },
    { id: "c", task: "T1", density: 5 },
    { id: "d", task: "T1", density: null },
    { id: "e", task: "T1", density: 0 },
    { id: "f", task: "T2", density: 9 },
  ]);
  assertEquals(Object.fromEntries(r), {
    e: 1,
    b: 2,
    a: 3.5,
    c: 3.5,
    d: null,
    f: 1,
  });
});
