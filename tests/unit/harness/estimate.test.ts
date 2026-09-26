import { assert, assertEquals } from "@std/assert";
import { estimateArms, renderEstimate } from "../../../src/harness/estimate.ts";

const arm = (o = {}) => ({
  arm: "a",
  manifest_hash: "h1",
  paid: false,
  outstanding_cells: 10,
  ...o,
});
const ex = (o = {}) => ({
  arm_manifest_hash: "h1",
  cell: "c:T#1",
  exec_ms: 600_000,
  verdict_ms: 120_000,
  list_cost_usd: 1,
  paid_cost_usd: 1,
  ...o,
});

Deno.test("estimate: other manifests ignored; retries raise attempts per cell", () => {
  const [e] = estimateArms([arm()], [
    ex(),
    ex({ cell: "c:T#2" }),
    ex({ cell: "c:T#2" }),
    ex({ arm_manifest_hash: "x" }),
  ]);
  assertEquals([e!.samples, e!.cells_sampled, e!.attempts_per_cell], [
    3,
    2,
    1.5,
  ]);
  assertEquals(e!.projected_ms, 10 * 1.5 * 720_000);
});

Deno.test("estimate: paid arm with all or some unknown paid cost is INCOMPLETE", () => {
  const [all] = estimateArms([arm({ paid: true })], [
    ex({ paid_cost_usd: null }),
  ]);
  assertEquals([all!.projected_paid_usd, all!.complete], [null, false]);
  const [some] = estimateArms([arm({ paid: true })], [
    ex(),
    ex({ cell: "c:T#2", paid_cost_usd: null }),
  ]);
  assertEquals([some!.unknown_paid_cost, some!.complete], [1, false]);
  assert(renderEstimate([some!]).join("\n").includes("INCOMPLETE"));
});

Deno.test("estimate: no samples is no estimate, never $0; zero outstanding is an explicit 0", () => {
  const [none] = estimateArms([arm()], []);
  const text = renderEstimate([none!]).join("\n");
  assert(text.includes("no prior executions") && !text.includes("$0"));
  const [done] = estimateArms([arm({ outstanding_cells: 0 })], [ex()]);
  assertEquals([done!.projected_ms, done!.complete], [0, true]);
});
