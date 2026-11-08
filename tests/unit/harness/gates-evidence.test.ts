import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import {
  evidencePath,
  gatesHooks,
  heartbeatPath,
  isGatesRecord,
  liveHolders,
  liveTree,
  ownerGone,
  processHolders,
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
  // Sol r3: a recover claim beside our record does not stop the hold (a
  // refused recover must not strand it); any other record does
  assert(await claimRecord(dir, rec(T2), { recover: true }));
  assert(await h.owned("Cronus281", ID));
  await releaseOwned(dir, ID, T2, { recover: true });
  const other = "b".repeat(64);
  assert(
    await claimRecord(dir, {
      ...rec(T2),
      id: other,
      state: "quarantined",
      reason: "x",
    }),
  );
  assert(!await h.owned("Cronus281", ID), "a record under the name");
  await Deno.remove(join(dir, `${other}.json`));
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
  await bad.stopAll();
});

Deno.test("H-76 Sol r2 liveTree: the pid and every live process reachable through parent links, including orphans of a dead parent; never a cycle twice", () => {
  const table = [
    { pid: 1, ppid: 0 },
    { pid: 50, ppid: 9 }, // an orphan pwsh worker of dead gates pid 9
    { pid: 51, ppid: 50 },
    { pid: 60, ppid: 1 },
    { pid: 70, ppid: 71 }, // a cycle (pid reuse)
    { pid: 71, ppid: 70 },
  ];
  assertEquals(liveTree(table, 9), [50, 51]);
  assertEquals(liveTree(table, 60), [60]);
  assertEquals(liveTree(table, 99), []);
  assertEquals(liveTree(table, 70), [70, 71]);
});

Deno.test("H-76 Sol r3 liveHolders: the gates tree plus any live process naming the container or its id (an orphaned docker exec), whole words only, never recover's own tree or its ancestors", () => {
  const ID64 = "c".repeat(64);
  // creation order follows the pid here (a parent is always older)
  const row = (pid: number, ppid: number, cmd: string | null, name = "x") => ({
    pid,
    ppid,
    name,
    cmd,
    created: pid,
  });
  const table = [
    row(1, 0, null, "System"), // unreadable, not a container tool
    // the shell that ran recover, and recover itself with a child
    row(10, 1, "bash -c deno task harness recover Cronus281"),
    row(11, 10, "deno run main.ts harness recover Cronus281"),
    row(12, 11, "docker inspect Cronus281"),
    row(13, 11, null, "pwsh.exe"), // recover's own probe, unreadable
    // gates (pid 9) is dead; its pwsh died too; a docker exec lives on
    row(30, 25, "docker exec Cronus281 pwsh -c Unpublish"),
    row(31, 25, `docker exec ${ID64.slice(0, 12)} x`),
    // another container whose name extends this one, and an unrelated one
    row(40, 1, "docker exec Cronus2810 x"),
    row(41, 1, "docker exec Cronus282 x"),
  ];
  const names = ["Cronus281", ID64, ID64.slice(0, 12)];
  assertEquals(liveHolders(table, 9, names, 11), [30, 31]);
  // the gates pid alive with a child: both count
  const live = [
    ...table,
    row(9, 1, "deno gate-task gates"),
    row(50, 9, "pwsh -NoExit -Command -"),
  ];
  assertEquals(liveHolders(live, 9, names, 11), [9, 30, 31, 50]);
  // Sol r4: a docker or pwsh whose command line cannot be read counts
  const hidden = [
    ...table.slice(0, 5),
    row(60, 1, null, "docker.exe"),
    row(61, 1, null, "powershell.exe"),
    row(62, 1, null, "svchost.exe"),
  ];
  assertEquals(liveHolders(hidden, 9, names, 11), [60, 61]);
  // Sol r4: the record's old name matches too (a renamed container)
  assertEquals(
    liveHolders(
      [...table.slice(0, 5), row(70, 1, "docker exec OldName x")],
      9,
      [...names, "OldName"],
      11,
    ),
    [70],
  );
  // nothing names it and the tree is gone: none
  assertEquals(liveHolders(table.slice(0, 5), 9, names, 11), []);
});

Deno.test("H-76 Sol r5 liveHolders: a reused pid never adopts its former owner's orphans (recover's own tree follows only links whose child is not older than its parent)", () => {
  const r = (
    pid: number,
    ppid: number,
    created: number | undefined,
    cmd: string,
  ) => ({
    pid,
    ppid,
    name: "x",
    cmd,
    ...(created === undefined ? {} : { created }),
  });
  // gates was pid 9 and died; its suspended pwsh worker 50 (created at 100)
  // keeps ppid 9; recover now runs AS pid 9 (created at 500)
  const table = [
    r(1, 0, 0, "System"),
    r(8, 1, 400, "bash -c harness recover Cronus281"),
    r(9, 8, 500, "deno harness recover Cronus281"),
    r(50, 9, 100, "pwsh -NoExit -Command -"),
    r(51, 9, 600, "pwsh probe"), // recover's own probe
  ];
  assertEquals(liveHolders(table, 9, ["Cronus281"], 9), [50]);
  // a child with no known creation time is not recover's either
  assertEquals(
    liveHolders([...table, r(52, 9, undefined, "pwsh")], 9, ["Cronus281"], 9),
    [50, 52],
  );
  // liveTree unverified (the gates tree) keeps every link
  assertEquals(liveTree(table, 9), [9, 50, 51]);
  assertEquals(liveTree(table, 9, true), [9, 51]);
});

Deno.test("H-76 Sol r1-r3 processHolders: reads this host's table; recover's own process never counts; a bad pid throws", async () => {
  const child = new Deno.Command(Deno.execPath(), {
    args: ["eval", "await new Promise((r) => setTimeout(r, 30000))"],
    stdout: "null",
    stderr: "null",
  }).spawn();
  const pid = child.pid;
  // The live host table also holds other sessions' processes (a docker or
  // pwsh starting or exiting has no readable command line for an instant
  // and counts): assert on our own processes only.
  try {
    // our own child is in our (recover's) tree: excluded
    const h = await processHolders(pid, ["CgH76NoSuchContainer"]);
    assert(!h.includes(pid) && !h.includes(Deno.pid), `${h}`);
  } finally {
    child.kill();
    await child.status;
  }
  const after = await processHolders(pid, ["CgH76NoSuchContainer"]);
  assert(!after.includes(pid) && !after.includes(Deno.pid), `${after}`);
  let threw = false;
  try {
    await processHolders(0, []);
  } catch {
    threw = true;
  }
  assert(threw);
});

Deno.test("H-76 isGatesRecord: by `<host> gate-task gates` only", () => {
  assert(isGatesRecord({ by: "HOST1 gate-task gates" }));
  assert(!isGatesRecord({ by: "HOST1 harness run" }));
  assert(!isGatesRecord({ by: "gate-task gates x" }));
});
