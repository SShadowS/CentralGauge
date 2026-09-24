import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { join } from "@std/path";
import {
  abandon,
  accept,
  addTask,
  answer,
  ask,
  checkpoint,
  claim,
  CoordError,
  doctor,
  heartbeat,
  initRoot,
  lease,
  leaseHolder,
  next,
  openQuestions,
  overview,
  pause,
  pauseState,
  reject,
  release,
  resume,
  stale,
  status,
  submit,
  taskState,
  why,
} from "../../../scripts/coord/coord.ts";

async function freshRoot(): Promise<string> {
  const base = await Deno.makeTempDir({ prefix: "coord-test-" });
  const root = join(base, "coord");
  await initRoot(root, "test-campaign");
  return root;
}

async function seed(root: string) {
  await addTask(root, { id: "M0-01", lane: "content", deps: [] }, "skeleton");
  await addTask(root, { id: "M0-02", lane: "ops", deps: ["M0-01"] }, "timing");
  await addTask(root, { id: "M0-03", lane: "ops", deps: ["M0-02"] }, "later");
}

Deno.test("coord: init refuses an existing root and open refuses a missing one", async () => {
  const root = await freshRoot();
  await assertRejects(() => initRoot(root, "again"), CoordError);
  await assertRejects(() => status(join(root, "nope")), CoordError);
});

Deno.test("coord: task ids and lanes are validated", async () => {
  const root = await freshRoot();
  await assertRejects(
    () => addTask(root, { id: "../x", lane: "ops", deps: [] }, ""),
    CoordError,
  );
  await assertRejects(
    () => addTask(root, { id: "M0-01", lane: "bad lane", deps: [] }, ""),
    CoordError,
  );
  await addTask(root, { id: "M0-01", lane: "ops", deps: [] }, "");
  await assertRejects(
    () => addTask(root, { id: "M0-01", lane: "ops", deps: [] }, ""),
    CoordError,
  );
});

Deno.test("coord: next only offers tasks whose deps are accepted", async () => {
  const root = await freshRoot();
  await seed(root);
  assertEquals((await next(root, "content")).map((t) => t.id), ["M0-01"]);
  assertEquals((await next(root, "ops")).map((t) => t.id), []);

  const run = await claim(root, "M0-01", "content");
  await submit(root, "M0-01", run.runId, run.token, "abc123", "lane-content");
  assertEquals((await taskState(root, "M0-01")).state, "review");
  assertEquals(
    (await next(root, "ops")).map((t) => t.id),
    [],
    "submitted is not accepted",
  );

  await accept(root, "M0-01", run.runId, "def456");
  assertEquals((await taskState(root, "M0-01")).state, "accepted");
  assertEquals((await next(root, "ops")).map((t) => t.id), ["M0-02"]);
});

Deno.test("coord: claim refuses wrong lane, unmet deps and a second claim", async () => {
  const root = await freshRoot();
  await seed(root);
  await assertRejects(() => claim(root, "M0-01", "ops"), CoordError, "lane");
  await assertRejects(() => claim(root, "M0-02", "ops"), CoordError, "deps");
  await claim(root, "M0-01", "content");
  await assertRejects(
    () => claim(root, "M0-01", "content"),
    CoordError,
    "doing",
  );
});

Deno.test("coord: concurrent claims produce exactly one winner", async () => {
  const root = await freshRoot();
  await seed(root);
  const results = await Promise.allSettled(
    Array.from({ length: 8 }, () => claim(root, "M0-01", "content")),
  );
  assertEquals(results.filter((r) => r.status === "fulfilled").length, 1);
});

Deno.test("coord: mutations require the run token", async () => {
  const root = await freshRoot();
  await seed(root);
  const run = await claim(root, "M0-01", "content");
  await assertRejects(
    () => checkpoint(root, "M0-01", run.runId, "wrong", "coding"),
    CoordError,
    "token",
  );
  await assertRejects(
    () => submit(root, "M0-01", run.runId, "wrong", "c", "b"),
    CoordError,
    "token",
  );
  await checkpoint(root, "M0-01", run.runId, run.token, "coding", {
    wait: "container",
  });
  const st = await taskState(root, "M0-01");
  assertEquals(st.state, "doing");
  assertEquals(st.checkpoint?.phase, "coding");
  assertEquals(st.checkpoint?.wait, "container");
});

Deno.test("coord: a run has one terminal record", async () => {
  const root = await freshRoot();
  await seed(root);
  const run = await claim(root, "M0-01", "content");
  await submit(root, "M0-01", run.runId, run.token, "c", "b");
  await assertRejects(
    () => submit(root, "M0-01", run.runId, run.token, "c2", "b"),
    CoordError,
  );
  await assertRejects(
    () => abandon(root, "M0-01", run.runId, "late"),
    CoordError,
  );
});

Deno.test("coord: reject and abandon return the task for a new attempt with history kept", async () => {
  const root = await freshRoot();
  await seed(root);
  const r1 = await claim(root, "M0-01", "content");
  await submit(root, "M0-01", r1.runId, r1.token, "c1", "b");
  await reject(root, "M0-01", r1.runId, "tests missing");
  assertEquals((await taskState(root, "M0-01")).state, "todo");

  const r2 = await claim(root, "M0-01", "content");
  assert(r2.runId !== r1.runId);
  await abandon(root, "M0-01", r2.runId, "session died");
  const r3 = await claim(root, "M0-01", "content");
  assertEquals((await taskState(root, "M0-01")).attempts, 3);
  assertEquals(r3.runId, "003");
  await assertRejects(
    () => accept(root, "M0-01", r1.runId, "x"),
    CoordError,
    "latest",
  );
});

Deno.test("coord: a run dir without claim.json is unknown, not todo", async () => {
  const root = await freshRoot();
  await seed(root);
  await Deno.mkdir(join(root, "tasks", "M0-01", "runs", "001"), {
    recursive: true,
  });
  assertEquals((await taskState(root, "M0-01")).state, "unknown");
  await assertRejects(
    () => claim(root, "M0-01", "content"),
    CoordError,
    "unknown",
  );
  const issues = await doctor(root);
  assert(issues.some((i) => i.includes("M0-01") && i.includes("claim.json")));
});

Deno.test("coord: why traces unmet deps to the root cause and open questions", async () => {
  const root = await freshRoot();
  await seed(root);
  const run = await claim(root, "M0-01", "content");
  const q = await ask(root, "Cronus281 is stopped, please start it", {
    task: "M0-01",
    from: "lane-content",
  });
  const reasons = await why(root, "M0-03");
  assert(reasons.some((r) => r.includes("M0-02") && r.includes("todo")));
  assert(
    reasons.some((r) =>
      r.includes("M0-01") && r.includes("doing") && r.includes("content")
    ),
  );
  assert(reasons.some((r) => r.includes(q)));
  assertEquals((await openQuestions(root)).length, 1);
  await answer(root, q, "started");
  assertEquals((await openQuestions(root)).length, 0);
  await assertRejects(() => answer(root, q, "again"), CoordError);
  assert(run.runId === "001");
});

Deno.test("coord: doctor finds missing deps and cycles", async () => {
  const root = await freshRoot();
  await addTask(root, { id: "A-01", lane: "ops", deps: ["A-02"] }, "");
  await addTask(root, { id: "A-02", lane: "ops", deps: ["A-01"] }, "");
  await addTask(root, { id: "A-03", lane: "ops", deps: ["A-99"] }, "");
  const issues = await doctor(root);
  assert(issues.some((i) => i.includes("cycle")));
  assert(issues.some((i) => i.includes("A-99")));
});

Deno.test("coord: container lease is exclusive, token-checked and never auto-transferred", async () => {
  const root = await freshRoot();
  const l = await lease(root, "Cronus281", "ops");
  await assertRejects(
    () => lease(root, "Cronus281", "content"),
    CoordError,
    "held",
  );
  await assertRejects(
    () => release(root, "Cronus281", "wrong"),
    CoordError,
    "token",
  );
  await heartbeat(root, "Cronus281", l.token);

  const later = Date.now() + 60 * 60 * 1000;
  const report = await stale(root, { now: later });
  assert(report.some((r) => r.includes("Cronus281")));
  await assertRejects(
    () => lease(root, "Cronus281", "content"),
    CoordError,
    "held",
  );

  await release(root, "Cronus281", l.token);
  assertEquals(await leaseHolder(root, "Cronus281"), null);
  const l2 = await lease(root, "Cronus281", "content");
  assertEquals((await leaseHolder(root, "Cronus281"))?.lane, "content");
  assert(l2.token !== l.token);
});

Deno.test("coord: concurrent leases produce exactly one holder", async () => {
  const root = await freshRoot();
  const results = await Promise.allSettled(
    Array.from({ length: 8 }, (_, i) => lease(root, "Cronus282", `lane${i}`)),
  );
  assertEquals(results.filter((r) => r.status === "fulfilled").length, 1);
});

Deno.test("coord: stale reports a claimed run with no recent checkpoint", async () => {
  const root = await freshRoot();
  await seed(root);
  await claim(root, "M0-01", "content");
  assertEquals((await stale(root)).length, 0);
  const report = await stale(root, { now: Date.now() + 20 * 60 * 1000 });
  assert(report.some((r) => r.includes("M0-01")));
});

Deno.test("coord: claim race across separate processes has one winner", async () => {
  const root = await freshRoot();
  await seed(root);
  const script = new URL("../../../scripts/coord/coord.ts", import.meta.url)
    .pathname
    .replace(/^\/([A-Za-z]:)/, "$1");
  const procs = Array.from(
    { length: 6 },
    () =>
      new Deno.Command(Deno.execPath(), {
        args: ["run", "--allow-all", script, "claim", "M0-01", "content"],
        env: { CG_COORD_ROOT: root },
        stdout: "null",
        stderr: "null",
      }).output(),
  );
  const codes = (await Promise.all(procs)).map((o) => o.code);
  assertEquals(codes.filter((c) => c === 0).length, 1, `exit codes: ${codes}`);
  assertEquals((await taskState(root, "M0-01")).state, "doing");
});

Deno.test("coord: pause blocks new claims and leases, drains, and resumes", async () => {
  const root = await freshRoot();
  await seed(root);
  const run = await claim(root, "M0-01", "content");
  const l = await lease(root, "Cronus28", "ops");

  await pause(root, "owner needs the machine");
  await assertRejects(() => pause(root, "again"), CoordError, "already paused");
  await assertRejects(
    () => lease(root, "Cronus281", "ops"),
    CoordError,
    "paused",
  );
  assertEquals(await next(root, "ops"), []);

  const cp = await checkpoint(root, "M0-01", run.runId, run.token, "red", {
    wait: "paused",
  });
  assertEquals(cp.paused, true);

  let st = await pauseState(root);
  assertEquals(st.paused, true);
  assertEquals(st.drained, false, "a held lease means not drained");
  assertEquals(st.leases.map((x) => x.container), ["Cronus28"]);

  await release(root, "Cronus28", l.token);
  st = await pauseState(root);
  assertEquals(st.drained, true);

  const later = Date.now() + 60 * 60 * 1000;
  assertEquals(
    await stale(root, { now: later }),
    [],
    "runs are not stale while paused",
  );

  await resume(root);
  await assertRejects(() => resume(root), CoordError, "not paused");
  assertEquals((await pauseState(root)).paused, false);
  assertEquals(
    (await checkpoint(root, "M0-01", run.runId, run.token, "green")).paused,
    false,
  );
  await lease(root, "Cronus281", "ops");
});

Deno.test("coord: claim is refused while paused", async () => {
  const root = await freshRoot();
  await seed(root);
  await pause(root, "x");
  await assertRejects(
    () => claim(root, "M0-01", "content"),
    CoordError,
    "paused",
  );
  await resume(root);
  await pause(root, "second pause keeps history");
  await resume(root);
  const hist = [];
  for await (const e of Deno.readDir(join(root, "pauses"))) hist.push(e.name);
  assertEquals(hist.length, 2);
});

Deno.test("coord: overview summarizes milestones, active work, questions and pause", async () => {
  const root = await freshRoot();
  await seed(root);
  await Deno.writeTextFile(
    join(root, "milestones.json"),
    JSON.stringify({ M0: { title: "Spike", due: "2026-09-29" } }),
  );
  const run = await claim(root, "M0-01", "content");
  await checkpoint(root, "M0-01", run.runId, run.token, "red", {
    wait: "container",
  });
  await ask(root, "Cronus281 is stopped", {
    task: "M0-01",
    from: "lane-content",
  });
  await pause(root, "owner lunch");
  const text = await overview(root);
  assertStringIncludes(text, "PAUSED");
  assertStringIncludes(text, "owner lunch");
  assertStringIncludes(text, "M0");
  assertStringIncludes(text, "Spike");
  assertStringIncludes(text, "2026-09-29");
  assertStringIncludes(text, "0/3 accepted");
  assertStringIncludes(text, "M0-01");
  assertStringIncludes(text, "wait=container");
  assertStringIncludes(text, "Cronus281 is stopped");
});
