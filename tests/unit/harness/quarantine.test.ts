import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import {
  findRecords,
  releaseInUse,
  removeRecords,
  writeRecord,
} from "../../../src/harness/quarantine.ts";
import { testTempDir } from "../../utils/temp-dir.ts";

const ID = "a".repeat(64);
const ID2 = "b".repeat(64);

Deno.test("H-35 run 004 Sol r1 H5 container records: written atomically under the Docker id, found by id or by name, only removed explicitly", async () => {
  const dir = join(await testTempDir(), "q");
  assertEquals(await findRecords(dir, { name: "Cronus281", id: ID }), []);
  await writeRecord(dir, {
    state: "quarantined",
    container: "Cronus281",
    id: ID,
    by: "HOST1 harness run",
    pid: 7,
    reason: "cleanup failed",
  });
  const names: string[] = [];
  for await (const e of Deno.readDir(dir)) names.push(e.name);
  assertEquals(names, [`${ID}.json`], "no temp file left behind");
  // a renamed container (same id) and a replaced one (same name) both match
  const byId = await findRecords(dir, { name: "Renamed", id: ID });
  const byName = await findRecords(dir, { name: "CRONUS281", id: ID2 });
  assertEquals(byId.length, 1);
  assertEquals(byName.length, 1);
  const r = byId[0]!.record!;
  assertEquals(
    [r.state, r.container, r.reason, r.by, r.pid],
    ["quarantined", "Cronus281", "cleanup failed", "HOST1 harness run", 7],
  );
  assert(!Number.isNaN(Date.parse(r.at)));
  assertStringIncludes(byId[0]!.why, "quarantined (cleanup failed)");
  assertEquals(await findRecords(dir, { name: "Cronus282", id: ID2 }), []);
  await removeRecords(byId);
  assertEquals(await findRecords(dir, { name: "Cronus281", id: ID }), []);
  await removeRecords(byId); // none left is fine
});

Deno.test("H-35 run 004 Sol r1 H4 container records: an in-use record is released only by its own writer and only while still in use", async () => {
  const dir = join(await testTempDir(), "q");
  const base = { container: "Cronus281", id: ID, by: "HOST1 run", pid: 7 };
  const key = { name: "Cronus281", id: ID };
  await writeRecord(dir, { ...base, state: "in_use" });
  const f = await findRecords(dir, key);
  assertStringIncludes(f[0]!.why, "in use by HOST1 run (pid 7");
  assertEquals(await releaseInUse(dir, ID, "HOST1 run", 8), false);
  assertEquals(await releaseInUse(dir, ID, "OTHER run", 7), false);
  // a quarantine replaced it: never released
  await writeRecord(dir, { ...base, state: "quarantined", reason: "x" });
  assertEquals(await releaseInUse(dir, ID, "HOST1 run", 7), false);
  assertEquals((await findRecords(dir, key)).length, 1);
  await writeRecord(dir, { ...base, state: "in_use" });
  assertEquals(await releaseInUse(dir, ID, "HOST1 run", 7), true);
  assertEquals(await findRecords(dir, key), []);
  assertEquals(await releaseInUse(dir, ID, "HOST1 run", 7), false, "none");
});

Deno.test("H-35 run 004 #3 container records: an unreadable record still refuses its container by file stem (fail closed), legacy name-keyed ones included", async () => {
  const dir = await testTempDir();
  await Deno.writeTextFile(join(dir, `${ID}.json`), "{not json");
  // a run 004 #3 record (v1, keyed by name)
  await Deno.writeTextFile(
    join(dir, "cronus283.json"),
    JSON.stringify({
      v: 1,
      container: "Cronus283",
      reason: "r",
      at: "",
      by: "",
    }),
  );
  const a = await findRecords(dir, { name: "Cronus281", id: ID });
  const b = await findRecords(dir, { name: "Cronus283", id: ID2 });
  assertEquals([a.length, b.length], [1, 1]);
  assertStringIncludes(a[0]!.why, "unreadable");
  assertStringIncludes(b[0]!.why, "unreadable");
  assertEquals(a[0]!.record, null);
});
