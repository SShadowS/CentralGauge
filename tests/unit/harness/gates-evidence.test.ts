import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import {
  evidencePath,
  gatesHooks,
  heartbeatPath,
  isGatesRecord,
  ownerGone,
  readEvidence,
  removeGatesFiles,
  writeEvidence,
  writeHeartbeat,
} from "../../../src/harness/gates-evidence.ts";
import {
  claimRecord,
  findRecords,
  releaseOwned,
} from "../../../src/harness/quarantine.ts";
import { testTempDir } from "../../utils/temp-dir.ts";

const ID = "a".repeat(64);
const T1 = crypto.randomUUID(), T2 = crypto.randomUUID();
const LINES = ["D|16|0|C:\\Run\\my", "T|1"];
const rec = (token: string) => ({
  state: "in_use" as const,
  container: "Cronus281",
  id: ID,
  token,
  by: "HOST1 gate-task gates",
  pid: 7,
  host: "HOST1",
});
const ev = (over: Record<string, unknown> = {}) => ({
  token: T1,
  container: "Cronus281",
  id: ID,
  lineage_id: "golden-o09-v2",
  lines: LINES,
  ...over,
});

Deno.test("H-76 evidence: written once (create-new) with its sha256, read back verified; a missing, tampered, unreadable or second write is refused; records never see it", async () => {
  const dir = join(await testTempDir(), "q");
  let r = await readEvidence(dir, ID);
  assert("why" in r);
  assertStringIncludes(r.why, "no gates evidence");
  await writeEvidence(dir, ev());
  r = await readEvidence(dir, ID);
  assert(!("why" in r), JSON.stringify(r));
  assertEquals(
    [r.token, r.container, r.id, r.lineage_id, r.lines],
    [T1, "Cronus281", ID, "golden-o09-v2", LINES],
  );
  // create-new: never over an existing file
  let threw = false;
  try {
    await writeEvidence(dir, ev({ token: T2 }));
  } catch {
    threw = true;
  }
  assert(threw, "a second write must fail");
  // not a record: findRecords skips it
  assertEquals(await findRecords(dir, { name: "Cronus281", id: ID }), []);
  // tampered lines: the sha no longer matches
  const raw = JSON.parse(await Deno.readTextFile(evidencePath(dir, ID)));
  raw.lines = ["D|16|9|C:\\Run\\my", "T|1"];
  await Deno.writeTextFile(evidencePath(dir, ID), JSON.stringify(raw));
  r = await readEvidence(dir, ID);
  assert("why" in r);
  assertStringIncludes(r.why, "sha256");
  await Deno.writeTextFile(evidencePath(dir, ID), "{bad");
  r = await readEvidence(dir, ID);
  assert("why" in r);
  assertStringIncludes(r.why, "unreadable");
});

Deno.test("H-76 heartbeat: the owner is gone when it is missing or older than 120 s; fresh, unreadable or another token's heartbeat is not proof", async () => {
  const dir = join(await testTempDir(), "q");
  const now = Date.parse("2026-11-08T12:00:00Z");
  assertEquals(await ownerGone(dir, ID, T1, now), { gone: true });
  await writeHeartbeat(dir, ID, T1, new Date(now - 119_000));
  let g = await ownerGone(dir, ID, T1, now);
  assert(!g.gone);
  assertStringIncludes(g.why, "heartbeat");
  await writeHeartbeat(dir, ID, T1, new Date(now - 120_000));
  assertEquals(await ownerGone(dir, ID, T1, now), { gone: true });
  g = await ownerGone(dir, ID, T2, now);
  assert(!g.gone, "another token's heartbeat");
  await Deno.writeTextFile(heartbeatPath(dir, ID), "{bad");
  g = await ownerGone(dir, ID, T1, now);
  assert(!g.gone);
  assertStringIncludes(g.why, "unreadable");
});

Deno.test("H-76 removeGatesFiles: removes this token's evidence and heartbeat only; gone already is fine", async () => {
  const dir = join(await testTempDir(), "q");
  await writeEvidence(dir, ev());
  await writeHeartbeat(dir, ID, T1);
  await removeGatesFiles(dir, ID, T2);
  assert(
    !("why" in await readEvidence(dir, ID)),
    "another token removes nothing",
  );
  await removeGatesFiles(dir, ID, T1);
  assert("why" in await readEvidence(dir, ID));
  assertEquals(await ownerGone(dir, ID, T1), { gone: true });
  await removeGatesFiles(dir, ID, T1);
});

Deno.test("H-76 gatesHooks: afterClaim writes the heartbeat first (and keeps it fresh), then the before-capture; owned follows the record's token; done stops the heartbeat and removes the files only on a release", async () => {
  const dir = join(await testTempDir(), "q");
  const lines: string[] = [];
  const captured: string[] = [];
  const h = gatesHooks({
    dir,
    token: T1,
    heartbeatMs: 20,
    evidence: {
      lineageId: "golden-o09-v2",
      capture: (c) => {
        captured.push(c);
        return Promise.resolve(LINES);
      },
      clean: (l) => !l.some((x) => x.startsWith("E|")),
    },
    log: (l) => lines.push(l),
  });
  assert(await claimRecord(dir, rec(T1)));
  await h.afterClaim("Cronus281", ID);
  assertEquals(captured, ["Cronus281"]);
  const e = await readEvidence(dir, ID);
  assert(!("why" in e), JSON.stringify(e));
  assertEquals([e.token, e.lineage_id, e.lines], [T1, "golden-o09-v2", LINES]);
  const first = JSON.parse(await Deno.readTextFile(heartbeatPath(dir, ID))).at;
  await new Promise((r) => setTimeout(r, 80));
  const later = JSON.parse(await Deno.readTextFile(heartbeatPath(dir, ID))).at;
  assert(later > first, "the heartbeat is rewritten");
  assert(await h.owned("Cronus281", ID));
  // kept (dirty end): heartbeat stops, files stay
  await h.done("Cronus281", ID, false);
  const stopped = await Deno.readTextFile(heartbeatPath(dir, ID));
  await new Promise((r) => setTimeout(r, 80));
  assertEquals(await Deno.readTextFile(heartbeatPath(dir, ID)), stopped);
  assert(!("why" in await readEvidence(dir, ID)));
  // another owner's record: not ours
  await releaseOwned(dir, ID, T1);
  assert(await claimRecord(dir, rec(T2)));
  assert(!await h.owned("Cronus281", ID));
  // a release removes this token's files
  await h.done("Cronus281", ID, true);
  assert("why" in await readEvidence(dir, ID));
  assertEquals(lines, []);
});

Deno.test("H-76 gatesHooks: a capture with errors or a failing capture keeps no evidence (WARN), the hold goes on; without --lineage only the heartbeat; a heartbeat that cannot be written refuses the hold", async () => {
  for (
    const capture of [
      () => Promise.resolve(["E|C:\\Run\\my|denied", "T|1"]),
      () => Promise.reject(new Error("walk failed")),
    ]
  ) {
    const dir = join(await testTempDir(), "q");
    const lines: string[] = [];
    const h = gatesHooks({
      dir,
      token: T1,
      evidence: {
        lineageId: "l",
        capture,
        clean: (l) => !l.some((x) => x.startsWith("E|")),
      },
      log: (l) => lines.push(l),
    });
    await h.afterClaim("Cronus281", ID);
    assert("why" in await readEvidence(dir, ID));
    assert(lines.some((l) => l.includes("no before-capture")), lines.join());
    assert(!(await ownerGone(dir, ID, T1)).gone, "heartbeat written");
    await h.done("Cronus281", ID, true);
  }
  const dir = join(await testTempDir(), "q");
  const h = gatesHooks({ dir, token: T1, log: () => {} });
  await h.afterClaim("Cronus281", ID);
  assert("why" in await readEvidence(dir, ID));
  await h.done("Cronus281", ID, true);
  // an unwritable heartbeat (the dir is a file): the hold is refused
  const file = join(await testTempDir(), "f");
  await Deno.writeTextFile(file, "x");
  const bad = gatesHooks({ dir: file, token: T1, log: () => {} });
  let threw = false;
  try {
    await bad.afterClaim("Cronus281", ID);
  } catch {
    threw = true;
  }
  assert(threw);
  bad.stopAll();
});

Deno.test("H-76 isGatesRecord: by `<host> gate-task gates` only", () => {
  assert(isGatesRecord({ by: "HOST1 gate-task gates" }));
  assert(!isGatesRecord({ by: "HOST1 harness run" }));
  assert(!isGatesRecord({ by: "gate-task gates x" }));
});
