import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import {
  clearQuarantine,
  readQuarantine,
  writeQuarantine,
} from "../../../src/harness/quarantine.ts";
import { testTempDir } from "../../utils/temp-dir.ts";

Deno.test("H-35 run 004 #3 quarantine store: a record is written atomically, read back by lower-cased name and only cleared explicitly", async () => {
  const dir = join(await testTempDir(), "q");
  assertEquals((await readQuarantine(dir)).size, 0, "no directory: none");
  await writeQuarantine(dir, {
    container: "Cronus281",
    reason: "cleanup failed",
    by: "HOST1 harness run",
  });
  const names: string[] = [];
  for await (const e of Deno.readDir(dir)) names.push(e.name);
  assertEquals(names, ["cronus281.json"], "no temp file left behind");
  const r = (await readQuarantine(dir)).get("cronus281");
  assertEquals(
    [r?.container, r?.reason, r?.by],
    ["Cronus281", "cleanup failed", "HOST1 harness run"],
  );
  assert(r && !Number.isNaN(Date.parse(r.at)));
  await clearQuarantine(dir, "CRONUS281");
  assertEquals((await readQuarantine(dir)).size, 0);
  await clearQuarantine(dir, "Cronus281"); // none left is fine
});

Deno.test("H-35 run 004 #3 quarantine store: an unreadable record still quarantines its container (fail closed)", async () => {
  const dir = await testTempDir();
  await Deno.writeTextFile(join(dir, "cronus282.json"), "{not json");
  await Deno.writeTextFile(
    join(dir, "cronus283.json"),
    JSON.stringify({ v: 2, container: "Cronus283" }),
  );
  const q = await readQuarantine(dir);
  assertEquals([...q.keys()].sort(), ["cronus282", "cronus283"]);
  assertStringIncludes(q.get("cronus282")!.reason, "unreadable");
  assertStringIncludes(q.get("cronus283")!.reason, "unreadable");
});
