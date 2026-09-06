import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { appendJsonl, loadJsonl } from "../../../src/batch/journal.ts";
import { cleanupTempDir, createTempDir } from "../../utils/test-helpers.ts";

Deno.test("loadJsonl tolerates a torn last line and de-duplicates by key keeping the last", async () => {
  const dir = await createTempDir("jsonl");
  try {
    const p = join(dir, "items.jsonl");
    await appendJsonl(p, { itemId: "a", v: 1 });
    await appendJsonl(p, { itemId: "b", v: 1 });
    await appendJsonl(p, { itemId: "a", v: 2 });
    await Deno.writeTextFile(p, '{"itemId":"c","v":', { append: true });
    const rows = await loadJsonl<{ itemId: string; v: number }>(
      p,
      (r) => r.itemId,
    );
    assertEquals(rows, [{ itemId: "a", v: 2 }, { itemId: "b", v: 1 }]);
    assertEquals(
      await loadJsonl(
        join(dir, "missing.jsonl"),
        (r: { itemId: string }) => r.itemId,
      ),
      [],
    );
  } finally {
    await cleanupTempDir(dir);
  }
});
