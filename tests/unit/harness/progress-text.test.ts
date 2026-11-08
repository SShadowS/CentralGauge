import { assertEquals, assertStringIncludes } from "@std/assert";
import { stripAnsiCode } from "@std/fmt/colors";
import { RecordStore } from "../../../src/harness/records.ts";
import {
  buildProgress,
  renderProgress,
} from "../../../src/harness/progress.ts";
import { testTempDir } from "../../utils/temp-dir.ts";
import { campaign, execution, judgment } from "./fixtures.ts";

Deno.test("progress (r2 #12): the text carries every section and a task row", async () => {
  const root = await testTempDir();
  const store = new RecordStore(root);
  const c = await campaign();
  await store.writeCampaign(c);
  const e = execution(c);
  await store.writeExecution(e);
  await store.writeJudgment(judgment(c, e, true));
  await Deno.writeTextFile(`${root}/executions/${c.id}/bad.json`, "{");
  const text = stripAnsiCode(renderProgress(await buildProgress(root, c.id)));
  for (
    const tag of [
      "[Progress]",
      "[Cells]",
      "[Executions]",
      "[Terminations]",
      "[Arm] plain",
      "[Arm] skills",
      "[ETA]",
      "[Task] HX-001: plain 1/1, skills 0/1",
      "[Task] HX-002",
      "[WARN]",
    ]
  ) assertStringIncludes(text, tag);
  assertStringIncludes(text, "awaiting judgment 0");
  assertStringIncludes(text, "unknown 0");
});

Deno.test("progress (r2 #12): campaigns of one experiment with equal created_at resolve to the larger id, as `report` does", async () => {
  const root = await testTempDir();
  const store = new RecordStore(root);
  const lo = await campaign({ id: "00000000-0000-4000-8000-000000000001" });
  const hi = await campaign({ id: "00000000-0000-4000-8000-000000000002" });
  await store.writeCampaign(lo);
  await store.writeCampaign(hi);
  const newest = (await store.campaigns("skills-vs-plain"))[0]!;
  assertEquals(newest.id, hi.id);
  assertEquals(
    (await buildProgress(root, "skills-vs-plain")).campaign_id,
    newest.id,
  );
});
