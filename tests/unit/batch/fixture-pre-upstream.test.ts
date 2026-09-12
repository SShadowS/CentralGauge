import { assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";
import { loadState } from "../../../src/batch/state.ts";
import { copyPreUpstreamFixture } from "../../utils/batch-fixture.ts";

Deno.test("pre-upstream fixture parses as a finalized schema-4 run with no routing", async () => {
  const f = await copyPreUpstreamFixture();
  try {
    const state = await loadState(f.dir);
    assertEquals(state.phase, "finalized");
    assertEquals(Object.keys(state.tasks).length, 2);
    const inputs = JSON.parse(
      await Deno.readTextFile(join(f.dir, "prompt-inputs.json")),
    ) as Record<string, unknown>;
    assertEquals("routing" in inputs, false);
    const results = JSON.parse(await Deno.readTextFile(f.resultsFile)) as {
      ingest: { schema: number };
    };
    assertEquals(results.ingest.schema, 4);
    assertExists(inputs["settings"]);
  } finally {
    await f.cleanup();
  }
});
