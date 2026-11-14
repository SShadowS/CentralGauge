import { assertEquals } from "@std/assert";
import { loadTaskSet } from "../../../src/harness/task.ts";

Deno.test("v2 task set: frozen selection and held-out tasks pin refapp-v2", async () => {
  const sel = JSON.parse(
    await Deno.readTextFile("harness-tasks/v2/selection.json"),
  );
  assertEquals(sel.status, "ok");
  const ids: string[] = [...sel.selection.selected, ...sel.held_out].sort();
  assertEquals(ids.length, sel.selection.n + 4);
  const set = new Map(
    (await loadTaskSet("harness-tasks/tasks")).map((t) => [t.task.id, t.task]),
  );
  assertEquals(
    ids.filter((id) => set.get(id)?.refapp_version !== "refapp-v2"),
    [],
  );
});
