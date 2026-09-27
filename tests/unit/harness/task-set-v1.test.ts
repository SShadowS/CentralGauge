import { assertEquals } from "@std/assert";
import { loadTaskSet } from "../../../src/harness/task.ts";

Deno.test("v1 task set: six tasks, kinds and refapp version", async () => {
  const set = await loadTaskSet("harness-tasks/tasks");
  assertEquals(
    set.map((t) => `${t.task.id}:${t.task.kind}:${t.task.refapp_version}`),
    [
      "HX-001:bugfix:refapp-v1",
      "HX-002:test-authoring:refapp-v1",
      "HX-003:feature:refapp-v1",
      "HX-004:feature:refapp-v1",
      "HX-005:refactor:refapp-v1",
      "HX-006:feature:refapp-v1",
    ],
  );
});
