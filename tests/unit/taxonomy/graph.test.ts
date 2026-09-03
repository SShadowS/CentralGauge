import { assertEquals } from "@std/assert";
import {
  buildComponents,
  sliceStats,
} from "../../../site/src/lib/shared/taxonomy-graph.ts";

const tasks = [
  { id: "S1", donors: [] },
  { id: "S2", donors: [] },
  { id: "S3", donors: [] },
  { id: "S4", donors: [] },
  { id: "C1", donors: ["S1", "S2"] },
  { id: "C2", donors: ["S2", "S3"] },
];

Deno.test("composites and their donors share a component; untouched singles are their own", () => {
  const g = buildComponents(tasks);
  const c = (id: string) => g.componentOf.get(id);
  assertEquals(c("S1"), c("C1"));
  assertEquals(c("C1"), c("C2"));
  assertEquals(c("C2"), c("S3"));
  assertEquals(c("S4") !== c("S1"), true);
  assertEquals(
    g.sizes.slice().sort((a: number, b: number) => b - a),
    [5, 1],
  );
});

Deno.test("slice stats restrict components to the slice and count donors", () => {
  const g = buildComponents(tasks);
  const s = sliceStats(g, ["C1", "C2"]); // composite slice
  assertEquals(s.task_count, 2);
  assertEquals(s.component_count, 1);
  assertEquals(s.donor_count, 3);
  assertEquals(s.largest_component_share, 1);
  const singles = sliceStats(g, ["S1", "S2", "S3", "S4"]);
  assertEquals(singles.component_count, 4); // donor edges lead outside the slice
  assertEquals(singles.effective_components, 4);
});
