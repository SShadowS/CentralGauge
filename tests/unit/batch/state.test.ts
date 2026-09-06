import { assertEquals, assertRejects } from "@std/assert";
import { loadState, parseState, writeState } from "../../../src/batch/state.ts";
import { minimalState } from "../../utils/batch-fixtures.ts";
import { cleanupTempDir, createTempDir } from "../../utils/test-helpers.ts";

Deno.test("writeState is atomic: no temp file survives and the content round-trips", async () => {
  const dir = await createTempDir("state");
  try {
    const s = minimalState({ runId: "run-1" });
    await writeState(dir, s);
    const names = [...Deno.readDirSync(dir)].map((e) => e.name);
    assertEquals(names, ["state.json"]);
    assertEquals(await loadState(dir), s);
  } finally {
    await cleanupTempDir(dir);
  }
});

Deno.test("parseState refuses an unknown schema version and a missing phase", () => {
  assertRejects(() =>
    Promise.resolve().then(() =>
      parseState({ ...minimalState({ runId: "r" }), schemaVersion: 2 })
    )
  );
  assertRejects(() => Promise.resolve().then(() => parseState({ runId: "r" })));
});
