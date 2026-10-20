import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import {
  claimRecord,
  type ContainerRecord,
  evidenceProblem,
  findRecords,
  type NewRecord,
  reasonKind,
  recordFile,
  releaseOwned,
  removeUnchanged,
  rewriteOwned,
} from "../../../src/harness/quarantine.ts";
import { testTempDir } from "../../utils/temp-dir.ts";

const ID = "a".repeat(64);
const ID2 = "b".repeat(64);
const T1 = crypto.randomUUID(), T2 = crypto.randomUUID();
const rec = (over: Partial<NewRecord> = {}): NewRecord => ({
  state: "in_use",
  container: "Cronus281",
  id: ID,
  token: T1,
  by: "HOST1 harness run",
  pid: 7,
  host: "HOST1",
  ...over,
});

Deno.test("H-35 run 004 Sol r1 H5 container records: created under the Docker id, found by id or by name, only removed explicitly", async () => {
  const dir = join(await testTempDir(), "q");
  assertEquals(await findRecords(dir, { name: "Cronus281", id: ID }), []);
  assert(
    await claimRecord(dir, rec({ state: "quarantined", reason: "cleanup" })),
  );
  const names: string[] = [];
  for await (const e of Deno.readDir(dir)) names.push(e.name);
  assertEquals(names, [`${ID}.json`]);
  // a renamed container (same id) and a replaced one (same name) both match
  const byId = await findRecords(dir, { name: "Renamed", id: ID });
  const byName = await findRecords(dir, { name: "CRONUS281", id: ID2 });
  assertEquals([byId.length, byName.length], [1, 1]);
  const r = byId[0]!.record!;
  assertEquals(
    [r.state, r.container, r.reason, r.by, r.pid, r.host, r.token],
    [
      "quarantined",
      "Cronus281",
      "cleanup",
      "HOST1 harness run",
      7,
      "HOST1",
      T1,
    ],
  );
  assert(!Number.isNaN(Date.parse(r.at)));
  assertStringIncludes(byId[0]!.why, "quarantined (cleanup)");
  assertEquals(await findRecords(dir, { name: "Cronus282", id: ID2 }), []);
  assertEquals(await removeUnchanged(byId), []);
  assertEquals(await findRecords(dir, { name: "Cronus281", id: ID }), []);
  assertEquals(await removeUnchanged(byId), [], "none left is fine");
});

Deno.test("H-35 run 004 Sol r2 N1 claims: an atomic create-new; two environments racing for one container, the second fails", async () => {
  const dir = join(await testTempDir(), "q");
  const [a, b] = await Promise.all([
    claimRecord(dir, rec({ token: T1 })),
    claimRecord(dir, rec({ token: T2, by: "HOST2 harness run" })),
  ]);
  assertEquals([a, b].filter(Boolean).length, 1, "exactly one claim wins");
  const winner = a ? T1 : T2;
  const f = await findRecords(dir, { name: "Cronus281", id: ID });
  assertEquals(f.map((x) => x.record?.token), [winner]);
  assertStringIncludes(f[0]!.why, `token ${winner}`);
  // the recover claim is its own file, matched by id too
  assert(await claimRecord(dir, rec({ token: T2 }), { recover: true }));
  assert(!await claimRecord(dir, rec({ token: T1 }), { recover: true }));
  assertEquals(
    (await findRecords(dir, { name: "x", id: ID })).map((x) => x.file),
    [recordFile(dir, ID, true), recordFile(dir, ID)].sort(),
  );
});

Deno.test("H-35 run 004 Sol r2 N1 rewriteOwned / releaseOwned: only the token's holder rewrites or releases; another owner's record is never overwritten; a gone record is created, never replaced", async () => {
  const dir = join(await testTempDir(), "q");
  const key = { name: "Cronus281", id: ID };
  assert(await claimRecord(dir, rec({ token: T1 })));
  const q = rec({ token: T1, state: "quarantined", reason: "L4 on C: x" });
  assertEquals(await rewriteOwned(dir, q), "written");
  assertEquals((await findRecords(dir, key))[0]!.record!.state, "quarantined");
  // another owner took the record (it was recovered and claimed again)
  await Deno.remove(recordFile(dir, ID));
  assert(await claimRecord(dir, rec({ token: T2, by: "HOST2 run" })));
  assertEquals(await rewriteOwned(dir, q), "foreign");
  const now = (await findRecords(dir, key))[0]!.record!;
  assertEquals([now.token, now.state, now.by], [T2, "in_use", "HOST2 run"]);
  assertEquals(await releaseOwned(dir, ID, T1), false, "not ours");
  assertEquals(await releaseOwned(dir, ID, T2), true);
  // gone: created anew under our token
  assertEquals(await rewriteOwned(dir, q), "created");
  assertEquals((await findRecords(dir, key))[0]!.record!.token, T1);
  // a quarantine is never released
  assertEquals(await releaseOwned(dir, ID, T1), false);
  // unreadable: foreign, untouched
  await Deno.writeTextFile(recordFile(dir, ID), "{bad");
  assertEquals(await rewriteOwned(dir, q), "foreign");
  assertEquals(await Deno.readTextFile(recordFile(dir, ID)), "{bad");
});

Deno.test("H-35 run 004 Sol r2 N2 removeUnchanged: a record rewritten since it was read is kept", async () => {
  const dir = join(await testTempDir(), "q");
  const key = { name: "Cronus281", id: ID };
  assert(await claimRecord(dir, rec({ state: "quarantined", reason: "a" })));
  const found = await findRecords(dir, key);
  assertEquals(
    await rewriteOwned(dir, rec({ state: "quarantined", reason: "a; b" })),
    "written",
  );
  assertEquals(await removeUnchanged(found), [recordFile(dir, ID)]);
  assertEquals((await findRecords(dir, key)).length, 1);
});

Deno.test("H-35 run 004 #3 container records: an unreadable record still refuses its container by file stem (fail closed), legacy ones included", async () => {
  const dir = await testTempDir();
  await Deno.writeTextFile(join(dir, `${ID}.json`), "{not json");
  // a run 004 #3 record (v1, keyed by name) and a Sol r1 one (v2, no token)
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
  await Deno.writeTextFile(
    join(dir, `${ID2}.json`),
    JSON.stringify({
      v: 2,
      state: "quarantined",
      container: "Cronus284",
      id: ID2,
      by: "",
      pid: 1,
      at: "",
    }),
  );
  const a = await findRecords(dir, { name: "Cronus281", id: ID });
  const b = await findRecords(dir, { name: "Cronus283", id: ID2 });
  assertEquals([a.length, b.length], [1, 2]);
  for (const f of [...a, ...b]) {
    assertStringIncludes(f.why, "unreadable");
    assertEquals(f.record, null);
  }
});

Deno.test("H-35 run 004 Sol r2 N4 reasonKind: the lane's quarantine reasons, a filesystem cause anywhere wins", () => {
  const cases: [string, ReturnType<typeof reasonKind>][] = [
    ["reset of Cronus281 failed at restore: boom", "non_filesystem"],
    [
      "HttpClient block of abc on Cronus281 read back 'true', want allow=false",
      "non_filesystem",
    ],
    [
      "post-cleanup check on Cronus281 failed: inventory differs",
      "non_filesystem",
    ],
    [
      "L4 on Cronus281: 0 error(s), 1 difference(s): C:\\Run\\my\\f",
      "filesystem",
    ],
    ["cleanup on Cronus281 failed: unpublish", "filesystem"],
    [
      "post-cleanup check on C failed: x; L4 on C: 0 error(s), 1 difference(s): p",
      "filesystem",
    ],
    ["reset of C failed at restore: x; cleanup on C failed: y", "filesystem"],
    ["cleanup failed", "unknown"],
    ["", "unknown"],
  ];
  for (const [reason, kind] of cases) {
    assertEquals(reasonKind(reason), kind, reason);
  }
});

Deno.test("H-35 run 004 Sol r2 N4 evidenceProblem: only a quarantine with a complete L4 after-capture is trustworthy (non-empty diff, or empty with a non-filesystem reason)", () => {
  const base: ContainerRecord = {
    ...rec({ state: "quarantined" }),
    v: 3,
    at: "",
  };
  const d = [{ path: "C:\\Run\\my\\f", before: null, after: "x" }];
  const reset = "reset of C failed at restore: boom";
  const l4 = "L4 on C: 0 error(s), 1 difference(s): C:\\Run\\my\\f";
  const kinds: [string, ContainerRecord | null, string | null][] = [
    ["unreadable / legacy", null, "unreadable or legacy record"],
    ["crash-left in_use", { ...base, state: "in_use" }, "in-use record"],
    [
      "no capture (reset failure)",
      { ...base, reason: reset },
      "no complete L4 after-capture",
    ],
    ["fs_captured false", {
      ...base,
      reason: reset,
      fs_diff: [],
      fs_captured: false,
    }, "no complete L4 after-capture"],
    [
      "diff without the flag",
      { ...base, reason: l4, fs_diff: d },
      "no complete L4 after-capture",
    ],
    ["captured, empty, non-filesystem", {
      ...base,
      reason: reset,
      fs_diff: [],
      fs_captured: true,
    }, null],
    ["captured, empty, cleanup", {
      ...base,
      reason: "cleanup on C failed: x",
      fs_diff: [],
      fs_captured: true,
    }, "filesystem cause with an empty diff"],
    ["captured, empty, unknown", {
      ...base,
      reason: "cleanup failed",
      fs_diff: [],
      fs_captured: true,
    }, "unknown cause with an empty diff"],
    [
      "captured diff",
      { ...base, reason: l4, fs_diff: d, fs_captured: true },
      null,
    ],
  ];
  for (const [what, r, want] of kinds) {
    const got = evidenceProblem(r);
    if (want === null) assertEquals(got, null, what);
    else assertStringIncludes(got ?? "(null)", want, what);
  }
});
